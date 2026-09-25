package tools.obli.obliance.more

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.obliance.data.LocalObliServices

/**
 * S83 "Réglages de l'application" (design doc §5 S83, mockup AppSettings.dc.html):
 * preferences of THIS phone. Only what 0.3.0 implements is shown (no dead switch).
 */
@Composable
fun AppSettingsScreen(
    onBack: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenServers: () -> Unit,
    onAddServer: () -> Unit,
    onOpenAbout: () -> Unit,
    notificationsSummary: String? = null,
) {
    val context = LocalContext.current
    val app = context.applicationContext
    val services = LocalObliServices.current
    val store = remember(app) { AppSettings.store(app) }
    val vm = viewModel { AppSettingsViewModel(services, store, { AppLock.canUseLock(app) }, appVersion(app)) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    LifecycleResumeEffect(vm) {
        vm.refreshLockAvailability()
        AppLock.refreshAvailability()
        onPauseOrDispose { }
    }
    val activity = remember(context) { context.findFragmentActivity() }
    val scope = rememberCoroutineScope()
    val confirmTitle = stringResource(R.string.more_settings_lock_confirm_title)
    val actions = AppSettingsActions(
        onBack = onBack,
        onOpenNotifications = onOpenNotifications,
        onOpenServers = onOpenServers,
        onAddServer = onAddServer,
        onOpenAbout = onOpenAbout,
        onLockChange = { on ->
            // Turning the lock on proves once that this phone can unlock it.
            if (on && activity != null) {
                scope.launch { if (AppLock.authenticate(activity, confirmTitle, null)) vm.setLockEnabled(true) }
            } else {
                vm.setLockEnabled(on)
            }
        },
        onLockTimeout = vm::setLockTimeout,
        onBlockScreenshots = vm::setBlockScreenshots,
        onThemeMode = vm::setThemeMode,
        onAutoNight = vm::setAutoNight,
    )
    AppSettingsContent(ui, notificationsSummary, actions)
}

internal data class AppSettingsActions(
    val onBack: () -> Unit = {},
    val onOpenNotifications: () -> Unit = {},
    val onOpenServers: () -> Unit = {},
    val onAddServer: () -> Unit = {},
    val onOpenAbout: () -> Unit = {},
    val onLockChange: (Boolean) -> Unit = {},
    val onLockTimeout: (LockTimeout) -> Unit = {},
    val onBlockScreenshots: (Boolean) -> Unit = {},
    val onThemeMode: (ThemeMode) -> Unit = {},
    val onAutoNight: (Boolean) -> Unit = {},
)

@Composable
internal fun AppSettingsContent(ui: AppSettingsUi, notificationsSummary: String?, actions: AppSettingsActions) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliDetailTopBar(
            title = stringResource(R.string.more_settings_title),
            onBack = actions.onBack,
            backLabel = stringResource(R.string.more_back),
            subtitle = stringResource(R.string.more_settings_subtitle),
        )
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
            ) {
                ListGroup {
                    NavRow(
                        MoreIcons.Bell,
                        stringResource(R.string.more_notifications),
                        notificationsSummary ?: stringResource(R.string.more_notifications_value),
                        actions.onOpenNotifications,
                    )
                }

                SectionTitle(stringResource(R.string.more_settings_section_servers))
                ListGroup {
                    ui.servers.forEach { ServerRow(it, ui.multiServer, actions.onOpenServers) }
                    NavRow(
                        ObliIcons.Plus,
                        stringResource(R.string.more_settings_add_server),
                        stringResource(R.string.more_settings_add_server_value, ui.serverCount, ui.maxServers),
                        onClick = if (ui.canAddServer) actions.onAddServer else null,
                        reason = if (ui.canAddServer) null else stringResource(R.string.more_settings_add_server_limit),
                    )
                }

                SectionTitle(stringResource(R.string.more_settings_section_security))
                ListGroup {
                    SwitchRow(
                        MoreIcons.Fingerprint,
                        stringResource(R.string.more_settings_lock),
                        lockSubtitle(ui.prefs.lockTimeout),
                        checked = ui.lockOn,
                        onCheckedChange = actions.onLockChange,
                        enabled = ui.lockAvailable,
                        reason = if (ui.lockAvailable) null else stringResource(R.string.more_settings_lock_unavailable),
                    )
                    SegmentedRow(
                        ObliIcons.Clock,
                        stringResource(R.string.more_settings_lock_after),
                        stringResource(R.string.more_settings_lock_after_subtitle),
                        options = listOf(
                            LockTimeout.IMMEDIATE to stringResource(R.string.more_lock_timeout_immediate),
                            LockTimeout.ONE_MIN to stringResource(R.string.more_lock_timeout_1),
                            LockTimeout.FIVE_MIN to stringResource(R.string.more_lock_timeout_5),
                            LockTimeout.FIFTEEN_MIN to stringResource(R.string.more_lock_timeout_15),
                        ),
                        selected = ui.prefs.lockTimeout,
                        onSelect = actions.onLockTimeout,
                        enabled = ui.lockOn,
                        mono = true,
                        reason = if (ui.lockOn || !ui.lockAvailable) null else stringResource(R.string.more_settings_lock_after_off),
                    )
                    SwitchRow(
                        MoreIcons.Smartphone,
                        stringResource(R.string.more_settings_screenshots),
                        stringResource(R.string.more_settings_screenshots_subtitle),
                        checked = ui.prefs.blockScreenshots,
                        onCheckedChange = actions.onBlockScreenshots,
                    )
                }

                SectionTitle(stringResource(R.string.more_settings_section_appearance))
                ListGroup {
                    SegmentedRow(
                        MoreIcons.Sun,
                        stringResource(R.string.more_settings_theme),
                        stringResource(R.string.more_settings_theme_subtitle),
                        options = listOf(
                            ThemeMode.FOLLOW_SERVER to stringResource(R.string.more_theme_server),
                            ThemeMode.OPERATOR to stringResource(R.string.more_theme_operator),
                            ThemeMode.NIGHT to stringResource(R.string.more_theme_night),
                        ),
                        selected = ui.prefs.themeMode,
                        onSelect = actions.onThemeMode,
                        helper = stringResource(R.string.more_settings_theme_helper),
                    )
                    SwitchRow(
                        MoreIcons.Moon,
                        stringResource(R.string.more_settings_auto_night),
                        stringResource(R.string.more_settings_auto_night_subtitle),
                        checked = ui.prefs.autoNight,
                        onCheckedChange = actions.onAutoNight,
                    )
                }

                SectionTitle(stringResource(R.string.more_section_about))
                ListGroup {
                    NavRow(ObliIcons.Info, stringResource(R.string.more_about), ui.appVersion, actions.onOpenAbout, monoValue = true)
                }

                val footer = if (ui.activeServerName != null) {
                    stringResource(R.string.more_settings_footer_server, ui.appVersion, ui.activeServerName, ui.activeServerVersion.orEmpty()).trimEnd()
                } else {
                    stringResource(R.string.more_settings_footer, ui.appVersion)
                }
                Text(
                    footer,
                    style = ObliTypography.monoCaption,
                    color = c.textMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 20.dp),
                )
            }
        }
    }
}

@Composable
private fun lockSubtitle(timeout: LockTimeout): String = when (timeout) {
    LockTimeout.IMMEDIATE -> stringResource(R.string.more_settings_lock_subtitle_immediate)
    LockTimeout.ONE_MIN -> stringResource(R.string.more_settings_lock_subtitle_delay, stringResource(R.string.more_lock_timeout_1))
    LockTimeout.FIVE_MIN -> stringResource(R.string.more_settings_lock_subtitle_delay, stringResource(R.string.more_lock_timeout_5))
    LockTimeout.FIFTEEN_MIN -> stringResource(R.string.more_settings_lock_subtitle_delay, stringResource(R.string.more_lock_timeout_15))
}

/** One server: 28 dp tile (two servers or more), name, "ACTIF", host in mono; opens S92. */
@Composable
private fun ServerRow(server: SettingsServer, multiServer: Boolean, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val a11y = if (server.active && multiServer) {
        stringResource(R.string.more_settings_server_active_a11y, server.name, server.host)
    } else {
        stringResource(R.string.more_settings_server_a11y, server.name, server.host)
    }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button, onClick = onClick)
            .padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(
            Modifier.weight(1f).clearAndSetSemantics { contentDescription = a11y },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (multiServer) {
                Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                    ObliServerTile(server.color, server.monogram, server.name, size = 28.dp)
                }
            } else {
                IconTile(ObliIcons.Server)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(server.name, style = rowLabel, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (server.active && multiServer) Tag(stringResource(R.string.more_settings_active_tag))
                }
                Text(server.host, style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(20.dp))
    }
}
