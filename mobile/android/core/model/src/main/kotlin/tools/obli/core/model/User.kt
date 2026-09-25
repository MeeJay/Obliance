package tools.obli.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

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
    /** UI preferences as the server stores them (object, or a JSON string on some rows). */
    val preferences: JsonElement? = null,
) {
    /** Web theme chosen by the user on THIS server (`obli-operator`, `neon`, `modern`, `obli-daylight`). */
    val preferredTheme: String?
        get() {
            val prefs = when (val p = preferences) {
                is JsonObject -> p
                is JsonPrimitive -> if (p.isString) runCatching { Json.parseToJsonElement(p.content) as? JsonObject }.getOrNull() else null
                else -> null
            } ?: return null
            val theme = prefs["preferredTheme"] as? JsonPrimitive ?: return null
            return if (theme.isString) theme.content.takeIf { it.isNotBlank() } else null
        }

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
