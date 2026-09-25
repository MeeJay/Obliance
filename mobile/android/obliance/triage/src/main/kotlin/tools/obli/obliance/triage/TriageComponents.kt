package tools.obli.obliance.triage

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerProfile
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.domain.AlertCategory

/** Card surface of design doc §8.5 (E1): surface1, radius 12, no border. */
internal fun Modifier.obliCard(shape: RoundedCornerShape = RoundedCornerShape(12.dp), color: Color? = null): Modifier =
    this.shadow(10.dp, shape, ambientColor = Color.Black.copy(alpha = 0.45f), spotColor = Color.Black.copy(alpha = 0.45f))
        .clip(shape)
        .then(if (color != null) Modifier.background(color) else Modifier)

/** A 48 dp touch target around a smaller visual (chips, segments). */
@Composable
internal fun Tap48(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    role: Role = Role.Button,
    shape: RoundedCornerShape = RoundedCornerShape(8.dp),
    visual: Modifier = Modifier,
    center: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    Box(
        modifier.heightIn(min = 48.dp).clickable(interactionSource = source, indication = null, role = role, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            visual.clip(shape).indication(source, ripple()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = if (center) Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally) else Arrangement.spacedBy(6.dp),
            content = content,
        )
    }
}

/** Mono overline of a section ("NON LUES · 7"). */
@Composable
internal fun SectionHeader(title: String, modifier: Modifier = Modifier, trailing: String? = null) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 40.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title.uppercase(), style = ObliTypography.overline, color = c.textMuted, modifier = Modifier.weight(1f).semantics { heading() })
        if (trailing != null) Text(trailing, style = ObliTypography.monoCaption, color = c.textMuted)
    }
}

/** Status dot with the 2 s opacity pulse of §8.6 (state dots only). */
@Composable
internal fun PulseDot(color: Color, pulse: Boolean, size: Dp = 8.dp) {
    val alpha = if (pulse) {
        val t = rememberInfiniteTransition(label = "pulse")
        val a by t.animateFloat(1f, 0.5f, infiniteRepeatable(tween(1_000, easing = LinearEasing), RepeatMode.Reverse), label = "pulse-alpha")
        a
    } else {
        1f
    }
    Box(Modifier.size(size).alpha(alpha).clip(CircleShape).background(color))
}

/**
 * IncidentCard (design doc §5 S10, §8.9): 3 dp severity bar, mono overline
 * ([server tile] severity · tenant · time · age), "device — category" title,
 * the server message as is, and the live state line. Unread = blue dot.
 */
@Composable
internal fun IncidentCard(
    item: IncidentUi,
    time: TriageTime,
    onOpen: (() -> Unit)?,
    modifier: Modifier = Modifier,
    /** TalkBack equivalents of the swipes (§7.1), on the node TalkBack focuses. */
    a11yActions: List<CustomAccessibilityAction> = emptyList(),
) {
    val c = ObliTheme.colors
    val look = SeverityLook.of(item.severity, item.category)
    val bar = look.bar.toColor()
    val openLabel = stringResource(R.string.triage_card_open)
    Box(
        modifier
            .fillMaxWidth()
            .obliCard(color = c.surface1)
            .drawBehind { drawRect(bar, size = Size(3.dp.toPx(), size.height)) }
            .then(if (onOpen != null) Modifier.clickable(onClickLabel = openLabel, onClick = onOpen) else Modifier)
            // One focusable node per card (even without a device to open), carrying the swipe actions.
            .semantics(mergeDescendants = true) { if (a11yActions.isNotEmpty()) customActions = a11yActions },
    ) {
        Column(Modifier.padding(start = 18.dp, top = 14.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Overline(item.server, look, listOfNotNull(item.tenantName, item.createdAt?.hhmm(time.zone)), optional = relativeAge(item.createdAt, time.now))
            Text(
                incidentTitle(item),
                style = ObliTypography.rowTitle,
                color = c.text,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(end = if (item.unread) 18.dp else 0.dp),
            )
            if (item.message.isNotBlank()) {
                Text(item.message, style = ObliTypography.body, color = c.text2, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            LiveLineRow(item)
        }
        if (item.unread) {
            val unreadLabel = stringResource(R.string.triage_card_unread)
            Box(
                Modifier.align(Alignment.TopEnd).padding(top = 39.dp, end = 16.dp).size(8.dp).clip(CircleShape)
                    .background(ObliTokens.UNREAD.toColor()).semantics { contentDescription = unreadLabel },
            )
        }
    }
}

/** "[OP] (!) CRITIQUE · ACME · 03:12 · 4 min". */
@Composable
internal fun Overline(
    server: ServerProfile?,
    look: SeverityLook?,
    parts: List<String>,
    labelOverride: String? = null,
    colorOverride: Color? = null,
    icon: ImageVector? = null,
    /** Last part, left out when the line would not fit (the relative age). */
    optional: String? = null,
) {
    val c = ObliTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (server != null) ObliServerTile(server.color, server.monogram, server.displayName, size = 20.dp)
        val color = colorOverride ?: look?.text?.toColor() ?: c.textMuted
        val glyph = icon ?: look?.icon
        val label = labelOverride ?: look?.let { stringResource(it.label) }
        if (label != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (glyph != null) Icon(glyph, contentDescription = null, tint = color, modifier = Modifier.size(12.dp))
                Text(label.uppercase(), style = ObliTypography.overline, color = color, maxLines = 1)
            }
        }
        var withOptional by remember(parts, optional) { mutableStateOf(optional != null) }
        val rest = parts.filter { it.isNotBlank() } + listOfNotNull(optional?.takeIf { withOptional })
        if (rest.isNotEmpty()) {
            Text(
                (if (label != null) "· " else "") + rest.joinToString(" · ").uppercase(),
                style = ObliTypography.overline,
                color = c.textMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                onTextLayout = { if (withOptional && it.hasVisualOverflow) withOptional = false },
            )
        }
    }
}

@Composable
private fun LiveLineRow(item: IncidentUi) {
    val c = ObliTheme.colors
    when (val live = item.live) {
        LiveLine.None -> Unit
        LiveLine.OtherServer -> IconLine(ObliIcons.Server, stringResource(R.string.triage_live_other_server))
        LiveLine.OtherTenant -> IconLine(ObliIcons.Building2, stringResource(R.string.triage_live_other_tenant))
        LiveLine.SessionExpired -> IconLine(ObliIcons.Lock, stringResource(R.string.triage_live_session_expired))
        LiveLine.Unreachable -> IconLine(TriageIcons.WifiOff, stringResource(R.string.triage_live_unreachable))
        is LiveLine.State -> {
            val (status, text) = stateLine(live)
            val color = status.argb.toColor()
            val still = live.category != AlertCategory.RECOVERY && status != ObliTokens.Status.ONLINE
            Row(
                Modifier.padding(top = 2.dp).heightIn(min = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                PulseDot(color, pulse = still)
                Text(text, style = ObliTypography.labelSmall, color = if (status == ObliTokens.Status.OFFLINE) c.text2 else color, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun IconLine(icon: ImageVector, text: String) {
    val c = ObliTheme.colors
    Row(
        Modifier.padding(top = 2.dp).heightIn(min = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(14.dp))
        Text(text, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Colour and text of the live line: "Toujours hors ligne", "Critique · CPU 98 %", "Rétabli · en ligne". */
@Composable
private fun stateLine(live: LiveLine.State): Pair<ObliTokens.Status, String> {
    val reading = live.reading?.let { r ->
        when (r.kind) {
            MetricKind.CPU -> stringResource(R.string.triage_reading_cpu, r.percent)
            MetricKind.RAM -> stringResource(R.string.triage_reading_ram, r.percent)
            MetricKind.DISK -> stringResource(R.string.triage_reading_disk, r.mount.orEmpty(), r.percent)
        }
    }
    val template = stringResource(R.string.triage_live_with_reading)
    fun with(label: String) = if (reading != null) String.format(template, label, reading) else label
    return when (live.status) {
        DeviceStatus.OFFLINE ->
            ObliTokens.Status.OFFLINE to stringResource(if (live.category == AlertCategory.OFFLINE) R.string.triage_live_still_offline else R.string.triage_live_offline)
        DeviceStatus.CRITICAL ->
            ObliTokens.Status.CRITICAL to (reading?.let { with(stringResource(R.string.triage_severity_critical)) } ?: stringResource(R.string.triage_live_still_critical))
        DeviceStatus.WARNING ->
            ObliTokens.Status.WARNING to (reading?.let { with(stringResource(R.string.triage_severity_warning)) } ?: stringResource(R.string.triage_live_still_warning))
        DeviceStatus.ONLINE, DeviceStatus.UPDATING ->
            ObliTokens.Status.ONLINE to if (live.category == AlertCategory.OFFLINE) stringResource(R.string.triage_live_back_online) else with(stringResource(R.string.triage_live_online))
        DeviceStatus.MAINTENANCE -> ObliTokens.Status.MAINTENANCE to stringResource(R.string.triage_live_maintenance)
        DeviceStatus.PENDING -> ObliTokens.Status.PENDING to stringResource(R.string.triage_live_pending)
        DeviceStatus.SUSPENDED -> ObliTokens.Status.SUSPENDED to stringResource(R.string.triage_live_suspended)
        DeviceStatus.PENDING_UNINSTALL -> ObliTokens.Status.PENDING_UNINSTALL to stringResource(R.string.triage_live_uninstalling)
        DeviceStatus.UPDATE_ERROR, DeviceStatus.UNKNOWN -> ObliTokens.Status.OFFLINE to stringResource(R.string.triage_live_other_tenant)
    }
}

/** CorrelationCard (§8.9): "POSSIBLE COUPURE DE SITE", timed sentence, "Voir les N" lists the devices. */
@Composable
internal fun CorrelationCard(item: OutageUi, time: TriageTime, expanded: Boolean, onToggle: () -> Unit, onOpenDevice: (Long) -> Unit) {
    val c = ObliTheme.colors
    val count = item.devices.size
    Column(
        Modifier.fillMaxWidth().obliCard(color = c.surface1).padding(start = 16.dp, top = 12.dp, end = 12.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (item.server != null) ObliServerTile(item.server.color, item.server.monogram, item.server.displayName, size = 20.dp)
            Icon(TriageIcons.Network, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(14.dp))
            Text(
                stringResource(R.string.triage_outage_title).uppercase(),
                style = ObliTypography.overline,
                color = c.textMuted,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val devicesText = pluralStringResource(R.plurals.triage_outage_devices, count, count)
            val from = item.outage.from.hhmm(time.zone)
            val to = item.outage.to.hhmm(time.zone)
            val sentence = if (item.tenantName != null) {
                stringResource(R.string.triage_outage_sentence_tenant, devicesText, item.tenantName, from, to)
            } else {
                stringResource(R.string.triage_outage_sentence, devicesText, from, to)
            }
            Text(
                buildAnnotatedString {
                    val at = sentence.indexOf(devicesText)
                    if (at < 0) {
                        append(sentence)
                    } else {
                        append(sentence.substring(0, at))
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(devicesText) }
                        append(sentence.substring(at + devicesText.length))
                    }
                },
                style = ObliTypography.body,
                color = c.text,
                modifier = Modifier.weight(1f),
            )
            TonalButton(
                text = if (expanded) stringResource(R.string.triage_outage_hide) else stringResource(R.string.triage_outage_show, count),
                onClick = onToggle,
                icon = if (expanded) ObliIcons.ChevronDown else ObliIcons.ChevronRight,
                trailingIcon = true,
                height = 44.dp,
            )
        }
        if (expanded) {
            item.devices.forEach { (name, id) ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(6.dp))
                        .then(if (id != null) Modifier.clickable(role = Role.Button) { onOpenDevice(id) } else Modifier)
                        .padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    PulseDot(ObliTokens.Status.OFFLINE.argb.toColor(), pulse = false, size = 6.dp)
                    Text(name, style = ObliTypography.label, color = c.text, modifier = Modifier.weight(1f))
                    if (id != null) Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

/** Accent tonal button (STYLEKIT btn-tonal): accent2 at 12 %, never a filled red next to an incident. */
@Composable
internal fun TonalButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    trailingIcon: Boolean = false,
    enabled: Boolean = true,
    height: Dp = 48.dp,
    fill: Boolean = false,
) {
    val c = ObliTheme.colors
    val fg = if (enabled) c.accent2 else c.textFaint
    Tap48(
        onClick = { if (enabled) onClick() },
        modifier = modifier,
        center = fill,
        visual = (if (fill) Modifier.fillMaxWidth() else Modifier).height(height).background(if (enabled) c.accent2.copy(alpha = 0.12f) else c.surface2, RoundedCornerShape(8.dp))
            .padding(start = if (icon != null && !trailingIcon) 12.dp else 16.dp, end = if (icon != null && trailingIcon) 10.dp else 16.dp),
    ) {
        if (icon != null && !trailingIcon) Icon(icon, null, tint = fg, modifier = Modifier.size(16.dp))
        Text(text, style = ObliTypography.label, color = fg, maxLines = 1)
        if (icon != null && trailingIcon) Icon(icon, null, tint = fg, modifier = Modifier.size(16.dp))
    }
}

/** Filled primary button (#C83232): the ONLY red fill allowed in content (§8.3). */
@Composable
internal fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = ObliTheme.colors
    Tap48(
        onClick = { if (enabled) onClick() },
        modifier = modifier,
        visual = Modifier.fillMaxWidth().height(48.dp).background(if (enabled) c.accentFill else c.surface2, RoundedCornerShape(8.dp)).padding(horizontal = 16.dp),
    ) {
        Text(
            text,
            style = ObliTypography.label,
            color = if (enabled) c.onAccentFill else c.textFaint,
            maxLines = 1,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f),
        )
    }
}

/** Neutral text button (Annuler, Se reconnecter). */
@Composable
internal fun TextAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = ObliTheme.colors.accent2) {
    Tap48(onClick = onClick, modifier = modifier, visual = Modifier.height(40.dp).padding(horizontal = 12.dp)) {
        Text(text, style = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold), color = color, maxLines = 1)
    }
}

/** The flat line of the calm state (design doc §5 S10 "trait plat #1EDD8A à 30 %"), decorative only. */
private val CALM_LINE = Color(0xFF1EDD8A)

/** Calm empty state of À traiter (STYLEKIT empty-triage): flat green line at 30 %, "Rien à traiter." */
@Composable
internal fun CalmTriage(detail: String, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Column(
        modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val line = CALM_LINE
        Canvas(Modifier.width(200.dp).height(24.dp)) {
            drawLine(
                Brush.horizontalGradient(listOf(line.copy(alpha = 0f), line.copy(alpha = 0.3f), line.copy(alpha = 0f))),
                start = androidx.compose.ui.geometry.Offset(0f, size.height / 2),
                end = androidx.compose.ui.geometry.Offset(size.width, size.height / 2),
                strokeWidth = 2.dp.toPx(),
                cap = StrokeCap.Round,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            stringResource(R.string.triage_empty_title),
            style = ObliTypography.screenTitle.copy(fontSize = 28.sp, lineHeight = 32.sp),
            color = c.text,
            textAlign = TextAlign.Center,
        )
        Text(detail, style = ObliTypography.monoCaption, color = c.textMuted, textAlign = TextAlign.Center)
    }
}

/** Skeleton at the final card shape (§5 "Chargement": 1.2 s pulse, never a full-screen spinner). */
@Composable
internal fun SkeletonCard() {
    val c = ObliTheme.colors
    val t = rememberInfiniteTransition(label = "skeleton")
    val a by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(600, easing = LinearEasing), RepeatMode.Reverse), label = "skeleton-alpha")
    Column(
        Modifier.fillMaxWidth().alpha(a).obliCard(color = c.surface1).padding(start = 18.dp, top = 16.dp, end = 16.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.width(160.dp).height(10.dp).clip(RoundedCornerShape(4.dp)).background(c.hover))
        Box(Modifier.width(220.dp).height(14.dp).clip(RoundedCornerShape(4.dp)).background(c.hover))
        Box(Modifier.fillMaxWidth(0.8f).height(12.dp).clip(RoundedCornerShape(4.dp)).background(c.surface2))
    }
}

/** Discreet full-width line (STYLEKIT offline-banner): icon, text, optional action. */
@Composable
internal fun NoticeLine(icon: ImageVector, text: String, action: String? = null, onAction: () -> Unit = {}) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).background(c.hover).padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
        Text(text, style = ObliTypography.body, color = c.text2, modifier = Modifier.weight(1f).padding(vertical = 6.dp))
        if (action != null) TextAction(action, onAction, color = ObliTokens.UNREAD.toColor())
    }
}

/** Expiry ring of an approval (STYLEKIT expiry-ring, 30 min scale). */
@Composable
internal fun ExpiryRing(minutes: Int?, size: Dp, label: String?, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val color = expiryColor(minutes)
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val stroke = (size.toPx() / 14f).coerceAtLeast(3.dp.toPx())
            val inset = stroke / 2
            val arcSize = Size(this.size.width - stroke, this.size.height - stroke)
            val topLeft = androidx.compose.ui.geometry.Offset(inset, inset)
            drawArc(c.hover, 0f, 360f, false, topLeft, arcSize, style = Stroke(stroke))
            val fraction = ((minutes ?: 30).coerceIn(0, 30)) / 30f
            drawArc(color, -90f, 360f * fraction, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        if (label != null) Text(label, style = ObliTypography.monoCaption.copy(fontSize = 11.sp), color = c.text)
    }
}
