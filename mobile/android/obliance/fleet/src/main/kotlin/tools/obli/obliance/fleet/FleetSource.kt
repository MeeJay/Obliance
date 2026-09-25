package tools.obli.obliance.fleet

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerSession
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.DeviceSort
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.api.SortOrder
import tools.obli.obliance.data.ObliServices

// ---------------------------------------------------------------------------
// Fleet calls that :obliance:api does not have (CONTRACT §7). Shapes copied
// from server/src/routes/device.routes.ts, server/src/services/device.service.ts
// and server/src/services/update.service.ts. Every field has a default
// (tolerant decoding); unknown fields are ignored by ApiJson.
// ---------------------------------------------------------------------------

/** `GET /api/devices/group-stats` → one row per group (direct members only, `groupId` 0 = ungrouped). */
@Serializable
internal data class GroupStat(
    val groupId: Long? = null,
    val groupName: String? = null,
    val parentId: Long? = null,
    val sortOrder: Int = 0,
    val tenantId: Long? = null,
    val tenantName: String? = null,
    val online: Int = 0,
    val offline: Int = 0,
    val warning: Int = 0,
    val critical: Int = 0,
    val total: Int = 0,
    val complianceScore: Double? = null,
    val policyCount: Int = 0,
    val pendingUpdates: Int = 0,
)

/** One device of `GET /api/devices/disk-saturated` (`top`, at most 5, fullest first). */
@Serializable
internal data class SaturatedDisk(
    val deviceId: Long = 0,
    val hostname: String = "",
    val displayName: String? = null,
    val pct: Int = 0,
    val mountpoint: String = "/",
    /** Resolved warning threshold of that device (per device, group or mount). */
    val warn: Int? = null,
) {
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: hostname
}

/** `GET /api/devices/disk-saturated?threshold=0` → `data`. */
@Serializable
internal data class DiskSaturation(
    val count: Int = 0,
    val threshold: Int = 0,
    val top: List<SaturatedDisk> = emptyList(),
)

/** `GET /api/updates/stats` → `data` (counts of device × update rows). */
@Serializable
internal data class UpdateStats(
    val available: Int = 0,
    val critical: Int = 0,
    val important: Int = 0,
    val approved: Int = 0,
    val installed: Int = 0,
    val failed: Int = 0,
)

/** One point of `GET /api/devices/fleet-hourly?hours=24`. */
@Serializable
internal data class FleetHour(
    val hour: String = "",
    val total: Int = 0,
    val online: Int = 0,
    val offline: Int = 0,
)

/**
 * What the Fleet screen reads, always about ONE given server (the active one
 * when the load started). The default implementation goes through that
 * server's own session; tests and screenshots provide an in-memory one.
 */
internal interface FleetSource {
    suspend fun summary(serverId: ServerId): ApiOutcome<FleetSummary>

    /** Devices sorted by the server's visual priority (critical first), approved only. */
    suspend fun byPriority(serverId: ServerId, pageSize: Int): ApiOutcome<DevicePage>

    suspend fun groupStats(serverId: ServerId): ApiOutcome<List<GroupStat>>

    suspend fun diskSaturation(serverId: ServerId): ApiOutcome<DiskSaturation>

    suspend fun updateStats(serverId: ServerId): ApiOutcome<UpdateStats>

    suspend fun hourly(serverId: ServerId): ApiOutcome<List<FleetHour>>

    /** Whether the signed-in user of [serverId] is a platform admin (server aggregates are not filtered for others). */
    fun isPlatformAdmin(serverId: ServerId): Boolean
}

/** [FleetSource] over [ObliServices]: `devices` of the plumbing plus private GETs on the server's session. */
internal class ServicesFleetSource(private val services: ObliServices) : FleetSource {
    override suspend fun summary(serverId: ServerId): ApiOutcome<FleetSummary> = services.devices.summary(serverId)

    override suspend fun byPriority(serverId: ServerId, pageSize: Int): ApiOutcome<DevicePage> =
        services.devices.page(
            DeviceQuery(pageSize = pageSize, sortBy = DeviceSort.STATUS, sortOrder = SortOrder.ASC, approvalStatus = "approved"),
            serverId,
        )

    override suspend fun groupStats(serverId: ServerId): ApiOutcome<List<GroupStat>> =
        get(serverId, "/api/devices/group-stats", ListSerializer(GroupStat.serializer()))

    override suspend fun diskSaturation(serverId: ServerId): ApiOutcome<DiskSaturation> =
        get(serverId, "/api/devices/disk-saturated?threshold=0", DiskSaturation.serializer())

    override suspend fun updateStats(serverId: ServerId): ApiOutcome<UpdateStats> =
        get(serverId, "/api/updates/stats", UpdateStats.serializer())

    override suspend fun hourly(serverId: ServerId): ApiOutcome<List<FleetHour>> =
        get(serverId, "/api/devices/fleet-hourly?hours=24", ListSerializer(FleetHour.serializer()))

    override fun isPlatformAdmin(serverId: ServerId): Boolean =
        (services.sessions.session(serverId)?.auth?.value as? AuthState.SignedIn)?.probe?.user?.isPlatformAdmin ?: true

    private suspend fun <T> get(serverId: ServerId, path: String, serializer: KSerializer<T>): ApiOutcome<T> {
        val session = services.sessions.session(serverId) ?: return ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server")
        return session.getTyped(path, serializer)
    }
}

/** GET on THIS server, `{data}` envelope unwrapped, 401 → session expired (CONTRACT §7). */
internal suspend fun <T> ServerSession.getTyped(path: String, serializer: KSerializer<T>): ApiOutcome<T> =
    http.call(ObliHttp.Method.GET, path, decode = ApiJson.unwrapped(serializer))
        .also { if (it == ApiOutcome.SessionExpired) markExpired() }

/** Devices of a page that need attention (not online, not waiting for enrolment), most urgent first. */
internal fun List<Device>.needingAttention(limit: Int): List<Device> =
    filter { FleetMapper.priority(it.status) < FleetMapper.PRIORITY_ONLINE && it.approvalStatus != "pending" }
        // Same priority: the most recent change first (a server that just went down before one off for days).
        .sortedWith(compareBy<Device> { FleetMapper.priority(it.status) }.thenByDescending { it.lastSeenAt.orEmpty() }.thenBy { it.label.lowercase() })
        .take(limit)
