package tools.obli.obliance.automations

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.network.ApiOutcome
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.core.security.ActionResult
import tools.obli.core.security.Tier
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

@OptIn(ExperimentalCoroutinesApi::class)
class AutomationsViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun test(block: suspend TestScope.() -> Unit) = runTest(dispatcher) { block() }

    private val runTexts = RunTexts(
        title = { "Exécuter « $it »" },
        target = { n, single -> single ?: "$n appareils" },
        consequence = { rt, n -> "Le script $rt s'exécutera sur $n appareils." },
        mixedTenants = "Un seul tenant",
        notActive = { "Passez sur $it" },
    )

    // S51 -----------------------------------------------------------------------

    @Test fun runOnThreeDevicesIsT2AfterTheTenantSwitchAndOpensTheBatch() = test {
        val services = SampleObliServices()
        val remote = FakeAutomationsRemote()
        val vm = RunScriptViewModel(services, remote, SampleData.PROD, CLEAN_TEMP, listOf(185, 186, 187, 15))
        advanceUntilIdle()
        val s = vm.state.value
        assertEquals("Nettoyer les fichiers temporaires", s.script?.name)
        assertEquals(listOf("7", ""), s.fields.map { it.text })
        // BOB01 (Linux) is skipped for a Windows script.
        assertEquals(listOf("BOB01"), s.checks.platformSkipped.map { it.hostname })
        vm.update(s.fields[1].copy(checked = true))

        val prompter = RecordingPrompter()
        val (batch, result) = vm.run(runnerOf(prompter), runTexts)
        assertEquals(BATCH, batch)
        assertTrue(result is ActionResult.Done)
        // The global view (Default) must switch to ACME first (§2.3), then T2 for 3 devices.
        assertEquals(listOf("ACME"), prompter.switches)
        val spec = prompter.confirmed.single()
        assertEquals(Tier.T2, spec.tier)
        assertEquals(3, spec.targetCount)
        assertEquals("Obliance Prod › ACME", spec.scope)
        val (ids, values, _) = remote.executed!!
        assertEquals(listOf(185L, 186L, 187L), ids)
        assertEquals(buildJsonObject { put("min_age_days", JsonPrimitive(7)); put("include_browsers", JsonPrimitive(true)) }, values)
        assertTrue(remote.servers.all { it == SampleData.PROD })
    }

    @Test fun oneDeviceIsT1AndARequiredFieldBlocks() = test {
        val services = SampleObliServices()
        val remote = FakeAutomationsRemote()
        val vm = RunScriptViewModel(services, remote, SampleData.PROD, CLEAN_TEMP, listOf(187))
        advanceUntilIdle()
        vm.update(vm.state.value.fields[0].copy(text = ""))
        val prompter = RecordingPrompter()
        assertEquals(null to null, vm.run(runnerOf(prompter), runTexts))
        assertTrue(vm.state.value.showErrors)
        assertNull(remote.executed)
        vm.update(vm.state.value.fields[0].copy(text = "14"))
        vm.run(runnerOf(prompter), runTexts)
        assertEquals(Tier.T1, prompter.confirmed.single().tier)
        assertEquals("PC-COMPTA-03", prompter.confirmed.single().target)
    }

    @Test fun pendingApprovalIsNeverASuccess() = test {
        val remote = FakeAutomationsRemote().apply { executeAnswer = { _, _, _ -> ApiOutcome.PendingApproval(21) } }
        val vm = RunScriptViewModel(SampleObliServices(), remote, SampleData.PROD, CLEAN_TEMP, listOf(185, 186))
        advanceUntilIdle()
        val (batch, result) = vm.run(runnerOf(), runTexts)
        assertNull(batch)
        assertEquals(ActionResult.AwaitingApproval(21), result)
        assertEquals(RunNotice.AwaitingApproval, vm.state.value.notice)
    }

    @Test fun noTargetDevicesFound() = test {
        val remote = FakeAutomationsRemote().apply { executeAnswer = { _, _, _ -> ApiOutcome.Validation("No target devices found", emptyMap()) } }
        val vm = RunScriptViewModel(SampleObliServices(), remote, SampleData.PROD, CLEAN_TEMP, listOf(185))
        advanceUntilIdle()
        assertEquals(null to null, vm.run(runnerOf(), runTexts))
        assertEquals(RunNotice.NoTargets, vm.state.value.notice)
    }

    @Test fun rerunPrefillsTheParametersOfTheBatch() = test {
        val vm = RunScriptViewModel(SampleObliServices(), FakeAutomationsRemote(), SampleData.PROD, CLEAN_TEMP, listOf(187), rerunOf = BATCH)
        advanceUntilIdle()
        assertEquals("7", vm.state.value.fields[0].text)
        assertTrue(vm.state.value.fields[1].checked)
    }

    // S52 -----------------------------------------------------------------------

    @Test fun batchFollowsTheSocketAndRefetchesTheOutputs() = test {
        val services = LiveServices()
        val remote = FakeAutomationsRemote().apply { batchRows = AutoSample.batchRows(finished = false) }
        val vm = BatchViewModel(services, remote, SampleData.PROD, BATCH, pollMs = 5_000, livePollMs = 60_000, refetchDebounceMs = 100)
        advanceUntilIdle()
        val s = vm.state.value
        assertEquals("Nettoyer les fichiers temporaires", s.scriptName)
        assertEquals(true, s.byMe)
        assertEquals(2, s.params.size)
        assertEquals(BatchCounts(success = 1, queued = 2), s.counts)

        val follow = launch { vm.follow() }
        runCurrent()
        assertTrue(vm.state.value.live)
        fun push(name: String, json: String) = services.realtime.flow.tryEmit(RealtimeEvent(name, Json.parseToJsonElement(json)))
        push("COMMAND_UPDATED", """{"id":"c3","deviceId":187,"type":"run_script","status":"ack_running","sourceType":"script_execution","sourceId":"9003"}""")
        runCurrent()
        assertEquals(ExecStep.RUNNING, vm.state.value.rows.first { it.executionId == "9003" }.step)

        remote.batchRows = AutoSample.batchRows(finished = true)
        push("EXECUTION_UPDATED", """{"id":"9003","batchId":"$BATCH","deviceId":187,"status":"failure","exitCode":1}""")
        runCurrent()
        assertEquals(ExecStep.FAILURE, vm.state.value.rows.first { it.executionId == "9003" }.step)
        advanceTimeBy(200)
        runCurrent()
        assertEquals(DENIED, vm.state.value.rows.first { it.executionId == "9003" }.stderr)
        assertTrue(vm.state.value.finished)
        follow.cancel()
    }

    @Test fun batchPollsEveryFiveSecondsWithoutSocket() = test {
        val services = LiveServices(realtime = PushRealtime(connected = false))
        val remote = FakeAutomationsRemote().apply { batchRows = AutoSample.batchRows(finished = false) }
        val vm = BatchViewModel(services, remote, SampleData.PROD, BATCH)
        advanceUntilIdle()
        val follow = launch { vm.follow() }
        runCurrent()
        assertFalse(vm.state.value.live)
        val before = remote.calls.count { it == "batch $BATCH" }
        advanceTimeBy(5_001)
        runCurrent()
        assertEquals(before + 1, remote.calls.count { it == "batch $BATCH" })
        remote.batchRows = AutoSample.batchRows(finished = true)
        advanceTimeBy(5_001)
        runCurrent()
        assertTrue(vm.state.value.finished)
        // Finished: no more polling.
        val after = remote.calls.count { it == "batch $BATCH" }
        advanceTimeBy(20_000)
        runCurrent()
        assertEquals(after, remote.calls.count { it == "batch $BATCH" })
        follow.cancel()
    }

    @Test fun stopIsT1AndCancelForQueued() = test {
        val remote = FakeAutomationsRemote().apply { batchRows = AutoSample.batchRows(finished = false) }
        val vm = BatchViewModel(SampleObliServices(), remote, SampleData.PROD, BATCH)
        advanceUntilIdle()
        val prompter = RecordingPrompter()
        val queued = vm.state.value.rows.first { it.executionId == "9003" }
        vm.stopOrCancel(queued, runnerOf(prompter), StopTexts("Arrêter", "Annuler", "c1", "c2"))
        assertEquals(Tier.T1, prompter.confirmed.single().tier)
        assertTrue("cancel 9003" in remote.calls)
    }

    // S55 -----------------------------------------------------------------------

    @Test fun activityKeepsOnlyMyRequestsAndSplitsTheBatches() = test {
        val remote = FakeAutomationsRemote().apply { batchesAnswer = ApiOutcome.Ok(BatchPage(AutoSample.batches(inFlight = true), 3)) }
        val vm = ActivityViewModel(SampleObliServices(), remote, clock = { RUN_NOW })
        advanceUntilIdle()
        val s = vm.state.value
        assertEquals(listOf(21L), s.approvals!!.map { it.id })
        assertEquals("Nettoyer les fichiers temporaires" to 3, s.scriptRunOf(s.approvals!!.single()))
        assertEquals(listOf(BATCH), s.inFlight.map { it.batchId })
        // "Mes exécutions": schedule batches are not mine.
        assertTrue(s.history.isEmpty())
        vm.setMineOnly(false)
        assertEquals(2, vm.state.value.history.size)
        assertEquals(listOf(CLEAN_TEMP to "Nettoyer les fichiers temporaires"), vm.state.value.recentScripts)
        assertEquals(6, vm.state.value.scriptCount)
        assertEquals(listOf("Vérif sauvegarde", "Nettoyage hebdo C:"), vm.state.value.activeSchedules.map { it.name })
    }

    @Test fun activityOfANonAdminDoesNotAskForApprovals() = test {
        val base = SampleObliServices()
        base.sessions.session(SampleData.PROD)!!.markSignedIn(SampleData.probe(SampleData.PROD).copy(user = SampleData.karimLocal))
        val remote = FakeAutomationsRemote()
        val vm = ActivityViewModel(base, remote, clock = { RUN_NOW })
        advanceUntilIdle()
        assertNull(vm.state.value.approvals)
        assertFalse("approvals" in remote.calls)
    }

    // S57 / S58 -------------------------------------------------------------------

    @Test fun pausingAScheduleIsT1() = test {
        val remote = FakeAutomationsRemote()
        val vm = SchedulesViewModel(SampleObliServices(), remote)
        advanceUntilIdle()
        assertEquals(5, vm.state.value.lastRuns[7L]?.successCount)
        val prompter = RecordingPrompter()
        vm.setEnabled(AutoSample.schedules[0], false, runnerOf(prompter), "Pause", null)
        assertEquals(Tier.T1, prompter.confirmed.single().tier)
        assertFalse(vm.state.value.schedules.first { it.id == 7L }.enabled)
        assertTrue("schedule 7 enabled=false" in remote.calls)
    }

    @Test fun scenarioStartIsT2AndCancelRunsT2() = test {
        val remote = FakeAutomationsRemote()
        val services = SampleObliServices()
        val vm = ScenariosViewModel(services, remote)
        advanceUntilIdle()
        val s = vm.state.value.scenarios.first()
        vm.openScenario(s.id)
        advanceUntilIdle()
        assertEquals(2, vm.state.value.runs?.size)
        vm.openRun(vm.state.value.runs!!.first())
        advanceUntilIdle()
        assertEquals(3, vm.state.value.openRun?.nodeRuns?.size)

        val texts = ScenarioTexts("Activer", "Désactiver", "c", "Déclencher", { n, one -> one ?: "$n appareils" }, "c", "Annuler", { "c$it" }, { "x" })
        val prompter = RecordingPrompter()
        val devices = SampleData.devices.filter { it.hostname.startsWith("PC-COMPTA") }
        vm.start(s, devices, runnerOf(prompter), texts)
        assertEquals(Tier.T2, prompter.confirmed.last().tier)
        assertEquals(devices.map { it.id }, remote.started)
        vm.cancelRuns(s, runnerOf(prompter), texts)
        assertEquals(Tier.T2, prompter.confirmed.last().tier)
        vm.setEnabled(s, false, runnerOf(prompter), texts)
        assertEquals(Tier.T1, prompter.confirmed.last().tier)
        assertTrue("scenario 3 enabled=false" in remote.calls)
    }
}
