package tools.obli.obliance.automations

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.auth.ServerRegistryStore
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.shell.nav.Origins

/**
 * The HTTP remote against a fake Obliance server: paths, request bodies and
 * the decoding of the answers exactly as the server routes write them
 * (script.routes.ts, execution.routes.ts, schedule.routes.ts,
 * scenario.routes.ts, restriction.service.ts for 401 / 202).
 */
class HttpAutomationsRemoteTest {
    private class Fake : AutoCloseable {
        val routes = ConcurrentHashMap<String, Pair<Int, String>>()
        val requests = CopyOnWriteArrayList<Pair<String, String>>()
        private val server = MockWebServer()

        init {
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val target = request.url.encodedPath + (request.url.encodedQuery?.let { "?$it" } ?: "")
                    val key = "${request.method} $target"
                    requests += key to (request.body?.utf8() ?: "")
                    val (code, body) = routes[key] ?: routes["${request.method} ${request.url.encodedPath}"] ?: (404 to """{"error":"Not found"}""")
                    return MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()
                }
            }
            server.start()
        }

        val origin: String get() = Origins.of(server.url("/").toString())!!
        fun on(route: String, code: Int = 200, body: String) { routes[route] = code to body }
        fun body(route: String): JsonObject = Json.parseToJsonElement(requests.last { it.first == route }.second) as JsonObject
        override fun close() = server.close()
    }

    private val prod = Fake()
    private val id = ServerId("prod")
    private lateinit var sessions: ServerSessions

    private fun remote(): HttpAutomationsRemote = runBlocking {
        val registry = ServerRegistry(object : ServerRegistryStore {
            var s: ServerRegistryState? = ServerRegistryState(listOf(ServerProfile(id, "https://obliance-prod.example.org", "Obliance Prod", ServerColor.VIOLET, "OP", 0)), id)
            override suspend fun load() = s
            override suspend fun save(state: ServerRegistryState) { s = state }
        })
        registry.load()
        val client = ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA")
        sessions = ServerSessions(registry, { p, now -> ServerSession(p.id, now, ObliHttp(prod.origin, client), { PushRealtime() }) }, CoroutineScope(SupervisorJob() + Dispatchers.Default))
        HttpAutomationsRemote(sessions)
    }

    @After fun tearDown() = prod.close()

    @Test fun executeSendsTheWebBodyAndReadsThe202Executions() = runBlocking {
        prod.on(
            "POST /api/scripts/41/execute", 202,
            """{"data":[{"id":9001,"deviceId":185,"scriptId":41,"batchId":"$BATCH","status":"pending","triggeredBy":"manual","triggeredAt":"2026-09-25T08:42:02.000Z"},{"id":9002,"deviceId":186,"scriptId":41,"batchId":"$BATCH","status":"pending","triggeredBy":"manual","triggeredAt":"2026-09-25T08:42:02.000Z"}]}""",
        )
        val values = buildJsonObject { put("min_age_days", JsonPrimitive(7)); put("include_browsers", JsonPrimitive(true)) }
        val out = remote().execute(id, 41, listOf(185, 186, 185), values, JsonObject(emptyMap()))
        assertTrue(out is ApiOutcome.Accepted)
        val list = (out as ApiOutcome.Accepted).value
        assertEquals(listOf("9001", "9002"), list.map { it.id })
        assertEquals(BATCH, list.first().batchId)
        assertEquals(
            Json.parseToJsonElement("""{"deviceIds":[185,186],"parameterValues":{"min_age_days":7,"include_browsers":true}}"""),
            prod.body("POST /api/scripts/41/execute"),
        )
    }

    @Test fun stepUpThenApprovalThroughTheRunner() = runBlocking {
        val r = remote()
        // First call: script.execute_manual is sensitive → 401 twoFactorRequired.
        prod.on("POST /api/scripts/41/execute", 401, """{"error":"Two-factor verification required","twoFactorRequired":true,"action":"script.execute_manual","currentIp":"92.184.107.21"}""")
        val prompter = RecordingPrompter(code = "123456")
        val runner = runnerOf(prompter)
        var attempts = 0
        val result = runner.run(ActionSpec("script.execute", Tier.T2, "Exécuter", "3 appareils", "ACME", targetCount = 3)) { extra ->
            attempts++
            // Second call: the tenant restricts it → 202 pending_approval.
            if (attempts == 2) prod.on("POST /api/scripts/41/execute", 202, """{"data":{"approvalId":21,"status":"pending_approval"}}""")
            r.execute(id, 41, listOf(185, 186, 187), JsonObject(emptyMap()), extra)
        }
        assertEquals(ActionResult.AwaitingApproval(21), result)
        assertEquals(listOf(21L), prompter.approvals)
        // The SAME body again, with the code.
        assertEquals(
            Json.parseToJsonElement("""{"deviceIds":[185,186,187],"parameterValues":{},"twoFactorCode":"123456"}"""),
            prod.body("POST /api/scripts/41/execute"),
        )
    }

    @Test fun noTargetIsAValidation() = runBlocking {
        prod.on("POST /api/scripts/41/execute", 400, """{"error":"No target devices found"}""")
        val out = remote().execute(id, 41, listOf(15), JsonObject(emptyMap()), JsonObject(emptyMap()))
        assertTrue(out is ApiOutcome.Validation && out.message == "No target devices found")
    }

    @Test fun scriptsCategoriesAndDetail() = runBlocking {
        prod.on("GET /api/scripts", body = """{"data":[{"id":41,"uuid":"u","tenantId":1,"categoryId":2,"parentScriptId":null,"name":"Nettoyer les fichiers temporaires","description":null,"tags":[],"platform":"windows","runtime":"powershell","content":"x","timeoutSeconds":120,"expectedExitCode":0,"runAs":"system","scriptType":"user","availableInReach":false,"purpose":"execute","isBuiltin":false,"usage":{"scenarios":2,"schedules":1}}]}""")
        prod.on("GET /api/scripts/categories", body = """{"data":[{"id":2,"tenantId":null,"name":"Nettoyage","icon":null,"color":"#888","sortOrder":1}]}""")
        prod.on("GET /api/scripts/41", body = """{"data":{"id":41,"name":"Nettoyer les fichiers temporaires","platform":"windows","runtime":"powershell","content":"x","timeoutSeconds":"120","parameters":[{"id":1,"scriptId":41,"name":"min_age_days","label":"Âge minimum (jours)","description":null,"type":"number","options":[],"defaultValue":"7","required":true,"sortOrder":0}]}}""")
        val r = remote()
        val list = (r.scripts(id) as ApiOutcome.Ok).value
        assertEquals(ScriptUsage(2, 1), list.single().usage)
        assertEquals("Nettoyage", (r.categories(id) as ApiOutcome.Ok).value.single().name)
        val detail = (r.script(id, 41) as ApiOutcome.Ok).value
        assertEquals(120, detail.timeoutSeconds)
        assertEquals(ParamType.NUMBER, detail.parameters!!.single().kind)
    }

    @Test fun batchesBatchAndExecution() = runBlocking {
        prod.on("GET /api/executions/batches?page=1&pageSize=20", body = """{"data":{"items":[{"batchId":"$BATCH","scriptId":41,"scriptName":"Nettoyer les fichiers temporaires","scheduleId":null,"scheduleName":null,"triggeredBy":"manual","triggeredByUsername":"Karim Benali","triggeredAt":"2026-09-25T08:42:02.000Z","totalCount":3,"successCount":2,"failureCount":1,"pendingCount":0,"runningCount":0}],"total":1}}""")
        prod.on("GET /api/executions/batches/$BATCH", body = """{"data":[{"id":9003,"deviceId":187,"hostname":"PC-COMPTA-03","osType":"windows","status":"failure","exitCode":1,"stdout":null,"stderr":"refusé","triggeredAt":"2026-09-25T08:42:02.000Z","startedAt":"2026-09-25T08:42:03.200Z","finishedAt":"2026-09-25T08:42:08.000Z"}]}""")
        prod.on("GET /api/executions/9003", body = """{"data":{"id":9003,"tenantId":4,"scriptId":41,"deviceId":187,"scheduleId":null,"batchId":"$BATCH","commandQueueId":"c-1","scriptSnapshot":{"id":41,"name":"Nettoyer les fichiers temporaires","platform":"windows","runtime":"powershell","content":"x","timeoutSeconds":120,"runAs":"system"},"parameterValues":{"min_age_days":7},"status":"failure","triggeredBy":"manual","triggeredByUserId":3,"exitCode":1}}""")
        val r = remote()
        val page = (r.batches(id) as ApiOutcome.Ok).value
        assertEquals(1, page.items.single().failureCount)
        val rows = (r.batch(id, BATCH) as ApiOutcome.Ok).value
        assertEquals("9003", rows.single().id)
        assertEquals(1, rows.single().exitCode)
        val e = (r.execution(id, "9003") as ApiOutcome.Ok).value
        assertEquals("Nettoyer les fichiers temporaires", e.scriptSnapshot?.name)
        assertEquals(3L, e.triggeredByUserId)
    }

    @Test fun stopCancelScheduleAndScenarioWrites() = runBlocking {
        prod.on("POST /api/executions/9003/stop", body = """{"success":true}""")
        prod.on("POST /api/executions/9002/cancel", body = """{"success":true}""")
        prod.on("PATCH /api/schedules/7", body = """{"data":{"id":7,"tenantId":4,"scriptId":60,"name":"Vérif sauvegarde","enabled":false,"cronExpression":"0 2 * * *"}}""")
        prod.on("POST /api/scenarios/3/disable", body = """{"data":{"success":true}}""")
        prod.on("POST /api/scenarios/3/enable", body = """{"data":{"success":true}}""")
        prod.on("POST /api/scenarios/3/cancel-runs", body = """{"data":{"cancelled":2}}""")
        prod.on("POST /api/scenarios/3/start-graph-run", 202, """{"data":{"runIds":["r-9"],"runId":"r-9","batchMarker":"graph-run:batch:1"}}""")
        val r = remote()
        val none = JsonObject(emptyMap())
        assertEquals(ApiOutcome.Ok(Unit), r.stopExecution(id, "9003", none))
        assertEquals(ApiOutcome.Ok(Unit), r.cancelExecution(id, "9002", none))
        val s = r.setScheduleEnabled(id, 7, false, none)
        assertEquals(false, (s as ApiOutcome.Ok).value.enabled)
        assertEquals(Json.parseToJsonElement("""{"enabled":false}"""), prod.body("PATCH /api/schedules/7"))
        assertEquals(ApiOutcome.Ok(Unit), r.setScenarioEnabled(id, 3, false, none))
        assertEquals(ApiOutcome.Ok(Unit), r.setScenarioEnabled(id, 3, true, none))
        assertEquals(ApiOutcome.Ok(Unit), r.cancelScenarioRuns(id, 3, none))
        val started = r.startGraphRun(id, 3, listOf(185, 186), none)
        assertEquals(listOf("r-9"), (started as ApiOutcome.Accepted).value.runIds)
        assertEquals(Json.parseToJsonElement("""{"deviceIds":[185,186]}"""), prod.body("POST /api/scenarios/3/start-graph-run"))
    }

    @Test fun scenariosRunsAndRunDetail() = runBlocking {
        prod.on("GET /api/scenarios", body = """{"data":{"items":[{"id":3,"uuid":"u","tenantId":1,"name":"Déployer Obliview (Windows)","triggerType":"agent_approved","status":"active","nodeCount":4,"stepCount":4,"activeRunCount":2,"triggerCounts":{"agent_approved":1}}],"total":1}}""")
        prod.on("GET /api/scenarios/3/runs", body = """{"data":{"items":[{"id":"r-2","tenantId":4,"scenarioId":3,"deviceId":240,"triggerType":"agent_approved","status":"running","currentStep":0,"variables":{},"scenario":{"id":3,"name":"x"},"device":{"id":240,"hostname":"KIOSK-ACCUEIL-02","displayName":null,"osType":"windows"}}],"total":1}}""")
        prod.on("GET /api/scenarios/runs/r-2", body = """{"data":{"id":"r-2","scenarioId":3,"deviceId":240,"status":"running","stepRuns":[],"nodeRuns":[{"id":"n2","runId":"r-2","nodeId":12,"nodeType":"run_script","nodeLabel":"Installer","status":"success","exitCode":0,"stdout":"ok","stderr":null,"errorMessage":null,"startedAt":"2026-09-25T08:40:01.000Z","finishedAt":"2026-09-25T08:40:39.000Z"}]}}""")
        val r = remote()
        val page = (r.scenarios(id) as ApiOutcome.Ok).value
        assertEquals(2, page.items.single().activeRunCount)
        assertEquals(mapOf("agent_approved" to 1), page.items.single().triggerCounts)
        assertEquals("KIOSK-ACCUEIL-02", (r.scenarioRuns(id, 3) as ApiOutcome.Ok).value.items.single().device?.label)
        assertEquals("Installer", (r.scenarioRun(id, "r-2") as ApiOutcome.Ok).value.nodeRuns.single().nodeLabel)
    }

    @Test fun anExpiredSessionIsMarked() = runBlocking {
        prod.on("GET /api/schedules", 401, """{"success":false,"error":"Authentication required"}""")
        val r = remote()
        assertEquals(ApiOutcome.SessionExpired, r.schedules(id))
        assertEquals(AuthState.Expired, sessions.session(id)!!.auth.value)
    }
}
