package tools.obli.obliance.automations

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.ZoneId
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliFreshness
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliScreenHeader
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.security.ui.LocalActionFeedback
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.api.Approval
import tools.obli.obliance.data.LocalObliServices

/**
 * S55 Activité (design doc §5 S55) of the ACTIVE server: what runs, what I
 * launched, what I wait for, and what I can launch.
 *
 * @param onRunScript extended FAB "Exécuter un script" → S50 without targets.
 * @param onOpenScript a recent script chip → S51 with that script, no targets yet.
 * @param onOpenScripts Scripts "Tout voir" → S50.
 * @param onOpenSchedules Planifications "Tout voir" → [SchedulesScreen].
 * @param onOpenScenarios Scénarios "Tout voir" → [ScenariosScreen].
 * @param onOpenBatch a batch (in flight or history) → [BatchScreen].
 * @param sessions slot of the remote module: "Sessions ouvertes" (draws its own title; nothing when empty).
 */
@Composable
fun ActivityScreen(
    onRunScript: () -> Unit,
    onOpenScript: (ServerId, Long) -> Unit,
    onOpenScripts: () -> Unit,
    onOpenSchedules: () -> Unit,
    onOpenScenarios: () -> Unit,
    onOpenBatch: (ServerId, String) -> Unit,
    sessions: @Composable () -> Unit = {},
) {
    val services = LocalObliServices.current
    val remote = rememberAutomationsRemote()
    val clock = LocalAutomationsClock.current
    val vm = viewModel { ActivityViewModel(services, remote, clock.now) }
    val state by vm.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(vm, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.follow() } }
    val live by vm.live.collectAsStateWithLifecycle()
    val runner = LocalActionRunner.current
    val feedback = LocalActionFeedback.current
    val scope = rememberCoroutineScope()
    val cancelTitle = stringResource(R.string.automations_approval_cancel)
    val cancelConsequence = stringResource(R.string.automations_approval_cancel_consequence)
    val cancelled = stringResource(R.string.automations_approval_cancelled)

    ActivityContent(
        state = state,
        live = live,
        zone = clock.zone,
        actions = ActivityActions(
            onRunScript = onRunScript,
            onOpenScript = { id -> state.serverId?.let { onOpenScript(it, id) } },
            onOpenScripts = onOpenScripts,
            onOpenSchedules = onOpenSchedules,
            onOpenScenarios = onOpenScenarios,
            onOpenBatch = { b -> state.serverId?.let { onOpenBatch(it, b.batchId) } },
            onMineOnly = vm::setMineOnly,
            onRefresh = vm::refresh,
            onCancelApproval = { a -> scope.launch { feedback.show(vm.cancelApproval(a, runner, cancelTitle, cancelConsequence), cancelled) } },
        ),
        sessions = sessions,
    )
}

internal class ActivityActions(
    val onRunScript: () -> Unit = {},
    val onOpenScript: (Long) -> Unit = {},
    val onOpenScripts: () -> Unit = {},
    val onOpenSchedules: () -> Unit = {},
    val onOpenScenarios: () -> Unit = {},
    val onOpenBatch: (BatchSummary) -> Unit = {},
    val onMineOnly: (Boolean) -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onCancelApproval: (Approval) -> Unit = {},
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ActivityContent(
    state: ActivityUiState,
    live: Boolean,
    zone: ZoneId,
    actions: ActivityActions,
    sessions: @Composable () -> Unit = {},
) {
    val c = ObliTheme.colors
    Box(Modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            ObliScreenHeader(
                title = stringResource(R.string.automations_activity_title),
                freshness = when {
                    live -> ObliFreshness.Live
                    state.updatedAt != null -> ObliFreshness.Updated(stringResource(R.string.automations_updated_at, Fmt.hm(state.updatedAt, zone)))
                    else -> null
                },
                liveLabel = stringResource(R.string.automations_live),
            )
            PullToRefreshBox(isRefreshing = false, onRefresh = actions.onRefresh, modifier = Modifier.fillMaxSize()) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item(key = "sessions") { sessions() }
                    val problem = state.problem
                    if (problem != null && state.batches.isEmpty()) {
                        item(key = "problem") { ProblemCard(problem, actions.onRefresh) }
                    }
                    if (state.inFlight.isNotEmpty()) {
                        item(key = "running-title") { SectionTitle(stringResource(R.string.automations_section_running), count = state.inFlight.size) }
                        items(state.inFlight, key = { "run-" + it.batchId }) { b -> InFlightCard(b, state, zone, actions) }
                    }
                    val approvals = state.approvals.orEmpty()
                    if (approvals.isNotEmpty()) {
                        item(key = "approvals-title") { SectionTitle(stringResource(R.string.automations_section_approvals), count = approvals.count { it.isPending }) }
                        items(approvals, key = { "apr-" + it.id }) { a -> ApprovalRow(a, state.scriptRunOf(a), zone, a.id in state.cancelling, actions) }
                    }
                    item(key = "auto-title") { SectionTitle(stringResource(R.string.automations_section_automations)) }
                    item(key = "auto") { AutomationsCard(state, zone, actions) }
                    item(key = "history-title") { HistoryHeader(state, actions) }
                    val history = state.history
                    if (history.isEmpty() && !state.loading && problem == null) {
                        item(key = "history-empty") {
                            Text(
                                stringResource(if (state.mineOnly) R.string.automations_history_empty_mine else R.string.automations_history_empty),
                                style = ObliTypography.body,
                                color = c.textMuted,
                                modifier = Modifier.padding(vertical = 12.dp),
                            )
                        }
                    }
                    items(history, key = { "h-" + it.batchId }) { b -> HistoryRow(b, zone, actions) }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = actions.onRunScript,
            containerColor = c.accentFill,
            contentColor = c.onAccentFill,
            icon = { Icon(AutomationsIcons.Play, contentDescription = null, modifier = Modifier.size(18.dp)) },
            text = { Text(stringResource(R.string.automations_run_script), style = ObliTypography.label) },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        )
    }
}

@Composable
private fun InFlightCard(b: BatchSummary, state: ActivityUiState, zone: ZoneId, actions: ActivityActions) {
    val c = ObliTheme.colors
    val counts = BatchCounts(success = b.successCount, failure = b.failureCount, running = b.runningCount, queued = b.pendingCount)
    val legend = listOfNotNull(
        pluralStringResource(R.plurals.automations_count_success, b.successCount, b.successCount).takeIf { b.successCount > 0 },
        pluralStringResource(R.plurals.automations_count_failure, b.failureCount, b.failureCount).takeIf { b.failureCount > 0 },
        pluralStringResource(R.plurals.automations_count_running, b.runningCount, b.runningCount).takeIf { b.runningCount > 0 },
        pluralStringResource(R.plurals.automations_count_queued, b.pendingCount, b.pendingCount).takeIf { b.pendingCount > 0 },
    ).joinToString(" · ")
    val tenant = state.tenantName
    val sub = listOfNotNull(tenant, devicesCount(b.totalCount), Fmt.time(b.triggeredAt, zone)).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1)
            .clickable(role = Role.Button, onClickLabel = stringResource(R.string.automations_open_batch)) { actions.onOpenBatch(b) }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ProgressRing(counts, size = 48.dp, stroke = 5.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(b.scheduleName ?: b.scriptName, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (legend.isNotEmpty()) Text(legend, style = ObliTypography.labelSmall, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun ApprovalRow(a: Approval, scriptRun: Pair<String, Int>?, zone: ZoneId, busy: Boolean, actions: ActivityActions) {
    val c = ObliTheme.colors
    val amber = ObliTokens.Status.WARNING.argb.toColor()
    val status = when (a.status) {
        "pending" -> a.expiresAt?.let { Fmt.time(it, zone) }?.let { stringResource(R.string.automations_approval_pending_until, it) } ?: stringResource(R.string.automations_approval_pending)
        "approved" -> stringResource(R.string.automations_approval_approved, a.reviewedByName ?: "—")
        "denied" -> stringResource(R.string.automations_approval_denied, a.reviewedByName ?: "—")
        "expired" -> stringResource(R.string.automations_approval_expired)
        "cancelled" -> stringResource(R.string.automations_approval_cancelled_state)
        else -> a.status
    }
    AutoCard(padding = PaddingValues(12.dp)) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(if (a.isPending) ObliIcons.Clock else ObliIcons.Info, contentDescription = null, tint = if (a.isPending) amber else c.textMuted, modifier = Modifier.padding(top = 2.dp).size(18.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    scriptRun?.let { (name, n) -> stringResource(R.string.automations_approval_script_run, name, devicesCount(n)) } ?: a.description,
                    style = ObliTypography.rowTitle.copy(fontWeight = FontWeight.Medium),
                    color = c.text,
                )
                Text(status, style = ObliTypography.labelSmall, color = if (a.isPending) amber else c.textMuted)
            }
        }
        if (a.isPending) {
            NeutralButton(stringResource(R.string.automations_approval_cancel), { actions.onCancelApproval(a) }, busy = busy, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun AutomationsCard(state: ActivityUiState, zone: ZoneId, actions: ActivityActions) {
    val c = ObliTheme.colors
    AutoCard(padding = PaddingValues(vertical = 8.dp)) {
        // Scripts
        EntryHeader(
            icon = AutomationsIcons.FileCode,
            title = stringResource(R.string.automations_entry_scripts),
            action = state.scriptCount?.let { stringResource(R.string.automations_see_all_count, it) } ?: stringResource(R.string.automations_see_all),
            onAction = actions.onOpenScripts,
        )
        val recent = state.recentScripts
        if (recent.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                recent.forEach { (id, name) ->
                    Box(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button) { actions.onOpenScript(id) }, contentAlignment = Alignment.Center) {
                        Row(
                            Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2).padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(AutomationsIcons.Play, contentDescription = null, tint = c.text2, modifier = Modifier.size(14.dp))
                            Text(name, style = ObliTypography.label, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 240.dp))
                        }
                    }
                }
            }
        }
        Hairline(Modifier.padding(horizontal = 16.dp))
        // Schedules
        EntryHeader(
            icon = AutomationsIcons.CalendarClock,
            title = stringResource(R.string.automations_entry_schedules),
            action = state.schedules?.let { pluralStringResource(R.plurals.automations_see_all_active, state.activeSchedules.size, state.activeSchedules.size) } ?: stringResource(R.string.automations_see_all),
            onAction = actions.onOpenSchedules,
        )
        state.activeSchedules.take(2).forEach { s -> ScheduleLine(s, state.lastRunOf(s.id), zone, actions.onOpenSchedules) }
        if (state.schedules != null && state.activeSchedules.isEmpty()) {
            Text(stringResource(R.string.automations_schedules_none), style = ObliTypography.labelSmall, color = c.textMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        Hairline(Modifier.padding(horizontal = 16.dp))
        // Scenarios
        EntryHeader(
            icon = AutomationsIcons.Zap,
            title = stringResource(R.string.automations_entry_scenarios),
            action = stringResource(R.string.automations_see_all),
            onAction = actions.onOpenScenarios,
        )
        state.topScenarios.forEach { s -> ScenarioLine(s, actions.onOpenScenarios) }
        if (state.scenarios != null && state.topScenarios.isEmpty()) {
            Text(stringResource(R.string.automations_scenarios_none_active), style = ObliTypography.labelSmall, color = c.textMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
    }
}

@Composable
private fun EntryHeader(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, action: String, onAction: () -> Unit) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = action, onClick = onAction).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
        Text(title, style = ObliTypography.rowTitle, color = c.text, modifier = Modifier.weight(1f))
        Text(action, style = ObliTypography.labelSmall, color = c.text2)
        Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
    }
}

@Composable
internal fun ScheduleLine(s: ScheduleDto, last: BatchSummary?, zone: ZoneId, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val count = s.resolvedDeviceCount
    val sub = listOfNotNull(cronText(CronDesc.of(s.cronExpression, s.fireOnceAt), zone), count?.let { devicesCount(it) }).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(s.name, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (last != null) ResultCounts(last.successCount, last.failureCount)
    }
}

/** « 5 ✓ 1 ✗ » with icons (never colour alone), TalkBack reads « 5 réussis, 1 échec ». */
@Composable
internal fun ResultCounts(ok: Int, ko: Int) {
    val c = ObliTheme.colors
    val desc = listOfNotNull(
        pluralStringResource(R.plurals.automations_count_success, ok, ok),
        pluralStringResource(R.plurals.automations_count_failure, ko, ko).takeIf { ko > 0 },
    ).joinToString(", ")
    Row(Modifier.semantics(mergeDescendants = true) { contentDescription = desc }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(ok.toString(), style = ObliTypography.monoCaption, color = c.text2)
        Icon(ObliIcons.Check, contentDescription = null, tint = ExecStep.SUCCESS.color, modifier = Modifier.size(14.dp))
        if (ko > 0) {
            Spacer(Modifier.size(4.dp))
            Text(ko.toString(), style = ObliTypography.monoCaption, color = c.text2)
            Icon(ObliIcons.X, contentDescription = null, tint = ExecStep.FAILURE.color, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun ScenarioLine(s: ScenarioDto, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val (status, _) = scenarioStatus(s.status)
    val sub = (triggerLabels(s) + status).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(s.name, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (s.activeRunCount > 0) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(AutomationsIcons.Loader, contentDescription = null, tint = ExecStep.RUNNING.color, modifier = Modifier.size(14.dp))
                Text(pluralStringResource(R.plurals.automations_count_running, s.activeRunCount, s.activeRunCount), style = ObliTypography.labelSmall, color = c.text2)
            }
        }
    }
}

@Composable
private fun HistoryHeader(state: ActivityUiState, actions: ActivityActions) {
    Column {
        SectionTitle(stringResource(R.string.automations_section_history))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Segment(stringResource(R.string.automations_history_mine), state.mineOnly) { actions.onMineOnly(true) }
            Segment(stringResource(R.string.automations_history_all), !state.mineOnly) { actions.onMineOnly(false) }
        }
    }
}

@Composable
private fun Segment(label: String, selected: Boolean, onClick: () -> Unit) {
    val c = ObliTheme.colors
    Box(Modifier.heightIn(min = 48.dp).selectable(selected = selected, role = Role.Tab, onClick = onClick), contentAlignment = Alignment.Center) {
        Text(
            label,
            style = ObliTypography.label.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium),
            color = if (selected) c.text else c.text2,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (selected) c.active else c.surface2).padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun HistoryRow(b: BatchSummary, zone: ZoneId, actions: ActivityActions) {
    val c = ObliTheme.colors
    val kind = if (b.scheduleId != null) stringResource(R.string.automations_kind_schedule) else stringResource(R.string.automations_kind_manual)
    val sub = listOfNotNull(kind, Fmt.time(b.triggeredAt, zone), devicesCount(b.totalCount), b.triggeredByUsername?.takeIf { b.scheduleId == null }).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1)
            .clickable(role = Role.Button, onClickLabel = stringResource(R.string.automations_open_batch)) { actions.onOpenBatch(b) }
            .heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(b.scheduleName ?: b.scriptName, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        ResultCounts(b.successCount, b.failureCount)
    }
}
