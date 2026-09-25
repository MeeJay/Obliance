package tools.obli.obliance.notifications

import android.app.Notification
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tools.obli.core.model.NotifyScope
import tools.obli.obliance.data.sample.SampleData

/**
 * The background pass against three fake servers (design doc §4: Obliance
 * Prod / Dev / Qual), French resources, fixed clock (Friday 03:20 in Paris).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "fr-rFR")
class NotificationPassTest {
    private val fleet = TestFleet()

    @After fun tearDown() = fleet.close()

    private fun baseline() {
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9760, "warning", "SRV-FILES01: santé disque à surveiller", "Disque 1 : 5 secteurs réalloués", device = 30)))
        fleet.dev.on("GET /api/live-alerts/all", feedJson(Row(301, "warning", "NAS-DEV01: Alerte", "Disque /volume1 91 % (seuil 90 %)", device = 20, at = "2026-09-24T23:50:00Z")))
        fleet.prod.on("GET /api/approvals", approvalsJson(Triple(17, "pending", "2026-09-25T01:51:08Z")))
        fleet.prod.on("GET /api/devices", devicesJson(KIOSK_PENDING))
        fleet.pass()
    }

    private fun assertAllActionsAuthenticated() {
        val actions = fleet.nm.activeNotifications.flatMap { it.notification.actions.orEmpty().toList() }
        actions.forEach { assertTrue("action ${it.title} must require authentication", it.isAuthenticationRequired) }
    }

    @Test fun firstPassBaselinesThenOnlyNewAlertsArePosted() {
        baseline()
        assertTrue(fleet.nm.activeNotifications.isEmpty())
        assertEquals(9760L, fleet.state(fleet.prodId).alertsMark)
        assertEquals(17L, fleet.state(fleet.prodId).approvalsMark)
        assertEquals(240L, fleet.state(fleet.prodId).enrolmentsMark)
        assertEquals(301L, fleet.state(fleet.devId).alertsMark)
        assertEquals(0L, fleet.state(fleet.qualId).alertsMark)

        fleet.qual.on("GET /api/live-alerts/all", feedJson(Row(512, "critical", "SRV-QUAL01: Hors ligne", "Aucun push reçu depuis 5 min.", device = 5, at = "2026-09-25T00:58:00Z")))
        fleet.prod.on(
            "GET /api/live-alerts/all",
            feedJson(
                Row(9790, "warning", "BOB01: Alerte", "Disque / 94 % (seuil 90 %)", device = 15, at = "2026-09-25T00:47:10Z"),
                Row(9760, "warning", "SRV-FILES01: santé disque à surveiller", "Disque 1 : 5 secteurs réalloués", device = 30),
            ),
        )
        fleet.pass()

        val shown = fleet.shown()
        assertEquals(2, shown.size)
        val qual = shown.single { it.tag == fleet.qualId.value }
        val prod = shown.single { it.tag == fleet.prodId.value }
        assertEquals("${fleet.qualId.value}.critical", qual.notification.channelId)
        assertEquals("${fleet.prodId.value}.attention", prod.notification.channelId)
        assertEquals("CRITIQUE · Obliance Qual › Default — SRV-QUAL01", qual.title)
        assertEquals("ATTENTION · Obliance Prod › Default — BOB01", prod.title)
        assertEquals("Hors ligne : aucun push reçu depuis 5 min.", qual.text)
        assertEquals(NotificationCompat.VISIBILITY_PRIVATE, qual.notification.visibility)
        assertEquals("Alerte critique · Default", qual.notification.publicVersion.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertNotNull("large icon = server tile from two servers", qual.notification.getLargeIcon())
        assertEquals(listOf("Ouvrir", "Marquer lu"), qual.actionTitles)
        assertEquals(9790L, fleet.state(fleet.prodId).alertsMark)
        assertAllActionsAuthenticated()
    }

    @Test fun withOneServerTheTitleHasNoServerName() {
        TestFleet(serverCount = 1).use { one ->
            one.prod.on("GET /api/live-alerts/all", feedJson(Row(9760, "warning", "SRV-FILES01: santé disque à surveiller", device = 30)))
            one.pass()
            one.prod.on("GET /api/live-alerts/all", feedJson(Row(9790, "warning", "BOB01: Alerte", "Disque / 94 % (seuil 90 %)", device = 15)))
            one.pass()
            val n = one.shown().single()
            assertEquals("ATTENTION · Default — BOB01", n.title)
            assertNull(n.notification.getLargeIcon())
        }
    }

    @Test fun criticalOnlyServerPostsOnlyCriticalClassAlerts() {
        runBlocking { fleet.registry.setNotify(fleet.qualId, NotifyScope.CRITICAL_ONLY) }
        baseline()
        fleet.qual.on(
            "GET /api/live-alerts/all",
            feedJson(
                Row(512, "critical", "SRV-QUAL01: Hors ligne", "Aucun push reçu depuis 5 min.", device = 5),
                Row(513, "warning", "SRV-QUAL01: Alerte", "Disque C: 91 % (seuil 90 %)", device = 5),
            ),
        )
        fleet.pass()
        val qual = fleet.shownFor(fleet.qualId)
        assertEquals(1, qual.size)
        assertEquals("CRITIQUE · Obliance Qual › Default — SRV-QUAL01", qual.single().title)
        assertEquals(513L, fleet.state(fleet.qualId).alertsMark)
    }

    @Test fun mutedServerGetsNoRequestAndReBaselinesWhenUnmuted() {
        baseline()
        runBlocking { fleet.registry.setNotify(fleet.qualId, NotifyScope.NONE) }
        fleet.qual.requests.clear()
        fleet.qual.on("GET /api/live-alerts/all", feedJson(Row(512, "critical", "SRV-QUAL01: Hors ligne", device = 5)))
        fleet.pass()
        assertTrue(fleet.qual.requests.isEmpty())
        assertNull(fleet.state(fleet.qualId).alertsMark)

        runBlocking { fleet.registry.setNotify(fleet.qualId, NotifyScope.ALL) }
        fleet.pass()
        assertTrue("old alerts are never notified after unmuting", fleet.shownFor(fleet.qualId).isEmpty())
        assertEquals(512L, fleet.state(fleet.qualId).alertsMark)

        fleet.qual.on("GET /api/live-alerts/all", feedJson(Row(514, "critical", "SRV-QUAL01: Hors ligne", device = 5), Row(512, "critical", "SRV-QUAL01: Hors ligne", device = 5)))
        fleet.pass()
        assertEquals(1, fleet.shownFor(fleet.qualId).size)
    }

    @Test fun expiredSessionPostsOneNoticeUntilSignedInAgain() {
        fleet.qual.on("GET /api/auth/me", EXPIRED_BODY, code = 401)
        repeat(3) { fleet.pass() }
        val account = fleet.shownFor(fleet.qualId)
        assertEquals(1, account.size)
        val n = account.single()
        assertEquals("${fleet.qualId.value}.account", n.notification.channelId)
        assertEquals("Session expirée sur Obliance Qual", n.title)
        assertEquals(NotificationIds.expired(fleet.qualId), n.id)
        assertEquals(listOf("Se reconnecter"), n.actionTitles)
        val route = RouteExtras.read(n.notification.actions.single().actionIntent.saved())
        assertEquals(NotificationRoute.SignIn(fleet.qualId), route)
        assertEquals(1, fleet.publisher.posted.count { it.id == NotificationIds.expired(fleet.qualId) })
        assertEquals(PassResult.EXPIRED, fleet.state(fleet.qualId).lastPass?.result)
        assertAllActionsAuthenticated()

        fleet.qual.on("GET /api/auth/me", me("user"))
        fleet.pass()
        assertTrue(fleet.shownFor(fleet.qualId).isEmpty())
        assertFalse(fleet.state(fleet.qualId).expiredNotified)
    }

    @Test fun signedOutServerReceivesNoRequest() {
        runBlocking { fleet.store.updateServer(fleet.qualId) { it.copy(signedOutByUser = true) } }
        fleet.sessions.session(fleet.devId)!!.markSignedOut()
        fleet.pass()
        assertTrue(fleet.qual.requests.isEmpty())
        assertTrue(fleet.dev.requests.isEmpty())
        assertEquals(PassResult.SKIPPED, fleet.state(fleet.qualId).lastPass?.result)
        assertTrue(fleet.prod.requests.isNotEmpty())
    }

    @Test fun unreachableServerNeitherBlocksNorDelaysTheOthers() {
        baseline()
        fleet.qual.close()
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9812, "critical", "SRV-AD2: Hors ligne", "Aucun push reçu depuis 4 min.", SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:12:04Z")))
        fleet.dev.on("GET /api/live-alerts/all", feedJson(Row(302, "warning", "NAS-DEV01: Alerte", "Disque /volume1 92 % (seuil 90 %)", device = 20), Row(301, "warning", "NAS-DEV01: Alerte", device = 20)))
        val reports = fleet.pass()
        assertEquals(PassResult.UNREACHABLE, reports.single { it.serverId == fleet.qualId }.result)
        assertTrue(fleet.shownFor(fleet.qualId).isEmpty())
        assertEquals(1, fleet.shownFor(fleet.prodId).size)
        assertEquals(1, fleet.shownFor(fleet.devId).size)
        assertEquals(PassResult.UNREACHABLE, fleet.state(fleet.qualId).lastPass?.result)
    }

    @Test fun slowServerIsCutAfterItsTimeoutWhileTheOthersPost() {
        baseline()
        fleet.qual.delays["GET /api/auth/me"] = 4_000
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9812, "critical", "SRV-AD2: Hors ligne", "Aucun push reçu depuis 4 min.", SampleData.ACME_TENANT, device = 211)))
        val started = System.nanoTime()
        val reports = fleet.pass(timeoutMs = 1_000)
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertTrue("the pass waited $elapsedMs ms", elapsedMs < 3_500)
        assertEquals(PassResult.UNREACHABLE, reports.single { it.serverId == fleet.qualId }.result)
        assertEquals(1, fleet.shownFor(fleet.prodId).size)
    }

    @Test fun adminEscalationPostsOnlyReviewAndIsCancelledWhenResolved() {
        baseline()
        fleet.prod.on(
            "GET /api/approvals",
            approvalsJson(Triple(17, "pending", "2026-09-25T01:51:08Z"), Triple(18, "pending", "2026-09-25T02:30:00Z"), Triple(19, "pending", "2026-09-25T01:00:00Z")),
        )
        fleet.pass()
        val escalations = fleet.shownFor(fleet.prodId).filter { it.notification.channelId == "${fleet.prodId.value}.escalations" }
        assertEquals("only 18 is new and not expired", 1, escalations.size)
        val n = escalations.single()
        assertEquals(NotificationIds.approval(fleet.prodId, 18), n.id)
        assertEquals("Demande d’approbation — Désinstaller l'agent de PC-ATELIER-02", n.title)
        assertEquals("Par og_julien.moreau · ACME · expire à 04:30", n.text)
        assertEquals(listOf("Examiner"), n.actionTitles)
        assertEquals(NotificationRoute.Approval(fleet.prodId, 18, SampleData.ACME_TENANT), RouteExtras.read(n.notification.actions.single().actionIntent.saved()))
        assertAllActionsAuthenticated()

        fleet.prod.on("GET /api/approvals", approvalsJson(Triple(17, "pending", "2026-09-25T01:51:08Z")))
        fleet.pass()
        assertTrue(fleet.shownFor(fleet.prodId).none { it.notification.channelId == "${fleet.prodId.value}.escalations" })
    }

    @Test fun enrolmentActionsOnlyInTheSessionTenant() {
        fleet.prod.on("GET /api/devices", devicesJson())
        fleet.pass()
        // Session on Default (1), KIOSK-ACCUEIL-02 in ACME (4): only « Examiner ».
        fleet.prod.on("GET /api/devices", devicesJson(KIOSK_PENDING))
        fleet.pass()
        val review = fleet.shownFor(fleet.prodId).single { it.notification.channelId == "${fleet.prodId.value}.enrolments" }
        assertEquals("Nouvel appareil en attente", review.title)
        assertEquals("KIOSK-ACCUEIL-02 · Windows 11 IoT Enterprise · 10.0.3.41", review.text)
        assertEquals(listOf("Examiner"), review.actionTitles)
        assertEquals(
            NotificationRoute.Enrolment(fleet.prodId, 240, SampleData.ACME_TENANT, "KIOSK-ACCUEIL-02"),
            RouteExtras.read(review.notification.actions.single().actionIntent.saved()),
        )

        // A member of ACME with agent_config:approval, session tenant ACME: « Approuver » « Refuser ».
        fleet.qual.on("GET /api/auth/me", me("user", tenant = 4))
        fleet.qual.on("GET /api/auth/permissions", permissionsJson("agent_config:approval"))
        fleet.pass()
        fleet.qual.on("GET /api/devices", devicesJson(KIOSK_PENDING))
        fleet.pass()
        val direct = fleet.shownFor(fleet.qualId).single { it.notification.channelId == "${fleet.qualId.value}.enrolments" }
        assertEquals(listOf("Approuver", "Refuser"), direct.actionTitles)
        assertAllActionsAuthenticated()

        // No longer pending: cancelled.
        fleet.qual.on("GET /api/devices", devicesJson())
        fleet.pass()
        assertTrue(fleet.shownFor(fleet.qualId).none { it.notification.channelId == "${fleet.qualId.value}.enrolments" })
    }

    @Test fun enrolmentsNeedTheApprovalCapability() {
        fleet.pass()
        fleet.qual.on("GET /api/devices", devicesJson(KIOSK_PENDING))
        fleet.pass()
        assertTrue(fleet.shownFor(fleet.qualId).isEmpty())
        assertEquals(0, fleet.qual.count("GET /api/devices"))
    }

    @Test fun theFiveMostUrgentArePostedAndTheSummarySaysPlusFour() {
        baseline()
        val rows = listOf(
            Row(9801, "warning", "BOB01: Alerte", "Disque / 91 % (seuil 90 %)", device = 15, at = "2026-09-25T00:41:00Z"),
            Row(9802, "warning", "BOB01: Alerte", "Disque / 92 % (seuil 90 %)", device = 15, at = "2026-09-25T00:42:00Z"),
            Row(9803, "warning", "BOB01: Alerte", "Disque / 93 % (seuil 90 %)", device = 15, at = "2026-09-25T00:43:00Z"),
            Row(9804, "warning", "BOB01: Alerte", "Disque / 94 % (seuil 90 %)", device = 15, at = "2026-09-25T00:44:00Z"),
            Row(9805, "warning", "SRV-FILES01: santé disque à surveiller", "Disque 1 : 5 secteurs réalloués", device = 30, at = "2026-09-25T00:45:00Z"),
            Row(9806, "warning", "BOB01: Alerte", "Disque / 95 % (seuil 90 %)", device = 15, at = "2026-09-25T00:46:00Z"),
            Row(9807, "critical", "PC-COMPTA-03: Critique", "CPU 98 % (seuil 90 %)", SampleData.ACME_TENANT, device = 187, at = "2026-09-25T01:05:31Z"),
            Row(9808, "critical", "SRV-AD2: Hors ligne", "Aucun push reçu depuis 4 min.", SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:12:04Z"),
            Row(9809, "info", "SRV-LEGACY: Hors ligne", "Aucun push reçu depuis 5 min.", SampleData.ACME_TENANT, device = 205, at = "2026-09-25T01:13:00Z"),
        )
        fleet.prod.on("GET /api/devices/205", """{"success":true,"data":{"id":205,"tenantId":4,"hostname":"SRV-LEGACY","osName":"Windows Server 2008 R2","status":"offline"}}""")
        fleet.prod.on("GET /api/live-alerts/all", feedJson(*rows.reversed().toTypedArray()))
        fleet.pass()

        val prod = fleet.shownFor(fleet.prodId).filter { it.notification.channelId != "${fleet.prodId.value}.enrolments" }
        assertEquals(5, prod.size)
        val ids = prod.map { it.id }.toSet()
        // The three critical-class ones (the info "offline" of a Windows Server ranks 1), then the two newest warnings.
        listOf(9807L, 9808L, 9809L, 9806L, 9805L).forEach { assertTrue("alert $it", NotificationIds.alert(fleet.prodId, it) in ids) }
        assertEquals(3, prod.count { it.notification.channelId == "${fleet.prodId.value}.critical" })
        val cpu = prod.single { it.id == NotificationIds.alert(fleet.prodId, 9807) }
        assertEquals(listOf("Ouvrir", "Processus", "Marquer lu"), cpu.actionTitles)
        assertEquals("Métrique critique : CPU 98 % (seuil 90 %)", cpu.text)
        assertEquals(
            NotificationRoute.Device(fleet.prodId, 187, SampleData.ACME_TENANT, "PC-COMPTA-03", tab = "processes"),
            RouteExtras.read(cpu.notification.actions[1].actionIntent.saved()),
        )

        val summary = fleet.summaries().single { it.tag == fleet.prodId.value }
        val lines = summary.notification.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES).orEmpty().map { it.toString() }
        assertTrue(lines.toString(), "+4 autres" in lines)
        assertTrue(lines.toString(), "Default · 6 alertes" in lines)
        assertTrue(lines.toString(), "ACME · 3 alertes" in lines)
        assertAllActionsAuthenticated()
    }

    @Test fun nineFreshAlertsGiveFiveNotificationsAndPlusFour() {
        fleet.prod.on("GET /api/live-alerts/all", feedJson())
        fleet.pass()
        val rows = (1..9).map { i ->
            if (i <= 3) {
                Row(9900L + i, "critical", "SRV-AD2: Hors ligne", "Aucun push reçu depuis $i min.", SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:0$i:00Z")
            } else {
                Row(9900L + i, "warning", "BOB01: Alerte", "Disque / 9$i % (seuil 90 %)", device = 15, at = "2026-09-25T00:0$i:00Z")
            }
        }
        fleet.prod.on("GET /api/live-alerts/all", feedJson(*rows.toTypedArray()))
        fleet.pass()
        val prod = fleet.shownFor(fleet.prodId)
        assertEquals(5, prod.size)
        assertEquals(3, prod.count { it.notification.channelId == "${fleet.prodId.value}.critical" })
        val lines = fleet.summaries().single { it.tag == fleet.prodId.value }.notification.extras
            .getCharSequenceArray(Notification.EXTRA_TEXT_LINES).orEmpty().map { it.toString() }
        assertTrue(lines.toString(), "+4 autres" in lines)
    }

    @Test fun aRecoveryUpdatesTheEarlierNotificationOfTheDevice() {
        baseline()
        val offline = Row(9812, "critical", "SRV-AD2: Hors ligne", "Aucun push reçu depuis 4 min.", SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:12:04Z")
        fleet.prod.on("GET /api/live-alerts/all", feedJson(offline))
        fleet.pass()
        val id = NotificationIds.alert(fleet.prodId, 9812)
        assertEquals("${fleet.prodId.value}.critical", fleet.shownFor(fleet.prodId).single().notification.channelId)

        fleet.prod.on(
            "GET /api/live-alerts/all",
            feedJson(Row(9813, "info", "SRV-AD2: De retour en ligne", "", SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:19:00Z"), offline),
        )
        fleet.pass()
        val shown = fleet.shownFor(fleet.prodId)
        assertEquals("the recovery replaces, it does not add", 1, shown.size)
        val n = shown.single()
        assertEquals(id, n.id)
        assertEquals("${fleet.prodId.value}.recovery", n.notification.channelId)
        assertTrue(n.text, n.text!!.startsWith("Rétabli à 03:19"))
        assertTrue(n.notification.extras.getBoolean(AndroidNotificationPublisher.EXTRA_SILENT))
        assertTrue(fleet.state(fleet.prodId).postedAlerts.single { it.alertId == 9812L }.recovered)
    }

    @Test fun alertsReadElsewhereLoseTheirNotification() {
        baseline()
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9790, "warning", "BOB01: Alerte", "Disque / 94 % (seuil 90 %)", device = 15)))
        fleet.pass()
        assertEquals(1, fleet.shownFor(fleet.prodId).size)
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9790, "warning", "BOB01: Alerte", device = 15, readAt = "2026-09-25T01:22:00Z")))
        fleet.pass()
        assertTrue(fleet.shownFor(fleet.prodId).isEmpty())
        assertTrue(fleet.state(fleet.prodId).postedAlerts.isEmpty())
    }

    @Test fun excludedTenantsNeverNotify() {
        baseline()
        runBlocking { fleet.store.updateServer(fleet.prodId) { it.copy(excludedTenants = setOf(SampleData.ACME_TENANT)) } }
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9812, "critical", "SRV-AD2: Hors ligne", tenantId = SampleData.ACME_TENANT, device = 211)))
        fleet.pass()
        assertTrue(fleet.shownFor(fleet.prodId).isEmpty())
        assertEquals(9812L, fleet.state(fleet.prodId).alertsMark)
        assertEquals(mapOf(1L to "Default", 4L to "ACME"), fleet.state(fleet.prodId).knownTenants)
    }

    @Test fun inTheForegroundOnlyCriticalsAndEscalationsArePosted() {
        baseline()
        fleet.foreground = true
        fleet.prod.on(
            "GET /api/live-alerts/all",
            feedJson(Row(9790, "warning", "BOB01: Alerte", device = 15), Row(9812, "critical", "SRV-AD2: Hors ligne", tenantId = SampleData.ACME_TENANT, device = 211)),
        )
        fleet.pass()
        val prod = fleet.shownFor(fleet.prodId)
        assertEquals(1, prod.size)
        assertEquals("${fleet.prodId.value}.critical", prod.single().notification.channelId)
        assertEquals(9812L, fleet.state(fleet.prodId).alertsMark)
    }

    // --- On-call ----------------------------------------------------------------------------

    private fun onCall(outside: OutsideRule, enabled: Boolean = true, start: Int = 19 * 60, end: Int = 8 * 60) = runBlocking {
        fleet.store.update { it.copy(onCall = OnCallSettings(enabled = enabled, startMinute = start, endMinute = end, outside = outside)) }
    }

    private fun postBobAndAd2() {
        fleet.prod.on(
            "GET /api/live-alerts/all",
            feedJson(Row(9790, "warning", "BOB01: Alerte", device = 15), Row(9812, "critical", "SRV-AD2: Hors ligne", tenantId = SampleData.ACME_TENANT, device = 211)),
        )
        fleet.pass()
    }

    @Test fun onCallActiveRingsAndSchedulesReminders() {
        onCall(OutsideRule.NONE)
        baseline()
        postBobAndAd2()
        assertEquals(2, fleet.shownFor(fleet.prodId).size)
        assertTrue(fleet.work.log.toString(), "reminder ${fleet.prodId.value} 9812 1" in fleet.work.log)
        assertFalse(fleet.publisher.posted.single { it.id == NotificationIds.alert(fleet.prodId, 9812) }.silent)
    }

    private fun reminders() = ReminderRunner(
        fleet.services, fleet.store, fleet.publisher, NotificationTexts(fleet.app.resources, TestFleet.PARIS), fleet.work,
        clock = { fleet.now.toEpochMilli() }, zone = TestFleet.PARIS,
    )

    @Test fun aReminderRepostsTheUnreadCriticalWithSound() {
        onCall(OutsideRule.NONE)
        baseline()
        postBobAndAd2()
        val id = NotificationIds.alert(fleet.prodId, 9812)
        val before = fleet.publisher.posted.count { it.id == id }
        val decision = runBlocking { reminders().run(fleet.prodId, 9812, 1) }
        assertEquals(ReminderPolicy.Decision.Repost(2), decision)
        val reposts = fleet.publisher.posted.filter { it.id == id }
        assertEquals(before + 1, reposts.size)
        assertFalse(reposts.last().onlyAlertOnce)
        assertFalse(reposts.last().silent)
        assertTrue(fleet.work.log.toString(), "reminder ${fleet.prodId.value} 9812 2" in fleet.work.log)
    }

    @Test fun aReminderStopsOnceTheAlertIsRead() {
        onCall(OutsideRule.NONE)
        baseline()
        postBobAndAd2()
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9812, "critical", "SRV-AD2: Hors ligne", tenantId = SampleData.ACME_TENANT, device = 211, readAt = "2026-09-25T01:21:00Z")))
        val before = fleet.publisher.posted.size
        assertEquals(ReminderPolicy.Decision.Stop, runBlocking { reminders().run(fleet.prodId, 9812, 1) })
        assertEquals(before, fleet.publisher.posted.size)
    }

    @Test fun aReminderStopsOffCall() {
        onCall(OutsideRule.NONE)
        baseline()
        postBobAndAd2()
        fleet.now = java.time.Instant.parse("2026-09-25T10:00:00Z")
        assertEquals(ReminderPolicy.Decision.Stop, runBlocking { reminders().run(fleet.prodId, 9812, 1) })
    }

    @Test fun outsideOnCallCriticalOnlyDropsTheWarning() {
        onCall(OutsideRule.CRITICAL_ONLY, start = 8 * 60, end = 18 * 60)
        baseline()
        postBobAndAd2()
        val prod = fleet.shownFor(fleet.prodId)
        assertEquals(1, prod.size)
        assertEquals("${fleet.prodId.value}.critical", prod.single().notification.channelId)
        assertTrue("no reminder outside on-call", fleet.work.log.none { it.startsWith("reminder") })
    }

    @Test fun outsideOnCallSilentPostsSilently() {
        onCall(OutsideRule.SILENT, start = 8 * 60, end = 18 * 60)
        baseline()
        postBobAndAd2()
        val posted = fleet.publisher.posted.filter { it.serverId == fleet.prodId && !it.summary }
        assertEquals(2, posted.size)
        assertTrue(posted.all { it.silent })
        assertTrue(fleet.shownFor(fleet.prodId).all { it.notification.extras.getBoolean(AndroidNotificationPublisher.EXTRA_SILENT) })
    }

    @Test fun outsideOnCallNonePostsNothingButMarksAdvance() {
        onCall(OutsideRule.NONE, start = 8 * 60, end = 18 * 60)
        baseline()
        postBobAndAd2()
        assertTrue(fleet.shownFor(fleet.prodId).isEmpty())
        assertEquals(9812L, fleet.state(fleet.prodId).alertsMark)
    }

    @Test fun serverOutOfOnCallFollowsTheOutsideRule() {
        onCall(OutsideRule.NONE)
        runBlocking { fleet.store.updateServer(fleet.prodId) { it.copy(inOnCall = false) } }
        baseline()
        postBobAndAd2()
        assertTrue(fleet.shownFor(fleet.prodId).isEmpty())
    }

    @Test fun permissionDeniedPostsNothingButTheMarkAdvances() {
        baseline()
        org.robolectric.Shadows.shadowOf(fleet.app).denyPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        postBobAndAd2()
        assertTrue(fleet.nm.activeNotifications.isEmpty())
        assertEquals(9812L, fleet.state(fleet.prodId).alertsMark)
        assertTrue(fleet.state(fleet.prodId).postedAlerts.isEmpty())
    }
}
