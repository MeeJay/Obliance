package tools.obli.obliance.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ObliHttp
import tools.obli.core.realtime.ConnectionState

/**
 * The production [ObliServices]: repositories over the shared sessions, plus
 * the lifecycle of the active server (probe on activation, one socket, 401 or
 * a refused handshake → session expired). Built once by the application.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DefaultObliServices(
    override val registry: ServerRegistry,
    override val sessions: ServerSessions,
    /** HTTP client of any origin (sign-in of a server that is not configured yet). */
    httpFor: (origin: String) -> ObliHttp,
    /** Expires the cookies of an origin (WebCookieJar.clearOrigin). */
    clearCookies: (origin: String) -> Unit,
    private val scope: CoroutineScope,
    clock: () -> Long = System::currentTimeMillis,
) : ObliServices {
    override val auth: AuthRepository = DefaultAuthRepository(registry, sessions, httpFor, clearCookies, scope)
    override val tenants: TenantsRepository = DefaultTenantsRepository(registry, sessions, scope)
    override val alerts: AlertsRepository = DefaultAlertsRepository(registry, sessions, scope, clock)
    override val devices: DevicesRepository = DefaultDevicesRepository(sessions, clock)

    private var started = false

    /** Starts following the active server. Call once, after `registry.load()`. */
    fun start() {
        if (started) return
        started = true
        // Probe the active server when it becomes active, close the previous socket.
        scope.launch {
            var previous: ServerSession? = null
            sessions.active.collect { s ->
                if (previous != null && previous !== s) previous?.realtime?.disconnect()
                previous = s
                if (s != null && s.auth.value is AuthState.Unknown) launch { s.probe() }
            }
        }
        // Socket of the active server: open while signed in, closed when signed out.
        scope.launch {
            sessions.active
                .flatMapLatest { s -> s?.auth?.map { s to it } ?: emptyFlow() }
                .collect { (s, auth) ->
                    when (auth) {
                        is AuthState.SignedIn -> s.realtime.connect()
                        AuthState.SignedOut -> s.realtime.disconnect()
                        else -> Unit
                    }
                }
        }
        // A refused handshake means the cookie is no longer valid.
        scope.launch {
            sessions.active
                .flatMapLatest { s -> s?.realtime?.state?.map { s to it } ?: emptyFlow() }
                .collect { (s, state) -> if (state == ConnectionState.UNAUTHORIZED) s.markExpired() }
        }
    }

    override suspend fun openOn(serverId: ServerId): ServerId? {
        val previous = registry.state.value.activeId
        if (previous == serverId || registry.state.value.byId(serverId) == null) return null
        val session = sessions.activate(serverId) ?: return null
        if (session.auth.value !is AuthState.SignedIn) scope.launch { session.probe() }
        return previous
    }
}
