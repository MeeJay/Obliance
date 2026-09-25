package tools.obli.obliance.automations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RobolectricTestRunner
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * Screens over the design doc §4 data (Karim, Obliance Prod active, three
 * servers), French, 10:42 on 25 September. Recorded under build/outputs/roborazzi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class AutomationsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun capture(name: String, remote: FakeAutomationsRemote = FakeAutomationsRemote(), services: ObliServices = SampleObliServices(), content: @Composable () -> Unit) {
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(
                    LocalObliServices provides services,
                    LocalAutomationsRemote provides remote,
                    LocalAutomationsClock provides TEST_CLOCK,
                    LocalActionRunner provides runnerOf(),
                ) { content() }
            }
        }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    private fun activityScreen() = @Composable { ActivityScreen({}, { _, _ -> }, {}, {}, {}, { _, _ -> }) }

    // S55 ---------------------------------------------------------------------

    @Test fun activity() = capture(
        "automations_activity.png",
        FakeAutomationsRemote().apply { batchesAnswer = ApiOutcome.Ok(BatchPage(AutoSample.batches(inFlight = true), 3)) },
        content = activityScreen(),
    )

    @Test fun activityHistory() = capture("automations_activity_history.png", content = activityScreen())

    @Test fun activityEmpty() = capture(
        "automations_activity_empty.png",
        FakeAutomationsRemote().apply {
            batchesAnswer = ApiOutcome.Ok(BatchPage())
            approvalsAnswer = ApiOutcome.Ok(emptyList())
            schedulesAnswer = ApiOutcome.Ok(emptyList())
            scenariosAnswer = ApiOutcome.Ok(ScenarioPage())
            scriptsAnswer = ApiOutcome.Ok(emptyList())
        },
        content = activityScreen(),
    )

    @Test fun activityError() = capture(
        "automations_activity_error.png",
        FakeAutomationsRemote().apply { batchesAnswer = ApiOutcome.Failure(null, FailureKind.NETWORK) },
        content = activityScreen(),
    )

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun activityTablet() = capture(
        "automations_activity_tablet.png",
        FakeAutomationsRemote().apply { batchesAnswer = ApiOutcome.Ok(BatchPage(AutoSample.batches(inFlight = true), 3)) },
        content = activityScreen(),
    )

    // S50 ---------------------------------------------------------------------

    @Test fun picker() = capture("automations_picker.png") {
        ScriptPickerScreen(SampleData.PROD, listOf(185, 186, 187), {}, {})
    }

    @Test fun pickerPreview() = capture("automations_picker_preview.png") {
        ScriptPickerContent(
            PickerUiState(
                SampleData.PROD, loading = false, scripts = AutoSample.scripts, categories = AutoSample.categories,
                targetPlatforms = setOf("windows"), platform = "windows", recent = listOf(CLEAN_TEMP),
                preview = AutoSample.scripts.first().copy(parameters = AutoSample.cleanParams),
            ),
            deviceCount = 3,
            actions = PickerActions(),
        )
    }

    @Test fun pickerNoMatch() = capture("automations_picker_no_match.png") {
        ScriptPickerContent(PickerUiState(SampleData.PROD, loading = false, scripts = AutoSample.scripts, query = "sauvegarde"), 0, PickerActions())
    }

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun pickerTablet() = capture("automations_picker_tablet.png") {
        ScriptPickerContent(
            PickerUiState(
                SampleData.PROD, loading = false, scripts = AutoSample.scripts, categories = AutoSample.categories,
                targetPlatforms = setOf("windows"), platform = "windows",
                preview = AutoSample.scripts.first().copy(parameters = AutoSample.cleanParams),
            ),
            deviceCount = 3,
            actions = PickerActions(),
        )
    }

    // S51 ---------------------------------------------------------------------

    @Test fun run() = capture("automations_run.png") {
        RunScriptScreen(SampleData.PROD, CLEAN_TEMP, listOf(185, 186, 187), {}, {})
    }

    @Test fun runWarnings() = capture("automations_run_warnings.png") {
        RunScriptScreen(SampleData.PROD, CLEAN_TEMP, listOf(187, 15, 211, 198), {}, {})
    }

    @Test fun runErrors() = capture("automations_run_errors.png") {
        RunScriptContent(
            RunScriptUiState(
                SampleData.PROD, loading = false, script = AutoSample.scripts.first().copy(parameters = AutoSample.cleanParams),
                fields = AutoSample.cleanParams.map { ParamField.initial(it) }.let { listOf(it[0].copy(text = ""), it[1]) },
                showErrors = true, sessionTenantId = SampleData.DEFAULT_TENANT,
            ),
            RunActions(),
        )
    }

    // S52 / S53 ---------------------------------------------------------------

    private fun liveState(): BatchUiState {
        var rows = BatchMerge.fromServer(emptyList(), AutoSample.batchRows(finished = false))
        rows = BatchMerge.command(rows, CommandEvent("c2", 186, "run_script", "ack_running", "script_execution", "9002"))
        rows = BatchMerge.command(rows, CommandEvent("c3", 187, "run_script", "sent", "script_execution", "9003"))
        return BatchUiState(
            SampleData.PROD, BATCH, loading = false, scriptId = CLEAN_TEMP, scriptName = "Nettoyer les fichiers temporaires",
            runtime = "powershell", triggeredAt = "2026-09-25T08:42:02Z", byMe = true, scope = "Obliance Prod › ACME",
            params = listOf(ParamLine("Âge minimum (jours)", text = "7"), ParamLine("Inclure le cache des navigateurs", flag = true)),
            rows = rows, live = true,
        )
    }

    private fun doneState(): BatchUiState = liveState().copy(rows = BatchMerge.fromServer(emptyList(), AutoSample.batchRows()), scriptContent = AutoSample.CLEAN_CODE)

    @Test fun batchLive() = capture("automations_batch_live.png") { BatchContent(liveState(), PARIS, BatchActions(onOpenTerminal = {})) }

    @Test fun batchDone() = capture("automations_batch_done.png") {
        BatchScreen(SampleData.PROD, BATCH, {}, { _, _, _, _ -> }, onOpenTerminal = { _, _ -> })
    }

    @Test fun batchFailuresFilter() = capture("automations_batch_failures.png") {
        BatchContent(doneState().copy(filter = BatchFilter.FAILED), PARIS, BatchActions(onOpenTerminal = {}))
    }

    @Test fun batchRunningEmpty() = capture("automations_batch_running_empty.png") {
        BatchContent(doneState().copy(filter = BatchFilter.RUNNING), PARIS, BatchActions())
    }

    @Test fun output() = capture("automations_output.png") {
        BatchContent(doneState().copy(selected = "9003"), PARIS, BatchActions(onOpenTerminal = {}))
    }

    @Test fun outputSuccess() = capture("automations_output_success.png") {
        BatchContent(doneState().copy(selected = "9001"), PARIS, BatchActions())
    }

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun batchTablet() = capture("automations_batch_tablet.png") {
        BatchContent(doneState().copy(selected = "9003"), PARIS, BatchActions(onOpenTerminal = {}))
    }

    // S57 / S58 -----------------------------------------------------------------

    @Test fun schedules() = capture("automations_schedules.png") { SchedulesScreen {} }

    @Test fun schedulesChildTenant() = capture("automations_schedules_readonly.png") {
        SchedulesContent(
            SchedulesUiState(
                SampleData.PROD, loading = false,
                schedules = AutoSample.schedules.map { it.copy(tenantId = SampleData.DEFAULT_TENANT) } + AutoSample.schedules[0].copy(id = 9, name = "Inventaire hebdomadaire", enabled = false, cronExpression = "30 8 * * 1-5", resolvedDeviceCount = 248),
                sessionTenantId = SampleData.ACME_TENANT,
            ),
            PARIS, {}, { _, _ -> }, {}, {},
        )
    }

    @Test fun scenarios() = capture("automations_scenarios.png") { ScenariosScreen {} }

    @Test fun scenarioDetail() = capture("automations_scenario_detail.png") {
        ScenariosContent(
            ScenariosUiState(SampleData.PROD, loading = false, scenarios = AutoSample.scenarios, total = 2, sessionTenantId = SampleData.DEFAULT_TENANT, openScenario = 3, runs = AutoSample.runs),
            PARIS, ScenarioActions(),
        )
    }

    @Test fun scenarioRun() = capture("automations_scenario_run.png") {
        ScenariosContent(
            ScenariosUiState(SampleData.PROD, loading = false, scenarios = AutoSample.scenarios, total = 2, sessionTenantId = SampleData.DEFAULT_TENANT, openScenario = 3, runs = AutoSample.runs, openRun = AutoSample.runDetail),
            PARIS, ScenarioActions(),
        )
    }

    @Test fun scenariosEmpty() = capture("automations_scenarios_empty.png", FakeAutomationsRemote().apply { scenariosAnswer = ApiOutcome.Ok(ScenarioPage()) }) { ScenariosScreen {} }
}
