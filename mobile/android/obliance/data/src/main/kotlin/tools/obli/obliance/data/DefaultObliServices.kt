package tools.obli.obliance.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.flow.withIndex
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
 *
 * The socket lives only while the app is in the FOREGROUND (see [start]): the
 * process is also started every 15 minutes by the notification worker, by a
 * notification action or by the Quick Settings tile, and none of those may
 * keep a websocket open (battery).
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

    /**
     * Starts following the active server. Call once, after `registry.load()`.
     *
     * - The active server is probed when it becomes active (also in a process
     *   started in the background: the notification pass needs the session state).
     * - Its socket connects only while it is signed in AND [foreground] is true,
     *   and disconnects [backgroundGraceMs] after the app went to the background
     *   (a quick trip to another app keeps it). The default flow is "always in the
     *   foreground" (tests, previews); the application passes the process lifecycle.
     */
    fun start(foreground: StateFlow<Boolean> = ALWAYS_FOREGROUND, backgroundGraceMs: Long = BACKGROUND_GRACE_MS) {
        if (started) return
        started = true
        val held = heldForeground(foreground, backgroundGraceMs)
        // Probe the active server when it becomes active, close the previous socket.
        scope.launch {
            var previous: ServerSession? = null
            sessions.active.collect { s ->
                if (previous != null && previous !== s) previous?.realtime?.disconnect()
                previous = s
                if (s != null && s.auth.value is AuthState.Unknown) launch { s.probe() }
            }
        }
        // Socket of the active server: open while signed in and in the foreground,
        // closed when signed out or once the background grace period is over.
        scope.launch {
            combine(sessions.active.flatMapLatest { s -> s?.auth?.map { s to it } ?: flowOf(null) }, held) { sa, fg -> sa?.let { Triple(it.first, it.second, fg) } }
                .collect { t ->
                    val (s, auth, fg) = t ?: return@collect
                    when {
                        auth is AuthState.SignedIn && fg -> s.realtime.connect()
                        auth is AuthState.SignedIn -> s.realtime.disconnect()
                        auth == AuthState.SignedOut -> s.realtime.disconnect()
                        else -> Unit
                    }
                }
        }
        // Background invariant: whatever reconnected it (tenant switch, re-authentication),
        // no socket stays open once the grace period is over.
        scope.launch {
            combine(sessions.active.flatMapLatest { s -> s?.realtime?.state?.map { s to it } ?: flowOf(null) }, held) { ss, fg -> ss?.takeIf { !fg } }
                .collect { ss ->
                    val (s, state) = ss ?: return@collect
                    if (state == ConnectionState.CONNECTING || state == ConnectionState.CONNECTED || state == ConnectionState.RECONNECTING) s.realtime.disconnect()
                }
        }
        // A refused handshake means the cookie is no longer valid.
        scope.launch {
            sessions.active
                .flatMapLatest { s -> s?.realtime?.state?.map { s to it } ?: emptyFlow() }
                .collect { (s, state) -> if (state == ConnectionState.UNAUTHORIZED) s.markExpired() }
        }
    }

    /**
     * [foreground] with the background grace period: true at once, false only
     * after [graceMs] in the background (the first value, at process start, is
     * taken as is: a process started in the background never had a socket).
     */
    private fun heldForeground(foreground: StateFlow<Boolean>, graceMs: Long): Flow<Boolean> =
        foreground.withIndex()
            .transformLatest { (index, fg) ->
                if (!fg && index > 0) delay(graceMs)
                emit(fg)
            }
            .distinctUntilChanged()

    override suspend fun openOn(serverId: ServerId): ServerId? {
        val previous = registry.state.value.activeId
        if (previous == serverId || registry.state.value.byId(serverId) == null) return null
        val session = sessions.activate(serverId) ?: return null
        if (session.auth.value !is AuthState.SignedIn) scope.launch { session.probe() }
        return previous
    }

    companion object {
        /** How long the socket survives in the background (a quick trip to another app keeps it). */
        const val BACKGROUND_GRACE_MS = 30_000L

        /** [start]'s default: tests and previews behave as if the app were always in the foreground. */
        val ALWAYS_FOREGROUND: StateFlow<Boolean> = MutableStateFlow(true).asStateFlow()
    }
}
