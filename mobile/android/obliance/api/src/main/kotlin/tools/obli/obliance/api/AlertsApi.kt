package tools.obli.obliance.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.shell.alerts.LiveAlert
import tools.obli.shell.alerts.LiveAlerts

@Serializable
data class TenantRef(val id: Long, val name: String = "")

/** `GET /api/live-alerts/all` → `{alerts, tenants}` (not enveloped). */
data class AlertsFeed(val alerts: List<LiveAlert>, val tenants: List<TenantRef>)

/**
 * Live alerts of ONE server (server/src/routes/liveAlert.routes.ts). Rows are
 * parsed by the shared [LiveAlerts] parser of core:common (same rules as the
 * WebView shell's background poller).
 */
class AlertsApi(private val http: ObliHttp) {
    /** Every tenant the user belongs to, newest first, at most 200. */
    suspend fun all(): ApiOutcome<AlertsFeed> = http.call(ObliHttp.Method.GET, "/api/live-alerts/all", decode = ::decodeFeed)

    /** `PATCH /api/live-alerts/:id/read` (cross-tenant, ownership checked by the server). */
    suspend fun markRead(alertId: Long): ApiOutcome<Unit> =
        http.call(ObliHttp.Method.PATCH, "/api/live-alerts/$alertId/read", decode = ApiJson.ignoreBody)

    /** `DELETE /api/live-alerts/:id` (cross-tenant). */
    suspend fun delete(alertId: Long): ApiOutcome<Unit> =
        http.call(ObliHttp.Method.DELETE, "/api/live-alerts/$alertId", decode = ApiJson.ignoreBody)

    /** `POST /api/live-alerts/read-all`: the SESSION tenant only (requireTenant). */
    suspend fun markAllRead(): ApiOutcome<Unit> =
        http.call(ObliHttp.Method.POST, "/api/live-alerts/read-all", decode = ApiJson.ignoreBody)

    companion object {
        fun decodeFeed(element: JsonElement?): AlertsFeed? {
            val obj = element as? JsonObject ?: return null
            if (obj["alerts"] !is JsonArray) return null
            val alerts = LiveAlerts.parse(obj.toString()) ?: return null
            val tenants = ApiJson.decode(ListSerializer(TenantRef.serializer()), obj["tenants"]).orEmpty()
            return AlertsFeed(alerts, tenants)
        }

        /** Payload of a `NOTIFICATION_NEW` socket event (one LiveAlertRow). */
        fun decodeNotification(payload: JsonElement?): LiveAlert? {
            val obj = payload as? JsonObject ?: return null
            return LiveAlerts.parse(JsonObject(mapOf("alerts" to JsonArray(listOf(obj)))).toString())?.firstOrNull()
        }
    }
}
