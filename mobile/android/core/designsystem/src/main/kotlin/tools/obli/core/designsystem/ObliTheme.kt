package tools.obli.core.designsystem

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

fun Long.toColor(): Color = Color(this.toInt())

enum class ObliThemeVariant { OPERATOR, NIGHT }

/** Semantic colours of the Obli design system (design doc §8.2), per variant. */
@Immutable
data class ObliColors(
    val bg: Color,
    val chrome: Color,
    val surface1: Color,
    val surface2: Color,
    val hover: Color,
    val active: Color,
    val divider: Color,
    val text: Color,
    val text2: Color,
    val textMuted: Color,
    val textFaint: Color,
    val brand: Color,
    val accentFill: Color,
    val accentFillPressed: Color,
    val accent2: Color,
    val onAccentFill: Color,
) {
    companion object {
        fun of(surfaces: SurfaceTokens, accent: AccentTokens) = ObliColors(
            bg = surfaces.bg.toColor(), chrome = surfaces.chrome.toColor(), surface1 = surfaces.surface1.toColor(),
            surface2 = surfaces.surface2.toColor(), hover = surfaces.hover.toColor(), active = surfaces.active.toColor(),
            divider = surfaces.divider.toColor(), text = surfaces.text.toColor(), text2 = surfaces.text2.toColor(),
            textMuted = surfaces.textMuted.toColor(), textFaint = surfaces.textFaint.toColor(),
            brand = accent.brand.toColor(), accentFill = accent.fill.toColor(), accentFillPressed = accent.fillPressed.toColor(),
            accent2 = accent.accent2.toColor(), onAccentFill = ObliTokens.ON_FILL.toColor(),
        )
    }
}

val LocalObliColors = staticCompositionLocalOf { ObliColors.of(ObliTokens.operator, ObliTokens.oblianceOperator) }

/**
 * Root theme. Material 3 is tuned so no red tint reaches elevated surfaces
 * (`surfaceTint = Transparent`, design doc §8.2 "Réglage Material 3").
 */
@Composable
fun ObliTheme(
    variant: ObliThemeVariant = ObliThemeVariant.OPERATOR,
    accentOperator: AccentTokens = ObliTokens.oblianceOperator,
    accentNight: AccentTokens = ObliTokens.oblianceNight,
    content: @Composable () -> Unit,
) {
    val colors = when (variant) {
        ObliThemeVariant.OPERATOR -> ObliColors.of(ObliTokens.operator, accentOperator)
        ObliThemeVariant.NIGHT -> ObliColors.of(ObliTokens.night, accentNight)
    }
    CompositionLocalProvider(LocalObliColors provides colors) {
        MaterialTheme(colorScheme = colors.toMaterial(), typography = ObliTypography.material, content = content)
    }
}

object ObliTheme {
    val colors: ObliColors
        @Composable get() = LocalObliColors.current
}

internal fun ObliColors.toMaterial(): ColorScheme = darkColorScheme(
    primary = accentFill,
    onPrimary = onAccentFill,
    secondary = accent2,
    background = bg,
    onBackground = text,
    surface = surface1,
    onSurface = text,
    surfaceVariant = surface2,
    onSurfaceVariant = text2,
    surfaceTint = Color.Transparent,
    outline = divider,
    outlineVariant = divider,
    error = ObliTokens.DANGER.toColor(),
    onError = Color.White,
    surfaceContainerLowest = bg,
    surfaceContainerLow = chrome,
    surfaceContainer = surface1,
    surfaceContainerHigh = surface2,
    surfaceContainerHighest = hover,
)
