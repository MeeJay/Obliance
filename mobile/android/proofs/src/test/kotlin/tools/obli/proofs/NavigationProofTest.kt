package tools.obli.proofs

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Navigation 3 + adaptive list-detail: one pane on a phone, two on a tablet (design doc §2.5, §10.7). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NavigationProofTest {
    @get:Rule val compose = createComposeRule()

    @Test @Config(sdk = [35], qualifiers = "w390dp-h844dp")
    fun phoneShowsOnlyTheDetail() {
        compose.setContent { TriageNavigation(listOf(TriageKey, DeviceKey(508))) }
        compose.onNodeWithText("Appareil 508").assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithText("À traiter").fetchSemanticsNodes().size)
    }

    @Test @Config(sdk = [35], qualifiers = "w1280dp-h800dp")
    fun tabletShowsListAndDetail() {
        compose.setContent { TriageNavigation(listOf(TriageKey, DeviceKey(508))) }
        compose.onNodeWithText("À traiter").assertIsDisplayed()
        compose.onNodeWithText("Appareil 508").assertIsDisplayed()
    }

    @Test @Config(sdk = [35], qualifiers = "w1280dp-h800dp")
    fun tabletPlaceholderWhenNothingSelected() {
        compose.setContent { TriageNavigation() }
        compose.onNodeWithText("À traiter").assertIsDisplayed()
        compose.onNodeWithText("Sélectionnez un appareil").assertIsDisplayed()
    }
}
