package tools.obli.obliance.more

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor

/*
 * The STYLEKIT pieces these screens need (list-group, list-row,
 * settings-row-switch, segmented, switch-on/off, btn-*), private to the module.
 * Colours come from ObliTheme / ObliTokens, except the toggle track below.
 */

/**
 * STYLEKIT §2.5 "Toggle / checkbox on" (#4F7BFF, white thumb). Not in
 * ObliTokens yet (the access module keeps the same private constant).
 */
internal val SwitchOnTrack = Color(0xFF4F7BFF)

/** Label style of settings rows (list item label: Inter 500 16/22). */
internal val rowLabel get() = ObliTypography.label.copy(fontSize = 16.sp, lineHeight = 22.sp)

@Composable
internal fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = ObliTypography.overline,
        color = ObliTheme.colors.textMuted,
        modifier = modifier.fillMaxWidth().heightIn(min = 40.dp).padding(start = 4.dp, top = 18.dp, bottom = 6.dp).semantics { heading() },
    )
}

/** `list-group`: rows on a surface1 card (radius 12, E1). */
@Composable
internal fun ListGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ObliTheme.colors.surface1)
            .padding(vertical = 4.dp),
        content = content,
    )
}

/** 36 dp icon tile of a row (`hover` background, `text2` icon). */
@Composable
internal fun IconTile(icon: ImageVector, enabled: Boolean = true) {
    val c = ObliTheme.colors
    Box(Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).background(c.hover), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = if (enabled) c.text2 else c.textMuted, modifier = Modifier.size(18.dp))
    }
}

/** `list-row`: icon tile, label + value, chevron when it navigates. */
@Composable
internal fun NavRow(
    icon: ImageVector?,
    title: String,
    value: String?,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    chevron: Boolean = true,
    monoValue: Boolean = false,
    valueColor: Color? = null,
    leading: (@Composable () -> Unit)? = null,
    titleTrailing: (@Composable RowScope.() -> Unit)? = null,
    reason: String? = null,
) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 64.dp)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when {
            leading != null -> Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { leading() }
            icon != null -> IconTile(icon)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, style = rowLabel, color = c.text, modifier = Modifier.weight(1f, fill = false))
                titleTrailing?.invoke(this)
            }
            if (!value.isNullOrEmpty()) {
                Text(
                    value,
                    style = if (monoValue) ObliTypography.monoCaption.copy(fontSize = 13.sp, lineHeight = 18.sp) else ObliTypography.body,
                    color = valueColor ?: c.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (!reason.isNullOrEmpty()) ReasonLine(reason)
        }
        if (onClick != null && chevron) Icon(tools.obli.core.designsystem.ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(20.dp))
    }
}

/** Mono upper-case tag ("ACTIF"), `divider` background, `text2` label. */
@Composable
internal fun Tag(text: String) {
    val c = ObliTheme.colors
    Text(
        text.uppercase(),
        style = ObliTypography.overline.copy(letterSpacing = 0.08.em),
        color = c.text2,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.divider).padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

/**
 * `settings-row-switch`: the whole row toggles (≥ 72 dp, TalkBack: switch
 * named by the title). Disabled rows say why in [reason].
 */
@Composable
internal fun SwitchRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
    reason: String? = null,
) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 72.dp)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconTile(icon, enabled)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = rowLabel, color = if (enabled) c.text else c.text2)
            if (!subtitle.isNullOrEmpty()) Text(subtitle, style = ObliTypography.body, color = c.textMuted)
            if (!reason.isNullOrEmpty()) ReasonLine(reason)
        }
        KitSwitch(checked, enabled)
    }
}

/** "ⓘ reason" under a disabled control (`btn-disabled`: always say why). */
@Composable
internal fun ReasonLine(text: String, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(modifier, verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(tools.obli.core.designsystem.ObliIcons.Info, contentDescription = null, tint = c.textMuted, modifier = Modifier.padding(top = 2.dp).size(12.dp))
        Text(text, style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal), color = c.textMuted)
    }
}

/** `switch-on` / `switch-off`, drawn only (the row carries the semantics); 60 × 48 dp. */
@Composable
internal fun KitSwitch(checked: Boolean, enabled: Boolean) {
    val c = ObliTheme.colors
    val track = when {
        checked && enabled -> SwitchOnTrack
        checked -> SwitchOnTrack.copy(alpha = 0.38f)
        else -> c.divider
    }
    Box(Modifier.width(60.dp).height(48.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.width(52.dp).height(32.dp).clip(RoundedCornerShape(16.dp)).background(track)) {
            if (checked) {
                Box(
                    Modifier.offset(x = 24.dp, y = 4.dp).size(24.dp).clip(CircleShape).background(ObliTokens.ON_FILL.toColor().copy(alpha = if (enabled) 1f else 0.7f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(tools.obli.core.designsystem.ObliIcons.Check, contentDescription = null, tint = SwitchOnTrack, modifier = Modifier.size(14.dp))
                }
            } else {
                Box(Modifier.offset(x = 8.dp, y = 8.dp).size(16.dp).clip(CircleShape).background(if (enabled) c.textMuted else c.textFaint))
            }
        }
    }
}

/**
 * `segmented` on a card (track `chrome`): selected segment `active` + 600.
 * 48 dp high so each segment is a full touch target; radio semantics.
 */
@Composable
internal fun <T> Segmented(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    mono: Boolean = false,
    groupLabel: String? = null,
) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(8.dp)).background(c.chrome).padding(3.dp)
            .selectableGroup()
            .then(if (groupLabel != null) Modifier.semantics { contentDescription = groupLabel } else Modifier),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { (value, label) ->
            val isSelected = value == selected
            val base = if (mono) ObliTypography.monoCaption.copy(fontWeight = FontWeight.Medium) else ObliTypography.label
            Box(
                Modifier.weight(1f).fillMaxWidth().height(42.dp).clip(RoundedCornerShape(6.dp))
                    .background(if (isSelected) c.active else Color.Transparent)
                    .selectable(selected = isSelected, enabled = enabled, role = Role.RadioButton) { onSelect(value) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = if (isSelected && !mono) base.copy(fontWeight = FontWeight.SemiBold) else base,
                    color = when {
                        !enabled -> c.textMuted.copy(alpha = 0.6f)
                        isSelected -> c.text
                        else -> c.textMuted
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** Title + subtitle over a full-width [Segmented] (S83 "Verrouiller après", "Thème"). */
@Composable
internal fun <T> SegmentedRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    enabled: Boolean = true,
    mono: Boolean = false,
    helper: String? = null,
    reason: String? = null,
) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 12.dp, top = 10.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            IconTile(icon, enabled)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = rowLabel, color = if (enabled) c.text else c.text2)
                if (!subtitle.isNullOrEmpty()) Text(subtitle, style = ObliTypography.body, color = c.textMuted)
            }
        }
        Column(Modifier.padding(start = 50.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Segmented(options, selected, onSelect, enabled = enabled, mono = mono, groupLabel = title)
            if (!helper.isNullOrEmpty()) Text(helper, style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal), color = c.textMuted)
            if (!reason.isNullOrEmpty()) ReasonLine(reason)
        }
    }
}

/** `btn-primary` (accentFill, white label) or `btn-secondary` (hover); 48 dp. */
@Composable
internal fun KitButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = true,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    val c = ObliTheme.colors
    val bg = when {
        !enabled -> c.surface2
        primary -> c.accentFill
        else -> c.hover
    }
    val fg = when {
        !enabled -> c.textMuted
        primary -> c.onAccentFill
        else -> c.text
    }
    Row(
        modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).background(bg)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
        Text(text, style = ObliTypography.label, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
