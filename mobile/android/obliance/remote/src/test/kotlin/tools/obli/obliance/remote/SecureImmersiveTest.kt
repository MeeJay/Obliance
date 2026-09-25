package tools.obli.obliance.remote

import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * FLAG_SECURE of S60 / S62: set while shown, and cleared on close ONLY when
 * this screen set it. S83 « Bloquer les captures d'écran partout » sets it for
 * the whole window first: closing ObliReach must not drop it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SecureImmersiveTest {
    @get:Rule val compose = createComposeRule()

    private var shown by mutableStateOf(false)
    private var window: Window? = null

    private fun host() {
        compose.setContent {
            window = LocalContext.current.findActivity()?.window
            if (shown) SecureImmersive(immersive = false)
        }
        compose.waitForIdle()
    }

    private fun secure(): Boolean = window!!.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    @Test fun setsTheFlagWhileShownAndClearsWhatItSet() {
        host()
        assertFalse(secure())
        shown = true
        compose.waitForIdle()
        assertTrue(secure())
        shown = false
        compose.waitForIdle()
        assertFalse(secure())
    }

    @Test fun keepsAFlagItDidNotSet() {
        host()
        compose.runOnUiThread { window!!.addFlags(WindowManager.LayoutParams.FLAG_SECURE) }
        shown = true
        compose.waitForIdle()
        assertTrue(secure())
        shown = false
        compose.waitForIdle()
        assertTrue(secure())
    }
}
