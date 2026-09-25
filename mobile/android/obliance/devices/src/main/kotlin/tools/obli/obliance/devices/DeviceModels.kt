package tools.obli.obliance.devices

import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.DeviceSort
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.DiskMetrics
import tools.obli.obliance.api.FleetSummary

// ---------------------------------------------------------------------------
// Status → colour token (design doc §8.2) and pulse (§8.6)
// ---------------------------------------------------------------------------

internal val DeviceStatus.token: ObliTokens.Status
    get() = when (this) {
        DeviceStatus.ONLINE -> ObliTokens.Status.ONLINE
        DeviceStatus.OFFLINE, DeviceStatus.UNKNOWN -> ObliTokens.Status.OFFLINE
        DeviceStatus.WARNING -> ObliTokens.Status.WARNING
        DeviceStatus.CRITICAL -> ObliTokens.Status.CRITICAL
        DeviceStatus.PENDING, DeviceStatus.UPDATING -> ObliTokens.Status.PENDING
        DeviceStatus.MAINTENANCE -> ObliTokens.Status.MAINTENANCE
        DeviceStatus.SUSPENDED -> ObliTokens.Status.SUSPENDED
        DeviceStatus.PENDING_UNINSTALL, DeviceStatus.UPDATE_ERROR -> ObliTokens.Status.PENDING_UNINSTALL
    }

/** Only warning, critical, updating and pending_uninstall dots pulse (STYLEKIT §0). */
internal val DeviceStatus.pulses: Boolean
    get() = this == DeviceStatus.WARNING || this == DeviceStatus.CRITICAL ||
        this == DeviceStatus.UPDATING || this == DeviceStatus.PENDING_UNINSTALL

// ---------------------------------------------------------------------------
// S20 sections, in the server's "problems first" order
// ---------------------------------------------------------------------------

/**
 * Sections of the device list. The order mirrors `sortBy=status` of
 * device.service.ts (critical, warning, updating, the other statuses,
 * offline, online), so pages appended by infinite scroll land in place.
 */
internal enum class DeviceSection(val statuses: Set<DeviceStatus>) {
    CRITICAL(setOf(DeviceStatus.CRITICAL)),
    WARNING(setOf(DeviceStatus.WARNING)),
    UPDATING(setOf(DeviceStatus.UPDATING)),
    PENDING(setOf(DeviceStatus.PENDING)),
    UPDATE_ERROR(setOf(DeviceStatus.UPDATE_ERROR)),
    MAINTENANCE(setOf(DeviceStatus.MAINTENANCE)),
    SUSPENDED(setOf(DeviceStatus.SUSPENDED)),
    OTHER(setOf(DeviceStatus.PENDING_UNINSTALL, DeviceStatus.UNKNOWN)),
    OFFLINE(setOf(DeviceStatus.OFFLINE)),
    ONLINE(setOf(DeviceStatus.ONLINE)),
    ;

    /** The status whose colour and label the section header uses. */
    val status: DeviceStatus get() = statuses.first()

    companion object {
        fun of(status: DeviceStatus): DeviceSection = entries.first { status in it.statuses }
    }
}

/** Count of a section in `/api/devices/summary` (counted by `status`), null when the summary has none. */
internal fun FleetSummary.count(section: DeviceSection): Int? = when (section) {
    DeviceSection.CRITICAL -> critical
    DeviceSection.WARNING -> warning
    DeviceSection.UPDATING -> updating
    DeviceSection.PENDING -> pending
    DeviceSection.UPDATE_ERROR -> updateError
    DeviceSection.MAINTENANCE -> maintenance
    DeviceSection.SUSPENDED -> suspended
    DeviceSection.OFFLINE -> offline
    DeviceSection.ONLINE -> online
    DeviceSection.OTHER -> null
}

/** One block of the list: [section] null = flat list (sorted by name). */
internal data class SectionUi(
    val section: DeviceSection?,
    val count: Int,
    /** The section may continue on the next page: show "N+". */
    val atLeast: Boolean,
    val devices: List<Device>,
)

/**
 * Groups the loaded devices into sections. A row stays in the section it was
 * loaded in ([frozen]) even when a live status change arrives: the order never
 * moves under the finger (§7.4), the "N changements" pill reorders on demand.
 * Counts come from the summary when it describes the list ([summary] non-null),
 * else from the loaded rows.
 */
internal fun buildSections(
    devices: List<Device>,
    frozen: Map<Long, DeviceSection>,
    problemsFirst: Boolean,
    total: Int,
    hasMore: Boolean,
    summary: FleetSummary?,
): List<SectionUi> {
    if (devices.isEmpty()) return emptyList()
    if (!problemsFirst) return listOf(SectionUi(null, maxOf(total, devices.size), false, devices))
    val grouped = devices.groupBy { frozen[it.id] ?: DeviceSection.of(it.statusKind) }
    val present = DeviceSection.entries.filter { it in grouped }
    val last = present.last()
    return present.map { s ->
        val rows = grouped.getValue(s)
        val fromSummary = summary?.count(s)
        if (fromSummary != null) {
            SectionUi(s, maxOf(fromSummary, rows.size), false, rows)
        } else {
            SectionUi(s, rows.size, hasMore && s == last, rows)
        }
    }
}

// ---------------------------------------------------------------------------
// S20 quick filters
// ---------------------------------------------------------------------------

internal enum class StatusChip(val status: DeviceStatus) {
    OFFLINE(DeviceStatus.OFFLINE),
    CRITICAL(DeviceStatus.CRITICAL),
    WARNING(DeviceStatus.WARNING),

    /** Enrolment requests (status `pending`); admins only (§5 S20). */
    PENDING(DeviceStatus.PENDING),
}

/** `osType` values of the server (`windows`, `linux`, `macos`). */
internal enum class OsChip(val wire: String) { WINDOWS("windows"), LINUX("linux"), MACOS("macos") }

internal data class ListFilters(
    val search: String = "",
    val status: StatusChip? = null,
    val os: OsChip? = null,
    /** "Problèmes d'abord" (default): `sortBy=status` and sections; off = by name, flat. */
    val problemsFirst: Boolean = true,
) {
    val narrowed: Boolean get() = search.isNotBlank() || status != null || os != null

    /**
     * `GET /api/devices` query (§5 S20 "Pagination"): admins page by 100 with
     * infinite scroll; non-admins ask the server's maximum at once because the
     * server filters visibility AFTER its LIMIT (and reports only what is left
     * as `total`), and are pinned to approved devices like the web.
     */
    fun toQuery(page: Int, admin: Boolean): DeviceQuery = DeviceQuery(
        page = page,
        pageSize = if (admin) ADMIN_PAGE_SIZE else MEMBER_PAGE_SIZE,
        search = search.trim().takeIf { it.isNotEmpty() },
        status = status?.status?.wire,
        sortBy = if (problemsFirst) DeviceSort.STATUS else DeviceSort.NAME,
        approvalStatus = if (admin) null else "approved",
        osType = os?.wire,
    )

    companion object {
        const val ADMIN_PAGE_SIZE = 100
        const val MEMBER_PAGE_SIZE = DeviceQuery.MAX_PAGE_SIZE
    }
}

// ---------------------------------------------------------------------------
// Metric thresholds (shared/src/types.ts SYSTEM_DEFAULT_THRESHOLDS)
// ---------------------------------------------------------------------------

internal enum class MetricLevel { NORMAL, WARNING, CRITICAL }

internal data class Threshold(val warn: Double, val crit: Double) {
    /** At-or-above, as threshold.service.ts evaluates a push. */
    fun levelOf(percent: Double?): MetricLevel = when {
        percent == null -> MetricLevel.NORMAL
        percent >= crit -> MetricLevel.CRITICAL
        percent >= warn -> MetricLevel.WARNING
        else -> MetricLevel.NORMAL
    }

    /** The threshold that [level] crossed, for the "seuil 95 %" hint. */
    fun crossed(level: MetricLevel): Double? = when (level) {
        MetricLevel.NORMAL -> null
        MetricLevel.WARNING -> warn
        MetricLevel.CRITICAL -> crit
    }
}

internal data class Thresholds(
    val cpu: Threshold,
    val ram: Threshold,
    val disk: Threshold,
    val diskByMount: Map<String, Threshold> = emptyMap(),
) {
    fun forDisk(mount: String): Threshold = diskByMount[mount] ?: disk

    companion object {
        /** System defaults; the server cascade (global, tenant, group, device) overrides them. */
        val SYSTEM = Thresholds(cpu = Threshold(80.0, 95.0), ram = Threshold(80.0, 95.0), disk = Threshold(85.0, 95.0))
    }
}

/** The disk of the row's mini-bars: `C:` or `/`, else the fullest one. */
internal fun DeviceMetrics.mainDisk(): DiskMetrics? =
    disks.firstOrNull { it.mount.equals("C:", ignoreCase = true) || it.mount.equals("C:\\", ignoreCase = true) || it.mount == "/" }
        ?: disks.maxByOrNull { it.percent ?: -1.0 }

// ---------------------------------------------------------------------------
// Load problems (§5 standard states, §7.8)
// ---------------------------------------------------------------------------

internal enum class ProblemKind { NETWORK, SERVER, SESSION_EXPIRED, FORBIDDEN, RATE_LIMITED, NOT_FOUND, NO_SERVER }

internal data class LoadProblem(val kind: ProblemKind, val httpStatus: Int? = null, val path: String? = null)

/** Maps a non-success outcome to what the screen says; null for success. */
internal fun ApiOutcome<*>.toProblem(path: String? = null): LoadProblem? = when (this) {
    is ApiOutcome.Ok, is ApiOutcome.Accepted -> null
    ApiOutcome.SessionExpired -> LoadProblem(ProblemKind.SESSION_EXPIRED, 401, path)
    is ApiOutcome.Forbidden -> LoadProblem(ProblemKind.FORBIDDEN, 403, path)
    is ApiOutcome.RateLimited -> LoadProblem(ProblemKind.RATE_LIMITED, 429, path)
    is ApiOutcome.AgentOffline -> LoadProblem(ProblemKind.SERVER, 503, path)
    is ApiOutcome.Failure -> when {
        kind == FailureKind.NETWORK -> LoadProblem(ProblemKind.NETWORK, null, path)
        kind == FailureKind.NOT_FOUND || status == 404 -> LoadProblem(ProblemKind.NOT_FOUND, 404, path)
        // :obliance:data answers `Failure(null, CLIENT, "no such server")` without a session.
        status == null && kind == FailureKind.CLIENT && message == "no such server" -> LoadProblem(ProblemKind.NO_SERVER, null, path)
        else -> LoadProblem(ProblemKind.SERVER, status, path)
    }
    else -> LoadProblem(ProblemKind.SERVER, null, path)
}
