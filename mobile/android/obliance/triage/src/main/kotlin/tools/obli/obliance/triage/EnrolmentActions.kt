package tools.obli.obliance.triage

import android.content.res.Resources
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Preflight
import tools.obli.core.security.Tier
import tools.obli.obliance.data.ObliServices

/** The words of the enrolment confirmations (S41 T1), from the resources in the app, plain in unit tests. */
internal interface EnrolmentWording {
    fun approveTitle(): String
    fun refuseTitle(): String
    fun bulkTitle(count: Int): String
    fun moveTitle(groupPath: String): String
    fun approveConsequence(): String
    fun refuseConsequence(): String
    fun bulkConsequence(count: Int): String
    fun moveConsequence(groupPath: String): String

    /** Target of a bulk action: « 3 appareils ». */
    fun count(count: Int): String

    /** « Obliance Prod › ACME » ([serverName] only with two servers or more), or the tenant alone. */
    fun scope(serverName: String?, tenantName: String): String

    /** A tenant whose name is not known here. */
    fun unknownTenant(tenantId: Long?): String
}

internal class ResourceEnrolmentWording(private val res: Resources) : EnrolmentWording {
    override fun approveTitle() = res.getString(R.string.triage_enrol_spec_approve)
    override fun refuseTitle() = res.getString(R.string.triage_enrol_spec_refuse)
    override fun bulkTitle(count: Int) = res.getQuantityString(R.plurals.triage_enrol_spec_bulk, count, count)
    override fun moveTitle(groupPath: String) = res.getString(R.string.triage_enrol_spec_move, groupPath)
    override fun approveConsequence() = res.getString(R.string.triage_enrol_consequence_approve)
    override fun refuseConsequence() = res.getString(R.string.triage_enrol_consequence_refuse)
    // « Tout approuver » needs two devices or more: one plural sentence.
    override fun bulkConsequence(count: Int) = res.getString(R.string.triage_enrol_consequence_bulk)
    override fun moveConsequence(groupPath: String) = res.getString(R.string.triage_enrol_consequence_move, groupPath)
    override fun count(count: Int) = res.getQuantityString(R.plurals.triage_enrol_count, count, count)
    override fun scope(serverName: String?, tenantName: String) =
        if (serverName != null) res.getString(R.string.triage_scope_server_tenant, serverName, tenantName) else tenantName
    override fun unknownTenant(tenantId: Long?) =
        if (tenantId != null) res.getString(R.string.triage_enrol_tenant_unknown, tenantId) else res.getString(R.string.triage_enrol_tenant_none)
}

/**
 * Approve / refuse / bulk / approve-and-move (design doc §5 S10, S12, §7.6
 * T1), always on the ITEM'S server (§2.10 item 4: no server switch). Each call
 * runs through [ActionRunner]: the SESSION tenant of that server must be the
 * device's (§2.3), else « Basculer et continuer » first — from the master
 * session the server leaves a child-tenant device pending and still answers
 * 200, so a success is only what the returned device says.
 */
internal class EnrolmentActions(private val services: ObliServices, private val feed: EnrolmentsFeed) {

    private fun scopeOf(serverName: String, tenantId: Long?, tenantName: String?, wording: EnrolmentWording): String {
        val server = serverName.takeIf { services.registry.state.value.isMultiServer }
        return wording.scope(server, tenantName ?: wording.unknownTenant(tenantId))
    }

    /** The device's tenant must be the session tenant of ITS server (master included). */
    private fun preflight(serverId: ServerId, tenantId: Long?, tenantName: String): Preflight {
        tenantId ?: return Preflight.Ok
        val session = services.sessions.session(serverId) ?: return Preflight.Ok
        val current = (session.auth.value as? AuthState.SignedIn)?.probe?.currentTenantId ?: return Preflight.Ok
        if (current == tenantId) return Preflight.Ok
        return Preflight.NeedsTenantSwitch(tenantName) { services.tenants.switchTo(tenantId, serverId) is ApiOutcome.Ok }
    }

    private suspend fun <T> busy(keys: List<EnrolmentKey>, block: suspend () -> T): T {
        feed.setBusy(keys, true)
        try {
            return block()
        } finally {
            feed.setBusy(keys, false)
        }
    }

    /** Approve (T1). Null when cancelled. */
    suspend fun approve(item: EnrolmentItemUi, runner: ActionRunner, wording: EnrolmentWording): EnrolmentOutcome? =
        decide(item, approve = true, runner, wording)

    /** Refuse (T1): the agent is refused and suspended. Null when cancelled. */
    suspend fun refuse(item: EnrolmentItemUi, runner: ActionRunner, wording: EnrolmentWording): EnrolmentOutcome? =
        decide(item, approve = false, runner, wording)

    private suspend fun decide(item: EnrolmentItemUi, approve: Boolean, runner: ActionRunner, wording: EnrolmentWording): EnrolmentOutcome? {
        if (!item.actionable) return null
        val serverId = item.key.serverId
        val tenantName = item.tenantName ?: wording.unknownTenant(item.device.tenantId)
        val spec = ActionSpec(
            key = if (approve) KEY_APPROVE else KEY_REFUSE,
            tier = Tier.T1,
            title = if (approve) wording.approveTitle() else wording.refuseTitle(),
            target = item.label,
            scope = scopeOf(item.serverName, item.device.tenantId, item.tenantName, wording),
            consequence = if (approve) wording.approveConsequence() else wording.refuseConsequence(),
        )
        return busy(listOf(item.key)) {
            val result = runner.run(spec, preflight = { preflight(serverId, item.device.tenantId, tenantName) }) { extra ->
                if (approve) feed.source.approve(serverId, item.device.id, extra) else feed.source.refuse(serverId, item.device.id, extra)
            }
            val expected = if (approve) "approved" else "refused"
            when (result) {
                is ActionResult.Done -> if (result.value.device?.approvalStatus == expected) {
                    feed.remove(listOf(item.key))
                    if (approve) EnrolmentOutcome.Approved(item.label) else EnrolmentOutcome.Refused(item.label)
                } else {
                    EnrolmentOutcome.NotApplied
                }
                ActionResult.Cancelled -> null
                else -> EnrolmentOutcome.Failed(result)
            }
        }
    }

    /**
     * « Tout approuver (n) » of ONE « Serveur › Tenant » section: one
     * `POST /api/devices/bulk/approve` with exactly its ids. The route answers
     * no device state, so the list is reloaded to check nothing stayed pending.
     */
    suspend fun approveAll(group: EnrolmentGroupUi, runner: ActionRunner, wording: EnrolmentWording): EnrolmentOutcome? {
        val items = group.bulk
        if (items.size < 2) return null
        val keys = items.map { it.key }
        val ids = items.map { it.device.id }
        val n = items.size
        val tenantName = group.tenantName ?: wording.unknownTenant(group.tenantId)
        val spec = ActionSpec(
            key = KEY_BULK,
            tier = Tier.T1,
            title = wording.bulkTitle(n),
            target = wording.count(n),
            scope = scopeOf(items.first().serverName, group.tenantId, group.tenantName, wording),
            consequence = wording.bulkConsequence(n),
            targetCount = n,
        )
        return busy(keys) {
            val result = runner.run(spec, preflight = { preflight(group.serverId, group.tenantId, tenantName) }) { extra ->
                feed.source.bulkApprove(group.serverId, ids, extra)
            }
            when (result) {
                is ActionResult.Done -> {
                    val reloaded = feed.refresh(group.serverId)?.mapTo(HashSet()) { it.id }
                    val still = if (reloaded == null) emptyList() else ids.filter { it in reloaded }
                    feed.remove(keys.filter { it.deviceId !in still })
                    if (still.isEmpty()) EnrolmentOutcome.ApprovedMany(n) else EnrolmentOutcome.NotApplied
                }
                ActionResult.Cancelled -> null
                else -> EnrolmentOutcome.Failed(result)
            }
        }
    }

    /**
     * « Approuver et déplacer vers… » (S12): T1 naming the group, then the
     * approval, then `PATCH {groupId}` (which also fires the group_join
     * scenarios). The PATCH runs once, after a confirmed approval (T0: the
     * confirmation above covered it).
     */
    suspend fun approveAndMove(item: EnrolmentItemUi, group: GroupChoice, runner: ActionRunner, wording: EnrolmentWording): EnrolmentOutcome? {
        if (!item.actionable) return null
        val serverId = item.key.serverId
        val tenantName = item.tenantName ?: wording.unknownTenant(item.device.tenantId)
        val scope = scopeOf(item.serverName, item.device.tenantId, item.tenantName, wording)
        val spec = ActionSpec(KEY_APPROVE_MOVE, Tier.T1, wording.moveTitle(group.path), item.label, scope, wording.moveConsequence(group.path))
        return busy(listOf(item.key)) {
            val approved = runner.run(spec, preflight = { preflight(serverId, item.device.tenantId, tenantName) }) { extra ->
                feed.source.approve(serverId, item.device.id, extra)
            }
            when (approved) {
                is ActionResult.Done -> {
                    if (approved.value.device?.approvalStatus != "approved") return@busy EnrolmentOutcome.NotApplied
                    feed.remove(listOf(item.key))
                    val moveSpec = ActionSpec(KEY_MOVE, Tier.T0, wording.moveTitle(group.path), item.label, scope)
                    when (val moved = runner.run(moveSpec) { extra -> feed.source.move(serverId, item.device.id, group.id, extra) }) {
                        is ActionResult.Done -> if (moved.value.device?.groupId == group.id) {
                            EnrolmentOutcome.ApprovedAndMoved(item.label, group.path)
                        } else {
                            EnrolmentOutcome.ApprovedNotMoved(item.label, group.path, null)
                        }
                        else -> EnrolmentOutcome.ApprovedNotMoved(item.label, group.path, moved)
                    }
                }
                ActionResult.Cancelled -> null
                else -> EnrolmentOutcome.Failed(approved)
            }
        }
    }

    companion object {
        const val KEY_APPROVE = "enrolment.approve"
        const val KEY_REFUSE = "enrolment.refuse"
        const val KEY_BULK = "enrolment.approve_all"
        const val KEY_APPROVE_MOVE = "enrolment.approve_move"
        const val KEY_MOVE = "enrolment.move"
    }
}

/** An outcome that closes the review sheet (the device was approved or refused). */
internal val EnrolmentOutcome.succeeded: Boolean
    get() = when (this) {
        is EnrolmentOutcome.Approved, is EnrolmentOutcome.Refused, is EnrolmentOutcome.ApprovedMany,
        is EnrolmentOutcome.ApprovedAndMoved, is EnrolmentOutcome.ApprovedNotMoved,
        -> true
        EnrolmentOutcome.NotApplied, is EnrolmentOutcome.Failed -> false
    }
