package tools.obli.obliance.fleet

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * Screenshots of S70 over the design doc §4 data (Obliance Prod, global view,
 * 03:22 in Paris), French locale. Recorded under build/outputs/roborazzi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class FleetScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val paris: ZoneId = ZoneId.of("Europe/Paris")
    private val time = FleetTime(NIGHT_NOW, paris)

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun capture(name: String, source: FleetSource = SampleFleetSource(), services: ObliServices = SampleObliServices(), content: @Composable () -> Unit) {
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(LocalObliServices provides services, LocalFleetSource provides source) { content() }
            }
        }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    /** The real screen (ViewModel + sample services + §4 fleet source) at a fixed clock. */
    @Composable
    private fun Route() = FleetRoute(onOpenDevices = {}, clock = { NIGHT_NOW }, zone = paris)

    private fun data(admin: Boolean = true) = FleetData(
        serverId = SampleData.PROD,
        summary = SampleData.summary,
        serverAggregates = admin,
        attention = SampleData.devices.needingAttention(5),
        groups = SampleFleetSource.PROD_GROUPS,
        disks = SampleFleetSource.PROD_DISKS,
        updates = UpdateStats(available = 61, critical = 9),
        hourly = SampleFleetSource.PROD_HOURS,
        showTenants = true,
    )

    @Test fun fleet() = capture("fleet_phone.png") { Route() }

    @Config(qualifiers = "fr-rFR-w390dp-h2600dp-xxhdpi")
    @Test fun fleetFullPage() = capture("fleet_phone_full.png") { Route() }

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun fleetTablet() = capture("fleet_tablet.png") { Route() }

    @Config(qualifiers = "fr-rFR-w390dp-h1400dp-xxhdpi")
    @Test fun nonAdmin() = capture("fleet_phone_non_admin.png", SampleFleetSource(admin = false)) { Route() }

    @Test fun staleAfterNetworkLoss() = capture("fleet_phone_stale.png") {
        FleetContent(FleetUi(loading = false, data = data(), updatedAt = NIGHT_NOW - 20 * 60_000, problem = FleetProblem.OFFLINE), time, {}, {})
    }

    @Test fun loading() = capture("fleet_phone_loading.png") { FleetContent(FleetUi(loading = true), time, {}, {}) }

    /** Global view filtered on ACME (§2.3): figures of the ACME devices, the other cards captioned. */
    private fun acmeFiltered(): ObliServices = SampleObliServices().also { runBlocking { it.tenants.setViewFilter(setOf(SampleData.ACME_TENANT)) } }

    @Config(qualifiers = "fr-rFR-w390dp-h2600dp-xxhdpi")
    @Test fun filteredFullPage() {
        capture("fleet_phone_filtered_full.png", services = acmeFiltered()) { Route() }
        // Updates, full disks and groups say they cover the whole view (the 24 h card says it in its description).
        compose.onAllNodesWithText("Toute la vue globale (filtre non appliqué)").assertCountEquals(3)
        compose.onNodeWithContentDescription("Vue globale filtrée sur ACME").assertExists()
        compose.onNodeWithContentDescription("Dernières 24 heures", substring = true)
            .assert(androidx.compose.ui.test.hasContentDescription("filtre non appliqué", substring = true))
    }

    @Test fun filtered() = capture("fleet_phone_filtered.png", services = acmeFiltered()) { Route() }

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun filteredTablet() = capture("fleet_tablet_filtered.png", services = acmeFiltered()) { Route() }

    @Test fun serverError() = capture("fleet_phone_error.png", SampleFleetSource(summaryAnswer = { ApiOutcome.Failure(502, FailureKind.SERVER) })) { Route() }

    @Test fun empty() = capture("fleet_phone_empty.png") {
        FleetContent(FleetUi(loading = false, data = data().copy(summary = FleetSummary(), attention = emptyList()), updatedAt = NIGHT_NOW), time, {}, {})
    }

    @Test fun healthy() = capture("fleet_phone_healthy.png") {
        val healthy = FleetSummary(total = 18, online = 18, agentUpToDate = 18, latestAgentVersion = "4.5.79")
        FleetContent(
            FleetUi(loading = false, data = data().copy(summary = healthy, attention = emptyList(), disks = DiskSaturation(), groups = emptyList(), hourly = null, showTenants = false), updatedAt = NIGHT_NOW),
            time, {}, {},
        )
    }
}
