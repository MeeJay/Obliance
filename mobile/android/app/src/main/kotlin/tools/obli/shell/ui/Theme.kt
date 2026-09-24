package tools.obli.shell.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.colorResource
import tools.obli.shell.R

/** Obli design tokens (obli-design-system §2): dark surfaces + the flavor accent. */
object ObliColors {
    val Bg = Color(0xFF0F1220)
    val Surface = Color(0xFF131728)
    val SurfaceHigh = Color(0xFF1A1F35)
    val Text = Color(0xFFE8ECF5)
    val Muted = Color(0xFF8C93B6)
    val Faint = Color(0xFF4B5273)
    val Error = Color(0xFFFF6B6B)
}

@Composable
fun ObliTheme(content: @Composable () -> Unit) {
    val accent = colorResource(R.color.obli_accent)
    val accent2 = colorResource(R.color.obli_accent2)
    val scheme = darkColorScheme(
        primary = accent,
        onPrimary = Color.White,
        primaryContainer = accent.copy(alpha = 0.24f),
        onPrimaryContainer = ObliColors.Text,
        secondary = accent2,
        onSecondary = Color.Black,
        background = ObliColors.Bg,
        onBackground = ObliColors.Text,
        surface = ObliColors.Surface,
        onSurface = ObliColors.Text,
        surfaceVariant = ObliColors.SurfaceHigh,
        onSurfaceVariant = ObliColors.Muted,
        surfaceContainer = ObliColors.Surface,
        surfaceContainerHigh = ObliColors.SurfaceHigh,
        surfaceContainerHighest = ObliColors.SurfaceHigh,
        surfaceContainerLow = ObliColors.Surface,
        surfaceContainerLowest = ObliColors.Bg,
        outline = ObliColors.Faint,
        outlineVariant = ObliColors.SurfaceHigh,
        error = ObliColors.Error,
        onError = Color.Black,
    )
    MaterialTheme(colorScheme = scheme, content = content)
}
