package tools.obli.obliance.devices

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.model.ServerId
import tools.obli.obliance.api.CpuMetrics
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.LiveSample
import tools.obli.obliance.data.sample.SampleData

@OptIn(ExperimentalCoroutinesApi::class)
class DeviceDetailViewModelTest {
    private val main = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(main)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.start(
        services: TestServices = TestServices().also { it.recording.enrich = ::realistic },
        remote: FakeRemote = FakeRemote(),
        serverId: ServerId = SampleData.PROD,
        deviceId: Long = 187,
        clock: MutableClock = MutableClock(),
    ): DeviceDetailViewModel {
        val vm = DeviceDetailViewModel(services, remote, clock.clock, serverId, deviceId)
        backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        return vm
    }

    @Test fun loadsTheDeviceWithItsGroupPathOnItsOwnServer() = runTest(main) {
        val services = TestServices().also { it.recording.enrich = ::realistic }
        val remote = FakeRemote(thresholds = mapOf(GROUP_COMPTA to Thresholds.SYSTEM.copy(cpu = Threshold(70.0, 90.0))))
        val vm = start(services, remote)
        val s = vm.state.value
        assertEquals("PC-COMPTA-03", s.device?.label)
        assertEquals(listOf("Siège", "Comptabilité"), s.groupPath)
        assertEquals(Threshold(70.0, 90.0), s.thresholds.cpu)
        assertEquals(MetricsFeed.SNAPSHOT, s.feed)
        assertEquals(listOf(SampleData.PROD to 187L), services.recording.details)
        assertTrue(remote.calls.all { it.second == SampleData.PROD })
        // lastSeenAt 01:10Z comes from the device.
        assertEquals(DeviceFormat.parse("2026-09-25T01:10:00Z"), s.lastSeenAt)
    }

    @Test fun liveSamplesReplaceTheSnapshotAndAdvanceLastSeen() = runTest(main) {
        val services = TestServices().also { it.recording.enrich = ::realistic }
        val live = MutableSharedFlow<LiveSample>()
        services.recording.liveAnswer = { _, _ -> live }
        val vm = start(services)
        backgroundScope.launch { vm.followLive() }
        runCurrent()
        live.emit(comptaLiveSample(NIGHT_NOW))
        runCurrent()
        val s = vm.state.value
        assertEquals(MetricsFeed.LIVE, s.feed)
        assertEquals(97.0, s.metrics?.cpu?.percent)
        assertEquals(NIGHT_NOW, s.lastSeenAt)
        assertEquals(NIGHT_NOW, s.metricsAt())
        // REST fallback (no push for 15 s): "Actualisation toutes les 15 s", last contact untouched.
        live.emit(LiveSample(DeviceMetrics(cpu = CpuMetrics(percent = 96.0)), live = false, receivedAt = NIGHT_NOW + 30_000))
        runCurrent()
        assertEquals(MetricsFeed.POLLING, vm.state.value.feed)
        assertEquals(NIGHT_NOW, vm.state.value.lastSeenAt)
        assertEquals(listOf(SampleData.PROD to 187L), services.recording.liveRequests)
    }

    @Test fun leavingTheScreenStopsTheLiveSubscription() = runTest(main) {
        val services = TestServices()
        var active = false
        var stopped = false
        services.recording.liveAnswer = { _, _ ->
            MutableSharedFlow<LiveSample>().onStart { active = true }.onCompletion { stopped = true }
        }
        val vm = start(services)
        val job = launch { vm.followLive() }
        runCurrent()
        assertTrue(active)
        job.cancel()
        runCurrent()
        assertTrue("the live metrics flow (and its arming loop) must stop", stopped)
    }

    @Test fun pullToRefreshAsksOnePushOnTheDeviceServer() = runTest(main) {
        val services = TestServices()
        val remote = FakeRemote()
        val live = MutableSharedFlow<LiveSample>()
        services.recording.liveAnswer = { _, _ -> live }
        val vm = start(services, remote)
        backgroundScope.launch { vm.followLive() }
        runCurrent()
        vm.refresh()
        advanceUntilIdle()
        assertEquals("push_now" to SampleData.PROD, remote.calls.last())
        assertTrue(vm.state.value.pushRequested)
        assertEquals(2, services.recording.details.size)
        live.emit(comptaLiveSample(NIGHT_NOW))
        runCurrent()
        assertFalse(vm.state.value.pushRequested)
    }

    @Test fun offlineAgentAckDoesNotPretendMetricsAreComing() = runTest(main) {
        val remote = FakeRemote(pushAnswer = tools.obli.core.network.ApiOutcome.Ok(tools.obli.obliance.api.LiveMetricsAck(sent = false)))
        val vm = start(remote = remote, deviceId = 211)
        vm.refresh()
        advanceUntilIdle()
        assertFalse(vm.state.value.pushRequested)
    }

    @Test fun unknownDeviceIsNotFound() = runTest(main) {
        val vm = start(deviceId = 4242)
        val s = vm.state.value
        assertNull(s.device)
        assertEquals(ProblemKind.NOT_FOUND, s.problem?.kind)
        assertFalse(s.loading)
    }

    @Test fun signalsPatchStatusOnlyForThisDeviceOnTheActiveServer() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        backgroundScope.launch { vm.followLive() }
        runCurrent()
        services.recording.signalFlow.emit(DeviceSignal(ObliEvents.DEVICE_UPDATED, 185, DeviceStatus.OFFLINE))
        services.recording.signalFlow.emit(DeviceSignal(ObliEvents.DEVICE_UPDATED, 187, DeviceStatus.ONLINE))
        runCurrent()
        assertEquals(DeviceStatus.ONLINE, vm.state.value.device?.statusKind)
        // Once another server is active, its socket says nothing about this device.
        services.base.sessions.activate(SampleData.DEV)
        runCurrent()
        services.recording.signalFlow.emit(DeviceSignal(ObliEvents.DEVICE_UPDATED, 187, DeviceStatus.CRITICAL))
        runCurrent()
        assertEquals(DeviceStatus.ONLINE, vm.state.value.device?.statusKind)
    }

    @Test fun deletedDeviceBecomesNotFound() = runTest(main) {
        val vm = start()
        vm.onSignal(DeviceSignal(ObliEvents.DEVICE_DELETED, 187, null))
        assertEquals(ProblemKind.NOT_FOUND, vm.state.value.problem?.kind)
    }

    @Test fun failedLoadCanBeRetried() = runTest(main) {
        val services = TestServices()
        services.recording.detailAnswer = { _, _ -> NETWORK_DOWN }
        val vm = start(services)
        assertEquals(ProblemKind.NETWORK, vm.state.value.problem?.kind)
        services.recording.detailAnswer = null
        vm.retry()
        advanceUntilIdle()
        assertNull(vm.state.value.problem)
        assertEquals("PC-COMPTA-03", vm.state.value.device?.label)
    }

    @Test fun slowLoadShowsLoading() = runTest(main) {
        val services = TestServices()
        services.recording.detailAnswer = { _, _ -> awaitCancellation() }
        val vm = start(services)
        assertTrue(vm.state.value.loading)
    }
}
