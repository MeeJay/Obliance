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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
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

    /** An enrolment action ended (approved, refused, not applied, refused by the server...). */
    data class Enrolment(val outcome: EnrolmentOutcome) : TriageEvent

    /** A [TriageRequest] named an item that did not show up in time ("no longer pending"). */
    data class RequestGone(val enrolment: Boolean) : TriageEvent
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
    /** Enrolments of every server (the screen passes the real one; None = no segment). */
    enrolmentsSource: EnrolmentsSource = EnrolmentsSource.None,
    private val enrolmentPollMs: Long = ENROLMENT_POLL_MS,
    /** How long a [TriageRequest] waits for its item to show up. */
    private val requestWaitMs: Long = REQUEST_WAIT_MS,
) : ViewModel() {
    private val enrolFeed = EnrolmentsFeed(services, enrolmentsSource, clock)
    private val enrolActions = EnrolmentActions(services, enrolFeed)

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
        combine(devices, enrolFeed.state, ::Pair),
    ) { (snapshot, registry, scope), admin, live, l, (devs, enrol) ->
        TriageMapper.map(snapshot, registry, scope, admin, live, l, devs, clock(), enrol).also { ui ->
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
        if (enrolFeed.enabled) {
            // Every included server: reloaded when its session or tenant changes, then every 60 s.
            launch {
                enrolFeed.serverKeys().collectLatest {
                    enrolFeed.refreshAll()
                    while (enrolFeed.source.polls) {
                        delay(enrolmentPollMs)
                        enrolFeed.refreshAll()
                    }
                }
            }
            // DEVICE_APPROVED / DELETED / UPDATED of the active server (a new agent, a device handled elsewhere).
            launch {
                services.devices.signals()
                    .mapNotNull { signal -> services.registry.state.value.activeId?.takeIf { enrolFeed.onSignal(it, signal) } }
                    .collectLatest { id ->
                        delay(SIGNAL_DEBOUNCE_MS)
                        enrolFeed.refresh(id)
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
        if (enrolFeed.enabled) viewModelScope.launch { enrolFeed.refreshAll(user = true) }
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

    // --- Enrolments (segment Enrôlements + S12) ----------------------------------

    private val _enrolReview = MutableStateFlow<EnrolmentReviewState?>(null)
    val enrolReview: StateFlow<EnrolmentReviewState?> = _enrolReview.asStateFlow()

    /** S12 over À traiter; its groups load at once (key's group path, « Approuver et déplacer vers… »). */
    fun openEnrolment(item: EnrolmentItemUi) {
        _enrolReview.value = EnrolmentReviewState(item)
        loadGroups(item)
    }

    private fun loadGroups(item: EnrolmentItemUi) {
        viewModelScope.launch {
            // Read-only, on the device's OWN server.
            val out = enrolFeed.source.groups(item.key.serverId)
            val load = if (out is ApiOutcome.Ok) GroupsLoad.Loaded(out.value) else GroupsLoad.Failed
            _enrolReview.update { r -> if (r?.key == item.key) r.copy(groups = load) else r }
        }
    }

    fun enrolmentStep(step: EnrolmentStep) {
        val r = _enrolReview.value ?: return
        _enrolReview.value = r.copy(step = step, problem = null)
        if (step == EnrolmentStep.PICK_GROUP && r.groups == GroupsLoad.Failed) {
            _enrolReview.update { it?.copy(groups = GroupsLoad.Loading) }
            loadGroups(r.item)
        }
    }

    fun closeEnrolment() {
        _enrolReview.value = null
    }

    fun approveEnrolment(item: EnrolmentItemUi, runner: ActionRunner, wording: EnrolmentWording) =
        enrolmentAction(item.key) { enrolActions.approve(item, runner, wording) }

    fun refuseEnrolment(item: EnrolmentItemUi, runner: ActionRunner, wording: EnrolmentWording) =
        enrolmentAction(item.key) { enrolActions.refuse(item, runner, wording) }

    fun approveAndMove(item: EnrolmentItemUi, group: GroupChoice, runner: ActionRunner, wording: EnrolmentWording) =
        enrolmentAction(item.key) { enrolActions.approveAndMove(item, group, runner, wording) }

    /** « Tout approuver (n) » of one « Serveur › Tenant » section (it reloads its server itself). */
    fun approveAllEnrolments(group: EnrolmentGroupUi, runner: ActionRunner, wording: EnrolmentWording) {
        viewModelScope.launch {
            enrolActions.approveAll(group, runner, wording)?.let { eventChannel.trySend(TriageEvent.Enrolment(it)) }
        }
    }

    /**
     * Runs one enrolment action; its outcome goes to S12 when it was sent from
     * there and did not succeed (the screen snackbar is hidden behind the
     * sheet), else to a snackbar. The item's server is reloaded afterwards.
     */
    private fun enrolmentAction(key: EnrolmentKey, block: suspend () -> EnrolmentOutcome?) {
        viewModelScope.launch {
            val fromSheet = _enrolReview.value?.key == key
            if (fromSheet) _enrolReview.update { it?.copy(problem = null) }
            val outcome = block() ?: return@launch
            when {
                outcome.succeeded -> {
                    if (_enrolReview.value?.key == key) _enrolReview.value = null
                    eventChannel.trySend(TriageEvent.Enrolment(outcome))
                }
                fromSheet && _enrolReview.value?.key == key ->
                    _enrolReview.update { it?.copy(problem = outcome, step = EnrolmentStep.DETAILS) }
                else -> eventChannel.trySend(TriageEvent.Enrolment(outcome))
            }
            enrolFeed.refresh(key.serverId)
        }
    }

    // --- Requests from outside (notification taps) --------------------------------

    private var lastRequest: TriageRequest? = null
    private var requestJob: Job? = null

    /**
     * Handles [request] once: the segment (and server chip) at once, then the
     * review sheet of its item as soon as the feed contains it ([requestWaitMs]
     * at most). Returns false when this very request was already handled (the
     * screen then does not report it again).
     */
    fun handle(request: TriageRequest): Boolean {
        if (request === lastRequest) return false
        lastRequest = request
        requestJob?.cancel()
        when (request) {
            is TriageRequest.Alerts -> local.update { it.copy(segment = TriageSegment.ALERTS, serverFilter = request.serverId) }
            is TriageRequest.Approval -> {
                local.update { it.copy(segment = TriageSegment.APPROVALS, serverFilter = it.serverFilter?.takeIf { f -> f == request.serverId }) }
                requestJob = viewModelScope.launch {
                    launch { services.alerts.refresh() }
                    val match = { u: TriageUi ->
                        u.allEscalations.firstOrNull { it.item.serverId == request.serverId && it.item.approval.id == request.approvalId }
                    }
                    val found = withTimeoutOrNull(requestWaitMs) { ui.first { match(it) != null } }?.let(match)
                    if (found != null) openReview(found) else eventChannel.trySend(TriageEvent.RequestGone(enrolment = false))
                }
            }
            is TriageRequest.Enrolments -> {
                local.update { it.copy(segment = TriageSegment.ENROLMENTS, serverFilter = request.serverId) }
                if (enrolFeed.enabled) {
                    requestJob = viewModelScope.launch {
                        val id = request.serverId
                        if (id != null) enrolFeed.refresh(id) else enrolFeed.refreshAll()
                    }
                }
            }
            is TriageRequest.Approvals -> {
                local.update { it.copy(segment = TriageSegment.APPROVALS, serverFilter = request.serverId) }
                requestJob = viewModelScope.launch { services.alerts.refresh() }
            }
            is TriageRequest.Enrolment -> {
                local.update { it.copy(segment = TriageSegment.ENROLMENTS, serverFilter = it.serverFilter?.takeIf { f -> f == request.serverId }) }
                val key = EnrolmentKey(request.serverId, request.deviceId)
                requestJob = viewModelScope.launch {
                    if (enrolFeed.enabled) launch { enrolFeed.refresh(request.serverId) }
                    val found = withTimeoutOrNull(requestWaitMs) { ui.first { it.enrolment(key) != null } }?.enrolment(key)
                    if (found != null) openEnrolment(found) else eventChannel.trySend(TriageEvent.RequestGone(enrolment = true))
                }
            }
        }
        return true
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

        /** Enrolments are polled every 60 s while the screen is started (design doc S10). */
        const val ENROLMENT_POLL_MS = 60_000L

        /** A notification's item may reach the feed a little after the tap. */
        const val REQUEST_WAIT_MS = 10_000L

        /** Device signals come in bursts (a registration also updates the device). */
        const val SIGNAL_DEBOUNCE_MS = 1_000L

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
