package tools.obli.obliance.api

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.shell.alerts.AlertSeverity
import tools.obli.shell.nav.Origins

/** Every call against recorded server shapes (fixtures/), through a real ObliHttp. */
class ObliApiTest {
    private val server = MockWebServer().apply { start() }
    private val http = ObliHttp(Origins.of(server.url("/").toString())!!, ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA"))

    @After fun tearDown() = server.close()

    private fun fixture(name: String): String =
        requireNotNull(javaClass.getResource("/fixtures/$name")) { "missing fixture $name" }.readText()

    private fun answer(code: Int, body: String) {
        server.enqueue(MockResponse.Builder().code(code).addHeader("Content-Type", "application/json; charset=utf-8").body(body).build())
    }

    private fun <T> ok(out: ApiOutcome<T>): T {
        assertTrue("expected Ok, got $out", out is ApiOutcome.Ok)
        return (out as ApiOutcome.Ok).value
    }

    @Test fun healthAndSsoConfig() = runBlocking {
        answer(200, fixture("health.json"))
        val health = ok(AuthApi(http).health())
        assertTrue(health.isOk)
        assertEquals("5.1.110", health.version)
        assertEquals("/health", server.takeRequest().url.encodedPath)

        answer(200, fixture("sso-config.json"))
        val sso = ok(AuthApi(http).ssoConfig())
        assertTrue(sso.offersObligate)
        assertEquals("https://id.example.org", sso.obligateUrl)
    }

    @Test fun loginWithTwoFactorThenVerify() = runBlocking {
        val api = AuthApi(http)
        answer(200, fixture("login-2fa.json"))
        val step = api.login(" karim.benali ", "secret")
        assertEquals(LoginResult.TwoFactorRequired(TwoFactorMethods(totp = true, email = false)), step)
        val login = server.takeRequest()
        assertEquals("POST", login.method)
        assertEquals("/api/auth/login", login.url.encodedPath)
        val sent = Json.parseToJsonElement(login.body!!.utf8()).jsonObject
        assertEquals("karim.benali", sent["username"]!!.jsonPrimitive.content)

        answer(401, """{"success":false,"error":"Invalid code"}""")
        assertEquals(LoginResult.InvalidCode, api.verifyTwoFactor(TwoFactorMethod.TOTP, "123 456"))
        val verify = server.takeRequest()
        assertEquals("/api/profile/2fa/verify", verify.url.encodedPath)
        val body = Json.parseToJsonElement(verify.body!!.utf8()).jsonObject
        assertEquals("123456", body["code"]!!.jsonPrimitive.content)
        assertEquals("totp", body["method"]!!.jsonPrimitive.content)

        answer(200, fixture("login-ok.json"))
        val done = api.verifyTwoFactor(TwoFactorMethod.TOTP, "123456") as LoginResult.SignedIn
        assertEquals("Karim Benali", done.user.label)
        assertFalse(done.user.isPlatformAdmin)

        answer(400, """{"success":false,"error":"No pending 2FA session"}""")
        assertEquals(LoginResult.TwoFactorSessionLost, api.verifyTwoFactor(TwoFactorMethod.TOTP, "123456"))
    }

    @Test fun loginOutcomes() = runBlocking {
        val api = AuthApi(http)
        answer(200, fixture("login-ok.json"))
        assertTrue(api.login("karim.benali", "secret") is LoginResult.SignedIn)
        answer(401, """{"success":false,"error":"Invalid username or password"}""")
        assertEquals(LoginResult.InvalidCredentials, api.login("karim.benali", "wrong"))
        server.enqueue(MockResponse.Builder().code(429).addHeader("Retry-After", "60").body("Too many requests").build())
        assertEquals(LoginResult.RateLimited(60), api.login("karim.benali", "wrong"))
    }

    @Test fun tenantsAndSwitch() = runBlocking {
        answer(200, fixture("tenants.json"))
        val tenants = ok(TenantsApi(http).list())
        assertEquals(listOf("Default", "ACME"), tenants.map { it.name })
        assertTrue(tenants[0].isMaster)
        assertEquals("admin", tenants[1].role)
        assertTrue(tenants[1].twoStepApproval)

        answer(200, """{"success":true,"data":{"currentTenantId":4}}""")
        assertEquals(4L, ok(TenantsApi(http).switchTo(4)).currentTenantId)
        server.takeRequest()
        val switch = server.takeRequest()
        assertEquals("/api/tenant/switch", switch.url.encodedPath)
        assertEquals("""{"tenantId":4}""", switch.body!!.utf8())
    }

    @Test fun liveAlertsFeedAndActions() = runBlocking {
        val api = AlertsApi(http)
        answer(200, fixture("live-alerts-all.json"))
        val feed = ok(api.all())
        assertEquals(4, feed.alerts.size)
        assertEquals(listOf(1L, 4L), feed.tenants.map { it.id })
        val first = feed.alerts.first()
        assertEquals(9812L, first.id)
        assertEquals(AlertSeverity.CRITICAL, first.severity)
        assertEquals("ACME", first.tenantName)
        assertEquals("/devices/211", first.navigateTo)
        assertNotNull(feed.alerts.last().readAt)
        server.takeRequest()

        answer(200, """{"ok":true}""")
        ok(api.markRead(9812))
        val patch = server.takeRequest()
        assertEquals("PATCH", patch.method)
        assertEquals("/api/live-alerts/9812/read", patch.url.encodedPath)

        answer(200, """{"ok":true}""")
        ok(api.delete(9812))
        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method)
        assertEquals("/api/live-alerts/9812", delete.url.encodedPath)

        answer(404, """{"error":"Alert not found"}""")
        assertTrue(api.markRead(1) is ApiOutcome.Failure)
    }

    @Test fun notificationPayload() {
        val payload = Json.parseToJsonElement(
            """{"id":9820,"tenantId":1,"tenantName":"Default","severity":"critical","title":"SRV-QUAL01: Hors ligne","message":"Aucun push reçu depuis 5 min.","navigateTo":"/devices/5","stableKey":"device:5:offline","readAt":null,"createdAt":"2026-09-25T00:58:00.000Z"}""",
        )
        val alert = AlertsApi.decodeNotification(payload)!!
        assertEquals(9820L, alert.id)
        assertEquals("SRV-QUAL01: Hors ligne", alert.title)
        assertNull(AlertsApi.decodeNotification(null))
    }

    @Test fun approvals() = runBlocking {
        val api = ApprovalsApi(http)
        answer(200, fixture("approvals.json"))
        val list = ok(api.list())
        assertEquals(1, list.size)
        val a = list.first()
        assertTrue(a.isPending)
        assertEquals("device_uninstall", a.requestType)
        assertEquals(listOf(233L), a.deviceIds)
        assertEquals("og_julien.moreau", a.requestedByName)
        val listed = server.takeRequest()
        assertEquals("/api/approvals", listed.url.encodedPath)
        assertEquals("50", listed.url.queryParameter("limit"))

        answer(200, """{"data":${Json.parseToJsonElement(fixture("approvals.json")).jsonObject["data"]!!.let { (it as kotlinx.serialization.json.JsonArray)[0] }}}""")
        val step = kotlinx.serialization.json.buildJsonObject { put("twoFactorCode", kotlinx.serialization.json.JsonPrimitive("654321")) }
        ok(api.approve(17, reason = null, extra = step))
        val approve = server.takeRequest()
        assertEquals("/api/approvals/17/approve", approve.url.encodedPath)
        assertEquals("""{"twoFactorCode":"654321"}""", approve.body!!.utf8())

        answer(409, """{"success":false,"error":"Already approved"}""")
        assertTrue(api.deny(17, "doublon") is ApiOutcome.Unsupported)
        assertEquals("""{"reason":"doublon"}""", server.takeRequest().body!!.utf8())
    }

    @Test fun devicesPageTolerantNumbers() = runBlocking {
        answer(200, fixture("devices-page.json"))
        val page = ok(DevicesApi(http).list(DeviceQuery(search = "PC COMPTA", status = "connected", sortBy = DeviceSort.STATUS, tenantIds = listOf(4))))
        val request = server.takeRequest()
        assertEquals("/api/devices", request.url.encodedPath)
        assertEquals("PC COMPTA", request.url.queryParameter("search"))
        assertEquals("connected", request.url.queryParameter("status"))
        assertEquals("status", request.url.queryParameter("sortBy"))
        assertEquals("4", request.url.queryParameter("tenantIds"))

        assertEquals(312, page.total)
        assertTrue(page.hasMore)
        val compta = page.items[0]
        assertEquals("PC-COMPTA-03", compta.label)
        assertEquals(DeviceStatus.CRITICAL, compta.statusKind)
        assertEquals(15.9, compta.ramTotalGb!!, 0.001) // PostgreSQL decimal arrives as "15.90"
        assertEquals(98.0, compta.latestMetrics!!.cpu!!.percent!!, 0.0)
        assertEquals("C:", compta.latestMetrics!!.disks.single().mount)
        assertEquals("Comptabilité", compta.groupName)
        assertTrue(compta.rebootPending)
        val ad = page.items[1]
        assertEquals("SRV-AD2", ad.label) // empty display name falls back to the hostname
        assertTrue(ad.latestMetrics!!.isEmpty)
        assertEquals(DeviceStatus.OFFLINE, ad.statusKind)
    }

    @Test fun devicePageSizeIsCappedAtTheServersOwnLimit() {
        assertTrue(DeviceQuery(pageSize = 2000).toPath().contains("pageSize=2000"))
        assertTrue(DeviceQuery(pageSize = 50_000).toPath().contains("pageSize=10000"))
        assertTrue(DeviceQuery(pageSize = 0).toPath().endsWith("pageSize=1"))
    }

    @Test fun summaryDetailAndLiveMode() = runBlocking {
        val api = DevicesApi(http)
        answer(200, fixture("devices-summary.json"))
        val s = ok(api.summary())
        assertEquals(312, s.total)
        assertEquals(296, s.connected)
        assertEquals(3, s.deltas.totalVsYesterday)
        assertNull(s.deltas.staleVsYesterday)
        assertEquals(226, s.osConnectivity["windows"]!!.online)
        server.takeRequest()

        answer(404, """{"error":"Device not found"}""")
        val missing = api.detail(999)
        assertTrue(missing is ApiOutcome.Failure)
        server.takeRequest()

        answer(200, """{"data":{"sent":true,"mode":"live","windowSec":60}}""")
        val ack = ok(api.requestLiveMetrics(187))
        assertTrue(ack.sent)
        val live = server.takeRequest()
        assertEquals("/api/devices/187/live-metrics", live.url.encodedPath)
        assertEquals("""{"mode":"live","windowSec":60}""", live.body!!.utf8())
    }

    @Test fun socketPayloads() {
        val push = DevicesApi.decodeMetricsPush(Json.parseToJsonElement(fixture("metrics-pushed.json")))!!
        assertEquals(187L, push.deviceId)
        assertEquals(97.4, push.metrics.cpu!!.percent!!, 0.0)
        // Legacy callers stringify the metrics.
        val legacy = DevicesApi.decodeMetricsPush(Json.parseToJsonElement("""{"deviceId":187,"metrics":"{\"cpu\":{\"percent\":12}}"}"""))!!
        assertEquals(12.0, legacy.metrics.cpu!!.percent!!, 0.0)
        assertEquals(DeviceStatus.ONLINE, DevicesApi.decodeDeviceSignal("DEVICE_UPDATED", Json.parseToJsonElement("""{"deviceId":211,"status":"online"}"""))!!.status)
        assertEquals(211L, DevicesApi.decodeDeviceSignal("DEVICE_DELETED", Json.parseToJsonElement("""{"id":211}"""))!!.deviceId)
        assertEquals(DeviceStatus.UNKNOWN, DeviceStatus.parse("hibernating"))
    }

    @Test fun locateDevice() = runBlocking {
        answer(200, """{"data":{"deviceId":211,"hostname":"SRV-AD2","displayName":null,"tenantId":4,"tenantName":"ACME","tenantSlug":"acme","currentTenantId":1}}""")
        val loc = ok(TenantsApi(http).locateDevice(211))
        assertEquals("SRV-AD2", loc.label)
        assertEquals(4L, loc.tenantId)
        assertEquals("/api/tenants/locate-device/211", server.takeRequest().url.encodedPath)
    }
}
