package tools.obli.obliance.app

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliThemeVariant
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * The shell over SampleObliServices (design doc §4): phone, tablet, and first launch.
 * ShellTestApplication, not the manifest's ObliNextApplication: the real one
 * installs the notification engine and the lock, process-wide statics that
 * would leak into every test of the Robolectric sandbox.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = ShellTestApplication::class)
class ShellScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun app(services: SampleObliServices = SampleObliServices(), variant: ObliThemeVariant = ObliThemeVariant.OPERATOR) {
        compose.setContent {
            ObliTheme(variant = variant) {
                CompositionLocalProvider(LocalObliServices provides services) { ObliNextApp(ready = true) }
            }
        }
    }

    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneTriage() {
        app()
        compose.onRoot().captureRoboImage(shot("app_shell_phone_triage.png"))
    }

    /** Active server whose user picked Neon UI on the web (design doc §2.10). */
    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneTriageNeon() {
        app(variant = ObliThemeVariant.NEON)
        compose.onRoot().captureRoboImage(shot("app_shell_phone_triage_neon.png"))
    }

    @Config(sdk = [35], qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun tablet() {
        app()
        compose.onRoot().captureRoboImage(shot("app_shell_tablet.png"))
    }

    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun singleServerHasNoTile() {
        app(SampleObliServices(serverCount = 1))
        compose.onRoot().captureRoboImage(shot("app_shell_phone_single_server.png"))
    }

    /** The back stacks are saved (NavKeys are @Serializable): a device detail survives recreation. */
    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun backStacksSurviveStateRestoration() {
        val services = SampleObliServices()
        val tester = StateRestorationTester(compose)
        tester.setContent {
            ObliTheme { CompositionLocalProvider(LocalObliServices provides services) { ObliNextApp(ready = true) } }
        }
        compose.onNodeWithContentDescription("Appareils").performClick()
        compose.onNodeWithText("PC-COMPTA-03").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("IDENTITÉ").assertExists()
        tester.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("IDENTITÉ").assertExists()
        compose.onNodeWithText("PC-COMPTA-03").assertExists()
        compose.onRoot().captureRoboImage(shot("app_shell_phone_device_detail.png"))
    }

    /** Design doc §2.2 / STYLEKIT tenant-chip-filter: « ACME · filtre » with the 6 dp accent2 dot. */
    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneTopBarWithTheViewFilter() {
        val services = SampleObliServices()
        runBlocking { services.registry.setViewFilter(SampleData.PROD, listOf(SampleData.ACME_TENANT)) }
        app(services)
        // The chip exposes one content description (its texts are cleared from the semantics).
        compose.waitUntil(5_000) {
            compose.onAllNodes(hasContentDescription("Obliance Prod, vue globale filtrée sur ACME", substring = true)).fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(true, services.tenants.scope.value.viewFiltered)
        compose.onRoot().captureRoboImage(shot("app_shell_phone_view_filter.png"))
    }

    /**
     * 0.3.0: S83, S84 and S86 pushed on the Plus stack (bars hidden on phones),
     * over the production repositories and fake servers (no network: S83 and
     * S86 ask each server's /health and update manifest).
     */
    private fun plusScreen(row: String, waitFor: String, image: String) = FakeObliance().use { f ->
        f.start()
        compose.setContent {
            ObliTheme { CompositionLocalProvider(LocalObliServices provides f.services) { ObliNextApp(ready = true) } }
        }
        compose.onNodeWithContentDescription("Plus").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(row).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText(row).onFirst().performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(waitFor).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(image))
    }

    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneAppSettingsInTheShell() = plusScreen("R\u00e9glages de l\u2019application", "Verrou biom\u00e9trique", "app_shell_phone_s83_settings.png")

    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneNotificationSettingsInTheShell() = plusScreen("Notifications et astreinte", "Astreinte", "app_shell_phone_s84_notifications.png")

    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneAboutInTheShell() = plusScreen("\u00c0 propos et mises \u00e0 jour", "Obliance pour Android", "app_shell_phone_s86_about.png")

    @Test fun initialsOfTheAvatar() {
        assertEquals("KB", initials("Karim Benali"))
        assertEquals("KA", initials("karim"))
        assertEquals("KB", initials("og_karim.benali".removePrefix("og_")))
        assertEquals("", initials(""))
    }
}
