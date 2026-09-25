package tools.obli.obliance.automations

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
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
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.security.ui.LocalActionFeedback
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.data.LocalObliServices

/**
 * S52 Lot en direct + S53 Sortie (design doc §5 S52, S53): the executions of
 * [batchId] on [serverId], live, with Arrêter / Annuler per device, the
 * output of each device (never persisted; FLAG_SECURE while shown),
 * « Relancer sur les échecs » and « Partager ».
 *
 * @param onRerunFailures (server, scriptId, failed device ids, batchId) → S51 prefilled ([RunScriptScreen] with `rerunOf = batchId`).
 * @param onOpenTerminal "Ouvrir PowerShell sur PC-COMPTA-03" (remote module); hidden with the default.
 */
@Composable
fun BatchScreen(
    serverId: ServerId,
    batchId: String,
    onBack: () -> Unit,
    onRerunFailures: (ServerId, Long, List<Long>, String) -> Unit,
    onOpenTerminal: ((ServerId, Long) -> Unit)? = null,
) {
    val services = LocalObliServices.current
    val remote = rememberAutomationsRemote()
    val clock = LocalAutomationsClock.current
    val vm = viewModel(key = "batch-$serverId-$batchId") { BatchViewModel(services, remote, serverId, batchId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(vm, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.follow() } }
    val runner = LocalActionRunner.current
    val feedback = LocalActionFeedback.current
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    val context = LocalContext.current
    val stopTexts = StopTexts(
        stopTitle = res.getString(R.string.automations_stop_title),
        cancelTitle = res.getString(R.string.automations_cancel_title),
        stopConsequence = res.getString(R.string.automations_stop_consequence),
        cancelConsequence = res.getString(R.string.automations_cancel_consequence),
    )
    val stopped = stringResource(R.string.automations_stop_done)
    val reportTexts = ReportTexts(
        succeeded = { ok, total -> res.getQuantityString(R.plurals.automations_report_succeeded, total, ok, total) },
        step = { res.getString(it.label).lowercase() },
        code = { res.getString(R.string.automations_code, it) },
    )

    BatchContent(
        state = state,
        zone = clock.zone,
        actions = BatchActions(
            onBack = onBack,
            onFilter = vm::setFilter,
            onOpen = { vm.select(it.executionId) },
            onCloseOutput = { vm.select(null) },
            onStop = { row -> scope.launch { feedback.show(vm.stopOrCancel(row, runner, stopTexts), stopped) } },
            onRerun = {
                val s = vm.state.value
                s.scriptId?.let { id -> onRerunFailures(serverId, id, s.failed.map { it.deviceId }, batchId) }
            },
            onShare = {
                val s = vm.state.value
                share(context, s.scriptName.orEmpty(), BatchMerge.report(s, Fmt.time(s.triggeredAt, clock.zone), reportTexts))
            },
            onShareOutput = { title, text -> share(context, title, text) },
            onOpenTerminal = onOpenTerminal?.let { open -> { row: BatchRow -> open(serverId, row.deviceId) } },
            onRetry = vm::refresh,
        ),
    )
}

internal class BatchActions(
    val onBack: () -> Unit = {},
    val onFilter: (BatchFilter) -> Unit = {},
    val onOpen: (BatchRow) -> Unit = {},
    val onCloseOutput: () -> Unit = {},
    val onStop: (BatchRow) -> Unit = {},
    val onRerun: () -> Unit = {},
    val onShare: () -> Unit = {},
    val onShareOutput: (String, String) -> Unit = { _, _ -> },
    val onOpenTerminal: ((BatchRow) -> Unit)? = null,
    val onRetry: () -> Unit = {},
)

private fun share(context: Context, subject: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, subject)
        putExtra(Intent.EXTRA_TEXT, text)
    }
    runCatching { context.startActivity(Intent.createChooser(send, subject).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

@Composable
internal fun BatchContent(state: BatchUiState, zone: ZoneId, actions: BatchActions) {
    val c = ObliTheme.colors
    BoxWithConstraints(Modifier.fillMaxSize().background(c.bg)) {
        val wide = maxWidth >= 840.dp
        val selected = state.selectedRow
        Row(Modifier.fillMaxSize()) {
            Column(Modifier.weight(1f).fillMaxHeight()) {
                val sub = listOfNotNull(
                    Fmt.time(state.triggeredAt, zone)?.let { t ->
                        when (state.byMe) {
                            true -> stringResource(R.string.automations_started_by_you, t)
                            false -> state.triggeredBy?.let { stringResource(R.string.automations_started_by, t, it) } ?: stringResource(R.string.automations_started_at, t)
                            null -> stringResource(R.string.automations_started_at, t)
                        }
                    },
                    state.scope.ifEmpty { null },
                ).joinToString(" · ")
                ObliDetailTopBar(
                    title = state.scriptName ?: stringResource(R.string.automations_batch_title),
                    onBack = actions.onBack,
                    backLabel = stringResource(R.string.automations_back),
                    subtitle = sub.ifEmpty { null },
                    actions = { ObliIconButton(AutomationsIcons.Share, stringResource(R.string.automations_share_report), actions.onShare, enabled = state.rows.isNotEmpty()) },
                )
                val problem = state.problem
                when {
                    state.loading && state.rows.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth()) { CenterSpinner() }
                    problem != null && state.rows.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth()) { ProblemCard(problem, actions.onRetry, Modifier.padding(16.dp)) }
                    state.rows.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth()) {
                        ObliCalmState(title = stringResource(R.string.automations_batch_empty), icon = AutomationsIcons.FileCode)
                    }
                    else -> LazyColumn(
                        Modifier.weight(1f).fillMaxWidth(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        item(key = "head") { BatchHeader(state) }
                        item(key = "filters") { Filters(state, actions) }
                        val visible = state.visible
                        if (visible.isEmpty()) {
                            item(key = "empty") { EmptyFilter(state, actions) }
                        }
                        items(visible, key = { it.executionId }) { row -> ExecRow(row, row.executionId == state.selected, row.executionId in state.busy, actions) }
                    }
                }
                if (state.rows.isNotEmpty()) BatchBottomBar(state, actions)
            }
            if (wide) {
                Box(Modifier.width(480.dp).fillMaxHeight().background(c.surface1)) {
                    if (selected != null) OutputPane(state, selected, zone, actions, showBack = false)
                    else ObliCalmState(title = stringResource(R.string.automations_output_select), icon = AutomationsIcons.Terminal)
                }
            }
        }
        if (!wide && selected != null) {
            BackHandler(onBack = actions.onCloseOutput)
            Box(Modifier.fillMaxSize().background(c.bg)) { OutputPane(state, selected, zone, actions, showBack = true) }
        }
    }
}

@Composable
private fun BatchHeader(state: BatchUiState) {
    val c = ObliTheme.colors
    val n = state.counts
    AutoCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ProgressRing(n, size = 64.dp, stroke = 6.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CountLabel(ExecStep.SUCCESS, pluralStringResource(R.plurals.automations_count_success, n.success, n.success))
                    CountLabel(ExecStep.FAILURE, pluralStringResource(R.plurals.automations_count_failure, n.failure, n.failure))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CountLabel(ExecStep.RUNNING, pluralStringResource(R.plurals.automations_count_running, n.running, n.running))
                    CountLabel(ExecStep.QUEUED, pluralStringResource(R.plurals.automations_count_queued, n.queued, n.queued))
                }
                Text(
                    listOfNotNull(state.runtime?.let { runtimeLabel(it) }, devicesCount(state.rows.size)).joinToString(" · "),
                    style = ObliTypography.labelSmall,
                    color = c.textMuted,
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(if (state.live) ObliTokens.Status.ONLINE.argb.toColor() else c.textMuted))
            Text(
                stringResource(
                    when {
                        state.finished -> R.string.automations_batch_finished
                        state.live -> R.string.automations_live
                        else -> R.string.automations_polling
                    },
                ),
                style = ObliTypography.monoCaption,
                color = c.text2,
            )
        }
        Text(stringResource(R.string.automations_output_honesty), style = ObliTypography.labelSmall, color = c.textMuted)
        if (state.params.isNotEmpty()) {
            Text(state.params.map { paramText(it) }.joinToString(" · "), style = ObliTypography.labelSmall, color = c.text2)
        }
    }
}

@Composable
private fun CountLabel(step: ExecStep, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        StepIcon(step, 14.dp)
        Text(text, style = ObliTypography.labelSmall, color = ObliTheme.colors.text)
    }
}

@Composable
private fun Filters(state: BatchUiState, actions: BatchActions) {
    val n = state.counts
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(stringResource(R.string.automations_filter_all), state.filter == BatchFilter.ALL, { actions.onFilter(BatchFilter.ALL) }, count = state.rows.size)
        FilterChip(stringResource(R.string.automations_filter_failed), state.filter == BatchFilter.FAILED, { actions.onFilter(BatchFilter.FAILED) }, count = n.failure)
        FilterChip(stringResource(R.string.automations_filter_running), state.filter == BatchFilter.RUNNING, { actions.onFilter(BatchFilter.RUNNING) }, count = n.running)
        FilterChip(stringResource(R.string.automations_filter_queued), state.filter == BatchFilter.QUEUED, { actions.onFilter(BatchFilter.QUEUED) }, count = n.queued)
    }
}

@Composable
private fun EmptyFilter(state: BatchUiState, actions: BatchActions) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(
                when (state.filter) {
                    BatchFilter.FAILED -> R.string.automations_filter_empty_failed
                    BatchFilter.RUNNING -> R.string.automations_filter_empty_running
                    else -> R.string.automations_filter_empty_queued
                },
            ),
            style = ObliTypography.body,
            color = c.textMuted,
        )
        NeutralButton(pluralStringResource(R.plurals.automations_see_devices, state.rows.size, state.rows.size), { actions.onFilter(BatchFilter.ALL) })
    }
}

/** "Réussi · code 0 · 14 s". */
@Composable
private fun rowStatus(row: BatchRow): String {
    val locale = currentLocale()
    return listOfNotNull(
        stepText(row.step),
        row.exitCode?.takeIf { row.step.terminal }?.let { stringResource(R.string.automations_code, it) },
        row.durationMs?.takeIf { row.step.terminal }?.let { Fmt.duration(it, locale) },
    ).joinToString(" · ")
}

@Composable
private fun ExecRow(row: BatchRow, selected: Boolean, busy: Boolean, actions: BatchActions) {
    val c = ObliTheme.colors
    val status = rowStatus(row)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (selected) c.active else c.surface1)
            .clickable(role = Role.Button, onClickLabel = stringResource(R.string.automations_open_output)) { actions.onOpen(row) }
            .padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.semantics(mergeDescendants = true) { contentDescription = "${row.label}, $status" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StepIcon(row.step)
            Column(Modifier.weight(1f)) {
                Text(row.label, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(status, style = ObliTypography.labelSmall, color = if (row.step.isFailure) c.text else c.text2, maxLines = 1)
            }
            if (!row.step.terminal) Stepper(row.step)
            Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.padding(end = 8.dp).size(18.dp))
        }
        if (row.step.isFailure) {
            (Fmt.firstLine(row.stderr) ?: Fmt.firstLine(row.stdout))?.let {
                Text(it, style = ObliTypography.monoCaption, color = c.text2, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 30.dp, end = 8.dp))
            }
        }
        Row(Modifier.padding(start = 22.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (row.step.isFailure && actions.onOpenTerminal != null) {
                TextButton(onClick = { actions.onOpenTerminal.invoke(row) }, modifier = Modifier.heightIn(min = 48.dp), shape = ButtonShape) {
                    Icon(AutomationsIcons.Terminal, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
                    Text(terminalLabel(row), style = ObliTypography.label, color = c.text2, modifier = Modifier.padding(start = 6.dp))
                }
            }
            if (!row.step.terminal) {
                val stop = row.step == ExecStep.RUNNING || row.step == ExecStep.SENT
                NeutralButton(
                    stringResource(if (stop) R.string.automations_stop else R.string.automations_cancel),
                    { actions.onStop(row) },
                    icon = if (stop) AutomationsIcons.Square else ObliIcons.X,
                    busy = busy,
                )
            }
        }
    }
}

@Composable
private fun terminalLabel(row: BatchRow): String =
    if (row.osType == "windows") stringResource(R.string.automations_open_powershell, row.label) else stringResource(R.string.automations_open_terminal, row.label)

/** 4-dot stepper: En file → Envoyé → En cours → terminal. */
@Composable
private fun Stepper(step: ExecStep) {
    val c = ObliTheme.colors
    val blue = ExecStep.RUNNING.color
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        for (i in 0..3) {
            val reached = i <= step.rank
            Box(Modifier.size(if (i == step.rank) 8.dp else 6.dp).clip(CircleShape).background(if (reached) blue else c.hover))
        }
    }
}

@Composable
private fun BatchBottomBar(state: BatchUiState, actions: BatchActions) {
    val c = ObliTheme.colors
    val failed = state.failed.size
    Row(
        Modifier.fillMaxWidth().background(c.chrome).padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        TonalButton(
            pluralStringResource(R.plurals.automations_rerun_failed, failed, failed),
            actions.onRerun,
            icon = AutomationsIcons.RotateCcw,
            enabled = failed > 0 && state.scriptId != null,
            modifier = Modifier.weight(1f),
        )
        NeutralButton(stringResource(R.string.automations_share), actions.onShare, icon = AutomationsIcons.Share)
    }
}

// ---------------------------------------------------------------------------
// S53 output
// ---------------------------------------------------------------------------

@Composable
private fun OutputPane(state: BatchUiState, row: BatchRow, zone: ZoneId, actions: BatchActions, showBack: Boolean) {
    val c = ObliTheme.colors
    SecureWindow()
    val hasErr = !row.stderr.isNullOrEmpty()
    var errors by remember(row.executionId) { mutableStateOf(row.step.isFailure && hasErr) }
    var showCode by remember(row.executionId) { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val text = (if (errors) row.stderr else row.stdout).orEmpty()
    Column(Modifier.fillMaxSize()) {
        if (showBack) {
            ObliDetailTopBar(
                title = row.label,
                onBack = actions.onCloseOutput,
                backLabel = stringResource(R.string.automations_back),
                subtitle = state.scriptName,
            )
        } else {
            Column(Modifier.padding(16.dp)) {
                Text(row.label, style = ObliTypography.dialogTitle, color = c.text)
                state.scriptName?.let { Text(it, style = ObliTypography.labelSmall, color = c.textMuted) }
            }
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StepIcon(row.step, 18.dp)
                Text(rowStatus(row), style = ObliTypography.label, color = c.text)
            }
            Fmt.time(state.triggeredAt, zone)?.let { t ->
                Text(
                    when (state.byMe) {
                        true -> stringResource(R.string.automations_started_by_you, t)
                        false -> state.triggeredBy?.let { stringResource(R.string.automations_started_by, t, it) } ?: stringResource(R.string.automations_started_at, t)
                        null -> stringResource(R.string.automations_started_at, t)
                    },
                    style = ObliTypography.labelSmall,
                    color = c.textMuted,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutputTab(stringResource(R.string.automations_tab_output), !errors) { errors = false }
                OutputTab(stringResource(R.string.automations_tab_errors), errors, badge = hasErr) { errors = true }
            }
            if (!row.step.terminal) {
                Text(stringResource(R.string.automations_output_honesty), style = ObliTypography.body, color = c.textMuted)
            } else if (text.isEmpty()) {
                Text(
                    stringResource(if (errors) R.string.automations_no_stderr else R.string.automations_no_stdout),
                    style = ObliTypography.body,
                    color = c.textMuted,
                )
            } else {
                CodeBlock(text)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NeutralButton(stringResource(R.string.automations_copy), { clipboard.setText(AnnotatedString(text)) }, icon = AutomationsIcons.Copy, enabled = text.isNotEmpty())
                NeutralButton(
                    stringResource(R.string.automations_share),
                    { actions.onShareOutput("${state.scriptName.orEmpty()} — ${row.label}", text) },
                    icon = AutomationsIcons.Share,
                    enabled = text.isNotEmpty(),
                )
            }
            if (state.params.isNotEmpty()) {
                SectionTitle(stringResource(R.string.automations_params))
                state.params.forEach { Text(paramText(it), style = ObliTypography.monoCaption, color = c.text2) }
            }
            state.scriptContent?.let { code ->
                TextButton(onClick = { showCode = !showCode }, modifier = Modifier.heightIn(min = 48.dp), shape = ButtonShape) {
                    Icon(AutomationsIcons.Code, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
                    Text(stringResource(if (showCode) R.string.automations_hide_run_code else R.string.automations_show_run_code), style = ObliTypography.label, color = c.text2, modifier = Modifier.padding(start = 8.dp))
                }
                if (showCode) CodeBlock(code)
            }
            if (row.step.isFailure && actions.onOpenTerminal != null) {
                NeutralButton(terminalLabel(row), { actions.onOpenTerminal.invoke(row) }, icon = AutomationsIcons.Terminal)
            }
        }
    }
}

@Composable
private fun OutputTab(label: String, selected: Boolean, badge: Boolean = false, onClick: () -> Unit) {
    val c = ObliTheme.colors
    Box(Modifier.heightIn(min = 48.dp).selectable(selected = selected, role = Role.Tab, onClick = onClick), contentAlignment = Alignment.Center) {
        Row(
            Modifier.clip(RoundedCornerShape(8.dp)).background(if (selected) c.active else c.surface2).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(label, style = ObliTypography.label.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium), color = if (selected) c.text else c.text2)
            if (badge) Box(Modifier.size(6.dp).clip(CircleShape).background(ObliTokens.Status.WARNING.argb.toColor()))
        }
    }
}

/** FLAG_SECURE while an output is on screen (design doc §5 S53, §10.10): no screenshots, no recents thumbnail. */
@Composable
internal fun SecureWindow() {
    val context = LocalContext.current
    DisposableEffect(context) {
        val window = context.findActivity()?.window
        val already = window?.attributes?.flags?.and(WindowManager.LayoutParams.FLAG_SECURE) != 0
        if (window != null && !already) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (window != null && !already) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

private fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}
