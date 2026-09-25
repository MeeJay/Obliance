package tools.obli.obliance.devices

import androidx.compose.ui.graphics.vector.ImageVector
import tools.obli.core.designsystem.ObliIcons

/** Module-private Lucide icons (ISC licence), paths copied from lucide 0.344. */
internal object DeviceIcons {
    /** Linux tile (STYLEKIT §5 "OS icons"). */
    val Terminal: ImageVector by lazy { ObliIcons.lucide("terminal", "m4 17 6-6-6-6", "M12 19h8") }

    /** macOS tile. */
    val Apple: ImageVector by lazy {
        ObliIcons.lucide(
            "apple",
            "M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z",
            "M10 2c1 .5 2 2 2 5",
        )
    }

    /** Privacy mode (orange, §5 S20 mode icons). */
    val Shield: ImageVector by lazy {
        ObliIcons.lucide(
            "shield",
            "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
        )
    }

    /** Agent update available (blue). */
    val ArrowUp: ImageVector by lazy { ObliIcons.lucide("arrow-up", "m5 12 7-7 7 7", "M12 19V5") }

    val ArrowDown: ImageVector by lazy { ObliIcons.lucide("arrow-down", "M12 5v14", "m19 12-7 7-7-7") }

    /** "En attente d'approbation". */
    val UserPlus: ImageVector by lazy {
        ObliIcons.lucide(
            "user-plus",
            "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
            "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
            "M19 8v6",
            "M22 11h-6",
        )
    }

    val User: ImageVector by lazy {
        ObliIcons.lucide("user", "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0")
    }

    /** "Agir" (tonal action). */
    val Zap: ImageVector by lazy { ObliIcons.lucide("zap", "M13 2 3 14h9l-1 8 10-12h-9l1-8z") }

    val Cpu: ImageVector by lazy {
        ObliIcons.lucide(
            "cpu",
            "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
            "M9 9h6v6H9z",
            "M15 2v2", "M15 20v2", "M2 15h2", "M2 9h2", "M20 15h2", "M20 9h2", "M9 2v2", "M9 20v2",
        )
    }

    val MemoryStick: ImageVector by lazy {
        ObliIcons.lucide(
            "memory-stick",
            "M6 19v-3", "M10 19v-3", "M14 19v-3", "M18 19v-3", "M8 11V9", "M16 11V9", "M12 11V9", "M2 15h20",
            "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z",
        )
    }

    val HardDrive: ImageVector by lazy {
        ObliIcons.lucide(
            "hard-drive",
            "M22 12H2",
            "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
            "M6 16h.01",
            "M10 16h.01",
        )
    }

    val Network: ImageVector by lazy {
        ObliIcons.lucide(
            "network",
            "M17 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z",
            "M3 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z",
            "M10 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
            "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3",
            "M12 12V8",
        )
    }

    /** Empty state "no match for your filters". */
    val SlidersHorizontal: ImageVector by lazy {
        ObliIcons.lucide(
            "sliders-horizontal",
            "M21 4h-7", "M10 4H3", "M21 12h-9", "M8 12H3", "M21 20h-5", "M12 20H3", "M14 2v4", "M8 10v4", "M16 18v4",
        )
    }

    val RotateCcw: ImageVector by lazy { ObliIcons.lucide("rotate-ccw", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5") }
}
