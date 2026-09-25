package tools.obli.core.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * Lucide icons (ISC licence) used across the Obli apps (design doc §8.7), as
 * stroked ImageVectors on a 24 × 24 viewport, 2 px stroke, round caps and
 * joins. Tint them with `Icon(icon, contentDescription, tint = …)`: the whole
 * vector takes the tint. Add an icon here only when two modules need it;
 * a module-specific icon lives in that module.
 */
object ObliIcons {
    val ArrowLeft: ImageVector by lazy { lucide("arrow-left", "m12 19-7-7 7-7", "M19 12H5") }
    val ChevronDown: ImageVector by lazy { lucide("chevron-down", "m6 9 6 6 6-6") }
    val ChevronRight: ImageVector by lazy { lucide("chevron-right", "m9 18 6-6-6-6") }
    val Search: ImageVector by lazy { lucide("search", CIRCLE_11_8, "m21 21-4.3-4.3") }
    val X: ImageVector by lazy { lucide("x", "M18 6 6 18", "m6 6 12 12") }
    val Check: ImageVector by lazy { lucide("check", "M20 6 9 17l-5-5") }
    val Plus: ImageVector by lazy { lucide("plus", "M5 12h14", "M12 5v14") }
    val RefreshCw: ImageVector by lazy {
        lucide(
            "refresh-cw",
            "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5",
            "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5",
        )
    }
    val EllipsisVertical: ImageVector by lazy {
        lucide("ellipsis-vertical", "M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0", "M11 5a1 1 0 1 0 2 0a1 1 0 1 0-2 0", "M11 19a1 1 0 1 0 2 0a1 1 0 1 0-2 0")
    }

    // Destinations (design doc §2.1)
    val Siren: ImageVector by lazy {
        lucide(
            "siren",
            "M7 18v-6a5 5 0 1 1 10 0v6", "M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z",
            "M21 12h1", "M18.5 4.5 18 5", "M2 12h1", "M12 2v1", "m4.929 4.929.707.707", "M12 12v6",
        )
    }
    val Monitor: ImageVector by lazy { lucide("monitor", "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 21h8", "M12 17v4") }
    val Activity: ImageVector by lazy { lucide("activity", "M22 12h-4l-3 9L9 3l-3 9H2") }
    val LayoutDashboard: ImageVector by lazy {
        lucide(
            "layout-dashboard",
            "M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
            "M15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
            "M15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z",
            "M4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z",
        )
    }
    val Menu: ImageVector by lazy { lucide("menu", "M4 12h16", "M4 6h16", "M4 18h16") }

    // Scope, servers, account
    val Building2: ImageVector by lazy {
        lucide(
            "building-2",
            "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z", "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",
            "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2", "M10 6h4", "M10 10h4", "M10 14h4", "M10 18h4",
        )
    }
    val Server: ImageVector by lazy {
        lucide(
            "server",
            "M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z",
            "M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z", "M6 6h.01", "M6 18h.01",
        )
    }
    val Lock: ImageVector by lazy { lucide("lock", "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 10 0v4") }
    val LogOut: ImageVector by lazy { lucide("log-out", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9") }
    val Star: ImageVector by lazy { lucide("star", "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z") }
    val Trash: ImageVector by lazy { lucide("trash-2", "M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6") }
    val Clock: ImageVector by lazy { lucide("clock", CIRCLE_12_10, "M12 6v6l4 2") }

    // States (never colour alone, design doc §8.3)
    val CircleAlert: ImageVector by lazy { lucide("circle-alert", CIRCLE_12_10, "M12 8v4", "M12 16h.01") }
    val TriangleAlert: ImageVector by lazy {
        lucide("triangle-alert", "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01")
    }
    val Info: ImageVector by lazy { lucide("info", CIRCLE_12_10, "M12 16v-4", "M12 8h.01") }
    val CircleCheck: ImageVector by lazy { lucide("circle-check", CIRCLE_12_10, "m9 12 2 2 4-4") }

    private const val CIRCLE_12_10 = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0"
    private const val CIRCLE_11_8 = "M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0"

    /** Builds a Lucide-style stroked icon from SVG path strings. */
    fun lucide(name: String, vararg paths: String): ImageVector {
        val builder = ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        )
        for (d in paths) {
            builder.addPath(
                pathData = PathParser().parsePathString(d).toNodes(),
                fill = null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return builder.build()
    }
}
