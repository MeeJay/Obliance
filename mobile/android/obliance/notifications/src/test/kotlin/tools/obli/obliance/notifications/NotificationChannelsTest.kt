package tools.obli.obliance.notifications

import android.app.NotificationManager
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
import tools.obli.core.auth.RemoveServerResult
import tools.obli.core.model.NotifyScope
import tools.obli.obliance.data.sample.SampleData

/** One channel group per server, named after it, holding six channels (design doc §9). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "fr-rFR")
class NotificationChannelsTest {
    private val fleet = TestFleet()

    @After fun tearDown() = fleet.close()

    private fun groups() = fleet.nm.notificationChannelGroups.filter { it.id.startsWith("server.") }

    private fun waitUntil(what: String, condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 3_000
        while (!condition()) {
            check(System.currentTimeMillis() < until) { "timed out: $what" }
            Thread.sleep(10)
        }
    }

    @Test fun installCreatesOneNamedGroupPerServerWithSixChannels() {
        // A group left by a server removed while the app was not running.
        fleet.nm.createNotificationChannelGroup(android.app.NotificationChannelGroup("server.gone", "Ancien serveur"))
        fleet.installRuntime()
        val groups = groups()
        assertEquals(setOf("Obliance Prod", "Obliance Dev", "Obliance Qual"), groups.map { it.name.toString() }.toSet())
        for (id in listOf(fleet.prodId, fleet.devId, fleet.qualId)) {
            for (suffix in listOf("critical", "attention", "recovery", "escalations", "enrolments", "account")) {
                val channel = fleet.nm.getNotificationChannel("${id.value}.$suffix")
                assertNotNull("${id.value}.$suffix", channel)
                assertEquals("server.${id.value}", channel.group)
            }
        }
        val critical = fleet.nm.getNotificationChannel("${fleet.prodId.value}.critical")
        assertEquals("Appareils critiques", critical.name.toString())
        assertEquals(NotificationManager.IMPORTANCE_HIGH, critical.importance)
        assertTrue(critical.vibrationPattern.contentEquals(NotificationChannels.CRITICAL_VIBRATION))
        assertEquals(NotificationManager.IMPORTANCE_LOW, fleet.nm.getNotificationChannel("${fleet.prodId.value}.recovery").importance)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, fleet.nm.getNotificationChannel("${fleet.prodId.value}.escalations").importance)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, fleet.nm.getNotificationChannel("${fleet.prodId.value}.attention").importance)
        assertTrue("orphan group removed", groups.none { it.id == "server.gone" })
        assertTrue("new servers are checked at once", "check-now" in fleet.work.log)
        assertTrue("the periodic pass is scheduled", "periodic" in fleet.work.log)
    }

    @Test fun renamingAServerRenamesItsGroup() {
        fleet.installRuntime()
        runBlocking { fleet.registry.rename(fleet.qualId, "Qual") }
        waitUntil("group renamed") { groups().any { it.id == "server.${fleet.qualId.value}" && it.name.toString() == "Qual" } }
    }

    @Test fun removingAServerDeletesItsGroupNotificationsAndState() {
        fleet.installRuntime()
        fleet.pass()
        fleet.qual.on("GET /api/live-alerts/all", feedJson(Row(512, "critical", "SRV-QUAL01: Hors ligne", device = 5)))
        fleet.pass()
        assertEquals(1, fleet.shownFor(fleet.qualId).size)
        assertNotNull(fleet.store.current.servers[fleet.qualId.value])

        val result = runBlocking { fleet.registry.remove(fleet.qualId) }
        assertTrue(result is RemoveServerResult.Removed)
        waitUntil("state purged") { fleet.store.current.servers[fleet.qualId.value] == null }
        assertTrue(fleet.shownFor(fleet.qualId).isEmpty())
        assertTrue(groups().none { it.id == "server.${fleet.qualId.value}" })
        assertNull(fleet.nm.getNotificationChannel("${fleet.qualId.value}.critical"))
        assertTrue("cancel-reminders ${fleet.qualId.value}" in fleet.work.log)
    }

    @Test fun signingOutStopsTheServerAndSigningInBaselinesAgain() {
        fleet.installRuntime()
        fleet.pass()
        fleet.qual.on("GET /api/live-alerts/all", feedJson(Row(512, "critical", "SRV-QUAL01: Hors ligne", device = 5)))
        fleet.pass()
        assertEquals(1, fleet.shownFor(fleet.qualId).size)

        fleet.sessions.session(fleet.qualId)!!.markSignedOut()
        waitUntil("signed out recorded") { fleet.state(fleet.qualId).signedOutByUser }
        assertTrue(fleet.shownFor(fleet.qualId).isEmpty())

        fleet.sessions.session(fleet.qualId)!!.markSignedIn(SampleData.probe(fleet.qualId))
        waitUntil("signed in recorded") { !fleet.state(fleet.qualId).signedOutByUser }
        assertNull("baseline again after a sign-out", fleet.state(fleet.qualId).alertsMark)
    }

    @Test fun mutingAServerCancelsItsNotificationsAndLeavingNoneReBaselines() {
        fleet.installRuntime()
        fleet.pass()
        fleet.qual.on("GET /api/live-alerts/all", feedJson(Row(512, "critical", "SRV-QUAL01: Hors ligne", device = 5)))
        fleet.pass()
        runBlocking { fleet.registry.setNotify(fleet.qualId, NotifyScope.NONE) }
        waitUntil("muted") { fleet.shownFor(fleet.qualId).isEmpty() }
        assertNull(fleet.state(fleet.qualId).alertsMark)
        assertTrue(fleet.state(fleet.qualId).postedAlerts.isEmpty())
    }

    @Test fun diagnosticsNeverShowOriginsOrAlertContents() {
        fleet.installRuntime()
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9812, "critical", "SRV-AD2: Hors ligne", tenantId = 4, device = 211)))
        fleet.pass()
        fleet.pass()
        waitUntil("state seen") { ObliNotifications.runtime?.lastState?.servers?.isNotEmpty() == true }
        val lines = ObliNotifications.diagnostics(fleet.app)
        assertTrue(lines.toString(), lines.any { it.startsWith("server[1] OP: notify=ALL last=OK") })
        val all = lines.joinToString("
")
        for (secret in listOf("example.org", "127.0.0.1", "SRV-AD2", "Hors ligne", "ACME", "Obliance Prod")) assertFalse(secret, secret in all)
    }

    @Test fun onlyMutedOrSignedOutServersStopThePeriodicWork() = runBlocking {
        val rt = fleet.installRuntime()
        fleet.work.log.clear()
        for (id in listOf(fleet.prodId, fleet.devId)) fleet.registry.setNotify(id, NotifyScope.NONE)
        fleet.store.updateServer(fleet.qualId) { it.copy(signedOutByUser = true) }
        rt.syncNow()
        assertEquals("cancel-periodic", fleet.work.log.last())
        fleet.registry.setNotify(fleet.devId, NotifyScope.CRITICAL_ONLY)
        rt.syncNow()
        assertEquals("periodic", fleet.work.log.last())
    }
}
