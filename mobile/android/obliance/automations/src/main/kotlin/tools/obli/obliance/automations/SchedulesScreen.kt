package tools.obli.obliance.automations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.ZoneId
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.security.ui.LocalActionFeedback
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.data.LocalObliNavigator
import tools.obli.obliance.data.LocalObliServices

/**
 * S57 Planifications (read-only list, design doc §5 S57) of the ACTIVE
 * server: cron in words, targets, last result, next run and the pause switch
 * (T1). Creation and edition open the web view (`/automations`).
 */
@Composable
fun SchedulesScreen(onBack: () -> Unit) {
    val services = LocalObliServices.current
    val remote = rememberAutomationsRemote()
    val clock = LocalAutomationsClock.current
    val vm = viewModel { SchedulesViewModel(services, remote) }
    val state by vm.state.collectAsStateWithLifecycle()
    val runner = LocalActionRunner.current
    val feedback = LocalActionFeedback.current
    val navigator = LocalObliNavigator.current
    val scope = rememberCoroutineScope()
    val pause = stringResource(R.string.automations_schedule_pause)
    val resume = stringResource(R.string.automations_schedule_resume)
    val pauseConsequence = stringResource(R.string.automations_schedule_pause_consequence)
    val paused = stringResource(R.string.automations_schedule_paused)
    val resumed = stringResource(R.string.automations_schedule_resumed)
    val webTitle = stringResource(R.string.automations_web_automations)
    SchedulesContent(
        state = state,
        zone = clock.zone,
        onBack = onBack,
        onToggle = { s, on ->
            scope.launch {
                val r = vm.setEnabled(s, on, runner, if (on) resume else pause, if (on) null else pauseConsequence)
                feedback.show(r, if (on) resumed else paused)
            }
        },
        onOpenWeb = { navigator.openWeb(WEB_AUTOMATIONS, webTitle) },
        onRetry = vm::refresh,
    )
}

/** Web route of the automations page (client/src/App.tsx `/automations`, schedules tab by default). */
internal const val WEB_AUTOMATIONS = "/automations"

@Composable
internal fun SchedulesContent(
    state: SchedulesUiState,
    zone: ZoneId,
    onBack: () -> Unit,
    onToggle: (ScheduleDto, Boolean) -> Unit,
    onOpenWeb: () -> Unit,
    onRetry: () -> Unit,
) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliDetailTopBar(
            title = stringResource(R.string.automations_schedules_title),
            onBack = onBack,
            backLabel = stringResource(R.string.automations_back),
            subtitle = if (state.loading) null else pluralStringResource(R.plurals.automations_schedules_active, state.activeCount, state.activeCount),
            actions = { ObliIconButton(AutomationsIcons.ExternalLink, stringResource(R.string.automations_edit_in_web), onOpenWeb) },
        )
        Box(Modifier.weight(1f)) {
            val problem = state.problem
            when {
                state.loading && state.schedules.isEmpty() -> CenterSpinner()
                problem != null && state.schedules.isEmpty() -> ProblemCard(problem, onRetry, Modifier.padding(16.dp))
                state.schedules.isEmpty() -> ObliCalmState(
                    title = stringResource(R.string.automations_schedules_empty),
                    body = stringResource(R.string.automations_schedules_empty_body),
                    icon = AutomationsIcons.CalendarClock,
                    action = { NeutralButton(stringResource(R.string.automations_edit_in_web), onOpenWeb, icon = AutomationsIcons.ExternalLink) },
                )
                else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.schedules, key = { it.id }) { s ->
                        ScheduleRow(s, state.lastRuns[s.id], state.readOnly(s), s.id in state.busy, zone, onToggle)
                    }
                }
            }
        }
    }
}

@Composable
private fun ScheduleRow(s: ScheduleDto, last: BatchSummary?, readOnly: Boolean, busy: Boolean, zone: ZoneId, onToggle: (ScheduleDto, Boolean) -> Unit) {
    val c = ObliTheme.colors
    val cron = cronText(CronDesc.of(s.cronExpression, s.fireOnceAt), zone)
    val targets = s.resolvedDeviceCount?.let { devicesCount(it) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1).padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .toggleable(value = s.enabled, enabled = !readOnly && !busy, role = Role.Switch) { onToggle(s, it) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(s.name, style = ObliTypography.rowTitle, color = if (s.enabled) c.text else c.text2, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(cron, targets).joinToString(" · "), style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Switch(
                checked = s.enabled,
                onCheckedChange = null,
                enabled = !readOnly && !busy,
                colors = SwitchDefaults.colors(
                    checkedTrackColor = ObliTokens.Status.ONLINE.argb.toColor().copy(alpha = 0.55f),
                    checkedThumbColor = c.text,
                    uncheckedTrackColor = c.hover,
                    uncheckedThumbColor = c.textMuted,
                    uncheckedBorderColor = c.divider,
                ),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!s.enabled) Text(stringResource(R.string.automations_schedule_paused_state), style = ObliTypography.labelSmall, color = c.text2)
            else Fmt.time(s.nextRunAt, zone)?.let { Text(stringResource(R.string.automations_schedule_next, it), style = ObliTypography.labelSmall, color = c.text2) }
            if (last != null) {
                Text(stringResource(R.string.automations_schedule_last), style = ObliTypography.labelSmall, color = c.textMuted)
                ResultCounts(last.successCount, last.failureCount)
            }
        }
        if (readOnly) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(ObliIcons.Lock, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(12.dp))
                Text(stringResource(R.string.automations_managed_by_master), style = ObliTypography.labelSmall, color = c.textMuted)
            }
        }
    }
}
