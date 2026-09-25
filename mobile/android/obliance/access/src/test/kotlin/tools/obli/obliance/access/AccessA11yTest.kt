package tools.obli.obliance.access

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tools.obli.core.designsystem.ObliTheme
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleObliServices

/** TalkBack: a sign-in error is tied to its field and announced when it appears (design doc §7.11). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class AccessA11yTest {
    @get:Rule val compose = createComposeRule()

    @Test fun credentialsErrorIsOnTheFieldAndAnnounced() {
        val state = SignInUiState(SignInMode.FIRST, SignInStep.METHOD, address = "obliance-prod.example.org").copy(
            probe = ProbeInfo("https://obliance-prod.example.org", "5.1.110", offersSso = true, obligateHost = "id.example.org"),
            localExpanded = true,
            username = "karim.benali",
            password = "motdepasse",
            problem = SignInProblem(ProblemKind.CREDENTIALS),
        )
        compose.setContent { ObliTheme { CompositionLocalProvider(LocalObliServices provides SampleObliServices(1)) { SignInLayout(state, SignInActions.None) } } }
        compose.waitForIdle()

        val withError = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Error)).fetchSemanticsNodes()
        assertTrue("a field carries the error", withError.isNotEmpty())
        val live = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)).fetchSemanticsNodes()
        assertTrue("the error line is a live region", live.isNotEmpty())
        // The announced text is the error itself.
        val spoken = live.flatMap { it.config.getOrElse(SemanticsProperties.Text) { emptyList() } }.joinToString(" ") { it.text }
        assertEquals(withError.first().config[SemanticsProperties.Error], spoken.trim())
    }
}
