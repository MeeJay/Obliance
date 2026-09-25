package tools.obli.obliance.more

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tools.obli.core.designsystem.ObliTheme

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class AppLockGateTest {
    @get:Rule val compose = createComposeRule()

    @After fun tearDown() = AppLock.detachForTest()

    @Test fun `the content is not composed while locked, and composes after unlock`() {
        var composedContent = 0
        val controller = AppLock.attach({ 1_000L }, { true }, AppPrefs(lockEnabled = true))
        compose.setContent {
            ObliTheme {
                AppLockGate(reason = "Déverrouillez pour ouvrir les processus de PC-COMPTA-03") {
                    composedContent++
                    Text("Contenu de l’app", modifier = Modifier.testTag("app_content"))
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithTag(LOCK_SCREEN_TAG).assertIsDisplayed()
        compose.onNodeWithText("Obliance est verrouillé").assertIsDisplayed()
        compose.onNodeWithText("Déverrouillez pour ouvrir les processus de PC-COMPTA-03").assertIsDisplayed()
        compose.onNodeWithTag("app_content").assertDoesNotExist()
        assertEquals(0, composedContent)

        compose.runOnIdle { controller.unlock() }
        compose.waitForIdle()
        compose.onNodeWithTag("app_content").assertIsDisplayed()
        compose.onNodeWithTag(LOCK_SCREEN_TAG).assertDoesNotExist()
        assertTrue(composedContent > 0)
    }

    @Test fun `no lock installed, or the lock off, the content shows at once`() {
        AppLock.attach({ 1_000L }, { true }, AppPrefs(lockEnabled = false))
        compose.setContent { ObliTheme { AppLockGate { Text("Contenu", modifier = Modifier.testTag("app_content")) } } }
        compose.onNodeWithTag("app_content").assertIsDisplayed()
        compose.onNodeWithTag(LOCK_SCREEN_TAG).assertDoesNotExist()
    }

    @Test fun `no screen lock on the phone, never locked`() {
        AppLock.attach({ 1_000L }, { false }, AppPrefs(lockEnabled = true))
        compose.setContent { ObliTheme { AppLockGate { Text("Contenu", modifier = Modifier.testTag("app_content")) } } }
        compose.onNodeWithTag("app_content").assertIsDisplayed()
    }
}

/** FLAG_SECURE holders on a real (Robolectric) activity window. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SecureFlagsTest {
    private fun secure(activity: ComponentActivity) = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    @Test fun `set by the first holder, cleared by the last`() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val window = activity.window
        SecureFlags.acquire(window)
        SecureFlags.acquire(window)
        assertTrue(secure(activity))
        SecureFlags.release(window)
        assertTrue(secure(activity))
        SecureFlags.release(window)
        assertEquals(false, secure(activity))
    }

    @Test fun `never clears a flag it did not set`() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val window = activity.window
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        SecureFlags.acquire(window)
        SecureFlags.release(window)
        assertTrue(secure(activity))
    }
}
