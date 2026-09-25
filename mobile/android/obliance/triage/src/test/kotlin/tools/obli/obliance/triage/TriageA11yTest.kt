package tools.obli.obliance.triage

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createComposeRule
import java.time.ZoneId
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tools.obli.core.designsystem.ObliTheme
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * TalkBack reaches the swipe actions (design doc §5 S10, §7.1, §7.11): they sit
 * on the node TalkBack focuses (the merged card), not on a non-focusable wrapper.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class TriageA11yTest {
    @get:Rule val compose = createComposeRule()

    @Test fun swipeActionsAreOnTheFocusedCard() {
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(LocalObliServices provides SampleObliServices()) {
                    TriageRoute(onOpenDevice = { _, _ -> }, clock = { NIGHT_NOW }, zone = ZoneId.of("Europe/Paris"), tick = false, initialSegment = null)
                }
            }
        }
        compose.waitForIdle()
        val nodes = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)).fetchSemanticsNodes()
        assertTrue("incident cards expose their swipe actions", nodes.isNotEmpty())
        for (node in nodes) {
            // The same node is the focusable (merged) card with its text and its open action.
            assertTrue(node.config.isMergingSemanticsOfDescendants)
            assertTrue(node.config.getOrElse(SemanticsProperties.Text) { emptyList() }.isNotEmpty())
            val labels = node.config[SemanticsActions.CustomActions].map { it.label }
            assertTrue(labels.toString(), "Supprimer" in labels)
        }
        // Unread cards also offer "Marquer comme lu".
        assertTrue(nodes.any { n -> n.config[SemanticsActions.CustomActions].any { it.label == "Marquer comme lu" } })
        // Cards with a device are opened from that same node.
        assertTrue(nodes.any { it.config.contains(SemanticsActions.OnClick) })
    }
}
