package tools.obli.obliance.triage

import androidx.compose.ui.graphics.vector.ImageVector
import tools.obli.core.designsystem.ObliIcons

/** Lucide icons only this module needs (design doc §8.7), built like the shared set. */
internal object TriageIcons {
    /** `shield-alert`: rights escalations (distinct from `shield-check` of policies). */
    val ShieldAlert: ImageVector by lazy {
        ObliIcons.lucide(
            "shield-alert",
            "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
            "M12 8v4",
            "M12 16h.01",
        )
    }

    /** `network`: site outage correlation. */
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

    val ArrowUp: ImageVector by lazy { ObliIcons.lucide("arrow-up", "m5 12 7-7 7 7", "M12 19V5") }

    val WifiOff: ImageVector by lazy {
        ObliIcons.lucide(
            "wifi-off",
            "M12 20h.01",
            "M8.5 16.429a5 5 0 0 1 7 0",
            "M5 12.859a10 10 0 0 1 5.17-2.69",
            "M19 12.859a10 10 0 0 0-2.007-1.523",
            "M2 8.82a15 15 0 0 1 4.177-2.643",
            "M22 8.82a15 15 0 0 0-11.288-3.764",
            "m2 2 20 20",
        )
    }

    /** `mail-open`: mark as read (swipe right background). */
    val MailOpen: ImageVector by lazy {
        ObliIcons.lucide(
            "mail-open",
            "M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",
            "m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",
        )
    }
}
