package tools.obli.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Freshness stamp of a screen (design doc §7.3): live, updated at, stale. */
sealed interface ObliFreshness {
    data object Live : ObliFreshness
    data class Updated(val label: String) : ObliFreshness
    data class Stale(val label: String) : ObliFreshness
}

/**
 * Second row of the top bar of a top-level screen (design doc §2.2): the
 * Rajdhani 24 title and the freshness stamp. The application draws the first
 * row (scope chip, avatar); each screen draws this row as its first element.
 */
@Composable
fun ObliScreenHeader(
    title: String,
    modifier: Modifier = Modifier,
    freshness: ObliFreshness? = null,
    liveLabel: String = "",
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val c = ObliTheme.colors
    Row(
        modifier = modifier.fillMaxWidth().background(c.chrome).padding(start = 16.dp, end = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            title,
            style = ObliTypography.screenTitle,
            color = c.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        when (freshness) {
            null -> Unit
            ObliFreshness.Live -> FreshnessStamp(liveLabel, ObliTokens.Status.ONLINE.argb.toColor(), c.text2)
            is ObliFreshness.Updated -> FreshnessStamp(freshness.label, c.textMuted, c.textMuted)
            is ObliFreshness.Stale -> FreshnessStamp(freshness.label, ObliTokens.Status.WARNING.argb.toColor(), ObliTokens.Status.WARNING.argb.toColor())
        }
        trailing()
    }
}

@Composable
private fun FreshnessStamp(label: String, dot: Color, text: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
        Text(label, style = ObliTypography.monoCaption, color = text, maxLines = 1)
    }
}

/**
 * Top bar of a pushed screen (design doc §2.2 "Écrans de détail"): back, the
 * entity name (Rajdhani 24) and a "tenant · path" subtitle, then actions.
 * Height 64 dp, chrome background, 48 dp touch targets.
 */
@Composable
fun ObliDetailTopBar(
    title: String,
    onBack: () -> Unit,
    backLabel: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    leading: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val c = ObliTheme.colors
    Row(
        modifier = modifier.fillMaxWidth().height(64.dp).background(c.chrome).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        ObliIconButton(ObliIcons.ArrowLeft, backLabel, onBack, tint = c.text)
        leading?.invoke()
        Column(Modifier.weight(1f)) {
            Text(title, style = ObliTypography.screenTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
            if (subtitle != null) {
                Text(subtitle, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        actions()
    }
}

/** 48 × 48 dp icon button (design doc §7.11), 22 dp icon, secondary tint by default. */
@Composable
fun ObliIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = ObliTheme.colors.text2,
    enabled: Boolean = true,
) {
    IconButton(onClick = onClick, enabled = enabled, modifier = modifier.size(48.dp)) {
        Icon(icon, contentDescription = contentDescription, tint = if (enabled) tint else ObliTheme.colors.textFaint, modifier = Modifier.size(22.dp))
    }
}

/**
 * Calm, centred state for an empty list or a screen that is not there yet
 * ("Rien à traiter", "Bientôt disponible"): never red, never an error look.
 */
@Composable
fun ObliCalmState(
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    icon: ImageVector? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val c = ObliTheme.colors
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (icon != null) {
            Box(Modifier.size(56.dp).clip(CircleShape).background(c.surface2), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.height(16.dp))
        }
        Text(title, style = ObliTypography.cardTitle, color = c.text, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 360.dp))
        if (body != null) {
            Spacer(Modifier.height(6.dp))
            Text(body, style = ObliTypography.body, color = c.text2, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 360.dp))
        }
        if (action != null) {
            Spacer(Modifier.height(16.dp))
            action()
        }
    }
}
