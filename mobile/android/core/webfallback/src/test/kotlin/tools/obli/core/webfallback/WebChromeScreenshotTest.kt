package tools.obli.core.webfallback

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme

/** The native chrome of S90 around a stand-in page (Robolectric draws no WebView), and the error state. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class WebChromeScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    @Test fun chrome() {
        compose.setContent {
            ObliTheme {
                WebFrame("Utilisateurs et équipes", "obliance.example.org/admin/users", 60, {}, {}, {}) {
                    // Stand-in for the server page.
                    Column(Modifier.fillMaxSize().background(Color(0xFF0B0E17)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Utilisateurs", color = Color(0xFFE5E7EB), fontSize = 20.sp)
                        repeat(6) {
                            Column(Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF151A28))) {}
                        }
                    }
                }
            }
        }
        compose.onRoot().captureRoboImage(shot("web_chrome.png"))
    }

    @Test fun error() {
        compose.setContent {
            ObliTheme {
                WebFrame("Politiques de conformité", "obliance.example.org/compliance", 0, {}, {}, {}) { WebError(onRetry = {}) }
            }
        }
        compose.onRoot().captureRoboImage(shot("web_error.png"))
    }
}
