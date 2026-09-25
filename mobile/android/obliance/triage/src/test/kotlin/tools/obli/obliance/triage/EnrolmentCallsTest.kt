package tools.obli.obliance.triage

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.shell.nav.Origins

/** The enrolment routes against the shapes of device.routes.ts, agent.controller.ts, groups and auth, through a real ObliHttp. */
class EnrolmentCallsTest {
    private val server = MockWebServer().apply { start() }
    private val calls = EnrolmentCalls(ObliHttp(Origins.of(server.url("/").toString())!!, ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA")))

    @After fun tearDown() = server.close()

    private fun answer(code: Int, body: String?) {
        val b = MockResponse.Builder().code(code)
        if (body != null) b.addHeader("Content-Type", "application/json; charset=utf-8").body(body)
        server.enqueue(b.build())
    }

    private val none = JsonObject(emptyMap())

    /** rowToDevice of KIOSK-ACCUEIL-02 (the fields the server sends, trimmed). */
    private fun deviceRow(approvalStatus: String, status: String, groupId: Int? = null) = """{"id":240,"uuid":"a1","tenantId":4,"tenantName":"ACME",
        "groupId":$groupId,"apiKeyId":12,"hostname":"KIOSK-ACCUEIL-02","displayName":null,"ipLocal":"10.0.3.41","ipPublic":"203.0.113.24",
        "osType":"windows","osName":"Windows 11 IoT Enterprise","osVersion":null,"osArch":"amd64","status":"$status","approvalStatus":"$approvalStatus",
        "geoLat":45.76,"geoLng":4.83,"geoCity":"Lyon","geoCountry":"FR","duplicateAgentIdSuspected":false,"createdAt":"2026-09-25T00:59:00.000Z",
        "latestMetrics":{},"customFields":{},"tags":[]}"""

    @Test fun pendingAsksTheFirst100PendingDevices() = runBlocking {
        answer(200, """{"success":true,"data":{"items":[${deviceRow("pending", "pending")}],"total":1,"page":1,"pageSize":100}}""")
        val items = (calls.pending() as ApiOutcome.Ok).value
        val d = items.single()
        assertEquals(240L, d.id)
        assertEquals(12L, d.apiKeyId)
        assertEquals("Lyon", d.geoCity)
        assertEquals("FR", d.geoCountry)
        assertEquals(4L, d.tenantId)
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("/api/devices", req.url.encodedPath)
        assertEquals("pending", req.url.queryParameter("approvalStatus"))
        assertEquals("100", req.url.queryParameter("pageSize"))
        assertEquals("1", req.url.queryParameter("page"))
    }

    @Test fun approveSendsTheStepUpFieldsAndDecodesTheDevice() = runBlocking {
        answer(200, """{"data":${deviceRow("approved", "offline")}}""")
        val extra = buildJsonObject { put("twoFactorCode", JsonPrimitive("123456")) }
        val out = calls.approve(240, extra)
        assertEquals("approved", (out as ApiOutcome.Ok).value.device?.approvalStatus)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/devices/240/approve", req.url.encodedPath)
        assertEquals("123456", Json.parseToJsonElement(req.body!!.utf8()).jsonObject["twoFactorCode"]!!.jsonPrimitive.content)
    }

    @Test fun aNullDataIsAnAnswerNotAFailure() = runBlocking {
        // A device of another tenant seen from a child session: getDeviceById returns null, the route answers 200.
        answer(200, """{"data":null}""")
        val out = calls.refuse(240, none)
        assertNull((out as ApiOutcome.Ok).value.device)
        assertEquals("/api/devices/240/refuse", server.takeRequest().url.encodedPath)
    }

    @Test fun bulkCarriesExactlyTheIds() = runBlocking {
        answer(200, """{"success":true,"count":2}""")
        assertEquals(ApiOutcome.Ok(Unit), calls.bulkApprove(listOf(240, 241), none))
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/devices/bulk/approve", req.url.encodedPath)
        val body = Json.parseToJsonElement(req.body!!.utf8()).jsonObject
        assertEquals(setOf("ids"), body.keys)
        assertEquals(listOf(240L, 241L), body["ids"]!!.jsonArray.map { it.jsonPrimitive.content.toLong() })
    }

    @Test fun movePatchesTheGroup() = runBlocking {
        answer(200, """{"data":${deviceRow("approved", "offline", groupId = 44)}}""")
        val out = calls.move(240, 44, none)
        assertEquals(44L, (out as ApiOutcome.Ok).value.device?.groupId)
        val req = server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("/api/devices/240", req.url.encodedPath)
        assertEquals(mapOf("groupId" to "44"), Json.parseToJsonElement(req.body!!.utf8()).jsonObject.mapValues { it.value.jsonPrimitive.content })
    }

    @Test fun keysNeverKeepTheSecret() = runBlocking {
        val secret = "9b1c4e7f2a6d8035c1e9f4b2a7d6c3e0f5a8b1c4d7e0f3a6b9c2d5e8f1a4b7c0"
        answer(200, """{"success":true,"data":[{"id":12,"tenantId":4,"name":"Site Siège","key":"$secret","defaultGroupId":44,"defaultGroupName":"Accueil","deviceCount":17}]}""")
        val keys = (calls.keys() as ApiOutcome.Ok).value
        assertEquals(listOf(AgentKeyInfo(12, 4, "Site Siège", 44, "Accueil")), keys)
        assertFalse(keys.toString().contains(secret))
        assertEquals("/api/agent/keys", server.takeRequest().url.encodedPath)
    }

    @Test fun groupsAndPermissions() = runBlocking {
        answer(200, """{"success":true,"data":[{"id":40,"tenantId":4,"tenantName":"ACME","parentId":null,"name":"Siège","slug":"siege"},
            {"id":44,"tenantId":4,"tenantName":"ACME","parentId":40,"name":"Accueil","slug":"accueil"}]}""")
        val groups = (calls.groups() as ApiOutcome.Ok).value
        assertEquals("Siège › Accueil", GroupPaths.of(groups)[44])
        assertEquals("/api/groups", server.takeRequest().url.encodedPath)

        answer(200, """{"success":true,"data":{"canCreate":false,"teams":[2],"permissions":{"group:40":"rw"},"tenantCapabilities":["agent_config:approval","devices.manage"]}}""")
        assertTrue(CAP_APPROVAL in (calls.tenantCapabilities() as ApiOutcome.Ok).value)
        assertEquals("/api/auth/permissions", server.takeRequest().url.encodedPath)
    }

    @Test fun sessionAndRightsFailures() = runBlocking {
        answer(401, """{"success":false,"error":"Authentication required"}""")
        assertEquals(ApiOutcome.SessionExpired, calls.pending())
        answer(403, """{"success":false,"error":"Insufficient permissions"}""")
        assertTrue(calls.approve(240, none) is ApiOutcome.Forbidden)
    }
}
