package tools.obli.obliance.triage

import java.time.Instant
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.obliance.api.MASTER_TENANT_ID
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.TenantScope

/*
 * UI model of the « Enrôlements » segment of S10 and of S12 (design doc §5),
 * built by a pure function like the rest of À traiter so the grouping,
 * filtering and greyed states are unit-tested on the JVM.
 */

/** Why a card is greyed: its server's session expired, or the server did not answer (last items kept, §2.10 item 5). */
internal sealed interface EnrolmentStale {
    data object Expired : EnrolmentStale

    data class Unreachable(val since: Long?) : EnrolmentStale
}

internal data class EnrolmentItemUi(
    val key: EnrolmentKey,
    val device: PendingDevice,
    /** Server tile, only with two servers or more. */
    val server: ServerProfile?,
    /** Name of the item's server (scope lines name it only with two servers or more). */
    val serverName: String,
    val tenantName: String?,
    /** Name of the enrolment key the agent registered with (never the key itself). */
    val keyName: String?,
    val keyDefaultGroupId: Long?,
    val keyDefaultGroupName: String?,
    val createdAt: Instant?,
    val stale: EnrolmentStale?,
    val busy: Boolean,
) {
    val label: String get() = device.label

    /** Approve / refuse can be sent now (not greyed, no action in flight). */
    val actionable: Boolean get() = stale == null && !busy
}

/** One « Serveur › Tenant » section of the segment. */
internal data class EnrolmentGroupUi(
    val serverId: ServerId,
    /** Server tile and name in the header: only with two servers or more. */
    val server: ServerProfile?,
    val tenantId: Long?,
    val tenantName: String?,
    val items: List<EnrolmentItemUi>,
) {
    val serverName: String? get() = server?.displayName

    /** What « Tout approuver (n) » sends: the items that can be acted on now. */
    val bulk: List<EnrolmentItemUi> get() = items.filter { it.actionable }

    /** « Tout approuver (n) » is offered from two devices (T1). */
    val canBulk: Boolean get() = bulk.size >= 2
}

internal data class EnrolmentsUi(
    /** At least one server allows approval (§5 S10: a segment without the right is hidden). */
    val show: Boolean = false,
    val count: Int = 0,
    val groups: List<EnrolmentGroupUi> = emptyList(),
    val notices: List<FeedNotice> = emptyList(),
    val listState: ListState = ListState.EMPTY,
    val refreshing: Boolean = false,
    /** Pending devices per server (server chip menu), whatever the server filter. */
    val pendingByServer: Map<ServerId, Int> = emptyMap(),
)

internal object EnrolmentMapper {
    fun map(
        state: EnrolmentsState,
        registry: ServerRegistryState,
        scope: TenantScope,
        alerts: AlertsSnapshot,
        serverFilter: ServerId?,
    ): EnrolmentsUi {
        val multi = registry.isMultiServer
        val feeds = state.servers.associateBy { it.serverId }
        val allowed = registry.profiles.filter { it.includeInTriage }.mapNotNull { p ->
            feeds[p.id]?.takeIf { it.canApprove && it.status != FeedStatus.SIGNED_OUT && it.status != FeedStatus.EXCLUDED }?.let { p to it }
        }
        if (allowed.isEmpty()) return EnrolmentsUi(refreshing = state.refreshing)
        val shown = allowed.filter { (p, _) -> serverFilter == null || p.id == serverFilter }

        val groups = shown.flatMap { (profile, feed) ->
            val stale = when (feed.status) {
                FeedStatus.EXPIRED -> EnrolmentStale.Expired
                FeedStatus.UNREACHABLE -> EnrolmentStale.Unreachable(feed.updatedAt)
                else -> null
            }
            feed.items.groupBy { it.tenantId }.map { (tenantId, devices) ->
                val tenantName = tenantNameOf(profile.id, tenantId, devices, scope, alerts)
                val items = devices
                    .sortedWith(compareByDescending<PendingDevice> { parseInstant(it.createdAt) ?: Instant.MIN }.thenBy { it.label })
                    .map { d ->
                        val key = d.apiKeyId?.let(feed.keys::get)
                        EnrolmentItemUi(
                            key = EnrolmentKey(profile.id, d.id),
                            device = d,
                            server = if (multi) profile else null,
                            serverName = profile.displayName,
                            tenantName = tenantName,
                            keyName = key?.name?.takeIf { it.isNotBlank() },
                            keyDefaultGroupId = key?.defaultGroupId,
                            keyDefaultGroupName = key?.defaultGroupName,
                            createdAt = parseInstant(d.createdAt),
                            stale = stale,
                            busy = EnrolmentKey(profile.id, d.id) in state.busy,
                        )
                    }
                EnrolmentGroupUi(profile.id, if (multi) profile else null, tenantId, tenantName, items)
            }.sortedWith(compareBy<EnrolmentGroupUi>({ it.tenantId != MASTER_TENANT_ID }, { it.tenantName.orEmpty().lowercase() }, { it.tenantId ?: 0L }))
        }

        val notices = shown.mapNotNull { (p, feed) ->
            when (feed.status) {
                FeedStatus.EXPIRED -> FeedNotice.Expired(p)
                FeedStatus.UNREACHABLE -> FeedNotice.Unreachable(p, feed.updatedAt)
                else -> null
            }
        }
        val count = groups.sumOf { it.items.size }
        val listState = when {
            count > 0 -> ListState.CONTENT
            shown.isNotEmpty() && shown.all { (_, f) -> f.status == FeedStatus.UNREACHABLE && f.updatedAt == null } -> ListState.ERROR
            shown.isNotEmpty() && shown.all { (_, f) -> f.status == FeedStatus.LOADING } -> ListState.LOADING
            else -> ListState.EMPTY
        }
        return EnrolmentsUi(
            show = true,
            count = count,
            groups = groups,
            notices = notices,
            listState = listState,
            refreshing = state.refreshing,
            pendingByServer = allowed.associate { (p, f) -> p.id to f.items.size },
        )
    }

    /** The device's own tenant name, else the active server's tenant list, else an alert of that tenant. */
    private fun tenantNameOf(serverId: ServerId, tenantId: Long?, devices: List<PendingDevice>, scope: TenantScope, alerts: AlertsSnapshot): String? {
        devices.firstNotNullOfOrNull { it.tenantName?.takeIf(String::isNotBlank) }?.let { return it }
        tenantId ?: return null
        if (scope.serverId == serverId) scope.tenants.firstOrNull { it.id == tenantId }?.name?.let { return it }
        return alerts.alerts.firstOrNull { it.serverId == serverId && it.alert.tenantId == tenantId && !it.alert.tenantName.isNullOrBlank() }?.alert?.tenantName
    }
}

/** One group offered by « Approuver et déplacer vers… » (S12). */
internal data class GroupChoice(val id: Long, val path: String, val isKeyDefault: Boolean)

/** Groups of [tenantId] as paths, sorted; the key's default group is flagged. */
internal fun groupChoices(groups: List<GroupInfo>, tenantId: Long?, keyDefaultGroupId: Long?): List<GroupChoice> {
    val paths = GroupPaths.of(groups)
    return groups
        .filter { tenantId == null || it.tenantId == null || it.tenantId == tenantId }
        .map { GroupChoice(it.id, paths[it.id] ?: it.name, it.id == keyDefaultGroupId) }
        .sortedBy { it.path.lowercase() }
}

/** Groups of the enrolment review (S12): loading, loaded, or failed. */
internal sealed interface GroupsLoad {
    data object Loading : GroupsLoad

    data class Loaded(val groups: List<GroupInfo>) : GroupsLoad

    data object Failed : GroupsLoad
}

internal enum class EnrolmentStep { DETAILS, PICK_GROUP }

/** S12 « Examen d'enrôlement » over À traiter. [item] is the card it was opened from (the live one is preferred). */
internal data class EnrolmentReviewState(
    val item: EnrolmentItemUi,
    val step: EnrolmentStep = EnrolmentStep.DETAILS,
    val groups: GroupsLoad = GroupsLoad.Loading,
    /** Last failure of an action sent from the sheet, shown in it (the screen snackbar is behind the sheet). */
    val problem: EnrolmentOutcome? = null,
) {
    val key: EnrolmentKey get() = item.key

    /** « Clé « Site Siège » → groupe Siège › Accueil »: the default group's full path when the groups are known. */
    val keyGroupPath: String?
        get() {
            val id = item.keyDefaultGroupId ?: return null
            return (groups as? GroupsLoad.Loaded)?.let { GroupPaths.of(it.groups)[id] } ?: item.keyDefaultGroupName
        }

    val choices: List<GroupChoice>
        get() = (groups as? GroupsLoad.Loaded)?.let { groupChoices(it.groups, item.device.tenantId, item.keyDefaultGroupId) }.orEmpty()
}

/** What an enrolment action ended with (snackbar, or the sheet's problem line). Cancelled says nothing. */
internal sealed interface EnrolmentOutcome {
    data class Approved(val label: String) : EnrolmentOutcome

    data class Refused(val label: String) : EnrolmentOutcome

    data class ApprovedMany(val count: Int) : EnrolmentOutcome

    data class ApprovedAndMoved(val label: String, val groupPath: String) : EnrolmentOutcome

    /** Approved, but the group change failed ([result] says why; null = answered without the new group). */
    data class ApprovedNotMoved(val label: String, val groupPath: String, val result: tools.obli.core.security.ActionResult<*>?) : EnrolmentOutcome

    /** 200 but the device is still pending (e.g. sent from another tenant's session): never a success. */
    data object NotApplied : EnrolmentOutcome

    /** Refused by the server, blocked, expired… : ActionMessages words it (403 capability, network…). */
    data class Failed(val result: tools.obli.core.security.ActionResult<*>) : EnrolmentOutcome
}
