package tools.obli.obliance.app

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
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
        scenario?.close()
        fake?.close()
    }

    private fun launch(f: FakeObliance): FakeObliance {
        fake = f
        ApplicationProvider.getApplicationContext<ShellTestApplication>().host = f
        f.start()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        return f
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

        // Lists are the ACTIVE server's: Dev and Qual never got a device list request.
        assertFalse(f.requests(SampleData.DEV).any { it.startsWith("GET /api/devices") })
        assertFalse(f.requests(SampleData.QUAL).any { it.startsWith("GET /api/devices") })
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

    private companion object {
        const val TIMEOUT = 20_000L
    }
}
