package tools.obli.obliance.notifications

import androidx.compose.ui.graphics.vector.ImageVector
import tools.obli.core.designsystem.ObliIcons

/** Module-private Lucide icons (ISC licence), design doc §8.7. */
internal object NotifIcons {
    private const val BELL_BODY = "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
    private const val BELL_CLAPPER = "M10.268 21a2 2 0 0 0 3.464 0"
    private const val SPEAKER = "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"

    val Bell: ImageVector by lazy { ObliIcons.lucide("bell", BELL_CLAPPER, BELL_BODY) }
    val BellOff: ImageVector by lazy {
        ObliIcons.lucide(
            "bell-off",
            BELL_CLAPPER,
            "M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",
            "m2 2 20 20",
            "M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",
        )
    }
    val BellRing: ImageVector by lazy { ObliIcons.lucide("bell-ring", BELL_CLAPPER, "M22 8c0-2.3-.8-4.3-2-6", BELL_BODY, "M4 2C2.8 3.7 2 5.7 2 8") }
    val BatteryCharging: ImageVector by lazy {
        ObliIcons.lucide(
            "battery-charging",
            "m11 7-3 5h4l-3 5",
            "M14.856 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.935",
            "M22 14v-4",
            "M5.14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.936",
        )
    }
    val Calendar: ImageVector by lazy {
        ObliIcons.lucide("calendar", "M8 2v4", "M16 2v4", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M3 10h18")
    }
    val Moon: ImageVector by lazy { ObliIcons.lucide("moon", "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z") }
    val Send: ImageVector by lazy {
        ObliIcons.lucide(
            "send",
            "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
            "m21.854 2.147-10.94 10.939",
        )
    }
    val Volume: ImageVector by lazy { ObliIcons.lucide("volume-2", SPEAKER, "M16 9a5 5 0 0 1 0 6", "M19.364 18.364a9 9 0 0 0 0-12.728") }
    val VolumeOff: ImageVector by lazy { ObliIcons.lucide("volume-x", SPEAKER, "m22 9-6 6", "m16 9 6 6") }
    val Vibrate: ImageVector by lazy {
        ObliIcons.lucide("vibrate", "m2 8 2 2-2 2 2 2-2 2", "m22 8-2 2 2 2-2 2 2 2", "M9 5h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z")
    }
    val ShieldAlert: ImageVector by lazy {
        ObliIcons.lucide(
            "shield-alert",
            "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
            "M12 8v4",
            "M12 16h.01",
        )
    }
    val ExternalLink: ImageVector by lazy {
        ObliIcons.lucide("external-link", "M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")
    }
    val UserPlus: ImageVector by lazy {
        ObliIcons.lucide("user-plus", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M19 8v6", "M22 11h-6")
    }
    val RotateCcw: ImageVector by lazy { ObliIcons.lucide("rotate-ccw", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5") }
    val UserX: ImageVector by lazy {
        ObliIcons.lucide("user-x", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "m17 8 5 5", "m22 8-5 5")
    }
}
