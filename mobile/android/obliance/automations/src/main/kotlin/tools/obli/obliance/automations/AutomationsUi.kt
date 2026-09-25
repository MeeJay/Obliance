package tools.obli.obliance.automations

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ui.ActionMessages

/** Time source of the module (tests freeze it at 10:42 on 25 September, design doc §4). */
internal data class AutomationsClock(
    val now: () -> Long = System::currentTimeMillis,
    val zone: ZoneId = ZoneId.systemDefault(),
    /** False in screenshot tests: no ticking coroutine. */
    val ticking: Boolean = true,
)

internal val LocalAutomationsClock = staticCompositionLocalOf { AutomationsClock() }

/** Current time, refreshed every [everyMs] while composed. */
@Composable
internal fun rememberNow(everyMs: Long = 5_000): Long {
    val clock = LocalAutomationsClock.current
    var now by remember { mutableLongStateOf(clock.now()) }
    if (clock.ticking) {
        LaunchedEffect(clock) {
            while (true) {
                delay(everyMs)
                now = clock.now()
            }
        }
    }
    return now
}

/** Pure formatting (JVM-testable). */
internal object Fmt {
    fun epoch(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

    /** "10:42". */
    fun time(iso: String?, zone: ZoneId): String? = epoch(iso)?.let { hm(it, zone) }

    fun hm(epoch: Long, zone: ZoneId): String = DateTimeFormatter.ofPattern("HH:mm").format(Instant.ofEpochMilli(epoch).atZone(zone))

    /** Duration between two ISO instants, or null. */
    fun durationMs(start: String?, end: String?): Long? {
        val a = epoch(start) ?: return null
        val b = epoch(end) ?: return null
        return (b - a).takeIf { it >= 0 }
    }

    /** "14 s", "4,8 s" (one decimal under 10 s), "2 min 05 s", "1 h 03". Decimal separator of [locale]. */
    fun duration(ms: Long, locale: Locale): String {
        val s = ms / 1000.0
        return when {
            s < 10 -> String.format(locale, "%.1f s", s)
            s < 60 -> "${Math.round(s)} s"
            s < 3600 -> { val t = Math.round(s); String.format(locale, "%d min %02d s", t / 60, t % 60) }
            else -> { val t = Math.round(s) / 60; String.format(locale, "%d h %02d", t / 60, t % 60) }
        }
    }

    /** "00:12:40". */
    fun clock(ms: Long): String {
        val t = (ms / 1000).coerceAtLeast(0)
        return String.format(Locale.ROOT, "%02d:%02d:%02d", t / 3600, (t / 60) % 60, t % 60)
    }

    /** First non-blank line, trimmed (row preview of stdout / stderr). */
    fun firstLine(text: String?): String? = text?.lineSequence()?.map { it.trim() }?.firstOrNull { it.isNotEmpty() }
}

/** Runtime label as the web shows it ("PowerShell", "bash"…). */
internal fun runtimeLabel(runtime: String): String = when (runtime.lowercase()) {
    "powershell" -> "PowerShell"
    "pwsh" -> "PowerShell 7"
    "cmd" -> "cmd"
    "python", "python3" -> "Python"
    "" -> "—"
    else -> runtime.lowercase()
}

// ---------------------------------------------------------------------------
// Execution steps (design doc §5 S52: En file → Envoyé → En cours → terminal)
// ---------------------------------------------------------------------------

internal enum class ExecStep(val rank: Int, val terminal: Boolean) {
    QUEUED(0, false), SENT(1, false), RUNNING(2, false),
    SUCCESS(3, true), FAILURE(3, true), TIMEOUT(3, true), CANCELLED(3, true), SKIPPED(3, true);

    val isFailure: Boolean get() = this == FAILURE || this == TIMEOUT

    companion object {
        /** script_executions.status / command_queue.status → step. */
        fun of(status: String?): ExecStep = when (status) {
            "pending" -> QUEUED
            "sent" -> SENT
            "running", "ack_running" -> RUNNING
            "success" -> SUCCESS
            "failure", "failed" -> FAILURE
            "timeout" -> TIMEOUT
            "cancelled" -> CANCELLED
            "skipped" -> SKIPPED
            else -> QUEUED
        }
    }
}

internal val ExecStep.color: Color
    @Composable get() = when (this) {
        ExecStep.SUCCESS -> ObliTokens.Status.ONLINE.argb.toColor()
        ExecStep.FAILURE -> ObliTokens.Status.CRITICAL.argb.toColor()
        ExecStep.TIMEOUT -> ObliTokens.Status.WARNING.argb.toColor()
        ExecStep.RUNNING, ExecStep.SENT -> ObliTokens.Status.PENDING.argb.toColor()
        ExecStep.QUEUED, ExecStep.CANCELLED, ExecStep.SKIPPED -> ObliTheme.colors.textMuted
    }

internal val ExecStep.label: Int
    get() = when (this) {
        ExecStep.QUEUED -> R.string.automations_step_queued
        ExecStep.SENT -> R.string.automations_step_sent
        ExecStep.RUNNING -> R.string.automations_step_running
        ExecStep.SUCCESS -> R.string.automations_step_success
        ExecStep.FAILURE -> R.string.automations_step_failure
        ExecStep.TIMEOUT -> R.string.automations_step_timeout
        ExecStep.CANCELLED -> R.string.automations_step_cancelled
        ExecStep.SKIPPED -> R.string.automations_step_skipped
    }

internal val ExecStep.icon: ImageVector
    get() = when (this) {
        ExecStep.SUCCESS -> ObliIcons.CircleCheck
        ExecStep.FAILURE -> AutomationsIcons.CircleX
        ExecStep.TIMEOUT -> ObliIcons.TriangleAlert
        ExecStep.RUNNING -> AutomationsIcons.Loader
        ExecStep.SENT -> AutomationsIcons.Send
        ExecStep.QUEUED -> ObliIcons.Clock
        ExecStep.CANCELLED, ExecStep.SKIPPED -> AutomationsIcons.CircleSlash
    }

/** Module-private Lucide icons (ISC). */
internal object AutomationsIcons {
    val Play: ImageVector by lazy { ObliIcons.lucide("play", "M6 3l14 9-14 9V3z") }
    val Square: ImageVector by lazy { ObliIcons.lucide("square", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z") }
    val CircleX: ImageVector by lazy { ObliIcons.lucide("circle-x", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0", "m15 9-6 6", "m9 9 6 6") }
    val CircleSlash: ImageVector by lazy { ObliIcons.lucide("circle-slash", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0", "M9 15 15 9") }
    val Loader: ImageVector by lazy { ObliIcons.lucide("loader-circle", "M21 12a9 9 0 1 1-6.219-8.56") }
    val Send: ImageVector by lazy { ObliIcons.lucide("send", "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z", "m21.854 2.147-10.94 10.939") }
    val Code: ImageVector by lazy { ObliIcons.lucide("code", "m16 18 6-6-6-6", "m8 6-6 6 6 6") }
    val Copy: ImageVector by lazy { ObliIcons.lucide("copy", "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2") }
    val Share: ImageVector by lazy { ObliIcons.lucide("share-2", "M15 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M3 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M15 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "m8.59 13.51 6.83 3.98", "m15.41 6.51-6.82 3.98") }
    val Terminal: ImageVector by lazy { ObliIcons.lucide("square-terminal", "m7 11 2-2-2-2", "M11 13h4", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z") }
    val CalendarClock: ImageVector by lazy { ObliIcons.lucide("calendar-clock", "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5", "M16 2v4", "M8 2v4", "M3 10h5", "M17.5 17.5 16 16.3V14", "M10 16a6 6 0 1 0 12 0a6 6 0 1 0-12 0") }
    val Zap: ImageVector by lazy { ObliIcons.lucide("zap", "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z") }
    val FileCode: ImageVector by lazy { ObliIcons.lucide("file-code", "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z", "M14 2v4a2 2 0 0 0 2 2h4", "m10 12-2 2 2 2", "m14 16 2-2-2-2") }
    val RotateCcw: ImageVector by lazy { ObliIcons.lucide("rotate-ccw", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5") }
    val ExternalLink: ImageVector by lazy { ObliIcons.lucide("external-link", "M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6") }
    val Eye: ImageVector by lazy { ObliIcons.lucide("eye", "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0") }
    val EyeOff: ImageVector by lazy { ObliIcons.lucide("eye-off", "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49", "M14.084 14.158a3 3 0 0 1-4.242-4.242", "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143", "m2 2 20 20") }
    val ShieldCheck: ImageVector by lazy { ObliIcons.lucide("shield-check", "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "m9 12 2 2 4-4") }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

internal val ButtonShape = RoundedCornerShape(8.dp)

/** Surface card: surface1, radius 12. */
@Composable
internal fun AutoCard(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(16.dp), content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(ObliTheme.colors.surface1).padding(padding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

/** Overline section header "SESSIONS OUVERTES · 2" with an optional trailing link. */
@Composable
internal fun SectionTitle(label: String, modifier: Modifier = Modifier, count: Int? = null, action: String? = null, onAction: (() -> Unit)? = null) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = 40.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            (if (count != null) "$label · $count" else label).uppercase(),
            style = ObliTypography.overline,
            color = c.textMuted,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (action != null && onAction != null) {
            TextButton(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp), shape = ButtonShape) {
                Text(action, style = ObliTypography.labelSmall, color = c.text2)
            }
        }
    }
}

/** Filled primary button: the only red of a screen (design doc §8.3). */
@Composable
internal fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true, busy: Boolean = false) {
    val c = ObliTheme.colors
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        shape = ButtonShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = c.accentFill,
            contentColor = c.onAccentFill,
            disabledContainerColor = if (busy) c.accentFill else c.hover,
            disabledContentColor = if (busy) c.onAccentFill else c.textMuted,
        ),
        modifier = modifier.heightIn(min = 52.dp),
    ) { ButtonContent(text, icon, busy) }
}

/** Neutral button (`hover` surface), 48 dp. */
@Composable
internal fun NeutralButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true, busy: Boolean = false) {
    val c = ObliTheme.colors
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        shape = ButtonShape,
        contentPadding = PaddingValues(horizontal = 14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = c.hover, contentColor = c.text, disabledContainerColor = c.hover, disabledContentColor = c.textMuted),
        modifier = modifier.heightIn(min = 48.dp),
    ) { ButtonContent(text, icon, busy) }
}

/** Tonal button (accent2 at 12 %): secondary actions such as "Relancer sur les échecs". */
@Composable
internal fun TonalButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true) {
    val c = ObliTheme.colors
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = ButtonShape,
        contentPadding = PaddingValues(start = 12.dp, end = 14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = c.accent2.copy(alpha = 0.12f),
            contentColor = c.accent2,
            disabledContainerColor = c.hover,
            disabledContentColor = c.textMuted,
        ),
        modifier = modifier.heightIn(min = 48.dp),
    ) { ButtonContent(text, icon, false) }
}

@Composable
private fun ButtonContent(text: String, icon: ImageVector?, busy: Boolean) {
    if (busy) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = androidx.compose.material3.LocalContentColor.current)
        Spacer(Modifier.width(10.dp))
    } else if (icon != null) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
    }
    Text(text, style = ObliTypography.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

/** Filter chip: 36 dp visual in a 48 dp target; selected = `active` + check (never red). */
@Composable
internal fun FilterChip(label: String, selected: Boolean, onClick: () -> Unit, count: Int? = null, icon: ImageVector? = null) {
    val c = ObliTheme.colors
    Box(
        Modifier.heightIn(min = 48.dp).toggleable(value = selected, role = Role.Checkbox, onValueChange = { onClick() }),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).background(if (selected) c.active else c.surface2).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            when {
                selected -> Icon(ObliIcons.Check, contentDescription = null, tint = c.text, modifier = Modifier.size(16.dp))
                icon != null -> Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
            }
            Text(label, style = ObliTypography.label.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium), color = if (selected) c.text else c.text2, maxLines = 1)
            if (count != null) Text(count.toString(), style = ObliTypography.monoCaption.copy(fontWeight = FontWeight.Medium), color = if (selected) c.text2 else c.textMuted)
        }
    }
}

/** Small mono tag (tenant, runtime, "legacy"). */
@Composable
internal fun MonoTag(text: String, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Text(
        text,
        style = ObliTypography.overline.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.06.em),
        color = c.text2,
        maxLines = 1,
        modifier = modifier.clip(RoundedCornerShape(4.dp)).background(c.hover).padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

/** Step icon in its colour (state never by colour alone: the label goes with it). */
@Composable
internal fun StepIcon(step: ExecStep, size: Dp = 20.dp) {
    Icon(step.icon, contentDescription = null, tint = step.color, modifier = Modifier.size(size))
}

/** Counts of a batch, for the segmented ring and the summary line. */
internal data class BatchCounts(val success: Int = 0, val failure: Int = 0, val running: Int = 0, val queued: Int = 0, val other: Int = 0) {
    val total: Int get() = success + failure + running + queued + other
    val done: Int get() = success + failure + other
}

/**
 * Segmented progress ring (design doc §5 S52): success green, failure red,
 * running blue, queued grey, "2/3" in mono in the middle.
 */
@Composable
internal fun ProgressRing(counts: BatchCounts, modifier: Modifier = Modifier, size: Dp = 56.dp, stroke: Dp = 6.dp, showLabel: Boolean = true) {
    val c = ObliTheme.colors
    val ok = ExecStep.SUCCESS.color
    val ko = ExecStep.FAILURE.color
    val run = ExecStep.RUNNING.color
    val track = c.hover
    val other = c.textMuted
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val sw = stroke.toPx()
            val d = this.size.minDimension - sw
            val topLeft = Offset(sw / 2, sw / 2)
            val arc = Size(d, d)
            drawArc(track, 0f, 360f, false, topLeft, arc, style = Stroke(sw))
            val total = counts.total.coerceAtLeast(1)
            var start = -90f
            val gap = if (counts.total > 1) 3f else 0f
            for ((n, color) in listOf(counts.success to ok, counts.failure to ko, counts.other to other, counts.running to run)) {
                if (n <= 0) continue
                val sweep = 360f * n / total
                drawArc(color, start + gap / 2, (sweep - gap).coerceAtLeast(1f), false, topLeft, arc, style = Stroke(sw, cap = StrokeCap.Butt))
                start += sweep
            }
        }
        if (showLabel) Text("${counts.done}/${counts.total}", style = ObliTypography.monoCaption.copy(fontWeight = FontWeight.SemiBold), color = c.text)
    }
}

/** Calm inline error with the clear message of the outcome and "Réessayer". */
@Composable
internal fun ProblemCard(outcome: ApiOutcome<*>, onRetry: (() -> Unit)?, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val text = when {
        outcome is ApiOutcome.Forbidden -> stringResource(R.string.automations_error_forbidden)
        else -> ActionMessages.failure(LocalResources.current, outcome)
    }
    AutoCard(modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Icon(ObliIcons.Info, contentDescription = null, tint = c.text2, modifier = Modifier.padding(top = 2.dp).size(18.dp))
            Text(text, style = ObliTypography.body, color = c.text, modifier = Modifier.weight(1f))
        }
        if (onRetry != null) NeutralButton(stringResource(R.string.automations_retry), onRetry)
    }
}

/** A thin 1 dp divider in `divider`. */
@Composable
internal fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(ObliTheme.colors.divider))
}

/** Dot + label status (Actif / Brouillon / Désactivé). */
@Composable
internal fun DotLabel(label: String, color: Color, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(color))
        Text(label, style = ObliTypography.labelSmall, color = ObliTheme.colors.text2, maxLines = 1)
    }
}
