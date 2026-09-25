package tools.obli.obliance.devices

import android.content.res.Resources
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.ZoneId
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.core.security.ui.ActionFeedback
import tools.obli.core.security.ui.ActionMessages
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.actionEndpoints

/** Callbacks of the ACCÉDER items and of "Exécuter un script", wired by the app (other modules). */
internal data class ActNavigation(
    val onOpenTerminal: (ServerId, Long, String) -> Unit = { _, _, _ -> },
    val onOpenReach: (ServerId, Long) -> Unit = { _, _ -> },
    val onRunScript: (ServerId, List<Long>) -> Unit = { _, _ -> },
    val onOpenAutomations: (ServerId, Long) -> Unit = { _, _ -> },
)

/**
 * Builds the confirmations (S41 texts: action, device, "server › tenant",
 * consequence) and starts every action of S30/S40 and the tabs through the
 * view model (hence the runner). [scope] is "Obliance Prod › ACME" with 2+
 * servers, "ACME" otherwise (§7.6).
 */
internal class ActController(
    private val vm: DeviceActionsViewModel,
    private val services: ObliServices,
    private val res: Resources,
    private val feedback: ActionFeedback,
    private val scope: String,
    private val admin: Boolean,
    private val nav: ActNavigation,
    private val pushNow: suspend () -> ApiOutcome<*>,
    private val onReload: () -> Unit,
    private val onTab: (DeviceTab) -> Unit,
) {
    private val serverId get() = vm.serverId
    private val deviceId get() = vm.deviceId

    private fun spec(key: String, tier: Tier, title: String, target: String, consequence: String? = null) = ActionSpec(
        key = key, tier = tier, title = title, target = target, scope = scope, consequence = consequence,
        endpoints = services.sessions.session(serverId)?.actionEndpoints(deviceId),
    )

    fun context(refused: Set<String>) = ActContext(admin = admin, refused = refused)

    /** The text of [blocker], as shown under a disabled item and refused by the preflight. */
    fun reason(blocker: Blocker?): String? = when (blocker) {
        null -> null
        is Blocker.Unreachable -> res.getString(
            when (blocker.status) {
                DeviceStatus.PENDING -> R.string.devices_block_pending
                DeviceStatus.SUSPENDED -> R.string.devices_block_suspended
                DeviceStatus.PENDING_UNINSTALL -> R.string.devices_block_uninstall
                else -> R.string.devices_block_offline
            },
        )
        Blocker.Legacy -> res.getString(R.string.devices_block_legacy)
        is Blocker.Refused -> res.getString(R.string.devices_block_refused, ActionMessages.capabilityLabel(res, blocker.capability))
    }

    private fun blockedNow(device: Device, kind: ActKind, refused: Set<String>): String? =
        reason(DeviceActions.items(device, context(refused)).firstOrNull { it.kind == kind }?.blocker)

    private fun <T> show(done: Int): (ActionResult<T>) -> Unit = { r -> feedback.show(r, res.getString(done)) }

    /** An S40 item or bar slot was pressed. */
    fun act(kind: ActKind, device: Device, refused: Set<String>) {
        val blocked = blockedNow(device, kind, refused)
        val target = device.label
        when (kind) {
            ActKind.RUN_SCRIPT -> nav.onRunScript(serverId, listOf(deviceId))
            ActKind.SERVICES -> onTab(DeviceTab.SERVICES)
            ActKind.PROCESSES -> onTab(DeviceTab.PROCESSES)
            ActKind.TERMINAL_POWERSHELL -> if (blocked == null) nav.onOpenTerminal(serverId, deviceId, "powershell") else feedback.show(ActionResult.Blocked(blocked), "")
            ActKind.TERMINAL_CMD -> if (blocked == null) nav.onOpenTerminal(serverId, deviceId, "cmd") else feedback.show(ActionResult.Blocked(blocked), "")
            ActKind.TERMINAL_SSH -> if (blocked == null) nav.onOpenTerminal(serverId, deviceId, "ssh") else feedback.show(ActionResult.Blocked(blocked), "")
            ActKind.REACH -> if (blocked == null) nav.onOpenReach(serverId, deviceId) else feedback.show(ActionResult.Blocked(blocked), "")
            ActKind.AUTOMATIONS -> nav.onOpenAutomations(serverId, deviceId)
            ActKind.RESTART_AGENT -> vm.command(
                spec("device.restart_agent", DeviceActions.tier(kind), res.getString(R.string.devices_confirm_restart_agent), target, res.getString(R.string.devices_act_restart_agent_note)),
                device, "restart_agent", blocked, show(R.string.devices_done_restart_agent),
            )
            ActKind.REBOOT -> vm.command(
                spec("device.reboot", DeviceActions.tier(kind), res.getString(R.string.devices_confirm_reboot), target, rebootConsequence(device)),
                device, "reboot", blocked, show(R.string.devices_done_reboot),
            )
            ActKind.SLEEP -> vm.command(
                spec("device.sleep", DeviceActions.tier(kind), res.getString(R.string.devices_confirm_sleep), target, res.getString(R.string.devices_act_sleep_note)),
                device, "sleep", blocked, show(R.string.devices_done_sleep),
            )
            ActKind.SHUTDOWN -> vm.command(
                spec("device.shutdown", DeviceActions.tier(kind), res.getString(R.string.devices_confirm_shutdown), target, res.getString(R.string.devices_confirm_shutdown_body)),
                device, "shutdown", blocked, show(R.string.devices_done_shutdown),
            )
            ActKind.SCAN_ALL -> vm.scanAll(
                spec("device.scan_all", DeviceActions.tier(kind), res.getString(R.string.devices_act_scan_all), target),
                device, blocked, show(R.string.devices_done_scan_all),
            )
            ActKind.PUSH_METRICS -> vm.pushMetrics(
                spec("device.push_metrics", DeviceActions.tier(kind), res.getString(R.string.devices_act_push_metrics), target),
                device, blocked, pushNow, show(R.string.devices_done_push_metrics),
            )
            ActKind.ISOLATE -> vm.airgap(
                spec("device.airgap.enable", DeviceActions.tier(kind), res.getString(R.string.devices_confirm_isolate), target, res.getString(R.string.devices_confirm_isolate_body)),
                device, true, blocked,
            ) { r -> feedback.show(r, res.getString(R.string.devices_done_isolate)); if (r is ActionResult.Done) onReload() }
            ActKind.RESTORE_NETWORK -> vm.airgap(
                spec("device.airgap.disable", DeviceActions.tier(kind), res.getString(R.string.devices_confirm_restore), target, res.getString(R.string.devices_act_restore_note)),
                device, false, blocked,
            ) { r -> feedback.show(r, res.getString(R.string.devices_done_restore)); if (r is ActionResult.Done) onReload() }
        }
    }

    private fun rebootConsequence(device: Device): String {
        val base = res.getString(R.string.devices_confirm_reboot_body)
        val user = device.lastLoggedInUser?.takeIf { it.isNotBlank() } ?: return base
        return base + " " + res.getString(R.string.devices_confirm_reboot_user, user)
    }

    /** "Déverrouiller" (bar slot, privacy banners): S44 for [feature]. */
    fun unlock(device: Device, feature: String) {
        vm.unlockPrivacy(spec("device.privacy.unlock", Tier.T0, res.getString(R.string.devices_unlock), device.label), device, feature, show(R.string.devices_done_unlock))
    }

    /** "Actualiser" / pull on Services (T0): `list_services`. */
    fun listServices(device: Device, refused: Set<String>) {
        vm.listServices(
            spec("device.list_services", Tier.T0, res.getString(R.string.devices_services_refresh), device.label),
            device, serviceBlocked(device, "list_services", refused), show(R.string.devices_done_list_services),
        )
    }

    fun serviceBlocked(device: Device, type: String, refused: Set<String>): String? = reason(
        when {
            !DeviceActions.reachable(device.statusKind) -> Blocker.Unreachable(device.statusKind)
            !device.supports(type) -> Blocker.Legacy
            "execute" in refused && !admin -> Blocker.Refused("execute")
            else -> null
        },
    )

    fun service(device: Device, service: ServiceInfo, type: String, refused: Set<String>) {
        val title = res.getString(
            when (type) {
                "start_service" -> R.string.devices_confirm_service_start
                "stop_service" -> R.string.devices_confirm_service_stop
                else -> R.string.devices_confirm_service_restart
            },
        )
        val target = res.getString(R.string.devices_confirm_service_target, service.label, device.label)
        val consequence = if (type == "stop_service") res.getString(R.string.devices_confirm_service_stop_body) else null
        val done = when (type) {
            "start_service" -> R.string.devices_done_service_start
            "stop_service" -> R.string.devices_done_service_stop
            else -> R.string.devices_done_service_restart
        }
        vm.serviceAction(
            spec("device.$type", DeviceActions.serviceTier(type), title, target, consequence),
            device, service, type, serviceBlocked(device, type, refused), show(done),
        )
    }

    fun kill(device: Device, process: ProcessInfo, refused: Set<String>) {
        val critical = DeviceActions.isCritical(process)
        val target = res.getString(R.string.devices_confirm_kill_target, process.name, process.pid, device.label)
        val consequence = res.getString(if (critical) R.string.devices_confirm_kill_critical else R.string.devices_confirm_kill_body)
        vm.kill(
            spec("device.kill_process", DeviceActions.killTier(process), res.getString(R.string.devices_confirm_kill), target, consequence),
            device, process, serviceBlocked(device, "kill_process", refused), show(R.string.devices_done_kill),
        )
    }

    fun cancel(device: Device, command: CommandDto) {
        vm.cancelTask(
            spec("device.cancel_command", Tier.T1, res.getString(R.string.devices_confirm_cancel_task), res.getString(R.string.devices_confirm_cancel_target, commandLabel(res, command), device.label)),
            device, command, show(R.string.devices_done_cancel_task),
        )
    }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

internal fun ActKind.icon(): ImageVector = when (this) {
    ActKind.RUN_SCRIPT -> ActIcons.Play
    ActKind.SERVICES -> ActIcons.Cog
    ActKind.PROCESSES -> ActIcons.ListProcesses
    ActKind.RESTART_AGENT -> DeviceIcons.RotateCcw
    ActKind.TERMINAL_POWERSHELL, ActKind.TERMINAL_CMD, ActKind.TERMINAL_SSH -> DeviceIcons.Terminal
    ActKind.REACH -> ObliIcons.Monitor
    ActKind.AUTOMATIONS -> ActIcons.CalendarClock
    ActKind.SCAN_ALL -> ActIcons.ScanLine
    ActKind.PUSH_METRICS -> ActIcons.Gauge
    ActKind.REBOOT -> ActIcons.RefreshCw
    ActKind.SLEEP -> ActIcons.Moon
    ActKind.SHUTDOWN -> ActIcons.Power
    ActKind.ISOLATE -> ActIcons.WifiOff
    ActKind.RESTORE_NETWORK -> ActIcons.Wifi
}

internal fun ActKind.labelRes(): Int = when (this) {
    ActKind.RUN_SCRIPT -> R.string.devices_act_run_script
    ActKind.SERVICES -> R.string.devices_act_services
    ActKind.PROCESSES -> R.string.devices_act_processes
    ActKind.RESTART_AGENT -> R.string.devices_act_restart_agent
    ActKind.TERMINAL_POWERSHELL -> R.string.devices_act_terminal_powershell
    ActKind.TERMINAL_CMD -> R.string.devices_act_terminal_cmd
    ActKind.TERMINAL_SSH -> R.string.devices_act_terminal_ssh
    ActKind.REACH -> R.string.devices_act_reach
    ActKind.AUTOMATIONS -> R.string.devices_act_automations
    ActKind.SCAN_ALL -> R.string.devices_act_scan_all
    ActKind.PUSH_METRICS -> R.string.devices_act_push_metrics
    ActKind.REBOOT -> R.string.devices_act_reboot
    ActKind.SLEEP -> R.string.devices_act_sleep
    ActKind.SHUTDOWN -> R.string.devices_act_shutdown
    ActKind.ISOLATE -> R.string.devices_act_isolate
    ActKind.RESTORE_NETWORK -> R.string.devices_act_restore
}

/** The one-line consequence (S40 "icône, libellé, conséquence en une ligne"). */
internal fun ActKind.noteRes(): Int = when (this) {
    ActKind.RUN_SCRIPT -> R.string.devices_act_run_script_note
    ActKind.SERVICES -> R.string.devices_act_services_note
    ActKind.PROCESSES -> R.string.devices_act_processes_note
    ActKind.RESTART_AGENT -> R.string.devices_act_restart_agent_note
    ActKind.TERMINAL_POWERSHELL, ActKind.TERMINAL_CMD -> R.string.devices_act_terminal_note
    ActKind.TERMINAL_SSH -> R.string.devices_act_terminal_ssh_note
    ActKind.REACH -> R.string.devices_act_reach_note
    ActKind.AUTOMATIONS -> R.string.devices_act_automations_note
    ActKind.SCAN_ALL -> R.string.devices_act_scan_all_note
    ActKind.PUSH_METRICS -> R.string.devices_act_push_metrics_note
    ActKind.REBOOT -> R.string.devices_act_reboot_note
    ActKind.SLEEP -> R.string.devices_act_sleep_note
    ActKind.SHUTDOWN -> R.string.devices_act_shutdown_note
    ActKind.ISOLATE -> R.string.devices_act_isolate_note
    ActKind.RESTORE_NETWORK -> R.string.devices_act_restore_note
}

internal fun ActGroup.labelRes(): Int = when (this) {
    ActGroup.REPAIR -> R.string.devices_group_repair
    ActGroup.ACCESS -> R.string.devices_group_access
    ActGroup.ANALYSE -> R.string.devices_group_analyse
    ActGroup.POWER -> R.string.devices_group_power
    ActGroup.SENSITIVE -> R.string.devices_group_sensitive
}

/** French label of a command type for S36 and the tracking line ("Redémarrer le service Spooler"). */
internal fun commandLabel(res: Resources, cmd: CommandDto): String {
    val name = cmd.payloadName
    return when (cmd.type) {
        "restart_agent" -> res.getString(R.string.devices_cmd_restart_agent)
        "reboot" -> res.getString(R.string.devices_cmd_reboot)
        "shutdown" -> res.getString(R.string.devices_cmd_shutdown)
        "sleep" -> res.getString(R.string.devices_cmd_sleep)
        "scan_inventory" -> res.getString(R.string.devices_cmd_scan_inventory)
        "scan_updates" -> res.getString(R.string.devices_cmd_scan_updates)
        "check_compliance" -> res.getString(R.string.devices_cmd_check_compliance)
        "list_services" -> res.getString(R.string.devices_cmd_list_services)
        "list_processes" -> res.getString(R.string.devices_cmd_list_processes)
        "start_service" -> res.getString(R.string.devices_cmd_start_service, name ?: "")
        "stop_service" -> res.getString(R.string.devices_cmd_stop_service, name ?: "")
        "restart_service" -> res.getString(R.string.devices_cmd_restart_service, name ?: "")
        "kill_process" -> res.getString(R.string.devices_cmd_kill_process, name ?: cmd.payloadPid?.toString() ?: "")
        "run_script" -> res.getString(R.string.devices_cmd_run_script)
        "enable_airgap" -> res.getString(R.string.devices_cmd_enable_airgap)
        "disable_airgap" -> res.getString(R.string.devices_cmd_disable_airgap)
        "install_update", "install_updates" -> res.getString(R.string.devices_cmd_install_updates)
        "update_agent" -> res.getString(R.string.devices_cmd_update_agent)
        "uninstall_agent" -> res.getString(R.string.devices_cmd_uninstall_agent)
        "open_remote_tunnel" -> res.getString(R.string.devices_cmd_remote)
        else -> cmd.type
    }
}

/** §7.5 texts of a command state. [offline]: a pending command waits for the device. */
internal fun commandStateText(res: Resources, cmd: CommandDto, offline: Boolean, zone: ZoneId): String = when (cmd.state) {
    CommandState.PENDING -> if (offline) {
        DeviceFormat.parse(cmd.expiresAt)?.let { res.getString(R.string.devices_cmd_waiting_until, DeviceFormat.hhmm(it, zone)) }
            ?: res.getString(R.string.devices_cmd_waiting)
    } else {
        res.getString(R.string.devices_cmd_sent)
    }
    CommandState.SENT -> res.getString(R.string.devices_cmd_sent)
    CommandState.RUNNING -> res.getString(R.string.devices_cmd_running)
    CommandState.SUCCESS -> res.getString(R.string.devices_cmd_success)
    CommandState.FAILURE -> res.getString(R.string.devices_cmd_failure)
    CommandState.TIMEOUT -> res.getString(R.string.devices_cmd_timeout)
    CommandState.CANCELLED -> res.getString(R.string.devices_cmd_cancelled)
    CommandState.UNKNOWN -> cmd.status
}

internal fun commandStateColor(state: CommandState, muted: Color): Color = when (state) {
    CommandState.SUCCESS -> ObliTokens.Status.ONLINE.argb.toColor()
    CommandState.FAILURE -> ObliTokens.Status.CRITICAL.argb.toColor()
    CommandState.TIMEOUT -> ObliTokens.Status.WARNING.argb.toColor()
    CommandState.RUNNING, CommandState.SENT -> ObliTokens.UNREAD.toColor()
    else -> muted
}

internal fun commandStateIcon(state: CommandState): ImageVector = when (state) {
    CommandState.SUCCESS -> ObliIcons.CircleCheck
    CommandState.FAILURE -> ActIcons.CircleX
    CommandState.TIMEOUT -> ObliIcons.TriangleAlert
    CommandState.RUNNING -> ActIcons.Loader
    else -> ObliIcons.Clock
}

// ---------------------------------------------------------------------------
// Bottom action bar (§5 S30 item 8)
// ---------------------------------------------------------------------------

@Composable
internal fun DeviceActionBar(device: Device, onSlot: (BarSlot) -> Unit, onAct: () -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val divider = c.divider
    val slots = barSlots(device)
    val large = LocalDensity.current.fontScale >= LARGE_FONT_SCALE
    Row(
        modifier.fillMaxWidth().heightIn(min = 64.dp).background(c.chrome)
            .drawBehind { drawLine(divider, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (slots.isEmpty()) {
            Text(
                stringResource(R.string.devices_bar_pending),
                style = ObliTypography.body,
                color = c.text2,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
            )
        }
        slots.forEach { slot ->
            val (icon, label) = when (slot) {
                BarSlot.TERMINAL -> DeviceIcons.Terminal to stringResource(R.string.devices_bar_terminal)
                BarSlot.SCRIPT -> ActIcons.Play to stringResource(R.string.devices_bar_script)
                BarSlot.PROCESSES -> ActIcons.ListProcesses to stringResource(R.string.devices_tab_processes)
                BarSlot.SERVICES -> ActIcons.Cog to stringResource(R.string.devices_tab_services)
                BarSlot.TASKS -> ActIcons.ListChecks to stringResource(R.string.devices_tab_tasks)
                BarSlot.UNLOCK -> ActIcons.LockOpen to stringResource(R.string.devices_unlock)
            }
            Column(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                    .clickable(onClickLabel = label, role = Role.Button) { onSlot(slot) }
                    .padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
            ) {
                Icon(icon, contentDescription = null, tint = if (slot == BarSlot.UNLOCK) PRIVACY else c.text2, modifier = Modifier.size(20.dp))
                Text(label, style = ObliTypography.labelSmall, color = c.text2, maxLines = if (large) 2 else 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            }
        }
        // "Agir": tonal accent button (accent2 at 12 %), always last.
        val actLabel = stringResource(R.string.devices_act)
        val actA11y = stringResource(R.string.devices_act_a11y_open, device.label)
        Row(
            Modifier.then(if (slots.isEmpty()) Modifier else Modifier.weight(1.2f)).heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                .background(c.accent2.copy(alpha = 0.14f))
                .clickable(onClick = onAct)
                .semantics(mergeDescendants = true) {
                    contentDescription = actA11y
                    role = Role.Button
                }
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            Icon(DeviceIcons.Zap, contentDescription = null, tint = c.accent2, modifier = Modifier.size(18.dp))
            Text(actLabel, style = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold), color = c.accent2, maxLines = 1)
        }
    }
}

/** One line above the bar while a command started here runs, and shortly after (§7.5). */
@Composable
internal fun TrackLine(last: LastAction, command: CommandDto?, offline: Boolean, zone: ZoneId) {
    val c = ObliTheme.colors
    val res = androidx.compose.ui.platform.LocalContext.current.resources
    val (text, color, icon) = when {
        last.awaitingApproval -> Triple(stringResource(R.string.devices_cmd_awaiting_approval), ObliTokens.Status.WARNING.argb.toColor(), ObliIcons.Clock)
        command != null -> Triple(commandStateText(res, command, offline, zone), commandStateColor(command.state, c.textMuted), commandStateIcon(command.state))
        else -> return
    }
    Row(
        Modifier.fillMaxWidth().background(c.chrome).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
        Text(last.title, style = ObliTypography.labelSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Text("·", style = ObliTypography.labelSmall, color = c.textMuted)
        Text(text, style = ObliTypography.labelSmall, color = color, maxLines = 1)
    }
}

// ---------------------------------------------------------------------------
// S40 sheet content
// ---------------------------------------------------------------------------

/**
 * S40 "Agir" (mockup ActionSheet): header, tenant switch note, then the
 * groups RÉPARER · ACCÉDER · ANALYSER · ALIMENTATION as tiles and ZONE
 * SENSIBLE as rows. Every item says its consequence; a disabled one says why.
 */
@Composable
internal fun ActSheetContent(
    device: Device,
    items: List<ActItem>,
    reasonOf: (Blocker?) -> String?,
    last: LastAction?,
    tenantName: String?,
    zone: ZoneId,
    onSwitchTenant: () -> Unit,
    onItem: (ActKind) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ObliTheme.colors
    Column(modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, bottom = 16.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        device.label,
                        style = ObliTypography.dialogTitle,
                        color = c.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false).semantics { heading() },
                    )
                    device.tenantName?.takeIf { it.isNotBlank() }?.let { MonoTag(it) }
                    DeviceStatusPill(device.statusKind)
                }
                if (last != null) {
                    Text(
                        stringResource(R.string.devices_last_action, last.title, DeviceFormat.hhmm(last.at, zone)),
                        style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal),
                        color = c.textMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            ObliIconButton(ObliIcons.X, stringResource(R.string.devices_close), onClose)
        }
        Column(Modifier.padding(end = 8.dp)) {
            if (tenantName != null) TenantNote(device.label, tenantName, onSwitchTenant)
            ActGroup.entries.forEach { group ->
                val inGroup = items.filter { it.kind.group == group }
                if (inGroup.isEmpty()) return@forEach
                GroupHeader(stringResource(group.labelRes()))
                if (group == ActGroup.SENSITIVE) {
                    inGroup.forEach { SensitiveRow(it, reasonOf(it.blocker)) { onItem(it.kind) } }
                } else {
                    TileGrid(inGroup, reasonOf, onItem)
                }
            }
        }
    }
}

@Composable
private fun GroupHeader(text: String) {
    val c = ObliTheme.colors
    Text(
        text.uppercase(),
        style = ObliTypography.overline,
        color = c.textMuted,
        modifier = Modifier.padding(start = 8.dp, top = 16.dp, bottom = 6.dp).semantics { heading() },
    )
}

@Composable
private fun TenantNote(deviceName: String, tenantName: String, onSwitch: () -> Unit) {
    val c = ObliTheme.colors
    val blue = ObliTokens.UNREAD.toColor()
    Column(Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2).padding(start = 12.dp, top = 10.dp, end = 4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top, modifier = Modifier.padding(end = 8.dp)) {
            Icon(ObliIcons.Info, contentDescription = null, tint = blue, modifier = Modifier.padding(top = 2.dp).size(16.dp))
            Text(stringResource(R.string.devices_tenant_switch_note, deviceName, tenantName), style = ObliTypography.body, color = c.text2)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Row(
                Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onSwitch).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(stringResource(R.string.devices_tenant_switch_go), style = ObliTypography.label, color = blue)
                Icon(ObliIcons.ChevronRight, contentDescription = null, tint = blue, modifier = Modifier.size(16.dp))
            }
        }
    }
}

/** Tiles of one group: up to 4 per row (2 with large text), each with its consequence or reason. */
@Composable
private fun TileGrid(items: List<ActItem>, reasonOf: (Blocker?) -> String?, onItem: (ActKind) -> Unit) {
    val large = LocalDensity.current.fontScale >= LARGE_FONT_SCALE
    val perRow = if (large) 2 else minOf(items.size, if (items.size == 4) 2 else 3)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.chunked(perRow).forEach { row ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { item -> Tile(item, reasonOf(item.blocker), Modifier.weight(1f).fillMaxHeight()) { onItem(item.kind) } }
                repeat(perRow - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun Tile(item: ActItem, reason: String?, modifier: Modifier, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val label = stringResource(item.kind.labelRes())
    val note = reason ?: if (item.privacyLocked) stringResource(R.string.devices_act_privacy_note) else stringResource(item.kind.noteRes())
    val a11y = "$label. $note"
    Column(
        modifier.heightIn(min = 88.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2)
            .clickable(enabled = item.enabled, role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = a11y
                if (!item.enabled) disabled()
            }
            .padding(horizontal = 8.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box {
            Icon(item.kind.icon(), contentDescription = null, tint = if (item.enabled) c.text2 else c.textFaint, modifier = Modifier.size(20.dp))
            if (!item.enabled || item.privacyLocked) {
                Icon(
                    ObliIcons.Lock,
                    contentDescription = null,
                    tint = if (item.enabled) PRIVACY else c.textMuted,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(start = 14.dp, top = 14.dp).size(10.dp),
                )
            }
        }
        Text(label, style = ObliTypography.labelSmall, color = if (item.enabled) c.text else c.textMuted, textAlign = TextAlign.Center)
        Text(
            note,
            style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal),
            color = if (reason != null) c.text2 else c.textMuted,
            textAlign = TextAlign.Center,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SensitiveRow(item: ActItem, reason: String?, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val danger = ObliTokens.DANGER_TEXT.toColor()
    val label = stringResource(item.kind.labelRes())
    val note = reason ?: stringResource(item.kind.noteRes())
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(8.dp))
            .clickable(enabled = item.enabled, role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = "$label. $note"
                if (!item.enabled) disabled()
            }
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).background(danger.copy(alpha = if (item.enabled) 0.10f else 0.04f)), contentAlignment = Alignment.Center) {
            Icon(item.kind.icon(), contentDescription = null, tint = if (item.enabled) danger else c.textMuted, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(label, style = ObliTypography.body.copy(fontWeight = FontWeight.Medium), color = if (item.enabled) danger else c.textMuted)
            Text(note, style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal), color = c.textMuted)
        }
    }
}
