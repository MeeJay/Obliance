package tools.obli.obliance.triage

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.ZoneId
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import tools.obli.core.designsystem.ObliFreshness
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliScreenHeader
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionSpec
import tools.obli.obliance.data.LocalObliServices

/**
 * S10 "À traiter" (design doc §5 S10): alerts and two-person approvals of every
 * connected server, sorted by computed priority. [onOpenDevice] opens a device
 * of ANY server: the application switches server when needed (§2.10).
 */
@Composable
fun TriageScreen(onOpenDevice: (ServerId, Long) -> Unit) = TriageRoute(onOpenDevice)

/** [clock], [zone] and [tick] are injected by the screenshot tests (fixed night of 25 September). */
@Composable
internal fun TriageRoute(
    onOpenDevice: (ServerId, Long) -> Unit,
    clock: () -> Long = System::currentTimeMillis,
    zone: ZoneId = ZoneId.systemDefault(),
    tick: Boolean = true,
    initialSegment: TriageSegment? = null,
) {
    val services = LocalObliServices.current
    val vm = viewModel { TriageViewModel(services, clock).also { vm -> initialSegment?.let(vm::selectSegment) } }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val review by vm.review.collectAsStateWithLifecycle()
    // Relative ages refresh every 5 s (§7.3).
    val now by produceState(clock(), tick) {
        while (tick) {
            delay(5_000)
            value = clock()
        }
    }
    val time = TriageTime(now, zone)
    val snackbar = remember { SnackbarHostState() }
    val res = LocalResources.current

    LaunchedEffect(vm) {
        vm.events.collect { e ->
            when (e) {
                is TriageEvent.Deleted -> launch {
                    snackbar.currentSnackbarData?.dismiss()
                    val result = withTimeoutOrNull(TriageViewModel.UNDO_MS) {
                        snackbar.showSnackbar(res.getString(R.string.triage_deleted), res.getString(R.string.triage_undo), duration = SnackbarDuration.Indefinite)
                    }
                    if (result == SnackbarResult.ActionPerformed) vm.undoDelete(e.key)
                }
                is TriageEvent.Failed -> launch { snackbar.showSnackbar(res.getString(failureText(e.outcome))) }
                is TriageEvent.MarkedAllRead -> launch { snackbar.showSnackbar(res.getString(R.string.triage_marked_all_read)) }
                is TriageEvent.ApprovalDone -> launch {
                    snackbar.showSnackbar(res.getString(if (e.approved) R.string.triage_approval_done_approved else R.string.triage_approval_done_denied))
                }
            }
        }
    }

    TriageContent(
        ui = ui,
        time = time,
        snackbar = snackbar,
        actions = TriageActions(
            onOpenDevice = onOpenDevice,
            onSegment = vm::selectSegment,
            onServer = vm::selectServer,
            onSeverity = vm::toggleSeverity,
            onClearSeverities = vm::clearSeverities,
            onToggleRead = vm::toggleRead,
            onAtTop = vm::setAtTop,
            onShowHeldBack = vm::showHeldBack,
            onRefresh = vm::refresh,
            onMarkRead = vm::markRead,
            onDelete = vm::delete,
            onMarkAllRead = vm::markAllRead,
            onReconnect = vm::reconnect,
            onReview = vm::openReview,
        ),
    )

    review?.let { state ->
        ReviewSheet(
            state = state,
            time = time,
            multiServer = ui.multiServer,
            onReason = vm::setReason,
            onDecide = vm::decide,
            onConfirm = vm::answerConfirm,
            onCode = vm::answerCode,
            onClose = vm::closeReview,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReviewSheet(
    state: ReviewState,
    time: TriageTime,
    multiServer: Boolean,
    onReason: (String) -> Unit,
    onDecide: (Boolean, ActionSpec) -> Unit,
    onConfirm: (Boolean) -> Unit,
    onCode: (String?) -> Unit,
    onClose: () -> Unit,
) {
    val c = ObliTheme.colors
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.surface1,
        contentColor = c.text,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
    ) {
        ApprovalReviewContent(state, time, multiServer, onReason, onDecide, onConfirm, onCode, onClose)
    }
}

internal class TriageActions(
    val onOpenDevice: (ServerId, Long) -> Unit = { _, _ -> },
    val onSegment: (TriageSegment) -> Unit = {},
    val onServer: (ServerId?) -> Unit = {},
    val onSeverity: (tools.obli.shell.alerts.AlertSeverity) -> Unit = {},
    val onClearSeverities: () -> Unit = {},
    val onToggleRead: () -> Unit = {},
    val onAtTop: (Boolean) -> Unit = {},
    val onShowHeldBack: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onMarkRead: (IncidentUi) -> Unit = {},
    val onDelete: (IncidentUi) -> Unit = {},
    val onMarkAllRead: (List<ServerId>) -> Unit = {},
    val onReconnect: (ServerId) -> Unit = {},
    val onReview: (EscalationUi) -> Unit = {},
)

private fun failureText(outcome: ApiOutcome<Nothing>): Int = when (outcome) {
    ApiOutcome.SessionExpired -> R.string.triage_error_session
    is ApiOutcome.Forbidden -> R.string.triage_error_forbidden
    is ApiOutcome.Failure -> if (outcome.kind == tools.obli.core.network.FailureKind.NETWORK) R.string.triage_error_network else R.string.triage_error_server
    else -> R.string.triage_error_server
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TriageContent(ui: TriageUi, time: TriageTime, actions: TriageActions, snackbar: SnackbarHostState = remember { SnackbarHostState() }) {
    val c = ObliTheme.colors
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 48 }
            .distinctUntilChanged()
            .collect { actions.onAtTop(it) }
    }

    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliScreenHeader(
            stringResource(R.string.triage_title),
            freshness = freshnessOf(ui, time),
            liveLabel = stringResource(R.string.triage_live),
            trailing = { OverflowMenu(ui, actions) },
        )
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.fillMaxHeight().widthIn(max = 720.dp).fillMaxWidth()) {
                if (ui.showApprovals) {
                    SegmentedControl(ui, actions.onSegment, Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp))
                }
                if (ui.segment == TriageSegment.ALERTS) FilterChips(ui, actions)
                PullToRefreshBox(
                    isRefreshing = ui.refreshing,
                    onRefresh = actions.onRefresh,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    when (ui.segment) {
                        TriageSegment.ALERTS -> AlertsList(ui, time, listState, actions)
                        TriageSegment.APPROVALS -> ApprovalsList(ui, time, actions)
                    }
                    androidx.compose.animation.AnimatedVisibility(
                        visible = ui.heldBack > 0 && ui.segment == TriageSegment.ALERTS,
                        enter = fadeIn(),
                        exit = fadeOut(),
                        modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp),
                    ) {
                        NewAlertsPill(ui.heldBack) {
                            actions.onShowHeldBack()
                            scope.launch { listState.animateScrollToItem(0) }
                        }
                    }
                }
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp)) { data ->
                Snackbar(data, containerColor = c.active, contentColor = c.text, actionColor = c.accent2, shape = RoundedCornerShape(8.dp))
            }
        }
    }
}

@Composable
private fun freshnessOf(ui: TriageUi, time: TriageTime): ObliFreshness? {
    val at = ui.updatedAt?.hhmm(time.zone)
    return when (ui.freshness) {
        Freshness.LIVE -> ObliFreshness.Live
        Freshness.UPDATED -> at?.let { ObliFreshness.Updated(stringResource(R.string.triage_updated_at, it)) }
        Freshness.STALE -> at?.let { ObliFreshness.Stale(stringResource(R.string.triage_data_of, it)) }
    }
}

@Composable
private fun OverflowMenu(ui: TriageUi, actions: TriageActions) {
    val c = ObliTheme.colors
    var open by remember { mutableStateOf(false) }
    Box {
        ObliIconButton(ObliIcons.EllipsisVertical, stringResource(R.string.triage_menu), { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = c.surface2) {
            val markAll = when {
                ui.multiServer -> pluralStringResource(R.plurals.triage_mark_all_read_servers, ui.markAllServers.size, ui.markAllServers.size)
                ui.sessionTenantName != null -> stringResource(R.string.triage_mark_all_read_tenant, ui.sessionTenantName)
                else -> stringResource(R.string.triage_mark_all_read)
            }
            val colors = MenuDefaults.itemColors(textColor = c.text, leadingIconColor = c.text2, disabledTextColor = c.textFaint, disabledLeadingIconColor = c.textFaint)
            DropdownMenuItem(
                text = { Text(markAll, style = ObliTypography.label) },
                leadingIcon = { Icon(ObliIcons.Check, null, Modifier.size(18.dp)) },
                enabled = ui.markAllServers.isNotEmpty(),
                onClick = {
                    open = false
                    actions.onMarkAllRead(ui.markAllServers)
                },
                colors = colors,
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.triage_refresh), style = ObliTypography.label) },
                leadingIcon = { Icon(ObliIcons.RefreshCw, null, Modifier.size(18.dp)) },
                onClick = {
                    open = false
                    actions.onRefresh()
                },
                colors = colors,
            )
        }
    }
}

/** Alertes / Approbations (STYLEKIT segmented): selected #222740 + 600, counts in mono. */
@Composable
private fun SegmentedControl(ui: TriageUi, onSelect: (TriageSegment) -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(8.dp)).background(c.surface1).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        listOf(
            Triple(TriageSegment.ALERTS, stringResource(R.string.triage_segment_alerts), ui.alertCount),
            Triple(TriageSegment.APPROVALS, stringResource(R.string.triage_segment_approvals), ui.approvalCount),
        ).forEach { (segment, label, count) ->
            val selected = ui.segment == segment
            Row(
                Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(6.dp))
                    .background(if (selected) c.active else androidx.compose.ui.graphics.Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(segment) }
                    .semantics { this.selected = selected },
                horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    label,
                    style = ObliTypography.label.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium),
                    color = if (selected) c.text else c.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(count.toString(), style = ObliTypography.monoCaption, color = if (selected) c.text2 else c.textMuted)
            }
        }
    }
}

/** Server dropdown (2+ servers) then severity toggles with counts (STYLEKIT chip-filter). */
@Composable
private fun FilterChips(ui: TriageUi, actions: TriageActions) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (ui.multiServer) ServerChip(ui, actions.onServer)
        ui.severityChips.forEach { chip ->
            val look = SeverityLook.of(chip.severity)
            val label = stringResource(look.label)
            val on = stringResource(R.string.triage_filter_on)
            Tap48(
                onClick = { actions.onSeverity(chip.severity) },
                role = Role.Checkbox,
                modifier = Modifier.semantics { stateDescription = if (chip.selected) on else "" },
                visual = Modifier.height(36.dp).background(if (chip.selected) c.active else c.surface2, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp),
            ) {
                if (chip.selected) {
                    Icon(ObliIcons.Check, null, tint = c.text, modifier = Modifier.size(14.dp))
                } else {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(look.text.toColor()))
                }
                Text(
                    label,
                    style = ObliTypography.label.copy(fontWeight = if (chip.selected) FontWeight.SemiBold else FontWeight.Medium),
                    color = if (chip.selected) c.text else c.text2,
                    maxLines = 1,
                )
                Text(chip.count.toString(), style = ObliTypography.monoCaption, color = c.textMuted)
            }
        }
    }
}

@Composable
private fun ServerChip(ui: TriageUi, onServer: (ServerId?) -> Unit) {
    val c = ObliTheme.colors
    var open by remember { mutableStateOf(false) }
    val selected = ui.serverFilter
    Box {
        Tap48(
            onClick = { open = true },
            visual = Modifier.height(36.dp).background(if (selected != null) c.active else c.surface2, RoundedCornerShape(8.dp)).padding(start = if (selected != null) 8.dp else 12.dp, end = 8.dp),
        ) {
            if (selected != null) ObliServerTile(selected.color, selected.monogram, selected.displayName, size = 20.dp)
            Text(
                selected?.displayName ?: stringResource(R.string.triage_filter_all_servers),
                style = ObliTypography.label,
                color = if (selected != null) c.text else c.text2,
                maxLines = 1,
            )
            Icon(ObliIcons.ChevronDown, null, tint = c.textMuted, modifier = Modifier.size(16.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = c.surface2) {
            val colors = MenuDefaults.itemColors(textColor = c.text)
            DropdownMenuItem(
                text = { Text(stringResource(R.string.triage_filter_all_servers), style = ObliTypography.label) },
                trailingIcon = { if (selected == null) Icon(ObliIcons.Check, null, tint = c.text, modifier = Modifier.size(16.dp)) },
                onClick = {
                    open = false
                    onServer(null)
                },
                colors = colors,
            )
            ui.serverChips.forEach { chip ->
                DropdownMenuItem(
                    leadingIcon = { ObliServerTile(chip.profile.color, chip.profile.monogram, chip.profile.displayName, size = 20.dp) },
                    text = {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(chip.profile.displayName, style = ObliTypography.label, color = c.text)
                            Text(chip.unread.toString(), style = ObliTypography.monoCaption, color = c.textMuted)
                        }
                    },
                    trailingIcon = { if (chip.selected) Icon(ObliIcons.Check, null, tint = c.text, modifier = Modifier.size(16.dp)) },
                    onClick = {
                        open = false
                        onServer(chip.profile.id)
                    },
                    colors = colors,
                )
            }
        }
    }
}

@Composable
private fun AlertsList(ui: TriageUi, time: TriageTime, listState: LazyListState, actions: TriageActions) {
    val expandedOutages = remember { mutableStateMapOf<String, Boolean>() }
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 88.dp),
    ) {
        if (ui.offline && ui.listState != ListState.ERROR) {
            item("offline") {
                NoticeLine(TriageIcons.WifiOff, ui.updatedAt?.let { stringResource(R.string.triage_offline_since, it.hhmm(time.zone)) } ?: stringResource(R.string.triage_offline))
            }
        }
        items(ui.notices, key = { "notice-${it.server.id.value}" }) { n ->
            when (n) {
                is FeedNotice.Unreachable -> NoticeLine(
                    TriageIcons.WifiOff,
                    n.lastOkAt?.let { stringResource(R.string.triage_notice_unreachable_since, n.server.displayName, it.hhmm(time.zone)) }
                        ?: stringResource(R.string.triage_notice_unreachable, n.server.displayName),
                )
                is FeedNotice.Expired -> NoticeLine(
                    ObliIcons.Lock,
                    stringResource(R.string.triage_notice_expired, n.server.displayName),
                    action = stringResource(R.string.triage_notice_reconnect),
                    onAction = { actions.onReconnect(n.server.id) },
                )
            }
        }
        if (ui.escalations.isNotEmpty()) {
            item("escalations") {
                Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp)) {
                    EscalationsSection(ui.escalations, time, onOpen = actions.onReview, onShowAll = { actions.onSegment(TriageSegment.APPROVALS) })
                }
            }
        }
        when (ui.listState) {
            ListState.LOADING -> items(3, key = { "skeleton-$it" }) {
                Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp)) { SkeletonCard() }
            }
            ListState.ERROR -> item("error") { ErrorCard(actions.onRefresh) }
            ListState.EMPTY -> item("empty") {
                val at = ui.updatedAt?.hhmm(time.zone)
                val detail = when {
                    at == null -> stringResource(R.string.triage_empty_realtime)
                    ui.freshness == Freshness.LIVE -> stringResource(R.string.triage_empty_checked_live, at)
                    else -> stringResource(R.string.triage_empty_checked, at)
                }
                CalmTriage(detail)
            }
            ListState.CONTENT -> {
                items(ui.outages, key = { "outage-${it.outage.serverId.value}-${it.outage.tenantId}-${it.outage.from}" }) { o ->
                    val id = "${o.outage.serverId.value}-${o.outage.tenantId}-${o.outage.from}"
                    Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp)) {
                        CorrelationCard(
                            o,
                            time,
                            expanded = expandedOutages[id] == true,
                            onToggle = { expandedOutages[id] = expandedOutages[id] != true },
                            onOpenDevice = { deviceId -> actions.onOpenDevice(o.outage.serverId, deviceId) },
                        )
                    }
                }
                item("unread-header") {
                    SectionHeader(
                        stringResource(R.string.triage_section_unread, ui.unread.size),
                        Modifier.padding(top = 6.dp),
                        trailing = stringResource(R.string.triage_section_by_priority),
                    )
                }
                if (ui.filteredOut) {
                    item("filtered-out") { FilteredOut(actions.onClearSeverities) }
                }
                items(ui.unread, key = { "u-${it.key.serverId.value}-${it.key.id}" }) { item ->
                    SwipeableIncident(item, time, actions, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp))
                }
            }
        }
        if (ui.read.isNotEmpty() && ui.listState != ListState.LOADING && ui.listState != ListState.ERROR) {
            item("read-header") { ReadHeader(ui.read.size, ui.readExpanded, actions.onToggleRead) }
            if (ui.readExpanded) {
                items(ui.read, key = { "r-${it.key.serverId.value}-${it.key.id}" }) { item ->
                    SwipeableIncident(item, time, actions, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp))
                }
            }
        }
    }
}

@Composable
private fun ApprovalsList(ui: TriageUi, time: TriageTime, actions: TriageActions) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (ui.approvals.isEmpty()) {
            item("approvals-empty") {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(TriageIcons.ShieldAlert, null, tint = ObliTheme.colors.textMuted, modifier = Modifier.size(24.dp))
                    Text(stringResource(R.string.triage_approvals_empty), style = ObliTypography.cardTitle, color = ObliTheme.colors.text)
                    Text(stringResource(R.string.triage_approvals_empty_body), style = ObliTypography.body, color = ObliTheme.colors.text2)
                }
            }
        }
        items(ui.approvals, key = { "a-${it.item.serverId.value}-${it.item.approval.id}" }) { e ->
            ApprovalCard(e, time, onDeny = { actions.onReview(e) }, onReview = { actions.onReview(e) })
        }
    }
}

@Composable
private fun ReadHeader(count: Int, expanded: Boolean, onToggle: () -> Unit) {
    val c = ObliTheme.colors
    val state = stringResource(if (expanded) R.string.triage_expanded else R.string.triage_collapsed)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 6.dp).clickable(role = Role.Button, onClick = onToggle)
            .semantics { stateDescription = state }
            .padding(start = 16.dp, end = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.triage_section_read, count).uppercase(), style = ObliTypography.overline, color = c.textMuted, modifier = Modifier.weight(1f).semantics { heading() })
        Icon(ObliIcons.ChevronDown, null, tint = c.textMuted, modifier = Modifier.size(18.dp).rotate(if (expanded) 180f else 0f))
    }
}

@Composable
private fun FilteredOut(onClear: () -> Unit) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.triage_filtered_out), style = ObliTypography.body, color = c.text2)
        TonalButton(stringResource(R.string.triage_filter_clear), onClear)
    }
}

@Composable
private fun ErrorCard(onRetry: () -> Unit) {
    val c = ObliTheme.colors
    Column(
        Modifier.padding(16.dp).fillMaxWidth().obliCard(color = c.surface1).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(TriageIcons.WifiOff, null, tint = c.text2, modifier = Modifier.size(18.dp))
            Text(stringResource(R.string.triage_error_title), style = ObliTypography.cardTitle, color = c.text)
        }
        Text(stringResource(R.string.triage_error_body), style = ObliTypography.body, color = c.text2)
        TonalButton(stringResource(R.string.triage_retry), onRetry, icon = ObliIcons.RefreshCw)
    }
}

@Composable
private fun NewAlertsPill(count: Int, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val label = pluralStringResource(R.plurals.triage_new_alerts, count, count)
    Tap48(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        visual = Modifier.shadow(12.dp, RoundedCornerShape(50)).height(40.dp).background(c.active, RoundedCornerShape(50)).padding(start = 12.dp, end = 16.dp),
    ) {
        Icon(TriageIcons.ArrowUp, null, tint = ObliTheme.colors.accent2, modifier = Modifier.size(16.dp))
        Text(label, style = ObliTypography.label, color = c.text)
    }
}

/**
 * Swipe right = mark as read (immediate), swipe left = delete (5 s undo before
 * the call); threshold 40 % with a haptic tick (§7.1). Both have TalkBack actions.
 */
@Composable
private fun SwipeableIncident(item: IncidentUi, time: TriageTime, actions: TriageActions, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val state = rememberSwipeToDismissBoxState(positionalThreshold = { it * 0.4f })
    var armed by rememberSaveable(item.key.id) { mutableStateOf(false) }
    LaunchedEffect(state) {
        snapshotFlow { state.targetValue }.collect { target ->
            val now = target != SwipeToDismissBoxValue.Settled
            if (now && !armed) haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
            armed = now
        }
    }
    val markReadLabel = stringResource(R.string.triage_action_mark_read)
    val deleteLabel = stringResource(R.string.triage_action_delete)
    val a11y = buildList {
        if (item.unread) add(CustomAccessibilityAction(markReadLabel) { actions.onMarkRead(item); true })
        if (item.canDelete) add(CustomAccessibilityAction(deleteLabel) { actions.onDelete(item); true })
    }
    SwipeToDismissBox(
        state = state,
        modifier = modifier,
        enableDismissFromStartToEnd = item.unread,
        enableDismissFromEndToStart = item.canDelete,
        onDismiss = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> {
                    actions.onMarkRead(item)
                    scope.launch { state.reset() }
                }
                SwipeToDismissBoxValue.EndToStart -> actions.onDelete(item)
                SwipeToDismissBoxValue.Settled -> Unit
            }
        },
        backgroundContent = {
            val direction = state.dismissDirection
            val read = direction == SwipeToDismissBoxValue.StartToEnd
            if (direction != SwipeToDismissBoxValue.Settled) {
                Row(
                    Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(c.hover).padding(horizontal = 20.dp),
                    horizontalArrangement = if (read) Arrangement.Start else Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(if (read) TriageIcons.MailOpen else ObliIcons.Trash, null, tint = c.text, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.size(10.dp))
                    Text(if (read) markReadLabel else deleteLabel, style = ObliTypography.label, color = c.text)
                }
            }
        },
    ) {
        IncidentCard(
            item,
            time,
            onOpen = item.deviceId?.let { id -> { actions.onOpenDevice(item.key.serverId, id) } },
            a11yActions = a11y,
        )
    }
}
