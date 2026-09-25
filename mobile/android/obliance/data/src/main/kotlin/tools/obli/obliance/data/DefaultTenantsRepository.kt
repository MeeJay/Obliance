package tools.obli.obliance.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.api.TenantsApi

@OptIn(ExperimentalCoroutinesApi::class)
internal class DefaultTenantsRepository(
    private val registry: ServerRegistry,
    private val sessions: ServerSessions,
    private val appScope: CoroutineScope,
    private val retryMs: Long = RETRY_MS,
) : TenantsRepository {
    /**
     * The tenant list of one server, for the account that loaded it: a sign-out
     * drops it and another account on the same server loads its own ([userId]).
     * [ok] = the last load of this account succeeded (no automatic retry needed).
     */
    private data class Loaded(
        val userId: Long? = null,
        val tenants: List<Tenant> = emptyList(),
        val loading: Boolean = false,
        val error: ApiOutcome<Nothing>? = null,
        val ok: Boolean = false,
    )

    private val lists = MutableStateFlow<Map<ServerId, Loaded>>(emptyMap())

    override val scope: StateFlow<TenantScope> = sessions.active
        .flatMapLatest { s ->
            if (s == null) {
                flowOf(TenantScope())
            } else {
                combine(s.auth, lists.map { it[s.id] }) { auth, loaded ->
                    val probe = (auth as? AuthState.SignedIn)?.probe
                    // Never show another account's tenants (expired sessions keep the last list).
                    val mine = loaded?.takeIf { probe == null || it.userId == probe.user.id }
                    TenantScope(
                        serverId = s.id,
                        tenants = mine?.tenants.orEmpty(),
                        currentTenantId = probe?.currentTenantId,
                        loading = mine?.loading == true,
                        error = mine?.error,
                    )
                }
            }
        }
        .stateIn(appScope, SharingStarted.Eagerly, TenantScope())

    init {
        // Load the tenant list once the active server is signed in; forget it on sign-out.
        appScope.launch {
            sessions.active
                .flatMapLatest { s -> s?.auth?.map { s to it } ?: emptyFlow() }
                .collectLatest { (s, auth) ->
                    when (auth) {
                        is AuthState.SignedIn -> ensureLoaded(s, auth.probe.user.id)
                        AuthState.SignedOut -> lists.update { it - s.id }
                        else -> Unit
                    }
                }
        }
    }

    /** Loads when missing, failed or loaded for another account; a failure is retried with a backoff while signed in. */
    private suspend fun ensureLoaded(s: ServerSession, userId: Long) {
        var wait = retryMs
        while (true) {
            val have = lists.value[s.id]
            if (have != null && have.userId == userId && have.ok) return
            val out = load(s, userId)
            // Nothing a retry can fix: the session expired (S03) or the account may not list tenants.
            if (out is ApiOutcome.Ok || out == ApiOutcome.SessionExpired || out is ApiOutcome.Forbidden) return
            delay(wait)
            wait = (wait * 2).coerceAtMost(MAX_RETRY_MS)
        }
    }

    override suspend fun refresh(): ApiOutcome<List<Tenant>> {
        val s = sessions.active.value ?: return noServer
        return load(s, (s.auth.value as? AuthState.SignedIn)?.probe?.user?.id)
    }

    private suspend fun load(s: ServerSession, userId: Long?): ApiOutcome<List<Tenant>> {
        // Another account's list is dropped at once, not shown while loading.
        fun base(map: Map<ServerId, Loaded>) = map[s.id]?.takeIf { it.userId == userId } ?: Loaded(userId)
        lists.update { it + (s.id to base(it).copy(loading = true)) }
        var out: ApiOutcome<List<Tenant>>? = null
        try {
            out = TenantsApi(s.http).list().watchedBy(s)
            return out
        } finally {
            val result = out
            lists.update { map ->
                val previous = base(map)
                val next = when (result) {
                    is ApiOutcome.Ok -> Loaded(userId, result.value.sortedWith(compareBy<Tenant> { !it.isMaster }.thenBy { it.name.lowercase() }), ok = true)
                    null -> previous.copy(loading = false) // cancelled
                    else -> previous.copy(loading = false, error = result.failureAs())
                }
                map + (s.id to next)
            }
        }
    }

    override suspend fun switchTo(tenantId: Long, serverId: ServerId?): ApiOutcome<Unit> {
        val s = (if (serverId == null) sessions.active.value else sessions.session(serverId)) ?: return noServer
        // Runs in the application scope: once the server applied the switch, the
        // probe and the socket must follow even if the calling screen goes away.
        return appScope.async { doSwitch(s, tenantId) }.await()
    }

    private suspend fun doSwitch(s: ServerSession, tenantId: Long): ApiOutcome<Unit> =
        when (val out = TenantsApi(s.http).switchTo(tenantId).watchedBy(s)) {
            is ApiOutcome.Ok -> {
                s.probe()
                // Rooms are joined at connection time; only the active server has a socket.
                if (sessions.active.value?.id == s.id) s.realtime.reconnect()
                registry.setLastTenant(s.id, tenantId)
                ApiOutcome.Ok(Unit)
            }
            else -> out.failureAs()
        }

    companion object {
        const val RETRY_MS = 15_000L
        const val MAX_RETRY_MS = 5 * 60_000L
    }
}
