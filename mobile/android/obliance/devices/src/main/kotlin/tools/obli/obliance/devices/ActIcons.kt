package tools.obli.obliance.devices

import androidx.compose.ui.graphics.vector.ImageVector
import tools.obli.core.designsystem.ObliIcons

/** Lucide icons of the S40 sheet, the action bar and the action tabs (module-private, CONTRACT §5). */
internal object ActIcons {
    val Play: ImageVector by lazy { ObliIcons.lucide("play", "M5 3l14 9-14 9V3z") }
    val Square: ImageVector by lazy { ObliIcons.lucide("square", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z") }
    val RefreshCw: ImageVector get() = ObliIcons.RefreshCw
    val ListProcesses: ImageVector by lazy { ObliIcons.lucide("list", "M3 12h.01", "M3 18h.01", "M3 6h.01", "M8 12h13", "M8 18h13", "M8 6h13") }
    val Cog: ImageVector by lazy {
        ObliIcons.lucide(
            "cog",
            "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
            "M12 2v2", "M12 22v-2", "m17 20.66-1-1.73", "M11 10.27 7 3.34", "m20.66 17-1.73-1",
            "m3.34 7 1.73 1", "M14 12h8", "M2 12h2", "m20.66 7-1.73 1", "m3.34 17 1.73-1", "m17 3.34-1 1.73", "m11 13.73-4 6.93",
        )
    }
    val ListChecks: ImageVector by lazy { ObliIcons.lucide("list-checks", "m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8") }
    val Power: ImageVector by lazy { ObliIcons.lucide("power", "M12 2v10", "M18.4 6.6a9 9 0 1 1-12.77.04") }
    val Moon: ImageVector by lazy { ObliIcons.lucide("moon", "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z") }
    val ScanLine: ImageVector by lazy { ObliIcons.lucide("scan-line", "M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M7 12h10") }
    val Gauge: ImageVector by lazy { ObliIcons.lucide("gauge", "m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0") }
    val WifiOff: ImageVector by lazy { ObliIcons.lucide("wifi-off", "M12 20h.01", "M8.5 16.43a5 5 0 0 1 7 0", "M2 8.82a15 15 0 0 1 4.17-2.65", "M10.66 5c4.01-.36 8.14.9 11.34 3.76", "M16.85 11.25a10 10 0 0 1 2.22 1.68", "M5 13a10 10 0 0 1 5.24-2.76", "m2 2 20 20") }
    val Wifi: ImageVector by lazy { ObliIcons.lucide("wifi", "M12 20h.01", "M2 8.82a15 15 0 0 1 20 0", "M5 12.86a10 10 0 0 1 14 0", "M8.5 16.43a5 5 0 0 1 7 0") }
    val CalendarClock: ImageVector by lazy {
        ObliIcons.lucide("calendar-clock", "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5", "M16 2v4", "M8 2v4", "M3 10h5", "M17.5 17.5 16 16.3V14", "M10 16a6 6 0 1 0 12 0 6 6 0 0 0-12 0")
    }
    val LockOpen: ImageVector by lazy { ObliIcons.lucide("lock-open", "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 9.9-1") }
    val Pause: ImageVector by lazy { ObliIcons.lucide("pause", "M6 4h4v16H6z", "M14 4h4v16h-4z") }
    val CircleX: ImageVector by lazy { ObliIcons.lucide("circle-x", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0", "m15 9-6 6", "m9 9 6 6") }
    val Loader: ImageVector by lazy { ObliIcons.lucide("loader-circle", "M21 12a9 9 0 1 1-6.22-8.56") }
}
