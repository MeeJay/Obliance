package tools.obli.obliance.triage

import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.ObliServices

/** A pending device of ONE server: ids are only unique per server. */
internal data class EnrolmentKey(val serverId: ServerId, val deviceId: Long)

/** The enrolment feed of one server (last items kept while it is expired or unreachable, §2.10 item 5). */
internal data class ServerEnrolments(
    val serverId: ServerId,
    val status: FeedStatus = FeedStatus.LOADING,
    /** Platform admin, or `agent_config:approval` in the SESSION tenant (last known). */
    val canApprove: Boolean = false,
    /** Session tenant the list was loaded in (master = every tenant). */
    val sessionTenantId: Long? = null,
    val items: List<PendingDevice> = emptyList(),
    val keys: Map<Long, AgentKeyInfo> = emptyMap(),
    /** Time of the last successful load (epoch ms). */
    val updatedAt: Long? = null,
)

internal data class EnrolmentsState(
    /** Only the servers that were looked at (included in À traiter), any order. */
    val servers: List<ServerEnrolments> = emptyList(),
    /** Items with an action in flight: their buttons are disabled. */
    val busy: Set<EnrolmentKey> = emptySet(),
    val refreshing: Boolean = false,
) {
    fun server(id: ServerId): ServerEnrolments? = servers.firstOrNull { it.serverId == id }
}

/** What a server's feed depends on: when it changes (sign-in, expiry, tenant switch), the server is reloaded. */
internal data class ServerKey(val serverId: ServerId, val auth: AuthKind, val tenantId: Long?, val platformAdmin: Boolean)

internal enum class AuthKind { UNKNOWN, SIGNED_IN, EXPIRED, UNREACHABLE, SIGNED_OUT }

/**
 * Pending devices of every server included in À traiter (design doc §5 S10
 * "Segment Enrôlements", §2.10). Pure state + suspend loaders: the ViewModel
 * decides when they run (only while the screen collects).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class EnrolmentsFeed(
    private val services: ObliServices,
    val source: EnrolmentsSource,
    private val clock: () -> Long,
) {
    private val _state = MutableStateFlow(EnrolmentsState())
    val state: StateFlow<EnrolmentsState> = _state.asStateFlow()

    val enabled: Boolean get() = source !== EnrolmentsSource.None

    /** canApprove per (server, session tenant): the rights of a team member follow the tenant. */
    private val allowed = ConcurrentHashMap<Pair<ServerId, Long>, Boolean>()
    private val locks = ConcurrentHashMap<ServerId, Mutex>()

    /** Servers included in À traiter with what their feed depends on, in registry order. */
    fun serverKeys(): Flow<List<ServerKey>> = services.registry.state
        .map { reg -> reg.profiles.filter { it.includeInTriage }.map { it.id } }
        .distinctUntilChanged()
        .flatMapLatest { ids ->
            val flows = ids.mapNotNull { id -> services.sessions.session(id)?.auth?.map { keyOf(id, it) } }
            if (flows.isEmpty()) flowOf(emptyList()) else combine(flows) { it.toList() }
        }
        .distinctUntilChanged()

    private fun keyOf(id: ServerId, auth: AuthState): ServerKey = when (auth) {
        is AuthState.SignedIn -> ServerKey(id, AuthKind.SIGNED_IN, auth.probe.currentTenantId, auth.probe.user.isPlatformAdmin)
        AuthState.Expired -> ServerKey(id, AuthKind.EXPIRED, null, false)
        is AuthState.Unreachable -> ServerKey(id, AuthKind.UNREACHABLE, null, false)
        AuthState.SignedOut -> ServerKey(id, AuthKind.SIGNED_OUT, null, false)
        AuthState.Unknown -> ServerKey(id, AuthKind.UNKNOWN, null, false)
    }

    /**
     * Reloads every included server in parallel (60 s poll, server or tenant
     * change; [user] = pull to refresh, which shows the refresh indicator).
     */
    suspend fun refreshAll(user: Boolean = false) {
        if (!enabled) return
        val ids = services.registry.state.value.profiles.filter { it.includeInTriage }.map { it.id }
        // Servers no longer included (removed, excluded) leave the feed.
        _state.update { s -> s.copy(servers = s.servers.filter { it.serverId in ids }, refreshing = s.refreshing || user) }
        try {
            coroutineScope { ids.map { id -> async { refresh(id) } }.awaitAll() }
        } finally {
            if (user) _state.update { it.copy(refreshing = false) }
        }
    }

    /** Reloads ONE server; returns the loaded items (null when the list could not be loaded now). */
    suspend fun refresh(serverId: ServerId): List<PendingDevice>? {
        if (!enabled) return null
        return locks.getOrPut(serverId) { Mutex() }.withLock { load(serverId) }
    }

    private suspend fun load(serverId: ServerId): List<PendingDevice>? {
        val session = services.sessions.session(serverId)
        val auth = session?.auth?.value
        if (session == null) {
            _state.update { s -> s.copy(servers = s.servers.filter { it.serverId != serverId }) }
            return null
        }
        when (auth) {
            is AuthState.SignedIn -> Unit
            AuthState.Expired -> return mark(serverId, FeedStatus.EXPIRED)
            is AuthState.Unreachable -> return mark(serverId, FeedStatus.UNREACHABLE)
            AuthState.SignedOut -> {
                // Signed out: its cards leave À traiter (§2.10 "Se déconnecter de ce serveur").
                put(serverId) { ServerEnrolments(serverId, FeedStatus.SIGNED_OUT) }
                return null
            }
            AuthState.Unknown, null -> {
                put(serverId) { old -> old ?: ServerEnrolments(serverId, FeedStatus.LOADING) }
                return null
            }
        }
        val probe = auth.probe
        val tenant = probe.currentTenantId
        val can = when (val c = canApprove(serverId, probe.user.isPlatformAdmin, tenant)) {
            is CanApprove.Known -> c.allowed
            is CanApprove.Failed -> return failed(serverId, c.outcome)
        }
        if (!can) {
            put(serverId) { ServerEnrolments(serverId, FeedStatus.OK, canApprove = false, sessionTenantId = tenant, updatedAt = clock()) }
            return emptyList()
        }
        val items = when (val out = source.pending(serverId)) {
            is ApiOutcome.Ok -> out.value
            is ApiOutcome.Accepted -> out.value
            else -> return failed(serverId, out)
        }
        val known = _state.value.server(serverId)?.keys.orEmpty()
        val keys = if (items.any { d -> d.apiKeyId != null && d.apiKeyId !in known }) {
            (source.keys(serverId) as? ApiOutcome.Ok)?.value?.associateBy { it.id } ?: known
        } else {
            known
        }
        put(serverId) {
            ServerEnrolments(serverId, FeedStatus.OK, canApprove = true, sessionTenantId = tenant, items = items, keys = keys, updatedAt = clock())
        }
        return items
    }

    private sealed interface CanApprove {
        data class Known(val allowed: Boolean) : CanApprove
        data class Failed(val outcome: ApiOutcome<*>) : CanApprove
    }

    /** Platform admin → yes without a call; else `GET /api/auth/permissions` once per (server, tenant). */
    private suspend fun canApprove(serverId: ServerId, platformAdmin: Boolean, tenant: Long?): CanApprove {
        if (platformAdmin) return CanApprove.Known(true)
        val cacheKey = serverId to (tenant ?: -1L)
        allowed[cacheKey]?.let { return CanApprove.Known(it) }
        return when (val out = source.tenantCapabilities(serverId)) {
            is ApiOutcome.Ok -> CanApprove.Known(CAP_APPROVAL in out.value).also { allowed[cacheKey] = it.allowed }
            else -> CanApprove.Failed(out)
        }
    }

    /** 401 → expired (the source marked the session); anything else → unreachable. Last items kept. */
    private fun failed(serverId: ServerId, out: ApiOutcome<*>): List<PendingDevice>? =
        mark(serverId, if (out == ApiOutcome.SessionExpired) FeedStatus.EXPIRED else FeedStatus.UNREACHABLE)

    private fun mark(serverId: ServerId, status: FeedStatus): List<PendingDevice>? {
        put(serverId) { old -> (old ?: ServerEnrolments(serverId)).copy(status = status) }
        return null
    }

    private fun put(serverId: ServerId, f: (ServerEnrolments?) -> ServerEnrolments) = _state.update { s ->
        val old = s.server(serverId)
        val next = f(old)
        s.copy(servers = if (old == null) s.servers + next else s.servers.map { if (it.serverId == serverId) next else it })
    }

    // --- Local changes -----------------------------------------------------------

    fun setBusy(keys: Collection<EnrolmentKey>, busy: Boolean) = _state.update { s ->
        s.copy(busy = if (busy) s.busy + keys else s.busy - keys.toSet())
    }

    /** An action succeeded: the items leave the list at once (§5 S10), before the reload confirms it. */
    fun remove(keys: Collection<EnrolmentKey>) {
        val byServer = keys.groupBy({ it.serverId }, { it.deviceId })
        _state.update { s ->
            s.copy(
                servers = s.servers.map { f ->
                    val ids = byServer[f.serverId] ?: return@map f
                    f.copy(items = f.items.filter { it.id !in ids })
                },
            )
        }
    }

    /**
     * A device signal of the ACTIVE server: approved / deleted elsewhere → leaves
     * at once; returns true when the list should be reloaded (a new pending agent
     * registered, or a known pending device changed).
     */
    fun onSignal(activeId: ServerId, signal: DeviceSignal): Boolean {
        val known = _state.value.server(activeId)?.items?.any { it.id == signal.deviceId } == true
        return when (signal.event) {
            ObliEvents.DEVICE_APPROVED, ObliEvents.DEVICE_DELETED -> {
                if (known) remove(listOf(EnrolmentKey(activeId, signal.deviceId)))
                true
            }
            // DEVICE_UPDATED fires on every status change of the fleet: only a new
            // registration (status pending, agent.controller) or a known item matters.
            ObliEvents.DEVICE_UPDATED -> known || signal.status == DeviceStatus.PENDING
            else -> false
        }
    }

    fun item(key: EnrolmentKey): PendingDevice? = _state.value.server(key.serverId)?.items?.firstOrNull { it.id == key.deviceId }
}
