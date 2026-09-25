package tools.obli.obliance.fleet

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** "Now" and the time zone of the screen (fixed in tests). */
internal data class FleetTime(val now: Long, val zone: ZoneId) {
    private val hhmm: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    /** 03:22 */
    fun clock(epochMs: Long): String = hhmm.format(Instant.ofEpochMilli(epochMs).atZone(zone))

    /** 12,1 in French, 12.1 in English (one decimal at most). */
    fun decimal(value: Double, locale: Locale = Locale.getDefault()): String =
        NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1; minimumFractionDigits = 0 }.format(value)
}

/**
 * Line (with a fading area) or dashed line of one series, grid at 5 % white
 * (design doc §8.2 "Graphiques"). Decorative: the card carries the TalkBack text.
 */
@Composable
internal fun FleetSparkline(values: List<Int>, color: Color, dashed: Boolean, height: Int) {
    Canvas(Modifier.fillMaxWidth().height(height.dp)) {
        if (values.size < 2) return@Canvas
        val max = values.max().coerceAtLeast(1)
        val min = values.min().coerceAtMost(max - 1).coerceAtLeast(0)
        val range = (max - min).coerceAtLeast(1).toFloat()
        val pad = 2.dp.toPx()
        val h = size.height - pad * 2
        val stepX = size.width / (values.size - 1)
        fun y(v: Int) = pad + h - (v - min) / range * h
        // Grid: top, middle, bottom.
        listOf(pad, pad + h / 2, pad + h).forEach { gy ->
            drawLine(Color.White.copy(alpha = 0.05f), Offset(0f, gy), Offset(size.width, gy), strokeWidth = 1.dp.toPx())
        }
        val line = Path().apply {
            values.forEachIndexed { i, v -> if (i == 0) moveTo(0f, y(v)) else lineTo(i * stepX, y(v)) }
        }
        if (!dashed) {
            val area = Path().apply {
                addPath(line)
                lineTo(size.width, size.height)
                lineTo(0f, size.height)
                close()
            }
            drawPath(area, Brush.verticalGradient(0f to color.copy(alpha = 0.35f), 1f to color.copy(alpha = 0f)))
        }
        drawPath(
            line,
            color,
            style = Stroke(
                width = 1.6.dp.toPx(),
                cap = StrokeCap.Round,
                join = StrokeJoin.Round,
                pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())) else null,
            ),
        )
    }
}
