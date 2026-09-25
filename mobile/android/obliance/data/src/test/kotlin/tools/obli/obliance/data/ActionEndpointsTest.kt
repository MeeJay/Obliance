package tools.obli.obliance.data

import kotlinx.coroutines.runBlocking
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerSession
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.core.security.PrivacyUnlockResult

/** S43 cancel and S44 unlock over the item's own server (privacyGate.routes.ts, approval.routes.ts). */
class ActionEndpointsTest {
    private val server = FakeServer()
    private val session = ServerSession(
        ServerId("prod"),
        { ServerProfile(ServerId("prod"), "https://obliance-prod.example.org", "Obliance Prod", ServerColor.VIOLET, "OP", 0) },
        ObliHttp(server.origin, ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA")),
        { FakeRealtime() },
    )
    private val endpoints = session.actionEndpoints(deviceId = 233)

    @After fun tearDown() = server.close()

    @Test fun unlockReturnsTheTtl() = runBlocking {
        server.on("POST /api/devices/233/privacy/unlock", body = """{"data":{"unlocked":true,"feature":"remote","ttlSeconds":900}}""")
        assertEquals(PrivacyUnlockResult.Unlocked(900), endpoints.unlockPrivacy("remote", "secret"))
    }

    @Test fun wrongPasswordIsNotAnExpiredSession() = runBlocking {
        server.on("POST /api/devices/233/privacy/unlock", 401, """{"success":false,"error":"Incorrect password"}""")
        server.on("GET /api/auth/me", body = ME_USER)
        assertEquals(PrivacyUnlockResult.WrongPassword, endpoints.unlockPrivacy("remote", "nope"))
        assertEquals(true, session.auth.value is AuthState.SignedIn)
    }

    @Test fun lostSessionIsReported() = runBlocking {
        server.on("POST /api/devices/233/privacy/unlock", 401, """{"error":"Authentication required"}""")
        server.on("GET /api/auth/me", 401, """{"error":"Authentication required"}""")
        assertEquals(PrivacyUnlockResult.SessionExpired, endpoints.unlockPrivacy("remote", "x"))
        assertEquals(AuthState.Expired, session.auth.value)
    }

    @Test fun serverRefusalsAreMapped() = runBlocking {
        server.on("POST /api/devices/233/privacy/unlock", 400, """{"success":false,"error":"No privacy password is set on this device"}""")
        assertEquals(PrivacyUnlockResult.NoPasswordSet, endpoints.unlockPrivacy("scripts", "x"))
        server.on("POST /api/devices/233/privacy/unlock", 429, """{"success":false,"error":"Too many password attempts, retry in a minute"}""")
        assertEquals(PrivacyUnlockResult.TooManyAttempts, endpoints.unlockPrivacy("scripts", "x"))
        server.on("POST /api/devices/233/privacy/unlock", 503, """{"success":false,"error":"Agent is offline"}""")
        assertEquals(PrivacyUnlockResult.DeviceOffline, endpoints.unlockPrivacy("scripts", "x"))
    }

    @Test fun cancelApproval() = runBlocking {
        server.on("POST /api/approvals/41/cancel", body = """{"data":{"id":41,"status":"cancelled"}}""")
        assertEquals(ApiOutcome.Ok(Unit), endpoints.cancelApproval(41))
        assertEquals(1, server.count("POST /api/approvals/41/cancel"))
    }
}
