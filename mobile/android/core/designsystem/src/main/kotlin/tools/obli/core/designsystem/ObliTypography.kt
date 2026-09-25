package tools.obli.core.designsystem

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Type scale of design doc §8.4 with the bundled OFL families (res/font):
 * Inter (text), Rajdhani 600 (titles ≥ 24 sp, KPIs), JetBrains Mono (overlines,
 * IPs, terminal). No Google Fonts service. Licences: assets/licenses/.
 */
object ObliFonts {
    val sans: FontFamily = FontFamily(
        Font(R.font.inter_regular, FontWeight.Normal),
        Font(R.font.inter_medium, FontWeight.Medium),
        Font(R.font.inter_semibold, FontWeight.SemiBold),
    )
    val display: FontFamily = FontFamily(Font(R.font.rajdhani_semibold, FontWeight.SemiBold))
    val mono: FontFamily = FontFamily(
        Font(R.font.jetbrainsmono_regular, FontWeight.Normal),
        Font(R.font.jetbrainsmono_medium, FontWeight.Medium),
        Font(R.font.jetbrainsmono_semibold, FontWeight.SemiBold),
    )
}

object ObliTypography {
    /** Screen title — Rajdhani 600, never below 24 sp. */
    val screenTitle get() = TextStyle(fontFamily = ObliFonts.display, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 28.sp, letterSpacing = 0.025.em)
    val kpi get() = TextStyle(fontFamily = ObliFonts.display, fontWeight = FontWeight.SemiBold, fontSize = 36.sp, lineHeight = 40.sp)
    val kpiFeatured get() = TextStyle(fontFamily = ObliFonts.display, fontWeight = FontWeight.SemiBold, fontSize = 48.sp, lineHeight = 48.sp)
    val dialogTitle get() = TextStyle(fontFamily = ObliFonts.sans, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 28.sp)
    val cardTitle get() = TextStyle(fontFamily = ObliFonts.sans, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 24.sp)
    val rowTitle get() = TextStyle(fontFamily = ObliFonts.sans, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp)
    val body get() = TextStyle(fontFamily = ObliFonts.sans, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp, fontFeatureSettings = "tnum")
    val label get() = TextStyle(fontFamily = ObliFonts.sans, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp)
    val labelSmall get() = TextStyle(fontFamily = ObliFonts.sans, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp)
    /** Overline « CRITIQUE · BASH · 03:12 » — upper case is applied by the caller. */
    val overline get() = TextStyle(fontFamily = ObliFonts.mono, fontWeight = FontWeight.Normal, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.14.em)
    val monoCaption get() = TextStyle(fontFamily = ObliFonts.mono, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp)
    val terminal get() = TextStyle(fontFamily = ObliFonts.mono, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 19.sp)
    val otp get() = TextStyle(fontFamily = ObliFonts.mono, fontWeight = FontWeight.Medium, fontSize = 24.sp, lineHeight = 32.sp)

    val material: Typography
        get() = Typography(
            headlineSmall = screenTitle,
            titleLarge = dialogTitle,
            titleMedium = cardTitle,
            titleSmall = rowTitle.copy(fontSize = 14.sp, lineHeight = 20.sp),
            bodyLarge = body.copy(fontSize = 16.sp, lineHeight = 24.sp),
            bodyMedium = body,
            labelLarge = label,
            labelMedium = labelSmall,
            labelSmall = overline,
        )
}
