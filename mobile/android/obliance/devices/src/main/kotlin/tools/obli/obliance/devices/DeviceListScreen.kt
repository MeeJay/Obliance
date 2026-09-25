package tools.obli.obliance.devices

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.ZoneId
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliFreshness
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliScreenHeader
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.LocalObliServices

/** S20: devices of the ACTIVE server, in its session tenant (design doc §5 S20). */
@Composable
fun DeviceListScreen(onOpenDevice: (ServerId, Long) -> Unit) {
    val services = LocalObliServices.current
    val clock = LocalDevicesClock.current
    val vm = viewModel { DeviceListViewModel(services, clock) }
    val state by vm.state.collectAsStateWithLifecycle()
    val realtime by vm.realtime.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Live status and metrics only while visible (§7.4 "Cycle de vie du socket").
    LaunchedEffect(vm, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.followRealtime() } }
    val now = rememberNow(clock)

    DeviceListContent(
        state = state,
        live = realtime == ConnectionState.CONNECTED,
        now = now,
        zone = clock.zone,
        actions = ListActions(
            onOpen = { d -> state.serverId?.let { onOpenDevice(it, d.id) } },
            onSearch = vm::setSearch,
            onStatus = vm::toggleStatus,
            onOs = vm::toggleOs,
            onProblemsFirst = vm::toggleProblemsFirst,
            onClearFilters = vm::clearFilters,
            onRefresh = vm::refresh,
            onLoadMore = vm::loadMore,
        ),
    )
}

internal class ListActions(
    val onOpen: (Device) -> Unit = {},
    val onSearch: (String) -> Unit = {},
    val onStatus: (StatusChip) -> Unit = {},
    val onOs: (OsChip) -> Unit = {},
    val onProblemsFirst: () -> Unit = {},
    val onClearFilters: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onLoadMore: () -> Unit = {},
)

/** Current time, refreshed every 5 s while visible (§7.3 relative ages). */
@Composable
internal fun rememberNow(clock: DevicesClock): Long {
    val now by produceState(clock.now(), clock) {
        while (clock.ticking) {
            delay(5_000)
            value = clock.now()
        }
    }
    return now
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DeviceListContent(state: DeviceListState, live: Boolean, now: Long, zone: ZoneId, actions: ListActions) {
    val c = ObliTheme.colors
    val updated = state.updatedAt?.let { DeviceFormat.hhmm(it, zone) }
    val freshness = when {
        state.problem != null && state.devices.isNotEmpty() && updated != null -> ObliFreshness.Stale(stringResource(R.string.devices_data_of, updated))
        live && state.loaded -> ObliFreshness.Live
        updated != null -> ObliFreshness.Updated(stringResource(R.string.devices_updated_at, updated))
        else -> null
    }
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliScreenHeader(stringResource(R.string.devices_title), freshness = freshness, liveLabel = stringResource(R.string.devices_live))
        SearchField(state.filters.search, actions.onSearch, Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp))
        QuickChips(state, actions)
        Box(Modifier.fillMaxWidth().height(2.dp)) {
            if (state.filtering) LinearProgressIndicator(Modifier.fillMaxWidth(), color = c.text2, trackColor = Color.Transparent)
        }
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = actions.onRefresh,
            modifier = Modifier.fillMaxWidth().weight(1f),
        ) {
            val listState = rememberLazyListState()
            when {
                state.devices.isEmpty() && state.loading -> SkeletonRows()
                state.devices.isEmpty() && state.problem != null -> Column(Modifier.fillMaxSize().padding(16.dp)) {
                    ProblemCard(state.problem, onRetry = actions.onRefresh.takeIf { state.problem.kind.retryable })
                }
                state.devices.isEmpty() && state.loaded -> EmptyState(state, actions)
                else -> DeviceRows(state, now, zone, listState, actions)
            }
            if (state.pendingChanges > 0) {
                ChangesPill(state.pendingChanges, actions.onRefresh, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
            }
        }
    }
}

private val ProblemKind.retryable: Boolean get() = this != ProblemKind.SESSION_EXPIRED && this != ProblemKind.NO_SERVER

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DeviceRows(state: DeviceListState, now: Long, zone: ZoneId, listState: LazyListState, actions: ListActions) {
    val c = ObliTheme.colors
    LaunchedEffect(listState, state.hasMore) {
        if (!state.hasMore) return@LaunchedEffect
        snapshotFlow {
            val info = listState.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - LOAD_MORE_AHEAD
        }.distinctUntilChanged().filter { it }.collect { actions.onLoadMore() }
    }
    // Grouping up to 2000 rows: only when the state changes, not on every frame.
    val sections = remember(state) { state.sections }
    LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = if (state.pendingChanges > 0) 80.dp else 16.dp)) {
        if (!state.admin && state.loaded) {
            item(key = "scope") {
                Text(
                    pluralStringResource(R.plurals.devices_member_scope, state.total, state.total),
                    style = ObliTypography.monoCaption,
                    color = c.textMuted,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                )
            }
        }
        if (state.problem != null) {
            item(key = "stale") { StaleBanner(state, zone, actions) }
        }
        sections.forEach { section ->
            stickyHeader(key = "h-${section.section?.name ?: "all"}") {
                val label = section.section?.let { stringResource(it.label()) } ?: stringResource(R.string.devices_section_all)
                val count = if (section.atLeast) stringResource(R.string.devices_count_at_least, section.count) else section.count.toString()
                SectionHeader(stringResource(R.string.devices_section_header, label, count), section.section?.status?.color)
            }
            items(section.devices, key = { it.id }) { d ->
                DeviceRow(
                    device = d,
                    globalView = state.globalView,
                    now = now,
                    zone = zone,
                    flash = state.flashes[d.id] ?: 0,
                    onClick = { actions.onOpen(d) },
                )
            }
        }
        if (state.loadingMore) {
            item(key = "more") { SkeletonRow() }
        } else if (state.moreFailed) {
            item(key = "more-failed") {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(stringResource(R.string.devices_load_more_failed), style = ObliTypography.body, color = c.text2, modifier = Modifier.weight(1f))
                    SecondaryButton(stringResource(R.string.devices_retry), actions.onLoadMore)
                }
            }
        }
    }
}

private const val LOAD_MORE_AHEAD = 10

/**
 * DeviceRow, 72 dp (STYLEKIT `device-row`): OS tile with status dot; name,
 * tenant tag (global view) and mode icons; compact pill; mono "IP · OS ·
 * agent"; mini-bars, or "Hors ligne depuis …", or "En attente d'approbation".
 */
/** From this font scale on, a device row stacks its name, pill and tags (§7.11, up to 200 %). */
internal const val LARGE_FONT_SCALE = 1.3f

@Composable
internal fun DeviceRow(device: Device, globalView: Boolean, now: Long, zone: ZoneId, flash: Int, onClick: () -> Unit) {
    val c = ObliTheme.colors
    // Merge, do not jump (§7.4): a changed row flashes 600 ms on `active`, never in a status colour.
    val flashAlpha = remember { Animatable(0f) }
    var seenFlash by remember { mutableIntStateOf(flash) }
    LaunchedEffect(flash) {
        if (flash != seenFlash) {
            seenFlash = flash
            flashAlpha.snapTo(1f)
            flashAlpha.animateTo(0f, tween(600))
        }
    }
    val status = device.statusKind
    // Large text (up to 200 %, §7.11): the row grows, the name gets its own line (two if needed)
    // and the pill and tags move under it, instead of clipping a fixed 72 dp row.
    val large = LocalDensity.current.fontScale >= LARGE_FONT_SCALE
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .background(c.active.copy(alpha = flashAlpha.value))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = if (large) 10.dp else 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OsTile(device, ringColor = c.bg)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (large) 4.dp else 2.dp)) {
            if (large) {
                Text(device.label, style = ObliTypography.rowTitle, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    DeviceStatusPill(status)
                    if (globalView) device.tenantName?.takeIf { it.isNotBlank() }?.let { MonoTag(it) }
                    if (device.isLegacyAgent) MonoTag(stringResource(R.string.devices_tag_legacy))
                    ModeIcons(device)
                }
                Text(monoLine(device), style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SingleLine(device.label, ObliTypography.rowTitle, c.text, Modifier.weight(1f, fill = false))
                        if (globalView) device.tenantName?.takeIf { it.isNotBlank() }?.let { MonoTag(it) }
                        if (device.isLegacyAgent) MonoTag(stringResource(R.string.devices_tag_legacy))
                        ModeIcons(device)
                    }
                    DeviceStatusPill(status)
                }
                SingleLine(monoLine(device), ObliTypography.monoCaption, c.textMuted)
            }
            ThirdLine(device, now, zone)
        }
    }
}

@Composable
private fun ModeIcons(device: Device) {
    if (device.privacyModeEnabled) {
        Icon(DeviceIcons.Shield, stringResource(R.string.devices_privacy_a11y), tint = PRIVACY, modifier = Modifier.size(14.dp))
    }
    if (device.updateAvailable && !device.isLegacyAgent) {
        Icon(DeviceIcons.ArrowUp, stringResource(R.string.devices_update_a11y), tint = INFO, modifier = Modifier.size(14.dp))
    }
}

/** "10.0.12.43 · Windows 11 Pro · 4.5.79" (legacy agents: "legacy 1.4.0"). */
@Composable
private fun monoLine(device: Device): String {
    val agent = device.agentVersion?.takeIf { it.isNotBlank() }?.let {
        if (device.isLegacyAgent) stringResource(R.string.devices_agent_legacy, it) else it
    }
    return listOfNotNull(device.ipLocal?.takeIf { it.isNotBlank() }, device.osName?.takeIf { it.isNotBlank() }, agent).joinToString(" · ")
}

@Composable
private fun ThirdLine(device: Device, now: Long, zone: ZoneId) {
    val c = ObliTheme.colors
    val status = device.statusKind
    when {
        status == DeviceStatus.PENDING || device.approvalStatus == "pending" ->
            IconLine(DeviceIcons.UserPlus, stringResource(R.string.devices_pending_approval), INFO)
        status == DeviceStatus.OFFLINE -> IconLine(ObliIcons.Clock, offlineSince(device, now, zone), DeviceStatus.OFFLINE.color)
        else -> {
            val m = device.latestMetrics?.takeIf { !it.isEmpty }
            if (m == null) {
                Text(stringResource(R.string.devices_no_metrics), style = ObliTypography.labelSmall, color = c.textMuted)
            } else {
                val t = Thresholds.SYSTEM
                Row(Modifier.horizontalScroll(rememberScrollState(), enabled = false), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    m.cpu?.percent?.let { MiniBar(stringResource(R.string.devices_metric_cpu), it, t.cpu.levelOf(it)) }
                    m.memory?.percent?.let { MiniBar(stringResource(R.string.devices_metric_ram), it, t.ram.levelOf(it)) }
                    m.mainDisk()?.let { disk -> disk.percent?.let { MiniBar(disk.mount, it, t.forDisk(disk.mount).levelOf(it)) } }
                }
            }
        }
    }
}

/** "Hors ligne depuis 03:08 (14 min)" or "Hors ligne depuis le 22/09 (3 j)". */
@Composable
private fun offlineSince(device: Device, now: Long, zone: ZoneId): String {
    val seen = DeviceFormat.parse(device.lastSeenAt) ?: return stringResource(R.string.devices_offline_never)
    val age = ageText(Age.between(now, seen))
    return if (DeviceFormat.sameDay(now, seen, zone)) {
        stringResource(R.string.devices_offline_since_time, DeviceFormat.hhmm(seen, zone), age)
    } else {
        stringResource(R.string.devices_offline_since_date, DeviceFormat.ddmm(seen, zone), age)
    }
}

@Composable
private fun IconLine(icon: ImageVector, text: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
        SingleLine(text, ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal), color)
    }
}

/** Search bar (STYLEKIT `search-field`): full radius, surface2, 48 dp. */
@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val focus = LocalFocusManager.current
    val label = stringResource(R.string.devices_search_label)
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = ObliTypography.body.copy(fontSize = 16.sp, lineHeight = 24.sp, color = c.text),
        cursorBrush = SolidColor(c.accent2),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(24.dp)).background(c.surface2).padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(ObliIcons.Search, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(20.dp))
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(stringResource(R.string.devices_search_hint), style = ObliTypography.body.copy(fontSize = 16.sp, lineHeight = 24.sp), color = c.textMuted, maxLines = 1)
                    }
                    inner()
                }
                if (value.isNotEmpty()) {
                    ObliIconButton(ObliIcons.X, stringResource(R.string.devices_search_clear), onClick = { onChange("") })
                } else {
                    Spacer(Modifier.width(12.dp))
                }
            }
        },
    )
}

/** Scrollable quick chips (§5 S20 item 2). */
@Composable
private fun QuickChips(state: DeviceListState, actions: ListActions) {
    val f = state.filters
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FilterChip(stringResource(R.string.devices_chip_problems_first), f.problemsFirst, actions.onProblemsFirst)
        state.statusChips.forEach { chip ->
            FilterChip(
                label = stringResource(chip.status.label()),
                selected = f.status == chip,
                onClick = { actions.onStatus(chip) },
                dot = chip.status.color,
                count = state.chipCount(chip),
            )
        }
        OsChip.entries.forEach { chip ->
            FilterChip(
                label = stringResource(chip.label()),
                selected = f.os == chip,
                onClick = { actions.onOs(chip) },
                icon = osIcon(chip.wire),
            )
        }
    }
}

private fun OsChip.label(): Int = when (this) {
    OsChip.WINDOWS -> R.string.devices_os_windows
    OsChip.LINUX -> R.string.devices_os_linux
    OsChip.MACOS -> R.string.devices_os_macos
}

/** Filter chip: 36 dp visual in a 48 dp target; selected = `active` + check + 600 (never red). */
@Composable
private fun FilterChip(label: String, selected: Boolean, onClick: () -> Unit, dot: Color? = null, count: Int? = null, icon: ImageVector? = null) {
    val c = ObliTheme.colors
    Box(
        Modifier.heightIn(min = 48.dp).toggleable(value = selected, role = Role.Checkbox, onValueChange = { onClick() }),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).background(if (selected) c.active else c.surface2).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            when {
                selected -> Icon(ObliIcons.Check, contentDescription = null, tint = c.text, modifier = Modifier.size(16.dp))
                dot != null -> Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
                icon != null -> Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
            }
            Text(
                label,
                style = ObliTypography.label.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium),
                color = if (selected) c.text else c.text2,
                maxLines = 1,
            )
            if (count != null) {
                Text(count.toString(), style = ObliTypography.monoCaption.copy(fontWeight = FontWeight.Medium), color = if (selected) c.text2 else c.textMuted)
            }
        }
    }
}

/** Empty states of §5 S20: empty tenant, or no match for the search / filter. */
@Composable
private fun EmptyState(state: DeviceListState, actions: ListActions) {
    val f = state.filters
    val filterLabel = f.status?.let { stringResource(it.status.label()) } ?: f.os?.let { stringResource(it.label()) }
    val search = f.search.trim()
    val title = when {
        search.isNotEmpty() && filterLabel != null -> stringResource(R.string.devices_empty_search_filter, search, filterLabel)
        search.isNotEmpty() -> stringResource(R.string.devices_empty_search, search)
        filterLabel != null -> stringResource(R.string.devices_empty_filter, filterLabel)
        else -> stringResource(R.string.devices_empty_tenant)
    }
    ObliCalmState(
        title = title,
        icon = if (f.narrowed) DeviceIcons.SlidersHorizontal else ObliIcons.Monitor,
        action = if (f.narrowed) {
            { SecondaryButton(stringResource(R.string.devices_clear_filters), actions.onClearFilters) }
        } else {
            null
        },
    )
}

/** Cached rows with a failed refresh (§5 "Hors ligne": cache kept, cause said). */
@Composable
private fun StaleBanner(state: DeviceListState, zone: ZoneId, actions: ListActions) {
    val c = ObliTheme.colors
    val problem = state.problem ?: return
    val at = state.updatedAt?.let { DeviceFormat.hhmm(it, zone) }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clip(RoundedCornerShape(8.dp)).background(c.surface1).padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(ObliTokens.Status.WARNING.argb.toColor()))
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(stringResource(problem.message()), style = ObliTypography.body, color = c.text)
            if (at != null) Text(stringResource(R.string.devices_data_of, at), style = ObliTypography.monoCaption, color = c.textMuted)
        }
        if (problem.kind.retryable) {
            TextButton(onClick = actions.onRefresh, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.devices_retry), style = ObliTypography.label, color = INFO)
            }
        }
    }
}

/** "3 changements · Actualiser l'ordre" (§7.4 "Ordre stable"). */
@Composable
private fun ChangesPill(count: Int, onApply: () -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val shape = RoundedCornerShape(24.dp)
    Row(
        modifier.shadow(12.dp, shape).clip(shape).background(c.hover).clickable(onClick = onApply).heightIn(min = 48.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ObliIcons.RefreshCw, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
        Text(pluralStringResource(R.plurals.devices_changes, count, count), style = ObliTypography.label, color = c.text)
        Text("·", style = ObliTypography.label, color = c.textMuted)
        Text(stringResource(R.string.devices_refresh_order), style = ObliTypography.label, color = INFO)
    }
}

/** Skeleton rows at the final shape, 1.2 s pulse (§5 "Chargement"). */
@Composable
private fun SkeletonRows() {
    val label = stringResource(R.string.devices_loading)
    Column(Modifier.fillMaxSize().semantics { contentDescription = label }) {
        Spacer(Modifier.height(40.dp))
        repeat(8) { SkeletonRow() }
    }
}

@Composable
private fun SkeletonRow() {
    val c = ObliTheme.colors
    val t = rememberInfiniteTransition(label = "skeleton")
    val a by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(600, easing = LinearEasing), RepeatMode.Reverse), label = "skeleton-alpha")
    Row(
        Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 16.dp).alpha(a),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).background(c.surface2))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.width(150.dp).height(14.dp).clip(RoundedCornerShape(4.dp)).background(c.surface2))
            Box(Modifier.width(220.dp).height(10.dp).clip(RoundedCornerShape(4.dp)).background(c.surface2))
        }
    }
}

/** Info / link blue (#60A5FA): never red in content (§8.3). */
internal val INFO = Color(ObliTokens.UNREAD.toInt())

/** Privacy mode orange (#FB923C). */
internal val PRIVACY = Color(ObliTokens.Status.PENDING_UNINSTALL.argb.toInt())
