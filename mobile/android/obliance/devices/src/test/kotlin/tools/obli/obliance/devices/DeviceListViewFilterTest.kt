package tools.obli.obliance.devices

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import tools.obli.obliance.data.sample.SampleData

/** S20 with "Filtrer la vue globale" (design doc §2.3): `tenantIds=` on the list, never on the summary. */
@OptIn(ExperimentalCoroutinesApi::class)
class DeviceListViewFilterTest {
    private val main = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(main)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.start(services: TestServices = TestServices()): DeviceListViewModel {
        val vm = DeviceListViewModel(services, MutableClock().clock)
        backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        return vm
    }

    @Test fun withoutFilterNoTenantIdsAreSent() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        val (query, _) = services.recording.pages.single()
        assertEquals(emptyList<Long>(), query.tenantIds)
        assertFalse(query.toPath().contains("tenantIds"))
        assertFalse(vm.state.value.viewFiltered)
        assertEquals(16, vm.state.value.chipCount(StatusChip.OFFLINE))
    }

    @Test fun acmeFilterIsSentAndReloadsTheList() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        services.base.tenants.setViewFilter(setOf(SampleData.ACME_TENANT))
        advanceUntilIdle()

        assertEquals(2, services.recording.pages.size)
        val (query, server) = services.recording.pages.last()
        assertEquals(SampleData.PROD, server)
        assertEquals(listOf(SampleData.ACME_TENANT), query.tenantIds)
        assertTrue(query.toPath().contains("tenantIds=4"))
        val s = vm.state.value
        assertTrue(s.viewFiltered)
        assertEquals(listOf("ACME"), s.filterNames)
        assertTrue(s.devices.isNotEmpty())
        assertTrue(s.devices.all { it.tenantId == SampleData.ACME_TENANT })
        // The summary ignores tenantIds: not asked again, chip and section counts hidden.
        assertEquals(1, services.recording.summaries.size)
        assertNull(s.chipCount(StatusChip.OFFLINE))
        assertNull(s.chipCount(StatusChip.CRITICAL))
        assertEquals("section counts come from the rows", s.devices.count { it.status == "offline" }, s.sections.first { it.section == DeviceSection.OFFLINE }.count)
        // Same server and tenant: still the global view.
        assertTrue(s.globalView)
        assertEquals(SampleData.DEFAULT_TENANT, s.tenantId)
    }

    @Test fun filterRowClearsTheFilter() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        services.base.tenants.setViewFilter(setOf(SampleData.ACME_TENANT))
        advanceUntilIdle()
        vm.clearViewFilter()
        advanceUntilIdle()
        assertEquals(emptyList<Long>(), services.base.registry.state.value.byId(SampleData.PROD)!!.viewFilter)
        assertFalse(vm.state.value.viewFiltered)
        assertEquals(3, services.recording.pages.size)
        assertEquals(emptyList<Long>(), services.recording.pages.last().first.tenantIds)
        assertEquals(12, vm.state.value.devices.size)
        assertEquals(16, vm.state.value.chipCount(StatusChip.OFFLINE))
    }

    @Test fun filterAppliesToSearchChipsAndNextPages() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        services.base.tenants.setViewFilter(setOf(SampleData.DEFAULT_TENANT))
        advanceUntilIdle()
        vm.toggleStatus(StatusChip.WARNING)
        advanceUntilIdle()
        val q = services.recording.pages.last().first
        assertEquals("warning", q.status)
        assertEquals(listOf(SampleData.DEFAULT_TENANT), q.tenantIds)
        assertEquals(setOf("BOB01", "SRV-FILES01"), vm.state.value.devices.map { it.label }.toSet())
    }

    @Test fun switchingToAcmeDropsTheFilterAndBackRestoresIt() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        services.base.tenants.setViewFilter(setOf(SampleData.ACME_TENANT))
        advanceUntilIdle()
        services.base.tenants.switchTo(SampleData.ACME_TENANT)
        advanceUntilIdle()
        assertFalse(vm.state.value.viewFiltered)
        assertEquals(emptyList<Long>(), services.recording.pages.last().first.tenantIds)
        services.base.tenants.switchTo(SampleData.DEFAULT_TENANT)
        advanceUntilIdle()
        assertTrue(vm.state.value.viewFiltered)
        assertEquals(listOf(SampleData.ACME_TENANT), services.recording.pages.last().first.tenantIds)
    }

    @Test fun lateAnswerOfTheUnfilteredListIsDropped() = runTest(main) {
        val services = TestServices()
        val vm = start(services)
        val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
        services.recording.pageAnswer = { q, id ->
            if (q.tenantIds.isEmpty()) gate.await()
            services.base.devices.page(q, id)
        }
        vm.refresh()
        runCurrent()
        services.base.tenants.setViewFilter(setOf(SampleData.ACME_TENANT))
        advanceUntilIdle()
        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(vm.state.value.devices.all { it.tenantId == SampleData.ACME_TENANT })
    }

    @Test fun detailTabRoutes() {
        assertEquals(DeviceTab.PROCESSES, DeviceTab.fromRoute("processes"))
        assertEquals(DeviceTab.SERVICES, DeviceTab.fromRoute("services"))
        assertEquals(DeviceTab.TASKS, DeviceTab.fromRoute(" Tasks "))
        assertEquals(DeviceTab.OVERVIEW, DeviceTab.fromRoute("overview"))
        assertEquals(DeviceTab.OVERVIEW, DeviceTab.fromRoute(null))
        assertEquals(DeviceTab.OVERVIEW, DeviceTab.fromRoute("inventory"))
    }
}
