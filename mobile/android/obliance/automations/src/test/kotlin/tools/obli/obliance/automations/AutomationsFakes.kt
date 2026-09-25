package tools.obli.obliance.automations

import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.OkHttpClient
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ObliHttp
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.core.security.ActionPrompter
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.TwoFactorAnswer
import tools.obli.obliance.api.Approval
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** 10:42:30 in Paris on 25 September 2026 (design doc §4 "Lot de scripts de référence"). */
internal val RUN_NOW: Long = Instant.parse("2026-09-25T08:42:30Z").toEpochMilli()
internal val PARIS: ZoneId = ZoneId.of("Europe/Paris")
internal val TEST_CLOCK = AutomationsClock(now = { RUN_NOW }, zone = PARIS, ticking = false)

internal const val BATCH = "5b0e3c55-5d0b-4c64-9a8e-6f2d3c1a0b42"
internal const val CLEAN_TEMP = 41L
internal const val DENIED = "L'accès au chemin d'accès 'C:\\Users\\m.durand\\AppData\\Local\\Temp\\EBP_7312.tmp' est refusé."

/** The §4 data set of the automation screens (Obliance Prod). */
internal object AutoSample {
    private fun script(id: Long, name: String, platform: String, runtime: String, timeout: Int, content: String, description: String? = null, category: Long? = null, usage: ScriptUsage? = null, params: List<ScriptParameterDto>? = null) =
        ScriptDto(id = id, tenantId = SampleData.DEFAULT_TENANT, categoryId = category, name = name, description = description, platform = platform, runtime = runtime, timeoutSeconds = timeout, content = content, usage = usage, parameters = params)

    val cleanParams = listOf(
        ScriptParameterDto(1, "min_age_days", "Âge minimum (jours)", "Les fichiers plus récents sont conservés", "number", defaultValue = "7", required = true, sortOrder = 0),
        ScriptParameterDto(2, "include_browsers", "Inclure le cache des navigateurs", "Chrome, Edge et Firefox", "boolean", defaultValue = "false", sortOrder = 1),
    )

    const val CLEAN_CODE = "param([int]\$MinAgeDays = {{PARAM_min_age_days}})\n\$limit = (Get-Date).AddDays(-\$MinAgeDays)\nGet-ChildItem \$env:TEMP -Recurse -Force |\n  Where-Object { \$_.LastWriteTime -lt \$limit } |\n  Remove-Item -Force -Recurse -ErrorAction Stop"

    val scripts = listOf(
        script(CLEAN_TEMP, "Nettoyer les fichiers temporaires", "windows", "powershell", 120, CLEAN_CODE, "Supprime les fichiers temporaires des profils et, au choix, le cache des navigateurs.", 2, ScriptUsage(2, 1)),
        script(42, "Vider le cache DNS", "windows", "cmd", 30, "ipconfig /flushdns", category = 3),
        script(43, "Redémarrer le spouleur d'impression", "windows", "powershell", 60, "Restart-Service -Name Spooler -Force", category = 3),
        script(44, "Forcer gpupdate", "windows", "powershell", 120, "gpupdate /force", category = 3),
        script(45, "Purger les journaux journald (> 7 jours)", "linux", "bash", 60, "journalctl --vacuum-time=7d", category = 2),
        script(46, "Espace disque détaillé", "linux", "bash", 30, "df -h", category = 1),
    )

    val categories = listOf(
        ScriptCategoryDto(1, name = "Diagnostic", sortOrder = 0),
        ScriptCategoryDto(2, name = "Nettoyage", sortOrder = 1),
        ScriptCategoryDto(3, name = "Réseau et services", sortOrder = 2),
    )

    fun batchRows(finished: Boolean = true): List<BatchExecution> = listOf(
        BatchExecution("9001", 185, "PC-COMPTA-01", "windows", "success", 0, "Fichiers supprimés : 1 284 (2,1 Go)", null, "2026-09-25T08:42:02Z", "2026-09-25T08:42:04Z", "2026-09-25T08:42:18Z"),
        BatchExecution("9002", 186, "PC-COMPTA-02", "windows", if (finished) "success" else "pending", if (finished) 0 else null, if (finished) "Fichiers supprimés : 903 (1,4 Go)" else null, null, "2026-09-25T08:42:02Z", if (finished) "2026-09-25T08:42:05Z" else null, if (finished) "2026-09-25T08:42:16Z" else null),
        BatchExecution("9003", 187, "PC-COMPTA-03", "windows", if (finished) "failure" else "pending", if (finished) 1 else null, null, if (finished) DENIED else null, "2026-09-25T08:42:02Z", if (finished) "2026-09-25T08:42:03.200Z" else null, if (finished) "2026-09-25T08:42:08Z" else null),
    )

    val execution = ExecutionDetail(
        id = "9001", tenantId = SampleData.ACME_TENANT, scriptId = CLEAN_TEMP, deviceId = 185, batchId = BATCH,
        scriptSnapshot = ScriptSnapshot(CLEAN_TEMP, "Nettoyer les fichiers temporaires", "windows", "powershell", CLEAN_CODE, 120, "system"),
        parameterValues = buildJsonObject { put("min_age_days", JsonPrimitive(7)); put("include_browsers", JsonPrimitive(true)) },
        status = "success", triggeredBy = "manual", triggeredByUserId = SampleData.karimSso.id, triggeredAt = "2026-09-25T08:42:02Z",
    )

    fun batches(inFlight: Boolean = false) = listOf(
        BatchSummary(BATCH, CLEAN_TEMP, "Nettoyer les fichiers temporaires", null, null, "manual", "Karim Benali", "2026-09-25T08:42:02Z", 3, if (inFlight) 1 else 2, if (inFlight) 0 else 1, if (inFlight) 1 else 0, if (inFlight) 1 else 0),
        BatchSummary("b-verif", 60, "Vérif sauvegarde", 7, "Vérif sauvegarde", "schedule", null, "2026-09-25T00:00:00Z", 6, 5, 1, 0, 0),
        BatchSummary("b-hebdo", 61, "Nettoyage hebdo C:", 8, "Nettoyage hebdo C:", "schedule", null, "2026-09-20T01:00:00Z", 23, 21, 2, 0, 0),
    )

    val schedules = listOf(
        ScheduleDto(7, SampleData.ACME_TENANT, scriptId = 60, name = "Vérif sauvegarde", targetType = "group", targetIds = listOf(12), cronExpression = "0 2 * * *", timezone = "Europe/Paris", enabled = true, lastRunAt = "2026-09-25T00:00:00Z", nextRunAt = "2026-09-26T00:00:00Z", resolvedDeviceCount = 6),
        ScheduleDto(8, SampleData.ACME_TENANT, scriptId = 61, name = "Nettoyage hebdo C:", targetType = "group", targetIds = listOf(13), cronExpression = "0 3 * * 0", timezone = "Europe/Paris", enabled = true, lastRunAt = "2026-09-20T01:00:00Z", nextRunAt = "2026-09-27T01:00:00Z", resolvedDeviceCount = 23),
    )

    val scenarios = listOf(
        ScenarioDto(3, SampleData.DEFAULT_TENANT, name = "Déployer Obliview (Windows)", description = "Installe Obliview sur chaque poste Windows dès son approbation.", triggerType = "agent_approved", status = "active", nodeCount = 4, activeRunCount = 2, triggerCounts = mapOf("agent_approved" to 1, "manual" to 1)),
        ScenarioDto(4, SampleData.DEFAULT_TENANT, name = "Durcissement SSH Linux", triggerType = "manual", status = "draft", nodeCount = 3, triggerCounts = mapOf("manual" to 1)),
    )

    val runs = listOf(
        ScenarioRunDto("r-2", 3, 240, "agent_approved", null, "running", "2026-09-25T08:40:00Z", device = RunDevice(240, "KIOSK-ACCUEIL-02", osType = "windows")),
        ScenarioRunDto("r-1", 3, 185, "manual", "graph-run:batch:1", "success", "2026-09-24T14:02:00Z", "2026-09-24T14:03:12Z", device = RunDevice(185, "PC-COMPTA-01", osType = "windows")),
    )

    val runDetail = runs[0].copy(
        nodeRuns = listOf(
            NodeRunDto("n1", 11, "trigger_agent_approved", null, "success", startedAt = "2026-09-25T08:40:00Z", finishedAt = "2026-09-25T08:40:00Z"),
            NodeRunDto("n2", 12, "run_script", "Télécharger l'installeur", "success", 0, "Téléchargé : obliview-setup.msi (48 Mo)", null, null, "2026-09-25T08:40:01Z", "2026-09-25T08:40:39Z"),
            NodeRunDto("n3", 13, "run_script", "Installer Obliview", "running", startedAt = "2026-09-25T08:40:40Z"),
        ),
    )

    /** Karim's own request, waiting for a second admin (restricted script run on 3 devices). */
    val approvals = listOf(
        Approval(
            id = 21, tenantId = SampleData.ACME_TENANT, requestedBy = SampleData.karimSso.id, requestedByName = "og_karim.benali",
            requestType = "batch_command", description = "Manually run script #41 on 3 device(s)",
            payload = buildJsonObject {
                put("action", JsonPrimitive("run_script"))
                put("deviceIds", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(185), JsonPrimitive(186), JsonPrimitive(187))))
                put("params", buildJsonObject { put("source", JsonPrimitive("script_execute")); put("scriptId", JsonPrimitive(CLEAN_TEMP)) })
            },
            status = "pending", createdAt = "2026-09-25T08:41:00Z", expiresAt = "2026-09-25T09:11:00Z",
        ),
        SampleData.escalations.first().approval,
    )
}

/** Network-free [AutomationsRemote] over [AutoSample], recording every call with its server. */
internal class FakeAutomationsRemote : AutomationsRemote {
    val calls = mutableListOf<String>()
    val servers = mutableListOf<ServerId>()
    var executeAnswer: (List<Long>, JsonObject, JsonObject) -> ApiOutcome<List<StartedExecution>> = { ids, _, _ ->
        ApiOutcome.Accepted(ids.mapIndexed { i, id -> StartedExecution("${9001 + i}", id, CLEAN_TEMP, BATCH, "pending") })
    }
    var executed: Triple<List<Long>, JsonObject, JsonObject>? = null
    var batchRows: List<BatchExecution> = AutoSample.batchRows()
    var batchesAnswer: ApiOutcome<BatchPage> = ApiOutcome.Ok(BatchPage(AutoSample.batches(), 3))
    var scriptsAnswer: ApiOutcome<List<ScriptDto>> = ApiOutcome.Ok(AutoSample.scripts)
    var schedulesAnswer: ApiOutcome<List<ScheduleDto>> = ApiOutcome.Ok(AutoSample.schedules)
    var scenariosAnswer: ApiOutcome<ScenarioPage> = ApiOutcome.Ok(ScenarioPage(AutoSample.scenarios, 2))
    var approvalsAnswer: ApiOutcome<List<Approval>> = ApiOutcome.Ok(AutoSample.approvals)
    var mutation: ApiOutcome<Unit> = ApiOutcome.Ok(Unit)
    var started: List<Long>? = null

    private fun rec(serverId: ServerId, what: String) {
        calls += what
        servers += serverId
    }

    override suspend fun scripts(serverId: ServerId, platform: String?, search: String?, categoryId: Long?) = scriptsAnswer.also { rec(serverId, "scripts") }
    override suspend fun categories(serverId: ServerId) = ApiOutcome.Ok(AutoSample.categories).also { rec(serverId, "categories") }
    override suspend fun script(serverId: ServerId, scriptId: Long): ApiOutcome<ScriptDto> {
        rec(serverId, "script $scriptId")
        val s = AutoSample.scripts.firstOrNull { it.id == scriptId } ?: return ApiOutcome.Failure(404, FailureKind.NOT_FOUND, "Script not found")
        return ApiOutcome.Ok(if (scriptId == CLEAN_TEMP) s.copy(parameters = AutoSample.cleanParams) else s.copy(parameters = emptyList()))
    }

    override suspend fun execute(serverId: ServerId, scriptId: Long, deviceIds: List<Long>, parameterValues: JsonObject, extra: JsonObject): ApiOutcome<List<StartedExecution>> {
        rec(serverId, "execute $scriptId")
        executed = Triple(deviceIds, parameterValues, extra)
        return executeAnswer(deviceIds, parameterValues, extra)
    }

    override suspend fun batches(serverId: ServerId, page: Int, pageSize: Int) = batchesAnswer.also { rec(serverId, "batches") }
    override suspend fun batch(serverId: ServerId, batchId: String) = ApiOutcome.Ok(batchRows).also { rec(serverId, "batch $batchId") }
    override suspend fun execution(serverId: ServerId, executionId: String) = ApiOutcome.Ok(AutoSample.execution.copy(id = executionId)).also { rec(serverId, "execution $executionId") }
    override suspend fun stopExecution(serverId: ServerId, executionId: String, extra: JsonObject) = mutation.also { rec(serverId, "stop $executionId") }
    override suspend fun cancelExecution(serverId: ServerId, executionId: String, extra: JsonObject) = mutation.also { rec(serverId, "cancel $executionId") }
    override suspend fun schedules(serverId: ServerId) = schedulesAnswer.also { rec(serverId, "schedules") }
    override suspend fun setScheduleEnabled(serverId: ServerId, scheduleId: Long, enabled: Boolean, extra: JsonObject): ApiOutcome<ScheduleDto> {
        rec(serverId, "schedule $scheduleId enabled=$enabled")
        return ApiOutcome.Ok(AutoSample.schedules.first { it.id == scheduleId }.copy(enabled = enabled))
    }
    override suspend fun scenarios(serverId: ServerId) = scenariosAnswer.also { rec(serverId, "scenarios") }
    override suspend fun scenarioRuns(serverId: ServerId, scenarioId: Long) = ApiOutcome.Ok(ScenarioRunPage(AutoSample.runs.filter { it.scenarioId == scenarioId }, 2)).also { rec(serverId, "runs $scenarioId") }
    override suspend fun scenarioRun(serverId: ServerId, runId: String) = ApiOutcome.Ok(AutoSample.runDetail).also { rec(serverId, "run $runId") }
    override suspend fun setScenarioEnabled(serverId: ServerId, scenarioId: Long, enabled: Boolean, extra: JsonObject) = mutation.also { rec(serverId, "scenario $scenarioId enabled=$enabled") }
    override suspend fun startGraphRun(serverId: ServerId, scenarioId: Long, deviceIds: List<Long>, extra: JsonObject): ApiOutcome<GraphRunStarted> {
        rec(serverId, "start $scenarioId")
        started = deviceIds
        return ApiOutcome.Accepted(GraphRunStarted(deviceIds.map { "run-$it" }, "run-${deviceIds.first()}", "graph-run:batch:1"))
    }
    override suspend fun cancelScenarioRuns(serverId: ServerId, scenarioId: Long, extra: JsonObject) = mutation.also { rec(serverId, "cancel-runs $scenarioId") }
    override suspend fun approvals(serverId: ServerId) = approvalsAnswer.also { rec(serverId, "approvals") }
}

/** Prompter that accepts everything and records what the host would show. */
internal class RecordingPrompter(var confirmAnswer: Boolean = true, var code: String? = null) : ActionPrompter {
    val confirmed = mutableListOf<ActionSpec>()
    val switches = mutableListOf<String>()
    val approvals = mutableListOf<Long>()
    override suspend fun confirmTenantSwitch(spec: ActionSpec, tenantName: String): Boolean { switches += tenantName; return true }
    override suspend fun confirm(spec: ActionSpec): Boolean { confirmed += spec; return confirmAnswer }
    override suspend fun askTwoFactor(spec: ActionSpec, currentIp: String?, previousWasWrong: Boolean): TwoFactorAnswer? = code?.let { TwoFactorAnswer(it, false) }
    override suspend fun approvalRequested(spec: ActionSpec, approvalId: Long) { approvals += approvalId }
    override suspend fun unlockPrivacy(spec: ActionSpec, feature: String?, passwordSet: Boolean) = false
    override suspend fun sessionExpired() = Unit
}

internal fun runnerOf(prompter: ActionPrompter = RecordingPrompter()) = ActionRunner(prompter)

/** A realtime client a test can push events into. */
internal class PushRealtime(connected: Boolean = true) : RealtimeClient {
    val flow = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 32)
    override val state: StateFlow<ConnectionState> = MutableStateFlow(if (connected) ConnectionState.CONNECTED else ConnectionState.RECONNECTING)
    override val events: SharedFlow<RealtimeEvent> = flow
    override fun connect() = Unit
    override fun reconnect() = Unit
    override fun disconnect() = Unit
    override fun emit(name: String, payload: JsonElement?) = false
    override suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long): JsonElement? = null
}

/** The §4 sample services whose sessions use [realtime] (network-free: nothing calls their HTTP). */
internal class LiveServices(
    val base: SampleObliServices = SampleObliServices(),
    val realtime: PushRealtime = PushRealtime(),
) : ObliServices by base {
    override val sessions: ServerSessions = ServerSessions(
        base.registry,
        { profile, now -> ServerSession(profile.id, now, ObliHttp(profile.origin, OkHttpClient()), { realtime }).also { it.markSignedIn(SampleData.probe(profile.id)) } },
        CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
    )
}
