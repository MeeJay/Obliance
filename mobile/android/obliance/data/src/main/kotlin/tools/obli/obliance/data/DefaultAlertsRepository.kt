package tools.obli.obliance.data

import java.time.Instant
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.AlertsApi
import tools.obli.obliance.api.Approval
import tools.obli.obliance.api.ApprovalsApi
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.domain.ServerAlert

@OptIn(ExperimentalCoroutinesApi::class)
internal class DefaultAlertsRepository(
    private val registry: ServerRegistry,
    private val sessions: ServerSessions,
    private val appScope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pollMs: Long = POLL_MS,
) : AlertsRepository {
    /** What one server contributes. Kept between refreshes (expired / offline servers keep their last items). */
    private data class Part(
        val alerts: List<ServerAlert> = emptyList(),
        val approvals: List<ServerApproval> = emptyList(),
        val status: FeedStatus = FeedStatus.LOADING,
        val updatedAt: Long? = null,
    )

    private val parts = MutableStateFlow<Map<ServerId, Part>>(emptyMap())
    private val state = MutableStateFlow(AlertsSnapshot())
    private val refreshMutex = Mutex()

    /**
     * Ids resolved on each server (NOTIFICATION_RESOLVED, 0.3.1), newest last,
     * at most [MAX_RESOLVED] per server. A resolved alert never becomes active
     * again (the server inserts a NEW row for a new occurrence), so a refresh
     * already in flight when the event came can never bring one back.
     */
    private val resolvedIds = HashMap<ServerId, LinkedHashSet<Long>>()

    /**
     * Alerts merged from NOTIFICATION_NEW, per server: id → arrival number
     * ([arrivalSeq]), at most [MAX_ARRIVALS] per server. A refresh that started
     * before an arrival may have read the feed before that row existed: it keeps
     * the alert (an escalation's NEW half is never wiped by a stale feed), and
     * the next refresh decides.
     */
    private val arrivals = HashMap<ServerId, LinkedHashMap<Long, Long>>()
    private val arrivalSeq = AtomicLong()

    override val snapshot: StateFlow<AlertsSnapshot> = state.asStateFlow()

    init {
        // Hot only while collected: polling and socket listening follow the subscribers.
        appScope.launch {
            state.subscriptionCount
                .map { it > 0 }
                .distinctUntilChanged()
                .collectLatest { watched ->
                    if (!watched) return@collectLatest
                    coroutineScope {
                        launch {
                            while (true) {
                                refresh()
                                delay(pollMs)
                            }
                        }
                        launch { listenToActiveServer() }
                    }
                }
        }
        // Registry changes (server removed, triage inclusion toggled, reorder) re-shape the snapshot.
        appScope.launch { registry.state.collect { publish() } }
        // Signing out of a server takes its cards out of À traiter at once (design doc
        // §5 S92, §10.5); signing in again reloads it while the feed is watched.
        appScope.launch {
            registry.state
                .map { st -> st.profiles.map { it.id } }
                .distinctUntilChanged()
                .flatMapLatest { ids ->
                    val flows = ids.mapNotNull { id -> sessions.session(id)?.auth?.map { id to it } }
                    if (flows.isEmpty()) emptyFlow() else merge(*flows.toTypedArray())
                }
                .collect { (id, auth) ->
                    when (auth) {
                        AuthState.SignedOut -> setPart(id) { Part(status = FeedStatus.SIGNED_OUT) }
                        is AuthState.SignedIn -> {
                            val status = parts.value[id]?.status
                            val stale = status == FeedStatus.SIGNED_OUT || status == FeedStatus.EXPIRED
                            if (stale && state.subscriptionCount.value > 0) sessions.session(id)?.let { s -> appScope.launch { refreshServer(s) } }
                        }
                        else -> Unit
                    }
                }
        }
    }

    private suspend fun listenToActiveServer() {
        sessions.active
            .flatMapLatest { s -> s?.realtime?.events?.map { s to it } ?: emptyFlow() }
            .collect { (s, event) ->
                when (event.name) {
                    ObliEvents.NOTIFICATION_NEW -> {
                        val alert = AlertsApi.decodeNotification(event.payload) ?: return@collect
                        if (!included(s.id) || isResolved(s.id, alert.id)) return@collect
                        // Recorded first: a refresh landing in between keeps it (see [arrivals]).
                        recordArrival(s.id, alert.id)
                        parts.update { map ->
                            val part = map[s.id] ?: Part(status = FeedStatus.OK)
                            if (part.alerts.any { it.alert.id == alert.id }) map
                            else map + (s.id to part.copy(alerts = listOf(ServerAlert(s.id, alert)) + part.alerts))
                        }
                        publish()
                    }
                    ObliEvents.NOTIFICATION_RESOLVED -> {
                        val ids = AlertsApi.decodeResolved(event.payload)?.takeIf { it.isNotEmpty() } ?: return@collect
                        onResolved(s.id, ids)
                    }
                    ObliEvents.APPROVAL_CREATED, ObliEvents.APPROVAL_UPDATED -> refreshServer(s)
                }
            }
    }

    /** 0.3.1: alerts of [serverId] resolved server-side leave À traiter (and the badge) at once. */
    private fun onResolved(serverId: ServerId, ids: Set<Long>) {
        synchronized(resolvedIds) {
            val set = resolvedIds.getOrPut(serverId) { LinkedHashSet() }
            set.addAll(ids)
            val oldest = set.iterator()
            while (set.size > MAX_RESOLVED) {
                oldest.next()
                oldest.remove()
            }
        }
        parts.update { map ->
            val part = map[serverId] ?: return@update map
            if (part.alerts.none { it.alert.id in ids }) map else map + (serverId to part.copy(alerts = part.alerts.filterNot { it.alert.id in ids }))
        }
        publish()
    }

    private fun isResolved(serverId: ServerId, alertId: Long): Boolean = synchronized(resolvedIds) { resolvedIds[serverId]?.contains(alertId) == true }

    private fun recordArrival(serverId: ServerId, alertId: Long) = synchronized(arrivals) {
        val map = arrivals.getOrPut(serverId) { LinkedHashMap() }
        map.remove(alertId)
        map[alertId] = arrivalSeq.incrementAndGet()
        val oldest = map.entries.iterator()
        while (map.size > MAX_ARRIVALS) {
            oldest.next()
            oldest.remove()
        }
    }

    /** Ids of [serverId] merged from NOTIFICATION_NEW after arrival number [since]. */
    private fun arrivedAfter(serverId: ServerId, since: Long): Set<Long> = synchronized(arrivals) {
        arrivals[serverId]?.filterValues { it > since }?.keys?.toSet().orEmpty()
    }

    /** A feed read after arrival number [since] accounts for every earlier arrival. */
    private fun forgetArrivals(serverId: ServerId, since: Long) = synchronized(arrivals) {
        arrivals[serverId]?.values?.removeAll { it <= since }
    }

    override suspend fun refresh() {
        refreshMutex.withLock {
            state.update { it.copy(refreshing = true) }
            val targets = sessions.all()
            coroutineScope { targets.map { s -> async { refreshServerUnlocked(s) } }.awaitAll() }
            state.update { it.copy(refreshing = false, updatedAt = clock()) }
            publish()
        }
    }

    private suspend fun refreshServer(s: ServerSession) = refreshMutex.withLock { refreshServerUnlocked(s) }

    private suspend fun refreshServerUnlocked(s: ServerSession) {
        val profile = registry.state.value.byId(s.id) ?: return
        if (!profile.includeInTriage) {
            setPart(s.id) { Part(status = FeedStatus.EXCLUDED) }
            return
        }
        var auth = s.auth.value
        // Never probed, or offline last time: ask /api/auth/me again (a SignedIn
        // result also lets the app open the active server's socket).
        if (auth is AuthState.Unknown || auth is AuthState.Unreachable) auth = s.probe()
        when (auth) {
            AuthState.SignedOut -> return setPart(s.id) { Part(status = FeedStatus.SIGNED_OUT) }
            AuthState.Expired -> return setPart(s.id) { it.copy(status = FeedStatus.EXPIRED) }
            else -> Unit
        }
        // Socket arrivals after this point may be newer than what the feed lists.
        val since = arrivalSeq.get()
        val feed = AlertsApi(s.http).all().watchedBy(s)
        val isAdmin = (s.auth.value as? AuthState.SignedIn)?.probe?.user?.isPlatformAdmin == true
        val approvals = if (isAdmin && feed is ApiOutcome.Ok) ApprovalsApi(s.http).list().watchedBy(s) else null
        val now = clock()
        setPart(s.id) { previous ->
            when (feed) {
                is ApiOutcome.Ok -> {
                    val listed = feed.value.alerts.filterNot { isResolved(s.id, it.id) }.map { ServerAlert(s.id, it) }
                    Part(
                        alerts = arrivedDuring(s.id, since, previous.alerts, listed) + listed,
                        approvals = (approvals as? ApiOutcome.Ok)?.value.orEmpty().filter { it.isPending && !it.isExpiredAt(now) }.map { ServerApproval(s.id, it) },
                        status = FeedStatus.OK,
                        updatedAt = now,
                    )
                }
                ApiOutcome.SessionExpired -> previous.copy(status = FeedStatus.EXPIRED)
                else -> previous.copy(status = FeedStatus.UNREACHABLE)
            }
        }
        if (feed is ApiOutcome.Ok) forgetArrivals(s.id, since)
    }

    /**
     * The alerts of [current] that NOTIFICATION_NEW brought while the feed was
     * being read (after arrival [since]), missing from [listed] and not resolved
     * since: the feed may predate them (the NEW half of an escalation, whose
     * RESOLVED half already took the old alert out).
     */
    private fun arrivedDuring(serverId: ServerId, since: Long, current: List<ServerAlert>, listed: List<ServerAlert>): List<ServerAlert> {
        val arrived = arrivedAfter(serverId, since)
        if (arrived.isEmpty()) return emptyList()
        val listedIds = listed.mapTo(HashSet()) { it.alert.id }
        return current.filter { it.alert.id in arrived && it.alert.id !in listedIds && !isResolved(serverId, it.alert.id) }
    }

    private fun setPart(id: ServerId, change: (Part) -> Part) {
        parts.update { it + (id to change(it[id] ?: Part())) }
        publish()
    }

    private fun included(id: ServerId): Boolean = registry.state.value.byId(id)?.includeInTriage == true

    /** Rebuilds the public snapshot from the parts, in registry order, dropping removed servers. */
    private fun publish() {
        state.update { s ->
            // Read inside the CAS loop: a concurrent publish can never write older parts last.
            val profiles = registry.state.value.profiles
            val current = parts.value
            val ordered = profiles.mapNotNull { p -> current[p.id]?.let { p.id to it } }
            s.copy(
                alerts = ordered.flatMap { (_, part) -> if (part.status == FeedStatus.EXCLUDED || part.status == FeedStatus.SIGNED_OUT) emptyList() else part.alerts },
                escalations = ordered.flatMap { (_, part) -> if (part.status == FeedStatus.OK) part.approvals else emptyList() },
                feeds = profiles.map { p -> current[p.id]?.let { ServerFeed(p.id, it.status, it.updatedAt) } ?: ServerFeed(p.id, FeedStatus.LOADING) },
            )
        }
    }

    override suspend fun markRead(alert: ServerAlert): ApiOutcome<Unit> {
        val s = sessions.session(alert.serverId) ?: return noServer
        val out = AlertsApi(s.http).markRead(alert.alert.id).watchedBy(s)
        if (out is ApiOutcome.Ok) {
            val readAt = Instant.ofEpochMilli(clock()).toString()
            editAlerts(alert.serverId) { list -> list.map { if (it.alert.id == alert.alert.id) it.copy(alert = it.alert.copy(readAt = readAt)) else it } }
        }
        return out
    }

    override suspend fun delete(alert: ServerAlert): ApiOutcome<Unit> {
        val s = sessions.session(alert.serverId) ?: return noServer
        val out = AlertsApi(s.http).delete(alert.alert.id).watchedBy(s)
        if (out is ApiOutcome.Ok) editAlerts(alert.serverId) { list -> list.filterNot { it.alert.id == alert.alert.id } }
        return out
    }

    override suspend fun markAllRead(serverId: ServerId): ApiOutcome<Unit> {
        val s = sessions.session(serverId) ?: return noServer
        val out = AlertsApi(s.http).markAllRead().watchedBy(s)
        if (out is ApiOutcome.Ok) refreshServer(s)
        return out
    }

    override suspend fun approve(item: ServerApproval, reason: String?, extra: JsonObject?): ApiOutcome<Approval> {
        val s = sessions.session(item.serverId) ?: return noServer
        return ApprovalsApi(s.http).approve(item.approval.id, reason, extra).watchedBy(s).also { resolved(item, it) }
    }

    override suspend fun deny(item: ServerApproval, reason: String?, extra: JsonObject?): ApiOutcome<Approval> {
        val s = sessions.session(item.serverId) ?: return noServer
        return ApprovalsApi(s.http).deny(item.approval.id, reason, extra).watchedBy(s).also { resolved(item, it) }
    }

    private fun resolved(item: ServerApproval, out: ApiOutcome<Approval>) {
        // Done, or already resolved / expired elsewhere: either way it leaves the list.
        val gone = out.valueOrNull != null || out is ApiOutcome.Unsupported || (out is ApiOutcome.Failure && out.status == 410)
        if (!gone) return
        setPart(item.serverId) { part -> part.copy(approvals = part.approvals.filterNot { it.approval.id == item.approval.id }) }
    }

    private fun editAlerts(id: ServerId, change: (List<ServerAlert>) -> List<ServerAlert>) =
        setPart(id) { part -> part.copy(alerts = change(part.alerts)) }

    companion object {
        const val POLL_MS = 60_000L

        /** Resolved ids remembered per server (a refresh in flight never brings one back). */
        const val MAX_RESOLVED = 2_000

        /** Socket arrivals remembered per server between two refreshes. */
        const val MAX_ARRIVALS = 500
    }
}

/** The request's expiry has passed: the server would only answer 410 (it never sweeps them itself). */
internal fun Approval.isExpiredAt(now: Long): Boolean {
    val at = expiresAt?.trim()?.takeIf { it.isNotEmpty() } ?: return false
    val ms = runCatching { Instant.parse(at).toEpochMilli() }.getOrNull()
        ?: runCatching { java.time.OffsetDateTime.parse(at.replace(' ', 'T')).toInstant().toEpochMilli() }.getOrNull()
        ?: return false
    return ms <= now
}
