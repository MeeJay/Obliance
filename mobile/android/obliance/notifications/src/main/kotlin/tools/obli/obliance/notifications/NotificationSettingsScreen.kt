package tools.obli.obliance.notifications

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerId
import tools.obli.obliance.data.LocalObliServices

/**
 * S84 « Notifications et astreinte » (design doc §5 S84, §9): delivery per
 * server, on-call schedule and rules, per-server scope and tenants, the
 * active server's channels as Android reports them, and a diagnostic.
 */
@Composable
fun NotificationSettingsScreen(onBack: () -> Unit, onOpenServers: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext
    val services = LocalObliServices.current
    val store = remember { ObliNotifications.runtime?.store ?: InMemoryNotificationStore() }
    val vm = viewModel { NotificationSettingsViewModel(services, store, AndroidEnvironment(app), AndroidSettingsEffects(app)) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    LifecycleResumeEffect(vm) {
        vm.refreshEnvironment()
        onPauseOrDispose { }
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        vm.refreshEnvironment()
        if (granted) {
            ObliNotifications.sync(app)
        } else {
            // Android no longer shows its dialog: its settings page is the only way left.
            val activity = context.findActivity()
            if (activity != null && !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.POST_NOTIFICATIONS)) {
                SystemSettings.appNotifications(context)
            }
        }
    }
    var picking by rememberSaveable { mutableStateOf<String?>(null) }
    val actions = SettingsActions(
        onBack = onBack,
        onOpenServers = onOpenServers,
        onAllowNotifications = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !AndroidNotificationPublisher.permissionGranted(context)) {
                CoroutineScope(Dispatchers.Default).launch { store.update { it.copy(permissionAsked = true) } }
                launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                SystemSettings.appNotifications(context)
            }
        },
        onAllowBattery = { SystemSettings.ignoreBatteryOptimizations(context) },
        onOnCall = vm::setOnCallEnabled,
        onToggleDay = vm::toggleDay,
        onPickStart = { picking = PICK_START },
        onPickEnd = { picking = PICK_END },
        onOutside = vm::setOutside,
        onRemind = vm::setRemind,
        onOpenChannel = { id, channel -> SystemSettings.channel(context, channel.id(id)) },
        onAppSettings = { SystemSettings.appNotifications(context) },
        onNotify = vm::setNotify,
        onToggleTenant = vm::toggleTenant,
        onInOnCall = vm::setInOnCall,
        onSendTest = vm::sendTest,
        onCheckNow = vm::checkNow,
    )
    NotificationSettingsContent(ui, actions)
    when (picking) {
        PICK_START -> OnCallTimeDialog(stringResource(R.string.notif_oncall_start_title), ui.onCall.startMinute, onConfirm = { vm.setStart(it); picking = null }, onDismiss = { picking = null })
        PICK_END -> OnCallTimeDialog(stringResource(R.string.notif_oncall_end_title), ui.onCall.endMinute, onConfirm = { vm.setEnd(it); picking = null }, onDismiss = { picking = null })
    }
}

private const val PICK_START = "start"
private const val PICK_END = "end"

internal data class SettingsActions(
    val onBack: () -> Unit = {},
    val onOpenServers: () -> Unit = {},
    val onAllowNotifications: () -> Unit = {},
    val onAllowBattery: () -> Unit = {},
    val onOnCall: (Boolean) -> Unit = {},
    val onToggleDay: (Int) -> Unit = {},
    val onPickStart: () -> Unit = {},
    val onPickEnd: () -> Unit = {},
    val onOutside: (OutsideRule) -> Unit = {},
    val onRemind: (Boolean) -> Unit = {},
    val onOpenChannel: (ServerId, NotifChannel) -> Unit = { _, _ -> },
    val onAppSettings: () -> Unit = {},
    val onNotify: (ServerId, NotifyScope) -> Unit = { _, _ -> },
    val onToggleTenant: (ServerId, Long) -> Unit = { _, _ -> },
    val onInOnCall: (ServerId, Boolean) -> Unit = { _, _ -> },
    val onSendTest: () -> Unit = {},
    val onCheckNow: () -> Unit = {},
)

@Composable
internal fun NotificationSettingsContent(ui: SettingsUi, actions: SettingsActions, scroll: ScrollState = rememberScrollState()) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliDetailTopBar(
            title = stringResource(R.string.notif_settings_title),
            onBack = actions.onBack,
            backLabel = stringResource(R.string.notif_back),
        )
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().verticalScroll(scroll).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!ui.notificationsAllowed) DeniedCard(actions.onAllowNotifications)
                DeliverySection(ui, actions)
                OnCallSection(ui, actions)
                if (ui.multi) {
                    NotifSectionTitle(stringResource(R.string.notif_section_servers))
                    ui.servers.forEach { ServerCard(it, actions) }
                } else {
                    ui.servers.firstOrNull()?.let { SingleServerTenants(it, actions) }
                }
                CategoriesSection(ui, actions)
                NotifSectionTitle(stringResource(R.string.notif_section_diagnostic))
                NotifGroup {
                    NotifRow(
                        stringResource(R.string.notif_send_test),
                        subtitle = ui.activeServer?.let { stringResource(R.string.notif_send_test_sub, it.name) },
                        icon = NotifIcons.Send,
                        onClick = actions.onSendTest,
                    )
                    NotifRow(
                        stringResource(R.string.notif_check_now),
                        subtitle = stringResource(R.string.notif_check_now_sub),
                        icon = ObliIcons.RefreshCw,
                        onClick = actions.onCheckNow,
                    )
                }
            }
        }
    }
}

@Composable
private fun DeniedCard(onAllow: () -> Unit) {
    val c = ObliTheme.colors
    NotifCard {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            RowIcon(NotifIcons.BellOff, tint = WarnYellow)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.notif_denied_title), style = ObliTypography.cardTitle, color = c.text)
                Text(stringResource(R.string.notif_denied_body), style = ObliTypography.body, color = c.text2)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            NotifPrimaryButton(stringResource(R.string.notif_allow), onAllow)
        }
    }
}

// --- Acheminement ---------------------------------------------------------------------

@Composable
private fun DeliverySection(ui: SettingsUi, actions: SettingsActions) {
    val c = ObliTheme.colors
    NotifSectionTitle(stringResource(R.string.notif_section_delivery))
    NotifGroup {
        NotifRow(stringResource(R.string.notif_delivery_poll), icon = ObliIcons.Clock)
        ui.servers.forEach { s ->
            val expired = s.status == ServerStatus.EXPIRED
            NotifRow(
                title = s.name,
                subtitle = statusText(s),
                subtitleColor = if (expired) LinkBlue else c.textMuted,
                leading = if (ui.multi) {
                    { ObliServerTile(s.color, s.monogram, s.name, size = 28.dp) }
                } else {
                    { RowIcon(ObliIcons.Server) }
                },
                onClick = if (expired || s.status == ServerStatus.SIGNED_OUT) actions.onOpenServers else null,
                trailing = { StatusMark(s.status) },
            )
        }
        NotifRow(
            title = stringResource(if (ui.batteryIgnored) R.string.notif_battery_off else R.string.notif_battery_on),
            icon = NotifIcons.BatteryCharging,
            trailing = {
                if (ui.batteryIgnored) {
                    Icon(ObliIcons.CircleCheck, contentDescription = null, tint = OkGreen, modifier = Modifier.size(20.dp))
                } else {
                    NotifTonalButton(stringResource(R.string.notif_allow), actions.onAllowBattery)
                }
            },
        )
    }
}

@Composable
private fun statusText(s: ServerRowUi): String = when (s.status) {
    ServerStatus.CHECKED -> stringResource(R.string.notif_server_checked, s.statusTime.orEmpty())
    ServerStatus.EXPIRED -> stringResource(R.string.notif_server_expired)
    ServerStatus.UNREACHABLE -> stringResource(R.string.notif_server_unreachable, s.statusTime.orEmpty())
    ServerStatus.DISABLED -> stringResource(R.string.notif_server_disabled)
    ServerStatus.SIGNED_OUT -> stringResource(R.string.notif_server_signed_out)
    ServerStatus.PENDING -> stringResource(R.string.notif_server_pending)
}

/** State is never colour alone: an icon goes with the text. */
@Composable
private fun StatusMark(status: ServerStatus) {
    val c = ObliTheme.colors
    val (icon, tint) = when (status) {
        ServerStatus.CHECKED -> ObliIcons.CircleCheck to OkGreen
        ServerStatus.EXPIRED -> ObliIcons.ChevronRight to c.textMuted
        ServerStatus.UNREACHABLE -> ObliIcons.TriangleAlert to WarnYellow
        ServerStatus.DISABLED -> NotifIcons.BellOff to c.textMuted
        ServerStatus.SIGNED_OUT -> ObliIcons.ChevronRight to c.textMuted
        ServerStatus.PENDING -> ObliIcons.Clock to c.textMuted
    }
    Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
}

// --- Astreinte ------------------------------------------------------------------------

@Composable
private fun OnCallSection(ui: SettingsUi, actions: SettingsActions) {
    val c = ObliTheme.colors
    val oc = ui.onCall
    val locale = LocalLocale.current.platformLocale
    NotifSectionTitle(stringResource(R.string.notif_section_oncall))
    NotifGroup {
        val window = "${ObliNotifications.minutes(oc.startMinute)}–${ObliNotifications.minutes(oc.endMinute)}"
        val days = if (oc.days.size == 7) {
            stringResource(R.string.notif_oncall_every_day)
        } else {
            oc.days.sorted().joinToString(", ") { DayOfWeek.of(it).getDisplayName(TextStyle.SHORT, locale) }
        }
        NotifSwitchRow(
            title = stringResource(R.string.notif_oncall_switch),
            subtitle = if (oc.enabled) "$days · $window" else stringResource(R.string.notif_oncall_switch_off),
            checked = oc.enabled,
            onChange = actions.onOnCall,
            icon = ObliIcons.Siren,
        )
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.notif_oncall_days), style = ObliTypography.labelSmall, color = c.textMuted)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                (1..7).forEach { d -> DayChip(d, d in oc.days, locale, Modifier.weight(1f)) { actions.onToggleDay(d) } }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TimeBox(stringResource(R.string.notif_oncall_start), ObliNotifications.minutes(oc.startMinute), actions.onPickStart, Modifier.weight(1f))
            TimeBox(stringResource(R.string.notif_oncall_end), ObliNotifications.minutes(oc.endMinute), actions.onPickEnd, Modifier.weight(1f))
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.notif_oncall_outside), style = ObliTypography.labelSmall, color = c.textMuted)
            NotifSegmented(
                options = listOf(
                    OutsideRule.CRITICAL_ONLY to stringResource(R.string.notif_outside_critical),
                    OutsideRule.SILENT to stringResource(R.string.notif_outside_silent),
                    OutsideRule.NONE to stringResource(R.string.notif_outside_none),
                ),
                selected = oc.outside,
                onSelect = actions.onOutside,
            )
        }
        NotifSwitchRow(
            title = stringResource(R.string.notif_oncall_remind),
            checked = oc.remindCritical,
            onChange = actions.onRemind,
            icon = NotifIcons.BellRing,
        )
        ui.servers.forEach { s ->
            val state = when (s.criticalBypassesDnd) {
                true -> stringResource(R.string.notif_dnd_allowed)
                false -> stringResource(R.string.notif_dnd_denied)
                null -> stringResource(R.string.notif_level_unknown)
            }
            NotifRow(
                title = stringResource(R.string.notif_dnd_title),
                subtitle = if (ui.multi) "${s.name} · $state" else state,
                leading = if (ui.multi) {
                    { ObliServerTile(s.color, s.monogram, s.name, size = 28.dp) }
                } else {
                    { RowIcon(NotifIcons.Moon) }
                },
                onClick = { actions.onOpenChannel(s.id, NotifChannel.CRITICAL) },
                trailing = {
                    if (s.criticalBypassesDnd == true) {
                        Icon(ObliIcons.CircleCheck, contentDescription = null, tint = OkGreen, modifier = Modifier.size(20.dp))
                    } else {
                        Icon(NotifIcons.ExternalLink, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(20.dp))
                    }
                },
            )
        }
    }
}

@Composable
private fun DayChip(day: Int, selected: Boolean, locale: Locale, modifier: Modifier, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val dow = DayOfWeek.of(day)
    val full = dow.getDisplayName(TextStyle.FULL, locale)
    val state = stringResource(if (selected) R.string.notif_selected else R.string.notif_not_selected)
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .toggleable(value = selected, role = Role.Checkbox, onValueChange = { onClick() })
            .semantics {
                contentDescription = full
                stateDescription = state
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.fillMaxWidth().heightIn(min = 36.dp).clip(RoundedCornerShape(8.dp)).background(if (selected) c.active else c.surface2),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                dow.getDisplayName(TextStyle.NARROW, locale).uppercase(locale),
                style = ObliTypography.label.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium),
                color = if (selected) c.text else c.textMuted,
            )
        }
    }
}

@Composable
private fun TimeBox(label: String, value: String, onClick: () -> Unit, modifier: Modifier) {
    val c = ObliTheme.colors
    Column(
        modifier
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(c.surface2)
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = ObliTypography.labelSmall, color = c.textMuted)
        Text(value, style = ObliTypography.monoCaption.copy(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium), color = c.text)
    }
}

// --- Par serveur ------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ServerCard(s: ServerRowUi, actions: SettingsActions) {
    val c = ObliTheme.colors
    NotifCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ObliServerTile(s.color, s.monogram, s.name, size = 28.dp)
            Column(Modifier.weight(1f)) {
                Text(s.name, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(statusText(s), style = ObliTypography.body, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Text(stringResource(R.string.notif_receive), style = ObliTypography.labelSmall, color = c.textMuted)
        NotifSegmented(
            options = listOf(
                NotifyScope.ALL to stringResource(R.string.notif_scope_all),
                NotifyScope.CRITICAL_ONLY to stringResource(R.string.notif_scope_critical),
                NotifyScope.NONE to stringResource(R.string.notif_scope_none),
            ),
            selected = s.notify,
            onSelect = { actions.onNotify(s.id, it) },
        )
        Text(stringResource(R.string.notif_tenants_covered), style = ObliTypography.labelSmall, color = c.textMuted)
        if (s.tenants.isEmpty()) {
            Text(stringResource(R.string.notif_tenants_unknown), style = ObliTypography.body, color = c.text2)
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                s.tenants.forEach { t -> NotifChip(t.name, t.included, onClick = { actions.onToggleTenant(s.id, t.id) }) }
            }
        }
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .toggleable(value = s.inOnCall, role = Role.Switch, onValueChange = { actions.onInOnCall(s.id, it) }),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.notif_in_oncall), style = ObliTypography.label.copy(fontSize = 16.sp, lineHeight = 22.sp), color = c.text, modifier = Modifier.weight(1f))
            NotifSwitchVisual(s.inOnCall)
        }
        AndroidSettingsLink(actions.onAppSettings)
    }
}

@Composable
private fun AndroidSettingsLink(onClick: () -> Unit) {
    Row(
        Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onClick).padding(end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(NotifIcons.ExternalLink, contentDescription = null, tint = LinkBlue, modifier = Modifier.size(18.dp))
        Text(stringResource(R.string.notif_android_settings), style = ObliTypography.label, color = LinkBlue)
    }
}

/** One server: « Recevoir les alertes de : Default · ACME » (design doc §5 S84 "Par tenant"). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SingleServerTenants(s: ServerRowUi, actions: SettingsActions) {
    val c = ObliTheme.colors
    NotifSectionTitle(stringResource(R.string.notif_receive_from))
    NotifCard {
        if (s.tenants.isEmpty()) {
            Text(stringResource(R.string.notif_tenants_unknown), style = ObliTypography.body, color = c.text2)
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                s.tenants.forEach { t -> NotifChip(t.name, t.included, onClick = { actions.onToggleTenant(s.id, t.id) }) }
            }
        }
        AndroidSettingsLink(actions.onAppSettings)
    }
}

// --- Catégories -----------------------------------------------------------------------

@Composable
private fun CategoriesSection(ui: SettingsUi, actions: SettingsActions) {
    val active = ui.activeServer ?: return
    val c = ObliTheme.colors
    NotifSectionTitle(stringResource(R.string.notif_section_categories))
    if (ui.multi) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 4.dp)) {
            ObliServerTile(active.color, active.monogram, active.name)
            Text(stringResource(R.string.notif_categories_of, active.name), style = ObliTypography.body, color = c.text2)
        }
    }
    NotifGroup {
        ui.categories.forEach { cat ->
            val (icon, label) = levelOf(cat.level)
            NotifRow(
                title = stringResource(channelName(cat.channel)),
                subtitle = label,
                icon = icon,
                onClick = { actions.onOpenChannel(active.id, cat.channel) },
                trailing = { Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(20.dp)) },
            )
        }
    }
}

@Composable
private fun levelOf(level: ChannelLevel?): Pair<ImageVector, String> = when (level) {
    ChannelLevel.SOUND -> NotifIcons.Volume to stringResource(R.string.notif_level_sound)
    ChannelLevel.VIBRATE -> NotifIcons.Vibrate to stringResource(R.string.notif_level_vibrate)
    ChannelLevel.SILENT -> NotifIcons.VolumeOff to stringResource(R.string.notif_level_silent)
    ChannelLevel.OFF -> NotifIcons.BellOff to stringResource(R.string.notif_level_off)
    null -> NotifIcons.Bell to stringResource(R.string.notif_level_unknown)
}

internal fun channelName(channel: NotifChannel): Int = when (channel) {
    NotifChannel.CRITICAL -> R.string.notif_channel_critical
    NotifChannel.ATTENTION -> R.string.notif_channel_attention
    NotifChannel.RECOVERY -> R.string.notif_channel_recovery
    NotifChannel.ESCALATIONS -> R.string.notif_channel_escalations
    NotifChannel.ENROLMENTS -> R.string.notif_channel_enrolments
    NotifChannel.ACCOUNT -> R.string.notif_channel_account
}

// --- Time picker ------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OnCallTimeDialog(title: String, minute: Int, onConfirm: (Int) -> Unit, onDismiss: () -> Unit) {
    val c = ObliTheme.colors
    val state = rememberTimePickerState(initialHour = minute / 60, initialMinute = minute % 60, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = c.surface1,
        title = { Text(title, style = ObliTypography.dialogTitle, color = c.text) },
        text = {
            TimePicker(
                state = state,
                colors = TimePickerDefaults.colors(
                    clockDialColor = c.surface2,
                    clockDialSelectedContentColor = c.text,
                    clockDialUnselectedContentColor = c.text2,
                    selectorColor = ToggleOn,
                    containerColor = c.surface1,
                    timeSelectorSelectedContainerColor = c.active,
                    timeSelectorUnselectedContainerColor = c.surface2,
                    timeSelectorSelectedContentColor = c.text,
                    timeSelectorUnselectedContentColor = c.text2,
                ),
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(state.hour * 60 + state.minute) }) {
                Text(stringResource(R.string.notif_ok), style = ObliTypography.label, color = c.accent2)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.notif_cancel), style = ObliTypography.label, color = c.text2) }
        },
    )
}

internal tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
