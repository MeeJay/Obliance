package tools.obli.obliance.triage

import android.content.Context
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ForbiddenReason
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ui.ActionMessages
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** TriageScreen's request routing and the enrolment texts, in French (design doc §5 S10, S12). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = PHONE)
class TriageRequestTest {
    @get:Rule val compose = createComposeRule()

    private val res get() = ApplicationProvider.getApplicationContext<Context>().resources
    private val paris = ZoneId.of("Europe/Paris")

    @Test fun enrolmentRequestOpensS12AndIsReportedOnce() {
        var handled = 0
        var request by mutableStateOf<TriageRequest?>(TriageRequest.Enrolment(SampleData.PROD, 240))
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(LocalObliServices provides SampleObliServices()) {
                    TriageRoute(
                        onOpenDevice = { _, _ -> }, clock = { NIGHT_NOW }, zone = paris, tick = false,
                        request = request,
                        onRequestHandled = {
                            handled++
                            request = null
                        },
                    )
                }
            }
        }
        compose.waitForIdle()
        assertEquals(1, handled)
        // S12 of KIOSK-ACCUEIL-02 is open over the Enrôlements segment.
        compose.onNodeWithText(res.getString(R.string.triage_enrol_note_scenarios)).assertExists()
        compose.onNodeWithText(res.getString(R.string.triage_enrol_review_overline).uppercase()).assertExists()

        request = TriageRequest.Alerts(SampleData.QUAL)
        compose.waitForIdle()
        assertEquals(2, handled)
    }

    @Test fun aRequestTheCallerKeepsIsNotReportedTwice() {
        var handled = 0
        var recompose by mutableIntStateOf(0)
        val request = TriageRequest.Approval(SampleData.PROD, 17)
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(LocalObliServices provides SampleObliServices()) {
                    // Reading the counter recomposes the screen with the SAME request instance.
                    TriageRoute(onOpenDevice = { _, _ -> }, clock = { NIGHT_NOW }, zone = paris, tick = recompose < 0, request = request, onRequestHandled = { handled++ })
                }
            }
        }
        compose.waitForIdle()
        recompose++
        compose.waitForIdle()
        assertEquals(1, handled)
        // The existing review sheet (S11) of request 17 is open.
        compose.onNodeWithText(res.getString(R.string.triage_review_requester).uppercase()).assertExists()
    }

    @Test fun actionRunnerLookupDoesNotThrowWithoutTheHost() {
        var runner: ActionRunner? = ActionRunner(RecordingPrompter())
        compose.setContent { runner = actionRunnerOrNull() }
        compose.waitForIdle()
        assertEquals(null, runner)
    }

    @Test fun enrolmentMessagesInFrench() {
        assertEquals("KIOSK-ACCUEIL-02 approuvé", enrolmentMessage(res, EnrolmentOutcome.Approved("KIOSK-ACCUEIL-02")))
        assertEquals("KIOSK-ACCUEIL-02 refusé", enrolmentMessage(res, EnrolmentOutcome.Refused("KIOSK-ACCUEIL-02")))
        assertEquals("3 appareils approuvés", enrolmentMessage(res, EnrolmentOutcome.ApprovedMany(3)))
        assertEquals("KIOSK-ACCUEIL-02 approuvé · groupe Siège › Accueil", enrolmentMessage(res, EnrolmentOutcome.ApprovedAndMoved("KIOSK-ACCUEIL-02", "Siège › Accueil")))
        assertEquals("Le serveur n'a pas pris en compte la demande. Réessayez.", enrolmentMessage(res, EnrolmentOutcome.NotApplied))
        // 403: the capability wording of ActionMessages (CONTRACT §12).
        val capability = ApiOutcome.Forbidden(ForbiddenReason.CAPABILITY, "Capability 'power' not permitted for your team on this device", "power")
        val text = enrolmentMessage(res, EnrolmentOutcome.Failed(ActionResult.Failed(capability)))
        assertEquals(ActionMessages.failure(res, capability), text)
        assertTrue(text, text.contains("Alimentation"))
        val other = ApiOutcome.Forbidden(ForbiddenReason.OTHER, "Insufficient permissions")
        assertEquals(ActionMessages.failure(res, other), enrolmentMessage(res, EnrolmentOutcome.Failed(ActionResult.Failed(other))))
        assertEquals("Cette demande n'est plus en attente.", res.getString(R.string.triage_request_approval_gone))
        assertEquals("Cet appareil n'est plus en attente d'enrôlement.", res.getString(R.string.triage_request_enrolment_gone))
        assertEquals("Aucun appareil en attente d'enrôlement.", res.getString(R.string.triage_enrol_empty))
        assertEquals("Session expirée · Se reconnecter", res.getString(R.string.triage_enrol_stale_expired))
    }

    @Test fun confirmationWordingComesFromTheResources() {
        val w = ResourceEnrolmentWording(res)
        assertEquals("Approuver l'enrôlement", w.approveTitle())
        assertEquals("Refuser l'enrôlement", w.refuseTitle())
        assertEquals("Approuver 3 appareils", w.bulkTitle(3))
        assertEquals("3 appareils", w.count(3))
        assertEquals("Approuver et déplacer vers Siège › Accueil", w.moveTitle("Siège › Accueil"))
        assertEquals("Obliance Prod › ACME", w.scope("Obliance Prod", "ACME"))
        assertEquals("ACME", w.scope(null, "ACME"))
        assertEquals(
            "L'agent rejoindra la flotte ; les scénarios « Agent approuvé » de ce tenant se déclencheront.",
            w.approveConsequence(),
        )
        assertEquals("L'agent sera refusé et suspendu.", w.refuseConsequence())
        // The plain wording of the JVM tests says the same, typography aside.
        assertEquals(TestWording.approveTitle(), w.approveTitle())
        assertEquals(TestWording.scope("Obliance Prod", "ACME"), w.scope("Obliance Prod", "ACME"))
    }

    @Test fun everyStringExistsInEnglishAndFrench() {
        fun names(path: String): Set<String> {
            val file = listOf(File(path), File("obliance/triage/$path")).first { it.exists() }
            return Regex("""<(?:string|plurals) name="([a-z0-9_]+)"""").findAll(file.readText()).map { it.groupValues[1] }.toSet()
        }
        val en = names("src/main/res/values/strings.xml")
        val fr = names("src/main/res/values-fr/strings.xml")
        assertEquals(en, fr)
        assertTrue(en.all { it.startsWith("triage_") })
        assertTrue("triage_segment_enrolments" in en && "triage_request_enrolment_gone" in en)
    }
}
