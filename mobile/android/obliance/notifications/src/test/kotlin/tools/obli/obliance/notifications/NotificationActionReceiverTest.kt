package tools.obli.obliance.notifications

import android.app.KeyguardManager
import android.content.Intent
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import tools.obli.obliance.data.sample.SampleData

/** "Marquer lu" and enrolment actions: the ITEM's server only, success only when the server says so. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "fr-rFR")
class NotificationActionReceiverTest {
    private val fleet = TestFleet()

    @Before fun setUp() {
        fleet.installRuntime()
    }

    @After fun tearDown() = fleet.close()

    private fun handle(intent: Intent): Boolean = runBlocking { NotificationActions.handle(fleet.app, intent) }

    private fun actionIntent(notificationId: Int, title: String): Intent {
        val n = fleet.shown().single { it.id == notificationId }
        return n.notification.actions.single { it.title.toString() == title }.actionIntent.saved()
    }

    @Test fun markReadGoesToTheAlertsOwnServerOnly() {
        fleet.pass()
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9812, "critical", "SRV-AD2: Hors ligne", "Aucun push reçu depuis 4 min.", SampleData.ACME_TENANT, device = 211)))
        fleet.pass()
        val id = NotificationIds.alert(fleet.prodId, 9812)
        val intent = actionIntent(id, "Marquer lu")
        fleet.prod.on("PATCH /api/live-alerts/9812/read", """{"success":true}""")
        listOf(fleet.prod, fleet.dev, fleet.qual).forEach { it.requests.clear() }

        assertTrue(handle(intent))
        assertEquals(listOf("PATCH /api/live-alerts/9812/read"), fleet.prod.requests.toList())
        assertTrue(fleet.dev.requests.isEmpty())
        assertTrue(fleet.qual.requests.isEmpty())
        assertTrue(fleet.shownFor(fleet.prodId).isEmpty())
        assertTrue(fleet.state(fleet.prodId).postedAlerts.none { it.alertId == 9812L })
        assertTrue(fleet.work.log.toString(), "cancel-reminder ${fleet.prodId.value} 9812" in fleet.work.log)
    }

    @Test fun markReadFailureKeepsTheNotification() {
        fleet.pass()
        fleet.prod.on("GET /api/live-alerts/all", feedJson(Row(9812, "critical", "SRV-AD2: Hors ligne", tenantId = SampleData.ACME_TENANT, device = 211)))
        fleet.pass()
        val id = NotificationIds.alert(fleet.prodId, 9812)
        fleet.prod.on("PATCH /api/live-alerts/9812/read", """{"error":"Internal"}""", code = 500)
        assertFalse(handle(actionIntent(id, "Marquer lu")))
        assertEquals(1, fleet.shownFor(fleet.prodId).size)
    }

    /** Session tenant ACME, so the notification offers « Approuver » / « Refuser ». */
    private fun postKiosk(): Int {
        fleet.prod.on("GET /api/auth/me", me("admin", tenant = SampleData.ACME_TENANT))
        fleet.pass()
        fleet.prod.on("GET /api/devices", devicesJson(KIOSK_PENDING))
        fleet.pass()
        fleet.prod.on("GET /api/devices/240", """{"success":true,"data":$KIOSK_PENDING}""")
        return NotificationIds.enrolment(fleet.prodId, 240)
    }

    @Test fun approveSucceedsOnlyWhenTheServerSaysApproved() {
        val id = postKiosk()
        val intent = actionIntent(id, "Approuver")
        fleet.prod.on("POST /api/devices/240/approve", """{"data":${KIOSK_PENDING.replace("\"approvalStatus\":\"pending\"", "\"approvalStatus\":\"approved\"")}}""")
        listOf(fleet.prod, fleet.dev, fleet.qual).forEach { it.requests.clear() }

        assertTrue(handle(intent))
        assertEquals(listOf("GET /api/devices/240", "POST /api/devices/240/approve"), fleet.prod.requests.toList())
        assertTrue(fleet.dev.requests.isEmpty())
        assertTrue(fleet.qual.requests.isEmpty())
        val n = fleet.shownFor(fleet.prodId).single { it.id == id }
        assertEquals("KIOSK-ACCUEIL-02 approuvé", n.title)
        assertTrue(n.notification.actions.isNullOrEmpty())
        assertFalse(240L in fleet.state(fleet.prodId).postedEnrolments)
    }

    @Test fun refuseSucceedsOnlyWhenTheServerSaysRefused() {
        val id = postKiosk()
        fleet.prod.on("POST /api/devices/240/refuse", """{"data":${KIOSK_PENDING.replace("\"approvalStatus\":\"pending\"", "\"approvalStatus\":\"refused\"")}}""")
        assertTrue(handle(actionIntent(id, "Refuser")))
        assertEquals("KIOSK-ACCUEIL-02 refusé", fleet.shownFor(fleet.prodId).single { it.id == id }.title)
    }

    @Test fun aPendingAnswerAsksToFinishInTheApp() {
        val id = postKiosk()
        // Master-tenant session on the server side: nothing was updated, the device is still pending.
        fleet.prod.on("POST /api/devices/240/approve", """{"data":$KIOSK_PENDING}""")
        assertFalse(handle(actionIntent(id, "Approuver")))
        val n = fleet.shownFor(fleet.prodId).single { it.id == id }
        assertEquals("Ouvrez Obliance pour terminer", n.title)
        assertEquals(
            NotificationRoute.Enrolment(fleet.prodId, 240, SampleData.ACME_TENANT, "KIOSK-ACCUEIL-02"),
            RouteExtras.read(n.notification.contentIntent.saved()),
        )
    }

    @Test fun anErrorAsksToFinishInTheApp() {
        val id = postKiosk()
        fleet.prod.on("POST /api/devices/240/approve", """{"error":"Capability 'agent_config:approval' not permitted for your team"}""", code = 403)
        assertFalse(handle(actionIntent(id, "Approuver")))
        assertEquals("Ouvrez Obliance pour terminer", fleet.shownFor(fleet.prodId).single { it.id == id }.title)
    }

    /**
     * Android 8-11: `setAuthenticationRequired` does nothing, so the enrolment
     * notification offers « Examiner » only (an activity: Android asks for the
     * unlock), and an action that still arrives from a LOCKED phone (an older
     * notification) sends nothing.
     */
    @Config(sdk = [30], qualifiers = "fr-rFR")
    @Test fun beforeAndroid12ALockedPhoneSendsNothing() {
        val id = postKiosk()
        assertEquals(listOf("Examiner"), fleet.shownFor(fleet.prodId).single { it.id == id }.actionTitles)

        shadowOf(fleet.app.getSystemService(KeyguardManager::class.java)).setIsDeviceLocked(true)
        fleet.prod.on("POST /api/devices/240/approve", """{"data":${KIOSK_PENDING.replace("\"approvalStatus\":\"pending\"", "\"approvalStatus\":\"approved\"")}}""")
        fleet.prod.on("PATCH /api/live-alerts/9812/read", """{"success":true}""")
        listOf(fleet.prod, fleet.dev, fleet.qual).forEach { it.requests.clear() }

        val approve = Intent(fleet.app, NotificationActionReceiver::class.java).setAction(ActionKind.APPROVE.action)
        ActionExtras.write(approve, ActionTarget(fleet.prodId, id, deviceId = 240, tenantId = SampleData.ACME_TENANT, label = "KIOSK-ACCUEIL-02"))
        assertFalse(handle(approve))
        val markRead = Intent(fleet.app, NotificationActionReceiver::class.java).setAction(ActionKind.MARK_READ.action)
        ActionExtras.write(markRead, ActionTarget(fleet.prodId, NotificationIds.alert(fleet.prodId, 9812), alertId = 9812, deviceId = 211))
        assertFalse(handle(markRead))

        assertEquals(0, fleet.prod.count("POST /api/devices/240/approve"))
        assertEquals(0, fleet.prod.count("PATCH /api/live-alerts/9812/read"))
        assertTrue(fleet.prod.requests.isEmpty())
        assertEquals("Ouvrez Obliance pour terminer", fleet.shownFor(fleet.prodId).single { it.id == id }.title)
    }

    @Config(sdk = [30], qualifiers = "fr-rFR")
    @Test fun beforeAndroid12AnUnlockedPhoneStillActs() {
        val id = postKiosk()
        shadowOf(fleet.app.getSystemService(KeyguardManager::class.java)).setIsDeviceLocked(false)
        fleet.prod.on("POST /api/devices/240/approve", """{"data":${KIOSK_PENDING.replace("\"approvalStatus\":\"pending\"", "\"approvalStatus\":\"approved\"")}}""")
        val approve = Intent(fleet.app, NotificationActionReceiver::class.java).setAction(ActionKind.APPROVE.action)
        ActionExtras.write(approve, ActionTarget(fleet.prodId, id, deviceId = 240, tenantId = SampleData.ACME_TENANT, label = "KIOSK-ACCUEIL-02"))
        assertTrue(handle(approve))
        assertEquals(1, fleet.prod.count("POST /api/devices/240/approve"))
    }

    @Test fun aTenantMismatchIsNeverSent() {
        val id = postKiosk()
        val intent = actionIntent(id, "Approuver")
        // The user switched back to Default in the app meanwhile.
        fleet.sessions.session(fleet.prodId)!!.markSignedIn(SampleData.probe(fleet.prodId))
        fleet.prod.requests.clear()
        assertFalse(handle(intent))
        assertEquals(0, fleet.prod.count("POST /api/devices/240/approve"))
        assertEquals("Ouvrez Obliance pour terminer", fleet.shownFor(fleet.prodId).single { it.id == id }.title)
    }
}
