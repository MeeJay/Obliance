package tools.obli.obliance.api

import kotlinx.serialization.Serializable

/** Device statuses (shared/src/types.ts `DeviceStatus`); [UNKNOWN] for a newer server value. */
enum class DeviceStatus(val wire: String) {
    PENDING("pending"),
    ONLINE("online"),
    OFFLINE("offline"),
    MAINTENANCE("maintenance"),
    WARNING("warning"),
    CRITICAL("critical"),
    SUSPENDED("suspended"),
    PENDING_UNINSTALL("pending_uninstall"),
    UPDATING("updating"),
    UPDATE_ERROR("update_error"),
    UNKNOWN(""),
    ;

    /** The agent is reachable (the server's virtual status `connected`). */
    val isConnected: Boolean get() = this == ONLINE || this == WARNING || this == CRITICAL || this == UPDATING

    companion object {
        fun parse(raw: String?): DeviceStatus = entries.firstOrNull { it.wire == raw && it != UNKNOWN } ?: UNKNOWN
    }
}

/** shared/src/types.ts `DeviceMetrics` (the agent's latest push). Every field may be missing. */
@Serializable
data class DeviceMetrics(
    val cpu: CpuMetrics? = null,
    val memory: MemoryMetrics? = null,
    val disks: List<DiskMetrics> = emptyList(),
    val network: NetworkMetrics? = null,
    val loadAvg: Double? = null,
    val updatedAt: String? = null,
) {
    val isEmpty: Boolean get() = cpu == null && memory == null && disks.isEmpty()
}

@Serializable
data class CpuMetrics(
    val percent: Double? = null,
    val cores: List<Double> = emptyList(),
    val model: String? = null,
    val freqMhz: Double? = null,
)

@Serializable
data class MemoryMetrics(
    val usedMb: Double? = null,
    val totalMb: Double? = null,
    val percent: Double? = null,
    val cachedMb: Double? = null,
    val swapTotalMb: Double? = null,
    val swapUsedMb: Double? = null,
)

@Serializable
data class DiskMetrics(
    val mount: String = "",
    val usedGb: Double? = null,
    val totalGb: Double? = null,
    val percent: Double? = null,
    val readBytesPerSec: Double? = null,
    val writeBytesPerSec: Double? = null,
    val fstype: String? = null,
    val removable: Boolean? = null,
)

@Serializable
data class NetworkMetrics(
    val inBytesPerSec: Double? = null,
    val outBytesPerSec: Double? = null,
)

/**
 * One device (device.service.ts `rowToDevice`, the same shape for the list
 * items and `GET /api/devices/:id`). Only the fields the app uses are declared;
 * the others are ignored. [groupName] is only set on list items.
 */
@Serializable
data class Device(
    val id: Long,
    val uuid: String? = null,
    val tenantId: Long? = null,
    val tenantName: String? = null,
    val groupId: Long? = null,
    val groupName: String? = null,
    val hostname: String = "",
    val displayName: String? = null,
    val description: String? = null,
    val ipLocal: String? = null,
    val ipPublic: String? = null,
    val macAddress: String? = null,
    val osType: String? = null,
    val osName: String? = null,
    val osVersion: String? = null,
    val osBuild: String? = null,
    val osArch: String? = null,
    val cpuModel: String? = null,
    val cpuCores: Int? = null,
    val ramTotalGb: Double? = null,
    val agentVersion: String? = null,
    val updateAvailable: Boolean = false,
    val status: String = "",
    val approvalStatus: String? = null,
    val lastSeenAt: String? = null,
    val lastPushAt: String? = null,
    val pushIntervalSeconds: Int? = null,
    val privacyModeEnabled: Boolean = false,
    val privacyPasswordSet: Boolean = false,
    val airgapEnabled: Boolean = false,
    val agentFlavor: String = "modern",
    val lastLoggedInUser: String? = null,
    val lastRebootAt: String? = null,
    val rebootPending: Boolean = false,
    val timezone: String? = null,
    val tags: List<String> = emptyList(),
    val latestMetrics: DeviceMetrics? = null,
    val uninstallAt: String? = null,
    val duplicateAgentIdSuspected: Boolean = false,
    val createdAt: String? = null,
    val updatedAt: String? = null,
) {
    /** What the web shows: the display name, else the hostname. */
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: hostname
    val statusKind: DeviceStatus get() = DeviceStatus.parse(status)
    val isLegacyAgent: Boolean get() = agentFlavor == "legacy"
}

/** `GET /api/devices` → `data`. */
@Serializable
data class DevicePage(
    val items: List<Device> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val pageSize: Int = 0,
) {
    val hasMore: Boolean get() = page.toLong() * pageSize < total
}

@Serializable
data class FleetDeltas(
    val onlineVsYesterday: Int? = null,
    val offlineVsYesterday: Int? = null,
    val pendingUpdatesVsWeek: Int? = null,
    val staleVsYesterday: Int? = null,
    val totalVsYesterday: Int? = null,
)

@Serializable
data class OsConnectivity(val online: Int = 0, val total: Int = 0)

/**
 * `GET /api/devices/summary` → `data` (device.service.ts getFleetSummary).
 * [total] excludes pending, suspended and pending_uninstall devices.
 */
@Serializable
data class FleetSummary(
    val total: Int = 0,
    val online: Int = 0,
    val offline: Int = 0,
    val warning: Int = 0,
    val critical: Int = 0,
    val updating: Int = 0,
    val updateError: Int = 0,
    val maintenance: Int = 0,
    val pending: Int = 0,
    val suspended: Int = 0,
    val pendingUpdates: Int = 0,
    val agentUpToDate: Int = 0,
    val agentOutdated: Int = 0,
    val latestAgentVersion: String? = null,
    val osByType: Map<String, Int> = emptyMap(),
    val osConnectivity: Map<String, OsConnectivity> = emptyMap(),
    val activeRemoteSessions: Int = 0,
    val upcomingSchedules: Int = 0,
    val staleDevices: Int = 0,
    val deltas: FleetDeltas = FleetDeltas(),
) {
    /** "Connectés": online + warning + critical + updating (the server's virtual `connected`). */
    val connected: Int get() = online + warning + critical + updating
}

/** `POST /api/devices/:id/live-metrics` → `data`. [sent] = false when the agent is not connected. */
@Serializable
data class LiveMetricsAck(val sent: Boolean = false, val mode: String = "", val windowSec: Int? = null)

/** Payload of `DEVICE_METRICS_PUSHED`: `{deviceId, metrics}` (metrics may be a JSON string). */
data class MetricsPush(val deviceId: Long, val metrics: DeviceMetrics)

/** A device changed on the active server (`DEVICE_UPDATED`, `DEVICE_DELETED`…); [status] when the event carries one. */
data class DeviceSignal(val event: String, val deviceId: Long, val status: DeviceStatus?)

/** Sort keys of `GET /api/devices` (device.service.ts SORT_MAP + metric sorts). */
enum class DeviceSort(val wire: String) {
    NAME("name"), STATUS("status"), OS("os"), LAST_SEEN("lastSeen"), VERSION("version"), GROUP("group"),
    CPU("cpu"), RAM("ram"), DISK("disk"),
}

enum class SortOrder(val wire: String) { ASC("asc"), DESC("desc") }

/**
 * Query of `GET /api/devices` (routes/device.routes.ts). [status] accepts a
 * real status or the server's virtual ones: `connected`, `disconnected`,
 * `outdated`. [tenantIds] only works in a master-tenant session (the "filter
 * the global view" of design doc §2.3); the server ignores it otherwise.
 */
data class DeviceQuery(
    val page: Int = 1,
    val pageSize: Int = 50,
    val search: String? = null,
    val status: String? = null,
    val sortBy: DeviceSort? = null,
    val sortOrder: SortOrder = SortOrder.ASC,
    val groupId: Long? = null,
    val includeSubgroups: Boolean = false,
    val approvalStatus: String? = null,
    val osType: String? = null,
    val tags: List<String> = emptyList(),
    val tenantIds: List<Long> = emptyList(),
) {
    fun toPath(): String {
        val params = buildList {
            add("page" to page.coerceAtLeast(1).toString())
            add("pageSize" to pageSize.coerceIn(1, MAX_PAGE_SIZE).toString())
            search?.trim()?.takeIf { it.isNotEmpty() }?.let { add("search" to it) }
            status?.takeIf { it.isNotBlank() }?.let { add("status" to it) }
            sortBy?.let { add("sortBy" to it.wire); add("sortOrder" to sortOrder.wire) }
            groupId?.let { add("groupId" to it.toString()) }
            if (includeSubgroups) add("includeSubgroups" to "true")
            approvalStatus?.takeIf { it.isNotBlank() }?.let { add("approvalStatus" to it) }
            osType?.takeIf { it.isNotBlank() }?.let { add("osType" to it) }
            if (tags.isNotEmpty()) add("tags" to tags.joinToString(","))
            if (tenantIds.isNotEmpty()) add("tenantIds" to tenantIds.joinToString(","))
        }
        return "/api/devices?" + params.joinToString("&") { (k, v) -> "$k=${encode(v)}" }
    }

    private fun encode(v: String): String = java.net.URLEncoder.encode(v, Charsets.UTF_8)

    companion object {
        /**
         * The server's own cap (device.service.ts getDevices). Non-admins need it:
         * the route filters visibility AFTER the LIMIT and sets `total` to what is
         * left, so a smaller page silently hides visible devices (no next page).
         */
        const val MAX_PAGE_SIZE = 10_000
    }
}
