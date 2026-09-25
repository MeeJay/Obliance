package tools.obli.obliance.more

import androidx.compose.ui.graphics.vector.ImageVector
import tools.obli.core.designsystem.ObliIcons

/** Lucide icons only this module needs (design doc §8.7), built like the shared set. */
internal object MoreIcons {
    /** `shield-check`: "Profil et sécurité" (S85). */
    val ShieldCheck: ImageVector by lazy {
        ObliIcons.lucide(
            "shield-check",
            "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
            "m9 12 2 2 4-4",
        )
    }

    /** `settings`: "Réglages de l'application" (S83). */
    val Settings: ImageVector by lazy {
        ObliIcons.lucide(
            "settings",
            "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
            "M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
        )
    }

    /** `bell`: "Notifications et astreinte" (S84). */
    val Bell: ImageVector by lazy {
        ObliIcons.lucide("bell", "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0")
    }

    /** `fingerprint`: "Verrou biométrique", "Déverrouiller" (S00, S83). */
    val Fingerprint: ImageVector by lazy {
        ObliIcons.lucide(
            "fingerprint",
            "M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4",
            "M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2",
            "M17.29 21.02c.12-.6.43-2.3.5-3.02",
            "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4",
            "M8.65 22c.21-.66.45-1.32.57-2",
            "M14 13.12c0 2.38 0 6.38-1 8.88",
            "M2 16h.01",
            "M21.8 16c.2-2 .131-5.354 0-6",
            "M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2",
        )
    }

    /** `smartphone`: "Bloquer les captures d'écran partout", the app card (S83, S86). */
    val Smartphone: ImageVector by lazy {
        ObliIcons.lucide("smartphone", "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M12 18h.01")
    }

    /** `sun`: "Thème" (S83). */
    val Sun: ImageVector by lazy {
        ObliIcons.lucide(
            "sun",
            "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
            "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41",
            "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41",
        )
    }

    /** `moon`: "Nuit automatique" (S83). */
    val Moon: ImageVector by lazy { ObliIcons.lucide("moon", "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z") }

    /** `download`: "Télécharger et installer" (S86). */
    val Download: ImageVector by lazy {
        ObliIcons.lucide("download", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3")
    }

    /** `copy`: "Copier le diagnostic" (S86). */
    val Copy: ImageVector by lazy {
        ObliIcons.lucide(
            "copy",
            "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z",
            "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
        )
    }

    /** `file-text`: licences (S86). */
    val FileText: ImageVector by lazy {
        ObliIcons.lucide(
            "file-text",
            "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
            "M14 2v4a2 2 0 0 0 2 2h4",
            "M10 9H8", "M16 13H8", "M16 17H8",
        )
    }
}
