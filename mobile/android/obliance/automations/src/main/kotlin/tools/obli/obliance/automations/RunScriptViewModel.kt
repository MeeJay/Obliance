package tools.obli.obliance.automations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
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
import tools.obli.obliance.api.Device
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.actionEndpoints

internal data class RunScriptUiState(
    val serverId: ServerId,
    val loading: Boolean = true,
    val problem: ApiOutcome<Nothing>? = null,
    val script: ScriptDto? = null,
    val fields: List<ParamField> = emptyList(),
    /** Validation is shown once the user tried to run. */
    val showErrors: Boolean = false,
    val targets: List<Device> = emptyList(),
    val targetsLoading: Boolean = false,
    /** Ids that could not be read (deleted, other tenant…). */
    val missing: List<Long> = emptyList(),
    val sessionTenantId: Long? = null,
    val running: Boolean = false,
    /** The last attempt's outcome that stays on screen (approval pending, validation). */
    val notice: RunNotice? = null,
) {
    val checks: RunChecks get() = RunChecks.of(script?.platform, targets)
    val invalid: List<ParamField> get() = fields.filter { it.problem != null }
    val canRun: Boolean get() = script != null && checks.canRun && !running
}

internal sealed interface RunNotice {
    /** 202 pending_approval: never a success (S43 was shown by the host). */
    data object AwaitingApproval : RunNotice

    /** 400 "No target devices found". */
    data object NoTargets : RunNotice
}

/** Texts of the S41 confirmation, resolved by the screen. */
internal class RunTexts(
    val title: (scriptName: String) -> String,
    val target: (count: Int, single: String?) -> String,
    val consequence: (runtime: String, count: Int) -> String,
    val mixedTenants: String,
    val notActive: (serverName: String) -> String,
)

/**
 * S51: the script (`GET /api/scripts/:id`, parameters typed from its
 * definitions), the targets (devices of [serverId]) and the local pre-checks,
 * then `POST /api/scripts/:id/execute` through the ActionRunner (T1 one
 * device, T2 2–9, T3 ≥ 10 with the typed count). [rerunOf] prefills the
 * parameters of a previous batch ("Relancer sur les échecs"; secrets never).
 */
internal class RunScriptViewModel(
    private val services: ObliServices,
    private val remote: AutomationsRemote,
    private val serverId: ServerId,
    private val scriptId: Long,
    deviceIds: List<Long>,
    private val rerunOf: String? = null,
) : ViewModel() {
    private val facts = ServerFacts(services)
    private val _state = MutableStateFlow(RunScriptUiState(serverId, sessionTenantId = facts.sessionTenant(serverId)))
    val state: StateFlow<RunScriptUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { loadScript() }
        viewModelScope.launch { addTargets(deviceIds) }
    }

    fun retry() {
        viewModelScope.launch { loadScript() }
    }

    private suspend fun loadScript() {
        _state.update { it.copy(loading = true, problem = null) }
        when (val out = remote.script(serverId, scriptId)) {
            is ApiOutcome.Ok -> {
                val defs = out.value.parameters.orEmpty().sortedBy { it.sortOrder }
                val previous = rerunOf?.let { previousValues(it) }
                _state.update {
                    it.copy(
                        loading = false,
                        script = out.value,
                        fields = defs.map { d -> if (previous != null) ParamField.prefilled(d, previous[d.name]) else ParamField.initial(d) },
                    )
                }
            }
            else -> _state.update { it.copy(loading = false, problem = out.asFailure()) }
        }
    }

    /** `parameterValues` of the first execution of [batchId]. */
    private suspend fun previousValues(batchId: String): kotlinx.serialization.json.JsonObject? {
        val first = remote.batch(serverId, batchId).valueOrNull?.firstOrNull() ?: return null
        return remote.execution(serverId, first.id).valueOrNull?.parameterValues
    }

    fun update(field: ParamField) = _state.update { s ->
        s.copy(fields = s.fields.map { if (it.def.name == field.def.name) field else it }, notice = null)
    }

    fun removeTarget(id: Long) = _state.update { s -> s.copy(targets = s.targets.filterNot { it.id == id }, notice = null) }

    fun addDevices(devices: List<Device>) = _state.update { s ->
        val known = s.targets.map { it.id }.toSet()
        s.copy(targets = s.targets + devices.filter { it.id !in known }, notice = null)
    }

    /** Loads the given ids from THIS server (`GET /api/devices/:id`, in parallel). */
    private suspend fun addTargets(ids: List<Long>) {
        if (ids.isEmpty()) return
        _state.update { it.copy(targetsLoading = true) }
        val results = coroutineScope { ids.distinct().map { id -> async { id to services.devices.detail(serverId, id) } }.awaitAll() }
        val found = results.mapNotNull { (_, out) -> (out as? ApiOutcome.Ok)?.value }
        val missing = results.filter { it.second !is ApiOutcome.Ok }.map { it.first }
        _state.update { s ->
            val known = s.targets.map { it.id }.toSet()
            s.copy(targets = s.targets + found.filter { it.id !in known }, missing = missing, targetsLoading = false)
        }
    }

    /** Candidates for "Ajouter" (devices of this server). */
    suspend fun search(query: String) = services.devices.page(tools.obli.obliance.api.DeviceQuery(search = query.trim().ifEmpty { null }, pageSize = 30), serverId)

    /**
     * Runs the script. Returns the batch id to open (S52) on success; the
     * result for the snackbar otherwise.
     */
    suspend fun run(runner: ActionRunner, texts: RunTexts): Pair<String?, ActionResult<List<StartedExecution>>?> {
        val s = _state.value
        val script = s.script ?: return null to null
        if (s.invalid.isNotEmpty()) {
            _state.update { it.copy(showErrors = true) }
            return null to null
        }
        val checks = s.checks
        if (!checks.canRun) return null to null
        val session = services.sessions.session(serverId) ?: return null to null
        val ids = checks.runnable.map { it.id }
        val switch = checks.switchTo(facts.sessionTenant(serverId))
        val tenantName = checks.tenants.values.singleOrNull()
        val spec = ActionSpec(
            key = "script.execute",
            tier = tierForTargets(ids.size),
            title = texts.title(script.name),
            target = texts.target(ids.size, checks.runnable.singleOrNull()?.label),
            scope = facts.scope(serverId, tenantName),
            consequence = texts.consequence(runtimeLabel(script.runtime), ids.size),
            targetCount = ids.size,
            endpoints = session.actionEndpoints(ids.singleOrNull()),
        )
        val values = s.fields.toParameterValues()
        _state.update { it.copy(running = true, notice = null) }
        val result = try {
            runner.run(
                spec,
                preflight = {
                    when {
                        !facts.isActive(serverId) -> Preflight.Blocked(texts.notActive(facts.serverName(serverId).orEmpty()))
                        checks.mixedTenants -> Preflight.Blocked(texts.mixedTenants)
                        switch != null -> Preflight.NeedsTenantSwitch(switch.second) {
                            services.tenants.switchTo(switch.first, serverId) is ApiOutcome.Ok
                        }
                        else -> Preflight.Ok
                    }
                },
            ) { extra -> remote.execute(serverId, script.id, ids, values, extra) }
        } finally {
            _state.update { it.copy(running = false, sessionTenantId = facts.sessionTenant(serverId)) }
        }
        return when (result) {
            is ActionResult.Done -> {
                val batch = result.value.firstNotNullOfOrNull { it.batchId }
                if (batch == null) _state.update { it.copy(notice = RunNotice.NoTargets) }
                batch to (if (batch == null) null else result)
            }
            is ActionResult.AwaitingApproval -> {
                _state.update { it.copy(notice = RunNotice.AwaitingApproval) }
                null to result
            }
            is ActionResult.Failed -> {
                val out = result.outcome
                if (out is ApiOutcome.Validation && out.message.contains("No target devices", ignoreCase = true)) {
                    _state.update { it.copy(notice = RunNotice.NoTargets) }
                    null to null
                } else {
                    null to result
                }
            }
            else -> null to result
        }
    }
}
