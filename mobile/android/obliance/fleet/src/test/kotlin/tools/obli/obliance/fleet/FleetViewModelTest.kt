package tools.obli.obliance.fleet

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.TenantsRepository
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** Sample services whose tenant scope the test drives (server switch, tenant switch). */
private class ScopedServices(
    val base: SampleObliServices = SampleObliServices(),
    val scope: MutableStateFlow<TenantScope> = MutableStateFlow(TenantScope(SampleData.PROD, SampleData.tenants, SampleData.DEFAULT_TENANT)),
) : ObliServices by base {
    override val tenants: TenantsRepository = object : TenantsRepository {
        override val scope: StateFlow<TenantScope> = this@ScopedServices.scope
        override suspend fun refresh(): ApiOutcome<List<Tenant>> = ApiOutcome.Ok(SampleData.tenants)
        override suspend fun switchTo(tenantId: Long, serverId: ServerId?): ApiOutcome<Unit> {
            this@ScopedServices.scope.update { it.copy(currentTenantId = tenantId) }
            return ApiOutcome.Ok(Unit)
        }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class FleetViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.collect(vm: FleetViewModel) = backgroundScope.launch { vm.ui.collect { } }

    private fun FleetViewModel(services: ObliServices, source: FleetSource) = FleetViewModel(services, source, clock = { NIGHT_NOW })

    @Test fun `loads the active server figures, every call on that server`() = runTest(dispatcher) {
        val source = SampleFleetSource()
        val vm = FleetViewModel(ScopedServices(), source)
        collect(vm)
        runCurrent()
        val ui = vm.ui.value
        assertFalse(ui.loading)
        assertNotNull(ui.data)
        val data = ui.data!!
        assertEquals(SampleData.PROD, data.serverId)
        assertEquals(312, data.summary.total)
        assertTrue(data.serverAggregates)
        assertEquals(listOf("PC-COMPTA-03", "BOB01", "SRV-FILES01", "SRV-AD2", "PC-ATELIER-02"), data.attention.map { it.label })
        assertEquals(2, data.disks!!.count)
        assertEquals(9, data.updates!!.critical)
        assertEquals(24, data.hourly!!.size)
        assertTrue(data.showTenants) // Default = global view
        assertEquals(NIGHT_NOW, ui.updatedAt)
        assertTrue(source.calls.all { it.second == SampleData.PROD })
        assertEquals(setOf("summary", "devices", "group-stats", "disk-saturated", "updates", "hourly"), source.calls.map { it.first }.toSet())
    }

    @Test fun `polls every 60 s while collected, and on pull to refresh`() = runTest(dispatcher) {
        val source = SampleFleetSource()
        val vm = FleetViewModel(ScopedServices(), source)
        collect(vm)
        runCurrent()
        assertEquals(1, source.calls.count { it.first == "summary" })
        advanceTimeBy(FleetViewModel.POLL_MS - 1_000)
        runCurrent()
        assertEquals(1, source.calls.count { it.first == "summary" })
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(2, source.calls.count { it.first == "summary" })
        vm.refresh()
        runCurrent()
        assertEquals(3, source.calls.count { it.first == "summary" })
        assertFalse(vm.ui.value.refreshing)
    }

    @Test fun `nothing is loaded while nobody collects`() = runTest(dispatcher) {
        val source = SampleFleetSource()
        FleetViewModel(ScopedServices(), source)
        advanceTimeBy(5 * FleetViewModel.POLL_MS)
        runCurrent()
        assertTrue(source.calls.isEmpty())
    }

    @Test fun `a server switch reloads on the new server and drops the old figures`() = runTest(dispatcher) {
        val services = ScopedServices()
        val source = SampleFleetSource()
        val vm = FleetViewModel(services, source)
        collect(vm)
        runCurrent()
        source.calls.clear()
        services.scope.value = TenantScope(SampleData.DEV, listOf(SampleData.tenants.first()), SampleData.DEFAULT_TENANT)
        runCurrent()
        val data = vm.ui.value.data!!
        assertEquals(SampleData.DEV, data.serverId)
        assertEquals(1, data.summary.total)
        assertEquals(listOf("NAS-DEV01"), data.attention.map { it.label })
        assertTrue(source.calls.isNotEmpty())
        assertTrue(source.calls.all { it.second == SampleData.DEV })
    }

    @Test fun `a tenant switch reloads`() = runTest(dispatcher) {
        val services = ScopedServices()
        val source = SampleFleetSource()
        val vm = FleetViewModel(services, source)
        collect(vm)
        runCurrent()
        services.tenants.switchTo(SampleData.ACME_TENANT)
        runCurrent()
        assertEquals(2, source.calls.count { it.first == "summary" })
        assertFalse(vm.ui.value.data!!.showTenants) // ACME is not the global view
    }

    @Test fun `a failed refresh keeps the last figures and says why`() = runTest(dispatcher) {
        val source = SampleFleetSource()
        val vm = FleetViewModel(ScopedServices(), source)
        collect(vm)
        runCurrent()
        source.summaryAnswer = { ApiOutcome.Failure(null, FailureKind.NETWORK, "UnknownHostException") }
        vm.refresh()
        runCurrent()
        val ui = vm.ui.value
        assertEquals(FleetProblem.OFFLINE, ui.problem)
        assertEquals(312, ui.data!!.summary.total)
        assertEquals(NIGHT_NOW, ui.updatedAt)
        // Back to normal on the next successful load.
        source.summaryAnswer = null
        vm.refresh()
        runCurrent()
        assertNull(vm.ui.value.problem)
    }

    @Test fun `first load failure shows the problem without data`() = runTest(dispatcher) {
        val source = SampleFleetSource(summaryAnswer = { ApiOutcome.SessionExpired })
        val vm = FleetViewModel(ScopedServices(), source)
        collect(vm)
        runCurrent()
        val ui = vm.ui.value
        assertFalse(ui.loading)
        assertNull(ui.data)
        assertEquals(FleetProblem.SESSION_EXPIRED, ui.problem)
    }

    @Test fun `non-admins get figures from the devices they can see`() = runTest(dispatcher) {
        val source = SampleFleetSource(admin = false)
        val vm = FleetViewModel(ScopedServices(), source)
        collect(vm)
        runCurrent()
        val data = vm.ui.value.data!!
        assertFalse(data.serverAggregates)
        assertEquals(11, data.summary.total)
        assertEquals(setOf("devices"), source.calls.map { it.first }.toSet())
        assertNull(data.groups)
    }

    @Test fun `filtered global view - figures from the filtered devices, unfilterable cards for the whole view`() = runTest(dispatcher) {
        val services = ScopedServices()
        val source = SampleFleetSource()
        val vm = FleetViewModel(services, source)
        collect(vm)
        runCurrent()
        source.calls.clear()
        services.scope.update { it.withStoredViewFilter(listOf(SampleData.ACME_TENANT)) }
        runCurrent()

        val ui = vm.ui.value
        val data = ui.data!!
        val acme = FleetFilter(listOf(SampleData.ACME_TENANT), listOf("ACME"))
        assertEquals(acme, data.filter)
        assertEquals(acme, ui.filter)
        assertEquals(listOf(SampleData.ACME_TENANT), source.tenantFilters.last())
        // §4 sample, ACME: 7 managed devices (KIOSK-ACCUEIL-02 waits for approval), 4 online, 2 offline, 1 critical.
        assertEquals(7, data.summary.total)
        assertEquals(4, data.summary.online)
        assertEquals(2, data.summary.offline)
        assertEquals(1, data.summary.critical)
        assertEquals(listOf("PC-COMPTA-03", "SRV-AD2", "PC-ATELIER-02"), data.attention.map { it.label })
        // Indicators computed from that list only (no server-only tiles mixed in).
        assertEquals(listOf(KpiKind.ONLINE, KpiKind.OFFLINE, KpiKind.CRITICAL, KpiKind.WARNING), FleetMapper.kpis(data).map { it.kind })
        assertEquals(listOf(4, 2, 1, 0), FleetMapper.kpis(data).map { it.value })
        // The cards the server cannot filter stay, for the whole global view.
        assertTrue(data.serverAggregates)
        assertEquals(2, data.disks!!.count)
        assertEquals(24, data.hourly!!.size)
        assertNotNull(data.groups)
        assertEquals(312, data.globalSummary!!.total)
        assertEquals(47, FleetMapper.unfilteredUpdates(data)!!.value)
        assertEquals(9, FleetMapper.unfilteredUpdates(data)!!.criticalUpdates)
        assertTrue(source.calls.all { it.second == SampleData.PROD })

        // Filter cleared: back to the server summary, no `tenantIds`.
        services.scope.update { it.copy(viewFilter = emptySet()) }
        runCurrent()
        val back = vm.ui.value.data!!
        assertNull(back.filter)
        assertNull(vm.ui.value.filter)
        assertEquals(312, back.summary.total)
        assertEquals(emptyList<Long>(), source.tenantFilters.last())
        assertNull(FleetMapper.unfilteredUpdates(back))
        assertEquals(6, FleetMapper.kpis(back).size)
    }

    @Test fun `filtered global view of a non-admin - only the filtered devices are asked`() = runTest(dispatcher) {
        val services = ScopedServices()
        services.scope.update { it.withStoredViewFilter(listOf(SampleData.DEFAULT_TENANT)) }
        val source = SampleFleetSource(admin = false)
        val vm = FleetViewModel(services, source)
        collect(vm)
        runCurrent()
        val data = vm.ui.value.data!!
        assertEquals(setOf("devices"), source.calls.map { it.first }.toSet())
        assertEquals(listOf(SampleData.DEFAULT_TENANT), source.tenantFilters.single())
        assertFalse(data.serverAggregates)
        assertEquals(4, data.summary.total)
        assertNull(data.groups)
        assertNull(FleetMapper.unfilteredUpdates(data))
    }

    @Test fun `working in ACME is never filtered`() = runTest(dispatcher) {
        val services = ScopedServices()
        // The stored filter does not apply outside the global view (TenantScope rules).
        services.scope.update { it.copy(currentTenantId = SampleData.ACME_TENANT).withStoredViewFilter(listOf(SampleData.ACME_TENANT)) }
        val source = SampleFleetSource()
        val vm = FleetViewModel(services, source)
        collect(vm)
        runCurrent()
        assertNull(vm.ui.value.data!!.filter)
        assertEquals(listOf(emptyList<Long>()), source.tenantFilters)
    }

    @Test fun `no active server`() = runTest(dispatcher) {
        val services = ScopedServices(scope = MutableStateFlow(TenantScope(serverId = null)))
        // The registry still has an active server: the scope's server wins only when set.
        val vm = FleetViewModel(services, SampleFleetSource())
        collect(vm)
        runCurrent()
        assertEquals(SampleData.PROD, vm.ui.value.data?.serverId ?: ServerId("none"))
    }
}
