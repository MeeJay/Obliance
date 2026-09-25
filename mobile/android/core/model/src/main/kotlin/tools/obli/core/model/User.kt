package tools.obli.core.model

import kotlinx.serialization.Serializable

/** The signed-in user, as every Obli server returns it in `GET /api/auth/me`
 *  (`data.user`, shared/src/types.ts `User`). Unknown fields are ignored. */
@Serializable
data class ObliUser(
    val id: Long,
    val username: String,
    val displayName: String? = null,
    val role: String = "user",
    val preferredLanguage: String? = null,
    val enrollmentVersion: Int = 0,
    val foreignSource: String? = null,
    val totpEnabled: Boolean = false,
    val emailOtpEnabled: Boolean = false,
) {
    val isPlatformAdmin: Boolean get() = role == "admin"

    /** "og_" usernames come from Obligate (design doc §5 S85). */
    val isObligate: Boolean get() = foreignSource == "obligate"

    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: username
}

/** `GET /api/auth/me` → `data`. */
@Serializable
data class SessionProbe(
    val user: ObliUser,
    val requires2faSetup: Boolean = false,
    val currentTenantId: Long? = null,
)
