package tools.obli.obliance.devices

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.security.ui.ActionMessages
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** S30 action bar, S40 sheet, S32/S33/S36 tabs and the list multi-selection, French, §4 data at 03:22. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class ActionsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun services(): TestServices = TestServices(SampleObliServices()).also {
        it.recording.enrich = ::realistic
        it.recording.liveAnswer = { _, id -> if (id == 187L) liveOf(comptaLiveSample(NIGHT_NOW - 2_000)) else it.base.devices.liveMetrics(SampleData.PROD, id) }
    }

    private fun capture(name: String, remote: FakeCommandRemote = FakeCommandRemote(), before: () -> Unit = {}, content: @Composable () -> Unit) {
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(
                    LocalObliServices provides services(),
                    LocalDevicesClock provides MutableClock().clock,
                    LocalDeviceRemote provides FakeRemote(),
                    LocalCommandRemote provides remote,
                    LocalActionRunner provides testRunner(),
                ) { content() }
            }
        }
        compose.waitForIdle()
        before()
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    private fun device(id: Long): Device = realistic(SampleData.devices.first { it.id == id })

    /** The sheet content as the modal shows it (Robolectric does not capture dialog windows). */
    @Composable
    private fun Sheet(device: Device, admin: Boolean = true, refused: Set<String> = emptySet(), last: LastAction? = null, tenant: String? = "ACME") {
        val res = LocalContext.current.resources
        val c = ObliTheme.colors
        Box(Modifier.fillMaxSize().background(c.bg)) {
            Column(Modifier.fillMaxSize().background(c.chrome).verticalScroll(rememberScrollState())) {
                ActSheetContent(
                    device = device,
                    items = DeviceActions.items(device, ActContext(admin, refused)),
                    reasonOf = { b ->
                        when (b) {
                            null -> null
                            is Blocker.Unreachable -> res.getString(if (b.status == DeviceStatus.OFFLINE) R.string.devices_block_offline else R.string.devices_block_pending)
                            Blocker.Legacy -> res.getString(R.string.devices_block_legacy)
                            is Blocker.Refused -> res.getString(R.string.devices_block_refused, ActionMessages.capabilityLabel(res, b.capability))
                        }
                    },
                    last = last,
                    tenantName = tenant,
                    zone = PARIS,
                    onSwitchTenant = {},
                    onItem = {},
                    onClose = {},
                )
            }
        }
    }

    // S40 --------------------------------------------------------------------

    @Test fun sheetGlobalView() = capture("devices_act_sheet_compta03.png") {
        Sheet(device(187), last = LastAction("Redémarrer le service Spooler", NIGHT_NOW - 5 * 60_000))
    }

    @Test fun sheetOffline() = capture("devices_act_sheet_srvad2_offline.png") { Sheet(device(211)) }

    @Test fun sheetLegacy() = capture("devices_act_sheet_legacy.png") { Sheet(device(205), tenant = null) }

    @Test fun sheetMemberRefusedPower() = capture("devices_act_sheet_member_refused.png") {
        Sheet(device(15), admin = false, refused = setOf("power"), tenant = null)
    }

    @Test fun sheetPrivacy() = capture("devices_act_sheet_mac_privacy.png") { Sheet(device(198), tenant = null) }

    @Test fun sheetFontScale2() = capture("devices_act_sheet_font2.png") {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, 2f)) { Sheet(device(187)) }
    }

    // S30 bar and tabs ---------------------------------------------------------

    @Test fun detailLinuxBar() = capture("devices_detail_bar_linux.png") { DeviceDetailScreen(SampleData.PROD, 140, onBack = {}) }

    @Test fun servicesTab() = capture("devices_tab_services.png", before = { compose.onAllNodesWithText("Services").onFirst().performClick() }) {
        DeviceDetailScreen(SampleData.PROD, 187, onBack = {})
    }

    @Test fun servicesTabAll() = capture(
        "devices_tab_services_all.png",
        before = {
            compose.onAllNodesWithText("Services").onFirst().performClick()
            compose.waitForIdle()
            compose.onNodeWithText("Tous").performClick()
        },
    ) { DeviceDetailScreen(SampleData.PROD, 187, onBack = {}) }

    @Test fun servicesTabEmpty() = capture("devices_tab_services_empty.png", FakeCommandRemote(services = emptyList()), before = { compose.onAllNodesWithText("Services").onFirst().performClick() }) {
        DeviceDetailScreen(SampleData.PROD, 140, onBack = {})
    }

    @Test fun servicesTabOffline() = capture("devices_tab_services_offline.png", before = { compose.onAllNodesWithText("Services").onFirst().performClick() }) {
        DeviceDetailScreen(SampleData.PROD, 211, onBack = {})
    }

    @Test fun tasksTab() = capture("devices_tab_tasks.png", before = { compose.onAllNodesWithText("Tâches").onFirst().performClick() }) {
        DeviceDetailScreen(SampleData.PROD, 187, onBack = {})
    }

    @Test fun tasksTabEmpty() = capture("devices_tab_tasks_empty.png", FakeCommandRemote(tasks = emptyList()), before = { compose.onAllNodesWithText("Tâches").onFirst().performClick() }) {
        DeviceDetailScreen(SampleData.PROD, 187, onBack = {})
    }

    @Test fun processesTab() = capture("devices_tab_processes.png") {
        val c = ObliTheme.colors
        Box(Modifier.fillMaxSize().background(c.bg)) {
            ProcessesTab(device(187), ProcessesUi(SAMPLE_PROCESSES, receivedAt = NIGHT_NOW, killing = setOf(9004L)), onFreeze = {}, onUnlock = {}, onOpen = {})
        }
    }

    @Test fun processesTabPrivacy() = capture("devices_tab_processes_privacy.png") {
        val c = ObliTheme.colors
        Box(Modifier.fillMaxSize().background(c.bg)) { ProcessesTab(device(198), ProcessesUi(), onFreeze = {}, onUnlock = {}, onOpen = {}) }
    }

    @Test fun processSheet() = capture("devices_process_sheet_lsass.png") {
        val c = ObliTheme.colors
        Box(Modifier.fillMaxSize().background(c.chrome)) {
            ProcessSheetContent(SAMPLE_PROCESSES.first { it.pid == 688L }, device(187), canKill = true, blocked = null, onKill = {}, onClose = {})
        }
    }

    @Test fun taskSheet() = capture("devices_task_sheet_failure.png") {
        val c = ObliTheme.colors
        Box(Modifier.fillMaxSize().background(c.chrome)) { TaskSheetContent(SAMPLE_TASKS.last(), onClose = {}) }
    }

    // S20 multi-selection ------------------------------------------------------

    @Test fun listSelection() = capture(
        "devices_list_selection.png",
        before = {
            compose.onNodeWithText("PC-COMPTA-03").performTouchInput { longClick() }
            compose.waitForIdle()
            compose.onNodeWithText("SRV-AD2").performClick()
        },
    ) { DeviceListScreen(onOpenDevice = { _, _ -> }) }

    @Test fun listSelectionMixedTenants() = capture(
        "devices_list_selection_mixed.png",
        before = {
            compose.onNodeWithText("PC-COMPTA-03").performTouchInput { longClick() }
            compose.waitForIdle()
            compose.onNodeWithText("BOB01").performClick()
        },
    ) { DeviceListScreen(onOpenDevice = { _, _ -> }) }

    @Config(sdk = [35], qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun tabletServices() = capture("devices_tablet_services.png", before = { compose.onAllNodesWithText("Services").onFirst().performClick() }) {
        DeviceDetailScreen(SampleData.PROD, 187, onBack = {})
    }
}
