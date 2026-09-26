package tools.obli.obliance.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.shell.alerts.LiveAlert
import tools.obli.shell.alerts.LiveAlerts

@Serializable
data class TenantRef(val id: Long, val name: String = "")

/**
 * `GET /api/live-alerts/all` → `{alerts, tenants, activeIds?}` (not enveloped).
 * Since 0.3.1 the server lists ACTIVE alerts only (read and unread; resolved
 * ones are left out). [truncatedBelow]: the server sent [AlertsApi.FEED_LIMIT]
 * rows, the oldest being this id; an alert below it may be active and just not
 * listed. [activeIds]: the id of EVERY active alert of the same tenants, not
 * capped like [alerts] (server field `activeIds`); null from a server that does
 * not send it, and then only [truncatedBelow] says what the feed may have left out.
 */
data class AlertsFeed(
    val alerts: List<LiveAlert>,
    val tenants: List<TenantRef>,
    val truncatedBelow: Long? = null,
    val activeIds: Set<Long>? = null,
) {
    private val listed: Set<Long> by lazy { alerts.mapTo(HashSet()) { it.id } }

    /** False when [alertId] may be active without the feed saying so (a full feed without [activeIds], older than its oldest row). */
    fun covers(alertId: Long): Boolean = activeIds != null || truncatedBelow == null || alertId >= truncatedBelow

    /**
     * Whether [alertId] is still active on the server: true when listed or in
     * [activeIds]; false when the feed says it is not (resolved or deleted);
     * null when the feed cannot say ([covers] false).
     */
    fun isActive(alertId: Long): Boolean? = when {
        alertId in listed -> true
        activeIds != null -> alertId in activeIds
        covers(alertId) -> false
        else -> null
    }
}

/**
 * Live alerts of ONE server (server/src/routes/liveAlert.routes.ts). Rows are
 * parsed by the shared [LiveAlerts] parser of core:common (same rules as the
 * WebView shell's background poller).
 */
class AlertsApi(private val http: ObliHttp) {
    /** Every tenant the user belongs to, newest first, at most [FEED_LIMIT] (active alerts only since 0.3.1, with every active id in `activeIds`). */
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
        /**
         * Rows at most in `/api/live-alerts/all` (liveAlert.controller getAllTenantAlerts,
         * newest first): a feed this long may have left older ACTIVE alerts out.
         */
        const val FEED_LIMIT = 200

        /** Ids at most taken from one NOTIFICATION_RESOLVED payload. */
        const val MAX_RESOLVED_IDS = 2_000

        /** `activeIds` longer than this is not trusted (the feed then falls back on [AlertsFeed.truncatedBelow]). */
        const val MAX_ACTIVE_IDS = 100_000

        /** Listed rows `activeIds` may miss (resolved between the server's two reads) before it is not trusted. */
        private const val ACTIVE_IDS_SLACK = 5

        fun decodeFeed(element: JsonElement?): AlertsFeed? {
            val obj = element as? JsonObject ?: return null
            val rows = obj["alerts"] as? JsonArray ?: return null
            // 0.3.1: the server leaves resolved rows out; a row that still says so is not active.
            val active = JsonArray(rows.filterNot { isResolved(it) })
            val alerts = LiveAlerts.parse(JsonObject(mapOf("alerts" to active)).toString()) ?: return null
            val tenants = ApiJson.decode(ListSerializer(TenantRef.serializer()), obj["tenants"]).orEmpty()
            val truncatedBelow = if (rows.size >= FEED_LIMIT) rows.mapNotNull { idOf(it) }.minOrNull() else null
            val activeIds = activeIdsOf(obj["activeIds"])?.takeIf { ids ->
                // Same tenants as the rows: it names (nearly) every listed row. One that misses
                // many (another scope, a server bug) would withdraw notifications wrongly.
                alerts.count { it.id !in ids } <= maxOf(ACTIVE_IDS_SLACK, alerts.size / 10)
            }
            return AlertsFeed(alerts, tenants, truncatedBelow, activeIds)
        }

        /**
         * `activeIds` (0.3.1+): every active alert id of the user's tenants,
         * numbers or numeric strings. Null when absent, not an array, holding
         * anything but positive ids, or longer than [MAX_ACTIVE_IDS]; [decodeFeed]
         * also drops one that misses the listed rows. A list the app cannot fully
         * trust is ignored (only [AlertsFeed.truncatedBelow] then says what the
         * feed may have left out).
         */
        private fun activeIdsOf(element: JsonElement?): Set<Long>? {
            val array = element as? JsonArray ?: return null
            if (array.size > MAX_ACTIVE_IDS) return null
            val ids = HashSet<Long>(array.size * 2)
            for (item in array) {
                val id = (item as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.trim()?.toLongOrNull()
                if (id == null || id <= 0) return null
                ids += id
            }
            return ids
        }

        /** Payload of a `NOTIFICATION_NEW` socket event (one LiveAlertRow). */
        fun decodeNotification(payload: JsonElement?): LiveAlert? {
            val obj = payload as? JsonObject ?: return null
            if (isResolved(obj)) return null
            return LiveAlerts.parse(JsonObject(mapOf("alerts" to JsonArray(listOf(obj)))).toString())?.firstOrNull()
        }

        /**
         * Payload of a `NOTIFICATION_RESOLVED` socket event: `{ids: number[]}` →
         * the positive ids (numbers or numeric strings, at most [MAX_RESOLVED_IDS]);
         * null when the payload is not that shape.
         */
        fun decodeResolved(payload: JsonElement?): Set<Long>? {
            val ids = (payload as? JsonObject)?.get("ids") as? JsonArray ?: return null
            return ids.asSequence()
                .mapNotNull { (it as? JsonPrimitive)?.takeUnless { p -> p is JsonNull }?.content?.trim()?.toLongOrNull() }
                .filter { it > 0 }
                .take(MAX_RESOLVED_IDS)
                .toSet()
        }

        private fun idOf(row: JsonElement): Long? = ((row as? JsonObject)?.get("id") as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.toLongOrNull()

        private fun isResolved(row: JsonElement): Boolean {
            val at = (row as? JsonObject)?.get("resolvedAt") ?: return false
            return at !is JsonNull && !(at is JsonPrimitive && at.content.isBlank())
        }
    }
}
