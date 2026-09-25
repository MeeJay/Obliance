package tools.obli.obliance.automations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Preflight
import tools.obli.core.security.Tier
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.data.ObliServices

internal data class ScenariosUiState(
    val serverId: ServerId?,
    val loading: Boolean = true,
    val problem: ApiOutcome<Nothing>? = null,
    val scenarios: List<ScenarioDto> = emptyList(),
    val total: Int = 0,
    val sessionTenantId: Long? = null,
    /** Scenario whose runs are open. */
    val openScenario: Long? = null,
    val runs: List<ScenarioRunDto>? = null,
    val runsProblem: ApiOutcome<Nothing>? = null,
    /** Run whose node timeline is open. */
    val openRun: ScenarioRunDto? = null,
    val runProblem: ApiOutcome<Nothing>? = null,
    val busy: Set<Long> = emptySet(),
) {
    val scenario: ScenarioDto? get() = scenarios.firstOrNull { it.id == openScenario }

    /** Scenario shared by the master and seen from a child tenant: read-only (§5 S57/S58). */
    fun readOnly(s: ScenarioDto): Boolean = s.tenantId != null && sessionTenantId != null && s.tenantId != sessionTenantId && sessionTenantId != MASTER_TENANT

    /** The server lists 50 scenarios at most (§5 S58 "Limite serveur"). */
    val truncated: Boolean get() = total > scenarios.size
}

/** Texts of the scenario confirmations, resolved by the screen. */
internal class ScenarioTexts(
    val enable: String,
    val disable: String,
    val disableConsequence: String,
    val start: String,
    val startTarget: (count: Int, single: String?) -> String,
    val startConsequence: String,
    val cancelRuns: String,
    val cancelConsequence: (count: Int) -> String,
    val notActive: (serverName: String) -> String,
)

/**
 * S58: scenarios of the ACTIVE server (`GET /api/scenarios`), the runs of one
 * (`GET /api/scenarios/:id/runs`) and a run's node timeline
 * (`GET /api/scenarios/runs/:runId`, polled every 5 s while it runs: the
 * `SCENARIO_*` events are not surfaced by the socket yet). Actions: enable /
 * disable (T1), start a manual run on chosen devices (`start-graph-run`, T2),
 * cancel the running ones (T2). Creation and edition open the web editor.
 */
internal class ScenariosViewModel(
    private val services: ObliServices,
    private val remote: AutomationsRemote,
    private val pollMs: Long = POLL_MS,
) : ViewModel() {
    private val facts = ServerFacts(services)
    val serverId: ServerId? = services.registry.state.value.activeId
    private val _state = MutableStateFlow(ScenariosUiState(serverId, sessionTenantId = serverId?.let { facts.sessionTenant(it) }))
    val state: StateFlow<ScenariosUiState> = _state.asStateFlow()
    private var runsJob: Job? = null
    private var runJob: Job? = null

    init {
        refresh()
    }

    fun refresh() {
        val id = serverId ?: return
        viewModelScope.launch {
            when (val out = remote.scenarios(id)) {
                is ApiOutcome.Ok -> _state.update { it.copy(loading = false, problem = null, scenarios = out.value.items, total = out.value.total.coerceAtLeast(out.value.items.size)) }
                else -> _state.update { it.copy(loading = false, problem = out.asFailure()) }
            }
        }
        _state.value.openScenario?.let { loadRuns(it) }
    }

    fun openScenario(scenarioId: Long?) {
        _state.update { it.copy(openScenario = scenarioId, runs = null, runsProblem = null, openRun = null) }
        if (scenarioId != null) loadRuns(scenarioId)
    }

    private fun loadRuns(scenarioId: Long) {
        val id = serverId ?: return
        runsJob?.cancel()
        runsJob = viewModelScope.launch {
            when (val out = remote.scenarioRuns(id, scenarioId)) {
                is ApiOutcome.Ok -> _state.update { if (it.openScenario == scenarioId) it.copy(runs = out.value.items, runsProblem = null) else it }
                else -> _state.update { if (it.openScenario == scenarioId) it.copy(runsProblem = out.asFailure()) else it }
            }
        }
    }

    fun openRun(run: ScenarioRunDto?) {
        runJob?.cancel()
        _state.update { it.copy(openRun = run, runProblem = null) }
        if (run != null) runJob = viewModelScope.launch { loadRun(run.id) }
    }

    private suspend fun loadRun(runId: String) {
        val id = serverId ?: return
        when (val out = remote.scenarioRun(id, runId)) {
            is ApiOutcome.Ok -> _state.update { if (it.openRun?.id == runId) it.copy(openRun = out.value, runProblem = null) else it }
            else -> _state.update { if (it.openRun?.id == runId) it.copy(runProblem = out.asFailure()) else it }
        }
    }

    /** While visible: refresh the open run (and the runs list) every [pollMs] while something runs. */
    suspend fun follow() = coroutineScope {
        while (true) {
            delay(pollMs)
            val s = _state.value
            s.openRun?.takeIf { it.inFlight }?.let { loadRun(it.id) }
            if (s.openScenario != null && s.runs.orEmpty().any { it.inFlight }) loadRuns(s.openScenario)
        }
    }

    /** Candidates of "Déclencher sur…" (devices of the active server). */
    suspend fun searchDevices(query: String) = services.devices.page(DeviceQuery(search = query.trim().ifEmpty { null }, pageSize = 30), serverId)

    suspend fun setEnabled(s: ScenarioDto, enabled: Boolean, runner: ActionRunner, texts: ScenarioTexts): ActionResult<Unit> {
        val id = serverId ?: return ActionResult.Cancelled
        val spec = ActionSpec(
            key = if (enabled) "scenario.enable" else "scenario.disable",
            tier = Tier.T1,
            title = if (enabled) texts.enable else texts.disable,
            target = s.name,
            scope = facts.scope(id, null),
            consequence = if (enabled) null else texts.disableConsequence,
        )
        val result = busy(s.id) { runner.run(spec, preflight = { active(id, texts) }) { extra -> remote.setScenarioEnabled(id, s.id, enabled, extra) } }
        if (result is ActionResult.Done) refresh()
        return result
    }

    /** `POST /api/scenarios/:id/start-graph-run {deviceIds}` (like the web editor), T2 (T3 from 10 devices). */
    suspend fun start(s: ScenarioDto, devices: List<Device>, runner: ActionRunner, texts: ScenarioTexts): ActionResult<GraphRunStarted> {
        val id = serverId ?: return ActionResult.Cancelled
        if (devices.isEmpty()) return ActionResult.Cancelled
        val tier = if (devices.size >= 10) Tier.T3 else Tier.T2
        val spec = ActionSpec(
            key = "scenario.start",
            tier = tier,
            title = texts.start,
            target = texts.startTarget(devices.size, devices.singleOrNull()?.label) + " · " + s.name,
            scope = facts.scope(id, null),
            consequence = texts.startConsequence,
            targetCount = devices.size,
        )
        val result = busy(s.id) { runner.run(spec, preflight = { active(id, texts) }) { extra -> remote.startGraphRun(id, s.id, devices.map { it.id }, extra) } }
        if (result is ActionResult.Done) {
            refresh()
            if (_state.value.openScenario == s.id) loadRuns(s.id)
        }
        return result
    }

    /** `POST /api/scenarios/:id/cancel-runs`, T2 (design doc §5 S58 "Annuler les exécutions"). */
    suspend fun cancelRuns(s: ScenarioDto, runner: ActionRunner, texts: ScenarioTexts): ActionResult<Unit> {
        val id = serverId ?: return ActionResult.Cancelled
        val spec = ActionSpec(
            key = "scenario.cancel_runs",
            tier = Tier.T2,
            title = texts.cancelRuns,
            target = s.name,
            scope = facts.scope(id, null),
            consequence = texts.cancelConsequence(s.activeRunCount),
            targetCount = s.activeRunCount.coerceAtLeast(1),
        )
        val result = busy(s.id) { runner.run(spec, preflight = { active(id, texts) }) { extra -> remote.cancelScenarioRuns(id, s.id, extra) } }
        if (result is ActionResult.Done) refresh()
        return result
    }

    private fun active(id: ServerId, texts: ScenarioTexts): Preflight =
        if (facts.isActive(id)) Preflight.Ok else Preflight.Blocked(texts.notActive(facts.serverName(id).orEmpty()))

    private suspend fun <T> busy(scenarioId: Long, block: suspend () -> T): T {
        _state.update { it.copy(busy = it.busy + scenarioId) }
        return try {
            block()
        } finally {
            _state.update { it.copy(busy = it.busy - scenarioId) }
        }
    }

    companion object {
        const val POLL_MS = 5_000L
    }
}
