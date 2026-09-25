package tools.obli.obliance.more

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.clickable
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.performClick
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

    @Test fun `the content's saved state survives a lock and an unlock`() {
        var now = 1_000L
        val controller = AppLock.attach({ now }, { true }, AppPrefs(lockEnabled = true, lockTimeout = LockTimeout.IMMEDIATE))
        controller.unlock()
        compose.setContent {
            ObliTheme {
                AppLockGate {
                    var taps by rememberSaveable { mutableIntStateOf(0) }
                    Text("Écran ouvert $taps", modifier = Modifier.testTag("app_content").clickable { taps++ })
                }
            }
        }
        repeat(3) { compose.onNodeWithTag("app_content").performClick() }
        compose.onNodeWithText("Écran ouvert 3").assertIsDisplayed()

        // A trip to the background with « Immédiat »: S00, the content leaves the composition.
        compose.runOnIdle {
            controller.onBackground()
            now += 1
            controller.onForeground()
        }
        compose.waitForIdle()
        compose.onNodeWithTag(LOCK_SCREEN_TAG).assertIsDisplayed()
        compose.onNodeWithTag("app_content").assertDoesNotExist()

        compose.runOnIdle { controller.unlock() }
        compose.waitForIdle()
        compose.onNodeWithText("Écran ouvert 3").assertIsDisplayed()
    }

    @Test fun `before the preferences are read, neither the app nor S00`() {
        AppLock.attach({ 1_000L }, { true }, AppPrefs(), loaded = false)
        compose.setContent { ObliTheme { AppLockGate { Text("Contenu", modifier = Modifier.testTag("app_content")) } } }
        compose.onNodeWithTag(LOCK_PENDING_TAG).assertExists()
        compose.onNodeWithTag(LOCK_SCREEN_TAG).assertDoesNotExist()
        compose.onNodeWithTag("app_content").assertDoesNotExist()
    }

    @Test fun `S04 step 3 card, French`() {
        var enabled = 0
        var later = 0
        compose.setContent { ObliTheme { LockOnboardingContent(LockTimeout.FIVE_MIN, busy = false, onEnable = { enabled++ }, onLater = { later++ }) } }
        compose.onNodeWithText("Verrouiller Obliance").assertIsDisplayed()
        compose.onNodeWithText("Obliance vous demandera votre empreinte ou le code de l’appareil à l’ouverture et après 5", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Activer").performClick()
        compose.onNodeWithText("Pas maintenant").performClick()
        assertEquals(1, enabled)
        assertEquals(1, later)
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
