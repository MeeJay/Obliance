package tools.obli.obliance.automations

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.ZoneId
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.security.ui.LocalActionFeedback
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.api.Device
import tools.obli.obliance.data.LocalObliNavigator
import tools.obli.obliance.data.LocalObliServices

/**
 * S58 Scénarios et exécutions (design doc §5 S58) of the ACTIVE server:
 * list → runs of a scenario → node timeline of a run (inner navigation, back
 * goes up one level). Enable / disable (T1), "Déclencher sur…" (device
 * picker → start-graph-run, T2), "Annuler les exécutions" (T2). Create and
 * edit open the web editor ([WEB_SCENARIOS]).
 */
@Composable
fun ScenariosScreen(onBack: () -> Unit) {
    val services = LocalObliServices.current
    val remote = rememberAutomationsRemote()
    val clock = LocalAutomationsClock.current
    val vm = viewModel { ScenariosViewModel(services, remote) }
    val state by vm.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(vm, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.follow() } }
    val runner = LocalActionRunner.current
    val feedback = LocalActionFeedback.current
    val navigator = LocalObliNavigator.current
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    val texts = ScenarioTexts(
        enable = res.getString(R.string.automations_scenario_enable),
        disable = res.getString(R.string.automations_scenario_disable),
        disableConsequence = res.getString(R.string.automations_scenario_disable_consequence),
        start = res.getString(R.string.automations_scenario_start),
        startTarget = { n, single -> single ?: res.getQuantityString(R.plurals.automations_devices, n, n) },
        startConsequence = res.getString(R.string.automations_scenario_start_consequence),
        cancelRuns = res.getString(R.string.automations_scenario_cancel_runs),
        cancelConsequence = { n -> res.getQuantityString(R.plurals.automations_scenario_cancel_consequence, n, n) },
        notActive = { name -> res.getString(R.string.automations_not_active_server, name) },
    )
    val webTitle = stringResource(R.string.automations_web_scenarios)
    var picking by remember { mutableStateOf<ScenarioDto?>(null) }

    ScenariosContent(
        state = state,
        zone = clock.zone,
        actions = ScenarioActions(
            onBack = onBack,
            onOpen = { vm.openScenario(it.id) },
            onCloseScenario = { vm.openScenario(null) },
            onOpenRun = vm::openRun,
            onCloseRun = { vm.openRun(null) },
            onToggle = { s ->
                val on = s.status != "active"
                scope.launch { feedback.show(vm.setEnabled(s, on, runner, texts), res.getString(if (on) R.string.automations_scenario_enabled else R.string.automations_scenario_disabled_done)) }
            },
            onStart = { picking = it },
            onCancelRuns = { s -> scope.launch { feedback.show(vm.cancelRuns(s, runner, texts), res.getString(R.string.automations_scenario_runs_cancelled)) } },
            onEditInWeb = { navigator.openWeb(WEB_SCENARIOS, webTitle) },
            onRetry = vm::refresh,
        ),
    )
    picking?.let { s ->
        BoxWithConstraints(Modifier.fillMaxSize()) {
            DevicePickerPanel(
                title = stringResource(R.string.automations_scenario_start_on, s.name),
                confirm = { n -> if (n == 0) res.getString(R.string.automations_scenario_start) else res.getQuantityString(R.plurals.automations_scenario_start_n, n, n) },
                already = emptySet(),
                wide = maxWidth >= 600.dp,
                search = vm::searchDevices,
                onDismiss = { picking = null },
                onDone = { devices: List<Device> ->
                    picking = null
                    scope.launch { feedback.show(vm.start(s, devices, runner, texts), res.getString(R.string.automations_scenario_started)) }
                },
            )
        }
    }
}

/**
 * Web route of the scenario editor: the Scénarios tab of /automations
 * (client/src/pages/SchedulesPage.tsx `?tab=scenarios`). The web keeps the
 * open scenario in local state: there is no per-scenario URL to deep-link to.
 */
internal const val WEB_SCENARIOS = "/automations?tab=scenarios"

internal class ScenarioActions(
    val onBack: () -> Unit = {},
    val onOpen: (ScenarioDto) -> Unit = {},
    val onCloseScenario: () -> Unit = {},
    val onOpenRun: (ScenarioRunDto) -> Unit = {},
    val onCloseRun: () -> Unit = {},
    val onToggle: (ScenarioDto) -> Unit = {},
    val onStart: (ScenarioDto) -> Unit = {},
    val onCancelRuns: (ScenarioDto) -> Unit = {},
    val onEditInWeb: () -> Unit = {},
    val onRetry: () -> Unit = {},
)

@Composable
internal fun ScenariosContent(state: ScenariosUiState, zone: ZoneId, actions: ScenarioActions) {
    val c = ObliTheme.colors
    val scenario = state.scenario
    val run = state.openRun
    Box(Modifier.fillMaxSize().background(c.bg)) {
        when {
            scenario != null && run != null -> {
                BackHandler(onBack = actions.onCloseRun)
                RunTimeline(state, run, zone, actions)
            }
            scenario != null -> {
                BackHandler(onBack = actions.onCloseScenario)
                ScenarioDetail(state, scenario, zone, actions)
            }
            else -> ScenarioList(state, actions)
        }
    }
}

@Composable
private fun ScenarioList(state: ScenariosUiState, actions: ScenarioActions) {
    Column(Modifier.fillMaxSize()) {
        ObliDetailTopBar(
            title = stringResource(R.string.automations_scenarios_title),
            onBack = actions.onBack,
            backLabel = stringResource(R.string.automations_back),
            subtitle = if (state.loading) null else pluralStringResource(R.plurals.automations_scenarios_count, state.total, state.total),
            actions = { ObliIconButton(ObliIcons.Plus, stringResource(R.string.automations_scenario_create), actions.onEditInWeb) },
        )
        Box(Modifier.weight(1f)) {
            val problem = state.problem
            when {
                state.loading && state.scenarios.isEmpty() -> CenterSpinner()
                problem != null && state.scenarios.isEmpty() -> ProblemCard(problem, actions.onRetry, Modifier.padding(16.dp))
                state.scenarios.isEmpty() -> ObliCalmState(
                    title = stringResource(R.string.automations_scenarios_empty),
                    body = stringResource(R.string.automations_scenarios_empty_body),
                    icon = AutomationsIcons.Zap,
                    action = { NeutralButton(stringResource(R.string.automations_scenario_create), actions.onEditInWeb, icon = AutomationsIcons.ExternalLink) },
                )
                else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.scenarios, key = { it.id }) { s -> ScenarioRow(s, state.readOnly(s), actions) }
                    if (state.truncated) {
                        item { Text(stringResource(R.string.automations_scenarios_truncated, state.scenarios.size), style = ObliTypography.labelSmall, color = ObliTheme.colors.textMuted, modifier = Modifier.padding(8.dp)) }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ScenarioRow(s: ScenarioDto, readOnly: Boolean, actions: ScenarioActions) {
    val c = ObliTheme.colors
    val (status, dot) = scenarioStatus(s.status)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1)
            .clickable(role = Role.Button, onClickLabel = stringResource(R.string.automations_scenario_open_runs)) { actions.onOpen(s) }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(s.name, style = ObliTypography.rowTitle, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            triggerLabels(s).forEach { MonoTag(it) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            DotLabel(status, dot)
            if (s.nodeCount > 0) Text(pluralStringResource(R.plurals.automations_nodes, s.nodeCount, s.nodeCount), style = ObliTypography.labelSmall, color = c.textMuted)
            if (s.activeRunCount > 0) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(AutomationsIcons.Loader, contentDescription = null, tint = ExecStep.RUNNING.color, modifier = Modifier.size(14.dp))
                    Text(pluralStringResource(R.plurals.automations_count_running, s.activeRunCount, s.activeRunCount), style = ObliTypography.labelSmall, color = c.text2)
                }
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

@Composable
private fun ScenarioDetail(state: ScenariosUiState, s: ScenarioDto, zone: ZoneId, actions: ScenarioActions) {
    val c = ObliTheme.colors
    val busy = s.id in state.busy
    val readOnly = state.readOnly(s)
    val (status, dot) = scenarioStatus(s.status)
    Column(Modifier.fillMaxSize()) {
        ObliDetailTopBar(
            title = s.name,
            onBack = actions.onCloseScenario,
            backLabel = stringResource(R.string.automations_back),
            subtitle = (triggerLabels(s) + status).joinToString(" · "),
            actions = { ObliIconButton(AutomationsIcons.ExternalLink, stringResource(R.string.automations_scenario_edit), actions.onEditInWeb) },
        )
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
            item(key = "actions") {
                AutoCard {
                    s.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = ObliTypography.body, color = c.text2) }
                    DotLabel(status, dot)
                    if (readOnly) {
                        Text(stringResource(R.string.automations_managed_by_master), style = ObliTypography.labelSmall, color = c.textMuted)
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PrimaryButton(stringResource(R.string.automations_scenario_start_ellipsis), { actions.onStart(s) }, icon = AutomationsIcons.Play, enabled = !busy, modifier = Modifier.weight(1f))
                            NeutralButton(
                                stringResource(if (s.status == "active") R.string.automations_scenario_disable else R.string.automations_scenario_enable),
                                { actions.onToggle(s) },
                                busy = busy,
                            )
                        }
                        if (s.activeRunCount > 0) {
                            NeutralButton(
                                pluralStringResource(R.plurals.automations_scenario_cancel_n, s.activeRunCount, s.activeRunCount),
                                { actions.onCancelRuns(s) },
                                icon = AutomationsIcons.Square,
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
            item(key = "runs-title") { SectionTitle(stringResource(R.string.automations_scenario_runs), count = state.runs?.size) }
            val runs = state.runs
            val problem = state.runsProblem
            when {
                runs == null && problem != null -> item(key = "runs-problem") { ProblemCard(problem, actions.onRetry) }
                runs == null -> item(key = "runs-loading") { Box(Modifier.fillMaxWidth().height(80.dp)) { CenterSpinner() } }
                runs.isEmpty() -> item(key = "runs-empty") { Text(stringResource(R.string.automations_scenario_no_runs), style = ObliTypography.body, color = c.textMuted, modifier = Modifier.padding(vertical = 12.dp)) }
                else -> items(runs, key = { it.id }) { r -> RunRow(r, zone, actions) }
            }
        }
    }
}

@Composable
private fun RunRow(r: ScenarioRunDto, zone: ZoneId, actions: ScenarioActions) {
    val c = ObliTheme.colors
    val step = runStep(r.status)
    val locale = currentLocale()
    val sub = listOfNotNull(
        stepText(step),
        r.triggerType?.let { triggerName(it) },
        Fmt.time(r.startedAt ?: r.createdAt, zone),
        Fmt.durationMs(r.startedAt, r.finishedAt)?.let { Fmt.duration(it, locale) },
    ).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1)
            .clickable(role = Role.Button, onClickLabel = stringResource(R.string.automations_scenario_open_run)) { actions.onOpenRun(r) }
            .heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        StepIcon(step)
        Column(Modifier.weight(1f)) {
            Text(r.device?.label ?: "#${r.deviceId}", style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            r.errorMessage?.takeIf { it.isNotBlank() && step.isFailure }?.let { Text(it, style = ObliTypography.monoCaption, color = c.text2, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
        Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun RunTimeline(state: ScenariosUiState, r: ScenarioRunDto, zone: ZoneId, actions: ScenarioActions) {
    val c = ObliTheme.colors
    val step = runStep(r.status)
    Column(Modifier.fillMaxSize()) {
        ObliDetailTopBar(
            title = r.device?.label ?: "#${r.deviceId}",
            onBack = actions.onCloseRun,
            backLabel = stringResource(R.string.automations_back),
            subtitle = listOfNotNull(state.scenario?.name, Fmt.time(r.startedAt ?: r.createdAt, zone)).joinToString(" · "),
        )
        // Node outputs are script outputs: same FLAG_SECURE rule as S53.
        SecureWindow()
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(0.dp), modifier = Modifier.weight(1f)) {
            item(key = "status") {
                Row(Modifier.padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StepIcon(step)
                    Text(stepText(step), style = ObliTypography.label, color = c.text)
                    if (r.inFlight) Text(stringResource(R.string.automations_polling), style = ObliTypography.monoCaption, color = c.textMuted)
                }
            }
            r.errorMessage?.takeIf { it.isNotBlank() }?.let { item(key = "error") { Text(it, style = ObliTypography.monoCaption, color = c.text2, modifier = Modifier.padding(bottom = 12.dp)) } }
            state.runProblem?.let { item(key = "problem") { ProblemCard(it, onRetry = { actions.onOpenRun(r) }) } }
            if (r.nodeRuns.isEmpty() && state.runProblem == null) {
                item(key = "empty") { Text(stringResource(R.string.automations_run_no_nodes), style = ObliTypography.body, color = c.textMuted) }
            }
            val nodes = r.nodeRuns
            items(nodes.size, key = { nodes[it].id.ifEmpty { "n$it" } }) { i -> NodeStep(nodes[i], last = i == nodes.lastIndex) }
        }
    }
}

@Composable
private fun NodeStep(n: NodeRunDto, last: Boolean) {
    val c = ObliTheme.colors
    val step = runStep(n.status)
    var open by remember(n.id) { mutableStateOf(step.isFailure) }
    val locale = currentLocale()
    val output = listOfNotNull(n.stdout?.takeIf { it.isNotBlank() }, n.stderr?.takeIf { it.isNotBlank() }, n.errorMessage?.takeIf { it.isNotBlank() }).joinToString("\n")
    Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            StepIcon(step)
            if (!last) Box(Modifier.width(2.dp).weight(1f).background(c.divider))
        }
        Column(Modifier.weight(1f).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(n.nodeLabel?.takeIf { it.isNotBlank() } ?: nodeTypeName(n.nodeType), style = ObliTypography.label, color = c.text)
            Text(
                listOfNotNull(
                    nodeTypeName(n.nodeType).takeIf { !n.nodeLabel.isNullOrBlank() },
                    stepText(step),
                    n.exitCode?.let { stringResource(R.string.automations_code, it) },
                    Fmt.durationMs(n.startedAt, n.finishedAt)?.let { Fmt.duration(it, locale) },
                ).joinToString(" · "),
                style = ObliTypography.labelSmall,
                color = c.textMuted,
            )
            if (output.isNotEmpty()) {
                TextButton(onClick = { open = !open }, modifier = Modifier.heightIn(min = 48.dp), shape = ButtonShape, contentPadding = PaddingValues(horizontal = 0.dp)) {
                    Text(stringResource(if (open) R.string.automations_hide_output else R.string.automations_show_output), style = ObliTypography.labelSmall, color = c.text2)
                }
                if (open) CodeBlock(output)
            }
        }
    }
}

@Composable
private fun nodeTypeName(type: String): String = when (type) {
    "run_script" -> stringResource(R.string.automations_node_run_script)
    "run_command" -> stringResource(R.string.automations_node_run_command)
    "send_notification" -> stringResource(R.string.automations_node_notify)
    "wait" -> stringResource(R.string.automations_node_wait)
    "tag_device" -> stringResource(R.string.automations_node_tag)
    "move_device_to_group" -> stringResource(R.string.automations_node_move)
    "branch_exit_code", "branch_on_device" -> stringResource(R.string.automations_node_branch)
    "cooldown" -> stringResource(R.string.automations_node_cooldown)
    "end_success" -> stringResource(R.string.automations_node_end_success)
    "end_failure" -> stringResource(R.string.automations_node_end_failure)
    else -> if (type.startsWith("trigger_")) triggerName(type) else type
}
