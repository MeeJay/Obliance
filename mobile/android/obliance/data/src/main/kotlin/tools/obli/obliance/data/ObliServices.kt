package tools.obli.obliance.data

import androidx.compose.runtime.staticCompositionLocalOf
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId

/**
 * Everything a screen of the native Obliance app may use (see
 * obliance/CONTRACT.md). Provided once by :obliance:app through
 * [LocalObliServices]; screen modules read `LocalObliServices.current` and
 * never build their own clients.
 *
 * Multi-server rule (design doc §2.10): an item always travels with the
 * [ServerId] of the server it came from, and every call about it goes through
 * THAT server's session (`sessions.session(serverId)`), never the active one.
 */
interface ObliServices {
    /** The configured servers (1..8), their order, colours and the active one. */
    val registry: ServerRegistry

    /** One session per server (HTTP bound to its origin, auth state, realtime); ONE socket, the active server's. */
    val sessions: ServerSessions

    val auth: AuthRepository
    val tenants: TenantsRepository
    val alerts: AlertsRepository
    val devices: DevicesRepository

    /**
     * Implicit server switch (design doc §2.10 "Bascule implicite"): makes
     * [serverId] the active server when it is not already, so its screens
     * (device detail…) can open. Returns the PREVIOUSLY active server id when a
     * switch happened (for the 5 s "Revenir" action), or null when [serverId]
     * already was the active server or is unknown.
     */
    suspend fun openOn(serverId: ServerId): ServerId?
}

/** Provided by :obliance:app at the root; screenshot tests provide [tools.obli.obliance.data.sample.SampleObliServices]. */
val LocalObliServices = staticCompositionLocalOf<ObliServices> {
    error("LocalObliServices is not provided: wrap the screen in CompositionLocalProvider(LocalObliServices provides ...)")
}
