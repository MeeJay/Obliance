package tools.obli.obliance.notifications

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tools.obli.core.model.NotifyScope
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.sample.SampleData

/**
 * 0.3.1 « une notification de rétablissement remplace voire supprime l'alerte » :
 * the server resolves alerts (recovery, escalation) and leaves them out of
 * `/api/live-alerts/all`; the phone withdraws their notifications, replaces
 * the earlier notification of an incident instead of stacking, and still
 * understands an older server that sends « retour à la normale » rows.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "fr-rFR")
class NotificationResolveTest {
    private val fleet = TestFleet()

    @After fun tearDown() = fleet.close()

    private val prod get() = fleet.prodId

    private fun onCall() = runBlocking {
        fleet.store.update { it.copy(onCall = OnCallSettings(enabled = true, outside = OutsideRule.NONE)) }
    }

    /** First pass: the marks are set on an (almost) empty feed, nothing is posted. */
    private fun baseline() {
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9000, "warning", "PC-OLD: Alerte", device = 1, readAt = "2026-09-25T00:00:00Z")))
        fleet.pass()
    }

    private fun feed(vararg rows: Row, activeIds: Collection<Long>? = null) = fleet.prod.on("GET /api/live-alerts/all", feedJson(*rows, activeIds = activeIds))

    private fun shownAlertIds(): Set<Long> {
        val byNotification = fleet.state(prod).postedAlerts.associateBy { NotificationIds.alert(prod, it.alertId) }
        return fleet.shownFor(prod).mapNotNull { byNotification[it.id]?.alertId }.toSet()
    }

    private val ad2Offline = Row(9812, "critical", "SRV-AD2: Hors ligne", "Aucun push reçu depuis 4 min.", SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:12:04Z", stableKey = "device:211:offline")
    private val bobWarning = Row(9790, "warning", "BOB01: Alerte", "Disque / 94 % (seuil 90 %)", device = 15, at = "2026-09-25T00:47:10Z", stableKey = "device:15:metric:warning")
    private val bobCritical = Row(9795, "critical", "BOB01: Critique", "Disque / 98 % (seuil 95 %)", device = 15, at = "2026-09-25T01:02:00Z", stableKey = "device:15:metric:critical")

    // --- Cancel on missing ---------------------------------------------------------------------

    @Test fun anAlertThatLeftTheFeedLosesItsNotificationAndItsReminder() {
        onCall()
        baseline()
        feed(ad2Offline, bobWarning)
        fleet.pass()
        assertEquals(setOf(9812L, 9790L), shownAlertIds())
        assertTrue("reminder ${prod.value} 9812 1" in fleet.work.log)

        // SRV-AD2 is back online: the server resolved #9812 and inserted nothing.
        feed(bobWarning)
        fleet.pass()
        assertEquals(setOf(9790L), shownAlertIds())
        assertEquals(listOf(9790L), fleet.state(prod).postedAlerts.map { it.alertId })
        assertTrue("cancel-reminder ${prod.value} 9812" in fleet.work.log)
        assertTrue("no « Rétabli » is posted", fleet.publisher.posted.none { it.channel == NotifChannel.RECOVERY })

        // Resolved too: nothing left, the group summary goes with it.
        feed()
        fleet.pass()
        assertTrue(fleet.shownFor(prod).isEmpty())
        assertTrue(fleet.summaries().none { it.tag == prod.value })
        assertTrue(fleet.state(prod).postedAlerts.isEmpty())
    }

    @Test fun anAlertStillActiveKeepsItsNotificationWithoutRinging() {
        baseline()
        feed(bobWarning)
        fleet.pass()
        // Still active and unread in the feed (read AND unread active alerts are listed): kept.
        feed(bobWarning, Row(9000, "warning", "PC-OLD: Alerte", device = 1, readAt = "2026-09-25T00:00:00Z"))
        fleet.pass()
        assertEquals(setOf(9790L), shownAlertIds())
        assertEquals(1, fleet.publisher.posted.count { it.id == NotificationIds.alert(prod, 9790) })
    }

    @Test fun aFailedOrSlowReadCancelsNothing() {
        onCall()
        baseline()
        feed(ad2Offline)
        fleet.pass()
        assertEquals(setOf(9812L), shownAlertIds())

        // 500: unreachable, nothing decided.
        fleet.prod.on("GET /api/live-alerts/all", """{"error":"Internal"}""", code = 500)
        fleet.pass()
        assertEquals(setOf(9812L), shownAlertIds())
        assertEquals(PassResult.UNREACHABLE, fleet.state(prod).lastPass?.result)

        // Not the expected shape: nothing decided either.
        fleet.prod.on("GET /api/live-alerts/all", """{"success":true,"data":[]}""")
        fleet.pass()
        assertEquals(setOf(9812L), shownAlertIds())

        // Too slow: cut after its budget, nothing decided.
        feed()
        fleet.prod.delays["GET /api/live-alerts/all"] = 3_000
        fleet.pass(timeoutMs = 500)
        assertEquals(setOf(9812L), shownAlertIds())
        assertEquals(listOf(9812L), fleet.state(prod).postedAlerts.map { it.alertId })
        assertFalse("cancel-reminder ${prod.value} 9812" in fleet.work.log)

        // Read in full: now it goes.
        fleet.prod.delays.remove("GET /api/live-alerts/all")
        fleet.pass()
        assertTrue(fleet.shownFor(prod).isEmpty())
    }

    /**
     * `/api/live-alerts/all` lists 200 rows at most: when full, an alert older
     * than its oldest row may still be active (kept); a missing alert inside
     * what it lists is not (withdrawn).
     */
    @Test fun aFullFeedNeverCancelsWhatItMayHaveLeftOut() {
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(400, "warning", "PC-OLD: Alerte", device = 1, readAt = "2026-09-25T00:00:00Z")))
        fleet.pass()
        feed(
            Row(900, "critical", "SRV-AD2: Hors ligne", device = 211, stableKey = "device:211:offline"),
            Row(500, "warning", "BOB01: Alerte", device = 15, stableKey = "device:15:metric:warning"),
        )
        fleet.pass()
        assertEquals(setOf(900L, 500L), shownAlertIds())

        val full = (1_000L downTo 800L).filter { it != 900L }.map { id ->
            Row(id, "warning", "PC-%04d: Alerte".format(id), device = id, readAt = "2026-09-25T01:15:00Z")
        }
        assertEquals(200, full.size)
        feed(*full.toTypedArray())
        fleet.pass()
        assertEquals("#500 is older than the oldest listed row: maybe still active", setOf(500L), shownAlertIds())
        assertTrue("cancel-reminder ${prod.value} 900" in fleet.work.log)
        assertFalse("cancel-reminder ${prod.value} 500" in fleet.work.log)
    }

    /**
     * A 0.3.1 server also sends `activeIds` (every active id, not capped): a full
     * feed then withdraws an old alert that is no longer active, and keeps one
     * that still is. 17:00 SRV-SQL01 goes offline (#900), then 300 workstations
     * shut down (their « Hors ligne » rows stay active); SRV-SQL01 comes back.
     */
    @Test fun aFullFeedWithActiveIdsStillWithdrawsWhatIsNoLongerActive() {
        onCall()
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(400, "warning", "PC-OLD: Alerte", device = 1, readAt = "2026-09-25T00:00:00Z")))
        fleet.pass()
        val sql = Row(900, "critical", "SRV-SQL01: Hors ligne", device = 211, stableKey = "device:211:offline")
        val bob = Row(500, "warning", "BOB01: Alerte", device = 15, stableKey = "device:15:metric:warning")
        feed(sql, bob)
        fleet.pass()
        assertEquals(setOf(900L, 500L), shownAlertIds())
        assertTrue("reminder ${prod.value} 900 1" in fleet.work.log)

        val workstations = (1_300L downTo 1_001L).map { id ->
            Row(id, "info", "PC-%04d: Hors ligne".format(id), device = id, readAt = "2026-09-25T01:15:00Z", stableKey = "device:$id:offline")
        }
        val listed = workstations.take(200)
        // SRV-SQL01 is back: #900 resolved; BOB01's warning is still active, beyond the 200 rows.
        feed(*listed.toTypedArray(), activeIds = workstations.map { it.id } + 500L)
        fleet.pass()
        assertEquals(setOf(500L), shownAlertIds())
        assertTrue("cancel-reminder ${prod.value} 900" in fleet.work.log)
        assertEquals(listOf(500L), fleet.state(prod).postedAlerts.map { it.alertId })

        // BOB01 recovers too: gone as well, still outside the 200 rows.
        feed(*listed.toTypedArray(), activeIds = workstations.map { it.id })
        fleet.pass()
        assertTrue(fleet.shownFor(prod).isEmpty())
        assertTrue(fleet.state(prod).postedAlerts.isEmpty())

        // An `activeIds` the app cannot trust falls back on the 200-row rule (nothing below is withdrawn).
        feed(sql.copy(id = 1_400))
        fleet.pass()
        assertEquals(setOf(1_400L), shownAlertIds())
        val later = listed.map { it.copy(id = it.id + 1_000) }
        fleet.prod.on("GET /api/live-alerts/all", feedJson(*later.toTypedArray()).dropLast(1) + ""","activeIds":[2300,"x"]}""")
        fleet.pass()
        assertEquals("#1400 is older than the oldest listed row, and activeIds is malformed", setOf(1_400L), shownAlertIds())
    }

    // --- Escalation replaces ----------------------------------------------------------------

    @Test fun anEscalationReplacesTheWarningOfTheSameDevice() {
        baseline()
        feed(bobWarning)
        fleet.pass()
        assertEquals(setOf(9790L), shownAlertIds())

        // 0.3.1 server: the warning is resolved, the critical is a new row.
        feed(bobCritical)
        fleet.pass()
        val shown = fleet.shownFor(prod)
        assertEquals(1, shown.size)
        assertEquals(NotificationIds.alert(prod, 9795), shown.single().id)
        assertEquals("${prod.value}.critical", shown.single().notification.channelId)
        assertEquals("device:15:metric", fleet.state(prod).postedAlerts.single().incident)
    }

    @Test fun onAnOlderServerTheEscalationStillReplaces() {
        baseline()
        feed(bobWarning)
        fleet.pass()
        // An older server keeps the warning active next to the critical.
        feed(bobCritical, bobWarning)
        fleet.pass()
        assertEquals(setOf(9795L), shownAlertIds())
        assertEquals(listOf(9795L), fleet.state(prod).postedAlerts.map { it.alertId })
        assertTrue("cancel-reminder ${prod.value} 9790" in fleet.work.log)
        // Next pass: the warning is never posted again.
        fleet.pass()
        assertEquals(setOf(9795L), shownAlertIds())
        assertEquals(1, fleet.publisher.posted.count { it.id == NotificationIds.alert(prod, 9790) })
    }

    @Test fun aRecordOf030WithoutIncidentIsReplacedToo() {
        baseline()
        feed(bobWarning)
        fleet.pass()
        // As 0.3.0 saved it: device and category, no incident.
        runBlocking { fleet.store.updateServer(prod) { s -> s.copy(postedAlerts = s.postedAlerts.map { it.copy(incident = null) }) } }
        feed(bobCritical.copy(stableKey = null), bobWarning.copy(stableKey = null))
        fleet.pass()
        assertEquals(setOf(9795L), shownAlertIds())
    }

    @Test fun severalNewAlertsOfOneIncidentPostOnlyTheNewest() {
        baseline()
        feed(bobCritical, bobWarning, ad2Offline)
        fleet.pass()
        assertEquals(setOf(9795L, 9812L), shownAlertIds())
        assertEquals(0, fleet.publisher.posted.count { it.id == NotificationIds.alert(prod, 9790) })
    }

    @Test fun anotherKindOfTheSameDeviceIsNotReplaced() {
        baseline()
        val cpu = Row(10100, "critical", "SRV-AD2: Critique", "CPU 97 % (seuil 90 %)", SampleData.ACME_TENANT, device = 211, stableKey = "device:211:metric:critical")
        feed(cpu)
        fleet.pass()
        feed(ad2Offline.copy(id = 10105), cpu)
        fleet.pass()
        assertEquals(setOf(10100L, 10105L), shownAlertIds())
    }

    // --- Older server: « retour à la normale » rows keep the 0.3.0 behaviour -------------------

    /**
     * A flapping device on a server older than 0.3.1 (it keeps every row and
     * adds « De retour en ligne »): one notification of SRV-AD2 at any time,
     * turned « Rétabli » by each recovery and replaced by the next outage.
     */
    @Test fun aFlappingDeviceKeepsOneNotificationOnAnOlderServer() {
        baseline()
        val off1 = Row(100_100, "critical", "SRV-AD2: Hors ligne", tenantId = SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:00:00Z")
        val on1 = Row(100_101, "info", "SRV-AD2: De retour en ligne", tenantId = SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:03:00Z")
        val off2 = Row(100_102, "critical", "SRV-AD2: Hors ligne", tenantId = SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:06:00Z")
        val on2 = Row(100_103, "info", "SRV-AD2: De retour en ligne", tenantId = SampleData.ACME_TENANT, device = 211, at = "2026-09-25T01:09:00Z")

        feed(off1)
        fleet.pass()
        feed(on1, off1)
        fleet.pass()
        var shown = fleet.shownFor(prod)
        assertEquals(1, shown.size)
        assertEquals("${prod.value}.recovery", shown.single().notification.channelId)
        assertEquals(NotificationIds.alert(prod, off1.id), shown.single().id)

        feed(off2, on1, off1)
        fleet.pass()
        shown = fleet.shownFor(prod)
        assertEquals("the new outage replaces the « Rétabli » one", 1, shown.size)
        assertEquals(NotificationIds.alert(prod, off2.id), shown.single().id)
        assertEquals("${prod.value}.critical", shown.single().notification.channelId)

        feed(on2, off2, on1, off1)
        fleet.pass()
        shown = fleet.shownFor(prod)
        assertEquals(1, shown.size)
        assertEquals(NotificationIds.alert(prod, off2.id), shown.single().id)
        assertEquals("${prod.value}.recovery", shown.single().notification.channelId)
        assertEquals(listOf(off2.id), fleet.state(prod).postedAlerts.map { it.alertId })
    }

    /** A recovery with nothing to replace (swiped away) posts its own; the next outage replaces it. */
    @Test fun aStandaloneRecoveryIsReplacedByTheNextOutage() {
        baseline()
        val off1 = Row(100_100, "critical", "SRV-AD2: Hors ligne", device = 211)
        feed(off1)
        fleet.pass()
        fleet.nm.cancel(prod.value, NotificationIds.alert(prod, off1.id))
        val on1 = Row(100_101, "info", "SRV-AD2: De retour en ligne", device = 211)
        feed(on1, off1)
        fleet.pass()
        assertEquals(setOf(on1.id), shownAlertIds())
        assertEquals("device:211:offline", fleet.state(prod).postedAlerts.single { it.alertId == on1.id }.incident)

        val off2 = Row(100_102, "critical", "SRV-AD2: Hors ligne", device = 211)
        feed(off2, on1, off1)
        fleet.pass()
        assertEquals(setOf(off2.id), shownAlertIds())
    }

    /**
     * Older server, W1 → « retour à la normale » → C across two passes: the
     * recovery predates the critical, so it neither turns the critical
     * « Rétabli » (its reminders would stop) nor posts a stray « Rétabli ».
     */
    @Test fun aRecoveryOlderThanTheNewCriticalLeavesItAlone() {
        onCall()
        baseline()
        val w1 = Row(300_100, "warning", "BOB01: Alerte", "Disque / 94 % (seuil 90 %)", device = 15, at = "2026-09-25T00:05:00Z", stableKey = "device:15:metric:warning")
        val back = Row(300_101, "info", "BOB01: retour à la normale", device = 15, at = "2026-09-25T00:08:00Z")
        val c = Row(300_102, "critical", "BOB01: Critique", "Disque / 98 % (seuil 95 %)", device = 15, at = "2026-09-25T00:12:00Z", stableKey = "device:15:metric:critical")
        feed(w1)
        fleet.pass()
        assertEquals(setOf(w1.id), shownAlertIds())

        feed(c, back, w1)
        fleet.pass()
        val shown = fleet.shownFor(prod)
        assertEquals(1, shown.size)
        assertEquals(NotificationIds.alert(prod, c.id), shown.single().id)
        assertEquals("${prod.value}.critical", shown.single().notification.channelId)
        assertFalse(fleet.state(prod).postedAlerts.single().recovered)
        assertTrue(fleet.publisher.posted.none { it.channel == NotifChannel.RECOVERY })
        assertTrue("reminder ${prod.value} ${c.id} 1" in fleet.work.log)
        assertFalse("cancel-reminder ${prod.value} ${c.id}" in fleet.work.log)
    }

    /** Older server, W1 → C → « retour à la normale »: the recovery answers the critical (0.3.0 behaviour). */
    @Test fun aRecoveryNewerThanTheCriticalStillTurnsItRecovered() {
        baseline()
        val w1 = Row(300_100, "warning", "BOB01: Alerte", device = 15, stableKey = "device:15:metric:warning")
        val c = Row(300_101, "critical", "BOB01: Critique", device = 15, stableKey = "device:15:metric:critical")
        val back = Row(300_102, "info", "BOB01: retour à la normale", device = 15)
        feed(w1)
        fleet.pass()
        feed(back, c, w1)
        fleet.pass()
        val shown = fleet.shownFor(prod)
        assertEquals(1, shown.size)
        assertEquals(NotificationIds.alert(prod, c.id), shown.single().id)
        assertEquals("${prod.value}.recovery", shown.single().notification.channelId)
    }

    /**
     * Older server (earlier rows stay active), « Critiques seulement »: the CPU
     * goes critical then back to warning. The newer warning may not ring, so
     * it does not hide the critical, which is still active there.
     */
    @Test fun aNewerAlertThatMayNotRingNeverHidesAnOlderOneThatMay() {
        runBlocking { fleet.registry.setNotify(prod, NotifyScope.CRITICAL_ONLY) }
        baseline()
        val c = Row(200_200, "critical", "BOB01: Critique", "CPU 97 % (seuil 95 %)", device = 15, at = "2026-09-25T01:01:00Z", stableKey = "device:15:metric:critical")
        val w = Row(200_201, "warning", "BOB01: Alerte", "CPU 91 % (seuil 90 %)", device = 15, at = "2026-09-25T01:05:00Z", stableKey = "device:15:metric:warning")
        feed(w, c)
        fleet.pass()
        assertEquals(setOf(c.id), shownAlertIds())
    }

    // --- Socket (app running) ---------------------------------------------------------------

    private fun waitUntil(what: String, condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 3_000
        while (!condition()) {
            check(System.currentTimeMillis() < until) { "timed out: $what" }
            Thread.sleep(10)
        }
    }

    /** The active server's socket, once the engine listens to it. */
    private fun prodSocket(): SilentRealtime {
        waitUntil("prod socket followed") { fleet.realtimes[prod]?.events?.subscriptionCount?.value?.let { it > 0 } == true }
        return fleet.realtimes.getValue(prod)
    }

    private fun resolved(vararg ids: Long) =
        RealtimeEvent(ObliEvents.NOTIFICATION_RESOLVED, Json.parseToJsonElement("""{"ids":[${ids.joinToString(",")}]}"""))

    /** ONE event (a dropped event must fail the test), then [until]. */
    private fun resolveOnSocket(vararg ids: Long, until: () -> Boolean) {
        val rt = prodSocket()
        runBlocking { withTimeout(3_000) { rt.events.emit(resolved(*ids)) } }
        waitUntil("resolved ${ids.toList()}", until)
    }

    @Test fun notificationResolvedOnTheSocketCancelsAtOnce() {
        onCall()
        fleet.installRuntime()
        baseline()
        feed(ad2Offline, bobWarning)
        fleet.pass()
        assertEquals(setOf(9812L, 9790L), shownAlertIds())

        resolveOnSocket(9812) { fleet.shownFor(prod).none { it.id == NotificationIds.alert(prod, 9812) } }
        waitUntil("record updated") { fleet.state(prod).postedAlerts.none { it.alertId == 9812L } }
        assertEquals(setOf(9790L), shownAlertIds())
        assertTrue("cancel-reminder ${prod.value} 9812" in fleet.work.log)

        // The last one: the group summary goes too.
        resolveOnSocket(9790) { fleet.shownFor(prod).isEmpty() }
        waitUntil("summary gone") { fleet.summaries().none { it.tag == prod.value } }
        assertTrue(fleet.state(prod).postedAlerts.isEmpty())

        // The next pass (feed without them) posts nothing again.
        feed()
        fleet.pass()
        assertTrue(fleet.shownFor(prod).isEmpty())
    }

    /**
     * A pass (or a reminder) holds PassLock: a resolution waiting for it must
     * not hold the socket back (its buffer would drop the next events). The
     * notifications go at once; the record follows when the lock is free.
     */
    @Test fun aResolutionWaitingForThePassNeverHoldsTheSocketBack() {
        fleet.installRuntime()
        baseline()
        feed(ad2Offline, bobWarning)
        fleet.pass()
        assertEquals(setOf(9812L, 9790L), shownAlertIds())
        val rt = prodSocket()
        runBlocking {
            PassLock.mutex.lock()
            try {
                withTimeout(2_000) { rt.events.emit(resolved(9812)) }
                withTimeout(2_000) { rt.events.emit(resolved(9790)) }
                waitUntil("withdrawn while the lock is held") { fleet.shownFor(prod).isEmpty() }
                assertEquals("the record waits for the lock", 2, fleet.state(prod).postedAlerts.size)
            } finally {
                PassLock.mutex.unlock()
            }
        }
        waitUntil("record updated") { fleet.state(prod).postedAlerts.isEmpty() }
        waitUntil("summary gone") { fleet.summaries().none { it.tag == prod.value } }
    }

    @Test fun anotherServersIdsAreNotTouched() {
        fleet.installRuntime()
        baseline()
        fleet.qual.on("GET /api/live-alerts/all", feedJson())
        fleet.pass()
        fleet.qual.on("GET /api/live-alerts/all", feedJson(Row(9812, "critical", "SRV-QUAL01: Hors ligne", device = 5)))
        feed(ad2Offline)
        fleet.pass()
        assertEquals(1, fleet.shownFor(fleet.qualId).size)

        // The ACTIVE server's socket (Obliance Prod) resolves its own #9812 only.
        resolveOnSocket(9812) { fleet.shownFor(prod).isEmpty() }
        assertEquals(1, fleet.shownFor(fleet.qualId).size)
        assertEquals(listOf(9812L), fleet.state(fleet.qualId).postedAlerts.map { it.alertId })
    }
}
