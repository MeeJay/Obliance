package tools.obli.obliance.devices

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.awaitCancellation
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * Screens over the design doc §4 data (Obliance Prod active, Default global
 * view, three servers), French, at 03:22 on 25 September. Recorded under
 * build/outputs/roborazzi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class DevicesScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun services(serverCount: Int = 3): TestServices =
        TestServices(SampleObliServices(serverCount)).also {
            it.recording.enrich = ::realistic
            it.recording.liveAnswer = { _, id -> if (id == 187L) liveOf(comptaLiveSample(NIGHT_NOW - 2_000)) else it.base.devices.liveMetrics(SampleData.PROD, id) }
        }

    private fun capture(name: String, services: TestServices = services(), content: @Composable () -> Unit) {
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(
                    LocalObliServices provides services,
                    LocalDevicesClock provides MutableClock().clock,
                    LocalDeviceRemote provides FakeRemote(),
                    LocalCommandRemote provides FakeCommandRemote(),
                    tools.obli.core.security.ui.LocalActionRunner provides testRunner(),
                ) { content() }
            }
        }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    // S20 --------------------------------------------------------------------

    @Test fun list() = capture("devices_list.png") { DeviceListScreen(onOpenDevice = { _, _ -> }) }

    @Test fun listByName() = capture("devices_list_by_name.png") {
        val svc = LocalObliServices.current
        val vm = androidx.lifecycle.viewmodel.compose.viewModel { DeviceListViewModel(svc, MutableClock().clock) }
        androidx.compose.runtime.LaunchedEffect(Unit) { vm.toggleProblemsFirst() }
        DeviceListScreen(onOpenDevice = { _, _ -> })
    }

    @Test fun listNoMatch() {
        val s = services().also { it.recording.pageAnswer = { q, _ -> it.base.devices.page(q.copy(search = "compta", status = "offline"), null) } }
        capture("devices_list_no_match.png", s) {
            val svc = LocalObliServices.current
        val vm = androidx.lifecycle.viewmodel.compose.viewModel { DeviceListViewModel(svc, MutableClock().clock) }
            androidx.compose.runtime.LaunchedEffect(Unit) {
                vm.toggleStatus(StatusChip.OFFLINE)
                vm.setSearch("compta")
            }
            DeviceListScreen(onOpenDevice = { _, _ -> })
        }
    }

    @Test fun listError() {
        val s = services().also { it.recording.pageAnswer = { _, _ -> ApiOutcome.Failure(502, FailureKind.SERVER) } }
        capture("devices_list_error.png", s) { DeviceListScreen(onOpenDevice = { _, _ -> }) }
    }

    @Test fun listLoading() {
        val s = services().also { it.recording.pageAnswer = { _, _ -> awaitCancellation() } }
        capture("devices_list_loading.png", s) { DeviceListScreen(onOpenDevice = { _, _ -> }) }
    }

    @Test fun listEmptyTenant() {
        val s = services().also { it.recording.pageAnswer = { q, _ -> ApiOutcome.Ok(tools.obli.obliance.api.DevicePage(emptyList(), 0, q.page, q.pageSize)) } }
        capture("devices_list_empty.png", s) { DeviceListScreen(onOpenDevice = { _, _ -> }) }
    }

    // Large text (§7.11: up to 200 %; §9: font 1.0 / 2.0 matrix) ----------------

    /** The system font size at 200 %. */
    @Composable
    private fun LargeText(content: @Composable () -> Unit) {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, 2f)) { content() }
    }

    @Test fun listFontScale2() = capture("devices_list_font2.png") { LargeText { DeviceListScreen(onOpenDevice = { _, _ -> }) } }

    @Test @Config(qualifiers = "en-rUS-w390dp-h844dp-xxhdpi")
    fun listFontScale2English() = capture("devices_list_font2_en.png") { LargeText { DeviceListScreen(onOpenDevice = { _, _ -> }) } }

    @Test fun detailFontScale2() = capture("devices_detail_compta03_font2.png") { LargeText { DeviceDetailScreen(SampleData.PROD, 187, onBack = {}) } }

    // S30 / S31 --------------------------------------------------------------

    @Test fun detailCriticalLive() = capture("devices_detail_compta03.png") { DeviceDetailScreen(SampleData.PROD, 187, onBack = {}) }

    @Test fun detailWarning() = capture("devices_detail_bob01.png") { DeviceDetailScreen(SampleData.PROD, 15, onBack = {}) }

    @Test fun detailOffline() = capture("devices_detail_srvad2_offline.png") { DeviceDetailScreen(SampleData.PROD, 211, onBack = {}) }

    @Test fun detailPrivacySingleServer() = capture("devices_detail_mac_single_server.png", services(serverCount = 1)) {
        DeviceDetailScreen(SampleData.PROD, 198, onBack = {})
    }

    @Test fun detailLegacyPendingEnrolment() = capture("devices_detail_kiosk_pending.png") { DeviceDetailScreen(SampleData.PROD, 240, onBack = {}) }

    @Test fun detailNotFound() = capture("devices_detail_not_found.png") { DeviceDetailScreen(SampleData.PROD, 4242, onBack = {}) }

    @Test fun detailError() {
        val s = services().also { it.recording.detailAnswer = { _, _ -> ApiOutcome.Failure(null, FailureKind.NETWORK) } }
        capture("devices_detail_error.png", s) { DeviceDetailScreen(SampleData.PROD, 187, onBack = {}) }
    }

    // Tablet: list | detail, as the app's list-detail scene lays them out from 600 dp.

    @Config(sdk = [35], qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun tabletListDetail() = capture("devices_tablet_list_detail.png") {
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.width(400.dp).fillMaxHeight()) { DeviceListScreen(onOpenDevice = { _, _ -> }) }
            Box(Modifier.weight(1f).fillMaxHeight()) { DeviceDetailScreen(SampleData.PROD, 187, onBack = {}) }
        }
    }
}
