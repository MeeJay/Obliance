package tools.obli.obliance.devices

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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.auth.AuthState
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ForbiddenReason
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

@OptIn(ExperimentalCoroutinesApi::class)
class DeviceActionsViewModelTest {
    private val main = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(main)

    @After fun tearDown() = Dispatchers.resetMain()

    private val compta: Device = SampleData.devices.first { it.id == 187L }
    private val srvAd2: Device = SampleData.devices.first { it.id == 211L }

    private class Env(
        val services: SampleObliServices,
        val remote: FakeCommandRemote,
        val prompter: RecordingPrompter,
        val realtime: FakeRealtime,
        val vm: DeviceActionsViewModel,
    )

    private fun TestScope.env(deviceId: Long = 187, realtime: FakeRealtime = FakeRealtime()): Env {
        val services = SampleObliServices()
        val remote = FakeCommandRemote()
        val prompter = RecordingPrompter()
        val vm = DeviceActionsViewModel(services, remote, testRunner(prompter), MutableClock().clock, SampleData.PROD, deviceId, realtimeOf = { realtime })
        backgroundScope.launch { vm.state.collect {} }
        return Env(services, remote, prompter, realtime, vm)
    }

    private fun spec(key: String, tier: Tier) = ActionSpec(key, tier, "Redémarrer", "PC-COMPTA-03", "Obliance Prod › ACME")

    @Test fun rebootFromTheGlobalViewSwitchesTenantThenSendsTheCommandOnTheDevicesServer() = runTest(main) {
        val e = env()
        var result: ActionResult<CommandDto>? = null
        e.vm.command(spec("device.reboot", Tier.T2), compta, "reboot", blocked = null) { result = it }
        advanceUntilIdle()
        assertTrue(result is ActionResult.Done)
        // Session on Default (1), PC-COMPTA-03 in ACME (4): switch asked, then done on Obliance Prod.
        assertEquals(listOf("ACME"), e.prompter.switches)
        val probe = (e.services.sessions.session(SampleData.PROD)!!.auth.value as AuthState.SignedIn).probe
        assertEquals(SampleData.ACME_TENANT, probe.currentTenantId)
        assertEquals(listOf(RemoteCall(SampleData.PROD, "enqueue", 187, "reboot", JsonObject(emptyMap()), "normal")), e.remote.calls)
        assertEquals(Tier.T2, e.prompter.confirmed.single().tier)
        val s = e.vm.state.value
        assertEquals("Redémarrer", s.last?.title)
        assertEquals(CommandState.PENDING, s.lastCommand?.state)
        assertTrue(s.hasActiveCommands)
        // No second switch once the session is on ACME.
        assertNull(e.vm.tenantTarget(compta))
    }

    @Test fun commandUpdatedFollowsTheCommandToItsEnd() = runTest(main) {
        val e = env()
        backgroundScope.launch { e.vm.followRealtime() }
        runCurrent()
        e.vm.command(spec("device.restart_agent", Tier.T1), compta, "restart_agent", null) {}
        advanceUntilIdle()
        val id = e.vm.state.value.last!!.commandIds.single()
        e.realtime.eventFlow.emit(tools.obli.core.realtime.RealtimeEvent(ObliEvents.COMMAND_UPDATED, commandJson(id, 187, "restart_agent", "ack_running")))
        runCurrent()
        assertEquals(CommandState.RUNNING, e.vm.state.value.lastCommand?.state)
        // Another device's command is ignored.
        e.realtime.eventFlow.emit(tools.obli.core.realtime.RealtimeEvent(ObliEvents.COMMAND_UPDATED, commandJson(id, 185, "restart_agent", "failure")))
        runCurrent()
        assertEquals(CommandState.RUNNING, e.vm.state.value.lastCommand?.state)
        e.realtime.eventFlow.emit(tools.obli.core.realtime.RealtimeEvent(ObliEvents.COMMAND_RESULT, commandJson(id, 187, "restart_agent", "success")))
        runCurrent()
        assertEquals(CommandState.SUCCESS, e.vm.state.value.lastCommand?.state)
        assertFalse(e.vm.state.value.hasActiveCommands)
    }

    @Test fun withoutSocketTheCommandIsFollowedByRestEveryFiveSeconds() = runTest(main) {
        val rt = FakeRealtime(ConnectionState.RECONNECTING)
        val e = env(realtime = rt)
        backgroundScope.launch { e.vm.followRealtime() }
        runCurrent()
        e.vm.command(spec("device.restart_agent", Tier.T1), compta, "restart_agent", null) {}
        runCurrent()
        val id = e.vm.state.value.last!!.commandIds.single()
        e.remote.tasks = listOf(CommandDto(id = id, deviceId = 187, type = "restart_agent", status = "success"))
        advanceTimeBy(DeviceActionsViewModel.POLL_MS + 1)
        runCurrent()
        assertEquals(1, e.remote.calls.count { it.what == "commands" })
        assertEquals(CommandState.SUCCESS, e.vm.state.value.lastCommand?.state)
        // Nothing active any more: no further polling.
        advanceTimeBy(60_000)
        assertEquals(1, e.remote.calls.count { it.what == "commands" })
    }

    @Test fun blockedActionSendsNothing() = runTest(main) {
        val e = env(deviceId = 211)
        var result: ActionResult<CommandDto>? = null
        e.vm.command(spec("device.reboot", Tier.T2), srvAd2, "reboot", blocked = "L'appareil est hors ligne.") { result = it }
        advanceUntilIdle()
        assertEquals(ActionResult.Blocked("L'appareil est hors ligne."), result)
        assertTrue(e.remote.calls.isEmpty())
        assertTrue(e.prompter.confirmed.isEmpty())
    }

    @Test fun capabilityRefusalIsLearnedAndDisablesThePowerItems() = runTest(main) {
        val e = env()
        e.remote.enqueueAnswer = { ApiOutcome.Forbidden(ForbiddenReason.CAPABILITY, "Capability 'power' not permitted for your team", "power") }
        e.vm.command(spec("device.reboot", Tier.T2), compta, "reboot", null) {}
        advanceUntilIdle()
        assertEquals(setOf("power"), e.vm.state.value.refused)
        val items = DeviceActions.items(compta, ActContext(admin = false, refused = e.vm.state.value.refused))
        assertEquals(Blocker.Refused("power"), items.first { it.kind == ActKind.REBOOT }.blocker)
        assertNull(items.first { it.kind == ActKind.SCAN_ALL }.blocker)
    }

    @Test fun scanAllSendsTheThreeScansLikeTheWeb() = runTest(main) {
        val e = env()
        var result: ActionResult<List<CommandDto>>? = null
        e.vm.scanAll(spec("device.scan_all", Tier.T0), compta, null) { result = it }
        advanceUntilIdle()
        assertEquals(3, (result as ActionResult.Done).value.size)
        assertEquals(listOf("scan_inventory", "scan_updates", "check_compliance"), e.remote.calls.map { it.type })
        assertTrue(e.prompter.confirmed.isEmpty()) // T0
    }

    @Test fun airgapUsesTheDeviceRoute() = runTest(main) {
        val e = env()
        e.vm.airgap(spec("device.airgap.enable", Tier.T2), compta, enable = true, blocked = null) {}
        advanceUntilIdle()
        assertEquals("airgap.enable", e.remote.calls.single().what)
    }

    @Test fun servicesLoadListAndServiceActions() = runTest(main) {
        val e = env()
        backgroundScope.launch { e.vm.followRealtime() }
        runCurrent()
        e.vm.loadServices()
        advanceUntilIdle()
        assertEquals(SAMPLE_SERVICES, e.vm.state.value.services.items)

        e.vm.listServices(spec("device.list_services", Tier.T0), compta, null) {}
        runCurrent()
        assertTrue(e.vm.state.value.services.listing)
        val pushed = buildJsonObject {
            put("deviceId", JsonPrimitive(187))
            put("services", buildJsonArray { add(buildJsonObject { put("name", JsonPrimitive("Spooler")); put("status", JsonPrimitive("stopped")); put("startType", JsonPrimitive("auto")) }) })
        }
        e.realtime.eventFlow.emit(tools.obli.core.realtime.RealtimeEvent(ObliEvents.DEVICE_SERVICES_UPDATED, pushed))
        runCurrent()
        assertFalse(e.vm.state.value.services.listing)
        assertEquals(listOf("Spooler"), e.vm.state.value.services.items.map { it.name })

        val spooler = e.vm.state.value.services.items.single()
        e.vm.serviceAction(spec("device.start_service", Tier.T1), compta, spooler, "start_service", null) {}
        runCurrent()
        val call = e.remote.calls.last()
        assertEquals("start_service", call.type)
        assertEquals("Spooler", call.payload!!["name"]!!.jsonPrimitive.content)
        assertEquals("start_service", e.vm.state.value.services.pending["Spooler"])
        val id = e.vm.state.value.last!!.commandIds.single()
        e.realtime.eventFlow.emit(tools.obli.core.realtime.RealtimeEvent(ObliEvents.COMMAND_UPDATED, commandJson(id, 187, "start_service", "success", name = "Spooler")))
        runCurrent()
        assertNull(e.vm.state.value.services.pending["Spooler"])
        assertEquals("running", e.vm.state.value.services.items.single().status)
    }

    @Test fun listServicesTimesOutAfterNinetySeconds() = runTest(main) {
        val e = env()
        e.vm.listServices(spec("device.list_services", Tier.T0), compta, null) {}
        runCurrent()
        assertTrue(e.vm.state.value.services.listing)
        advanceTimeBy(DeviceActionsViewModel.LIST_TIMEOUT_MS + 1)
        assertFalse(e.vm.state.value.services.listing)
        assertTrue(e.vm.state.value.services.listTimedOut)
    }

    @Test fun processesSubscribeWhileWatchedAndUnsubscribeAfter() = runTest(main) {
        val e = env()
        backgroundScope.launch { e.vm.followRealtime() }
        runCurrent()
        val watch = launch { e.vm.watchProcesses() }
        runCurrent()
        assertEquals(ObliEvents.PROCESS_SUBSCRIBE, e.realtime.emitted.single().first)
        assertEquals(187L, e.realtime.emitted.single().second!!.jsonObject["deviceId"]!!.jsonPrimitive.long)
        // Resubscribe after a reconnection.
        e.realtime.stateFlow.value = ConnectionState.RECONNECTING
        runCurrent()
        e.realtime.stateFlow.value = ConnectionState.CONNECTED
        runCurrent()
        assertEquals(2, e.realtime.emitted.count { it.first == ObliEvents.PROCESS_SUBSCRIBE })

        e.realtime.eventFlow.emit(tools.obli.core.realtime.RealtimeEvent(ObliEvents.DEVICE_PROCESSES_UPDATED, processesJson(187)))
        e.realtime.eventFlow.emit(tools.obli.core.realtime.RealtimeEvent(ObliEvents.DEVICE_PROCESSES_UPDATED, processesJson(185, name = "other.exe")))
        runCurrent()
        assertEquals(listOf("EBP.Compta.exe", "lsass.exe"), e.vm.state.value.processes.items.map { it.name })

        watch.cancel()
        runCurrent()
        assertEquals(ObliEvents.PROCESS_UNSUBSCRIBE, e.realtime.emitted.last().first)
    }

    @Test fun killSendsPidAndNameWithHighPriority() = runTest(main) {
        val e = env()
        val lsass = SAMPLE_PROCESSES.first { it.name == "lsass.exe" }
        assertEquals(Tier.T2, DeviceActions.killTier(lsass))
        assertEquals(Tier.T1, DeviceActions.killTier(SAMPLE_PROCESSES.first()))
        e.vm.kill(spec("device.kill_process", DeviceActions.killTier(lsass)), compta, lsass, null) {}
        advanceUntilIdle()
        val call = e.remote.calls.single()
        assertEquals("kill_process", call.type)
        assertEquals("high", call.priority)
        assertEquals(688L, call.payload!!["pid"]!!.jsonPrimitive.long)
        assertEquals("lsass.exe", call.payload!!["name"]!!.jsonPrimitive.content)
        assertTrue(688L in e.vm.state.value.processes.killing)
    }

    @Test fun tasksLoadMergeAndCancel() = runTest(main) {
        val e = env()
        backgroundScope.launch { e.vm.followRealtime() }
        runCurrent()
        e.vm.loadTasks()
        advanceUntilIdle()
        assertEquals(3, e.vm.state.value.tasks.items.size)
        e.realtime.eventFlow.emit(tools.obli.core.realtime.RealtimeEvent(ObliEvents.COMMAND_UPDATED, commandJson("c-9", 187, "reboot", "pending")))
        runCurrent()
        assertEquals("c-9", e.vm.state.value.tasks.items.first().id)

        val pending = e.vm.state.value.tasks.items.first { it.id == "c-3" }
        e.vm.cancelTask(spec("device.cancel_command", Tier.T1), compta, pending) {}
        advanceUntilIdle()
        assertEquals("cancel:c-3", e.remote.calls.last().what)
        assertEquals(CommandState.CANCELLED, e.vm.state.value.tasks.items.first { it.id == "c-3" }.state)
    }

    @Test fun unlockOpensThePrivacySheetThenSucceeds() = runTest(main) {
        val e = env(deviceId = 198)
        val mac = SampleData.devices.first { it.id == 198L }
        var result: ActionResult<Unit>? = null
        e.vm.unlockPrivacy(spec("device.privacy.unlock", Tier.T0), mac, "processes") { result = it }
        advanceUntilIdle()
        assertEquals(listOf<String?>("processes"), e.prompter.unlocks)
        assertTrue(result is ActionResult.Done)
        assertTrue(e.remote.calls.isEmpty())
    }

    private fun commandJson(id: String, deviceId: Long, type: String, status: String, name: String? = null) = buildJsonObject {
        put("id", JsonPrimitive(id))
        put("deviceId", JsonPrimitive(deviceId))
        put("tenantId", JsonPrimitive(4))
        put("type", JsonPrimitive(type))
        put("status", JsonPrimitive(status))
        put("payload", buildJsonObject { if (name != null) put("name", JsonPrimitive(name)) })
        put("result", buildJsonObject {})
    }

    private fun processesJson(deviceId: Long, name: String = "EBP.Compta.exe") = buildJsonObject {
        put("deviceId", JsonPrimitive(deviceId))
        put(
            "processes",
            buildJsonArray {
                add(buildJsonObject { put("pid", JsonPrimitive(7312)); put("name", JsonPrimitive(name)); put("cpuPercent", JsonPrimitive(71.4)); put("memBytes", JsonPrimitive(1_420_000_000L)); put("user", JsonPrimitive("SIEGE\\m.durand")) })
                add(buildJsonObject { put("pid", JsonPrimitive(688)); put("name", JsonPrimitive("lsass.exe")); put("cpuPercent", JsonPrimitive(0.4)); put("memBytes", JsonPrimitive(42_000_000L)); put("user", JsonPrimitive("SYSTEM")) })
            },
        )
    }
}
