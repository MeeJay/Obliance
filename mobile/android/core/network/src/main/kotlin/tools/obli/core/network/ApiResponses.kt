package tools.obli.core.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import tools.obli.shell.core.bool
import tools.obli.shell.core.obj
import tools.obli.shell.core.str
import tools.obli.shell.core.strictLong

/**
 * Maps a raw HTTP answer of an Obli server to an [ApiOutcome]. Pure JVM: the
 * transport (OkHttp) only hands over status, headers and body text, so every
 * server shape is covered by unit tests with recorded bodies.
 *
 * Server shapes (server/src): errors are `{success:false, error}` (AppError) or
 * `{error, ...}`; restriction outcomes come from restriction.service.ts.
 */
object ApiResponses {
    private val json = Json { ignoreUnknownKeys = true; isLenient = false }

    /**
     * @param decode maps the JSON body (null for an empty body) to the payload;
     *   returning null means "unexpected shape" and yields [FailureKind.SERVER].
     */
    fun <T> classify(
        status: Int,
        contentType: String?,
        body: String?,
        retryAfter: String? = null,
        decode: (JsonElement?) -> T?,
    ): ApiOutcome<T> {
        val text = body?.takeIf { it.isNotBlank() }
        val isJson = contentType?.substringBefore(';')?.trim()?.lowercase()?.let { it == "application/json" || it.endsWith("+json") } == true
        val element: JsonElement? = if (text != null && isJson) parse(text) else null

        if (status in 200..299) {
            if (text != null && (!isJson || element == null)) return ApiOutcome.Failure(status, FailureKind.NOT_JSON)
            if (status == 202) {
                val data = (element as? JsonObject)?.obj("data")
                if (data?.str("status") == "pending_approval") {
                    val id = data.strictLong("approvalId") ?: return ApiOutcome.Failure(status, FailureKind.SERVER)
                    return ApiOutcome.PendingApproval(id)
                }
                return decode(element)?.let { ApiOutcome.Accepted(it) } ?: ApiOutcome.Failure(status, FailureKind.SERVER)
            }
            return decode(element)?.let { ApiOutcome.Ok(it) } ?: ApiOutcome.Failure(status, FailureKind.SERVER)
        }

        val obj = element as? JsonObject
        val message = obj?.str("error") ?: obj?.str("message") ?: ""
        return when (status) {
            400 -> ApiOutcome.Validation(message, fieldErrors(obj?.obj("details")))
            401 -> when {
                obj?.bool("twoFactorRequired") == true -> ApiOutcome.StepUpRequired(obj.str("action"), obj.str("currentIp"))
                message.equals("Invalid 2FA code", ignoreCase = true) -> ApiOutcome.StepUpRejected
                else -> ApiOutcome.SessionExpired
            }
            403 -> forbidden(message)
            404 -> ApiOutcome.Failure(404, FailureKind.NOT_FOUND, message.ifEmpty { null })
            409 -> ApiOutcome.Unsupported(message)
            423 -> ApiOutcome.PrivacyLocked(
                feature = FEATURE.find(message)?.groupValues?.get(1),
                passwordSet = message.contains("password is set", ignoreCase = true),
                message = message,
            )
            429 -> ApiOutcome.RateLimited(retryAfter?.trim()?.toIntOrNull()?.takeIf { it >= 0 })
            503 -> ApiOutcome.AgentOffline(message)
            in 500..599 -> ApiOutcome.Failure(status, FailureKind.SERVER, message.ifEmpty { null })
            else -> ApiOutcome.Failure(status, FailureKind.CLIENT, message.ifEmpty { null })
        }
    }

    /** For a call that never got an HTTP answer. */
    fun network(message: String? = null): ApiOutcome<Nothing> = ApiOutcome.Failure(null, FailureKind.NETWORK, message)

    /** Payload of `{success, data}` / `{data}` envelopes, or the element itself (raw endpoints). */
    fun unwrap(element: JsonElement?): JsonElement? {
        val obj = element as? JsonObject ?: return element
        return if ("data" in obj && (obj.size == 1 || "success" in obj)) obj["data"] else obj
    }

    private fun forbidden(message: String): ApiOutcome<Nothing> {
        CAPABILITY.find(message)?.let { return ApiOutcome.Forbidden(ForbiddenReason.CAPABILITY, message, it.groupValues[1]) }
        val reason = when {
            message.contains("enable TOTP", ignoreCase = true) -> ForbiddenReason.NO_TOTP
            message.contains("no approval path", ignoreCase = true) -> ForbiddenReason.NO_APPROVAL_PATH
            else -> ForbiddenReason.OTHER
        }
        return ApiOutcome.Forbidden(reason, message)
    }

    private fun fieldErrors(details: JsonObject?): Map<String, List<String>> =
        details?.mapNotNull { (field, value) ->
            val msgs = (value as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            msgs?.takeIf { it.isNotEmpty() }?.let { field to it }
        }?.toMap().orEmpty()

    private fun parse(text: String): JsonElement? = try {
        json.parseToJsonElement(text)
    } catch (_: Exception) {
        null
    }

    private val CAPABILITY = Regex("Capability '([a-z_]+)' not permitted")
    private val FEATURE = Regex("feature '([^']+)'")
}
