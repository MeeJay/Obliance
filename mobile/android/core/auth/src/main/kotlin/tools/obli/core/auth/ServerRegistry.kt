package tools.obli.core.auth

import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import tools.obli.core.model.Monogram
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.shell.nav.Origins
import tools.obli.shell.net.ServerUrl

/** Snapshot of the registry: profiles in user order and the active one. */
@Serializable
data class ServerRegistryState(
    val profiles: List<ServerProfile> = emptyList(),
    val activeId: ServerId? = null,
    val version: Int = 1,
) {
    val active: ServerProfile? get() = profiles.firstOrNull { it.id == activeId }
    val isMultiServer: Boolean get() = profiles.size >= 2

    fun byId(id: ServerId): ServerProfile? = profiles.firstOrNull { it.id == id }

    /** Profile whose origin is the origin of [url], if any (links, App Links). */
    fun byUrl(url: String?): ServerProfile? {
        val origin = Origins.of(url) ?: return null
        return profiles.firstOrNull { it.origin == origin }
    }
}

/** Where the registry is persisted (DataStore on Android, memory in tests). */
interface ServerRegistryStore {
    suspend fun load(): ServerRegistryState?
    suspend fun save(state: ServerRegistryState)
}

/** Told when a server disappears, so each layer purges what it keeps for it
 *  (cookies of its origin, caches, snapshots, channel group, shortcuts). */
fun interface ServerRemovalListener {
    suspend fun onServerRemoved(profile: ServerProfile)
}

sealed interface AddServerResult {
    data class Added(val profile: ServerProfile) : AddServerResult
    data class Invalid(val problem: ServerUrl.Problem) : AddServerResult
    data class AlreadyConfigured(val existing: ServerProfile) : AddServerResult
    data object LimitReached : AddServerResult
}

sealed interface RemoveServerResult {
    data class Removed(val newActive: ServerProfile?) : RemoveServerResult
    data object LastServer : RemoveServerResult
    data object NotFound : RemoveServerResult
}

/**
 * The server registry of the platform (design doc §2.10, §10.3): 1..[MAX_SERVERS]
 * server profiles with unique origins, one active. App-agnostic: it holds no
 * Obliance type, so every Obli app gets multi-server support from the platform.
 *
 * All mutations are serialised and persisted before [state] is updated.
 */
class ServerRegistry(
    private val store: ServerRegistryStore,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val mutex = Mutex()
    private val _state = MutableStateFlow(ServerRegistryState())
    val state: StateFlow<ServerRegistryState> = _state.asStateFlow()
    private val removalListeners = mutableListOf<ServerRemovalListener>()

    fun addRemovalListener(listener: ServerRemovalListener) {
        synchronized(removalListeners) { removalListeners += listener }
    }

    /** Loads the persisted registry; when nothing is stored yet and [legacyServerUrl]
     *  (the single server of the WebView shell) is valid, it becomes the first profile. */
    suspend fun load(legacyServerUrl: String? = null): ServerRegistryState = mutex.withLock {
        val stored = store.load()?.let(::sanitize)
        val state = when {
            stored != null && stored.profiles.isNotEmpty() -> stored
            legacyServerUrl != null -> {
                val origin = (ServerUrl.normalize(legacyServerUrl) as? ServerUrl.Result.Ok)?.url
                if (origin == null) ServerRegistryState() else {
                    val profile = newProfile(origin, null, null, emptyList())
                    ServerRegistryState(listOf(profile), profile.id).also { store.save(it) }
                }
            }
            else -> ServerRegistryState()
        }
        _state.value = state
        state
    }

    suspend fun add(address: String, displayName: String? = null, color: ServerColor? = null): AddServerResult =
        mutex.withLock {
            val current = _state.value
            val origin = when (val r = ServerUrl.normalize(address)) {
                is ServerUrl.Result.Ok -> r.url
                is ServerUrl.Result.Invalid -> return AddServerResult.Invalid(r.problem)
            }
            current.profiles.firstOrNull { it.origin == origin }?.let { return AddServerResult.AlreadyConfigured(it) }
            if (current.profiles.size >= MAX_SERVERS) return AddServerResult.LimitReached
            val profile = newProfile(origin, displayName, color, current.profiles)
            commit(current.copy(profiles = current.profiles + profile, activeId = current.activeId ?: profile.id))
            AddServerResult.Added(profile)
        }

    suspend fun remove(id: ServerId): RemoveServerResult {
        val removed: ServerProfile
        val next: ServerRegistryState
        mutex.withLock {
            val current = _state.value
            removed = current.byId(id) ?: return RemoveServerResult.NotFound
            if (current.profiles.size == 1) return RemoveServerResult.LastServer
            val rest = renumber(current.profiles.filter { it.id != id })
            val active = if (current.activeId == id) rest.first().id else current.activeId
            next = current.copy(profiles = rest, activeId = active)
            commit(next)
        }
        // Outside the lock: listeners may read the registry.
        val listeners = synchronized(removalListeners) { removalListeners.toList() }
        listeners.forEach { it.onServerRemoved(removed) }
        return RemoveServerResult.Removed(next.active)
    }

    /** Makes [id] the active server; false when it does not exist. */
    suspend fun activate(id: ServerId): Boolean = update(id) { state, _ -> state.copy(activeId = id) }

    suspend fun rename(id: ServerId, displayName: String): Boolean {
        val name = cleanName(displayName) ?: return false
        return updateProfile(id) { it.copy(displayName = name, monogram = Monogram.of(name)) }
    }

    suspend fun recolor(id: ServerId, color: ServerColor): Boolean = updateProfile(id) { it.copy(color = color) }

    suspend fun setNotify(id: ServerId, scope: NotifyScope): Boolean = updateProfile(id) { it.copy(notify = scope) }

    suspend fun setIncludeInTriage(id: ServerId, include: Boolean): Boolean =
        updateProfile(id) { it.copy(includeInTriage = include) }

    suspend fun setLastTenant(id: ServerId, tenantId: Long?): Boolean = updateProfile(id) { it.copy(lastTenantId = tenantId) }

    /** New order of the profiles (drives Alt+1..8 and the chip order); [ids] must be a permutation. */
    suspend fun reorder(ids: List<ServerId>): Boolean = mutex.withLock {
        val current = _state.value
        if (ids.size != current.profiles.size || ids.toSet() != current.profiles.map { it.id }.toSet()) return false
        val byId = current.profiles.associateBy { it.id }
        commit(current.copy(profiles = renumber(ids.map { byId.getValue(it) })))
        true
    }

    private suspend fun updateProfile(id: ServerId, change: (ServerProfile) -> ServerProfile): Boolean =
        update(id) { state, profile -> state.copy(profiles = state.profiles.map { if (it.id == id) change(profile) else it }) }

    private suspend fun update(id: ServerId, change: (ServerRegistryState, ServerProfile) -> ServerRegistryState): Boolean =
        mutex.withLock {
            val current = _state.value
            val profile = current.byId(id) ?: return false
            val next = change(current, profile)
            if (next != current) commit(next)
            true
        }

    private suspend fun commit(next: ServerRegistryState) {
        store.save(next)
        _state.value = next
    }

    private fun newProfile(origin: String, displayName: String?, color: ServerColor?, existing: List<ServerProfile>): ServerProfile {
        val name = displayName?.let(::cleanName) ?: Origins.host(origin) ?: origin
        return ServerProfile(
            id = ServerId(newId()),
            origin = origin,
            displayName = name,
            color = color ?: nextColor(existing),
            monogram = Monogram.of(name),
            order = existing.size,
        )
    }

    companion object {
        const val MAX_SERVERS = 8
        const val MAX_NAME = 40

        /** First palette colour not used yet, in palette order; cycles when all are taken. */
        fun nextColor(existing: List<ServerProfile>): ServerColor {
            val used = existing.map { it.color }.toSet()
            return ServerColor.entries.firstOrNull { it !in used } ?: ServerColor.entries[existing.size % ServerColor.entries.size]
        }

        private fun cleanName(raw: String): String? =
            raw.trim().replace(Regex("\\s+"), " ").take(MAX_NAME).takeIf { it.isNotEmpty() }

        private fun renumber(list: List<ServerProfile>) = list.mapIndexed { i, p -> if (p.order == i) p else p.copy(order = i) }

        /** Drops what a corrupted or hand-edited store could contain: duplicate ids or
         *  origins, invalid origins, more than MAX_SERVERS, an unknown active id. */
        internal fun sanitize(state: ServerRegistryState): ServerRegistryState {
            val seenIds = HashSet<ServerId>()
            val seenOrigins = HashSet<String>()
            val profiles = state.profiles
                .sortedBy { it.order }
                .filter { p ->
                    val origin = (ServerUrl.normalize(p.origin) as? ServerUrl.Result.Ok)?.url
                    origin == p.origin && seenIds.add(p.id) && seenOrigins.add(p.origin)
                }
                .take(MAX_SERVERS)
                .let(::renumber)
            val active = state.activeId?.takeIf { id -> profiles.any { it.id == id } } ?: profiles.firstOrNull()?.id
            return ServerRegistryState(profiles, active)
        }
    }
}
