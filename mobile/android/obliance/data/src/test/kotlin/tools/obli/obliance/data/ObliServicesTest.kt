package tools.obli.obliance.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.api.TwoFactorMethod

/**
 * The repositories against two fake servers. Registry origins are https (the
 * registry refuses http); the session factory binds each profile to its
 * MockWebServer, the way the app binds it to its real origin.
 */
class ObliServicesTest {
    private val prod = FakeServer()
    private val qual = FakeServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val client = ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA")
    private val realtimes = java.util.concurrent.ConcurrentHashMap<ServerId, FakeRealtime>()
    private val cleared = mutableListOf<String>()

    /** Realtimes that follow connect / disconnect (the foreground tests). */
    private var statefulRealtime = false

    private val prodId = ServerId("prod")
    private val qualId = ServerId("qual")
    private val prodOrigin = "https://obliance-prod.example.org"
    private val qualOrigin = "https://obliance-qual.example.org"
    private val mockOf = mapOf(prodOrigin to prod, qualOrigin to qual)

    private class MemoryStore(var saved: ServerRegistryState?) : ServerRegistryStore {
        override suspend fun load() = saved
        override suspend fun save(state: ServerRegistryState) { saved = state }
    }

    private fun services(): DefaultObliServices = runBlocking {
        val registry = ServerRegistry(
            MemoryStore(
                ServerRegistryState(
                    listOf(
                        ServerProfile(prodId, prodOrigin, "Obliance Prod", ServerColor.VIOLET, "OP", 0),
                        ServerProfile(qualId, qualOrigin, "Obliance Qual", ServerColor.FUCHSIA, "OQ", 1),
                    ),
                    prodId,
                ),
            ),
        )
        registry.load()
        val sessions = ServerSessions(registry, { p, now ->
            val rt = FakeRealtime(statefulRealtime).also { realtimes[p.id] = it }
            ServerSession(p.id, now, ObliHttp(mockOf.getValue(p.origin).origin, client), { rt })
        }, scope)
        DefaultObliServices(
            registry, sessions,
            httpFor = { origin -> ObliHttp(mockOf[origin]?.origin ?: origin, client) },
            clearCookies = { cleared += it },
            scope = scope,
        )
    }

    @After fun tearDown() {
        scope.cancel()
        prod.close()
        qual.close()
    }

    @Test fun triageAggregatesEveryServerWithItsOwnId() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        prod.on("GET /api/live-alerts/all", body = alertsJson(Triple(9812, "critical", "SRV-AD2: Hors ligne"), Triple(9790, "warning", "BOB01: Alerte")))
        prod.on("GET /api/approvals", body = """{"data":[{"id":17,"tenantId":4,"requestType":"device_uninstall","description":"x","payload":{"deviceId":233},"status":"pending"}]}""")
        qual.on("GET /api/auth/me", body = ME_USER)
        qual.on("GET /api/live-alerts/all", body = alertsJson(Triple(512, "critical", "SRV-QUAL01: Hors ligne")))

        val s = services()
        s.alerts.refresh()
        val snap = s.alerts.snapshot.value
        assertEquals(setOf(9812L to prodId, 9790L to prodId, 512L to qualId), snap.alerts.map { it.alert.id to it.serverId }.toSet())
        // Approvals only for the server where the user is a platform admin.
        assertEquals(listOf(17L to prodId), snap.escalations.map { it.approval.id to it.serverId })
        assertEquals(0, qual.count("GET /api/approvals"))
        assertEquals(4, snap.badgeCount)
        assertEquals(listOf(FeedStatus.OK, FeedStatus.OK), snap.feeds.map { it.status })
        // The domain sort: the two critical ones first.
        assertEquals(setOf(9812L, 512L), snap.triage().unread.take(2).map { it.alert.id }.toSet())
    }

    @Test fun actionsGoToTheItemsOwnServer() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_USER)
        prod.on("GET /api/live-alerts/all", body = alertsJson(Triple(9812, "critical", "SRV-AD2: Hors ligne")))
        qual.on("GET /api/auth/me", body = ME_USER)
        qual.on("GET /api/live-alerts/all", body = alertsJson(Triple(512, "critical", "SRV-QUAL01: Hors ligne")))
        qual.on("PATCH /api/live-alerts/512/read", body = """{"ok":true}""")
        qual.on("DELETE /api/live-alerts/512", body = """{"ok":true}""")

        val s = services()
        s.alerts.refresh()
        val qualAlert = s.alerts.snapshot.value.alerts.single { it.serverId == qualId }
        assertEquals(ApiOutcome.Ok(Unit), s.alerts.markRead(qualAlert))
        assertEquals(1, qual.count("PATCH /api/live-alerts/512/read"))
        assertTrue(prod.requests.none { it.startsWith("PATCH") })
        assertTrue(s.alerts.snapshot.value.alerts.single { it.serverId == qualId }.alert.readAt != null)
        // The active server did not change.
        assertEquals(prodId, s.registry.state.value.activeId)

        assertEquals(ApiOutcome.Ok(Unit), s.alerts.delete(qualAlert))
        assertEquals(1, qual.count("DELETE /api/live-alerts/512"))
        assertTrue(s.alerts.snapshot.value.alerts.none { it.serverId == qualId })
    }

    @Test fun unauthorizedMarksOnlyThatServerExpired() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_USER)
        prod.on("GET /api/live-alerts/all", body = alertsJson(Triple(9812, "critical", "SRV-AD2: Hors ligne")))
        qual.on("GET /api/auth/me", body = ME_USER)
        qual.on("GET /api/live-alerts/all", 401, EXPIRED)

        val s = services()
        s.alerts.refresh()
        assertEquals(AuthState.Expired, s.sessions.session(qualId)!!.auth.value)
        assertTrue(s.sessions.session(prodId)!!.auth.value is AuthState.SignedIn)
        assertEquals(FeedStatus.EXPIRED, s.alerts.snapshot.value.feed(qualId)!!.status)
        assertEquals(FeedStatus.OK, s.alerts.snapshot.value.feed(prodId)!!.status)

        // Any repository call that answers 401 expires its session (S03 on the active server).
        prod.on("GET /api/devices", 401, EXPIRED)
        assertEquals(ApiOutcome.SessionExpired, s.devices.page(DeviceQuery()))
        assertEquals(AuthState.Expired, s.sessions.session(prodId)!!.auth.value)
        // An expired server is skipped by the next refresh (no call until signed in again).
        val before = qual.count("GET /api/live-alerts/all")
        s.alerts.refresh()
        assertEquals(before, qual.count("GET /api/live-alerts/all"))
    }

    @Test fun notificationOfTheActiveServerIsMergedWhileCollected() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_USER)
        prod.on("GET /api/live-alerts/all", body = alertsJson(Triple(9790, "warning", "BOB01: Alerte")))
        qual.on("GET /api/auth/me", body = ME_USER)
        qual.on("GET /api/live-alerts/all", body = alertsJson())
        val s = services()
        val collector = launch(Dispatchers.Default) { s.alerts.snapshot.collect { } }
        withTimeout(5_000) { s.alerts.snapshot.first { it.updatedAt != null } }
        val payload = Json.parseToJsonElement(
            """{"id":9812,"tenantId":4,"tenantName":"ACME","severity":"critical","title":"SRV-AD2: Hors ligne","message":"Aucun push reçu depuis 4 min.","navigateTo":"/devices/211","stableKey":null,"readAt":null,"createdAt":"2026-09-25T01:12:04.000Z"}""",
        )
        // Emit until the listener (started with the collector) has subscribed.
        withTimeout(5_000) {
            while (s.alerts.snapshot.value.alerts.none { it.alert.id == 9812L }) {
                realtimes.getValue(prodId).flow.emit(RealtimeEvent(ObliEvents.NOTIFICATION_NEW, payload))
                kotlinx.coroutines.delay(20)
            }
        }
        assertEquals(prodId, s.alerts.snapshot.value.alerts.single { it.alert.id == 9812L }.serverId)
        collector.cancel()
    }

    @Test fun openOnSwitchesAndReturnsThePreviousServer() = runBlocking {
        qual.on("GET /api/auth/me", body = ME_USER)
        val s = services()
        assertNull(s.openOn(prodId))
        assertEquals(prodId, s.openOn(qualId))
        assertEquals(qualId, s.registry.state.value.activeId)
        withTimeout(5_000) { s.sessions.active.first { it?.id == qualId } }
        assertTrue("connect" in realtimes.getValue(qualId).log)
        assertTrue("disconnect" in realtimes.getValue(prodId).log)
        assertNull(s.openOn(ServerId("unknown")))
    }

    /**
     * 0.3.0: the socket lives only in the foreground. A process started in the
     * background (notification worker, notification action, Quick Settings tile)
     * probes the active server but never connects; the app in front connects; a
     * quick trip to another app keeps the socket; a longer one closes it.
     */
    @Test fun socketOnlyInTheForeground() = runBlocking<Unit> {
        prod.on("GET /api/auth/me", body = ME_USER)
        statefulRealtime = true
        val s = services()
        val rt = realtimes.getValue(prodId)
        val foreground = MutableStateFlow(false)
        s.start(foreground, backgroundGraceMs = 300)

        // Background process: the startup probe runs, no socket.
        withTimeout(5_000) { s.sessions.session(prodId)!!.auth.first { it is AuthState.SignedIn } }
        delay(400)
        assertTrue("connect" !in rt.log)
        assertTrue(prod.count("GET /api/auth/me") >= 1)

        // The app comes to the front: connect.
        foreground.value = true
        withTimeout(5_000) { while ("connect" !in rt.log) delay(10) }

        // Back within the grace period: the socket stays.
        rt.log.clear()
        foreground.value = false
        delay(50)
        foreground.value = true
        delay(500)
        assertTrue("disconnect" !in rt.log)

        // Longer than the grace period: closed, and not reopened while in the background.
        foreground.value = false
        withTimeout(5_000) { while ("disconnect" !in rt.log) delay(10) }
        rt.log.clear()
        delay(400)
        assertTrue("connect" !in rt.log)

        // Front again: reconnects.
        foreground.value = true
        withTimeout(5_000) { while ("connect" !in rt.log) delay(10) }
    }

    /** Whatever reconnects the socket in the background (a tenant switch), the background rule closes it again. */
    @Test fun noSocketSurvivesInTheBackground() = runBlocking<Unit> {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        prod.on("POST /api/tenant/switch", body = """{"success":true,"data":{"currentTenantId":4}}""")
        statefulRealtime = true
        val s = services()
        val rt = realtimes.getValue(prodId)
        s.start(MutableStateFlow(false), backgroundGraceMs = 100)
        withTimeout(5_000) { s.sessions.session(prodId)!!.auth.first { it is AuthState.SignedIn } }
        assertEquals(ApiOutcome.Ok(Unit), s.tenants.switchTo(4))
        assertTrue("reconnect" in rt.log)
        // The reconnection is closed again at once (the process is in the background).
        withTimeout(5_000) { while (rt.log.lastIndexOf("disconnect") < rt.log.lastIndexOf("reconnect")) delay(10) }
        withTimeout(5_000) { rt.state.first { it == tools.obli.core.realtime.ConnectionState.DISCONNECTED } }
    }

    @Test fun tenantSwitchReprobesAndReconnects() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        prod.on("GET /api/tenants", body = """{"success":true,"data":[{"id":4,"name":"ACME","slug":"acme"},{"id":1,"name":"Default","slug":"default"}]}""")
        prod.on("POST /api/tenant/switch", body = """{"success":true,"data":{"currentTenantId":4}}""")
        val s = services()
        s.sessions.session(prodId)!!.probe()
        s.tenants.refresh()
        val scope1 = s.tenants.scope.first { it.tenants.isNotEmpty() }
        assertEquals(listOf("Default", "ACME"), scope1.tenants.map { it.name }) // master first
        assertTrue(scope1.isGlobalView)

        prod.on("GET /api/auth/me", body = ME_ADMIN.replace("\"currentTenantId\":1", "\"currentTenantId\":4"))
        assertEquals(ApiOutcome.Ok(Unit), s.tenants.switchTo(4))
        assertEquals(4L, s.tenants.scope.first { it.currentTenantId == 4L }.current!!.id)
        assertTrue("reconnect" in realtimes.getValue(prodId).log)
        assertEquals(4L, s.registry.state.value.byId(prodId)!!.lastTenantId)
    }

    @Test fun signInOfANewServerThenSignOut() = runBlocking {
        val devOrigin = "https://obliance-dev.example.org"
        FakeServer().use { dev ->
            dev.on("GET /health", body = """{"status":"ok","version":"5.1.108","timestamp":"2026-09-25T00:00:00.000Z"}""")
            dev.on("GET /api/auth/sso-config", body = """{"success":true,"data":{"obligateUrl":null,"obligateReachable":false,"obligateEnabled":false}}""")
            dev.on("POST /api/auth/login", body = """{"success":true,"data":{"requires2fa":true,"methods":{"totp":true,"email":false}}}""")
            dev.on("POST /api/profile/2fa/verify", body = """{"success":true,"data":{"user":{"id":7,"username":"karim.benali","role":"user"}}}""")
            dev.on("GET /api/auth/me", body = ME_USER)
            dev.on("POST /api/auth/logout", body = """{"success":true,"message":"Logged out"}""")
            val mocks = mockOf + (devOrigin to dev)
            val registry = ServerRegistry(MemoryStore(null)).also { it.load() }
            val sessions = ServerSessions(registry, { p, now ->
                val rt = FakeRealtime().also { realtimes[p.id] = it }
                ServerSession(p.id, now, ObliHttp(mocks.getValue(p.origin).origin, client), { rt })
            }, scope)
            val s = DefaultObliServices(registry, sessions, { ObliHttp(mocks[it]?.origin ?: it, client) }, { cleared += it }, scope)

            val check = s.auth.checkServer("obliance-dev.example.org") as ServerCheck.Ok
            assertEquals(devOrigin, check.origin)
            assertEquals("5.1.108", check.health.version)
            assertTrue(!check.sso.offersObligate)
            assertTrue(s.auth.checkServer("http://obliance-dev.example.org") is ServerCheck.Invalid)

            assertTrue(s.auth.login(devOrigin, "karim.benali", "secret") is tools.obli.obliance.api.LoginResult.TwoFactorRequired)
            assertTrue(s.auth.verifyTwoFactor(devOrigin, TwoFactorMethod.TOTP, "123456") is tools.obli.obliance.api.LoginResult.SignedIn)
            val done = s.auth.completeSignIn(devOrigin, "Obliance Dev") as SignInResult.Done
            assertEquals("Obliance Dev", done.profile.displayName)
            assertEquals(done.profile.id, registry.state.value.activeId)
            assertTrue(sessions.session(done.profile.id)!!.auth.value is AuthState.SignedIn)

            s.auth.signOut(done.profile.id)
            assertEquals(AuthState.SignedOut, sessions.session(done.profile.id)!!.auth.value)
            assertEquals(listOf(devOrigin), cleared)
            assertEquals(1, dev.count("POST /api/auth/logout"))
            assertTrue("disconnect" in realtimes.getValue(done.profile.id).log)
        }
    }
    @Test fun signOutTakesTheServersCardsOutAtOnce() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_USER)
        prod.on("GET /api/live-alerts/all", body = alertsJson(Triple(9812, "critical", "SRV-AD2: Hors ligne")))
        qual.on("GET /api/auth/me", body = ME_USER)
        qual.on("GET /api/live-alerts/all", body = alertsJson(Triple(512, "critical", "SRV-QUAL01: Hors ligne")))
        qual.on("POST /api/auth/logout", body = """{"success":true}""")
        val s = services()
        s.alerts.refresh()
        assertTrue(s.alerts.snapshot.value.alerts.any { it.serverId == qualId })

        s.auth.signOut(qualId)
        // No wait for the next poll: the cards and the badge leave now.
        withTimeout(5_000) { s.alerts.snapshot.first { snap -> snap.alerts.none { it.serverId == qualId } } }
        assertEquals(FeedStatus.SIGNED_OUT, s.alerts.snapshot.value.feed(qualId)!!.status)
        assertEquals(1, s.alerts.snapshot.value.badgeCount)

        // A stray 401 (or refused handshake) cannot turn the sign-out into an expired session.
        s.sessions.session(qualId)!!.markExpired()
        assertEquals(AuthState.SignedOut, s.sessions.session(qualId)!!.auth.value)
        s.alerts.refresh()
        assertTrue(s.alerts.snapshot.value.alerts.none { it.serverId == qualId })
    }

    @Test fun expiredApprovalsAreNotListed() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        prod.on("GET /api/live-alerts/all", body = alertsJson())
        prod.on(
            "GET /api/approvals",
            body = """{"data":[""" +
                """{"id":17,"tenantId":4,"requestType":"device_uninstall","status":"pending","expiresAt":"2026-09-25T01:51:08.000Z"},""" +
                """{"id":16,"tenantId":4,"requestType":"device_uninstall","status":"pending","expiresAt":"2026-09-25T00:51:08.000Z"}""" +
                """]}""",
        )
        qual.on("GET /api/auth/me", body = ME_USER)
        qual.on("GET /api/live-alerts/all", body = alertsJson())
        val registry = services()
        // Same wiring with a clock at 03:24 Paris (01:24Z): #16 expired at 00:51Z.
        val s = DefaultObliServices(
            registry.registry, registry.sessions,
            httpFor = { origin -> ObliHttp(mockOf[origin]?.origin ?: origin, client) },
            clearCookies = { },
            scope = scope,
            clock = { java.time.Instant.parse("2026-09-25T01:24:00Z").toEpochMilli() },
        )
        s.alerts.refresh()
        assertEquals(listOf(17L), s.alerts.snapshot.value.escalations.map { it.approval.id })
    }

    @Test fun anotherAccountOnTheSameServerGetsItsOwnTenants() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        prod.on("GET /api/tenants", body = """{"success":true,"data":[{"id":4,"name":"ACME","slug":"acme"},{"id":1,"name":"Default","slug":"default"}]}""")
        prod.on("POST /api/auth/logout", body = """{"success":true}""")
        val s = services()
        s.sessions.session(prodId)!!.probe()
        withTimeout(5_000) { s.tenants.scope.first { it.tenants.size == 2 } }

        s.auth.signOut(prodId)
        withTimeout(5_000) { s.tenants.scope.first { it.tenants.isEmpty() } }

        // Another account (member of Default only) signs in on the same server.
        prod.on("GET /api/auth/me", body = ME_USER)
        prod.on("GET /api/tenants", body = """{"success":true,"data":[{"id":1,"name":"Default","slug":"default","role":"member"}]}""")
        assertTrue(s.auth.completeSignIn(prodOrigin) is SignInResult.Done)
        val scope2 = withTimeout(5_000) { s.tenants.scope.first { it.tenants.isNotEmpty() && !it.loading } }
        assertEquals(listOf("Default"), scope2.tenants.map { it.name })
    }

    @Test fun failedTenantListIsRetried() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        prod.on("GET /api/tenants", 500, """{"error":"boom"}""")
        val registry = services()
        val s = DefaultTenantsRepository(registry.registry, registry.sessions, scope, retryMs = 50)
        registry.sessions.session(prodId)!!.probe()
        withTimeout(5_000) { s.scope.first { it.error != null } }
        prod.on("GET /api/tenants", body = """{"success":true,"data":[{"id":1,"name":"Default","slug":"default"}]}""")
        val scope2 = withTimeout(5_000) { s.scope.first { it.tenants.isNotEmpty() } }
        assertNull(scope2.error)
    }

    @Test fun tenantSwitchFinishesEvenWhenTheCallerLeaves() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        prod.on("GET /api/tenants", body = """{"success":true,"data":[{"id":4,"name":"ACME","slug":"acme"},{"id":1,"name":"Default","slug":"default"}]}""")
        prod.on("POST /api/tenant/switch", body = """{"success":true,"data":{"currentTenantId":4}}""")
        prod.delays["POST /api/tenant/switch"] = 300
        val s = services()
        s.sessions.session(prodId)!!.probe()
        prod.on("GET /api/auth/me", body = ME_ADMIN.replace("\"currentTenantId\":1", "\"currentTenantId\":4"))
        val caller = launch(Dispatchers.Default) { s.tenants.switchTo(4) }
        withTimeout(5_000) { while (prod.count("POST /api/tenant/switch") == 0) kotlinx.coroutines.delay(10) }
        // The scope sheet is dismissed while the server applies the switch.
        caller.cancel()
        withTimeout(5_000) { s.tenants.scope.first { it.currentTenantId == 4L } }
        withTimeout(5_000) { while ("reconnect" !in realtimes.getValue(prodId).log) kotlinx.coroutines.delay(10) }
    }

    @Test fun tenantSwitchOfAnotherServerStaysOnThatServer() = runBlocking {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        qual.on("GET /api/auth/me", body = ME_ADMIN)
        qual.on("POST /api/tenant/switch", body = """{"success":true,"data":{"currentTenantId":4}}""")
        val s = services()
        s.sessions.session(prodId)!!.probe()
        s.sessions.session(qualId)!!.probe()
        qual.on("GET /api/auth/me", body = ME_ADMIN.replace("\"currentTenantId\":1", "\"currentTenantId\":4"))
        assertEquals(ApiOutcome.Ok(Unit), s.tenants.switchTo(4, qualId))
        assertEquals(4L, (s.sessions.session(qualId)!!.auth.value as AuthState.SignedIn).probe.currentTenantId)
        assertEquals(1L, (s.sessions.session(prodId)!!.auth.value as AuthState.SignedIn).probe.currentTenantId)
        assertEquals(0, prod.count("POST /api/tenant/switch"))
        // Only the active server has a socket to reconnect.
        assertTrue("reconnect" !in realtimes.getValue(qualId).log)
        assertEquals(prodId, s.registry.state.value.activeId)
    }
}
