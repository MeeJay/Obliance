package tools.obli.obliance.automations

import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.api.Approval
import tools.obli.obliance.api.ApprovalsApi

/**
 * Automation calls that `:obliance:api` does not offer (CONTRACT §7), always
 * made over the session of the item's OWN server. Reads are T0; every write
 * takes the `extra` fields of the ActionRunner (step-up `twoFactorCode`,
 * `trustIp`) and is only ever called from inside `ActionRunner.run`.
 */
internal interface AutomationsRemote {
    // Scripts (script.routes.ts) -------------------------------------------
    suspend fun scripts(serverId: ServerId, platform: String? = null, search: String? = null, categoryId: Long? = null): ApiOutcome<List<ScriptDto>>
    suspend fun categories(serverId: ServerId): ApiOutcome<List<ScriptCategoryDto>>
    suspend fun script(serverId: ServerId, scriptId: Long): ApiOutcome<ScriptDto>
    suspend fun execute(serverId: ServerId, scriptId: Long, deviceIds: List<Long>, parameterValues: JsonObject, extra: JsonObject): ApiOutcome<List<StartedExecution>>

    // Executions (execution.routes.ts) -------------------------------------
    suspend fun batches(serverId: ServerId, page: Int = 1, pageSize: Int = 20): ApiOutcome<BatchPage>
    suspend fun batch(serverId: ServerId, batchId: String): ApiOutcome<List<BatchExecution>>
    suspend fun execution(serverId: ServerId, executionId: String): ApiOutcome<ExecutionDetail>
    suspend fun stopExecution(serverId: ServerId, executionId: String, extra: JsonObject): ApiOutcome<Unit>
    suspend fun cancelExecution(serverId: ServerId, executionId: String, extra: JsonObject): ApiOutcome<Unit>

    // Schedules (schedule.routes.ts) ---------------------------------------
    suspend fun schedules(serverId: ServerId): ApiOutcome<List<ScheduleDto>>
    suspend fun setScheduleEnabled(serverId: ServerId, scheduleId: Long, enabled: Boolean, extra: JsonObject): ApiOutcome<ScheduleDto>

    // Scenarios (scenario.routes.ts) ---------------------------------------
    suspend fun scenarios(serverId: ServerId): ApiOutcome<ScenarioPage>
    suspend fun scenarioRuns(serverId: ServerId, scenarioId: Long): ApiOutcome<ScenarioRunPage>
    suspend fun scenarioRun(serverId: ServerId, runId: String): ApiOutcome<ScenarioRunDto>
    suspend fun setScenarioEnabled(serverId: ServerId, scenarioId: Long, enabled: Boolean, extra: JsonObject): ApiOutcome<Unit>
    suspend fun startGraphRun(serverId: ServerId, scenarioId: Long, deviceIds: List<Long>, extra: JsonObject): ApiOutcome<GraphRunStarted>
    suspend fun cancelScenarioRuns(serverId: ServerId, scenarioId: Long, extra: JsonObject): ApiOutcome<Unit>

    // Approvals (approval.routes.ts, platform admins only) -----------------
    suspend fun approvals(serverId: ServerId): ApiOutcome<List<Approval>>
}

/** Screenshot tests provide a network-free [AutomationsRemote]; the app uses [HttpAutomationsRemote]. */
internal val LocalAutomationsRemote = staticCompositionLocalOf<AutomationsRemote?> { null }

/** Request paths and bodies, exactly what the web client sends (client/src/api/script.api.ts, scenario.api.ts). */
internal object AutomationsRequests {
    fun scriptsPath(platform: String?, search: String?, categoryId: Long?): String {
        val q = buildList {
            platform?.takeIf { it.isNotBlank() && it != "all" }?.let { add("platform=" + enc(it)) }
            search?.trim()?.takeIf { it.isNotEmpty() }?.let { add("search=" + enc(it)) }
            categoryId?.let { add("categoryId=$it") }
        }
        return "/api/scripts" + if (q.isEmpty()) "" else "?" + q.joinToString("&")
    }

    /** `scriptApi.executeNow(id, {deviceIds, parameterValues})` + the step-up fields. */
    fun execute(deviceIds: List<Long>, parameterValues: JsonObject, extra: JsonObject): JsonObject =
        ApiJson.body(
            "deviceIds" to JsonArray(deviceIds.distinct().map { JsonPrimitive(it) }),
            "parameterValues" to parameterValues,
            extra = extra,
        )

    /** `scriptApi.updateSchedule(id, {enabled})`. */
    fun scheduleEnabled(enabled: Boolean, extra: JsonObject): JsonObject = ApiJson.body("enabled" to enabled, extra = extra)

    /** `scenarioApi.startGraphRun(id, deviceIds)` → `{deviceIds}` (no node options from the app). */
    fun startGraphRun(deviceIds: List<Long>, extra: JsonObject): JsonObject =
        ApiJson.body("deviceIds" to JsonArray(deviceIds.distinct().map { JsonPrimitive(it) }), extra = extra)

    fun empty(extra: JsonObject): JsonObject = ApiJson.body(extra = extra)

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, Charsets.UTF_8.name()).replace("+", "%20")
}

internal class HttpAutomationsRemote(private val sessions: ServerSessions) : AutomationsRemote {

    private val noServer: ApiOutcome<Nothing> = ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server")

    private suspend fun <T> on(serverId: ServerId, block: suspend (ServerSession) -> ApiOutcome<T>): ApiOutcome<T> {
        val s = sessions.session(serverId) ?: return noServer
        return block(s).also { if (it == ApiOutcome.SessionExpired) s.markExpired() }
    }

    private suspend fun <T> ServerSession.get(path: String, serializer: KSerializer<T>): ApiOutcome<T> =
        http.call(ObliHttp.Method.GET, path, decode = ApiJson.unwrapped(serializer))

    private suspend fun ServerSession.send(method: ObliHttp.Method, path: String, body: JsonObject): ApiOutcome<Unit> =
        http.call(method, path, body, decode = ApiJson.ignoreBody)

    override suspend fun scripts(serverId: ServerId, platform: String?, search: String?, categoryId: Long?) =
        on(serverId) { it.get(AutomationsRequests.scriptsPath(platform, search, categoryId), ListSerializer(ScriptDto.serializer())) }

    override suspend fun categories(serverId: ServerId) =
        on(serverId) { it.get("/api/scripts/categories", ListSerializer(ScriptCategoryDto.serializer())) }

    override suspend fun script(serverId: ServerId, scriptId: Long) =
        on(serverId) { it.get("/api/scripts/$scriptId", ScriptDto.serializer()) }

    override suspend fun execute(serverId: ServerId, scriptId: Long, deviceIds: List<Long>, parameterValues: JsonObject, extra: JsonObject) =
        on(serverId) {
            it.http.call(
                ObliHttp.Method.POST,
                "/api/scripts/$scriptId/execute",
                AutomationsRequests.execute(deviceIds, parameterValues, extra),
                decode = ApiJson.unwrapped(ListSerializer(StartedExecution.serializer())),
            )
        }

    override suspend fun batches(serverId: ServerId, page: Int, pageSize: Int) =
        on(serverId) { it.get("/api/executions/batches?page=${page.coerceAtLeast(1)}&pageSize=${pageSize.coerceIn(1, 100)}", BatchPage.serializer()) }

    override suspend fun batch(serverId: ServerId, batchId: String) =
        on(serverId) { it.get("/api/executions/batches/${seg(batchId)}", ListSerializer(BatchExecution.serializer())) }

    override suspend fun execution(serverId: ServerId, executionId: String) =
        on(serverId) { it.get("/api/executions/${seg(executionId)}", ExecutionDetail.serializer()) }

    override suspend fun stopExecution(serverId: ServerId, executionId: String, extra: JsonObject) =
        on(serverId) { it.send(ObliHttp.Method.POST, "/api/executions/${seg(executionId)}/stop", AutomationsRequests.empty(extra)) }

    override suspend fun cancelExecution(serverId: ServerId, executionId: String, extra: JsonObject) =
        on(serverId) { it.send(ObliHttp.Method.POST, "/api/executions/${seg(executionId)}/cancel", AutomationsRequests.empty(extra)) }

    override suspend fun schedules(serverId: ServerId) =
        on(serverId) { it.get("/api/schedules", ListSerializer(ScheduleDto.serializer())) }

    override suspend fun setScheduleEnabled(serverId: ServerId, scheduleId: Long, enabled: Boolean, extra: JsonObject) =
        on(serverId) {
            it.http.call(
                ObliHttp.Method.PATCH,
                "/api/schedules/$scheduleId",
                AutomationsRequests.scheduleEnabled(enabled, extra),
                decode = ApiJson.unwrapped(ScheduleDto.serializer()),
            )
        }

    override suspend fun scenarios(serverId: ServerId) =
        on(serverId) { it.http.call(ObliHttp.Method.GET, "/api/scenarios", decode = ::decodeScenarioPage) }

    override suspend fun scenarioRuns(serverId: ServerId, scenarioId: Long) =
        on(serverId) { it.http.call(ObliHttp.Method.GET, "/api/scenarios/$scenarioId/runs", decode = ::decodeRunPage) }

    override suspend fun scenarioRun(serverId: ServerId, runId: String) =
        on(serverId) { it.get("/api/scenarios/runs/${seg(runId)}", ScenarioRunDto.serializer()) }

    override suspend fun setScenarioEnabled(serverId: ServerId, scenarioId: Long, enabled: Boolean, extra: JsonObject) =
        on(serverId) { it.send(ObliHttp.Method.POST, "/api/scenarios/$scenarioId/" + if (enabled) "enable" else "disable", AutomationsRequests.empty(extra)) }

    override suspend fun startGraphRun(serverId: ServerId, scenarioId: Long, deviceIds: List<Long>, extra: JsonObject) =
        on(serverId) {
            it.http.call(
                ObliHttp.Method.POST,
                "/api/scenarios/$scenarioId/start-graph-run",
                AutomationsRequests.startGraphRun(deviceIds, extra),
                decode = ApiJson.unwrapped(GraphRunStarted.serializer()),
            )
        }

    override suspend fun cancelScenarioRuns(serverId: ServerId, scenarioId: Long, extra: JsonObject) =
        on(serverId) { it.send(ObliHttp.Method.POST, "/api/scenarios/$scenarioId/cancel-runs", AutomationsRequests.empty(extra)) }

    override suspend fun approvals(serverId: ServerId) =
        on(serverId) { ApprovalsApi(it.http).list(includeResolved = true, limit = 50) }

    companion object {
        /** Path segment of an id that came from the server (UUID / number): anything else is refused. */
        fun seg(id: String): String = id.takeIf { SAFE_ID.matches(it) } ?: "invalid"

        private val SAFE_ID = Regex("[A-Za-z0-9_-]{1,64}")

        /** `{data:{items,total}}`, or a bare array (scenario.api.ts accepts both). */
        fun decodeScenarioPage(e: JsonElement?): ScenarioPage? = when (val d = tools.obli.core.network.ApiResponses.unwrap(e)) {
            is JsonArray -> ApiJson.decode(ListSerializer(ScenarioDto.serializer()), d)?.let { ScenarioPage(it, it.size) }
            else -> ApiJson.decode(ScenarioPage.serializer(), d)
        }

        fun decodeRunPage(e: JsonElement?): ScenarioRunPage? = when (val d = tools.obli.core.network.ApiResponses.unwrap(e)) {
            is JsonArray -> ApiJson.decode(ListSerializer(ScenarioRunDto.serializer()), d)?.let { ScenarioRunPage(it, it.size) }
            else -> ApiJson.decode(ScenarioRunPage.serializer(), d)
        }
    }
}
