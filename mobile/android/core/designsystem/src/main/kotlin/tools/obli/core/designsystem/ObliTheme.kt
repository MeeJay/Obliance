package tools.obli.core.designsystem

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

fun Long.toColor(): Color = Color(this.toInt())

/**
 * OPERATOR / NEON / MODERN mirror the web themes a user picks on each server
 * (`preferences.preferredTheme`); NIGHT is the app's own low-light variant.
 */
enum class ObliThemeVariant {
    OPERATOR, NIGHT, NEON, MODERN;

    companion object {
        /** Web theme id -> variant. `obli-daylight` (light) falls back to Operator until the light theme ships. */
        fun fromServerTheme(id: String?): ObliThemeVariant = when (id?.trim()?.lowercase()) {
            "neon" -> NEON
            "modern" -> MODERN
            else -> OPERATOR
        }
    }
}

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
    val target = when (variant) {
        ObliThemeVariant.OPERATOR -> ObliColors.of(ObliTokens.operator, accentOperator)
        ObliThemeVariant.NIGHT -> ObliColors.of(ObliTokens.night, accentNight)
        ObliThemeVariant.NEON -> ObliColors.of(ObliTokens.neon, ObliTokens.neonAccent)
        ObliThemeVariant.MODERN -> ObliColors.of(ObliTokens.modern, ObliTokens.modernAccent)
    }
    // Switching server switches theme: fade the colours (200 ms) instead of a jump.
    val colors = animateColors(target)
    CompositionLocalProvider(LocalObliColors provides colors) {
        MaterialTheme(colorScheme = colors.toMaterial(), typography = ObliTypography.material, content = content)
    }
}

@Composable
private fun animateColors(t: ObliColors): ObliColors {
    val spec = tween<Color>(durationMillis = 200)
    @Composable fun a(c: Color) = animateColorAsState(c, spec, label = "obliTheme").value
    return ObliColors(
        bg = a(t.bg), chrome = a(t.chrome), surface1 = a(t.surface1), surface2 = a(t.surface2),
        hover = a(t.hover), active = a(t.active), divider = a(t.divider), text = a(t.text),
        text2 = a(t.text2), textMuted = a(t.textMuted), textFaint = a(t.textFaint), brand = a(t.brand),
        accentFill = a(t.accentFill), accentFillPressed = a(t.accentFillPressed), accent2 = a(t.accent2),
        onAccentFill = t.onAccentFill,
    )
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
