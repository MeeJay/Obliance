package tools.obli.obliance.devices

import androidx.compose.runtime.staticCompositionLocalOf
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Time source of the devices screens. Tests pin [now] to the night of
 * 25 September (design doc §4) and turn [ticking] off so no ticker runs.
 */
internal class DevicesClock(
    val now: () -> Long = System::currentTimeMillis,
    val zone: ZoneId = ZoneId.systemDefault(),
    /** Relative ages ("il y a 14 min") refresh every 5 s while visible (§7.3). */
    val ticking: Boolean = true,
)

internal val LocalDevicesClock = staticCompositionLocalOf { DevicesClock() }

/** How long ago something happened, bucketed for short labels. */
internal sealed interface Age {
    data object JustNow : Age
    data class Minutes(val n: Long) : Age
    data class Hours(val n: Long) : Age
    data class Days(val n: Long) : Age

    companion object {
        fun between(now: Long, then: Long): Age {
            val ms = (now - then).coerceAtLeast(0)
            val min = ms / 60_000
            return when {
                min < 1 -> JustNow
                min < 60 -> Minutes(min)
                min < 24 * 60 -> Hours(min / 60)
                else -> Days(min / (24 * 60))
            }
        }
    }
}

/** Pure formatting helpers (no Android): times, sizes, percentages. */
internal object DeviceFormat {
    private val HHMM = DateTimeFormatter.ofPattern("HH:mm")
    private val DDMM = DateTimeFormatter.ofPattern("dd/MM")

    /** ISO-8601 timestamp of the server (`2026-09-25T01:08:00.000Z`) to epoch ms. */
    fun parse(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        return runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull()
    }

    fun hhmm(epoch: Long, zone: ZoneId): String = HHMM.format(Instant.ofEpochMilli(epoch).atZone(zone))

    fun ddmm(epoch: Long, zone: ZoneId): String = DDMM.format(Instant.ofEpochMilli(epoch).atZone(zone))

    /** "25/09 03:08". */
    fun dateTime(epoch: Long, zone: ZoneId): String = ddmm(epoch, zone) + " " + hhmm(epoch, zone)

    fun sameDay(a: Long, b: Long, zone: ZoneId): Boolean =
        Instant.ofEpochMilli(a).atZone(zone).toLocalDate() == Instant.ofEpochMilli(b).atZone(zone).toLocalDate()

    /** Whole percentage for display, clamped to 0..100. */
    fun percent(value: Double): Int = value.roundToInt().coerceIn(0, 100)

    /** Gigabytes: one decimal under 100 ("11,4"), none above or for whole values ("237", "16"). */
    fun gigabytes(value: Double, locale: Locale): String = when {
        value >= 100 || abs(value - value.roundToInt()) < 0.05 -> String.format(locale, "%.0f", value)
        else -> String.format(locale, "%.1f", value)
    }

    enum class RateUnit { KB, MB }

    /** Bytes per second to (value, unit): "310" KB/s, "2,4" MB/s. */
    fun rate(bytesPerSec: Double, locale: Locale): Pair<String, RateUnit> {
        val kb = bytesPerSec.coerceAtLeast(0.0) / 1024.0
        return if (kb < 1024) {
            String.format(locale, "%.0f", kb) to RateUnit.KB
        } else {
            String.format(locale, "%.1f", kb / 1024.0) to RateUnit.MB
        }
    }
}
