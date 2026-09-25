package tools.obli.obliance.fleet

import androidx.compose.ui.graphics.vector.ImageVector
import tools.obli.core.designsystem.ObliIcons

/** Lucide icons only the Fleet screen uses (paths from lucide 0.344, ISC). */
internal object FleetIcons {
    val ArrowUp: ImageVector by lazy { ObliIcons.lucide("arrow-up", "m5 12 7-7 7 7", "M12 19V5") }
    val ArrowDown: ImageVector by lazy { ObliIcons.lucide("arrow-down", "M12 5v14", "m19 12-7 7-7-7") }
    val Minus: ImageVector by lazy { ObliIcons.lucide("minus", "M5 12h14") }
    val HardDrive: ImageVector by lazy {
        ObliIcons.lucide(
            "hard-drive",
            "M22 12H2",
            "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
            "M6 16h.01",
            "M10 16h.01",
        )
    }
    val FolderTree: ImageVector by lazy {
        ObliIcons.lucide(
            "folder-tree",
            "M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z",
            "M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z",
            "M3 5a2 2 0 0 0 2 2h3",
            "M3 3v13a2 2 0 0 0 2 2h3",
        )
    }
    val ScreenShare: ImageVector by lazy {
        ObliIcons.lucide("screen-share", "M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3", "M8 21h8", "M12 17v4", "m17 8 5-5", "M17 3h5v5")
    }
    val CalendarClock: ImageVector by lazy {
        ObliIcons.lucide(
            "calendar-clock",
            "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5", "M16 2v4", "M8 2v4", "M3 10h5",
            "M17.5 17.5 16 16.3V14", "M10 16a6 6 0 1 0 12 0a6 6 0 1 0-12 0",
        )
    }
    val WifiOff: ImageVector by lazy {
        ObliIcons.lucide(
            "wifi-off",
            "M12 20h.01", "M8.5 16.429a5 5 0 0 1 7 0", "M5 12.859a10 10 0 0 1 5.17-2.69", "M19 12.859a10 10 0 0 0-2.007-1.523",
            "M2 8.82a15 15 0 0 1 4.177-2.643", "M22 8.82a15 15 0 0 0-11.288-3.764", "m2 2 20 20",
        )
    }
    val Apple: ImageVector by lazy {
        ObliIcons.lucide(
            "apple",
            "M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z",
            "M10 2c1 .5 2 2 2 5",
        )
    }
    val Terminal: ImageVector by lazy { ObliIcons.lucide("terminal", "M4 17l6-6-6-6", "M12 19h8") }

    /** OS tile icon as on the web (design doc §8.7). */
    fun forOs(osType: String?): ImageVector = when (osType) {
        "macos" -> Apple
        "linux" -> Terminal
        else -> ObliIcons.Monitor
    }
}
