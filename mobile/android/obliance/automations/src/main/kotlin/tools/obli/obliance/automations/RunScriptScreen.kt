package tools.obli.obliance.automations

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.security.Tier
import tools.obli.core.security.ui.LocalActionFeedback
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.LocalObliServices

/**
 * S51 Préparation de l'exécution (design doc §5 S51): script card, typed
 * parameters, targets of [serverId] (given [deviceIds] + "Ajouter"), local
 * pre-checks, then "Exécuter sur N appareils" through the ActionRunner
 * (T1 / T2 / T3). A 202 with executions calls [onStarted] with the batch id
 * (→ [BatchScreen]); a 202 pending_approval shows S43 and stays here.
 *
 * @param rerunOf batch id whose parameters prefill the form ("Relancer sur les échecs"; secrets never).
 */
@Composable
fun RunScriptScreen(
    serverId: ServerId,
    scriptId: Long,
    deviceIds: List<Long>,
    onBack: () -> Unit,
    onStarted: (batchId: String) -> Unit,
    onChangeScript: () -> Unit = onBack,
    rerunOf: String? = null,
) {
    val services = LocalObliServices.current
    val remote = rememberAutomationsRemote()
    val vm = viewModel(key = "run-$serverId-$scriptId-${deviceIds.joinToString(",")}-$rerunOf") {
        RunScriptViewModel(services, remote, serverId, scriptId, deviceIds, rerunOf)
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val runner = LocalActionRunner.current
    val feedback = LocalActionFeedback.current
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    val texts = RunTexts(
        title = { name -> res.getString(R.string.automations_confirm_run_title, name) },
        target = { n, single -> single ?: res.getQuantityString(R.plurals.automations_devices, n, n) },
        consequence = { runtime, n -> res.getQuantityString(R.plurals.automations_confirm_run_consequence, n, runtime, n) },
        mixedTenants = res.getString(R.string.automations_check_mixed_tenants),
        notActive = { name -> res.getString(R.string.automations_not_active_server, name) },
    )
    val done = stringResource(R.string.automations_run_started)
    var picking by remember { mutableStateOf(false) }

    RunScriptContent(
        state = state,
        actions = RunActions(
            onBack = onBack,
            onChangeScript = onChangeScript,
            onField = vm::update,
            onRemoveTarget = vm::removeTarget,
            onAddTargets = { picking = true },
            onRun = {
                scope.launch {
                    val (batch, result) = vm.run(runner, texts)
                    if (result != null) feedback.show(result, done)
                    if (batch != null) onStarted(batch)
                }
            },
            onRetry = vm::retry,
        ),
    )
    if (picking) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            DevicePickerPanel(
                title = stringResource(R.string.automations_add_targets),
                confirm = { n -> if (n == 0) res.getString(R.string.automations_add) else res.getQuantityString(R.plurals.automations_add_n, n, n) },
                already = state.targets.map { it.id }.toSet(),
                wide = maxWidth >= 600.dp,
                search = vm::search,
                onDismiss = { picking = false },
                onDone = { vm.addDevices(it); picking = false },
            )
        }
    }
}

internal class RunActions(
    val onBack: () -> Unit = {},
    val onChangeScript: () -> Unit = {},
    val onField: (ParamField) -> Unit = {},
    val onRemoveTarget: (Long) -> Unit = {},
    val onAddTargets: () -> Unit = {},
    val onRun: () -> Unit = {},
    val onRetry: () -> Unit = {},
)

@Composable
internal fun RunScriptContent(state: RunScriptUiState, actions: RunActions) {
    val c = ObliTheme.colors
    val checks = state.checks
    val tenant = checks.tenants.values.singleOrNull()
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliDetailTopBar(
            title = stringResource(R.string.automations_run_title),
            onBack = actions.onBack,
            backLabel = stringResource(R.string.automations_back),
            subtitle = listOfNotNull(devicesCount(state.targets.size).takeIf { state.targets.isNotEmpty() }, tenant).joinToString(" · ").ifEmpty { null },
        )
        Box(Modifier.weight(1f)) {
            val problem = state.problem
            when {
                state.loading && state.script == null -> CenterSpinner()
                problem != null && state.script == null -> ProblemCard(problem, actions.onRetry, Modifier.padding(16.dp))
                else -> Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)
                        .widthIn(max = 720.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.script?.let { ScriptCard(it, actions) }
                    if (state.fields.isNotEmpty()) {
                        SectionTitle(stringResource(R.string.automations_params), count = state.fields.size)
                        AutoCard {
                            state.fields.forEach { f -> ParamInput(f, state.showErrors, actions.onField) }
                        }
                    }
                    SectionTitle(stringResource(R.string.automations_targets), count = state.targets.size, action = stringResource(R.string.automations_add), onAction = actions.onAddTargets)
                    Targets(state, actions)
                    if (state.script != null && state.targets.isNotEmpty()) {
                        SectionTitle(stringResource(R.string.automations_prechecks))
                        Prechecks(state)
                    }
                    state.notice?.let { Notice(it) }
                }
            }
        }
        BottomBar(state, actions)
    }
}

@Composable
private fun ScriptCard(s: ScriptDto, actions: RunActions) {
    val c = ObliTheme.colors
    var showCode by remember(s.id) { mutableStateOf(false) }
    SectionTitle(stringResource(R.string.automations_script))
    AutoCard {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(s.name, style = ObliTypography.cardTitle, color = c.text)
            Text(
                listOfNotNull(
                    runtimeLabel(s.runtime),
                    s.timeoutSeconds.takeIf { it > 0 }?.let { stringResource(R.string.automations_timeout_label, it) },
                    platformName(s.platform),
                ).joinToString(" · "),
                style = ObliTypography.labelSmall,
                color = c.textMuted,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { showCode = !showCode }, modifier = Modifier.heightIn(min = 48.dp), shape = ButtonShape) {
                Icon(AutomationsIcons.Code, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
                Text(stringResource(if (showCode) R.string.automations_hide_code else R.string.automations_show_code), style = ObliTypography.label, color = c.text2, modifier = Modifier.padding(start = 8.dp))
            }
            TextButton(onClick = actions.onChangeScript, modifier = Modifier.heightIn(min = 48.dp), shape = ButtonShape) {
                Text(stringResource(R.string.automations_change_script), style = ObliTypography.label, color = c.text2)
            }
        }
        if (showCode) CodeBlock(s.content.ifEmpty { "—" }, maxHeight = 360.dp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ParamInput(f: ParamField, showErrors: Boolean, onChange: (ParamField) -> Unit) {
    val c = ObliTheme.colors
    val problem = f.problem?.takeIf { showErrors }
    val errorText = problem?.let {
        stringResource(
            when (it) {
                ParamProblem.REQUIRED -> R.string.automations_param_required_error
                ParamProblem.NOT_A_NUMBER -> R.string.automations_param_number_error
                ParamProblem.NOT_AN_OPTION -> R.string.automations_param_option_error
            },
        )
    }
    val helper = listOfNotNull(
        stringResource(R.string.automations_param_required).takeIf { f.def.required },
        f.def.description?.takeIf { it.isNotBlank() },
    ).joinToString(" · ").ifEmpty { null }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (f.kind == ParamType.BOOLEAN) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = f.checked, role = Role.Switch) { onChange(f.copy(checked = it)) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(f.def.title, style = ObliTypography.label, color = c.text)
                    helper?.let { Text(it, style = ObliTypography.labelSmall, color = c.textMuted) }
                }
                Switch(
                    checked = f.checked,
                    onCheckedChange = null,
                    colors = SwitchDefaults.colors(checkedTrackColor = ObliTokens.Status.ONLINE.argb.toColor().copy(alpha = 0.55f), checkedThumbColor = c.text, uncheckedTrackColor = c.hover, uncheckedThumbColor = c.textMuted, uncheckedBorderColor = c.divider),
                )
            }
            return@Column
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(f.def.title, style = ObliTypography.label, color = c.text)
            if (f.def.required) Text(" *", style = ObliTypography.label, color = c.text2)
            if (f.kind == ParamType.SECRET) {
                Icon(ObliIcons.Lock, contentDescription = stringResource(R.string.automations_ptype_secret), tint = c.textMuted, modifier = Modifier.padding(start = 6.dp).size(14.dp))
            }
        }
        when (f.kind) {
            ParamType.SELECT, ParamType.MULTISELECT -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                f.def.options.forEach { o ->
                    val selected = if (f.kind == ParamType.SELECT) f.text == o else o in f.selected
                    Box(
                        Modifier.heightIn(min = 48.dp).selectable(selected = selected, role = if (f.kind == ParamType.SELECT) Role.RadioButton else Role.Checkbox) {
                            onChange(
                                if (f.kind == ParamType.SELECT) f.copy(text = if (selected && !f.def.required) "" else o)
                                else f.copy(selected = if (selected) f.selected - o else f.selected + o),
                            )
                        },
                        contentAlignment = Alignment.Center,
                    ) {
                        Row(
                            Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).background(if (selected) c.active else c.surface2).padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            if (selected) Icon(ObliIcons.Check, contentDescription = null, tint = c.text, modifier = Modifier.size(16.dp))
                            Text(o, style = ObliTypography.label, color = if (selected) c.text else c.text2)
                        }
                    }
                }
            }
            else -> TextInput(f, errorText != null, onChange)
        }
        when {
            errorText != null -> Text(errorText, style = ObliTypography.labelSmall, color = ObliTokens.Status.WARNING.argb.toColor())
            helper != null -> Text(helper, style = ObliTypography.labelSmall, color = c.textMuted)
        }
    }
}

@Composable
private fun TextInput(f: ParamField, isError: Boolean, onChange: (ParamField) -> Unit) {
    val c = ObliTheme.colors
    val secret = f.kind == ParamType.SECRET
    var reveal by remember(f.def.name) { mutableStateOf(false) }
    val border = if (isError) ObliTokens.Status.WARNING.argb.toColor() else c.divider
    val errorDesc = stringResource(R.string.automations_param_required_error)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).background(c.bg).border(1.dp, border, RoundedCornerShape(8.dp)).padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = f.text,
            onValueChange = { onChange(f.copy(text = it)) },
            singleLine = true,
            textStyle = (if (secret || f.kind == ParamType.NUMBER) ObliTypography.terminal else ObliTypography.body).copy(color = c.text),
            cursorBrush = SolidColor(c.text),
            visualTransformation = if (secret && !reveal) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = when {
                    secret -> KeyboardType.Password
                    f.kind == ParamType.NUMBER -> KeyboardType.Decimal
                    else -> KeyboardType.Text
                },
                autoCorrectEnabled = !secret,
            ),
            modifier = Modifier.weight(1f).padding(vertical = 12.dp).semantics {
                contentDescription = f.def.title
                if (isError) error(errorDesc)
            },
        )
        if (secret) {
            ObliIconButton(
                if (reveal) AutomationsIcons.EyeOff else AutomationsIcons.Eye,
                stringResource(if (reveal) R.string.automations_hide_secret else R.string.automations_show_secret),
                { reveal = !reveal },
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Targets(state: RunScriptUiState, actions: RunActions) {
    val c = ObliTheme.colors
    AutoCard {
        if (state.targets.isEmpty()) {
            Text(
                stringResource(if (state.targetsLoading) R.string.automations_loading else R.string.automations_targets_empty),
                style = ObliTypography.body,
                color = c.textMuted,
            )
            NeutralButton(stringResource(R.string.automations_add_targets), actions.onAddTargets, icon = ObliIcons.Plus)
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                state.targets.forEach { d -> TargetChip(d) { actions.onRemoveTarget(d.id) } }
            }
            val online = state.targets.count { it.statusKind.isConnected && it.statusKind != DeviceStatus.CRITICAL && it.statusKind != DeviceStatus.WARNING }
            val critical = state.targets.count { it.statusKind == DeviceStatus.CRITICAL }
            val warning = state.targets.count { it.statusKind == DeviceStatus.WARNING }
            val offline = state.targets.count { !it.statusKind.isConnected }
            val summary = listOfNotNull(
                pluralStringResource(R.plurals.automations_sum_online, online, online).takeIf { online > 0 },
                pluralStringResource(R.plurals.automations_sum_warning, warning, warning).takeIf { warning > 0 },
                pluralStringResource(R.plurals.automations_sum_critical, critical, critical).takeIf { critical > 0 },
                pluralStringResource(R.plurals.automations_sum_offline, offline, offline).takeIf { offline > 0 },
                state.targets.mapNotNull { it.osName }.distinct().singleOrNull(),
            ).joinToString(" · ")
            Text(summary, style = ObliTypography.labelSmall, color = c.textMuted)
        }
        if (state.missing.isNotEmpty()) {
            Text(pluralStringResource(R.plurals.automations_targets_missing, state.missing.size, state.missing.size), style = ObliTypography.labelSmall, color = c.textMuted)
        }
    }
}

@Composable
private fun TargetChip(d: Device, onRemove: () -> Unit) {
    val c = ObliTheme.colors
    Row(
        Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2).padding(start = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        DeviceDot(d, 6.dp)
        Text(d.label, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 200.dp))
        ObliIconButton(ObliIcons.X, stringResource(R.string.automations_remove_target, d.label), onRemove, tint = c.textMuted)
    }
}

private enum class CheckLevel { OK, INFO, WARN, BLOCK }

@Composable
private fun Prechecks(state: RunScriptUiState) {
    val checks = state.checks
    val script = state.script ?: return
    val runtime = runtimeLabel(script.runtime)
    val lines = buildList<Pair<CheckLevel, String>> {
        if (checks.mixedTenants) add(CheckLevel.BLOCK to stringResource(R.string.automations_check_mixed_tenants_detail, checks.tenants.values.joinToString(", ")))
        if (checks.runnable.isEmpty()) add(CheckLevel.BLOCK to stringResource(R.string.automations_check_no_runnable))
        checks.platformSkipped.forEach { add(CheckLevel.WARN to stringResource(R.string.automations_check_platform, it.label, runtime, platformName(script.platform))) }
        checks.notApproved.forEach { add(CheckLevel.WARN to stringResource(R.string.automations_check_not_approved, it.label)) }
        if (checks.offline.isNotEmpty()) add(CheckLevel.WARN to pluralStringResource(R.plurals.automations_check_offline, checks.offline.size, checks.offline.size))
        checks.privacy.forEach { add(CheckLevel.WARN to stringResource(R.string.automations_check_privacy, it.label)) }
        checks.legacy.forEach { add(CheckLevel.INFO to stringResource(R.string.automations_check_legacy, it.label)) }
        val reachable = checks.runnable.size - checks.offline.size
        if (reachable > 0) add(CheckLevel.OK to pluralStringResource(R.plurals.automations_check_reachable, reachable, reachable))
        if (checks.runnable.isNotEmpty() && checks.platformSkipped.isEmpty()) add(CheckLevel.OK to pluralStringResource(R.plurals.automations_check_compatible, checks.runnable.size, runtime, checks.runnable.size))
        checks.switchTo(state.sessionTenantId)?.let { add(CheckLevel.INFO to stringResource(R.string.automations_check_switch, it.second)) }
    }
    val blocking = lines.any { it.first == CheckLevel.BLOCK }
    val warn = lines.any { it.first == CheckLevel.WARN }
    AutoCard {
        val (headIcon, headColor, headText) = when {
            blocking -> Triple(ObliIcons.CircleAlert, ObliTokens.Status.WARNING.argb.toColor(), stringResource(R.string.automations_check_blocked))
            warn -> Triple(ObliIcons.TriangleAlert, ObliTokens.Status.WARNING.argb.toColor(), stringResource(R.string.automations_check_warnings))
            else -> Triple(ObliIcons.CircleCheck, ObliTokens.Status.ONLINE.argb.toColor(), stringResource(R.string.automations_check_clear))
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(headIcon, contentDescription = null, tint = headColor, modifier = Modifier.size(18.dp))
            Text(headText, style = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold), color = ObliTheme.colors.text)
        }
        lines.forEach { (level, text) -> CheckLine(level, text) }
    }
}

@Composable
private fun CheckLine(level: CheckLevel, text: String) {
    val c = ObliTheme.colors
    val (icon, tint) = when (level) {
        CheckLevel.OK -> ObliIcons.Check to ObliTokens.Status.ONLINE.argb.toColor()
        CheckLevel.INFO -> ObliIcons.Info to ObliTokens.Status.PENDING.argb.toColor()
        CheckLevel.WARN -> ObliIcons.TriangleAlert to ObliTokens.Status.WARNING.argb.toColor()
        CheckLevel.BLOCK -> ObliIcons.CircleAlert to ObliTokens.Status.WARNING.argb.toColor()
    }
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.padding(top = 2.dp).size(16.dp))
        Text(text, style = ObliTypography.body, color = c.text2)
    }
}

@Composable
private fun Notice(n: RunNotice) {
    val amber = ObliTokens.Status.WARNING.argb.toColor()
    val (icon, text) = when (n) {
        RunNotice.AwaitingApproval -> ObliIcons.Clock to stringResource(R.string.automations_notice_approval)
        RunNotice.NoTargets -> ObliIcons.Info to stringResource(R.string.automations_notice_no_targets)
    }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(amber.copy(alpha = 0.10f)).padding(12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = amber, modifier = Modifier.size(18.dp))
        Text(text, style = ObliTypography.body, color = ObliTheme.colors.text)
    }
}

@Composable
private fun BottomBar(state: RunScriptUiState, actions: RunActions) {
    val c = ObliTheme.colors
    val n = state.checks.runnable.size
    Column(Modifier.fillMaxWidth().background(c.chrome).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (n > 0) {
            val hint = when (tierForTargets(n)) {
                Tier.T0, Tier.T1 -> R.string.automations_tier_t1
                Tier.T2 -> R.string.automations_tier_t2
                Tier.T3 -> R.string.automations_tier_t3
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(AutomationsIcons.ShieldCheck, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(14.dp))
                Text(stringResource(hint), style = ObliTypography.labelSmall, color = c.textMuted)
            }
        }
        PrimaryButton(
            text = if (n > 0) pluralStringResource(R.plurals.automations_run_on, n, n) else stringResource(R.string.automations_run),
            onClick = actions.onRun,
            enabled = state.canRun,
            busy = state.running,
            icon = AutomationsIcons.Play,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
