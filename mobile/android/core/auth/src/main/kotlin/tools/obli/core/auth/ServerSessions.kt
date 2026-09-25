package tools.obli.core.auth

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile

/**
 * The live sessions of the configured servers (design doc §2.10, §10.3).
 * One session per profile, created on first use; ONE real-time connection,
 * the active server's: [activate] closes the previous server's socket and
 * opens the new one. Removed servers lose their session.
 */
class ServerSessions(
    private val registry: ServerRegistry,
    /** Builds the session of a profile; the profile passed is the one at creation time. */
    private val factory: (ServerProfile, () -> ServerProfile) -> ServerSession,
    scope: CoroutineScope,
) {
    private val sessions = LinkedHashMap<ServerId, ServerSession>()

    init {
        registry.addRemovalListener { profile -> drop(profile.id) }
    }

    /** Session of the active server, following the registry. */
    val active: StateFlow<ServerSession?> = registry.state
        .map { s -> s.active?.let(::sessionFor) }
        .stateIn(scope, SharingStarted.Eagerly, registry.state.value.active?.let(::sessionFor))

    fun session(id: ServerId): ServerSession? = registry.state.value.byId(id)?.let(::sessionFor)

    /** Sessions of every configured server, in user order (triage, notifications). */
    fun all(): List<ServerSession> = registry.state.value.profiles.map(::sessionFor)

    /**
     * Makes [id] active: the old server's socket closes, the new one connects.
     * The caller then probes the new session and reloads the current screen.
     */
    suspend fun activate(id: ServerId): ServerSession? {
        val previous = registry.state.value.active?.id
        if (!registry.activate(id)) return null
        val next = sessionFor(registry.state.value.byId(id)!!)
        if (previous != null && previous != id) synchronized(sessions) { sessions[previous] }?.realtime?.disconnect()
        // A signed-out server has no cookie: its handshake could only be refused.
        if (next.auth.value != AuthState.SignedOut) next.realtime.connect()
        return next
    }

    private fun sessionFor(profile: ServerProfile): ServerSession = synchronized(sessions) {
        // Keyed by id: renaming or recolouring a server keeps its session, its
        // auth state and its socket (the origin of a profile never changes).
        sessions.getOrPut(profile.id) {
            val id = profile.id
            factory(profile) { registry.state.value.byId(id) ?: profile }
        }
    }

    private fun drop(id: ServerId) {
        synchronized(sessions) { sessions.remove(id) }?.let { runCatching { it.realtime.disconnect() } }
    }
}
