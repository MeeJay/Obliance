package tools.obli.obliance.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp

/**
 * A two-person approval (approval.service.ts `PendingApproval`). [requestType]
 * is 'batch_command' | 'device_uninstall' | 'setting_change'; [payload] depends
 * on it and is kept as JSON. [requestedByName] is the requester's username.
 */
@Serializable
data class Approval(
    val id: Long,
    val tenantId: Long? = null,
    val requestedBy: Long? = null,
    val requestedByName: String? = null,
    val requestType: String = "",
    val description: String = "",
    val payload: JsonElement? = null,
    val status: String = "",
    val reviewedBy: Long? = null,
    val reviewedByName: String? = null,
    val reviewedAt: String? = null,
    val reviewReason: String? = null,
    val createdAt: String? = null,
    val expiresAt: String? = null,
    val executedAt: String? = null,
) {
    val isPending: Boolean get() = status == "pending"

    /** Devices the request acts on (`payload.deviceId` or `payload.deviceIds`). */
    val deviceIds: List<Long>
        get() {
            val p = payload as? JsonObject ?: return emptyList()
            (p["deviceId"] as? JsonPrimitive)?.longOrNull?.let { return listOf(it) }
            return (p["deviceIds"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.longOrNull }.orEmpty()
        }

    /** `payload.action` of a batch command ('reboot', 'shutdown'…). */
    val action: String? get() = ((payload as? JsonObject)?.get("action") as? JsonPrimitive)?.takeIf { it.isString }?.content
}

/**
 * Two-person approvals of ONE server (server/src/routes/approval.routes.ts):
 * platform admins only (403 otherwise), bound to the SESSION tenant (the master
 * tenant lists every tenant's requests). Approving your own request is a 403.
 * Resolving an already-resolved request is a 409; an expired one a 410.
 */
class ApprovalsApi(private val http: ObliHttp) {
    suspend fun list(includeResolved: Boolean = false, limit: Int = 50): ApiOutcome<List<Approval>> {
        val query = buildString {
            append("/api/approvals?limit=").append(limit.coerceIn(1, 200))
            if (includeResolved) append("&includeResolved=true")
        }
        return http.call(ObliHttp.Method.GET, query, decode = ApiJson.unwrapped(ListSerializer(Approval.serializer())))
    }

    /** [extra] carries step-up fields (`twoFactorCode`, `trustIp`) from the ActionRunner. */
    suspend fun approve(id: Long, reason: String? = null, extra: JsonObject? = null): ApiOutcome<Approval> =
        http.call(
            ObliHttp.Method.POST,
            "/api/approvals/$id/approve",
            ApiJson.body("reason" to reason?.takeIf { it.isNotBlank() }, extra = extra),
            decode = ApiJson.unwrapped(Approval.serializer()),
        )

    suspend fun deny(id: Long, reason: String? = null, extra: JsonObject? = null): ApiOutcome<Approval> =
        http.call(
            ObliHttp.Method.POST,
            "/api/approvals/$id/deny",
            ApiJson.body("reason" to reason?.takeIf { it.isNotBlank() }, extra = extra),
            decode = ApiJson.unwrapped(Approval.serializer()),
        )
}
