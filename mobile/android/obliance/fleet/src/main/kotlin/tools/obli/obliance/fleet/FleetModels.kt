package tools.obli.obliance.fleet

import java.time.Instant
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.FleetSummary

/** What one load of the active server returned (optional parts are null when their call failed). */
internal data class FleetData(
    val serverId: ServerId,
    val summary: FleetSummary,
    /** false: the user is not a platform admin, figures come from the devices they can see. */
    val serverAggregates: Boolean,
    val attention: List<Device>,
    val groups: List<GroupStat>? = null,
    val disks: DiskSaturation? = null,
    val updates: UpdateStats? = null,
    val hourly: List<FleetHour>? = null,
    /** Show the tenant of each row (master tenant session: rows come from every tenant). */
    val showTenants: Boolean = false,
)

internal enum class FleetProblem {
    /** 401: the app shows S03 for the active server; the screen stays calm. */
    SESSION_EXPIRED,

    /** No HTTP answer: "Aucune connexion — affichage des dernières données connues." */
    OFFLINE,

    /** 5xx, HTML instead of JSON… */
    SERVER,

    /** 403 on the summary. */
    FORBIDDEN,
}

internal data class FleetUi(
    /** Nothing to show yet (first load running). */
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val data: FleetData? = null,
    /** Time of the last successful load (epoch ms). */
    val updatedAt: Long? = null,
    /** Why the last load failed (the last good [data] stays on screen). */
    val problem: FleetProblem? = null,
    /** No active server (should not happen inside the shell). */
    val noServer: Boolean = false,
)

// --- Presentation values computed from FleetData (pure, unit-tested) ----------

internal enum class DeltaTrend { BETTER, WORSE, NEUTRAL }

/** "↑ 3 vs hier": [value] signed, [trend] gives the colour (never the brand red). */
internal data class Delta(val value: Int, val trend: DeltaTrend, val period: DeltaPeriod)

internal enum class DeltaPeriod { YESTERDAY, WEEK }

internal enum class KpiKind { ONLINE, OFFLINE, CRITICAL, WARNING, PENDING_UPDATES, AGENTS_UP_TO_DATE }

internal data class Kpi(
    val kind: KpiKind,
    val value: Int,
    /** Denominator shown as "/ 312" (agents). */
    val outOf: Int? = null,
    /** "dont 9 critiques" (pending updates). */
    val criticalUpdates: Int? = null,
    val delta: Delta? = null,
    /** 0..1 of the 4 dp bar. */
    val fraction: Float,
    /** Status colour of the value and the bar; null = text colour. */
    val status: ObliTokens.Status?,
)

internal enum class RibbonKind(val status: ObliTokens.Status, val alpha: Float = 1f) {
    CRITICAL(ObliTokens.Status.CRITICAL),
    WARNING(ObliTokens.Status.WARNING),
    UPDATING(ObliTokens.Status.PENDING),
    ONLINE(ObliTokens.Status.ONLINE),
    OFFLINE(ObliTokens.Status.OFFLINE),
    PENDING(ObliTokens.Status.PENDING, 0.55f),
}

internal data class RibbonSegment(val kind: RibbonKind, val count: Int)

internal data class Featured(
    val total: Int,
    val connected: Int,
    val offline: Int,
    val delta: Delta?,
    val segments: List<RibbonSegment>,
    /** Legend chips (touch targets): problems first; "online" alone when everything is fine. */
    val legend: List<RibbonSegment>,
)

/** Why a device of "Attention requise" is there (second line of the row). */
internal sealed interface AttentionReason {
    data class Metric(val kind: MetricKind, val percent: Int, val mount: String? = null, val freeGb: Double? = null) : AttentionReason

    /** Offline since [since] (epoch ms); [days] ≥ 1 when more than 24 h ago. */
    data class OfflineSince(val since: Long, val days: Int) : AttentionReason

    /** Nothing more precise: OS and IP. */
    data class Identity(val os: String?, val ip: String?) : AttentionReason
}

internal enum class MetricKind { CPU, RAM, DISK }

internal data class AttentionRow(val device: Device, val status: ObliTokens.Status, val reason: AttentionReason)

internal data class GroupRow(
    /** Names from the root ("Siège › Serveurs"). */
    val path: List<String>,
    val tenantName: String?,
    val total: Int,
    val online: Int,
    val offline: Int,
    val warning: Int,
    val critical: Int,
    val complianceScore: Double?,
) {
    val connected: Int get() = online + warning + critical
    /** Half of it or more is offline (a site outage looks like this); single devices are in "Attention requise". */
    val hasProblem: Boolean get() = total > 0 && offline * 2 >= total
}

internal data class HourPoint(val at: Long, val online: Int, val offline: Int)

internal object FleetMapper {
    const val PRIORITY_ONLINE = 4

    /** Attention order: critical, warning, update error, offline; everything else is not "attention". */
    fun priority(status: String): Int = when (status) {
        "critical" -> 0
        "warning" -> 1
        "update_error" -> 2
        "offline" -> 3
        else -> PRIORITY_ONLINE
    }

    fun statusColor(status: String): ObliTokens.Status = when (status) {
        "critical" -> ObliTokens.Status.CRITICAL
        "warning" -> ObliTokens.Status.WARNING
        "update_error", "pending_uninstall" -> ObliTokens.Status.PENDING_UNINSTALL
        "offline" -> ObliTokens.Status.OFFLINE
        "pending", "updating" -> ObliTokens.Status.PENDING
        "maintenance" -> ObliTokens.Status.MAINTENANCE
        "suspended" -> ObliTokens.Status.SUSPENDED
        else -> ObliTokens.Status.ONLINE
    }

    /** The web bucket: `update_error` agents stop pushing, they count as offline (DashboardPage.tsx). */
    fun offline(s: FleetSummary): Int = s.offline + s.updateError

    fun featured(s: FleetSummary): Featured {
        val segments = listOf(
            RibbonSegment(RibbonKind.CRITICAL, s.critical),
            RibbonSegment(RibbonKind.WARNING, s.warning),
            RibbonSegment(RibbonKind.UPDATING, s.updating),
            RibbonSegment(RibbonKind.ONLINE, s.online),
            RibbonSegment(RibbonKind.OFFLINE, offline(s)),
            RibbonSegment(RibbonKind.PENDING, s.pending),
        ).filter { it.count > 0 }
        val problems = segments.filter { it.kind in LEGEND_KINDS }
        val legend = problems.ifEmpty { segments.filter { it.kind == RibbonKind.ONLINE } }
        return Featured(
            total = s.total,
            connected = s.connected,
            offline = offline(s),
            delta = s.deltas.totalVsYesterday?.let { Delta(it, DeltaTrend.NEUTRAL, DeltaPeriod.YESTERDAY) },
            segments = segments,
            legend = legend,
        )
    }

    private val LEGEND_KINDS = setOf(RibbonKind.CRITICAL, RibbonKind.WARNING, RibbonKind.OFFLINE, RibbonKind.PENDING)

    /** Trend of a change where MORE is better ([higherIsBetter]) or worse. */
    fun trend(value: Int, higherIsBetter: Boolean): DeltaTrend = when {
        value == 0 -> DeltaTrend.NEUTRAL
        (value > 0) == higherIsBetter -> DeltaTrend.BETTER
        else -> DeltaTrend.WORSE
    }

    fun kpis(data: FleetData): List<Kpi> {
        val s = data.summary
        val total = s.total.coerceAtLeast(0)
        fun frac(v: Int) = if (total > 0) (v.toFloat() / total).coerceIn(0f, 1f) else 0f
        fun colored(v: Int, status: ObliTokens.Status) = if (v > 0) status else null
        val off = offline(s)
        val base = listOf(
            Kpi(
                KpiKind.ONLINE, s.online,
                delta = s.deltas.onlineVsYesterday?.let { Delta(it, trend(it, higherIsBetter = true), DeltaPeriod.YESTERDAY) },
                fraction = frac(s.online), status = colored(s.online, ObliTokens.Status.ONLINE),
            ),
            Kpi(
                KpiKind.OFFLINE, off,
                delta = s.deltas.offlineVsYesterday?.let { Delta(it, trend(it, higherIsBetter = false), DeltaPeriod.YESTERDAY) },
                fraction = frac(off), status = colored(off, ObliTokens.Status.OFFLINE),
            ),
            Kpi(KpiKind.CRITICAL, s.critical, fraction = frac(s.critical), status = colored(s.critical, ObliTokens.Status.CRITICAL)),
            Kpi(KpiKind.WARNING, s.warning, fraction = frac(s.warning), status = colored(s.warning, ObliTokens.Status.WARNING)),
        )
        if (!data.serverAggregates) return base
        val agents = s.agentUpToDate + s.agentOutdated
        return base + listOf(
            Kpi(
                KpiKind.PENDING_UPDATES, s.pendingUpdates,
                criticalUpdates = data.updates?.critical?.takeIf { it > 0 && s.pendingUpdates > 0 },
                delta = s.deltas.pendingUpdatesVsWeek?.let { Delta(it, trend(it, higherIsBetter = false), DeltaPeriod.WEEK) },
                fraction = frac(s.pendingUpdates), status = null,
            ),
            Kpi(
                KpiKind.AGENTS_UP_TO_DATE, s.agentUpToDate, outOf = if (agents > 0) agents else total,
                fraction = if (agents > 0) (s.agentUpToDate.toFloat() / agents).coerceIn(0f, 1f) else 0f,
                status = ObliTokens.Status.ONLINE,
            ),
        )
    }

    /** Figures of the devices the user can see (non-admins: server aggregates are not filtered by visibility). */
    fun summaryOf(devices: List<Device>): FleetSummary {
        val counts = devices.groupingBy { it.status }.eachCount()
        fun n(status: String) = counts[status] ?: 0
        val managed = devices.count { it.status !in setOf("pending", "suspended", "pending_uninstall") }
        return FleetSummary(
            total = managed, online = n("online"), offline = n("offline"), warning = n("warning"), critical = n("critical"),
            updating = n("updating"), updateError = n("update_error"), maintenance = n("maintenance"), pending = n("pending"),
            suspended = n("suspended"),
        )
    }

    fun attention(devices: List<Device>, now: Long): List<AttentionRow> = devices.map { d ->
        AttentionRow(d, statusColor(d.status), reason(d, now))
    }

    /** Threshold above which a metric explains the state of a device (the server default is 90 %). */
    private const val METRIC_NOTABLE = 85.0

    fun reason(d: Device, now: Long): AttentionReason {
        if (d.status == "offline" || d.status == "update_error") {
            val since = (d.lastSeenAt ?: d.lastPushAt)?.let(::epoch)
            if (since != null) {
                // Rounded to the nearest day ("Hors ligne depuis 3 j" for 2 days 17 h).
                val days = ((now - since + DAY_MS / 2) / DAY_MS).toInt()
                return AttentionReason.OfflineSince(since, if (now - since >= DAY_MS) days.coerceAtLeast(1) else 0)
            }
        }
        worstMetric(d.latestMetrics)?.let { return it }
        return AttentionReason.Identity(d.osName, d.ipLocal)
    }

    private fun worstMetric(m: DeviceMetrics?): AttentionReason.Metric? {
        if (m == null) return null
        val candidates = buildList {
            m.cpu?.percent?.let { add(AttentionReason.Metric(MetricKind.CPU, it.toPercent())) }
            m.memory?.percent?.let { add(AttentionReason.Metric(MetricKind.RAM, it.toPercent())) }
            m.disks.forEach { disk ->
                disk.percent?.let { p ->
                    val free = if (disk.totalGb != null && disk.usedGb != null) (disk.totalGb!! - disk.usedGb!!).coerceAtLeast(0.0) else null
                    add(AttentionReason.Metric(MetricKind.DISK, p.toPercent(), disk.mount.ifBlank { null }, free))
                }
            }
        }
        return candidates.filter { it.percent >= METRIC_NOTABLE }.maxByOrNull { it.percent }
    }

    private fun Double.toPercent(): Int = Math.round(this).toInt().coerceIn(0, 100)

    /**
     * Group health (design doc §5 S70 item 6): each root group with its whole
     * subtree, plus any subgroup with half of it or more offline, shown first.
     * At most [limit] rows.
     */
    fun groups(stats: List<GroupStat>, limit: Int = 4): List<GroupRow> {
        val real = stats.filter { it.groupId != null && it.groupId != 0L && it.groupName != null }
        val byId = real.associateBy { it.groupId!! }
        val children = real.groupBy { it.parentId?.takeIf { p -> p in byId } }
        fun path(g: GroupStat): List<String> {
            val names = ArrayList<String>()
            var cur: GroupStat? = g
            var guard = 0
            while (cur != null && guard++ < 16) {
                names.add(0, cur.groupName.orEmpty())
                cur = cur.parentId?.let(byId::get)
            }
            return names
        }
        fun subtree(g: GroupStat, depth: Int = 0): GroupStat {
            if (depth > 16) return g
            return (children[g.groupId] ?: emptyList()).fold(g) { acc, child ->
                val c = subtree(child, depth + 1)
                acc.copy(
                    online = acc.online + c.online, offline = acc.offline + c.offline, warning = acc.warning + c.warning,
                    critical = acc.critical + c.critical, total = acc.total + c.total,
                )
            }
        }
        fun row(g: GroupStat, aggregate: GroupStat) = GroupRow(
            path(g), g.tenantName, aggregate.total, aggregate.online, aggregate.offline, aggregate.warning, aggregate.critical,
            g.complianceScore,
        )
        val roots = (children[null] ?: emptyList())
            .sortedWith(compareBy<GroupStat>({ it.tenantName.orEmpty() }, { it.sortOrder }, { it.groupName.orEmpty() }))
            .map { row(it, subtree(it)) }
            .filter { it.total > 0 }
        val troubled = real.filter { it.parentId != null && it.parentId in byId }
            .map { row(it, subtree(it)) }
            .filter { it.hasProblem }
            .sortedWith(compareByDescending<GroupRow> { it.offline.toFloat() / it.total.coerceAtLeast(1) }.thenByDescending { it.total })
        return (troubled + roots).distinctBy { it.path to it.tenantName }.take(limit)
    }

    /**
     * Widths of the ribbon segments: proportional to [counts], but never under
     * [min] (a single critical device among 312 stays visible); the larger
     * segments give up the difference. Sums to [available] when possible.
     */
    fun ribbonWidths(counts: List<Int>, available: Float, min: Float): List<Float> {
        val total = counts.sum()
        if (counts.isEmpty() || total <= 0 || available <= 0f) return counts.map { 0f }
        val widths = counts.map { maxOf(min, it.toFloat() / total * available) }.toMutableList()
        repeat(4) {
            val over = widths.sum() - available
            if (over <= 0.01f) return widths
            val flex = widths.indices.filter { widths[it] > min }
            val room = flex.sumOf { (widths[it] - min).toDouble() }.toFloat()
            if (room <= 0f) return widths
            val keep = (1f - over / room).coerceAtLeast(0f)
            flex.forEach { widths[it] = min + (widths[it] - min) * keep }
        }
        return widths
    }

    fun hours(points: List<FleetHour>): List<HourPoint> =
        points.mapNotNull { p -> epoch(p.hour)?.let { HourPoint(it, p.online, p.offline) } }.sortedBy { it.at }

    fun problemOf(outcome: ApiOutcome<*>): FleetProblem = when (outcome) {
        ApiOutcome.SessionExpired -> FleetProblem.SESSION_EXPIRED
        is ApiOutcome.Forbidden -> FleetProblem.FORBIDDEN
        is ApiOutcome.Failure -> if (outcome.kind == tools.obli.core.network.FailureKind.NETWORK) FleetProblem.OFFLINE else FleetProblem.SERVER
        else -> FleetProblem.SERVER
    }

    fun epoch(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

    private const val DAY_MS = 24L * 60 * 60 * 1000
}
