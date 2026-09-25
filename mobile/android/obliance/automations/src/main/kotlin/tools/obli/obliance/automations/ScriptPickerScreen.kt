package tools.obli.obliance.automations

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.model.ServerId
import tools.obli.obliance.data.LocalObliServices

/**
 * S50 Choix du script (design doc §5 S50): scripts of [serverId], search,
 * platform (deduced from [deviceIds]), "Récents" and category chips; tap →
 * preview (description, parameters, code) → **Continuer** → [onPicked].
 * [deviceIds] may be empty (Activité FAB): the targets are chosen in S51.
 */
@Composable
fun ScriptPickerScreen(
    serverId: ServerId,
    deviceIds: List<Long>,
    onBack: () -> Unit,
    onPicked: (scriptId: Long) -> Unit,
) {
    val services = LocalObliServices.current
    val remote = rememberAutomationsRemote()
    val vm = viewModel(key = "picker-$serverId-${deviceIds.joinToString(",")}") { ScriptPickerViewModel(services, remote, serverId, deviceIds) }
    val state by vm.state.collectAsStateWithLifecycle()
    ScriptPickerContent(
        state = state,
        deviceCount = deviceIds.size,
        actions = PickerActions(
            onBack = onBack,
            onQuery = vm::setQuery,
            onPlatform = vm::setPlatform,
            onCategory = vm::setCategory,
            onRecent = vm::toggleRecent,
            onOpen = vm::openPreview,
            onClosePreview = vm::closePreview,
            onContinue = { s -> onPicked(s.id) },
            onRetry = vm::retry,
        ),
    )
}

internal class PickerActions(
    val onBack: () -> Unit = {},
    val onQuery: (String) -> Unit = {},
    val onPlatform: (String?) -> Unit = {},
    val onCategory: (Long?) -> Unit = {},
    val onRecent: () -> Unit = {},
    val onOpen: (ScriptDto) -> Unit = {},
    val onClosePreview: () -> Unit = {},
    val onContinue: (ScriptDto) -> Unit = {},
    val onRetry: () -> Unit = {},
)

@Composable
internal fun ScriptPickerContent(state: PickerUiState, deviceCount: Int, actions: PickerActions) {
    val c = ObliTheme.colors
    BoxWithConstraints(Modifier.fillMaxSize().background(c.bg)) {
        val wide = maxWidth >= 840.dp
        Column(Modifier.fillMaxSize()) {
            ObliDetailTopBar(
                title = stringResource(R.string.automations_picker_title),
                onBack = actions.onBack,
                backLabel = stringResource(R.string.automations_back),
                subtitle = if (deviceCount > 0) devicesCount(deviceCount) else stringResource(R.string.automations_picker_subtitle),
            )
            Row(Modifier.fillMaxSize()) {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    SearchField(state.query, actions.onQuery, stringResource(R.string.automations_search_script), Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
                    Chips(state, actions)
                    ScriptList(state, actions, Modifier.weight(1f))
                }
                if (wide) {
                    Box(Modifier.width(420.dp).fillMaxHeight().background(c.surface1)) {
                        val p = state.preview
                        if (p == null) {
                            ObliCalmState(title = stringResource(R.string.automations_picker_select), icon = AutomationsIcons.FileCode)
                        } else {
                            PreviewBody(state, p, actions, showClose = false)
                        }
                    }
                }
            }
        }
        val p = state.preview
        if (!wide && p != null) {
            OverlayPanel(onDismiss = actions.onClosePreview, wide = false) { PreviewBody(state, p, actions, showClose = true) }
        }
    }
}

@Composable
private fun Chips(state: PickerUiState, actions: PickerActions) {
    val platforms = state.targetPlatforms.ifEmpty { setOf("windows", "linux", "macos") }.toList().sortedBy { PLATFORM_ORDER.indexOf(it) }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        platforms.forEach { p -> FilterChip(platformName(p), state.platform == p, { actions.onPlatform(p) }) }
        if (state.recent.isNotEmpty()) FilterChip(stringResource(R.string.automations_chip_recent), state.recentOnly, actions.onRecent, count = state.recent.size)
        state.categories.forEach { cat -> FilterChip(cat.name, state.categoryId == cat.id, { actions.onCategory(cat.id) }) }
    }
}

private val PLATFORM_ORDER = listOf("windows", "linux", "macos", "freebsd")

@Composable
internal fun platformName(p: String): String = when (p) {
    "windows" -> stringResource(R.string.automations_platform_windows)
    "linux" -> stringResource(R.string.automations_platform_linux)
    "macos" -> stringResource(R.string.automations_platform_macos)
    "freebsd" -> "FreeBSD"
    else -> stringResource(R.string.automations_platform_all)
}

@Composable
private fun ScriptList(state: PickerUiState, actions: PickerActions, modifier: Modifier) {
    val c = ObliTheme.colors
    val problem = state.problem
    Box(modifier.fillMaxWidth()) {
        when {
            state.loading && state.scripts.isEmpty() -> CenterSpinner()
            problem != null && state.scripts.isEmpty() -> ProblemCard(problem, actions.onRetry, Modifier.padding(16.dp))
            state.visible.isEmpty() -> ObliCalmState(
                title = if (state.query.isNotBlank()) stringResource(R.string.automations_picker_no_match, state.query.trim()) else stringResource(R.string.automations_picker_empty),
                icon = AutomationsIcons.FileCode,
            )
            else -> LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                items(state.visible, key = { it.id }) { s ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 64.dp)
                            .clickable(role = Role.Button, onClickLabel = stringResource(R.string.automations_preview)) { actions.onOpen(s) }
                            .background(if (state.preview?.id == s.id) c.active else c.bg)
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(s.name, style = ObliTypography.rowTitle, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(scriptMeta(s), style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (state.managedByMaster(s)) LockLine()
                        }
                        if (s.isSystem) MonoTag(stringResource(R.string.automations_tag_system))
                        Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun LockLine() {
    val c = ObliTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(ObliIcons.Lock, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(12.dp))
        Text(stringResource(R.string.automations_managed_by_master), style = ObliTypography.labelSmall, color = c.textMuted)
    }
}

/** "PowerShell · 60 s · Windows". */
@Composable
internal fun scriptMeta(s: ScriptDto): String = listOfNotNull(
    runtimeLabel(s.runtime),
    s.timeoutSeconds.takeIf { it > 0 }?.let { stringResource(R.string.automations_timeout_s, it) },
    platformName(s.platform),
).joinToString(" · ")

@Composable
private fun PreviewBody(state: PickerUiState, s: ScriptDto, actions: PickerActions, showClose: Boolean) {
    val c = ObliTheme.colors
    var showCode by remember(s.id) { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        if (showClose) PanelHeader(s.name, actions.onClosePreview, scriptMeta(s))
        else Column(Modifier.padding(16.dp)) {
            Text(s.name, style = ObliTypography.dialogTitle, color = c.text)
            Text(scriptMeta(s), style = ObliTypography.labelSmall, color = c.textMuted)
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.managedByMaster(s)) LockLine()
            s.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = ObliTypography.body, color = c.text2) }
            val params = s.parameters
            when {
                state.previewLoading && params == null -> Text(stringResource(R.string.automations_loading), style = ObliTypography.labelSmall, color = c.textMuted)
                params.isNullOrEmpty() -> Text(stringResource(R.string.automations_no_params), style = ObliTypography.labelSmall, color = c.textMuted)
                else -> {
                    SectionTitle(stringResource(R.string.automations_params), count = params.size)
                    params.sortedBy { it.sortOrder }.forEach { p ->
                        Column {
                            Text(p.title + if (p.required) " *" else "", style = ObliTypography.label, color = c.text)
                            val meta = listOfNotNull(paramTypeName(p.kind), p.defaultValue?.takeIf { it.isNotBlank() && p.kind != ParamType.SECRET }?.let {
                                val shown = if (p.kind == ParamType.BOOLEAN) stringResource(if (ParamField.initial(p).checked) R.string.automations_yes else R.string.automations_no) else it
                                stringResource(R.string.automations_param_default, shown)
                            }).joinToString(" · ")
                            Text(meta, style = ObliTypography.labelSmall, color = c.textMuted)
                        }
                    }
                }
            }
            s.usage?.takeIf { it.scenarios + it.schedules > 0 }?.let { u ->
                Text(
                    stringResource(
                        R.string.automations_used_by,
                        pluralStringResource(R.plurals.automations_scenarios_count, u.scenarios, u.scenarios),
                        pluralStringResource(R.plurals.automations_schedules_count, u.schedules, u.schedules),
                    ),
                    style = ObliTypography.labelSmall,
                    color = c.textMuted,
                )
            }
            TextButton(onClick = { showCode = !showCode }, modifier = Modifier.heightIn(min = 48.dp), shape = ButtonShape) {
                Icon(AutomationsIcons.Code, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
                Text(
                    stringResource(if (showCode) R.string.automations_hide_code else R.string.automations_show_code),
                    style = ObliTypography.label,
                    color = c.text2,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            if (showCode) CodeBlock(s.content.ifEmpty { "—" })
            state.previewProblem?.let { ProblemCard(it, onRetry = { actions.onOpen(s) }) }
        }
        Box(Modifier.fillMaxWidth().padding(16.dp)) {
            PrimaryButton(stringResource(R.string.automations_continue), { actions.onContinue(s) }, Modifier.fillMaxWidth())
        }
    }
}

@Composable
internal fun paramTypeName(t: ParamType): String = stringResource(
    when (t) {
        ParamType.STRING -> R.string.automations_ptype_text
        ParamType.NUMBER -> R.string.automations_ptype_number
        ParamType.BOOLEAN -> R.string.automations_ptype_boolean
        ParamType.SECRET -> R.string.automations_ptype_secret
        ParamType.SELECT -> R.string.automations_ptype_select
        ParamType.MULTISELECT -> R.string.automations_ptype_multiselect
    },
)
