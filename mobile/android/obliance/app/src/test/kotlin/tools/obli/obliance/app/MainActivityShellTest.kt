package tools.obli.obliance.app

import android.content.Intent
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.more.AppLock
import tools.obli.obliance.notifications.NotificationRoute

/**
 * Smoke test of the whole application: the real [MainActivity] and shell over
 * the PRODUCTION repositories ([tools.obli.obliance.data.DefaultObliServices]),
 * each server of design doc §4 being a fake HTTP server. Screenshots go to
 * build/outputs/roborazzi/shell/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = ShellTestApplication::class)
class MainActivityShellTest {
    @get:Rule val compose = createEmptyComposeRule()

    private var fake: FakeObliance? = null
    private var scenario: ActivityScenario<MainActivity>? = null

    @After fun tearDown() {
        AppLock.setLockedForTest(false)
        scenario?.close()
        fake?.close()
    }

    private val app: ShellTestApplication get() = ApplicationProvider.getApplicationContext()

    /** Starts the app over [f]; [route]: as if a notification had been tapped (cold start). */
    private fun launch(f: FakeObliance, route: NotificationRoute? = null): FakeObliance {
        fake = f
        app.host = f
        f.start()
        scenario = if (route == null) ActivityScenario.launch(MainActivity::class.java) else ActivityScenario.launch<MainActivity>(app.intentFor(route))
        return f
    }

    /** A notification tapped while the app runs (singleTask: onNewIntent). */
    private fun deliver(route: NotificationRoute) {
        val intent: Intent = app.intentFor(route)
        scenario!!.onActivity { InstrumentationRegistry.getInstrumentation().callActivityOnNewIntent(it, intent) }
        compose.waitForIdle()
    }

    /** The destination [label] is the selected one (the bar is visible). */
    private fun waitSelected(label: String) = waitFor {
        compose.onAllNodes(hasContentDescription(label, substring = true) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected) and isSelected())
            .fetchSemanticsNodes().isNotEmpty()
    }

    private fun shot(name: String) =
        captureScreenRoboImage((System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/shell/" + name)

    private fun waitText(text: String, substring: Boolean = false) =
        compose.waitUntil(TIMEOUT) { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }

    private fun waitFor(condition: () -> Boolean) = compose.waitUntil(TIMEOUT) { condition() }

    /** A destination of the navigation bar or rail (selectable, labelled). */
    private fun nav(label: String) =
        compose.onNode(hasContentDescription(label) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected)).performClick()

    private fun openScope() = compose.onNode(hasContentDescription("Périmètre", substring = true)).performClick()

    /** À traiter aggregates the three servers: every feed OK, alerts of Prod, Dev and Qual. */
    private fun assertAggregated(f: FakeObliance) {
        waitFor { f.services.alerts.snapshot.value.feeds.size == 3 && f.services.alerts.snapshot.value.feeds.all { it.status == FeedStatus.OK } }
        val servers = f.services.alerts.snapshot.value.alerts.map { it.serverId }.toSet()
        assertEquals(setOf(SampleData.PROD, SampleData.DEV, SampleData.QUAL), servers)
        waitText("SRV-AD2", substring = true)
        waitText("SRV-QUAL01", substring = true)
    }

    private fun tour(prefix: String, onDevices: () -> Unit = {}) {
        val f = launch(FakeObliance())
        assertAggregated(f)
        shot("${prefix}_1_triage.png")

        nav("Appareils")
        waitText("PC-COMPTA-03")
        shot("${prefix}_2_devices.png")
        onDevices()

        nav("Flotte")
        waitText("ATTENTION REQUISE")
        waitFor { f.requests(SampleData.PROD).contains("GET /api/devices/fleet-hourly") }
        compose.waitForIdle()
        shot("${prefix}_3_fleet.png")

        nav("Plus")
        waitText("Karim Benali")
        shot("${prefix}_4_more.png")

        openScope()
        waitText("Gérer les serveurs")
        waitText("Obliance Qual")
        shot("${prefix}_5_scope_sheet.png")

        // Lists are the ACTIVE server's: Dev and Qual never got a device list request
        // (À traiter's enrolment feed, `approvalStatus=pending`, covers every server).
        assertFalse(f.fullRequests(SampleData.DEV).any { it.startsWith("GET /api/devices") && "approvalStatus=pending" !in it })
        assertFalse(f.fullRequests(SampleData.QUAL).any { it.startsWith("GET /api/devices") && "approvalStatus=pending" !in it })
        assertFalse(f.requests(SampleData.DEV).contains("GET /api/updates/stats"))
    }

    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneNoServerShowsSignIn() {
        launch(FakeObliance(serverCount = 0))
        waitText("Connexion")
        shot("phone_0_no_server_sign_in.png")
    }

    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun tabletNoServerShowsSignIn() {
        launch(FakeObliance(serverCount = 0))
        waitText("Connexion")
        shot("tablet_0_no_server_sign_in.png")
    }

    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneThreeServersTour() = tour("phone")

    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun tabletThreeServersTour() = tour("tablet") {
        // List | detail scene of the Appareils destination.
        compose.onAllNodesWithText("PC-COMPTA-03").onFirst().performClick()
        waitText("IDENTITÉ")
        shot("tablet_2b_devices_list_detail.png")
    }

    /** §2.10: opening a Qual alert from À traiter switches to Qual, says so, and "Revenir" goes back to Prod. */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneImplicitSwitchAndBack() {
        val f = launch(FakeObliance())
        assertAggregated(f)
        compose.onAllNodesWithText("SRV-QUAL01", substring = true).onFirst().performClick()
        waitFor { f.registry.state.value.activeId == SampleData.QUAL }
        waitText("Revenir")
        waitText("IDENTITÉ")
        shot("phone_6_implicit_switch_qual.png")
        // The detail was asked of Qual only; Prod never saw device 5.
        assertTrue(f.requests(SampleData.QUAL).contains("GET /api/devices/5"))
        assertFalse(f.requests(SampleData.PROD).contains("GET /api/devices/5"))

        compose.onAllNodesWithText("Revenir").onFirst().performClick()
        waitFor { f.registry.state.value.activeId == SampleData.PROD }
        waitText("SRV-AD2", substring = true)
        shot("phone_7_switched_back_prod.png")
    }

    /** S03: the active server answers 401 → the re-authentication sheet over the shell. */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneExpiredSessionShowsReauth() {
        launch(FakeObliance(expired = setOf(SampleData.PROD)))
        waitText("a expiré", substring = true)
        shot("phone_8_session_expired_reauth.png")
    }

    private fun click(text: String, substring: Boolean = false) {
        waitText(text, substring)
        compose.onAllNodesWithText(text, substring = substring).onFirst().performClick()
        compose.waitForIdle()
    }

    private fun back() {
        scenario!!.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    /**
     * 0.2.0 "Agir" through the real shell: device detail with its action bar,
     * the Agir sheet, S61 then S60 (T1 confirmation, then the agent offline),
     * Activité and a batch in flight.
     */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneAgirTour() {
        val f = launch(FakeObliance())
        assertAggregated(f)
        nav("Appareils")
        click("PC-COMPTA-03")
        waitText("IDENTITÉ")
        compose.waitForIdle()
        shot("phone_10_device_detail_action_bar.png")

        click("Agir")
        waitText("Terminal PowerShell")
        shot("phone_11_agir_sheet.png")

        // Windows shell: S61 first (the agent cannot list its sessions here: SYSTEM only).
        click("Terminal PowerShell")
        waitText("Session SYSTÈME (aucun utilisateur)")
        waitText("La session SYSTÈME reste disponible", substring = true)
        shot("phone_12_session_choice.png")

        click("Session SYSTÈME (aucun utilisateur)")
        // T1 sheet: its button carries the action's title.
        waitText("Ouvrir PowerShell")
        compose.waitForIdle()
        shot("phone_13_terminal_confirm.png")
        compose.onAllNodesWithText("Ouvrir PowerShell").onLast().performClick()
        waitFor { f.requests(SampleData.PROD).contains("POST /api/remote/sessions") }
        waitText("Réessayer")
        compose.waitForIdle()
        shot("phone_14_terminal_agent_offline.png")

        // Fermer → the device detail, back → the list (bar visible again).
        click("Fermer")
        waitText("IDENTITÉ")
        back()
        waitFor { compose.onAllNodes(hasContentDescription("Activité") and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected)).fetchSemanticsNodes().isNotEmpty() }
        nav("Activité")
        waitText("Nettoyer les fichiers temporaires")
        compose.waitForIdle()
        shot("phone_15_activity.png")

        click("Nettoyer les fichiers temporaires")
        waitText("PC-COMPTA-02")
        compose.waitForIdle()
        shot("phone_16_batch.png")
        // Activité calls are the ACTIVE server's only.
        assertFalse(f.requests(SampleData.DEV).any { it.startsWith("GET /api/executions") })
    }

    /** Tablet: Activité | batch (list-detail scene), app bar and rail kept. */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun tabletActivityAndBatch() {
        val f = launch(FakeObliance())
        assertAggregated(f)
        nav("Activité")
        waitText("Nettoyer les fichiers temporaires")
        compose.waitForIdle()
        shot("tablet_10_activity.png")
        click("Nettoyer les fichiers temporaires")
        waitText("PC-COMPTA-02")
        compose.waitForIdle()
        shot("tablet_11_activity_batch.png")
    }

    /**
     * 0.3.0 notification route (cold start): a device of Obliance Qual while
     * Prod is active. Implicit switch to Qual, `locate-device` (member of
     * Default there, not a master admin), same tenant so no tenant switch, the
     * detail on the À traiter stack, « Passé sur Obliance Qual pour ouvrir
     * SRV-QUAL01 · Revenir ».
     */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneRouteDeviceOfAnotherServer() {
        val f = launch(FakeObliance(), NotificationRoute.Device(SampleData.QUAL, 5, tenantId = null, label = "SRV-QUAL01"))
        waitFor { f.registry.state.value.activeId == SampleData.QUAL }
        waitText("IDENTITÉ")
        waitText("Passé sur Obliance Qual pour ouvrir SRV-QUAL01")
        compose.waitForIdle()
        shot("phone_20_route_device_other_server.png")
        assertTrue(f.requests(SampleData.QUAL).contains("GET /api/tenants/locate-device/5"))
        assertFalse(f.requests(SampleData.QUAL).contains("POST /api/tenant/switch"))
        assertTrue(f.requests(SampleData.QUAL).contains("GET /api/devices/5"))
        assertFalse(f.requests(SampleData.PROD).contains("GET /api/devices/5"))
        // The detail was pushed on À traiter: back shows À traiter's root.
        back()
        waitSelected("À traiter")
    }

    /** Server AND tenant change: ONE snackbar names both (design doc §2.10 item 3). */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneRouteDeviceSwitchesServerAndTenant() {
        val f = launch(FakeObliance(deviceTenants = mapOf(5L to SampleData.ACME_TENANT)), NotificationRoute.Device(SampleData.QUAL, 5, tenantId = null, label = "SRV-QUAL01"))
        waitFor { f.registry.state.value.activeId == SampleData.QUAL }
        waitText("Passé sur Obliance Qual › ACME pour ouvrir SRV-QUAL01")
        waitText("IDENTITÉ")
        compose.waitForIdle()
        shot("phone_21_route_device_server_and_tenant.png")
        assertTrue(f.requests(SampleData.QUAL).contains("POST /api/tenant/switch"))
        assertFalse(f.requests(SampleData.PROD).contains("POST /api/tenant/switch"))
    }

    /**
     * A two-person approval tapped while the app runs on Appareils: À traiter,
     * Approbations segment, S11 of #17. No server switch (inbox action, §2.10 item 4).
     */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneRouteApprovalSelectsTheApprovalsSegment() {
        val f = launch(FakeObliance())
        assertAggregated(f)
        nav("Appareils")
        waitText("PC-COMPTA-03")
        deliver(NotificationRoute.Approval(SampleData.PROD, 17, tenantId = SampleData.ACME_TENANT))
        waitFor { compose.onAllNodes(hasText("Approbations", substring = true) and isSelected()).fetchSemanticsNodes().isNotEmpty() }
        waitText("Approuver")
        compose.waitForIdle()
        shot("phone_22_route_approval.png")
        assertEquals(SampleData.PROD, f.registry.state.value.activeId)
    }

    /** "Se reconnecter" for a server that is not active: S03 for THAT server, the active one stays. */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneRouteSignInOfAnotherServer() {
        val f = launch(FakeObliance(expired = setOf(SampleData.QUAL)), NotificationRoute.SignIn(SampleData.QUAL))
        waitText("Votre session sur Obliance Qual a expiré")
        compose.waitForIdle()
        shot("phone_23_route_sign_in_other_server.png")
        assertEquals(SampleData.PROD, f.registry.state.value.activeId)
    }

    /**
     * S00 over the real shell (the app wraps ObliNextApp in AppLockGate): lock
     * then unlock with a device detail open on Appareils. The same screen comes
     * back (not À traiter's root) and its stack is unchanged: back returns to
     * the Appareils list.
     */
    @Config(sdk = [35], application = ShellTestApplication::class, qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneLockThenUnlockKeepsTheOpenScreenAndItsStack() {
        val f = launch(FakeObliance())
        assertAggregated(f)
        nav("Appareils")
        click("PC-COMPTA-03")
        waitText("IDENTITÉ")

        AppLock.setLockedForTest(true)
        waitText("Obliance est verrouillé")
        compose.waitForIdle()
        assertTrue("nothing of the app is composed behind S00", compose.onAllNodesWithText("IDENTITÉ").fetchSemanticsNodes().isEmpty())
        shot("phone_24_locked.png")

        AppLock.setLockedForTest(false)
        waitText("IDENTITÉ")
        assertTrue(compose.onAllNodesWithText("Obliance est verrouillé").fetchSemanticsNodes().isEmpty())
        back()
        waitSelected("Appareils")
        waitText("PC-COMPTA-03")
    }

    private companion object {
        const val TIMEOUT = 20_000L
    }
}
