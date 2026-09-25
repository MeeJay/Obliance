package tools.obli.obliance.devices

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.ZoneId
import java.util.Locale
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Scrollable tab row (§5 S30 item 7): Aperçu · Services · Processus · Tâches. */
@Composable
internal fun DeviceTabRow(selected: DeviceTab, onSelect: (DeviceTab) -> Unit) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().background(c.chrome).horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        DeviceTab.entries.forEach { tab ->
            val on = tab == selected
            val label = stringResource(tab.labelRes())
            Column(
                Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Tab) { onSelect(tab) }
                    .semantics { this.selected = on }
                    .padding(horizontal = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Bottom,
            ) {
                Text(
                    label,
                    style = ObliTypography.label.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium),
                    color = if (on) c.text else c.text2,
                    modifier = Modifier.padding(top = 14.dp, bottom = 10.dp),
                )
                Box(Modifier.width(24.dp).height(2.dp).clip(CircleShape).background(if (on) c.accent2 else androidx.compose.ui.graphics.Color.Transparent))
            }
        }
    }
}

internal fun DeviceTab.labelRes(): Int = when (this) {
    DeviceTab.OVERVIEW -> R.string.devices_tab_overview
    DeviceTab.SERVICES -> R.string.devices_tab_services
    DeviceTab.PROCESSES -> R.string.devices_tab_processes
    DeviceTab.TASKS -> R.string.devices_tab_tasks
}

/** Segmented control (mono, §5 S32/S33/S36): 48 dp targets. */
@Composable
internal fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(
        modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        options.forEach { (value, label) ->
            val on = value == selected
            Box(
                Modifier.heightIn(min = 48.dp).clickable(role = Role.Tab) { onSelect(value) }.semantics { this.selected = on },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = ObliTypography.labelSmall,
                    color = if (on) c.text else c.text2,
                    modifier = Modifier.clip(CircleShape).background(if (on) c.active else c.surface1).padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
    }
}

@Composable
internal fun FilterField(value: String, onChange: (String) -> Unit, hint: String, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).background(c.surface1).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ObliIcons.Search, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(hint, style = ObliTypography.body, color = c.textMuted)
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = ObliTypography.body.copy(color = c.text),
                cursorBrush = SolidColor(c.text),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = hint },
            )
        }
        if (value.isNotEmpty()) ObliIconButton(ObliIcons.X, stringResource(R.string.devices_search_clear), { onChange("") })
    }
}

/** Calm note with an icon (offline, privacy, empty). */
@Composable
internal fun TabNote(icon: ImageVector, text: String, tint: androidx.compose.ui.graphics.Color = ObliTheme.colors.text2, action: (@Composable () -> Unit)? = null) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.surface1).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.padding(top = 2.dp).size(16.dp))
            Text(text, style = ObliTypography.body, color = c.text2)
        }
        action?.invoke()
    }
}

// ---------------------------------------------------------------------------
// S32 Services
// ---------------------------------------------------------------------------

internal enum class ServiceFilter { ALL, RUNNING, STOPPED, AUTO_STOPPED }

internal fun filterServices(items: List<ServiceInfo>, filter: ServiceFilter, query: String): List<ServiceInfo> {
    val q = query.trim().lowercase()
    return items.filter { s ->
        when (filter) {
            ServiceFilter.ALL -> true
            ServiceFilter.RUNNING -> s.running
            ServiceFilter.STOPPED -> s.stopped
            ServiceFilter.AUTO_STOPPED -> s.stopped && s.automatic
        } && (q.isEmpty() || s.name.lowercase().contains(q) || (s.displayName ?: "").lowercase().contains(q))
    }.sortedWith(compareBy({ !(it.stopped && it.automatic) }, { it.label.lowercase() }))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ServicesTab(
    device: Device,
    ui: ServicesUi,
    refused: Set<String>,
    controller: ActController?,
    zone: ZoneId,
    onReload: () -> Unit,
) {
    val c = ObliTheme.colors
    val attention = device.statusKind == DeviceStatus.WARNING || device.statusKind == DeviceStatus.CRITICAL
    var filter by rememberSaveable { mutableStateOf(if (attention) ServiceFilter.AUTO_STOPPED else ServiceFilter.ALL) }
    var query by rememberSaveable { mutableStateOf("") }
    val shown = remember(ui.items, filter, query) { filterServices(ui.items, filter, query) }
    val blocked = controller?.serviceBlocked(device, "restart_service", refused)
    PullToRefreshBox(
        isRefreshing = ui.listing,
        onRefresh = { controller?.listServices(device, refused) },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "head") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (ui.items.isNotEmpty()) FilterField(query, { query = it }, stringResource(R.string.devices_services_filter))
                    Segmented(
                        listOf(
                            ServiceFilter.ALL to stringResource(R.string.devices_services_all),
                            ServiceFilter.RUNNING to stringResource(R.string.devices_services_running),
                            ServiceFilter.STOPPED to stringResource(R.string.devices_services_stopped),
                            ServiceFilter.AUTO_STOPPED to stringResource(R.string.devices_services_auto_stopped),
                        ),
                        filter,
                        { filter = it },
                    )
                    SnapshotLine(ui, blocked, zone) { controller?.listServices(device, refused) }
                    if (blocked != null && ui.items.isNotEmpty()) TabNote(ObliIcons.Info, blocked)
                }
            }
            when {
                ui.problem != null && ui.items.isEmpty() -> item(key = "problem") { ProblemCard(ui.problem, onRetry = onReload) }
                !ui.loaded && ui.loading -> item(key = "loading") { Text(stringResource(R.string.devices_services_loading), style = ObliTypography.body, color = c.text2) }
                ui.items.isEmpty() -> item(key = "empty") {
                    TabNote(ActIcons.Cog, stringResource(R.string.devices_services_empty)) {
                        if (blocked == null) SecondaryButton(stringResource(R.string.devices_services_load), { controller?.listServices(device, refused) })
                    }
                }
                shown.isEmpty() -> item(key = "none") { Text(stringResource(R.string.devices_services_none), style = ObliTypography.body, color = c.text2, modifier = Modifier.padding(8.dp)) }
                else -> items(shown, key = { it.name }) { s ->
                    ServiceRow(s, ui.pending[s.name], enabled = blocked == null) { type -> controller?.service(device, s, type, refused) }
                }
            }
        }
    }
}

@Composable
private fun SnapshotLine(ui: ServicesUi, blocked: String?, zone: ZoneId, onRefresh: () -> Unit) {
    val c = ObliTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val text = when {
            ui.listing -> stringResource(R.string.devices_services_listing)
            ui.listTimedOut -> stringResource(R.string.devices_services_timeout)
            ui.receivedAt != null -> stringResource(R.string.devices_services_list_of, DeviceFormat.hhmm(ui.receivedAt, zone))
            else -> null
        }
        Text(text ?: "", style = ObliTypography.monoCaption, color = c.textMuted, modifier = Modifier.weight(1f))
        if (blocked == null && !ui.listing) {
            Row(
                Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onRefresh).padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(ObliIcons.RefreshCw, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
                Text(stringResource(R.string.devices_services_refresh), style = ObliTypography.label, color = c.text2)
            }
        }
    }
}

@Composable
private fun ServiceRow(s: ServiceInfo, pending: String?, enabled: Boolean, onAction: (String) -> Unit) {
    val c = ObliTheme.colors
    var menu by remember { mutableStateOf(false) }
    val autoStopped = s.stopped && s.automatic
    val statusColor = when {
        autoStopped -> ObliTokens.Status.WARNING.argb.toColor()
        s.running -> ObliTokens.Status.ONLINE.argb.toColor()
        else -> c.textMuted
    }
    val statusText = when {
        s.running -> stringResource(R.string.devices_service_running)
        s.stopped -> stringResource(R.string.devices_service_stopped)
        else -> s.status
    }
    val start = startTypeText(s.startType)
    val a11y = listOfNotNull(s.label, s.name.takeIf { it != s.label }, statusText, start).joinToString(", ")
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(8.dp)).background(c.surface1).padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(vertical = 8.dp).semantics(mergeDescendants = true) { contentDescription = a11y }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(s.label, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(s.name.takeIf { it != s.label }, start).joinToString(" · "), style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(statusColor))
                Text(statusText, style = ObliTypography.labelSmall, color = statusColor)
                if (pending != null) {
                    Text("·", style = ObliTypography.labelSmall, color = c.textMuted)
                    Text(stringResource(R.string.devices_cmd_sent), style = ObliTypography.labelSmall, color = ObliTokens.UNREAD.toColor())
                }
            }
        }
        Box {
            ObliIconButton(ObliIcons.EllipsisVertical, stringResource(R.string.devices_service_actions, s.label), { menu = true }, enabled = enabled && pending == null)
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.devices_service_start)) },
                    leadingIcon = { Icon(ActIcons.Play, null, Modifier.size(18.dp)) },
                    enabled = !s.running,
                    onClick = { menu = false; onAction("start_service") },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.devices_service_restart)) },
                    leadingIcon = { Icon(DeviceIcons.RotateCcw, null, Modifier.size(18.dp)) },
                    onClick = { menu = false; onAction("restart_service") },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.devices_service_stop)) },
                    leadingIcon = { Icon(ActIcons.Square, null, Modifier.size(18.dp)) },
                    enabled = !s.stopped,
                    onClick = { menu = false; onAction("stop_service") },
                )
            }
        }
    }
}

@Composable
private fun startTypeText(startType: String?): String? = when (startType?.lowercase()) {
    null, "" -> null
    "auto", "automatic", "auto_start", "enabled" -> stringResource(R.string.devices_service_auto)
    "manual", "demand", "demand_start" -> stringResource(R.string.devices_service_manual)
    "disabled" -> stringResource(R.string.devices_service_disabled)
    else -> startType
}

// ---------------------------------------------------------------------------
// S33 Processes
// ---------------------------------------------------------------------------

internal enum class ProcessSort { CPU, MEMORY, NAME }

internal fun sortProcesses(items: List<ProcessInfo>, sort: ProcessSort, query: String): List<ProcessInfo> {
    val q = query.trim().lowercase()
    val filtered = if (q.isEmpty()) items else items.filter { it.name.lowercase().contains(q) || it.user.lowercase().contains(q) || it.pid.toString().contains(q) }
    return when (sort) {
        ProcessSort.CPU -> filtered.sortedWith(compareByDescending<ProcessInfo> { it.cpuPercent }.thenByDescending { it.memBytes })
        ProcessSort.MEMORY -> filtered.sortedByDescending { it.memBytes }
        ProcessSort.NAME -> filtered.sortedBy { it.name.lowercase() }
    }
}

@Composable
internal fun memText(bytes: Long, locale: Locale): String {
    val mb = bytes / (1024.0 * 1024.0)
    return if (mb >= 1024) {
        stringResource(R.string.devices_mem_gb, String.format(locale, "%.1f", mb / 1024))
    } else {
        stringResource(R.string.devices_mem_mb, String.format(locale, "%.0f", mb))
    }
}

@Composable
internal fun ProcessesTab(
    device: Device,
    ui: ProcessesUi,
    onFreeze: (Boolean) -> Unit,
    onUnlock: () -> Unit,
    onOpen: (ProcessInfo) -> Unit,
) {
    val c = ObliTheme.colors
    val locale = currentLocale()
    var sort by rememberSaveable { mutableStateOf(ProcessSort.CPU) }
    var query by rememberSaveable { mutableStateOf("") }
    val shown = remember(ui.items, sort, query) { sortProcesses(ui.items, sort, query) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item(key = "head") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val live = ui.receivedAt != null && !ui.frozen
                    FreshnessStamp(
                        stringResource(if (ui.frozen) R.string.devices_processes_frozen else R.string.devices_processes_live),
                        if (live) MetricsFeed.LIVE else MetricsFeed.SNAPSHOT,
                        modifier = Modifier.weight(1f),
                    )
                    Row(
                        Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button) { onFreeze(!ui.frozen) }.padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(if (ui.frozen) ActIcons.Play else ActIcons.Pause, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
                        Text(stringResource(if (ui.frozen) R.string.devices_processes_resume else R.string.devices_processes_freeze), style = ObliTypography.label, color = c.text2)
                    }
                }
                if (ui.items.isNotEmpty()) {
                    val cpu = ui.items.sumOf { it.cpuPercent }.coerceAtMost(100.0)
                    val mem = ui.items.sumOf { it.memBytes }
                    Text(
                        pluralStringResource(R.plurals.devices_processes_summary, ui.items.size, ui.items.size, percentText(cpu), memText(mem, locale)),
                        style = ObliTypography.monoCaption,
                        color = c.textMuted,
                    )
                    FilterField(query, { query = it }, stringResource(R.string.devices_processes_filter))
                    Segmented(
                        listOf(
                            ProcessSort.CPU to stringResource(R.string.devices_processes_sort_cpu),
                            ProcessSort.MEMORY to stringResource(R.string.devices_processes_sort_memory),
                            ProcessSort.NAME to stringResource(R.string.devices_processes_sort_name),
                        ),
                        sort,
                        { sort = it },
                    )
                }
            }
        }
        when {
            !DeviceActions.reachable(device.statusKind) && ui.items.isEmpty() ->
                item(key = "offline") { TabNote(ObliIcons.Info, stringResource(R.string.devices_processes_offline)) }
            device.privacyModeEnabled && ui.items.isEmpty() -> item(key = "privacy") {
                TabNote(DeviceIcons.Shield, stringResource(R.string.devices_processes_privacy), PRIVACY) {
                    SecondaryButton(stringResource(R.string.devices_unlock), onUnlock)
                }
            }
            device.isLegacyAgent && !device.supports("list_processes") -> item(key = "legacy") { TabNote(ObliIcons.Info, stringResource(R.string.devices_block_legacy)) }
            ui.items.isEmpty() -> item(key = "waiting") { TabNote(ObliIcons.Clock, stringResource(R.string.devices_processes_waiting)) }
            else -> items(shown, key = { it.pid }) { p -> ProcessRow(p, killing = p.pid in ui.killing, locale = locale) { onOpen(p) } }
        }
    }
}

@Composable
private fun ProcessRow(p: ProcessInfo, killing: Boolean, locale: Locale, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val level = when {
        p.cpuPercent >= 90 -> MetricLevel.CRITICAL
        p.cpuPercent >= 50 -> MetricLevel.WARNING
        else -> MetricLevel.NORMAL
    }
    val cpu = percentText(p.cpuPercent)
    val mem = memText(p.memBytes, locale)
    val a11y = stringResource(R.string.devices_process_a11y, p.name, p.pid, cpu, mem)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(8.dp)).background(c.surface1)
            .clickable(onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = a11y }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.name, style = ObliTypography.monoCaption.copy(fontWeight = FontWeight.Medium), color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOf(stringResource(R.string.devices_process_pid, p.pid), p.user).filter { it.isNotBlank() }.joinToString(" · "),
                style = ObliTypography.monoCaption,
                color = c.textMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (killing) Text(stringResource(R.string.devices_process_killing), style = ObliTypography.labelSmall, color = ObliTokens.UNREAD.toColor())
        }
        Column(Modifier.width(92.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(cpu, style = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold), color = if (level == MetricLevel.NORMAL) c.text else level.color)
            MetricBar(p.cpuPercent.coerceIn(0.0, 100.0), level, greyed = false, modifier = Modifier.width(92.dp))
            Text(mem, style = ObliTypography.monoCaption, color = c.textMuted)
        }
    }
}

/** Row tap (§5 S33): command line, user, "Terminer le processus" (danger). */
@Composable
internal fun ProcessSheetContent(p: ProcessInfo, device: Device, canKill: Boolean, blocked: String?, onKill: () -> Unit, onClose: () -> Unit) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 4.dp)) {
                Text(p.name, style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
                Text(stringResource(R.string.devices_process_pid, p.pid) + " · " + device.label, style = ObliTypography.monoCaption, color = c.textMuted)
            }
            ObliIconButton(ObliIcons.X, stringResource(R.string.devices_close), onClose)
        }
        Column(Modifier.padding(end = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (p.user.isNotBlank()) Field(stringResource(R.string.devices_process_user), p.user)
            Field(stringResource(R.string.devices_process_command), p.command?.takeIf { it.isNotBlank() } ?: p.name)
            if (DeviceActions.isCritical(p)) TabNote(ObliIcons.TriangleAlert, stringResource(R.string.devices_confirm_kill_critical), ObliTokens.Status.WARNING.argb.toColor())
            if (canKill) {
                if (blocked != null) Text(blocked, style = ObliTypography.body, color = c.text2)
                val danger = ObliTokens.DANGER.toColor()
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                        .background(if (blocked == null) danger else c.surface2)
                        .clickable(enabled = blocked == null, role = Role.Button, onClick = onKill),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    Icon(ObliIcons.TriangleAlert, contentDescription = null, tint = if (blocked == null) androidx.compose.ui.graphics.Color.White else c.textFaint, modifier = Modifier.size(18.dp))
                    Text(stringResource(R.string.devices_process_kill), style = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold), color = if (blocked == null) androidx.compose.ui.graphics.Color.White else c.textFaint)
                }
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String) {
    val c = ObliTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label.uppercase(), style = ObliTypography.overline, color = c.textMuted)
        Text(value, style = ObliTypography.monoCaption, color = c.text)
    }
}

// ---------------------------------------------------------------------------
// S36 Tasks
// ---------------------------------------------------------------------------

internal enum class TaskFilter { ALL, ACTIVE, FAILED }

internal fun filterTasks(items: List<CommandDto>, filter: TaskFilter): List<CommandDto> = items.filter { cmd ->
    // The web's 'all' leaves remediation out (it has its own filter).
    cmd.type != "remediate_rule" && when (filter) {
        TaskFilter.ALL -> true
        TaskFilter.ACTIVE -> !cmd.state.terminal
        TaskFilter.FAILED -> cmd.state == CommandState.FAILURE || cmd.state == CommandState.TIMEOUT
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TasksTab(
    device: Device,
    ui: TasksUi,
    zone: ZoneId,
    onRefresh: () -> Unit,
    onCancel: (CommandDto) -> Unit,
    onOpen: (CommandDto) -> Unit,
) {
    val c = ObliTheme.colors
    val res = LocalContext.current.resources
    var filter by rememberSaveable { mutableStateOf(TaskFilter.ALL) }
    val shown = remember(ui.items, filter) { filterTasks(ui.items, filter) }
    val offline = !DeviceActions.reachable(device.statusKind)
    PullToRefreshBox(isRefreshing = ui.loading && ui.loaded, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            item(key = "head") {
                Segmented(
                    listOf(
                        TaskFilter.ALL to stringResource(R.string.devices_tasks_all),
                        TaskFilter.ACTIVE to stringResource(R.string.devices_tasks_active),
                        TaskFilter.FAILED to stringResource(R.string.devices_tasks_failed),
                    ),
                    filter,
                    { filter = it },
                )
            }
            when {
                ui.problem != null && ui.items.isEmpty() -> item(key = "problem") { ProblemCard(ui.problem, onRetry = onRefresh) }
                !ui.loaded -> item(key = "loading") { Text(stringResource(R.string.devices_tasks_loading), style = ObliTypography.body, color = c.text2) }
                shown.isEmpty() -> item(key = "empty") { TabNote(ActIcons.ListChecks, stringResource(if (filter == TaskFilter.ALL) R.string.devices_tasks_empty else R.string.devices_tasks_none)) }
                else -> items(shown, key = { it.id }) { cmd ->
                    TaskRow(cmd, commandLabel(res, cmd), commandStateText(res, cmd, offline, zone), zone, cancelling = cmd.id in ui.cancelling, onCancel = { onCancel(cmd) }, onOpen = { onOpen(cmd) })
                }
            }
        }
    }
}

@Composable
private fun TaskRow(cmd: CommandDto, label: String, stateText: String, zone: ZoneId, cancelling: Boolean, onCancel: () -> Unit, onOpen: () -> Unit) {
    val c = ObliTheme.colors
    val color = commandStateColor(cmd.state, c.textMuted)
    val at = DeviceFormat.parse(cmd.createdAt)?.let { DeviceFormat.hhmm(it, zone) }
    val duration = cmd.durationMs?.takeIf { cmd.state.terminal && it >= 0 }?.let { durationText(it) }
    val meta = listOfNotNull(cmd.createdByName?.takeIf { it.isNotBlank() }, at, duration).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(8.dp)).background(c.surface1)
            .clickable(onClick = onOpen)
            .padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(commandStateIcon(cmd.state), contentDescription = null, tint = color, modifier = Modifier.size(18.dp))
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = ObliTypography.label, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(stateText, style = ObliTypography.labelSmall, color = color)
            if (meta.isNotEmpty()) Text(meta, style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (cmd.state == CommandState.PENDING) {
            Box(
                Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(enabled = !cancelling, role = Role.Button, onClick = onCancel).padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.devices_tasks_cancel), style = ObliTypography.label, color = if (cancelling) c.textFaint else c.text2)
            }
        }
    }
}

@Composable
private fun durationText(ms: Long): String = if (ms < 60_000) {
    stringResource(R.string.devices_duration_s, String.format(currentLocale(), "%.1f", ms / 1000.0))
} else {
    stringResource(R.string.devices_duration_min, ms / 60_000, (ms / 1000) % 60)
}

/** Task tap (§5 S36): result sheet with stdout, stderr and error. */
@Composable
internal fun TaskSheetContent(cmd: CommandDto, onClose: () -> Unit) {
    val c = ObliTheme.colors
    val res = LocalContext.current.resources
    val r = cmd.result
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 4.dp)) {
                Text(commandLabel(res, cmd), style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
                Text(cmd.status + (r?.exitCode?.let { " · " + res.getString(R.string.devices_task_exit_code, it) } ?: ""), style = ObliTypography.monoCaption, color = c.textMuted)
            }
            ObliIconButton(ObliIcons.X, stringResource(R.string.devices_close), onClose)
        }
        Column(Modifier.padding(end = 8.dp).heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val blocks = listOfNotNull(
                r?.error?.takeIf { it.isNotBlank() }?.let { stringResource(R.string.devices_task_error) to it },
                r?.stdout?.takeIf { it.isNotBlank() }?.let { stringResource(R.string.devices_task_stdout) to it },
                r?.stderr?.takeIf { it.isNotBlank() }?.let { stringResource(R.string.devices_task_stderr) to it },
            )
            if (blocks.isEmpty()) Text(stringResource(R.string.devices_task_no_output), style = ObliTypography.body, color = c.text2)
            blocks.forEach { (title, text) ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(title.uppercase(), style = ObliTypography.overline, color = c.textMuted)
                    Text(
                        text.take(MAX_OUTPUT),
                        style = ObliTypography.terminal,
                        color = c.text,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.bg).padding(12.dp),
                    )
                }
            }
        }
    }
}

private const val MAX_OUTPUT = 20_000
