package tools.obli.obliance.triage

import kotlinx.serialization.json.JsonObject
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionPrompter
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.TwoFactorAnswer
import tools.obli.obliance.api.MASTER_TENANT_ID
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.TenantsRepository
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** KIOSK-ACCUEIL-02 of design doc §4 (id 240, tenant ACME = 4, key « Site Siège »). */
internal val KIOSK: PendingDevice = SampleEnrolmentsSource.KIOSK

/**
 * The replacement of PC-ATELIER-02 (§4, 03:21) enrolling under the same name:
 * a second pending device of ACME for the bulk cases.
 */
internal val ATELIER: PendingDevice = KIOSK.copy(id = 241, hostname = "PC-ATELIER-02", osName = "Windows 10 Pro", ipLocal = "10.0.14.22", createdAt = "2026-09-25T01:21:30Z")

/** Two pending devices of the Default tenant (§4 names), for a second « Serveur › Tenant » section. */
internal val HV01: PendingDevice = KIOSK.copy(id = 242, tenantId = SampleData.DEFAULT_TENANT, tenantName = "Default", apiKeyId = null, hostname = "HV-01", osName = "Windows Server 2022 Datacenter", ipLocal = "10.20.0.10")
internal val BOB01: PendingDevice = KIOSK.copy(id = 243, tenantId = SampleData.DEFAULT_TENANT, tenantName = "Default", apiKeyId = null, hostname = "BOB01", osType = "linux", osName = "Ubuntu 22.04.4 LTS", ipLocal = "10.20.0.15")

/** One call of [FakeEnrolments], with the server it went to. */
internal data class EnrolCall(val serverId: ServerId, val what: String, val deviceId: Long? = null, val ids: List<Long> = emptyList(), val groupId: Long? = null, val extra: JsonObject? = null)

/**
 * Network-free [EnrolmentsSource] answering like device.routes.ts: the list
 * and the decisions follow the SESSION tenant of the server (master = every
 * tenant, but a decision there leaves a child-tenant device pending and still
 * answers 200). Every call is recorded with its server, and in [log].
 */
internal class FakeEnrolments(
    private val services: ObliServices,
    private val log: MutableList<String> = mutableListOf(),
    pending: Map<ServerId, List<PendingDevice>> = mapOf(SampleData.PROD to listOf(KIOSK)),
    /** `GET /api/auth/permissions` of team members (platform admins never ask). */
    var capabilities: Map<ServerId, List<String>> = emptyMap(),
) : EnrolmentsSource {
    override val polls: Boolean get() = false
    val calls = mutableListOf<EnrolCall>()
    val lists: MutableMap<ServerId, MutableList<PendingDevice>> = pending.mapValuesTo(LinkedHashMap()) { it.value.toMutableList() }

    /** Overrides the answer of approve / refuse (then the server rules apply). */
    var decideAnswer: ((String, Long) -> ApiOutcome<DeviceAnswer>)? = null
    var pendingAnswer: MutableMap<ServerId, ApiOutcome<List<PendingDevice>>> = mutableMapOf()

    /** The bulk route answers 200 but approves nothing (what a wrong session tenant would do). */
    var bulkIgnored = false

    val mutations: List<EnrolCall> get() = calls.filter { it.what in setOf("approve", "refuse", "bulk", "move") }

    private fun sessionTenant(id: ServerId): Long? =
        (services.sessions.session(id)?.auth?.value as? AuthState.SignedIn)?.probe?.currentTenantId

    private fun record(call: EnrolCall) {
        calls += call
        log += listOfNotNull(call.what, call.serverId.value, call.deviceId?.toString(), call.ids.takeIf { it.isNotEmpty() }?.joinToString(","), call.groupId?.toString()).joinToString(" ")
    }

    private fun decide(serverId: ServerId, deviceId: Long, status: String): DeviceAnswer {
        val list = lists[serverId] ?: return DeviceAnswer(null)
        val device = list.firstOrNull { it.id == deviceId } ?: return DeviceAnswer(null)
        return when (sessionTenant(serverId)) {
            device.tenantId -> {
                list.remove(device)
                DeviceAnswer(device.copy(approvalStatus = status, status = if (status == "approved") "offline" else "suspended"))
            }
            MASTER_TENANT_ID -> DeviceAnswer(device)
            else -> DeviceAnswer(null)
        }
    }

    override suspend fun tenantCapabilities(serverId: ServerId): ApiOutcome<List<String>> {
        record(EnrolCall(serverId, "permissions"))
        return ApiOutcome.Ok(capabilities[serverId].orEmpty())
    }

    override suspend fun pending(serverId: ServerId): ApiOutcome<List<PendingDevice>> {
        record(EnrolCall(serverId, "pending"))
        pendingAnswer[serverId]?.let { return it }
        val current = sessionTenant(serverId)
        return ApiOutcome.Ok(lists[serverId].orEmpty().filter { current == MASTER_TENANT_ID || it.tenantId == current })
    }

    override suspend fun keys(serverId: ServerId): ApiOutcome<List<AgentKeyInfo>> {
        record(EnrolCall(serverId, "keys"))
        return ApiOutcome.Ok(if (serverId == SampleData.PROD) SampleEnrolmentsSource.KEYS else emptyList())
    }

    override suspend fun groups(serverId: ServerId): ApiOutcome<List<GroupInfo>> {
        record(EnrolCall(serverId, "groups"))
        return ApiOutcome.Ok(if (serverId == SampleData.PROD) SampleEnrolmentsSource.GROUPS else emptyList())
    }

    override suspend fun approve(serverId: ServerId, deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> {
        record(EnrolCall(serverId, "approve", deviceId, extra = extra))
        decideAnswer?.let { return it("approve", deviceId) }
        return ApiOutcome.Ok(decide(serverId, deviceId, "approved"))
    }

    override suspend fun refuse(serverId: ServerId, deviceId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> {
        record(EnrolCall(serverId, "refuse", deviceId, extra = extra))
        decideAnswer?.let { return it("refuse", deviceId) }
        return ApiOutcome.Ok(decide(serverId, deviceId, "refused"))
    }

    override suspend fun bulkApprove(serverId: ServerId, ids: List<Long>, extra: JsonObject): ApiOutcome<Unit> {
        record(EnrolCall(serverId, "bulk", ids = ids, extra = extra))
        if (!bulkIgnored) ids.forEach { decide(serverId, it, "approved") }
        return ApiOutcome.Ok(Unit)
    }

    override suspend fun move(serverId: ServerId, deviceId: Long, groupId: Long, extra: JsonObject): ApiOutcome<DeviceAnswer> {
        record(EnrolCall(serverId, "move", deviceId, groupId = groupId, extra = extra))
        return ApiOutcome.Ok(DeviceAnswer(KIOSK.copy(id = deviceId, approvalStatus = "approved", status = "offline", groupId = groupId)))
    }
}

/** Tenants of the sample services, each completed switch written to [log] (order checks). */
internal class RecordingTenants(private val delegate: TenantsRepository, private val log: MutableList<String>) : TenantsRepository by delegate {
    override suspend fun switchTo(tenantId: Long, serverId: ServerId?): ApiOutcome<Unit> =
        delegate.switchTo(tenantId, serverId).also { log += "switch $tenantId ${serverId?.value}" }
}

/** The §4 sample services (3 servers, Prod active, master tenant) with recorded tenant switches. */
internal class EnrolServices(
    val base: SampleObliServices = SampleObliServices(),
    val log: MutableList<String> = mutableListOf(),
) : ObliServices by base {
    override val tenants: TenantsRepository = RecordingTenants(base.tenants, log)

    fun sessionTenant(id: ServerId): Long? = (base.sessions.session(id)?.auth?.value as? AuthState.SignedIn)?.probe?.currentTenantId

    /** The session of [id] already works in [tenant] (no switch needed). */
    fun inTenant(id: ServerId, tenant: Long): EnrolServices = apply {
        base.sessions.session(id)!!.markSignedIn(SampleData.probe(id).copy(currentTenantId = tenant))
    }
}

/** Prompter that answers [accept] and records what it was asked (and when, in [log]). */
internal class RecordingPrompter(private val log: MutableList<String> = mutableListOf(), var accept: Boolean = true) : ActionPrompter {
    val confirmed = mutableListOf<ActionSpec>()
    val switches = mutableListOf<String>()

    override suspend fun confirmTenantSwitch(spec: ActionSpec, tenantName: String): Boolean = accept.also {
        switches += tenantName
        log += "confirm-switch $tenantName"
    }

    override suspend fun confirm(spec: ActionSpec): Boolean = accept.also {
        confirmed += spec
        log += "confirm ${spec.tier}"
    }

    override suspend fun askTwoFactor(spec: ActionSpec, currentIp: String?, previousWasWrong: Boolean): TwoFactorAnswer? = null
    override suspend fun approvalRequested(spec: ActionSpec, approvalId: Long) = Unit
    override suspend fun unlockPrivacy(spec: ActionSpec, feature: String?, passwordSet: Boolean): Boolean = false
    override suspend fun sessionExpired() = Unit
}

internal fun testRunner(prompter: ActionPrompter): ActionRunner = ActionRunner(prompter, clock = { NIGHT_NOW })

/** The French wording of the resources, without Android (JVM ViewModel tests; checked against the resources elsewhere). */
internal object TestWording : EnrolmentWording {
    override fun approveTitle() = "Approuver l'enrôlement"
    override fun refuseTitle() = "Refuser l'enrôlement"
    override fun bulkTitle(count: Int) = "Approuver $count appareils"
    override fun moveTitle(groupPath: String) = "Approuver et déplacer vers $groupPath"
    override fun approveConsequence() = "L'agent rejoindra la flotte ; les scénarios « Agent approuvé » de ce tenant se déclencheront."
    override fun refuseConsequence() = "L'agent sera refusé et suspendu."
    override fun bulkConsequence(count: Int) = "Les agents rejoindront la flotte."
    override fun moveConsequence(groupPath: String) = "L'agent rejoindra la flotte dans le groupe $groupPath."
    override fun count(count: Int) = "$count appareils"
    override fun scope(serverName: String?, tenantName: String) = if (serverName != null) "$serverName › $tenantName" else tenantName
    override fun unknownTenant(tenantId: Long?) = "Tenant n° $tenantId"
}

/** À traiter mapped over the §4 sample with these enrolment feeds (Obliance Prod: [items], Obliance Dev: none). */
internal fun enrolmentUi(
    items: List<PendingDevice> = listOf(KIOSK),
    base: SampleObliServices = SampleObliServices(),
    status: tools.obli.obliance.data.FeedStatus = tools.obli.obliance.data.FeedStatus.OK,
    segment: TriageSegment = TriageSegment.ENROLMENTS,
): TriageUi {
    val ok = tools.obli.obliance.data.FeedStatus.OK
    val state = EnrolmentsState(
        listOf(
            ServerEnrolments(SampleData.PROD, status, canApprove = true, sessionTenantId = SampleData.DEFAULT_TENANT, items = items, keys = SampleEnrolmentsSource.KEYS.associateBy { it.id }, updatedAt = NIGHT_NOW),
            ServerEnrolments(SampleData.DEV, ok, canApprove = true, sessionTenantId = SampleData.DEFAULT_TENANT, updatedAt = NIGHT_NOW),
        ),
    )
    val devices = SampleData.devices.associateBy { DeviceRef(SampleData.PROD, it.id) }
    return TriageMapper.map(
        base.alerts.snapshot.value, base.registry.state.value, base.tenants.scope.value, true, true,
        LocalState(segment = segment), devices, NIGHT_NOW, state,
    )
}
