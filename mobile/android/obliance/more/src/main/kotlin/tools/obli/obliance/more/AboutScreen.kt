package tools.obli.obliance.more

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.obliance.data.LocalObliServices

/**
 * S86 "À propos et mises à jour" (design doc §5 S86, §2.10 "Mise à jour"):
 * app and server versions, the update offered by the signed-in servers,
 * licences and a sanitised diagnostic.
 *
 * @param extraDiagnostics lines the app adds to the diagnostic (notifications
 *   engine state…); they are sanitised too (no URL, host or secret survives).
 */
@Composable
fun AboutScreen(onBack: () -> Unit, extraDiagnostics: () -> List<String> = { emptyList() }) {
    val context = LocalContext.current
    val app = context.applicationContext
    val services = LocalObliServices.current
    val store = remember(app) { AppSettings.store(app) }
    val vm = viewModel {
        AboutViewModel(
            services = services,
            appVersionName = appVersion(app),
            appVersionCode = appVersionCode(app),
            check = { AppUpdates.check(app, services, force = true) },
            lockState = {
                val p = store.prefs.value
                when {
                    !AppLock.canUseLock(app) -> "unavailable (no screen lock)"
                    p.lockWanted -> "on (${p.lockTimeout.name.lowercase()})"
                    p.lockUndecided -> "undecided (S04 step 3 not answered)"
                    else -> "off"
                }
            },
        )
    }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val installRequested by vm.installRequested.collectAsStateWithLifecycle()
    val activity = remember(context) { context.findActivity() }
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<Int?>(null) }
    var copied by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { AppUpdates.resumePending(app) }
    LifecycleResumeEffect(activity) {
        // Back from "install unknown apps": the install continues by itself.
        val job = activity?.let { a ->
            scope.launch {
                when (UpdateInstaller.resumeIfPermitted(a)) {
                    UpdateInstaller.Result.FAILED -> message = R.string.more_update_install_failed
                    UpdateInstaller.Result.STARTED -> message = null
                    else -> Unit
                }
            }
        }
        onPauseOrDispose { job?.cancel() }
    }
    val install: () -> Unit = {
        activity?.let { a ->
            scope.launch {
                message = when (UpdateInstaller.installVerified(a)) {
                    UpdateInstaller.Result.NEEDS_PERMISSION -> R.string.more_update_permission
                    UpdateInstaller.Result.FAILED -> R.string.more_update_install_failed
                    else -> null
                }
            }
        }
    }
    // "Télécharger et installer": once verified, the installer opens without another tap.
    LaunchedEffect(ui.download, installRequested) {
        if (installRequested && ui.download is DownloadState.Ready) {
            vm.installRequested.value = false
            install()
        }
    }
    LaunchedEffect(copied) {
        if (copied) {
            delay(3_000)
            copied = false
        }
    }
    val clipLabel = stringResource(R.string.more_diagnostic_label)
    AboutContent(
        ui = ui,
        message = message,
        copied = copied,
        actions = AboutActions(
            onBack = onBack,
            onCheck = {
                AppUpdates.resetDownloadState()
                vm.checkNow()
            },
            onDownload = { offer ->
                message = null
                vm.installRequested.value = true
                scope.launch { AppUpdates.startDownload(app, services, offer) }
            },
            onInstall = install,
            onCopyDiagnostic = {
                val text = vm.diagnostic(runCatching(extraDiagnostics).getOrDefault(emptyList()))
                val cm = app.getSystemService(ClipboardManager::class.java)
                val clip = ClipData.newPlainText(clipLabel, text)
                // Versions only, but still kept out of the clipboard preview and keyboard suggestions.
                if (Build.VERSION.SDK_INT >= 33) {
                    clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
                }
                runCatching { cm?.setPrimaryClip(clip) }
                // Android 13+ confirms a copy itself.
                if (Build.VERSION.SDK_INT < 33) copied = true
            },
        ),
    )
}

internal data class AboutActions(
    val onBack: () -> Unit = {},
    val onCheck: () -> Unit = {},
    val onDownload: (UpdateOffer) -> Unit = {},
    val onInstall: () -> Unit = {},
    val onCopyDiagnostic: () -> Unit = {},
)

@Composable
internal fun AboutContent(ui: AboutUi, actions: AboutActions, message: Int? = null, copied: Boolean = false) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliDetailTopBar(title = stringResource(R.string.more_about_title), onBack = actions.onBack, backLabel = stringResource(R.string.more_back))
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
            ) {
                AppCard(ui)

                SectionTitle(stringResource(R.string.more_about_section_servers))
                ListGroup {
                    ui.servers.forEach { s ->
                        val value = when (val v = s.version) {
                            ServerVersion.Checking -> stringResource(R.string.more_about_server_checking)
                            is ServerVersion.Known -> stringResource(R.string.more_about_server_version, v.version)
                            ServerVersion.Unknown -> stringResource(R.string.more_about_server_unknown)
                        }
                        NavRow(
                            icon = if (ui.multiServer) null else ObliIcons.Server,
                            title = s.name,
                            value = value,
                            onClick = null,
                            monoValue = s.version is ServerVersion.Known,
                            leading = if (ui.multiServer) {
                                { Box(Modifier.clearAndSetSemantics { }) { ObliServerTile(s.color, s.monogram, s.name, size = 28.dp) } }
                            } else {
                                null
                            },
                        )
                    }
                }

                SectionTitle(stringResource(R.string.more_about_section_update))
                UpdateCard(ui, actions, message)

                SectionTitle(stringResource(R.string.more_about_section_licences))
                ListGroup {
                    LicenceRow(stringResource(R.string.more_licence_fonts), stringResource(R.string.more_licence_ofl))
                    LicenceRow(stringResource(R.string.more_licence_termlib), stringResource(R.string.more_licence_apache))
                    LicenceRow(stringResource(R.string.more_licence_libvterm), stringResource(R.string.more_licence_mit))
                    LicenceRow(stringResource(R.string.more_licence_okhttp), stringResource(R.string.more_licence_apache))
                    LicenceRow(stringResource(R.string.more_licence_socketio), stringResource(R.string.more_licence_mit))
                    LicenceRow(stringResource(R.string.more_licence_androidx), stringResource(R.string.more_licence_apache))
                }

                SectionTitle(stringResource(R.string.more_about_section_diagnostic))
                ListGroup {
                    NavRow(MoreIcons.Copy, stringResource(R.string.more_diagnostic_copy), stringResource(R.string.more_diagnostic_subtitle), actions.onCopyDiagnostic, chevron = false)
                }
                if (copied) {
                    Text(
                        stringResource(R.string.more_diagnostic_copied),
                        style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal),
                        color = c.text2,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }
        }
    }
}

/** App card: Ance mark, "Obliance pour Android", "0.3.1-alpha (4)". */
@Composable
private fun AppCard(ui: AboutUi) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Image(painterResource(R.drawable.more_ic_mark), contentDescription = null, modifier = Modifier.size(40.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(R.string.more_about_app_name), style = ObliTypography.cardTitle, color = c.text)
            Text(stringResource(R.string.more_about_version, ui.appVersionName, ui.appVersionCode), style = ObliTypography.monoCaption, color = c.textMuted)
        }
    }
}

@Composable
private fun UpdateCard(ui: AboutUi, actions: AboutActions, message: Int?) {
    val c = ObliTheme.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1).padding(16.dp)
            .semantics(mergeDescendants = false) { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val download = ui.download
        when (val p = ui.update) {
            UpdatePanel.Checking -> StatusLine(null, stringResource(R.string.more_update_checking), busy = true)
            UpdatePanel.UpToDate -> StatusLine(ObliIcons.CircleCheck, stringResource(R.string.more_update_up_to_date), tint = ObliTokens.Status.ONLINE.argb.toColor())
            UpdatePanel.NothingPublished -> StatusLine(ObliIcons.Info, stringResource(R.string.more_update_nothing))
            UpdatePanel.NoServer -> StatusLine(ObliIcons.Info, stringResource(R.string.more_update_no_server))
            UpdatePanel.Failed -> StatusLine(ObliIcons.TriangleAlert, stringResource(R.string.more_update_failed), tint = ObliTokens.Status.WARNING.argb.toColor())
            is UpdatePanel.Offer -> OfferBlock(p.offer, download, actions)
        }
        when (download) {
            is DownloadState.Downloading -> StatusLine(null, stringResource(R.string.more_update_downloading, download.versionName), busy = true)
            is DownloadState.Verifying -> StatusLine(null, stringResource(R.string.more_update_verifying), busy = true)
            is DownloadState.Ready -> {
                StatusLine(ObliIcons.CircleCheck, stringResource(R.string.more_update_ready, download.versionName), tint = ObliTokens.Status.ONLINE.argb.toColor())
                KitButton(stringResource(R.string.more_update_install_now), actions.onInstall, modifier = Modifier.fillMaxWidth(), icon = MoreIcons.Download)
            }
            is DownloadState.Failed -> StatusLine(ObliIcons.TriangleAlert, stringResource(problemText(download.problem)), tint = ObliTokens.Status.WARNING.argb.toColor())
            DownloadState.Idle -> Unit
        }
        if (message != null) StatusLine(ObliIcons.Info, stringResource(message))
        val busy = ui.update == UpdatePanel.Checking || download is DownloadState.Downloading || download is DownloadState.Verifying
        KitButton(
            stringResource(R.string.more_update_check),
            actions.onCheck,
            modifier = Modifier.fillMaxWidth(),
            primary = false,
            enabled = !busy,
            icon = ObliIcons.RefreshCw,
        )
    }
}

@Composable
private fun OfferBlock(offer: UpdateOffer, download: DownloadState, actions: AboutActions) {
    val c = ObliTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(8.dp).clip(RoundedCornerShape(4.dp)).background(ObliTokens.UNREAD.toColor()))
            Text(stringResource(R.string.more_update_offer, offer.versionName, offer.serverName), style = ObliTypography.rowTitle, color = c.text)
        }
        if (offer.required) Text(stringResource(R.string.more_update_required, offer.serverName), style = ObliTypography.body, color = c.text2)
        offer.releaseNotes?.let { notes ->
            Text(stringResource(R.string.more_update_notes).uppercase(), style = ObliTypography.overline, color = c.textMuted)
            Text(notes, style = ObliTypography.body, color = c.text2, maxLines = 12)
        }
        val inFlight = download is DownloadState.Downloading || download is DownloadState.Verifying || download is DownloadState.Ready
        if (!inFlight) {
            KitButton(stringResource(R.string.more_update_install), { actions.onDownload(offer) }, modifier = Modifier.fillMaxWidth(), icon = MoreIcons.Download)
        }
    }
}

@Composable
private fun StatusLine(icon: ImageVector?, text: String, tint: androidx.compose.ui.graphics.Color? = null, busy: Boolean = false) {
    val c = ObliTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
            busy -> CircularProgressIndicator(Modifier.size(18.dp), color = c.text2, strokeWidth = 2.dp, trackColor = c.hover)
            icon != null -> Icon(icon, contentDescription = null, tint = tint ?: c.text2, modifier = Modifier.size(18.dp))
        }
        Text(text, style = ObliTypography.body, color = c.text, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun LicenceRow(component: String, licence: String) {
    NavRow(MoreIcons.FileText, component, licence, onClick = null, modifier = Modifier.semantics(mergeDescendants = true) { })
}

private fun problemText(problem: DownloadProblem): Int = when (problem) {
    DownloadProblem.REFUSED_URL -> R.string.more_update_problem_refused
    DownloadProblem.NOT_STARTED -> R.string.more_update_problem_not_started
    DownloadProblem.DOWNLOAD_FAILED -> R.string.more_update_problem_failed
    DownloadProblem.INTEGRITY -> R.string.more_update_problem_integrity
    DownloadProblem.NOT_NEWER -> R.string.more_update_problem_not_newer
}
