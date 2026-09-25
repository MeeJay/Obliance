package tools.obli.obliance.domain

import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException
import tools.obli.core.model.ServerId
import tools.obli.shell.alerts.LiveAlert

/** An alert with the server it came from: every alert is resolved against ITS
 *  server, never against the active one (design doc §2.9, §2.10). */
data class ServerAlert(
    val serverId: ServerId,
    val alert: LiveAlert,
    val hints: DeviceHints = DeviceHints(),
) {
    val classification: AlertClassification by lazy { AlertClassifier.classify(alert, hints) }
    val createdAt: Instant? by lazy { parseInstant(alert.createdAt) }
}

/** "Possible site outage": at least [OUTAGE_MIN] offline alerts of the same
 *  server and tenant within [OUTAGE_WINDOW_SEC]. Never across two servers. */
data class SiteOutage(
    val serverId: ServerId,
    val tenantId: Long?,
    val alerts: List<ServerAlert>,
    val from: Instant,
    val to: Instant,
)

data class TriageList(
    val unread: List<ServerAlert>,
    val read: List<ServerAlert>,
    val outages: List<SiteOutage>,
    val unreadByServer: Map<ServerId, Int>,
)

/**
 * The multi-server "À traiter" list (design doc §5 S10, §2.10): alerts of every
 * connected server merged into one list, unread first, sorted by computed
 * priority then newest first; the server filter keeps only the chosen servers.
 */
object Triage {
    const val OUTAGE_MIN = 3
    const val OUTAGE_WINDOW_SEC = 5 * 60L

    fun build(
        alerts: List<ServerAlert>,
        serverFilter: Set<ServerId>? = null,
        severityFilter: Set<tools.obli.shell.alerts.AlertSeverity>? = null,
    ): TriageList {
        val visible = alerts.filter { a ->
            (serverFilter == null || a.serverId in serverFilter) &&
                (severityFilter == null || a.alert.severity in severityFilter)
        }
        val order = compareBy<ServerAlert> { it.classification.rank }
            .thenByDescending { it.createdAt ?: Instant.EPOCH }
            .thenByDescending { it.alert.id }
        val (unread, read) = visible.partition { it.alert.readAt == null }
        return TriageList(
            unread = unread.sortedWith(order),
            read = read.sortedWith(compareByDescending<ServerAlert> { it.createdAt ?: Instant.EPOCH }.thenByDescending { it.alert.id }),
            outages = outages(unread),
            unreadByServer = unread.groupingBy { it.serverId }.eachCount(),
        )
    }

    fun outages(alerts: List<ServerAlert>): List<SiteOutage> =
        alerts
            .filter { it.classification.category == AlertCategory.OFFLINE && it.createdAt != null }
            .groupBy { it.serverId to it.alert.tenantId }
            .flatMap { (key, group) ->
                val sorted = group.sortedBy { it.createdAt }
                // Largest cluster inside a sliding window, reported once per group.
                var best: List<ServerAlert> = emptyList()
                var start = 0
                for (end in sorted.indices) {
                    while (sorted[end].createdAt!!.epochSecond - sorted[start].createdAt!!.epochSecond > OUTAGE_WINDOW_SEC) start++
                    if (end - start + 1 > best.size) best = sorted.subList(start, end + 1)
                }
                if (best.size < OUTAGE_MIN) emptyList()
                else listOf(SiteOutage(key.first, key.second, best.toList(), best.first().createdAt!!, best.last().createdAt!!))
            }
}

internal fun parseInstant(raw: String?): Instant? {
    if (raw.isNullOrBlank()) return null
    val text = raw.trim()
    return try {
        Instant.parse(text)
    } catch (_: DateTimeParseException) {
        // PostgreSQL-style "2026-09-25 03:12:04.123+00" also shows up; Android's
        // Instant.parse does not accept offsets, OffsetDateTime does.
        try {
            val iso = text.replace(' ', 'T').let { if (Regex("[+-]\\d{2}$").containsMatchIn(it)) "$it:00" else it }
            OffsetDateTime.parse(iso).toInstant()
        } catch (_: DateTimeParseException) {
            null
        }
    }
}
