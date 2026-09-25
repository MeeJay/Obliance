package tools.obli.obliance.automations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import tools.obli.core.realtime.ConnectionState
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.obliance.api.Approval
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.actionEndpoints

internal data class ActivityUiState(
    val serverId: ServerId? = null,
    val tenantId: Long? = null,
    val tenantName: String? = null,
    val loading: Boolean = true,
    /** Failure of the batch list (the main content). */
    val problem: ApiOutcome<Nothing>? = null,
    val batches: List<BatchSummary> = emptyList(),
    val schedules: List<ScheduleDto>? = null,
    val scenarios: List<ScenarioDto>? = null,
    val scenarioTotal: Int = 0,
    val scriptCount: Int? = null,
    /** Script names by id (approval requests only carry the id). */
    val scriptNames: Map<Long, String> = emptyMap(),
    /** My two-person requests (platform admins only; null = not available). */
    val approvals: List<Approval>? = null,
    val meId: Long? = null,
    val meNames: Set<String> = emptySet(),
    val mineOnly: Boolean = true,
    val updatedAt: Long? = null,
    val cancelling: Set<Long> = emptySet(),
) {
    val inFlight: List<BatchSummary> get() = batches.filter { it.inFlight }

    fun isMine(b: BatchSummary): Boolean = b.triggeredBy == "manual" && b.triggeredByUsername != null && b.triggeredByUsername in meNames

    val history: List<BatchSummary> get() = batches.filter { !it.inFlight && (!mineOnly || isMine(it)) }

    /** Up to 3 scripts I ran recently (chips of the Scripts entry). */
    val recentScripts: List<Pair<Long, String>>
        get() = batches.filter { it.scheduleId == null && (isMine(it) || meNames.isEmpty()) }
            .distinctBy { it.scriptId }.take(3).map { it.scriptId to it.scriptName }

    /**
     * A manual script run waiting for approval (`payload.params.source ==
     * 'script_execute'`, script.routes.ts): its script id and device count.
     */
    fun scriptRunOf(a: Approval): Pair<String, Int>? {
        val payload = a.payload as? kotlinx.serialization.json.JsonObject ?: return null
        val params = payload["params"] as? kotlinx.serialization.json.JsonObject ?: return null
        if ((params["source"] as? kotlinx.serialization.json.JsonPrimitive)?.content != "script_execute") return null
        val id = (params["scriptId"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: return null
        val name = scriptNames[id] ?: return null
        return name to a.deviceIds.size
    }

    val activeSchedules: List<ScheduleDto> get() = schedules.orEmpty().filter { it.enabled }.sortedBy { Fmt.epoch(it.nextRunAt) ?: Long.MAX_VALUE }

    /** Last batch of a schedule among the loaded ones ("dernier 5 ✓ 1 ✗"). */
    fun lastRunOf(scheduleId: Long): BatchSummary? = batches.firstOrNull { it.scheduleId == scheduleId }

    val topScenarios: List<ScenarioDto>
        get() = scenarios.orEmpty().filter { it.status == "active" }.sortedWith(compareByDescending<ScenarioDto> { it.activeRunCount }.thenBy { it.name.lowercase() }).take(2)
}

/**
 * S55 Activité of the ACTIVE server: batches in flight and recent
 * (`GET /api/executions/batches`), my approval requests (`GET /api/approvals`,
 * requester = me), schedules and scenarios. Reloads on server, tenant and
 * sign-in changes; `EXECUTION_UPDATED` and `APPROVAL_*` refresh it while
 * [follow] runs.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class ActivityViewModel(
    private val services: ObliServices,
    private val remote: AutomationsRemote,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pollMs: Long = POLL_MS,
    private val eventDebounceMs: Long = EVENT_DEBOUNCE_MS,
) : ViewModel() {
    private val facts = ServerFacts(services)
    private val _state = MutableStateFlow(ActivityUiState())
    val state: StateFlow<ActivityUiState> = _state.asStateFlow()
    private var loadJob: Job? = null
    private var eventJob: Job? = null

    /** The active server's socket is connected (freshness « En direct »). */
    val live: StateFlow<Boolean> = services.sessions.active
        .flatMapLatest { s -> s?.realtime?.state?.map { it == ConnectionState.CONNECTED } ?: flowOf(false) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    private data class Ctx(val serverId: ServerId?, val tenantId: Long?, val tenantName: String?, val signedIn: Boolean)

    init {
        viewModelScope.launch {
            combine(
                services.sessions.active.flatMapLatest { s -> s?.auth?.map { a -> s.id to (a is AuthState.SignedIn) } ?: flowOf(null to false) },
                services.tenants.scope,
            ) { (id, signedIn), scope -> Ctx(id, if (scope.serverId == id) scope.currentTenantId else null, if (scope.serverId == id) scope.current?.name else null, signedIn) }
                .distinctUntilChanged()
                .collect { ctx ->
                    val id = ctx.serverId
                    val me = id?.let { facts.me(it) }
                    _state.update {
                        if (it.serverId == id && it.tenantId == ctx.tenantId) it
                        else ActivityUiState(serverId = id, tenantId = ctx.tenantId, mineOnly = it.mineOnly)
                    }
                    _state.update { it.copy(tenantName = ctx.tenantName, meId = me?.id, meNames = setOfNotNull(me?.label, me?.username)) }
                    if (id != null && ctx.signedIn) reload(full = true)
                }
        }
    }

    fun refresh() = reload(full = true)

    fun setMineOnly(mine: Boolean) = _state.update { it.copy(mineOnly = mine) }

    private fun reload(full: Boolean) {
        val id = _state.value.serverId ?: return
        loadJob?.cancel()
        loadJob = viewModelScope.launch { load(id, full) }
    }

    private suspend fun load(id: ServerId, full: Boolean) = coroutineScope {
        val admin = facts.me(id)?.isPlatformAdmin == true
        val batches = async { remote.batches(id, 1, PAGE) }
        val approvals = if (admin) async { remote.approvals(id) } else null
        val rest = if (full) {
            Triple(async { remote.schedules(id) }, async { remote.scenarios(id) }, async { remote.scripts(id) })
        } else {
            null
        }
        val b = batches.await()
        val a = approvals?.await()
        val meId = facts.me(id)?.id
        val now = clock()
        _state.update { s ->
            if (s.serverId != id) return@update s
            var n = s.copy(loading = false)
            n = when (b) {
                is ApiOutcome.Ok -> n.copy(batches = b.value.items, problem = null, updatedAt = now)
                else -> n.copy(problem = b.asFailure())
            }
            n = n.copy(approvals = if (a == null) null else a.valueOrNull?.let { list -> mine(list, meId, now) } ?: n.approvals)
            n
        }
        if (rest != null) {
            val (sch, scn, scr) = rest
            val schedules = sch.await()
            val scenarios = scn.await()
            val scripts = scr.await()
            _state.update { s ->
                if (s.serverId != id) return@update s
                s.copy(
                    schedules = schedules.valueOrNull ?: s.schedules,
                    scenarios = scenarios.valueOrNull?.items ?: s.scenarios,
                    scenarioTotal = scenarios.valueOrNull?.total ?: s.scenarioTotal,
                    scriptCount = scripts.valueOrNull?.size ?: s.scriptCount,
                    scriptNames = scripts.valueOrNull?.associate { it.id to it.name } ?: s.scriptNames,
                )
            }
        }
    }

    /** Requests I made: pending ones, and those resolved in the last 24 h. */
    private fun mine(list: List<Approval>, meId: Long?, now: Long): List<Approval> =
        list.filter { a -> meId != null && a.requestedBy == meId }
            .filter { a -> a.isPending || (Fmt.epoch(a.reviewedAt ?: a.createdAt)?.let { now - it < DAY_MS } ?: false) }
            .sortedWith(compareByDescending<Approval> { it.isPending }.thenByDescending { Fmt.epoch(it.createdAt) ?: 0 })

    /** While visible: events of the active server's socket, and a refresh every [pollMs]. */
    suspend fun follow() = coroutineScope {
        launch {
            services.sessions.active.flatMapLatest { s ->
                if (s == null) flowOf() else facts.events(s.id, AutoEvents.EXECUTION_UPDATED, AutoEvents.APPROVAL_CREATED, AutoEvents.APPROVAL_UPDATED)
            }.collect {
                eventJob?.cancel()
                eventJob = launch {
                    delay(eventDebounceMs)
                    reload(full = false)
                }
            }
        }
        while (true) {
            delay(pollMs)
            reload(full = false)
        }
    }

    /** "Annuler la demande" of my own pending request (`POST /api/approvals/:id/cancel`), T1. */
    suspend fun cancelApproval(a: Approval, runner: ActionRunner, title: String, consequence: String): ActionResult<Unit> {
        val id = _state.value.serverId ?: return ActionResult.Cancelled
        val session = services.sessions.session(id) ?: return ActionResult.Cancelled
        val endpoints = session.actionEndpoints()
        val spec = ActionSpec(
            key = "approval.cancel",
            tier = Tier.T1,
            title = title,
            target = a.description,
            scope = facts.scope(id, null),
            consequence = consequence,
        )
        _state.update { it.copy(cancelling = it.cancelling + a.id) }
        val result = try {
            runner.run(spec) { endpoints.cancelApproval(a.id) }
        } finally {
            _state.update { it.copy(cancelling = it.cancelling - a.id) }
        }
        if (result is ActionResult.Done) reload(full = false)
        return result
    }

    companion object {
        const val PAGE = 20
        const val POLL_MS = 30_000L
        const val EVENT_DEBOUNCE_MS = 1_500L
        private const val DAY_MS = 24 * 3600 * 1000L
    }
}
