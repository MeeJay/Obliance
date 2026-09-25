package tools.obli.obliance.devices

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.shell.nav.Origins

/** The command routes, against the shapes of command.routes.ts / device.routes.ts, through a real ObliHttp. */
class CommandCallsTest {
    private val server = MockWebServer().apply { start() }
    private val calls = CommandCalls(ObliHttp(Origins.of(server.url("/").toString())!!, ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA")))

    @After fun tearDown() = server.close()

    private fun answer(code: Int, body: String?) {
        val b = MockResponse.Builder().code(code)
        if (body != null) b.addHeader("Content-Type", "application/json; charset=utf-8").body(body)
        server.enqueue(b.build())
    }

    private fun sentBody(): JsonObject = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject

    private val commandRow = """{"data":{"id":"5f0c","deviceId":187,"tenantId":4,"type":"reboot","payload":{},"status":"pending","priority":"normal",
        "sentAt":null,"ackedAt":null,"finishedAt":null,"expiresAt":"2026-09-25T01:27:00.000Z","result":{},"retryCount":0,"maxRetries":0,
        "sourceType":null,"sourceId":null,"createdBy":3,"createdAt":"2026-09-25T01:22:00.000Z","updatedAt":"2026-09-25T01:22:00.000Z","durationMs":null}}"""

    @Test fun enqueueSendsTheWebBodyAndDecodesTheCommand() = runBlocking {
        answer(200, commandRow)
        val out = calls.enqueue(187, "reboot", JsonObject(emptyMap()), "normal", JsonObject(emptyMap()))
        val cmd = (out as ApiOutcome.Ok).value
        assertEquals("5f0c", cmd.id)
        assertEquals(CommandState.PENDING, cmd.state)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/commands", req.url.encodedPath)
        val body = Json.parseToJsonElement(req.body!!.utf8()).jsonObject
        assertEquals(setOf("deviceId", "type", "payload", "priority"), body.keys)
        assertEquals(187L, body["deviceId"]!!.jsonPrimitive.content.toLong())
        assertEquals("reboot", body["type"]!!.jsonPrimitive.content)
        assertEquals(JsonObject(emptyMap()), body["payload"])
        assertEquals("normal", body["priority"]!!.jsonPrimitive.content)
    }

    @Test fun stepUpFieldsAreMergedIntoTheSameBody() = runBlocking {
        answer(401, """{"success":false,"error":"Two-factor verification required","twoFactorRequired":true,"action":"command.kill_process","currentIp":"92.184.107.21"}""")
        val payload = buildJsonObject { put("pid", JsonPrimitive(7312)); put("name", JsonPrimitive("EBP.Compta.exe")) }
        val first = calls.enqueue(187, "kill_process", payload, "high", JsonObject(emptyMap()))
        assertEquals(ApiOutcome.StepUpRequired("command.kill_process", "92.184.107.21"), first)
        sentBody()
        answer(200, commandRow)
        calls.enqueue(187, "kill_process", payload, "high", buildJsonObject { put("twoFactorCode", JsonPrimitive("123456")) })
        val body = sentBody()
        assertEquals("123456", body["twoFactorCode"]!!.jsonPrimitive.content)
        assertEquals(payload, body["payload"])
        assertEquals("high", body["priority"]!!.jsonPrimitive.content)
    }

    @Test fun pendingApprovalAndLegacyRefusal() = runBlocking {
        answer(202, """{"success":true,"data":{"approvalId":42,"status":"pending_approval"}}""")
        assertEquals(ApiOutcome.PendingApproval(42), calls.enqueue(187, "shutdown", JsonObject(emptyMap()), "normal", JsonObject(emptyMap())))
        answer(409, """{"success":false,"error":"Command \"open_remote_tunnel\" is not supported on the legacy agent"}""")
        assertTrue(calls.enqueue(205, "open_remote_tunnel", JsonObject(emptyMap()), "normal", JsonObject(emptyMap())) is ApiOutcome.Unsupported)
    }

    @Test fun listCancelServicesAndAirgapPaths() = runBlocking {
        answer(200, """{"data":{"items":[${commandRow.substringAfter("{\"data\":").dropLast(1)},{"id":"x","status":42,"payload":"bad"}],"total":2}}""")
        val page = (calls.list(187) as ApiOutcome.Ok).value
        assertEquals(2, page.total)
        assertEquals(listOf("5f0c"), page.items.map { it.id }.filter { it == "5f0c" })
        val list = server.takeRequest()
        assertEquals("GET", list.method)
        assertEquals("/api/commands", list.url.encodedPath)
        assertEquals("187", list.url.queryParameter("deviceId"))
        assertEquals("50", list.url.queryParameter("limit"))

        answer(204, null)
        assertEquals(ApiOutcome.Ok(Unit), calls.cancel("5f0c", JsonObject(emptyMap())))
        val cancel = server.takeRequest()
        assertEquals("DELETE", cancel.method)
        assertEquals("/api/commands/5f0c", cancel.url.encodedPath)

        answer(200, """{"data":[{"name":"Spooler","displayName":"Spouleur d'impression","status":"stopped","startType":"auto","runAsUser":"LocalSystem"}]}""")
        val services = (calls.services(187) as ApiOutcome.Ok).value
        assertEquals("Spouleur d'impression", services.single().label)
        assertTrue(services.single().automatic && services.single().stopped)
        assertEquals("/api/devices/187/services", server.takeRequest().url.encodedPath)

        answer(200, """{"data":null}""")
        assertEquals(ApiOutcome.Ok(emptyList<ServiceInfo>()), calls.services(211))
        server.takeRequest()

        answer(200, """{"data":{"success":true}}""")
        assertEquals(ApiOutcome.Ok(Unit), calls.airgap(187, enable = true, extra = JsonObject(emptyMap())))
        val airgap = server.takeRequest()
        assertEquals("POST", airgap.method)
        assertEquals("/api/devices/187/airgap/enable", airgap.url.encodedPath)
    }
}
