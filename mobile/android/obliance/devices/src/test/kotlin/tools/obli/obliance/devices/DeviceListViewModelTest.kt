package tools.obli.obliance.devices

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
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
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.CpuMetrics
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.DeviceSort
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.sample.SampleData

@OptIn(ExperimentalCoroutinesApi::class)
class DeviceListViewModelTest {
    private val main = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(main)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.start(services: TestServices = TestServices(), clock: MutableClock = MutableClock()): DeviceListViewModel {
        val vm = DeviceListViewModel(services, clock.clock)
        backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        return vm
    }

    @Test fun loadsTheActiveServerProblemsFirst() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        val s = vm.state.value
        assertEquals(SampleData.PROD, s.serverId)
        assertTrue(s.loaded)
        assertTrue(s.admin)
        assertTrue(s.globalView)
        val (query, server) = services.recording.pages.single()
        assertEquals(SampleData.PROD, server)
        assertEquals(DeviceSort.STATUS, query.sortBy)
        assertEquals(100, query.pageSize)
        assertEquals(listOf(SampleData.PROD), services.recording.summaries)
        assertEquals(DeviceSection.CRITICAL, s.sections.first().section)
        assertEquals(16, s.chipCount(StatusChip.OFFLINE))
        assertEquals(NIGHT_NOW, s.updatedAt)
    }

    @Test fun tenantSwitchReloadsWithoutKeepingTheOtherTenantRows() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        var sawEmpty = false
        backgroundScope.launch { vm.state.collect { if (it.tenantId == SampleData.ACME_TENANT && it.devices.isEmpty()) sawEmpty = true } }
        services.base.tenants.switchTo(SampleData.ACME_TENANT)
        advanceUntilIdle()
        assertEquals(2, services.recording.pages.size)
        assertTrue("rows of the previous tenant must not stay on screen", sawEmpty)
        assertEquals(SampleData.ACME_TENANT, vm.state.value.tenantId)
        assertFalse(vm.state.value.globalView)
    }

    @Test fun serverSwitchQueriesTheNewServerOnlyAndDropsTheOldRows() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        services.base.sessions.activate(SampleData.QUAL)
        advanceUntilIdle()
        val s = vm.state.value
        assertEquals(SampleData.QUAL, s.serverId)
        assertEquals(listOf("SRV-QUAL01"), s.devices.map { it.label })
        assertEquals(SampleData.QUAL, services.recording.pages.last().second)
        // Obliance Qual: local account, not a platform admin -> approved devices, 2000 at once, no summary.
        assertFalse(s.admin)
        assertEquals("approved", services.recording.pages.last().first.approvalStatus)
        assertEquals(10_000, services.recording.pages.last().first.pageSize)
        assertEquals(listOf(SampleData.PROD), services.recording.summaries)
        assertEquals(listOf(StatusChip.OFFLINE, StatusChip.CRITICAL, StatusChip.WARNING), s.statusChips)
        assertEquals(1, s.chipCount(StatusChip.OFFLINE))
    }

    @Test fun lateAnswerOfThePreviousServerIsDropped() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        services.recording.pageAnswer = { q, id ->
            if (id == SampleData.PROD) awaitCancellation() else services.base.devices.page(q, id)
        }
        vm.refresh()
        runCurrent()
        services.base.sessions.activate(SampleData.DEV)
        advanceUntilIdle()
        assertEquals(listOf("NAS-DEV01"), vm.state.value.devices.map { it.label })
    }

    @Test fun searchIsDebounced() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        vm.setSearch("c")
        vm.setSearch("co")
        vm.setSearch("compta")
        advanceTimeBy(DeviceListViewModel.SEARCH_DEBOUNCE_MS - 1)
        assertEquals(1, services.recording.pages.size)
        advanceUntilIdle()
        assertEquals(2, services.recording.pages.size)
        assertEquals("compta", services.recording.pages.last().first.search)
        assertEquals(setOf("PC-COMPTA-01", "PC-COMPTA-02", "PC-COMPTA-03"), vm.state.value.devices.map { it.label }.toSet())
    }

    @Test fun chipsFilterOnTheServerAndClearFiltersKeepsTheSort() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        vm.toggleStatus(StatusChip.OFFLINE)
        advanceUntilIdle()
        assertEquals("offline", services.recording.pages.last().first.status)
        assertEquals(setOf("SRV-AD2", "PC-ATELIER-02"), vm.state.value.devices.map { it.label }.toSet())
        // Same section count as the chip: summary.
        assertEquals(16, vm.state.value.sections.single().count)
        vm.toggleProblemsFirst()
        advanceUntilIdle()
        assertEquals(DeviceSort.NAME, services.recording.pages.last().first.sortBy)
        vm.clearFilters()
        advanceUntilIdle()
        val f = vm.state.value.filters
        assertNull(f.status)
        assertFalse(f.problemsFirst)
    }

    @Test fun liveStatusChangePatchesInPlaceAndOffersToReorder() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        backgroundScope.launch { vm.followRealtime() }
        runCurrent()
        services.recording.signalFlow.emit(DeviceSignal(ObliEvents.DEVICE_UPDATED, 187, DeviceStatus.ONLINE))
        runCurrent()
        val s = vm.state.value
        val row = s.devices.first { it.id == 187L }
        assertEquals(DeviceStatus.ONLINE, row.statusKind)
        // The row stays in CRITIQUE until the user asks: nothing moves under the finger.
        assertEquals(DeviceSection.CRITICAL, s.sections.first().section)
        assertEquals(1, s.pendingChanges)
        assertEquals(1, s.flashes[187L])
        // Back to its section: no reorder needed any more.
        services.recording.signalFlow.emit(DeviceSignal(ObliEvents.DEVICE_UPDATED, 187, DeviceStatus.CRITICAL))
        runCurrent()
        assertEquals(0, vm.state.value.pendingChanges)
        // DEVICE_OFFLINE carries no status: offline is implied.
        services.recording.signalFlow.emit(DeviceSignal(ObliEvents.DEVICE_OFFLINE, 140, null))
        runCurrent()
        assertEquals(DeviceStatus.OFFLINE, vm.state.value.devices.first { it.id == 140L }.statusKind)
        vm.refresh()
        advanceUntilIdle()
        assertEquals(0, vm.state.value.pendingChanges)
    }

    @Test fun signalsOfUnknownDevicesOrAnotherServerAreIgnored() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        val before = vm.state.value
        vm.onSignal(DeviceSignal(ObliEvents.DEVICE_UPDATED, 9999, DeviceStatus.CRITICAL), SampleData.PROD)
        vm.onSignal(DeviceSignal(ObliEvents.DEVICE_UPDATED, 187, DeviceStatus.ONLINE), SampleData.DEV)
        assertEquals(before, vm.state.value)
        vm.onSignal(DeviceSignal(ObliEvents.DEVICE_DELETED, 233, null), SampleData.PROD)
        assertFalse(vm.state.value.devices.any { it.id == 233L })
    }

    @Test fun metricsPushesAreAppliedAtMostOncePerSecond() = runTest(main) {
        val services = TestServices()
        val clock = MutableClock()
        val vm = start(services, clock)
        fun cpu(id: Long) = vm.state.value.devices.first { it.id == id }.latestMetrics?.cpu?.percent
        vm.onMetricsPush(SampleData.PROD, 187, DeviceMetrics(cpu = CpuMetrics(percent = 97.0)))
        assertEquals(97.0, cpu(187))
        clock.now += 200
        vm.onMetricsPush(SampleData.PROD, 187, DeviceMetrics(cpu = CpuMetrics(percent = 96.0)))
        vm.onMetricsPush(SampleData.PROD, 140, DeviceMetrics(cpu = CpuMetrics(percent = 5.0)))
        assertEquals(97.0, cpu(187))
        advanceTimeBy(DeviceListViewModel.METRICS_EVERY_MS)
        runCurrent()
        assertEquals(96.0, cpu(187))
        assertEquals(5.0, cpu(140))
        // Another server's push never touches this list.
        clock.now += 5_000
        vm.onMetricsPush(SampleData.DEV, 187, DeviceMetrics(cpu = CpuMetrics(percent = 1.0)))
        advanceUntilIdle()
        assertEquals(96.0, cpu(187))
    }

    @Test fun failedRefreshKeepsTheRowsAndSaysWhy() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        services.recording.pageAnswer = { _, _ -> NETWORK_DOWN }
        vm.refresh()
        advanceUntilIdle()
        val s = vm.state.value
        assertEquals(12, s.devices.size)
        assertEquals(ProblemKind.NETWORK, s.problem?.kind)
        assertFalse(s.refreshing)
        services.recording.pageAnswer = null
        vm.refresh()
        advanceUntilIdle()
        assertNull(vm.state.value.problem)
    }

    @Test fun firstLoadFailureShowsTheProblemWithoutRows() = runTest(main) {
        val services = TestServices()
        services.recording.pageAnswer = { _, _ -> ApiOutcome.Failure(502, tools.obli.core.network.FailureKind.SERVER) }
        val vm = start(services)
        val s = vm.state.value
        assertTrue(s.devices.isEmpty())
        assertFalse(s.loading)
        assertEquals(LoadProblem(ProblemKind.SERVER, 502, "/api/devices"), s.problem)
    }

    @Test fun expiredSessionStopsLoadingAndReloadsOnceSignedInAgain() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        val session = services.base.sessions.session(SampleData.PROD)!!
        session.markExpired()
        advanceUntilIdle()
        assertEquals(ProblemKind.SESSION_EXPIRED, vm.state.value.problem?.kind)
        assertEquals(1, services.recording.pages.size)
        session.markSignedIn(SampleData.probe(SampleData.PROD))
        advanceUntilIdle()
        assertEquals(2, services.recording.pages.size)
        assertNull(vm.state.value.problem)
    }

    @Test fun infiniteScrollAppendsTheNextPage() = runTest(main) {
        val services = TestServices()
        val all = SampleData.devices
        services.recording.pageAnswer = { q, _ ->
            val from = (q.page - 1) * 5
            ApiOutcome.Ok(DevicePage(all.drop(from).take(5), all.size, q.page, 5))
        }
        val vm = start(services)
        assertTrue(vm.state.value.hasMore)
        vm.loadMore()
        advanceUntilIdle()
        vm.loadMore()
        advanceUntilIdle()
        val s = vm.state.value
        assertEquals(12, s.devices.size)
        assertFalse(s.hasMore)
        assertEquals(listOf(1, 2, 3), services.recording.pages.map { it.first.page })
        vm.loadMore()
        advanceUntilIdle()
        assertEquals(3, services.recording.pages.size)
    }
}
