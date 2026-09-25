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
import kotlinx.serialization.json.JsonObject
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Preflight
import tools.obli.core.security.Tier
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.actionEndpoints

/** One device of a batch (S52 row). */
internal data class BatchRow(
    val executionId: String,
    val deviceId: Long,
    val label: String,
    val osType: String? = null,
    val step: ExecStep = ExecStep.QUEUED,
    val exitCode: Int? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val stdout: String? = null,
    val stderr: String? = null,
) {
    val durationMs: Long? get() = Fmt.durationMs(startedAt, finishedAt)
}

internal enum class BatchFilter { ALL, FAILED, RUNNING, QUEUED }

internal data class BatchUiState(
    val serverId: ServerId,
    val batchId: String,
    val loading: Boolean = true,
    val problem: ApiOutcome<Nothing>? = null,
    val scriptId: Long? = null,
    val scriptName: String? = null,
    val runtime: String? = null,
    val scriptContent: String? = null,
    val triggeredAt: String? = null,
    /** True: "lancé par vous"; false: [triggeredBy] names the user. */
    val byMe: Boolean? = null,
    val triggeredBy: String? = null,
    val scope: String = "",
    /** "Âge minimum (jours) = 7", secrets masked; empty when the definitions are unknown. */
    val params: List<ParamLine> = emptyList(),
    val rows: List<BatchRow> = emptyList(),
    val filter: BatchFilter = BatchFilter.ALL,
    /** Execution whose output (S53) is open. */
    val selected: String? = null,
    /** The socket of this server is connected (live) or the screen polls every 5 s. */
    val live: Boolean = false,
    /** A stop / cancel is being sent for these executions. */
    val busy: Set<String> = emptySet(),
) {
    val counts: BatchCounts
        get() = BatchCounts(
            success = rows.count { it.step == ExecStep.SUCCESS },
            failure = rows.count { it.step.isFailure },
            running = rows.count { it.step == ExecStep.RUNNING || it.step == ExecStep.SENT },
            queued = rows.count { it.step == ExecStep.QUEUED },
            other = rows.count { it.step == ExecStep.CANCELLED || it.step == ExecStep.SKIPPED },
        )

    val visible: List<BatchRow>
        get() = when (filter) {
            BatchFilter.ALL -> rows
            BatchFilter.FAILED -> rows.filter { it.step.isFailure }
            BatchFilter.RUNNING -> rows.filter { it.step == ExecStep.RUNNING || it.step == ExecStep.SENT }
            BatchFilter.QUEUED -> rows.filter { it.step == ExecStep.QUEUED }
        }

    val failed: List<BatchRow> get() = rows.filter { it.step.isFailure }
    val finished: Boolean get() = rows.isNotEmpty() && rows.all { it.step.terminal }
    val selectedRow: BatchRow? get() = rows.firstOrNull { it.executionId == selected }
}

/** Pure merge rules of the live batch (unit-tested). */
internal object BatchMerge {
    /**
     * A fresh `GET /api/executions/batches/:id`: terminal states and outputs
     * come from the server; a non-terminal row keeps the furthest step seen on
     * the socket (script_executions stays `pending` until the end: `sent` and
     * `ack_running` only exist on the command).
     */
    fun fromServer(previous: List<BatchRow>, items: List<BatchExecution>): List<BatchRow> {
        val old = previous.associateBy { it.executionId }
        return items.map { e ->
            val server = ExecStep.of(e.status)
            val before = old[e.id]
            val step = if (!server.terminal && before != null && !before.step.terminal && before.step.rank > server.rank) before.step else server
            BatchRow(
                executionId = e.id,
                deviceId = e.deviceId,
                label = e.hostname?.takeIf { it.isNotBlank() } ?: "#${e.deviceId}",
                osType = e.osType,
                step = step,
                exitCode = e.exitCode ?: before?.exitCode,
                startedAt = e.startedAt ?: before?.startedAt,
                finishedAt = e.finishedAt ?: before?.finishedAt,
                stdout = e.stdout,
                stderr = e.stderr,
            )
        }
    }

    /** `COMMAND_UPDATED` of a run_script command: En file → Envoyé → En cours; never backwards, never terminal. */
    fun command(rows: List<BatchRow>, e: CommandEvent): List<BatchRow> {
        if (e.sourceType != "script_execution" || e.sourceId == null) return rows
        val step = when (e.status) {
            "sent" -> ExecStep.SENT
            "ack_running" -> ExecStep.RUNNING
            else -> return rows
        }
        return rows.map { r -> if (r.executionId == e.sourceId && !r.step.terminal && step.rank > r.step.rank) r.copy(step = step) else r }
    }

    /** `EXECUTION_UPDATED`: the final state (outputs follow with the next GET). */
    fun execution(rows: List<BatchRow>, e: ExecutionEvent): List<BatchRow> = rows.map { r ->
        if (r.executionId != e.id) return@map r
        val step = ExecStep.of(e.status)
        if (r.step.terminal && !step.terminal) r
        else r.copy(step = step, exitCode = e.exitCode ?: r.exitCode, startedAt = e.startedAt ?: r.startedAt, finishedAt = e.finishedAt ?: r.finishedAt)
    }

    /** "Nettoyer les fichiers temporaires — 10:42 — 2/3 réussis — PC-COMPTA-03 : échec (code 1)". */
    fun report(state: BatchUiState, time: String?, texts: ReportTexts): String {
        val c = state.counts
        val head = listOfNotNull(state.scriptName, time, texts.succeeded(c.success, c.total)).joinToString(" — ")
        val lines = state.rows.filter { it.step.isFailure || it.step == ExecStep.CANCELLED }.map { r ->
            val first = Fmt.firstLine(r.stderr) ?: Fmt.firstLine(r.stdout)
            buildString {
                append(r.label).append(" : ").append(texts.step(r.step))
                r.exitCode?.let { append(" (").append(texts.code(it)).append(')') }
                if (first != null) append(" — ").append(first.take(160))
            }
        }
        return (listOf(head) + lines).joinToString("\n")
    }
}

/** Localised pieces of the shared report. */
internal class ReportTexts(
    val succeeded: (Int, Int) -> String,
    val step: (ExecStep) -> String,
    val code: (Int) -> String,
)

/** Texts of the stop / cancel confirmations, resolved by the screen. */
internal class StopTexts(
    val stopTitle: String,
    val cancelTitle: String,
    val stopConsequence: String,
    val cancelConsequence: String,
)

/**
 * S52 / S53: one batch of script executions on [serverId]. Live through
 * `COMMAND_UPDATED` / `EXECUTION_UPDATED` of the active server's socket while
 * [follow] runs; otherwise `GET /api/executions/batches/:batchId` every 5 s
 * while visible and something is still running (design doc §5 S52 "Suivi").
 */
internal class BatchViewModel(
    private val services: ObliServices,
    private val remote: AutomationsRemote,
    private val serverId: ServerId,
    private val batchId: String,
    private val pollMs: Long = POLL_MS,
    private val livePollMs: Long = LIVE_POLL_MS,
    private val refetchDebounceMs: Long = REFETCH_DEBOUNCE_MS,
) : ViewModel() {
    private val facts = ServerFacts(services)
    private val _state = MutableStateFlow(BatchUiState(serverId, batchId, scope = facts.scope(serverId, null)))
    val state: StateFlow<BatchUiState> = _state.asStateFlow()

    private var refetchJob: Job? = null
    private var headerLoaded = false

    init {
        viewModelScope.launch { load() }
    }

    fun refresh() {
        viewModelScope.launch { load() }
    }

    fun setFilter(f: BatchFilter) = _state.update { it.copy(filter = f) }

    fun select(executionId: String?) = _state.update { it.copy(selected = executionId) }

    private suspend fun load() {
        when (val out = remote.batch(serverId, batchId)) {
            is ApiOutcome.Ok -> {
                _state.update { s -> s.copy(loading = false, problem = null, rows = BatchMerge.fromServer(s.rows, out.value)) }
                if (!headerLoaded) loadHeader()
            }
            else -> _state.update { it.copy(loading = false, problem = out.asFailure()) }
        }
    }

    /** Script name, runtime, code snapshot and parameters from the first execution (`GET /api/executions/:id`). */
    private suspend fun loadHeader() {
        val first = _state.value.rows.firstOrNull() ?: return
        val detail = remote.execution(serverId, first.executionId).valueOrNull ?: return
        headerLoaded = true
        val snapshot = detail.scriptSnapshot
        val me = facts.me(serverId)
        _state.update {
            it.copy(
                scriptId = detail.scriptId,
                scriptName = snapshot?.name?.takeIf { n -> n.isNotBlank() },
                runtime = snapshot?.runtime,
                scriptContent = snapshot?.content,
                triggeredAt = detail.triggeredAt,
                byMe = if (me != null && detail.triggeredByUserId != null) me.id == detail.triggeredByUserId else null,
            )
        }
        // Parameter labels and secret masking need the definitions; without them nothing is shown.
        val defs = remote.script(serverId, detail.scriptId).valueOrNull?.parameters
        val values = detail.parameterValues
        if (defs != null && values != null) {
            val lines = defs.sortedBy { it.sortOrder }.mapNotNull { d ->
                // prefilled() never copies a secret: say it was set, never what it was.
                if (d.kind == ParamType.SECRET) values[d.name]?.let { ParamLine(d.title, secret = true) }
                else ParamField.prefilled(d, values[d.name]).takeIf { values[d.name] != null }?.line()
            }
            _state.update { s -> s.copy(params = lines) }
        }
        if (_state.value.byMe == false) {
            val name = remote.batches(serverId, 1, 50).valueOrNull?.items?.firstOrNull { it.batchId == batchId }?.triggeredByUsername
            _state.update { it.copy(triggeredBy = name) }
        }
    }

    /** While the screen is visible: socket events of this server, and polling when needed. */
    suspend fun follow() = coroutineScope {
        launch {
            facts.events(serverId, AutoEvents.COMMAND_UPDATED, AutoEvents.EXECUTION_UPDATED).collect { ev ->
                when (ev.name) {
                    AutoEvents.COMMAND_UPDATED -> ApiJson.decode(CommandEvent.serializer(), ev.payload)?.let { e ->
                        _state.update { it.copy(rows = BatchMerge.command(it.rows, e)) }
                    }
                    AutoEvents.EXECUTION_UPDATED -> ApiJson.decode(ExecutionEvent.serializer(), ev.payload)?.let { e ->
                        val mine = e.batchId == batchId || _state.value.rows.any { it.executionId == e.id }
                        if (mine) {
                            _state.update { it.copy(rows = BatchMerge.execution(it.rows, e)) }
                            scheduleRefetch()
                        }
                    }
                }
            }
        }
        while (true) {
            val live = facts.socketConnected(serverId)
            _state.update { it.copy(live = live) }
            delay(if (live) livePollMs else pollMs)
            val s = _state.value
            if (s.rows.isEmpty() || !s.finished) load()
        }
    }

    private fun scheduleRefetch() {
        refetchJob?.cancel()
        refetchJob = viewModelScope.launch {
            delay(refetchDebounceMs)
            load()
        }
    }

    /** Arrêter (sent / running → `POST /api/executions/:id/stop`) or Annuler (queued → `/cancel`), T1. */
    suspend fun stopOrCancel(row: BatchRow, runner: ActionRunner, texts: StopTexts): ActionResult<Unit> {
        val session = services.sessions.session(serverId) ?: return ActionResult.Blocked("")
        val stop = row.step == ExecStep.RUNNING || row.step == ExecStep.SENT
        val spec = ActionSpec(
            key = if (stop) "script.stop" else "script.cancel",
            tier = Tier.T1,
            title = if (stop) texts.stopTitle else texts.cancelTitle,
            target = row.label,
            scope = _state.value.scope,
            consequence = if (stop) texts.stopConsequence else texts.cancelConsequence,
            endpoints = session.actionEndpoints(row.deviceId),
        )
        _state.update { it.copy(busy = it.busy + row.executionId) }
        val result = try {
            runner.run(spec, preflight = { Preflight.Ok }) { extra: JsonObject ->
                if (stop) remote.stopExecution(serverId, row.executionId, extra) else remote.cancelExecution(serverId, row.executionId, extra)
            }
        } finally {
            _state.update { it.copy(busy = it.busy - row.executionId) }
        }
        if (result is ActionResult.Done) load()
        return result
    }

    companion object {
        const val POLL_MS = 5_000L
        const val LIVE_POLL_MS = 20_000L
        const val REFETCH_DEBOUNCE_MS = 800L
    }
}

/** A non-success outcome as the failure type. */
@Suppress("UNCHECKED_CAST")
internal fun ApiOutcome<*>.asFailure(): ApiOutcome<Nothing> = this as ApiOutcome<Nothing>
