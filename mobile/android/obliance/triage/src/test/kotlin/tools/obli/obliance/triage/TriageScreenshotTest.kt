package tools.obli.obliance.triage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * Screenshots of S10 over the design doc §4 data (the night of 25 September,
 * 03:24 in Paris), French locale. Recorded under build/outputs/roborazzi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class TriageScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val paris: ZoneId = ZoneId.of("Europe/Paris")
    private val time = TriageTime(NIGHT_NOW, paris)

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun capture(name: String, services: ObliServices = SampleObliServices(), content: @Composable () -> Unit) {
        compose.setContent { ObliTheme { CompositionLocalProvider(LocalObliServices provides services) { content() } } }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    /** The real screen (ViewModel + sample services) at a fixed clock. */
    @Composable
    private fun Route(segment: TriageSegment? = null) =
        TriageRoute(onOpenDevice = { _, _ -> }, clock = { NIGHT_NOW }, zone = paris, tick = false, initialSegment = segment)

    /** A given state through the same mapper as the ViewModel (states the sample data does not produce). */
    private fun mapped(
        base: SampleObliServices = SampleObliServices(),
        snapshot: AlertsSnapshot = base.alerts.snapshot.value,
        local: LocalState = LocalState(),
    ): TriageUi {
        val devices = SampleData.devices.associateBy { DeviceRef(SampleData.PROD, it.id) }
        return TriageMapper.map(snapshot, base.registry.state.value, base.tenants.scope.value, true, true, local, devices, NIGHT_NOW)
    }

    private fun content(name: String, ui: TriageUi) = capture(name) { TriageContent(ui, time, TriageActions()) }

    @Test fun alerts() = capture("triage_alerts.png") { Route() }

    @Config(qualifiers = "fr-rFR-w390dp-h1900dp-xxhdpi")
    @Test fun alertsFullList() {
        val base = SampleObliServices()
        val snap = base.alerts.snapshot.value.let { s ->
            s.copy(alerts = s.alerts.map { a -> if (a.alert.id == 9741L) a.copy(alert = a.alert.copy(readAt = "2026-09-25T01:00:00Z")) else a })
        }
        content("triage_alerts_full.png", mapped(base, snap, LocalState(readExpanded = true)))
    }

    @Test fun singleServer() = capture("triage_single_server.png", SampleObliServices(serverCount = 1)) { Route() }

    @Test fun approvals() = capture("triage_approvals.png") { Route(TriageSegment.APPROVALS) }

    @Test fun reviewSheet() {
        val base = SampleObliServices()
        val e = mapped(base).escalations.single()
        val target = SampleData.devices.first { it.id == 233L }
        capture("triage_review.png", base) { SheetFrame { ApprovalReviewContent(ReviewState(e.item, e, target = target, reason = "Validé par téléphone"), time, true, {}, { _, _ -> }, {}, {}, {}) } }
    }

    @Test fun reviewConfirm() {
        val base = SampleObliServices()
        val e = mapped(base).escalations.single()
        val spec = ActionSpec(TriageViewModel.KEY_APPROVE, Tier.T2, "Approuver cette demande ?", "Désinstaller l'agent de PC-ATELIER-02 — PC-ATELIER-02", "Obliance Prod › ACME")
        capture("triage_review_confirm.png", base) {
            SheetFrame { ApprovalReviewContent(ReviewState(e.item, e, step = ReviewStep.Confirm(true, spec)), time, true, {}, { _, _ -> }, {}, {}, {}) }
        }
    }

    @Test fun reviewTenantSwitch() {
        val base = SampleObliServices()
        val e = mapped(base).escalations.single()
        capture("triage_review_switch.png", base) {
            SheetFrame { ApprovalReviewContent(ReviewState(e.item, e, step = ReviewStep.TenantSwitch("ACME")), time, true, {}, { _, _ -> }, {}, {}, {}) }
        }
    }

    @Test fun empty() {
        val base = SampleObliServices()
        val snap = AlertsSnapshot(feeds = feeds(SampleData.PROD to FeedStatus.OK, SampleData.DEV to FeedStatus.OK, SampleData.QUAL to FeedStatus.OK, updatedAt = NIGHT_NOW - 240_000), updatedAt = NIGHT_NOW - 240_000)
        content("triage_empty.png", mapped(base, snap))
    }

    @Test fun loading() {
        val snap = AlertsSnapshot(feeds = feeds(SampleData.PROD to FeedStatus.LOADING, SampleData.DEV to FeedStatus.LOADING, SampleData.QUAL to FeedStatus.LOADING))
        content("triage_loading.png", mapped(snapshot = snap))
    }

    @Test fun error() {
        val snap = AlertsSnapshot(feeds = feeds(SampleData.PROD to FeedStatus.UNREACHABLE, SampleData.DEV to FeedStatus.UNREACHABLE, SampleData.QUAL to FeedStatus.UNREACHABLE, updatedAt = null))
        content("triage_error.png", mapped(snapshot = snap))
    }

    @Test fun offlineWithCache() {
        val base = SampleObliServices()
        val at = NIGHT_NOW - 22 * 60_000 // 03:02
        val snap = base.alerts.snapshot.value.copy(
            feeds = feeds(SampleData.PROD to FeedStatus.UNREACHABLE, SampleData.DEV to FeedStatus.UNREACHABLE, SampleData.QUAL to FeedStatus.UNREACHABLE, updatedAt = at),
            updatedAt = at,
        )
        content("triage_offline.png", mapped(base, snap))
    }

    @Test fun serverNotices() {
        val base = SampleObliServices()
        val snap = base.alerts.snapshot.value.copy(
            feeds = feeds(SampleData.PROD to FeedStatus.OK, SampleData.DEV to FeedStatus.UNREACHABLE, SampleData.QUAL to FeedStatus.EXPIRED, updatedAt = NIGHT_NOW - 22 * 60_000),
        )
        content("triage_server_notices.png", mapped(base, snap))
    }

    @Test fun siteOutageAndPill() {
        val base = SampleObliServices()
        val outage = listOf(
            offlineAlert(9801, "SRV-AD2", 211, "2026-09-25T01:07:10Z"),
            offlineAlert(9802, "SRV-LEGACY", 205, "2026-09-25T01:08:05Z"),
            offlineAlert(9803, "PC-ATELIER-02", 233, "2026-09-25T01:09:00Z"),
        )
        val snap = base.alerts.snapshot.value.let { it.copy(alerts = outage + it.alerts.filter { a -> a.alert.id != 9812L }) }
        val shown = snap.alerts.filter { it.alert.id != 9807L }.map { it.key }.toSet()
        content("triage_outage_pill.png", mapped(base, snap, LocalState(atTop = false, acknowledged = shown)))
    }

    @Test fun severityFilter() {
        content("triage_filter_critical.png", mapped(local = LocalState(severities = setOf(tools.obli.shell.alerts.AlertSeverity.CRITICAL))))
    }

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun tablet() = capture("triage_tablet.png") { Route() }

    @Config(qualifiers = "en-rUS-w390dp-h844dp-xxhdpi")
    @Test fun alertsEnglish() = capture("triage_alerts_en.png") { Route() }

    /** A bottom-sheet look for the sheet contents (Robolectric does not capture dialog windows). */
    @Composable
    private fun SheetFrame(content: @Composable () -> Unit) {
        val c = ObliTheme.colors
        Box(Modifier.fillMaxSize().background(c.bg.copy(alpha = 1f)), contentAlignment = Alignment.BottomCenter) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).background(c.surface1)) {
                Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.width(32.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.divider))
                }
                content()
            }
        }
    }
}
