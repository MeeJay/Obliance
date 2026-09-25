package tools.obli.obliance.automations

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliStatusDot
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.DeviceStatus

/** Search field (48 dp, surface2, magnifier, clear). */
@Composable
internal fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).background(c.surface2).padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ObliIcons.Search, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(placeholder, style = ObliTypography.body, color = c.textMuted, maxLines = 1)
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = ObliTypography.body.copy(color = c.text),
                cursorBrush = SolidColor(c.text),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
            )
        }
        if (value.isNotEmpty()) ObliIconButton(ObliIcons.X, stringResource(R.string.automations_clear_search), { onChange("") })
    }
}

/**
 * A panel over the current screen (not a dialog window, so screenshot tests
 * capture it): scrim + bottom sheet on phones, a 420 dp side sheet from
 * 600 dp (design doc §5 S51 "Tablette"). Back closes it.
 */
@Composable
internal fun OverlayPanel(
    onDismiss: () -> Unit,
    wide: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = ObliTheme.colors
    BackHandler(onBack = onDismiss)
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize().background(Color(0x99000000))
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClickLabel = stringResource(R.string.automations_close), onClick = onDismiss),
        )
        val shape = if (wide) RoundedCornerShape(topStart = 16.dp, bottomStart = 16.dp) else RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
        Column(
            modifier
                .then(if (wide) Modifier.align(Alignment.CenterEnd).width(420.dp).fillMaxHeight() else Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 720.dp).fillMaxHeight(0.88f))
                .clip(shape)
                .background(c.surface1)
                .imePadding(),
            content = content,
        )
    }
}

/** Header of a panel: title, optional subtitle, close. */
@Composable
internal fun PanelHeader(title: String, onClose: () -> Unit, subtitle: String? = null) {
    val c = ObliTheme.colors
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = ObliTypography.dialogTitle, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        ObliIconButton(ObliIcons.X, stringResource(R.string.automations_close), onClose)
    }
}

/** Status dot of a device (connected / offline / warning / critical), with the label next to it elsewhere. */
@Composable
internal fun DeviceDot(d: Device, size: Dp = 8.dp) {
    val s = when (d.statusKind) {
        DeviceStatus.CRITICAL -> ObliTokens.Status.CRITICAL
        DeviceStatus.WARNING -> ObliTokens.Status.WARNING
        DeviceStatus.OFFLINE -> ObliTokens.Status.OFFLINE
        DeviceStatus.PENDING -> ObliTokens.Status.PENDING
        DeviceStatus.MAINTENANCE -> ObliTokens.Status.MAINTENANCE
        DeviceStatus.SUSPENDED -> ObliTokens.Status.SUSPENDED
        DeviceStatus.PENDING_UNINSTALL -> ObliTokens.Status.PENDING_UNINSTALL
        else -> ObliTokens.Status.ONLINE
    }
    ObliStatusDot(s, compact = size < 8.dp)
}

@Composable
internal fun deviceStatusText(d: Device): String = stringResource(
    when (d.statusKind) {
        DeviceStatus.ONLINE, DeviceStatus.UPDATING -> R.string.automations_device_online
        DeviceStatus.WARNING -> R.string.automations_device_warning
        DeviceStatus.CRITICAL -> R.string.automations_device_critical
        DeviceStatus.OFFLINE -> R.string.automations_device_offline
        DeviceStatus.PENDING -> R.string.automations_device_pending
        else -> R.string.automations_device_other
    },
)

/**
 * "Ajouter" / "Déclencher sur…": search the devices of the active server and
 * tick some (design doc §5 S51 item 3). [search] is `GET /api/devices?search=`.
 */
@Composable
internal fun DevicePickerPanel(
    title: String,
    confirm: (Int) -> String,
    already: Set<Long>,
    wide: Boolean,
    search: suspend (String) -> ApiOutcome<DevicePage>,
    onDismiss: () -> Unit,
    onDone: (List<Device>) -> Unit,
) {
    val c = ObliTheme.colors
    var query by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<ApiOutcome<DevicePage>?>(null) }
    var loading by remember { mutableStateOf(true) }
    val picked = remember { mutableStateListOf<Device>() }
    LaunchedEffect(query) {
        if (query.isNotEmpty()) delay(300)
        loading = true
        result = search(query)
        loading = false
    }
    OverlayPanel(onDismiss, wide) {
        PanelHeader(title, onDismiss)
        SearchField(query, { query = it }, stringResource(R.string.automations_search_devices), Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        Box(Modifier.weight(1f)) {
            val page = (result as? ApiOutcome.Ok)?.value
            when {
                page == null && loading -> CircularProgressIndicator(Modifier.align(Alignment.Center).size(28.dp), color = c.text2, strokeWidth = 2.dp)
                page == null -> result?.let { ProblemCard(it, onRetry = null, modifier = Modifier.padding(16.dp)) }
                page.items.isEmpty() -> Text(stringResource(R.string.automations_no_device_match), style = ObliTypography.body, color = c.textMuted, modifier = Modifier.padding(16.dp))
                else -> LazyColumn(contentPadding = PaddingValues(bottom = 8.dp)) {
                    items(page.items, key = { it.id }) { d ->
                        val inBatch = d.id in already
                        val checked = inBatch || picked.any { it.id == d.id }
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 56.dp)
                                .toggleable(value = checked, enabled = !inBatch, role = Role.Checkbox) { on -> if (on) picked.add(d) else picked.removeAll { it.id == d.id } }
                                .padding(horizontal = 16.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Checkbox(
                                checked = checked,
                                onCheckedChange = null,
                                enabled = !inBatch,
                                colors = CheckboxDefaults.colors(checkedColor = c.text, checkmarkColor = c.bg, uncheckedColor = c.textMuted),
                            )
                            Column(Modifier.weight(1f)) {
                                Text(d.label, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    DeviceDot(d, 6.dp)
                                    Text(
                                        listOfNotNull(deviceStatusText(d), d.tenantName, d.osName).joinToString(" · "),
                                        style = ObliTypography.labelSmall,
                                        color = c.textMuted,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                    }
                    if (page.total > page.items.size) {
                        item {
                            Text(
                                pluralStringResource(R.plurals.automations_more_devices, page.total - page.items.size, page.total - page.items.size),
                                style = ObliTypography.labelSmall,
                                color = c.textMuted,
                                modifier = Modifier.padding(16.dp),
                            )
                        }
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(16.dp)) {
            PrimaryButton(confirm(picked.size), { onDone(picked.toList()) }, enabled = picked.isNotEmpty(), modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Mono code block (read-only, selectable), 13 sp with line wrap. */
@Composable
internal fun CodeBlock(text: String, modifier: Modifier = Modifier, maxHeight: Dp = Dp.Unspecified) {
    val c = ObliTheme.colors
    androidx.compose.foundation.text.selection.SelectionContainer {
        Text(
            text,
            style = ObliTypography.terminal,
            color = c.text,
            modifier = modifier.fillMaxWidth()
                .then(if (maxHeight != Dp.Unspecified) Modifier.heightIn(max = maxHeight) else Modifier)
                .clip(RoundedCornerShape(8.dp)).background(c.surface2).padding(12.dp),
        )
    }
}

/** Centred progress indicator. */
@Composable
internal fun BoxScope.CenterSpinner() {
    CircularProgressIndicator(Modifier.align(Alignment.Center).size(28.dp), color = ObliTheme.colors.text2, strokeWidth = 2.dp)
}
