package tools.obli.obliance.app

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleObliServices

/** The shell over SampleObliServices (design doc §4): phone, tablet, and first launch. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class ShellScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun app(services: SampleObliServices = SampleObliServices()) {
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(LocalObliServices provides services) { ObliNextApp(ready = true) }
            }
        }
    }

    @Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
    @Test fun phoneTriage() {
        app()
        compose.onRoot().captureRoboImage(shot("app_shell_phone_triage.png"))
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

    @Test fun initialsOfTheAvatar() {
        assertEquals("KB", initials("Karim Benali"))
        assertEquals("KA", initials("karim"))
        assertEquals("KB", initials("og_karim.benali".removePrefix("og_")))
        assertEquals("", initials(""))
    }
}
