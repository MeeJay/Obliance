package tools.obli.obliance.triage

import java.time.Instant
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.ServerApproval
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.domain.AlertCategory
import tools.obli.obliance.domain.ServerAlert
import tools.obli.obliance.domain.SiteOutage
import tools.obli.shell.alerts.AlertSeverity

/*
 * UI model of S10 "À traiter" (design doc §5 S10) and the pure function that
 * builds it from the shared state. Everything here is plain data so the rules
 * (sections, filters, held-back new alerts, live lines) are unit-tested on the
 * JVM; the composables only format and draw.
 */

internal enum class TriageSegment { ALERTS, APPROVALS, ENROLMENTS }

/** Identity of an alert across servers: ids are only unique per server. */
internal data class AlertKey(val serverId: ServerId, val id: Long)

internal val ServerAlert.key: AlertKey get() = AlertKey(serverId, alert.id)

/** A device of ONE server. */
internal data class DeviceRef(val serverId: ServerId, val deviceId: Long)

private val DEVICE_PATH = Regex("^/devices/(\\d+)(?:[/?#].*)?$")

/** Device id of an alert, from its `navigateTo` (`/devices/:id`), resolved against the alert's OWN server. */
internal fun ServerAlert.deviceId(): Long? =
    alert.navigateTo?.trim()?.let { DEVICE_PATH.matchEntire(it)?.groupValues?.get(1)?.toLongOrNull() }

/** What the card says about the device's current state (design doc §5 S10 "ligne d'état en direct"). */
internal sealed interface LiveLine {
    /** Nothing to say (no device, recovery card of a device we could not load). */
    data object None : LiveLine

    /** The device lives on another server than the active one. */
    data object OtherServer : LiveLine

    /** The device belongs to another tenant than the session tenant (not in the global view). */
    data object OtherTenant : LiveLine

    /** The alert's server session expired: cards stay, greyed by this mention. */
    data object SessionExpired : LiveLine

    /** The alert's server did not answer: the card comes from the last successful load. */
    data object Unreachable : LiveLine

    /** Current state from the active server; [reading] = the metric the alert is about, when known. */
    data class State(val status: DeviceStatus, val reading: Reading?, val category: AlertCategory) : LiveLine
}

internal enum class MetricKind { CPU, RAM, DISK }

internal data class Reading(val kind: MetricKind, val mount: String?, val percent: Int)

internal data class IncidentUi(
    val key: AlertKey,
    val alert: ServerAlert,
    /** Server tile, only when two servers or more are configured. */
    val server: ServerProfile?,
    val severity: AlertSeverity,
    val category: AlertCategory,
    val deviceName: String?,
    val rawTitle: String,
    val message: String,
    val tenantName: String?,
    val createdAt: Instant?,
    val unread: Boolean,
    val deviceId: Long?,
    val live: LiveLine,
    /** Delete is refused while every server is unreachable (nothing can be sent). */
    val canDelete: Boolean,
)

internal data class EscalationUi(
    val item: ServerApproval,
    val server: ServerProfile?,
    val tenantName: String?,
    val createdAt: Instant?,
    val expiresAt: Instant?,
)

internal data class OutageUi(
    val outage: SiteOutage,
    val server: ServerProfile?,
    val tenantName: String?,
    /** Device names, in time order, with their ids for opening them. */
    val devices: List<Pair<String, Long?>>,
)

internal data class ServerChipUi(
    val profile: ServerProfile,
    val unread: Int,
    val selected: Boolean,
    /** Devices waiting for enrolment on this server (the menu shows it in the Enrôlements segment). */
    val pending: Int = 0,
)

internal data class SeverityChipUi(val severity: AlertSeverity, val count: Int, val selected: Boolean)

/** A discreet line at the top of the list about one server (§2.10 item 5, §5 S10 "Plusieurs serveurs"). */
internal sealed interface FeedNotice {
    val server: ServerProfile

    data class Unreachable(override val server: ServerProfile, val lastOkAt: Long?) : FeedNotice

    data class Expired(override val server: ServerProfile) : FeedNotice
}

internal enum class ListState {
    /** Nothing loaded yet: skeletons. */
    LOADING,

    /** Nothing to handle: calm state. */
    EMPTY,

    /** Every server failed and nothing was ever loaded: error card with Retry. */
    ERROR,
    CONTENT,
}

internal enum class Freshness { LIVE, UPDATED, STALE }

internal data class TriageUi(
    val multiServer: Boolean = false,
    val showApprovals: Boolean = false,
    val segment: TriageSegment = TriageSegment.ALERTS,
    val alertCount: Int = 0,
    val approvalCount: Int = 0,
    val serverChips: List<ServerChipUi> = emptyList(),
    val serverFilter: ServerProfile? = null,
    val severityChips: List<SeverityChipUi> = emptyList(),
    val escalations: List<EscalationUi> = emptyList(),
    val approvals: List<EscalationUi> = emptyList(),
    val outages: List<OutageUi> = emptyList(),
    val notices: List<FeedNotice> = emptyList(),
    val unread: List<IncidentUi> = emptyList(),
    val read: List<IncidentUi> = emptyList(),
    val readExpanded: Boolean = false,
    /** Unread alerts that arrived while the list was scrolled: counted in the pill, not inserted. */
    val heldBack: Int = 0,
    /** The severity chips hide every unread alert ("Effacer les filtres"). */
    val filteredOut: Boolean = false,
    val listState: ListState = ListState.LOADING,
    /** Every included server is unreachable: "Hors ligne — alertes reçues jusqu'à 03:02". */
    val offline: Boolean = false,
    val freshness: Freshness = Freshness.UPDATED,
    val updatedAt: Long? = null,
    val refreshing: Boolean = false,
    /** Servers "Tout marquer comme lu" acts on (those with unread alerts in the current filter). */
    val markAllServers: List<ServerId> = emptyList(),
    /** Session tenant of the active server (menu label with one server). */
    val sessionTenantName: String? = null,
    /** « Enrôlements » segment: shown when at least one server allows approval (§5 S10). */
    val showEnrolments: Boolean = false,
    val enrolmentCount: Int = 0,
    /** « Serveur › Tenant » sections, filtered by the server chip. */
    val enrolmentGroups: List<EnrolmentGroupUi> = emptyList(),
    val enrolmentNotices: List<FeedNotice> = emptyList(),
    val enrolmentState: ListState = ListState.EMPTY,
    val enrolmentRefreshing: Boolean = false,
) {
    /** The pending device [key] as listed now (null when it left the list). */
    fun enrolment(key: EnrolmentKey): EnrolmentItemUi? =
        enrolmentGroups.firstNotNullOfOrNull { g -> g.items.firstOrNull { it.key == key } }
}

/** Screen-local choices kept by the ViewModel. */
internal data class LocalState(
    val segment: TriageSegment = TriageSegment.ALERTS,
    val serverFilter: ServerId? = null,
    val severities: Set<AlertSeverity> = emptySet(),
    val readExpanded: Boolean = false,
    /** Swiped left, waiting for the 5 s undo delay before the call. */
    val pendingDeletes: Set<AlertKey> = emptySet(),
    /** Keys already shown to the user; null = accept everything (first load, list at the top). */
    val acknowledged: Set<AlertKey>? = null,
    val atTop: Boolean = true,
)

internal object TriageMapper {
    /** "LUES — DERNIÈRES 24 H". */
    const val READ_WINDOW_MS = 24 * 60 * 60 * 1000L

    /** Devices whose live state is loaded per refresh (the list shows the most urgent first). */
    const val MAX_LIVE_DEVICES = 20

    fun map(
        snapshot: AlertsSnapshot,
        registry: ServerRegistryState,
        scope: TenantScope,
        isPlatformAdmin: Boolean,
        realtimeConnected: Boolean,
        local: LocalState,
        devices: Map<DeviceRef, Device>,
        now: Long,
        enrolments: EnrolmentsState = EnrolmentsState(),
    ): TriageUi {
        val multi = registry.isMultiServer
        val profiles = registry.profiles
        val tile: (ServerId) -> ServerProfile? = { id -> if (multi) registry.byId(id) else null }
        val serverFilter = local.serverFilter?.takeIf { multi && registry.byId(it) != null }
        val serverSet = serverFilter?.let { setOf(it) }
        val feeds = snapshot.feeds.associateBy { it.serverId }

        // Alerts minus the ones swiped away (their call waits for the undo delay).
        val alerts = snapshot.alerts.filter { it.key !in local.pendingDeletes }
        val serverScoped = Triage(alerts, serverSet, null)
        val filtered = Triage(alerts, serverSet, local.severities.takeIf { it.isNotEmpty() })

        // New unread alerts are held back while the list is scrolled (§7.4).
        val ack = local.acknowledged
        val (shownUnread, held) = if (local.atTop || ack == null) {
            filtered.unread to emptyList()
        } else {
            filtered.unread.partition { it.key in ack }
        }

        val included = profiles.filter { it.includeInTriage }.map { it.id }
        val includedFeeds = included.mapNotNull { feeds[it] }
        val allUnreachable = includedFeeds.isNotEmpty() && includedFeeds.all { it.status == FeedStatus.UNREACHABLE }

        val activeId = registry.activeId
        val incident = { a: ServerAlert ->
            val classification = a.classification
            IncidentUi(
                key = a.key,
                alert = a,
                server = tile(a.serverId),
                severity = a.alert.severity,
                category = classification.category,
                deviceName = classification.deviceName,
                rawTitle = a.alert.title,
                message = a.alert.message,
                tenantName = a.alert.tenantName,
                createdAt = a.createdAt,
                unread = a.alert.readAt == null,
                deviceId = a.deviceId(),
                live = liveLine(a, feeds[a.serverId]?.status, activeId, scope, devices),
                canDelete = !allUnreachable,
            )
        }

        val readCutoff = now - READ_WINDOW_MS
        val read = filtered.read.filter { (it.createdAt?.toEpochMilli() ?: now) >= readCutoff }

        // The active server's tenant list, else the tenant name an alert of that server carries.
        val tenantNameOf = { serverId: ServerId, tenantId: Long? ->
            (if (serverId == scope.serverId) scope.tenants.firstOrNull { it.id == tenantId }?.name else null)
                ?: tenantId?.let { id ->
                    snapshot.alerts.firstOrNull { it.serverId == serverId && it.alert.tenantId == id && !it.alert.tenantName.isNullOrBlank() }?.alert?.tenantName
                }
        }
        // Past its expiry a request can only answer 410: the server never sweeps them
        // (approval.service.ts sweepExpired has no caller), so they are hidden here.
        val pending = snapshot.escalations
            .filter { it.approval.isPending && !isExpired(it, now) }
            .map { e ->
                EscalationUi(
                    item = e,
                    server = tile(e.serverId),
                    tenantName = tenantNameOf(e.serverId, e.approval.tenantId),
                    createdAt = parseInstant(e.approval.createdAt),
                    expiresAt = parseInstant(e.approval.expiresAt),
                )
            }
            .sortedWith(compareBy<EscalationUi> { it.expiresAt ?: Instant.MAX }.thenBy { it.item.approval.id })
        // The pinned "ESCALADES DE DROITS" summary covers every server; the segment follows the server filter.
        val approvals = pending.filter { serverSet == null || it.item.serverId in serverSet }

        val outages = filtered.outages.map { o ->
            OutageUi(
                outage = o,
                server = tile(o.serverId),
                tenantName = o.alerts.firstNotNullOfOrNull { it.alert.tenantName },
                devices = o.alerts.map { (it.classification.deviceName ?: it.alert.title) to it.deviceId() },
            )
        }

        val notices = profiles.filter { it.includeInTriage }.mapNotNull { p ->
            when (feeds[p.id]?.status) {
                FeedStatus.UNREACHABLE -> if (allUnreachable) null else FeedNotice.Unreachable(p, feeds[p.id]?.updatedAt)
                FeedStatus.EXPIRED -> FeedNotice.Expired(p)
                else -> null
            }
        }

        val everLoaded = includedFeeds.any { it.updatedAt != null } || snapshot.updatedAt != null
        val listState = when {
            includedFeeds.isNotEmpty() && includedFeeds.all { it.status == FeedStatus.LOADING } && snapshot.alerts.isEmpty() -> ListState.LOADING
            allUnreachable && !everLoaded && snapshot.alerts.isEmpty() -> ListState.ERROR
            // Nothing unread (read alerts stay reachable under the calm state).
            serverScoped.unread.isEmpty() && pending.isEmpty() -> ListState.EMPTY
            else -> ListState.CONTENT
        }

        val anyUnreachable = includedFeeds.any { it.status == FeedStatus.UNREACHABLE }
        val freshness = when {
            anyUnreachable -> Freshness.STALE
            realtimeConnected && includedFeeds.all { it.status == FeedStatus.OK || it.status == FeedStatus.EXCLUDED || it.status == FeedStatus.SIGNED_OUT } -> Freshness.LIVE
            else -> Freshness.UPDATED
        }

        val unreadByServer = serverScoped.unreadByServer
        val enrol = EnrolmentMapper.map(enrolments, registry, scope, snapshot, serverFilter)
        // A segment without the right is hidden (§5 S10): its choice falls back to Alertes.
        val segment = when (local.segment) {
            TriageSegment.ALERTS -> TriageSegment.ALERTS
            TriageSegment.APPROVALS -> if (isPlatformAdmin) TriageSegment.APPROVALS else TriageSegment.ALERTS
            TriageSegment.ENROLMENTS -> if (enrol.show) TriageSegment.ENROLMENTS else TriageSegment.ALERTS
        }
        return TriageUi(
            multiServer = multi,
            showApprovals = isPlatformAdmin,
            segment = segment,
            alertCount = filtered.unread.size,
            approvalCount = approvals.size,
            serverChips = if (multi) {
                profiles.filter { it.includeInTriage }.map {
                    ServerChipUi(it, Triage(alerts, setOf(it.id), null).unread.size, it.id == serverFilter, enrol.pendingByServer[it.id] ?: 0)
                }
            } else {
                emptyList()
            },
            serverFilter = serverFilter?.let { registry.byId(it) },
            severityChips = listOf(AlertSeverity.CRITICAL, AlertSeverity.WARNING, AlertSeverity.INFO).map { s ->
                SeverityChipUi(s, serverScoped.unread.count { it.alert.severity == s }, s in local.severities)
            },
            escalations = if (isPlatformAdmin) pending else emptyList(),
            approvals = if (isPlatformAdmin) approvals else emptyList(),
            outages = outages,
            notices = notices,
            unread = shownUnread.map(incident),
            read = read.map(incident),
            readExpanded = local.readExpanded,
            heldBack = held.size,
            filteredOut = filtered.unread.isEmpty() && serverScoped.unread.isNotEmpty(),
            listState = listState,
            offline = allUnreachable,
            freshness = freshness,
            updatedAt = snapshot.updatedAt ?: includedFeeds.mapNotNull { it.updatedAt }.maxOrNull(),
            refreshing = snapshot.refreshing,
            markAllServers = profiles.map { it.id }.filter { (unreadByServer[it] ?: 0) > 0 },
            sessionTenantName = scope.current?.name,
            showEnrolments = enrol.show,
            enrolmentCount = enrol.count,
            enrolmentGroups = enrol.groups,
            enrolmentNotices = enrol.notices,
            enrolmentState = enrol.listState,
            enrolmentRefreshing = enrol.refreshing,
        )
    }

    /** The request's expiry has passed (no expiry = still open). */
    fun isExpired(e: ServerApproval, now: Long): Boolean {
        val expiresAt = parseInstant(e.approval.expiresAt) ?: return false
        return (minutesLeft(expiresAt, now) ?: 1) <= 0
    }

    /** Devices whose current state the card can show: active server, session tenant (or global view). */
    fun liveDevices(snapshot: AlertsSnapshot, registry: ServerRegistryState, scope: TenantScope): List<DeviceRef> {
        val active = registry.activeId ?: return emptyList()
        if (scope.serverId != active) return emptyList()
        return Triage(snapshot.alerts, setOf(active), null).unread
            .asSequence()
            .filter { scope.isGlobalView || it.alert.tenantId == scope.currentTenantId }
            .mapNotNull { a -> a.deviceId()?.let { DeviceRef(a.serverId, it) } }
            .distinct()
            .take(MAX_LIVE_DEVICES)
            .toList()
    }

    fun liveLine(a: ServerAlert, feed: FeedStatus?, activeId: ServerId?, scope: TenantScope, devices: Map<DeviceRef, Device>): LiveLine {
        when (feed) {
            FeedStatus.EXPIRED -> return LiveLine.SessionExpired
            FeedStatus.UNREACHABLE -> return LiveLine.Unreachable
            else -> Unit
        }
        val id = a.deviceId() ?: return LiveLine.None
        if (a.serverId != activeId) return LiveLine.OtherServer
        if (scope.serverId == activeId && !scope.isGlobalView && scope.currentTenantId != null && a.alert.tenantId != scope.currentTenantId) {
            return LiveLine.OtherTenant
        }
        val device = devices[DeviceRef(a.serverId, id)] ?: return LiveLine.None
        val category = a.classification.category
        return LiveLine.State(device.statusKind, reading(a.alert.message, device), category)
    }

    private val CPU = Regex("\\bCPU\\b", RegexOption.IGNORE_CASE)
    private val RAM = Regex("\\b(RAM|mémoire|memory)\\b", RegexOption.IGNORE_CASE)
    private val DISK = Regex("\\b(?:Disque|Disk)\\s+(\\S+)", RegexOption.IGNORE_CASE)

    /** Current value of the metric named by the server message ("CPU 98 %", "Disque / 94 %"). */
    fun reading(message: String, device: Device): Reading? {
        val m = device.latestMetrics ?: return null
        if (CPU.containsMatchIn(message)) return m.cpu?.percent?.let { Reading(MetricKind.CPU, null, it.roundToPercent()) }
        if (RAM.containsMatchIn(message)) return m.memory?.percent?.let { Reading(MetricKind.RAM, null, it.roundToPercent()) }
        val mount = DISK.find(message)?.groupValues?.get(1) ?: return null
        val disk = m.disks.firstOrNull { it.mount.equals(mount, ignoreCase = true) } ?: return null
        return disk.percent?.let { Reading(MetricKind.DISK, disk.mount, it.roundToPercent()) }
    }

    private fun Double.roundToPercent(): Int = Math.round(this).toInt().coerceIn(0, 100)

    @Suppress("FunctionName")
    private fun Triage(alerts: List<ServerAlert>, servers: Set<ServerId>?, severities: Set<AlertSeverity>?) =
        tools.obli.obliance.domain.Triage.build(alerts, servers, severities)
}

/** ISO-8601 (or PostgreSQL-style) timestamp → Instant; null when absent or unreadable. */
internal fun parseInstant(raw: String?): Instant? {
    if (raw.isNullOrBlank()) return null
    return runCatching { Instant.parse(raw.trim()) }.getOrNull()
        ?: runCatching { java.time.OffsetDateTime.parse(raw.trim().replace(' ', 'T')).toInstant() }.getOrNull()
}
