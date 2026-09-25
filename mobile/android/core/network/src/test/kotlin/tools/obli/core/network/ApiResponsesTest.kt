package tools.obli.core.network

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bodies as the Obliance server writes them (server/src, 5.1.x). */
class ApiResponsesTest {
    private val jsonType = "application/json; charset=utf-8"

    private fun raw(status: Int, body: String?, type: String? = jsonType, retryAfter: String? = null) =
        ApiResponses.classify(status, type, body, retryAfter) { it }

    private fun idOf(e: JsonElement?) = ((ApiResponses.unwrap(e) as? JsonObject)?.get("id"))?.jsonPrimitive?.long

    @Test fun okEnvelopeA() {
        val out = ApiResponses.classify(200, jsonType, """{"success":true,"data":{"id":12}}""") { idOf(it) }
        assertEquals(ApiOutcome.Ok(12L), out)
    }

    @Test fun okEnvelopeBAndRaw() {
        assertEquals(ApiOutcome.Ok(12L), ApiResponses.classify(200, jsonType, """{"data":{"id":12}}""") { idOf(it) })
        assertEquals(ApiOutcome.Ok(12L), ApiResponses.classify(200, jsonType, """{"id":12,"data":{"id":3}}""") { idOf(it) })
    }

    @Test fun noContent() = assertEquals(ApiOutcome.Ok(Unit), ApiResponses.classify(204, null, null) { Unit })

    @Test fun htmlOnApiIsNotJson() {
        val out = raw(200, "<!doctype html><html></html>", "text/html")
        assertEquals(ApiOutcome.Failure(200, FailureKind.NOT_JSON), out)
        assertEquals(ApiOutcome.Failure(200, FailureKind.NOT_JSON), raw(200, "{broken"))
    }

    @Test fun unexpectedShapeIsServerFailure() {
        val out = ApiResponses.classify(200, jsonType, """{"data":[]}""") { idOf(it) }
        assertEquals(ApiOutcome.Failure(200, FailureKind.SERVER), out)
    }

    @Test fun acceptedApprovalVersusAcceptedExecutions() {
        assertEquals(ApiOutcome.PendingApproval(41), raw(202, """{"data":{"approvalId":41,"status":"pending_approval"}}"""))
        val exec = ApiResponses.classify(202, jsonType, """{"data":[{"id":1},{"id":2},{"id":3}]}""") {
            (ApiResponses.unwrap(it) as? JsonArray)?.size
        }
        assertEquals(ApiOutcome.Accepted(3), exec)
        assertFalse(ApiOutcome.PendingApproval(41).isSuccess)
        assertTrue(exec.isSuccess)
    }

    @Test fun stepUp() {
        val out = raw(401, """{"error":"twoFactorCode required","twoFactorRequired":true,"action":"script.execute_manual","currentIp":"92.184.107.21"}""")
        assertEquals(ApiOutcome.StepUpRequired("script.execute_manual", "92.184.107.21"), out)
        assertEquals(ApiOutcome.StepUpRejected, raw(401, """{"error":"Invalid 2FA code"}"""))
        assertEquals(ApiOutcome.SessionExpired, raw(401, """{"success":false,"error":"Authentication required"}"""))
        assertEquals(ApiOutcome.SessionExpired, raw(401, null, null))
    }

    @Test fun forbiddenReasons() {
        val cap = raw(403, """{"success":false,"error":"Capability 'power' not permitted for your team"}""")
        assertEquals(ForbiddenReason.CAPABILITY, (cap as ApiOutcome.Forbidden).reason)
        assertEquals("power", cap.capability)
        val totp = raw(403, """{"error":"This action is marked sensitive — enable TOTP 2FA on your profile before you can use it."}""")
        assertEquals(ForbiddenReason.NO_TOTP, (totp as ApiOutcome.Forbidden).reason)
        val path = raw(403, """{"error":"This action is restricted but no approval path is configured."}""")
        assertEquals(ForbiddenReason.NO_APPROVAL_PATH, (path as ApiOutcome.Forbidden).reason)
        assertEquals(ForbiddenReason.OTHER, (raw(403, "{}") as ApiOutcome.Forbidden).reason)
    }

    @Test fun privacyLock() {
        val feature = raw(423, """{"success":false,"error":"Privacy mode is active — unlock required for feature 'remote'"}""")
        assertEquals(ApiOutcome.PrivacyLocked("remote", false, "Privacy mode is active — unlock required for feature 'remote'"), feature)
        val pwd = raw(423, """{"success":false,"error":"Privacy password is set — use /privacy/disable-with-password"}""") as ApiOutcome.PrivacyLocked
        assertTrue(pwd.passwordSet)
    }

    @Test fun otherStatuses() {
        assertEquals(ApiOutcome.Unsupported("Cannot determine the latest agent version (agent/VERSION missing)."),
            raw(409, """{"error":"Cannot determine the latest agent version (agent/VERSION missing)."}"""))
        assertEquals(ApiOutcome.RateLimited(30), raw(429, """{"error":"Too many"}""", retryAfter = "30"))
        assertEquals(ApiOutcome.RateLimited(null), raw(429, null, null, retryAfter = "Wed, 21 Oct 2026 07:28:00 GMT"))
        assertEquals(ApiOutcome.AgentOffline("Agent offline"), raw(503, """{"error":"Agent offline"}"""))
        assertEquals(ApiOutcome.Failure(404, FailureKind.NOT_FOUND, "Device not found"), raw(404, """{"success":false,"error":"Device not found"}"""))
        assertEquals(ApiOutcome.Failure(500, FailureKind.SERVER, "Internal server error"), raw(500, """{"success":false,"error":"Internal server error"}"""))
        assertEquals(ApiOutcome.Failure(502, FailureKind.SERVER), raw(502, "<html>Bad gateway</html>", "text/html"))
        assertEquals(ApiOutcome.Failure(418, FailureKind.CLIENT), raw(418, null, null))
        assertEquals(ApiOutcome.Failure(null, FailureKind.NETWORK, "timeout"), ApiResponses.network("timeout"))
    }

    @Test fun validationDetails() {
        val out = raw(400, """{"success":false,"error":"Validation failed","details":{"name":["Required"],"cron":["Invalid","Too short"],"x":"odd"}}""")
        assertEquals(ApiOutcome.Validation("Validation failed", mapOf("name" to listOf("Required"), "cron" to listOf("Invalid", "Too short"))), out)
    }
}
