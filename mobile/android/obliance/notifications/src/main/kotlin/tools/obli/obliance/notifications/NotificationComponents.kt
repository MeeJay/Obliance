package tools.obli.obliance.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography

/*
 * Module-private building blocks of S84 and the permission dialogs, after
 * STYLEKIT: list-group, list-row, settings-row-switch, segmented, card,
 * chip-filter, btn-*, switch-on/off. No borders; depth by surface steps.
 */

/** Toggle "on" colour (STYLEKIT: switches and checkboxes on = #4F7BFF, never red). */
internal val ToggleOn = Color(0xFF4F7BFF)

/** Links and info (#60A5FA). */
internal val LinkBlue = Color(0xFF60A5FA)

/** Online / OK (#4ADE80). */
internal val OkGreen = Color(0xFF4ADE80)

/** Attention (#FACC15). */
internal val WarnYellow = Color(0xFFFACC15)

@Composable
internal fun NotifSectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = ObliTypography.overline,
        color = ObliTheme.colors.textMuted,
        modifier = modifier.fillMaxWidth().heightIn(min = 40.dp).padding(top = 18.dp, bottom = 6.dp).semantics { heading() },
    )
}

/** `list-group`: rows on a surface1 card. */
@Composable
internal fun NotifGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .shadow(6.dp, RoundedCornerShape(12.dp), clip = false, ambientColor = Color.Black.copy(alpha = 0.45f), spotColor = Color.Black.copy(alpha = 0.45f))
            .clip(RoundedCornerShape(12.dp))
            .background(ObliTheme.colors.surface1)
            .padding(vertical = 4.dp),
        content = content,
    )
}

/** `card`: surface1, radius 12, padding 16. */
@Composable
internal fun NotifCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ObliTheme.colors.surface1)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

/** 36 dp icon tile of a row (hover background, text2 icon). */
@Composable
internal fun RowIcon(icon: ImageVector, tint: Color = ObliTheme.colors.text2) {
    Box(Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).background(ObliTheme.colors.hover), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
    }
}

/** `list-row`: icon · title + subtitle · trailing; clickable when [onClick] is set. */
@Composable
internal fun NotifRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector? = null,
    leading: (@Composable () -> Unit)? = null,
    subtitleColor: Color = ObliTheme.colors.textMuted,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = ObliTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when {
            leading != null -> leading()
            icon != null -> RowIcon(icon)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = ObliTypography.label.copy(fontSize = 16.sp, lineHeight = 22.sp), color = c.text)
            if (!subtitle.isNullOrEmpty()) Text(subtitle, style = ObliTypography.body, color = subtitleColor)
        }
        trailing?.invoke()
    }
}

/** `settings-row-switch`: the whole row toggles (60 × 48 switch hit area inside). */
@Composable
internal fun NotifSwitchRow(
    title: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val c = ObliTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange)
            .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (icon != null) RowIcon(icon)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = ObliTypography.label.copy(fontSize = 16.sp, lineHeight = 22.sp), color = if (enabled) c.text else c.textFaint)
            if (!subtitle.isNullOrEmpty()) Text(subtitle, style = ObliTypography.body, color = c.textMuted)
        }
        NotifSwitchVisual(checked, enabled)
    }
}

/** `switch-on` / `switch-off` (visual only; the row carries the semantics). */
@Composable
internal fun NotifSwitchVisual(checked: Boolean, enabled: Boolean = true) {
    val c = ObliTheme.colors
    Box(Modifier.width(60.dp).height(48.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.width(52.dp).height(32.dp).clip(RoundedCornerShape(16.dp))
                .background(if (checked) ToggleOn.copy(alpha = if (enabled) 1f else 0.4f) else c.divider),
        ) {
            if (checked) {
                Box(
                    Modifier.padding(start = 24.dp, top = 4.dp).size(24.dp).clip(CircleShape).background(Color.White),
                    contentAlignment = Alignment.Center,
                ) { Icon(ObliIcons.Check, contentDescription = null, tint = ToggleOn, modifier = Modifier.size(14.dp)) }
            } else {
                Box(Modifier.padding(start = 8.dp, top = 8.dp).size(16.dp).clip(CircleShape).background(c.textMuted))
            }
        }
    }
}

/** `segmented`: track chrome (on a surface1 card), selected = active + 600. */
@Composable
internal fun <T> NotifSegmented(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).background(c.chrome).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { (value, label) ->
            val isSelected = value == selected
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 42.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (isSelected) c.active else Color.Transparent)
                    .selectable(selected = isSelected, role = Role.Tab, onClick = { onSelect(value) })
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = ObliTypography.label.copy(fontSize = 13.sp, lineHeight = 16.sp, fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium),
                    color = if (isSelected) c.text else c.textMuted,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** `chip-filter` / `chip-filter-selected`: 36 dp visual in a 48 dp touch target. */
@Composable
internal fun NotifChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    a11yLabel: String? = null,
) {
    val c = ObliTheme.colors
    val state = stringResource(if (selected) R.string.notif_selected else R.string.notif_not_selected)
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .toggleable(value = selected, role = Role.Checkbox, onValueChange = { onClick() })
            .semantics {
                stateDescription = state
                if (a11yLabel != null) contentDescription = a11yLabel
            },
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).background(if (selected) c.active else c.surface2).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (selected) Icon(ObliIcons.Check, contentDescription = null, tint = c.text, modifier = Modifier.size(16.dp))
            Text(
                label,
                style = ObliTypography.label.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium),
                color = if (selected) c.text else c.text2,
                maxLines = 1,
            )
        }
    }
}

/** `btn-primary` (#C83232 filled). */
@Composable
internal fun NotifPrimaryButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.buttonColors(containerColor = c.accentFill, contentColor = c.onAccentFill),
    ) { Text(label, style = ObliTypography.label) }
}

/** `btn-tonal` (accent at 12 %, accent2 label). */
@Composable
internal fun NotifTonalButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = 44.dp),
        shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.buttonColors(containerColor = c.accent2.copy(alpha = 0.12f), contentColor = c.accent2),
    ) { Text(label, style = ObliTypography.label) }
}

/** `btn-text` (low emphasis). */
@Composable
internal fun NotifTextButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    TextButton(onClick = onClick, modifier = modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(8.dp)) {
        Text(label, style = ObliTypography.label, color = ObliTheme.colors.text2)
    }
}

/**
 * Dialog card of S04 steps 1-2 (rendered inside a Dialog by the gate, and
 * directly by the screenshot tests: Robolectric does not capture dialogs).
 */
@Composable
internal fun NotifDialogCard(
    icon: ImageVector,
    title: String,
    body: String,
    confirm: String,
    dismiss: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ObliTheme.colors
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.surface1).padding(start = 24.dp, end = 16.dp, top = 24.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(c.hover), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(20.dp))
        }
        Text(title, style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.padding(end = 8.dp).semantics { heading() })
        Text(body, style = ObliTypography.body, color = c.text2, modifier = Modifier.padding(end = 8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            NotifTextButton(dismiss, onDismiss)
            NotifPrimaryButton(confirm, onConfirm)
        }
    }
}
