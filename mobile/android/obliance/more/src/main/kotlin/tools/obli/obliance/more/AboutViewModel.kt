package tools.obli.obliance.more

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.data.ObliServices

/** Obliance version of one server, as S86 shows it. */
internal sealed interface ServerVersion {
    data object Checking : ServerVersion
    data class Known(val version: String) : ServerVersion
    data object Unknown : ServerVersion
}

internal data class AboutServer(
    val id: ServerId,
    val name: String,
    val color: ServerColor,
    val monogram: String,
    val version: ServerVersion,
)

/** The update block of S86. */
internal sealed interface UpdatePanel {
    data object Checking : UpdatePanel
    data object UpToDate : UpdatePanel
    data class Offer(val offer: UpdateOffer) : UpdatePanel
    data object NothingPublished : UpdatePanel
    data object NoServer : UpdatePanel
    data object Failed : UpdatePanel
}

internal data class AboutUi(
    val appVersionName: String = FALLBACK_APP_VERSION,
    val appVersionCode: Int = FALLBACK_APP_VERSION_CODE,
    val multiServer: Boolean = false,
    val servers: List<AboutServer> = emptyList(),
    val update: UpdatePanel = UpdatePanel.Checking,
    val download: DownloadState = DownloadState.Idle,
)

internal object AboutMapper {
    fun panel(checking: Boolean, last: UpdateCheck?, offer: UpdateOffer?): UpdatePanel = when {
        checking -> UpdatePanel.Checking
        last is UpdateCheck.Available -> UpdatePanel.Offer(last.offer)
        // A failed or skipped check keeps a known offer.
        offer != null && (last == null || last is UpdateCheck.Failed || last == UpdateCheck.Skipped) -> UpdatePanel.Offer(offer)
        last == UpdateCheck.UpToDate -> UpdatePanel.UpToDate
        last == UpdateCheck.NothingPublished -> UpdatePanel.NothingPublished
        last == UpdateCheck.NoServer -> UpdatePanel.NoServer
        last is UpdateCheck.Failed -> UpdatePanel.Failed
        else -> UpdatePanel.Checking
    }

    fun servers(registry: ServerRegistryState, versions: Map<ServerId, ServerVersion>): List<AboutServer> =
        registry.profiles.map { AboutServer(it.id, it.displayName, it.color, it.monogram, versions[it.id] ?: ServerVersion.Checking) }

    fun authLabel(state: AuthState?): String = when (state) {
        is AuthState.SignedIn -> "signed in"
        AuthState.Expired -> "session expired"
        is AuthState.Unreachable -> "unreachable"
        AuthState.SignedOut -> "signed out"
        AuthState.Unknown, null -> "not checked yet"
    }

    fun socketLabel(state: ConnectionState?): String? = state?.name?.lowercase()?.replace('_', ' ')
}

/**
 * S86: app and server versions, the update offer ([AppUpdates]) and the
 * diagnostic. [check] runs a forced update check (tests pass a fake).
 */
internal class AboutViewModel(
    private val services: ObliServices,
    private val appVersionName: String,
    private val appVersionCode: Int,
    private val check: suspend () -> UpdateCheck,
    private val versionOf: suspend (ServerId) -> String? = { ServerVersions.fetch(services, it) },
    private val lockState: () -> String? = { null },
    checking: StateFlow<Boolean> = AppUpdates.checking,
    lastCheck: StateFlow<UpdateCheck?> = AppUpdates.lastCheck,
    offer: StateFlow<UpdateOffer?> = AppUpdates.offer,
    download: StateFlow<DownloadState> = AppUpdates.download,
    private val lastCheckAt: () -> Long = { AppUpdates.lastCheckAtMs },
    private val now: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val versions = MutableStateFlow<Map<ServerId, ServerVersion>>(emptyMap())

    /** Set by "Télécharger et installer": the installer opens by itself once the APK is verified. */
    val installRequested = MutableStateFlow(false)

    private val panel = combine(checking, lastCheck, offer) { c, l, o -> AboutMapper.panel(c, l, o) }

    val ui: StateFlow<AboutUi> = combine(services.registry.state, versions, panel, download) { registry, v, p, d ->
        AboutUi(appVersionName, appVersionCode, registry.isMultiServer, AboutMapper.servers(registry, v), p, d)
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        AboutUi(
            appVersionName, appVersionCode, services.registry.state.value.isMultiServer,
            AboutMapper.servers(services.registry.state.value, emptyMap()),
            AboutMapper.panel(checking.value, lastCheck.value, offer.value), download.value,
        ),
    )

    init {
        loadVersions()
        // A fresh answer when S86 opens, unless one is less than 10 minutes old.
        val last = lastCheck.value
        if (last == null || last == UpdateCheck.Skipped || now() - lastCheckAt() > RECHECK_AFTER_MS) checkNow()
    }

    fun checkNow() {
        viewModelScope.launch { runCatching { check() } }
    }

    private fun loadVersions() {
        val ids = services.registry.state.value.profiles.map { it.id }
        versions.value = ids.associateWith { id -> ServerVersions.cached(id)?.let { ServerVersion.Known(it) } ?: ServerVersion.Checking }
        viewModelScope.launch {
            ids.map { id ->
                async {
                    val v = runCatching { versionOf(id) }.getOrNull()
                    versions.value = versions.value + (id to (v?.let { ServerVersion.Known(it) } ?: ServerVersion.Unknown))
                }
            }.awaitAll()
        }
    }

    /** "Copier le diagnostic": versions and states only, sanitised by [DiagnosticReport]. */
    fun diagnostic(extra: List<String>): String {
        val registry = services.registry.state.value
        val v = versions.value
        val activeSession = services.sessions.active.value
        return DiagnosticReport.build(
            DiagnosticInput(
                appVersionName = appVersionName,
                appVersionCode = appVersionCode,
                androidRelease = Build.VERSION.RELEASE ?: "?",
                sdkInt = Build.VERSION.SDK_INT,
                deviceModel = listOfNotNull(Build.MANUFACTURER, Build.MODEL).joinToString(" ").ifBlank { "?" },
                servers = registry.profiles.map { p ->
                    DiagnosticServer(
                        displayName = p.displayName,
                        origin = p.origin,
                        oblianceVersion = (v[p.id] as? ServerVersion.Known)?.version,
                        auth = AboutMapper.authLabel(services.sessions.session(p.id)?.auth?.value),
                        active = p.id == registry.activeId,
                    )
                },
                socketState = activeSession?.let { runCatching { AboutMapper.socketLabel(it.realtime.state.value) }.getOrNull() },
                lockState = lockState(),
                extra = extra,
            ),
        )
    }

    private companion object {
        const val RECHECK_AFTER_MS = 10 * 60 * 1000L
    }
}
