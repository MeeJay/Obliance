package tools.obli.core.designsystem

/**
 * Colour tokens of design doc §8.2 as plain ARGB values, so contrast rules are
 * unit-tested on the JVM without Compose. [ObliColors] maps them to Compose.
 */
data class SurfaceTokens(
    val bg: Long,
    val chrome: Long,
    val surface1: Long,
    val surface2: Long,
    val hover: Long,
    val active: Long,
    val divider: Long,
    val text: Long,
    val text2: Long,
    val textMuted: Long,
    val textFaint: Long,
)

/** Per-app accent, injected by the app module (Obliance: red). */
data class AccentTokens(
    val brand: Long,
    val fill: Long,
    val fillPressed: Long,
    val accent2: Long,
)

object ObliTokens {
    val operator = SurfaceTokens(
        bg = 0xFF0B0D1A, chrome = 0xFF0F1220, surface1 = 0xFF131728, surface2 = 0xFF181C30,
        hover = 0xFF1D2238, active = 0xFF222740, divider = 0xFF2A3048,
        text = 0xFFF0F4FC, text2 = 0xFFB4BCD7, textMuted = 0xFF828CAF, textFaint = 0xFF4B5273,
    )

    val night = SurfaceTokens(
        bg = 0xFF05060C, chrome = 0xFF080A14, surface1 = 0xFF0C0F1C, surface2 = 0xFF111526,
        hover = 0xFF161A2E, active = 0xFF1B2036, divider = 0xFF1E2336,
        text = 0xFFD6DBE8, text2 = 0xFF9EA6C2, textMuted = 0xFF7C86A8, textFaint = 0xFF3A4060,
    )

    val oblianceOperator = AccentTokens(brand = 0xFFE03A3A, fill = 0xFFC83232, fillPressed = 0xFFB41E1E, accent2 = 0xFFFF6868)
    val oblianceNight = AccentTokens(brand = 0xFFC23434, fill = 0xFFC23434, fillPressed = 0xFF8E1A1A, accent2 = 0xFFE25A5A)

    const val ON_FILL = 0xFFFFFFFF

    /** Device status colours: platform constants, never derived from the accent. */
    enum class Status(val argb: Long) {
        ONLINE(0xFF4ADE80),
        OFFLINE(0xFF9CA3AF),
        WARNING(0xFFFACC15),
        CRITICAL(0xFFF87171),
        PENDING(0xFF60A5FA),
        MAINTENANCE(0xFFFB7185),
        SUSPENDED(0xFFA1A8B5),
        PENDING_UNINSTALL(0xFFFB923C),
    }

    /** Alert severity bar / title colours. */
    const val SEVERITY_CRITICAL = 0xFFDC2626
    const val SEVERITY_WARNING = 0xFFF59E0B
    const val SEVERITY_INFO = 0xFF3B82F6
    const val SEVERITY_RECOVERY = 0xFF22C55E
    const val UNREAD = 0xFF60A5FA
    const val DANGER = 0xFFDC2626
    const val DANGER_TEXT = 0xFFF87171
}

/** WCAG 2.x contrast (design doc §10.11: every declared text/background pair ≥ 4.5:1). */
object Contrast {
    fun ratio(foreground: Long, background: Long): Double {
        val l1 = luminance(blend(foreground, background))
        val l2 = luminance(background)
        val (hi, lo) = if (l1 >= l2) l1 to l2 else l2 to l1
        return (hi + 0.05) / (lo + 0.05)
    }

    fun luminance(argb: Long): Double {
        fun channel(shift: Int): Double {
            val c = ((argb shr shift) and 0xFF) / 255.0
            return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }

    /** Composites a translucent colour over an opaque background. */
    fun blend(argb: Long, background: Long): Long {
        val a = ((argb shr 24) and 0xFF) / 255.0
        if (a >= 1.0) return argb
        fun mix(shift: Int): Long {
            val f = (argb shr shift) and 0xFF
            val b = (background shr shift) and 0xFF
            return Math.round(f * a + b * (1 - a)).coerceIn(0, 255)
        }
        return (0xFFL shl 24) or (mix(16) shl 16) or (mix(8) shl 8) or mix(0)
    }

    /** [argb] with [alpha] (0..1) applied, e.g. a 12 % pill background. */
    fun withAlpha(argb: Long, alpha: Double): Long =
        (Math.round(alpha.coerceIn(0.0, 1.0) * 255) shl 24) or (argb and 0xFFFFFF)
}
