package tools.obli.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.model.ServerColor

/** Visual check of the tokens and components, both themes (design doc §8, §10.11). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w390dp-h400dp-xxhdpi")
class DesignSystemScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    @Composable
    private fun Sample(variant: ObliThemeVariant) = ObliTheme(variant) {
        val c = ObliTheme.colors
        Column(
            Modifier.fillMaxWidth().background(c.bg).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("À traiter", style = ObliTypography.screenTitle, color = c.text)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ObliServerTile(ServerColor.VIOLET, "OP", "Obliance Prod")
                Text("Default · Vue globale", style = ObliTypography.label, color = c.text)
            }
            Column(Modifier.fillMaxWidth().background(c.surface1).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    ObliServerTile(ServerColor.FUCHSIA, "OQ", "Obliance Qual")
                    Text("CRITIQUE · DEFAULT · 02:58", style = ObliTypography.overline, color = c.textMuted)
                }
                Text("SRV-QUAL01 — Hors ligne", style = ObliTypography.rowTitle, color = c.text)
                Text("Aucun push reçu depuis 5 min.", style = ObliTypography.body, color = c.text2)
                ObliStatusPill(ObliTokens.Status.OFFLINE, "Hors ligne")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ServerColor.entries.forEach { ObliServerTile(it, it.name.take(2), it.name, size = 28.dp) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ObliStatusPill(ObliTokens.Status.ONLINE, "En ligne")
                ObliStatusPill(ObliTokens.Status.WARNING, "Attention")
                ObliStatusPill(ObliTokens.Status.CRITICAL, "Critique")
            }
        }
    }

    @Test fun operator() {
        compose.setContent { Sample(ObliThemeVariant.OPERATOR) }
        compose.onRoot().captureRoboImage(shot("designsystem_operator.png"))
    }

    @Test fun neon() {
        compose.setContent { Sample(ObliThemeVariant.NEON) }
        compose.onRoot().captureRoboImage(shot("designsystem_neon.png"))
    }

    @Test fun modern() {
        compose.setContent { Sample(ObliThemeVariant.MODERN) }
        compose.onRoot().captureRoboImage(shot("designsystem_modern.png"))
    }

    @Test fun night() {
        compose.setContent { Sample(ObliThemeVariant.NIGHT) }
        compose.onRoot().captureRoboImage(shot("designsystem_night.png"))
    }
}
