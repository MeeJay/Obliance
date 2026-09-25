package tools.obli.obliance.triage

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ApiResponses
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.MASTER_TENANT_ID
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/*
 * Enrolments (design doc §5 S10 "Segment Enrôlements", S12): the calls are not
 * in :obliance:api, so they live here (CONTRACT §7), over the session of the
 * ITEM'S server, never the active one and never a hand-built URL.
 *
 * Server shapes (read only):
 * - GET  /api/devices?approvalStatus=pending  device.routes.ts → device.service.ts rowToDevice
 * - POST /api/devices/:id/approve|refuse      → {data: Device | null}; the UPDATE is scoped to the
 *   SESSION tenant, so from the master session a child-tenant device stays pending and 200 is answered
 * - POST /api/devices/bulk/approve {ids}      → {success, count} (no device state)
 * - PATCH /api/devices/:id {groupId}          → {data: Device}; fires the group_join scenarios
 * - GET  /api/agent/keys                      → agent.controller.ts listKeys (carries the key SECRET: never declared here)
 * - GET  /api/groups                          → group.service.ts rowToGroup (flat, parentId)
 * - GET  /api/auth/permissions                → {canCreate, teams, permissions, tenantCapabilities}
 */

/** Capability of the enrolment routes (device.routes.ts requireTenantCapability). */
internal const val CAP_APPROVAL = "agent_config:approval"

/**
 * A device waiting for enrolment, as `rowToDevice` sends it. Only what S10 and
 * S12 show; every field has a default (tolerant decoding). [apiKeyId] and the
 * geolocation are not in the shared `Device` DTO, hence this private copy.
 */
@Serializable
internal data class PendingDevice(
    val id: Long,
    val tenantId: Long? = null,
    val tenantName: String? = null,
    val groupId: Long? = null,
    val apiKeyId: Long? = null,
    val hostname: String = "",
    val displayName: String? = null,
    val ipLocal: String? = null,
    val ipPublic: String? = null,
    val osType: String? = null,
    val osName: String? = null,
    val osVersion: String? = null,
    val osArch: String? = null,
    val agentVersion: String? = null,
    val status: String = "",
    val approvalStatus: String? = null,
    val geoCity: String? = null,
    val geoCountry: String? = null,
    val duplicateAgentIdSuspected: Boolean = false,
    val createdAt: String? = null,
) {
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: hostname.ifBlank { "#$id" }
}

/** `GET /api/devices` → `data`. */
@Serializable
internal data class PendingPage(val items: List<PendingDevice> = emptyList(), val total: Int = 0)

/**
 * One enrolment key of `GET /api/agent/keys`. The route also returns `key` (the
 * enrolment SECRET, the web shows it to copy it): it is deliberately NOT
 * declared, so it is dropped at decoding and can never reach the UI or a log.
 */
@Serializable
internal data class AgentKeyInfo(
    val id: Long,
    val tenantId: Long? = null,
    val name: String = "",
    val defaultGroupId: Long? = null,
    val defaultGroupName: String? = null,
)

/** One group of `GET /api/groups` (flat list; the path is rebuilt from [parentId]). */
@Serializable
internal data class GroupInfo(
    val id: Long,
    val tenantId: Long? = null,
    val tenantName: String? = null,
    val parentId: Long? = null,
    val name: String = "",
)

/** `GET /api/auth/permissions` → `data` (only what the segment needs). */
@Serializable
internal data class PermissionsInfo(val tenantCapabilities: List<String> = emptyList())

/** Answer of approve / refuse / move: `data` is the device, or null when the session tenant cannot see it. */
internal data class DeviceAnswer(val device: PendingDevice?)

/**
 * Enrolment calls of ANY configured server, addressed by its [ServerId]
 * (design doc §2.10 item 4: inbox actions never switch server). A 401 marks
 * that server's session expired. [extra] carries the step-up fields of
 * ActionRunner (`twoFactorCode`, `trustIp`), merged into the same body.
 */
internal interface EnrolmentsSource {
    /** False for in-memory sources: nothing changes behind their back, no 60 s polling. */
    val polls: Boolean get() = true

    suspend fun tenantCapabilities(serverId: ServerId): ApiOutcome<List<String>>

    suspend fun pending(serverId: ServerId): ApiOutcome<List<PendingDevice>>

    suspend fun keys(serverId: ServerId): ApiOutcome<List<AgentKeyInfo>>

    suspend fun groups(serverId: ServerId): ApiOutcome<List<GroupInfo>>

    suspend fun approve(serverId: ServerId, deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer>

    suspend fun refuse(serverId: ServerId, deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer>

    suspend fun bulkApprove(serverId: ServerId, ids: List<Long>, extra: JsonObject): ApiOutcome<Unit>

    suspend fun move(serverId: ServerId, deviceId: Long, groupId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer>

    /** No enrolment feed at all (the ViewModel default: the segment never shows). */
    object None : EnrolmentsSource {
        override val polls: Boolean get() = false
        private val none = ApiOutcome.Failure(null, FailureKind.CLIENT, "no enrolment source")
        override suspend fun tenantCapabilities(serverId: ServerId) = ApiOutcome.Ok(emptyList<String>())
        override suspend fun pending(serverId: ServerId) = ApiOutcome.Ok(emptyList<PendingDevice>())
        override suspend fun keys(serverId: ServerId) = ApiOutcome.Ok(emptyList<AgentKeyInfo>())
        override suspend fun groups(serverId: ServerId) = ApiOutcome.Ok(emptyList<GroupInfo>())
        override suspend fun approve(serverId: ServerId, deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> = none
        override suspend fun refuse(serverId: ServerId, deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> = none
        override suspend fun bulkApprove(serverId: ServerId, ids: List<Long>, extra: JsonObject): ApiOutcome<Unit> = none
        override suspend fun move(serverId: ServerId, deviceId: Long, groupId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> = none
    }
}

/** The source the screen uses: the real server, or the §4 sample behind [SampleObliServices] (previews, screenshots). */
internal fun defaultEnrolmentsSource(services: ObliServices): EnrolmentsSource =
    if (services is SampleObliServices) SampleEnrolmentsSource(services) else HttpEnrolmentsSource(services)

/** The enrolment routes of ONE server, through its [ObliHttp] (bound to its origin). */
internal class EnrolmentCalls(private val http: ObliHttp) {
    suspend fun tenantCapabilities(): ApiOutcome<List<String>> =
        http.call(ObliHttp.Method.GET, "/api/auth/permissions", decode = ApiJson.unwrapped(PermissionsInfo.serializer())).mapOk { it.tenantCapabilities }

    /** `GET /api/devices?page=1&pageSize=100&approvalStatus=pending` (the first 100 are plenty for an inbox). */
    suspend fun pending(): ApiOutcome<List<PendingDevice>> =
        http.call(ObliHttp.Method.GET, PENDING_QUERY.toPath(), decode = ApiJson.unwrapped(PendingPage.serializer())).mapOk { it.items }

    suspend fun keys(): ApiOutcome<List<AgentKeyInfo>> =
        http.call(ObliHttp.Method.GET, "/api/agent/keys", decode = ApiJson.unwrapped(ListSerializer(AgentKeyInfo.serializer())))

    suspend fun groups(): ApiOutcome<List<GroupInfo>> =
        http.call(ObliHttp.Method.GET, "/api/groups", decode = ApiJson.unwrapped(ListSerializer(GroupInfo.serializer())))

    suspend fun approve(deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> =
        http.call(ObliHttp.Method.POST, "/api/devices/$deviceId/approve", ApiJson.body(extra = extra), decode = ::deviceAnswer)

    suspend fun refuse(deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> =
        http.call(ObliHttp.Method.POST, "/api/devices/$deviceId/refuse", ApiJson.body(extra = extra), decode = ::deviceAnswer)

    suspend fun bulkApprove(ids: List<Long>, extra: JsonObject): ApiOutcome<Unit> =
        http.call(
            ObliHttp.Method.POST,
            "/api/devices/bulk/approve",
            ApiJson.body("ids" to JsonArray(ids.map { JsonPrimitive(it) }), extra = extra),
            decode = ApiJson.ignoreBody,
        )

    suspend fun move(deviceId: Long, groupId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> =
        http.call(ObliHttp.Method.PATCH, "/api/devices/$deviceId", ApiJson.body("groupId" to groupId, extra = extra), decode = ::deviceAnswer)

    companion object {
        const val PAGE_SIZE = 100
        val PENDING_QUERY = DeviceQuery(page = 1, pageSize = PAGE_SIZE, approvalStatus = "pending")

        /** `{data: Device}` or `{data: null}` (never a decoding failure: null is an answer). */
        private fun deviceAnswer(element: JsonElement?): DeviceAnswer =
            DeviceAnswer(ApiJson.decode(PendingDevice.serializer(), ApiResponses.unwrap(element)))
    }
}

/** [EnrolmentsSource] over the configured servers' sessions (the app). */
internal class HttpEnrolmentsSource(private val services: ObliServices) : EnrolmentsSource {
    private suspend fun <T> on(serverId: ServerId, block: suspend (EnrolmentCalls) -> ApiOutcome<T>): ApiOutcome<T> {
        val session = services.sessions.session(serverId) ?: return ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server")
        return block(EnrolmentCalls(session.http)).also { if (it == ApiOutcome.SessionExpired) session.markExpired() }
    }

    override suspend fun tenantCapabilities(serverId: ServerId) = on(serverId) { it.tenantCapabilities() }
    override suspend fun pending(serverId: ServerId) = on(serverId) { it.pending() }
    override suspend fun keys(serverId: ServerId) = on(serverId) { it.keys() }
    override suspend fun groups(serverId: ServerId) = on(serverId) { it.groups() }
    override suspend fun approve(serverId: ServerId, deviceId: Long, extra: JsonObject) = on(serverId) { it.approve(deviceId, extra) }
    override suspend fun refuse(serverId: ServerId, deviceId: Long, extra: JsonObject) = on(serverId) { it.refuse(deviceId, extra) }
    override suspend fun bulkApprove(serverId: ServerId, ids: List<Long>, extra: JsonObject) = on(serverId) { it.bulkApprove(ids, extra) }
    override suspend fun move(serverId: ServerId, deviceId: Long, groupId: Long, extra: JsonObject) = on(serverId) { it.move(deviceId, groupId, extra) }
}

/**
 * The §4 enrolment in memory (KIOSK-ACCUEIL-02 on Obliance Prod, tenant ACME,
 * key « Site Siège » → Siège › Accueil), for previews and screenshots. It
 * answers like the server: from another tenant's session the device is left
 * pending (master) or not found (child), so a missing tenant switch shows.
 */
internal class SampleEnrolmentsSource(private val services: ObliServices) : EnrolmentsSource {
    override val polls: Boolean get() = false
    private val pending = LinkedHashMap<ServerId, MutableList<PendingDevice>>().apply { put(SampleData.PROD, mutableListOf(KIOSK)) }

    private fun sessionTenant(serverId: ServerId): Long? =
        (services.sessions.session(serverId)?.auth?.value as? AuthState.SignedIn)?.probe?.currentTenantId

    /** Like the route: `data` is the device if the session tenant sees it; it only changes in its own tenant. */
    private fun decide(serverId: ServerId, deviceId: Long, status: String): DeviceAnswer = synchronized(pending) {
        val list = pending[serverId] ?: return DeviceAnswer(null)
        val device = list.firstOrNull { it.id == deviceId } ?: return DeviceAnswer(null)
        val current = sessionTenant(serverId)
        when {
            current == device.tenantId -> {
                list.remove(device)
                DeviceAnswer(device.copy(approvalStatus = status, status = if (status == "approved") "offline" else "suspended"))
            }
            current == MASTER_TENANT_ID -> DeviceAnswer(device)
            else -> DeviceAnswer(null)
        }
    }

    override suspend fun tenantCapabilities(serverId: ServerId): ApiOutcome<List<String>> =
        // The local account of Obliance Qual is a team member without the right (§4).
        ApiOutcome.Ok(if (serverId == SampleData.QUAL) emptyList() else listOf(CAP_APPROVAL))

    override suspend fun pending(serverId: ServerId): ApiOutcome<List<PendingDevice>> = synchronized(pending) {
        val current = sessionTenant(serverId)
        ApiOutcome.Ok(pending[serverId].orEmpty().filter { current == MASTER_TENANT_ID || it.tenantId == current })
    }

    override suspend fun keys(serverId: ServerId): ApiOutcome<List<AgentKeyInfo>> =
        ApiOutcome.Ok(if (serverId == SampleData.PROD) KEYS else emptyList())

    override suspend fun groups(serverId: ServerId): ApiOutcome<List<GroupInfo>> =
        ApiOutcome.Ok(if (serverId == SampleData.PROD) GROUPS else emptyList())

    override suspend fun approve(serverId: ServerId, deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> =
        ApiOutcome.Ok(decide(serverId, deviceId, "approved"))

    override suspend fun refuse(serverId: ServerId, deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> =
        ApiOutcome.Ok(decide(serverId, deviceId, "refused"))

    override suspend fun bulkApprove(serverId: ServerId, ids: List<Long>, extra: JsonObject): ApiOutcome<Unit> {
        ids.forEach { decide(serverId, it, "approved") }
        return ApiOutcome.Ok(Unit)
    }

    override suspend fun move(serverId: ServerId, deviceId: Long, groupId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> =
        ApiOutcome.Ok(DeviceAnswer(KIOSK.takeIf { it.id == deviceId }?.copy(approvalStatus = "approved", status = "offline", groupId = groupId)))

    companion object {
        /** KIOSK-ACCUEIL-02 (§4), pending since 02:59 in Paris. The public IP is a documentation address (RFC 5737). */
        val KIOSK = PendingDevice(
            id = 240, tenantId = SampleData.ACME_TENANT, tenantName = "ACME", apiKeyId = 12,
            hostname = "KIOSK-ACCUEIL-02", ipLocal = "10.0.3.41", ipPublic = "203.0.113.24",
            osType = "windows", osName = "Windows 11 IoT Enterprise", osArch = "amd64", agentVersion = "4.5.79",
            status = "pending", approvalStatus = "pending", geoCity = "Lyon", geoCountry = "FR",
            createdAt = "2026-09-25T00:59:00Z",
        )

        val KEYS = listOf(AgentKeyInfo(id = 12, tenantId = SampleData.ACME_TENANT, name = "Site Siège", defaultGroupId = 44, defaultGroupName = "Accueil"))

        /** Groups of §4: ACME › Siège › …, Default › Infra › …. */
        val GROUPS = listOf(
            GroupInfo(40, SampleData.ACME_TENANT, "ACME", null, "Siège"),
            GroupInfo(41, SampleData.ACME_TENANT, "ACME", 40, "Serveurs"),
            GroupInfo(42, SampleData.ACME_TENANT, "ACME", 40, "Comptabilité"),
            GroupInfo(43, SampleData.ACME_TENANT, "ACME", 40, "Direction"),
            GroupInfo(44, SampleData.ACME_TENANT, "ACME", 40, "Accueil"),
            GroupInfo(45, SampleData.ACME_TENANT, "ACME", 40, "Atelier"),
            GroupInfo(30, SampleData.DEFAULT_TENANT, "Default", null, "Infra"),
            GroupInfo(31, SampleData.DEFAULT_TENANT, "Default", 30, "Linux"),
            GroupInfo(32, SampleData.DEFAULT_TENANT, "Default", 30, "Stockage"),
            GroupInfo(33, SampleData.DEFAULT_TENANT, "Default", 30, "Virtualisation"),
        )
    }
}

/** Ok / Accepted value mapped; any other outcome kept as is. */
@Suppress("UNCHECKED_CAST")
internal inline fun <T, R> ApiOutcome<T>.mapOk(f: (T) -> R): ApiOutcome<R> = when (this) {
    is ApiOutcome.Ok -> ApiOutcome.Ok(f(value))
    is ApiOutcome.Accepted -> ApiOutcome.Accepted(f(value))
    else -> this as ApiOutcome<R>
}

/** Paths of every group ("Siège › Accueil"), from the flat list; cycles and missing parents are cut. */
internal object GroupPaths {
    const val SEPARATOR = " › "

    fun of(groups: List<GroupInfo>): Map<Long, String> {
        val byId = groups.associateBy { it.id }
        return groups.associate { g ->
            val names = ArrayList<String>()
            val seen = HashSet<Long>()
            var cur: GroupInfo? = g
            while (cur != null && seen.add(cur.id) && names.size < MAX_DEPTH) {
                names += cur.name
                cur = cur.parentId?.let(byId::get)
            }
            g.id to names.asReversed().joinToString(SEPARATOR)
        }
    }

    private const val MAX_DEPTH = 16
}
