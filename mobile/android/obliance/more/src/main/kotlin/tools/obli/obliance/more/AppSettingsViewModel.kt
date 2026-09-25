package tools.obli.obliance.more

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.AuthApi
import tools.obli.obliance.data.ObliServices

/** One server of S83 "Serveurs" (name and host; the tile only from two servers). */
internal data class SettingsServer(
    val id: ServerId,
    val name: String,
    val host: String,
    val color: ServerColor,
    val monogram: String,
    val active: Boolean,
)

internal data class AppSettingsUi(
    val servers: List<SettingsServer> = emptyList(),
    val multiServer: Boolean = false,
    val prefs: AppPrefs = AppPrefs(),
    /** The phone has a screen lock (else the lock switch is disabled and says why). */
    val lockAvailable: Boolean = true,
    val appVersion: String = FALLBACK_APP_VERSION,
    val activeServerName: String? = null,
    /** Obliance version of the active server (GET /health), for the footer. */
    val activeServerVersion: String? = null,
) {
    val serverCount: Int get() = servers.size
    val maxServers: Int get() = ServerRegistry.MAX_SERVERS
    val canAddServer: Boolean get() = serverCount < maxServers

    /** What the lock switch shows: on only when wanted AND possible. */
    val lockOn: Boolean get() = prefs.lockWanted && lockAvailable
}

internal object AppSettingsMapper {
    fun map(registry: ServerRegistryState, prefs: AppPrefs, lockAvailable: Boolean, appVersion: String, versions: Map<ServerId, String>): AppSettingsUi {
        val active = registry.active
        return AppSettingsUi(
            servers = registry.profiles.map {
                SettingsServer(it.id, it.displayName, MoreMapper.hostOf(it.origin), it.color, it.monogram, it.id == registry.activeId)
            },
            multiServer = registry.isMultiServer,
            prefs = prefs,
            lockAvailable = lockAvailable,
            appVersion = appVersion,
            activeServerName = active?.displayName,
            activeServerVersion = active?.let { versions[it.id] },
        )
    }
}

/**
 * Obliance versions of the servers (`GET /health`, public), cached for the
 * process: S83's footer and S86's server lines.
 */
internal object ServerVersions {
    private val cache = ConcurrentHashMap<ServerId, String>()

    fun cached(id: ServerId): String? = cache[id]

    /** Asks [id]'s own session; null when it does not answer (20 s at most). */
    suspend fun fetch(services: ObliServices, id: ServerId): String? {
        val session = services.sessions.session(id) ?: return null
        val out = withTimeoutOrNull(20_000) { AuthApi(session.http).health() }
        val version = (out as? ApiOutcome.Ok)?.value?.version?.trim()?.takeIf { it.isNotEmpty() }
        if (version != null) cache[id] = version
        return version ?: cache[id]
    }
}

/** S83: the registry, the preferences and the active server's version. */
@OptIn(ExperimentalCoroutinesApi::class)
internal class AppSettingsViewModel(
    private val services: ObliServices,
    private val store: AppSettingsStore,
    private val lockAvailable: () -> Boolean,
    appVersion: String,
    private val versionOf: suspend (ServerId) -> String? = { ServerVersions.fetch(services, it) },
) : ViewModel() {
    private val available = MutableStateFlow(lockAvailable())
    private val versions = MutableStateFlow<Map<ServerId, String>>(emptyMap())

    val ui: StateFlow<AppSettingsUi> = combine(services.registry.state, store.prefs, available, versions) { registry, prefs, lock, v ->
        AppSettingsMapper.map(registry, prefs, lock, appVersion, v)
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        AppSettingsMapper.map(services.registry.state.value, store.prefs.value, available.value, appVersion, emptyMap()),
    )

    init {
        viewModelScope.launch {
            services.registry.state.map { it.activeId }.distinctUntilChanged().collect { id ->
                if (id == null) return@collect
                ServerVersions.cached(id)?.let { v -> versions.value = versions.value + (id to v) }
                versionOf(id)?.let { v -> versions.value = versions.value + (id to v) }
            }
        }
    }

    /** After a visit to the Android settings (a screen lock may have been set or removed). */
    fun refreshLockAvailability() {
        available.value = lockAvailable()
    }

    fun setLockEnabled(enabled: Boolean) = launch { store.setLockEnabled(enabled) }
    fun setLockTimeout(timeout: LockTimeout) = launch { store.setLockTimeout(timeout) }
    fun setBlockScreenshots(block: Boolean) = launch { store.setBlockScreenshots(block) }
    fun setThemeMode(mode: ThemeMode) = launch { store.setThemeMode(mode) }
    fun setAutoNight(enabled: Boolean) = launch { store.setAutoNight(enabled) }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }
}
