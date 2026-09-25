package tools.obli.obliance.triage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import java.time.ZoneId
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * Screenshots of the « Enrôlements » segment and of S12 over the design doc §4
 * data (KIOSK-ACCUEIL-02 on Obliance Prod, 3 servers, 03:24 in Paris), French
 * locale, phone and tablet. Recorded under build/outputs/roborazzi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = PHONE)
class EnrolmentScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val paris: ZoneId = ZoneId.of("Europe/Paris")
    private val time = TriageTime(NIGHT_NOW, paris)

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun capture(name: String, services: ObliServices = SampleObliServices(), content: @Composable () -> Unit) {
        compose.setContent { ObliTheme { CompositionLocalProvider(LocalObliServices provides services) { content() } } }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    /** The real screen: ViewModel + the §4 sample enrolment source, Enrôlements selected. */
    @Composable
    private fun Route() = TriageRoute(onOpenDevice = { _, _ -> }, clock = { NIGHT_NOW }, zone = paris, tick = false, initialSegment = TriageSegment.ENROLMENTS)

    private fun review(duplicate: Boolean, step: EnrolmentStep = EnrolmentStep.DETAILS): EnrolmentReviewState {
        val item = enrolmentUi(listOf(KIOSK.copy(duplicateAgentIdSuspected = duplicate))).enrolmentGroups.single().items.single()
        return EnrolmentReviewState(item, step = step, groups = GroupsLoad.Loaded(SampleEnrolmentsSource.GROUPS))
    }

    private fun sheet(name: String, state: EnrolmentReviewState) = capture(name) {
        SheetFrame { EnrolmentReviewContent(state, time, true, {}, {}, {}, {}, {}, {}) }
    }

    private fun content(name: String, ui: TriageUi) = capture(name) { TriageContent(ui, time, TriageActions()) }

    // --- Segment ------------------------------------------------------------------

    @Test fun segment() = capture("triage_enrolments.png") { Route() }

    @Config(qualifiers = TABLET)
    @Test fun segmentTablet() = capture("triage_enrolments_tablet.png") { Route() }

    /** Two « Serveur › Tenant » sections with « Tout approuver (2) ». */
    @Test fun sections() = content("triage_enrolments_sections.png", enrolmentUi(listOf(KIOSK, ATELIER, HV01, BOB01)))

    @Test fun expired() = content("triage_enrolments_expired.png", enrolmentUi(status = tools.obli.obliance.data.FeedStatus.EXPIRED))

    @Test fun empty() = content("triage_enrolments_empty.png", enrolmentUi(emptyList()))

    @Config(qualifiers = TABLET)
    @Test fun emptyTablet() = content("triage_enrolments_empty_tablet.png", enrolmentUi(emptyList()))

    // --- S12 --------------------------------------------------------------------------

    @Test fun review() = sheet("triage_enrolment_review.png", review(duplicate = false))

    @Config(qualifiers = TABLET)
    @Test fun reviewTablet() = sheet("triage_enrolment_review_tablet.png", review(duplicate = false))

    @Test fun reviewDuplicate() = sheet("triage_enrolment_review_duplicate.png", review(duplicate = true))

    @Config(qualifiers = TABLET)
    @Test fun reviewDuplicateTablet() = sheet("triage_enrolment_review_duplicate_tablet.png", review(duplicate = true))

    @Test fun reviewGroupPicker() = sheet("triage_enrolment_review_groups.png", review(duplicate = false, step = EnrolmentStep.PICK_GROUP))

    @Config(qualifiers = "en-rUS-w390dp-h844dp-xxhdpi")
    @Test fun reviewEnglish() = sheet("triage_enrolment_review_en.png", review(duplicate = false))

    /** A bottom-sheet look for the sheet contents (Robolectric does not capture dialog windows); 640 dp max like M3 sheets. */
    @Composable
    private fun SheetFrame(content: @Composable () -> Unit) {
        val c = ObliTheme.colors
        Box(Modifier.fillMaxSize().background(c.bg), contentAlignment = Alignment.BottomCenter) {
            Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).background(c.surface1)) {
                Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.width(32.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.divider))
                }
                content()
            }
        }
    }
}

internal const val PHONE = "fr-rFR-w390dp-h844dp-xxhdpi"
internal const val TABLET = "fr-rFR-w1280dp-h800dp-land-mdpi"
