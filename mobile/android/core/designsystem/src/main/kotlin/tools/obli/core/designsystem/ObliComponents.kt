package tools.obli.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tools.obli.core.model.ServerColor

/**
 * Identity tile of a server (design doc §2.10, §8.9): rounded square, colour
 * at 18 % over an opaque `chrome` base (so the letters keep ≥ 4.5:1 whatever
 * surface the tile sits on), 1 dp border at 40 %, two mono letters. Shape, not colour, tells an
 * identity from a state. Only shown when two servers or more are configured.
 */
@Composable
fun ObliServerTile(
    color: ServerColor,
    monogram: String,
    serverName: String,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
) {
    val c = color.argb.toColor()
    val shape = RoundedCornerShape(5.dp)
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(ObliTheme.colors.chrome)
            .background(c.copy(alpha = 0.18f))
            .border(1.dp, c.copy(alpha = 0.40f), shape)
            .semantics { contentDescription = serverName },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = monogram.take(2),
            color = c,
            style = ObliTypography.monoCaption.copy(
                fontWeight = FontWeight.SemiBold,
                fontSize = if (size >= 28.dp) 13.sp else 10.sp,
                lineHeight = if (size >= 28.dp) 16.sp else 12.sp,
            ),
        )
    }
}

/** 8 dp status dot (6 dp compact). */
@Composable
fun ObliStatusDot(status: ObliTokens.Status, modifier: Modifier = Modifier, compact: Boolean = false) {
    Box(modifier.size(if (compact) 6.dp else 8.dp).clip(CircleShape).background(status.argb.toColor()))
}

/** Status pill: colour at 12 % + label in the colour + dot; TalkBack reads the label. */
@Composable
fun ObliStatusPill(status: ObliTokens.Status, label: String, modifier: Modifier = Modifier) {
    val c = status.argb.toColor()
    Row(
        modifier = modifier
            .height(20.dp)
            .clip(CircleShape)
            .background(c.copy(alpha = 0.12f))
            .padding(start = 6.dp, end = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ObliStatusDot(status, compact = true)
        Text(label, color = c, style = ObliTypography.labelSmall)
    }
}

@Preview(backgroundColor = 0xFF0B0D1A, showBackground = true)
@Composable
private fun ServerTilesPreview() = ObliTheme {
    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        ObliServerTile(ServerColor.VIOLET, "OP", "Obliance Prod")
        ObliServerTile(ServerColor.TEAL, "OD", "Obliance Dev")
        ObliServerTile(ServerColor.FUCHSIA, "OQ", "Obliance Qual", size = 28.dp)
        ObliStatusPill(ObliTokens.Status.OFFLINE, "Hors ligne")
    }
}
