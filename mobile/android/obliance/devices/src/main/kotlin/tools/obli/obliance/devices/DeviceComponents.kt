package tools.obli.obliance.devices

import androidx.annotation.StringRes
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import java.util.Locale
import tools.obli.core.designsystem.ObliStatusPill
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus

@StringRes
internal fun DeviceStatus.label(): Int = when (this) {
    DeviceStatus.ONLINE -> R.string.devices_status_online
    DeviceStatus.OFFLINE -> R.string.devices_status_offline
    DeviceStatus.WARNING -> R.string.devices_status_warning
    DeviceStatus.CRITICAL -> R.string.devices_status_critical
    DeviceStatus.PENDING -> R.string.devices_status_pending
    DeviceStatus.UPDATING -> R.string.devices_status_updating
    DeviceStatus.MAINTENANCE -> R.string.devices_status_maintenance
    DeviceStatus.SUSPENDED -> R.string.devices_status_suspended
    DeviceStatus.PENDING_UNINSTALL -> R.string.devices_status_pending_uninstall
    DeviceStatus.UPDATE_ERROR -> R.string.devices_status_update_error
    DeviceStatus.UNKNOWN -> R.string.devices_status_unknown
}

@StringRes
internal fun DeviceSection.label(): Int = if (this == DeviceSection.OTHER) R.string.devices_section_other else status.label()

internal val DeviceStatus.color: Color get() = token.argb.toColor()

internal val MetricLevel.color: Color
    get() = when (this) {
        MetricLevel.NORMAL -> ObliTokens.Status.ONLINE.argb.toColor()
        MetricLevel.WARNING -> ObliTokens.Status.WARNING.argb.toColor()
        MetricLevel.CRITICAL -> ObliTokens.Status.CRITICAL.argb.toColor()
    }

/** Locale of the current configuration, for decimal commas ("11,4"). */
@Composable
internal fun currentLocale(): Locale = LocalLocale.current.platformLocale

@Composable
internal fun percentText(value: Double): String = stringResource(R.string.devices_percent, DeviceFormat.percent(value))

@Composable
internal fun ageText(age: Age): String = when (age) {
    Age.JustNow -> stringResource(R.string.devices_age_now)
    is Age.Minutes -> stringResource(R.string.devices_age_min, age.n.toInt())
    is Age.Hours -> stringResource(R.string.devices_age_hour, age.n.toInt())
    is Age.Days -> stringResource(R.string.devices_age_day, age.n.toInt())
}

/** Status pill of the design system (dot + label, never colour alone). */
@Composable
internal fun DeviceStatusPill(status: DeviceStatus, modifier: Modifier = Modifier) {
    ObliStatusPill(status.token, stringResource(status.label()), modifier)
}

/** Status dot with the 2 s opacity pulse of §8.6 (warning, critical, updating, uninstalling). */
@Composable
internal fun PulseDot(color: Color, pulse: Boolean, size: Dp, modifier: Modifier = Modifier, ring: Color? = null) {
    val alpha = if (pulse) {
        val t = rememberInfiniteTransition(label = "pulse")
        val a by t.animateFloat(1f, 0.5f, infiniteRepeatable(tween(1_000, easing = LinearEasing), RepeatMode.Reverse), label = "pulse-alpha")
        a
    } else {
        1f
    }
    Box(
        modifier
            .size(size + if (ring != null) 4.dp else 0.dp)
            .clip(CircleShape)
            .background(ring ?: Color.Transparent),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(size).alpha(alpha).clip(CircleShape).background(color))
    }
}

/** OS icon of a device (STYLEKIT §5): Windows and others `monitor`, Linux `terminal`, macOS `apple`. */
internal fun osIcon(osType: String?): ImageVector = when (osType?.lowercase()) {
    "linux" -> DeviceIcons.Terminal
    "macos", "darwin" -> DeviceIcons.Apple
    else -> tools.obli.core.designsystem.ObliIcons.Monitor
}

/** 36 dp OS tile with its status dot (DeviceRow, §5 S20). */
@Composable
internal fun OsTile(device: Device, ringColor: Color, size: Dp = 36.dp) {
    val c = ObliTheme.colors
    val status = device.statusKind
    Box(Modifier.size(size + 4.dp)) {
        Box(
            Modifier.size(size).clip(RoundedCornerShape(6.dp)).background(c.hover),
            contentAlignment = Alignment.Center,
        ) {
            Icon(osIcon(device.osType), contentDescription = null, tint = c.text2, modifier = Modifier.size(20.dp))
        }
        PulseDot(
            color = status.color,
            pulse = status.pulses,
            size = if (size >= 36.dp) 10.dp else 8.dp,
            ring = ringColor,
            modifier = Modifier.align(Alignment.BottomEnd).offset(x = 1.dp, y = 1.dp),
        )
    }
}

/** Small mono tag: tenant in the global view, "legacy" agent. */
@Composable
internal fun MonoTag(text: String) {
    val c = ObliTheme.colors
    Text(
        text,
        style = ObliTypography.overline.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.06.em),
        color = c.text2,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.hover).padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

/** Section header of the list: dot + "CRITIQUE · 1" overline, sticky on `bg`. */
@Composable
internal fun SectionHeader(label: String, dot: Color?, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 40.dp).background(c.bg).padding(horizontal = 16.dp).semantics { heading() },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (dot != null) Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
        Text(label.uppercase(), style = ObliTypography.overline, color = c.textMuted)
    }
}

/** Freshness stamp (§7.3): live (green dot), updated at (grey), stale (amber). */
@Composable
internal fun FreshnessStamp(label: String, kind: MetricsFeed?, modifier: Modifier = Modifier, stale: Boolean = false) {
    val c = ObliTheme.colors
    val (dot, text) = when {
        stale -> ObliTokens.Status.WARNING.argb.toColor() to ObliTokens.Status.WARNING.argb.toColor()
        kind == MetricsFeed.LIVE -> ObliTokens.Status.ONLINE.argb.toColor() to c.text2
        else -> c.textMuted to c.textMuted
    }
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
        Text(label, style = ObliTypography.monoCaption, color = text, maxLines = 1)
    }
}

/**
 * One mini-bar of a device row (STYLEKIT `mini-bars`): label, 40 × 4 bar,
 * value. Normal values in text2, warning / critical in their colour; greyed
 * when the values are old (offline device).
 */
@Composable
internal fun MiniBar(label: String, percent: Double, level: MetricLevel, greyed: Boolean = false) {
    val c = ObliTheme.colors
    val fill = if (greyed) c.textFaint else level.color
    val valueColor = when {
        greyed -> c.textMuted
        level == MetricLevel.NORMAL -> c.text2
        else -> level.color
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(label, style = ObliTypography.overline.copy(letterSpacing = 0.sp), color = c.textMuted, maxLines = 1)
        Box(Modifier.width(40.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(TRACK)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth((percent / 100.0).toFloat().coerceIn(0f, 1f)).clip(RoundedCornerShape(2.dp)).background(fill))
        }
        Text(percentText(percent), style = ObliTypography.overline.copy(letterSpacing = 0.sp), color = valueColor, maxLines = 1)
    }
}

/** 6 dp metric bar of the detail (STYLEKIT `metric-bar`). */
@Composable
internal fun MetricBar(percent: Double?, level: MetricLevel, greyed: Boolean, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Box(modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(TRACK)) {
        if (percent != null) {
            Box(
                Modifier.fillMaxHeight().fillMaxWidth((percent / 100.0).toFloat().coerceIn(0f, 1f))
                    .clip(RoundedCornerShape(3.dp)).background(if (greyed) c.textFaint else level.color),
            )
        }
    }
}

/** Surface card (E1 look without border): surface1, radius 12, padding 16. */
@Composable
internal fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = ObliTheme.colors
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) { content() }
}

/** Inline error (§5 "Erreur"): short cause, "Réessayer", HTTP code and path underneath. */
@Composable
internal fun ProblemCard(problem: LoadProblem, onRetry: (() -> Unit)?, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Card(modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Icon(
                if (problem.kind == ProblemKind.NETWORK) tools.obli.core.designsystem.ObliIcons.RefreshCw else tools.obli.core.designsystem.ObliIcons.Info,
                contentDescription = null,
                tint = c.text2,
                modifier = Modifier.padding(top = 2.dp).size(18.dp),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(problem.message()), style = ObliTypography.body, color = c.text)
                val detail = problemDetail(problem)
                if (detail != null) Text(detail, style = ObliTypography.monoCaption, color = c.textMuted)
            }
        }
        if (onRetry != null) {
            SecondaryButton(stringResource(R.string.devices_retry), onRetry)
        }
    }
}

@StringRes
internal fun LoadProblem.message(): Int = when (kind) {
    ProblemKind.NETWORK -> R.string.devices_error_network
    ProblemKind.SERVER -> R.string.devices_error_server
    ProblemKind.SESSION_EXPIRED -> R.string.devices_error_session
    ProblemKind.FORBIDDEN -> R.string.devices_error_forbidden
    ProblemKind.RATE_LIMITED -> R.string.devices_error_rate
    ProblemKind.NOT_FOUND -> R.string.devices_not_found
    ProblemKind.NO_SERVER -> R.string.devices_error_no_server
}

/** "HTTP 502 · /api/devices" (§5 "Détails montre le code HTTP et le chemin"). */
@Composable
internal fun problemDetail(problem: LoadProblem): String? {
    val path = problem.path ?: return null
    return if (problem.httpStatus != null) stringResource(R.string.devices_error_detail, problem.httpStatus, path) else path
}

/** Neutral secondary button (#1D2238), 48 dp. */
@Composable
internal fun SecondaryButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    TextButton(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        colors = androidx.compose.material3.ButtonDefaults.textButtonColors(containerColor = c.hover, contentColor = c.text),
        modifier = modifier.heightIn(min = 48.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp),
    ) {
        Text(label, style = ObliTypography.label)
    }
}

/** Track of the metric bars: white at 6 %. */
internal val TRACK = Color(0x0FFFFFFF)

/** Text that never breaks a device name at its hyphens. */
@Composable
internal fun SingleLine(text: String, style: androidx.compose.ui.text.TextStyle, color: Color, modifier: Modifier = Modifier) {
    Text(text, style = style, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier)
}

/** Semantics helper: a merged description for a composite element. */
internal fun Modifier.described(text: String): Modifier = semantics(mergeDescendants = true) { contentDescription = text }
