package tools.obli.shell.alerts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import tools.obli.shell.core.Jsons
import tools.obli.shell.core.arr
import tools.obli.shell.core.str
import tools.obli.shell.core.strictLong

enum class AlertSeverity { INFO, WARNING, CRITICAL;
    companion object {
        /** The DB enum is 'info' | 'warning' | 'critical'; anything else is info. */
        fun parse(raw: String?): AlertSeverity = when (raw?.lowercase()) {
            "critical" -> CRITICAL
            "warning" -> WARNING
            else -> INFO
        }
    }
}

/**
 * One row of `GET /api/live-alerts/all` → `{alerts: LiveAlertRow[], tenants}`
 * (server/src/services/liveAlert.service.ts rowToAlert):
 * {id, tenantId, tenantName?, severity, title, message, navigateTo|null,
 *  stableKey|null, readAt|null, createdAt}
 */
data class LiveAlert(
    val id: Long,
    val tenantId: Long?,
    val tenantName: String?,
    val severity: AlertSeverity,
    val title: String,
    val message: String,
    val navigateTo: String?,
    val readAt: String?,
    val createdAt: String?,
)

data class HighWaterResult(
    /** Alerts to notify, oldest first, at most the requested maximum. */
    val toNotify: List<LiveAlert>,
    /** New alerts that were not notified individually (summarised instead). */
    val overflow: Int,
    /** Mark to persist (null = keep "unset", no alert seen yet). */
    val newHighWater: Long?,
)

object LiveAlerts {
    const val MAX_TITLE = 120
    const val MAX_MESSAGE = 1_000

    /** Null when [body] is not the expected shape (treated as a transient error). */
    fun parse(body: String?): List<LiveAlert>? {
        val root = Jsons.parseObject(body) ?: return null
        val list: JsonArray = root.arr("alerts") ?: Jsons.unwrapData(root).arr("alerts") ?: return null
        return list.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val id = o.strictLong("id") ?: return@mapNotNull null
            LiveAlert(
                id = id,
                tenantId = o.strictLong("tenantId"),
                tenantName = o.str("tenantName")?.takeIf { it.isNotBlank() },
                severity = AlertSeverity.parse(o.str("severity")),
                title = o.str("title").orEmpty().take(MAX_TITLE),
                message = o.str("message").orEmpty().take(MAX_MESSAGE),
                navigateTo = o.str("navigateTo"),
                readAt = o.str("readAt"),
                createdAt = o.str("createdAt"),
            )
        }
    }

    /**
     * High-water deduplication. Alert ids are a global serial, so "newer" is
     * "id greater than the mark".
     *
     * - [highWater] null (first run after enabling): notify nothing, only
     *   record the current maximum.
     * - Otherwise notify unread alerts above the mark, oldest first, capped at
     *   [maxNotifications]; the rest is counted in [HighWaterResult.overflow].
     * - A maximum BELOW the mark (database reset, newest alerts deleted)
     *   re-baselines the mark to that maximum without notifying anything.
     */
    fun process(alerts: List<LiveAlert>, highWater: Long?, maxNotifications: Int = 5): HighWaterResult {
        val maxId = alerts.maxOfOrNull { it.id }
        if (highWater == null) return HighWaterResult(emptyList(), 0, maxId ?: 0L)
        if (maxId == null) return HighWaterResult(emptyList(), 0, highWater)
        if (maxId < highWater) return HighWaterResult(emptyList(), 0, maxId)
        val fresh = alerts.filter { it.id > highWater && it.readAt == null }.sortedBy { it.id }
        val shown = fresh.takeLast(maxNotifications.coerceAtLeast(0))
        return HighWaterResult(shown, fresh.size - shown.size, maxOf(highWater, maxId))
    }
}
