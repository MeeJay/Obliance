package tools.obli.obliance.triage

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.isSuccess
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.security.ActionPrompter
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Preflight
import tools.obli.core.security.Tier
import tools.obli.core.security.TwoFactorAnswer
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.ServerApproval
import tools.obli.obliance.domain.ServerAlert
import tools.obli.shell.alerts.AlertSeverity

/** One-shot messages of the screen (snackbars). */
internal sealed interface TriageEvent {
    /** "Alerte supprimée — Annuler" for [TriageViewModel.UNDO_MS]. */
    data class Deleted(val key: AlertKey) : TriageEvent

    /** A call failed; [outcome] says why (nothing was changed locally). */
    data class Failed(val action: FailedAction, val outcome: ApiOutcome<Nothing>) : TriageEvent

    data class MarkedAllRead(val servers: Int) : TriageEvent

    data class ApprovalDone(val approved: Boolean) : TriageEvent
}

internal enum class FailedAction { MARK_READ, DELETE, MARK_ALL_READ, APPROVE, DENY }

/**
 * State of the approval review sheet (S11 over À traiter). The ActionRunner
 * prompts ([ActionPrompter]) are answered from this sheet: the T2
 * confirmation names the server and the tenant, a step-up asks for the code.
 */
internal data class ReviewState(
    val item: ServerApproval,
    val ui: EscalationUi?,
    val target: Device? = null,
    val reason: String = "",
    val step: ReviewStep = ReviewStep.Details,
    val busy: Boolean = false,
    /** Last refusal of the server, shown in the sheet. */
    val problem: ReviewProblem? = null,
)

internal sealed interface ReviewStep {
    data object Details : ReviewStep

    /** Confirmation of [approve] (T2) naming target and server › tenant. */
    data class Confirm(val approve: Boolean, val spec: ActionSpec) : ReviewStep

    /** Step-up 2FA code (S42) after a `twoFactorRequired`. */
    data class TwoFactor(val wrongCode: Boolean) : ReviewStep

    /**
     * The approval belongs to another tenant than the session tenant of its
     * server (approve / deny are bound to it, §2.3): "Basculer et continuer".
     */
    data class TenantSwitch(val tenantName: String) : ReviewStep
}

internal enum class ReviewProblem { ALREADY_RESOLVED, EXPIRED, FORBIDDEN, SESSION_EXPIRED, SWITCH_FAILED, FAILED }

@OptIn(ExperimentalCoroutinesApi::class)
internal class TriageViewModel(
    private val services: ObliServices,
    private val clock: () -> Long = System::currentTimeMillis,
    private val undoDelayMs: Long = UNDO_MS,
    /** Where deletions still waiting for their undo delay are sent when the screen goes away. */
    private val detachedScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) : ViewModel() {
    private val local = MutableStateFlow(LocalState())
    private val devices = MutableStateFlow<Map<DeviceRef, Device>>(emptyMap())
    private val deleteJobs = LinkedHashMap<AlertKey, Pair<ServerAlert, Job>>()
    private val eventChannel = Channel<TriageEvent>(Channel.BUFFERED)
    val events: Flow<TriageEvent> = eventChannel.receiveAsFlow()

    private val _review = MutableStateFlow<ReviewState?>(null)
    val review: StateFlow<ReviewState?> = _review.asStateFlow()

    /** Keys of the unread list last shown (acknowledged when the user leaves the top). */
    @Volatile private var lastUnreadKeys: Set<AlertKey> = emptySet()

    /** Platform admin on at least one included, signed-in server: the Approbations segment exists. */
    private val platformAdmin: Flow<Boolean> = services.registry.state
        .map { reg -> reg.profiles.filter { it.includeInTriage }.map { it.id } }
        .distinctUntilChanged()
        .flatMapLatest { ids ->
            val flows = ids.mapNotNull { services.sessions.session(it)?.auth }
            if (flows.isEmpty()) {
                flowOf(false)
            } else {
                combine(flows) { states -> states.any { (it as? AuthState.SignedIn)?.probe?.user?.isPlatformAdmin == true } }
            }
        }

    private val realtimeConnected: Flow<Boolean> = services.sessions.active
        .flatMapLatest { s -> s?.realtime?.state?.map { it == ConnectionState.CONNECTED } ?: flowOf(false) }

    private val core: Flow<TriageUi> = combine(
        combine(services.alerts.snapshot, services.registry.state, services.tenants.scope, ::Triple),
        platformAdmin,
        realtimeConnected,
        local,
        devices,
    ) { (snapshot, registry, scope), admin, live, l, devs ->
        TriageMapper.map(snapshot, registry, scope, admin, live, l, devs, clock()).also { ui ->
            lastUnreadKeys = ui.unread.map { it.key }.toSet()
        }
    }

    /** Everything (snapshot polling, device states, device signals) runs only while the UI collects. */
    val ui: StateFlow<TriageUi> = channelFlow {
        launch {
            combine(services.alerts.snapshot, services.registry.state, services.tenants.scope) { snapshot, registry, scope ->
                TriageMapper.liveDevices(snapshot, registry, scope) to snapshot.updatedAt
            }.distinctUntilChanged().collectLatest { (refs, _) -> loadDevices(refs) }
        }
        launch {
            services.devices.signals().collect { signal ->
                val active = services.registry.state.value.activeId ?: return@collect
                val ref = DeviceRef(active, signal.deviceId)
                devices.update { map ->
                    val known = map[ref] ?: return@update map
                    when {
                        signal.event == ObliEvents.DEVICE_DELETED -> map - ref
                        signal.status != null && signal.status != DeviceStatus.UNKNOWN -> map + (ref to known.copy(status = signal.status!!.wire))
                        else -> map
                    }
                }
            }
        }
        core.collect { send(it) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TriageUi())

    private suspend fun loadDevices(refs: List<DeviceRef>) {
        val loaded = HashMap<DeviceRef, Device>()
        for (ref in refs) {
            val out = services.devices.detail(ref.serverId, ref.deviceId)
            if (out is ApiOutcome.Ok) loaded[ref] = out.value
        }
        // Keep what could not be reloaded this time (last known state beats nothing).
        devices.update { old -> old.filterKeys { it in refs } + loaded }
    }

    // --- Filters and sections ---------------------------------------------------

    fun selectSegment(segment: TriageSegment) = local.update { it.copy(segment = segment) }

    fun selectServer(serverId: ServerId?) = local.update { it.copy(serverFilter = serverId) }

    fun toggleSeverity(severity: AlertSeverity) = local.update {
        it.copy(severities = if (severity in it.severities) it.severities - severity else it.severities + severity)
    }

    fun clearSeverities() = local.update { it.copy(severities = emptySet()) }

    fun toggleRead() = local.update { it.copy(readExpanded = !it.readExpanded) }

    /** The list reports whether it shows its first item; leaving the top freezes what was shown (§7.4). */
    fun setAtTop(atTop: Boolean) = local.update { l ->
        when {
            l.atTop == atTop -> l
            atTop -> l.copy(atTop = true, acknowledged = null)
            else -> l.copy(atTop = false, acknowledged = lastUnreadKeys)
        }
    }

    /** Pill "N nouvelles alertes": show them (the screen scrolls to the top). */
    fun showHeldBack() = local.update { it.copy(atTop = true, acknowledged = null) }

    // --- Inbox actions: always on the alert's OWN server, never a switch (§2.10 item 4) ---

    fun refresh() {
        viewModelScope.launch { services.alerts.refresh() }
    }

    fun markRead(item: IncidentUi) {
        if (!item.unread) return
        viewModelScope.launch {
            val out = services.alerts.markRead(item.alert)
            if (!out.isSuccess) eventChannel.trySend(TriageEvent.Failed(FailedAction.MARK_READ, out.failure()))
        }
    }

    /** Swipe left: hidden now, `DELETE` after the undo delay (design doc §5 S10, §7.2). */
    fun delete(item: IncidentUi) {
        val key = item.key
        if (key in deleteJobs) return
        local.update { it.copy(pendingDeletes = it.pendingDeletes + key) }
        val job = viewModelScope.launch {
            delay(undoDelayMs)
            commitDelete(key)
        }
        deleteJobs[key] = item.alert to job
        eventChannel.trySend(TriageEvent.Deleted(key))
    }

    fun undoDelete(key: AlertKey) {
        val (_, job) = deleteJobs.remove(key) ?: return
        job.cancel()
        local.update { it.copy(pendingDeletes = it.pendingDeletes - key) }
    }

    private suspend fun commitDelete(key: AlertKey) {
        val (alert, _) = deleteJobs.remove(key) ?: return
        val out = services.alerts.delete(alert)
        local.update { it.copy(pendingDeletes = it.pendingDeletes - key) }
        if (!out.isSuccess) eventChannel.trySend(TriageEvent.Failed(FailedAction.DELETE, out.failure()))
    }

    /** "Tout marquer comme lu": one call per server shown (each acts on its SESSION tenant). */
    fun markAllRead(servers: List<ServerId>) {
        if (servers.isEmpty()) return
        viewModelScope.launch {
            var failure: ApiOutcome<Nothing>? = null
            for (id in servers) {
                val out = services.alerts.markAllRead(id)
                if (!out.isSuccess) failure = out.failure()
            }
            eventChannel.trySend(failure?.let { TriageEvent.Failed(FailedAction.MARK_ALL_READ, it) } ?: TriageEvent.MarkedAllRead(servers.size))
        }
    }

    /** "Se reconnecter" on a server whose session expired: make it active, the app then shows S03. */
    fun reconnect(serverId: ServerId) {
        viewModelScope.launch { services.openOn(serverId) }
    }

    // --- Approvals (S11 over À traiter) ------------------------------------------

    private var pendingConfirm: CompletableDeferred<Boolean>? = null
    private var pendingCode: CompletableDeferred<TwoFactorAnswer?>? = null
    private var reviewJob: Job? = null

    private val prompter = object : ActionPrompter {
        override suspend fun confirmTenantSwitch(spec: ActionSpec, tenantName: String): Boolean {
            val deferred = CompletableDeferred<Boolean>().also { pendingConfirm = it }
            _review.update { it?.copy(step = ReviewStep.TenantSwitch(tenantName), busy = false) }
            val ok = deferred.await()
            _review.update { it?.copy(step = ReviewStep.Details, busy = ok) }
            return ok
        }

        override suspend fun confirm(spec: ActionSpec): Boolean {
            val deferred = CompletableDeferred<Boolean>().also { pendingConfirm = it }
            val approve = spec.key == KEY_APPROVE
            _review.update { it?.copy(step = ReviewStep.Confirm(approve, spec), busy = false) }
            val ok = deferred.await()
            _review.update { it?.copy(step = ReviewStep.Details, busy = ok) }
            return ok
        }

        override suspend fun askTwoFactor(spec: ActionSpec, currentIp: String?, previousWasWrong: Boolean): TwoFactorAnswer? {
            val deferred = CompletableDeferred<TwoFactorAnswer?>().also { pendingCode = it }
            _review.update { it?.copy(step = ReviewStep.TwoFactor(previousWasWrong), busy = false) }
            val answer = deferred.await()
            _review.update { it?.copy(step = ReviewStep.Details, busy = answer != null) }
            return answer
        }

        override suspend fun approvalRequested(spec: ActionSpec, approvalId: Long) = Unit

        override suspend fun unlockPrivacy(spec: ActionSpec, feature: String?, passwordSet: Boolean): Boolean = false

        // The application shows S03 for the active server; the sheet says it calmly.
        override suspend fun sessionExpired() = Unit
    }

    private val runner = ActionRunner(prompter, clock)

    fun openReview(ui: EscalationUi) {
        _review.value = ReviewState(ui.item, ui)
        val deviceId = ui.item.approval.deviceIds.firstOrNull() ?: return
        viewModelScope.launch {
            // Read-only, on the approval's OWN server.
            val out = services.devices.detail(ui.item.serverId, deviceId)
            if (out is ApiOutcome.Ok) _review.update { r -> if (r?.item == ui.item) r.copy(target = out.value) else r }
        }
    }

    fun closeReview() {
        reviewJob?.cancel()
        pendingConfirm?.complete(false)
        pendingCode?.complete(null)
        _review.value = null
    }

    fun setReason(reason: String) = _review.update { it?.copy(reason = reason.take(MAX_REASON)) }

    fun answerConfirm(ok: Boolean) {
        pendingConfirm?.complete(ok)
    }

    fun answerCode(code: String?) {
        pendingCode?.complete(code?.let { TwoFactorAnswer(it, trustIp = false) })
    }

    /** Approve (T2) or deny (reason required) on the approval's server, through ActionRunner. */
    fun decide(approve: Boolean, spec: ActionSpec) {
        val state = _review.value ?: return
        if (state.busy) return
        val reason = state.reason.trim().takeIf { it.isNotEmpty() }
        if (!approve && reason == null) return
        _review.update { it?.copy(busy = true, problem = null) }
        reviewJob = viewModelScope.launch {
            val result = runner.run(spec, preflight = { tenantPreflight(state) }) { extra ->
                val x = extra.takeIf { it.isNotEmpty() }
                if (approve) services.alerts.approve(state.item, reason, x) else services.alerts.deny(state.item, reason, x)
            }
            when (result) {
                is ActionResult.Done -> {
                    _review.value = null
                    eventChannel.trySend(TriageEvent.ApprovalDone(approve))
                }
                ActionResult.Cancelled -> _review.update { it?.copy(busy = false, step = ReviewStep.Details) }
                ActionResult.SessionExpired -> _review.update { it?.copy(busy = false, step = ReviewStep.Details, problem = ReviewProblem.SESSION_EXPIRED) }
                is ActionResult.Failed -> _review.update { it?.copy(busy = false, step = ReviewStep.Details, problem = problemOf(result.outcome)) }
                is ActionResult.Blocked ->
                    _review.update { it?.copy(busy = false, step = ReviewStep.Details, problem = ReviewProblem.SWITCH_FAILED) }
                is ActionResult.AwaitingApproval ->
                    _review.update { it?.copy(busy = false, step = ReviewStep.Details, problem = ReviewProblem.FAILED) }
            }
        }
    }

    /**
     * Approve / deny look the request up in the SESSION tenant of its server
     * (approval.service.ts), while the master tenant lists every tenant's
     * requests: a request of another tenant needs a switch of THAT server first.
     */
    private fun tenantPreflight(state: ReviewState): Preflight {
        val item = state.item
        val target = item.approval.tenantId ?: return Preflight.Ok
        val session = services.sessions.session(item.serverId) ?: return Preflight.Ok
        val current = (session.auth.value as? AuthState.SignedIn)?.probe?.currentTenantId ?: return Preflight.Ok
        if (current == target) return Preflight.Ok
        val name = state.ui?.tenantName ?: tenantNameOf(item.serverId, target) ?: "#$target"
        return Preflight.NeedsTenantSwitch(name) { services.tenants.switchTo(target, item.serverId).isSuccess }
    }

    /** Name of a tenant of [serverId]: the scope list of the active server, else an alert of that tenant. */
    private fun tenantNameOf(serverId: ServerId, tenantId: Long): String? {
        val scope = services.tenants.scope.value
        if (scope.serverId == serverId) scope.tenants.firstOrNull { it.id == tenantId }?.name?.let { return it }
        return services.alerts.snapshot.value.alerts
            .firstOrNull { it.serverId == serverId && it.alert.tenantId == tenantId && !it.alert.tenantName.isNullOrBlank() }
            ?.alert?.tenantName
    }

    override fun onCleared() {
        // Deletions still in their undo window were confirmed by leaving: send them.
        val waiting = deleteJobs.values.map { it.first }
        deleteJobs.clear()
        pendingConfirm?.complete(false)
        pendingCode?.complete(null)
        if (waiting.isNotEmpty()) detachedScope.launch { waiting.forEach { services.alerts.delete(it) } }
    }

    companion object {
        const val UNDO_MS = 5_000L
        const val MAX_REASON = 500
        const val KEY_APPROVE = "approval.approve"
        const val KEY_DENY = "approval.deny"

        fun problemOf(outcome: ApiOutcome<Nothing>): ReviewProblem = when {
            outcome is ApiOutcome.Unsupported -> ReviewProblem.ALREADY_RESOLVED
            outcome is ApiOutcome.Failure && outcome.status == 410 -> ReviewProblem.EXPIRED
            outcome is ApiOutcome.Forbidden -> ReviewProblem.FORBIDDEN
            outcome == ApiOutcome.SessionExpired -> ReviewProblem.SESSION_EXPIRED
            else -> ReviewProblem.FAILED
        }

        /** Tier of each decision: approving executes a restricted action (T2); denying is T1. */
        fun tierOf(approve: Boolean): Tier = if (approve) Tier.T2 else Tier.T1
    }
}

@Suppress("UNCHECKED_CAST")
private fun ApiOutcome<*>.failure(): ApiOutcome<Nothing> = this as? ApiOutcome<Nothing> ?: ApiOutcome.Failure(null, tools.obli.core.network.FailureKind.CLIENT)
