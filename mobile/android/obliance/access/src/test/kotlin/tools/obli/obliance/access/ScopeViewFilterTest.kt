package tools.obli.obliance.access

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.data.DevicesRepository
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** S81 "Filtrer la vue globale": what the sheet shows and what a tap stores. */
class ScopeViewFilterTest {
    private fun authOf(services: SampleObliServices): Map<ServerId, AuthState> =
        services.registry.state.value.profiles.associate { it.id to services.sessions.session(it.id)!!.auth.value }

    private fun ui(services: SampleObliServices, scope: TenantScope = services.tenants.scope.value) =
        ScopeUi.build(services.registry.state.value, authOf(services), ConnectionState.CONNECTED, services.alerts.snapshot.value, scope)

    @Test fun `offered on the master tenant with 2 tenants or more only`() {
        val services = SampleObliServices()
        val global = ui(services)
        assertTrue(global.showViewFilter)
        assertTrue(global.viewFilter.isEmpty())
        assertEquals(SampleData.PROD, global.activeId)

        // Working in ACME: no global view to filter.
        val inAcme = ui(services, services.tenants.scope.value.copy(currentTenantId = SampleData.ACME_TENANT))
        assertFalse(inAcme.showViewFilter)

        // A single tenant: nothing to filter.
        val single = ui(services, TenantScope(SampleData.PROD, SampleData.tenants.take(1), SampleData.DEFAULT_TENANT))
        assertFalse(single.showViewFilter)

        // The tenants of another server are never used.
        val stale = ui(services, TenantScope(SampleData.DEV, SampleData.tenants, SampleData.DEFAULT_TENANT, viewFilter = setOf(SampleData.ACME_TENANT)))
        assertFalse(stale.showViewFilter)
        assertTrue(stale.viewFilter.isEmpty())
    }

    @Test fun `the stored filter is shown with its tenant names`() = runBlocking {
        val services = SampleObliServices()
        services.tenants.setViewFilter(setOf(SampleData.ACME_TENANT))
        val filtered = ui(services)
        assertEquals(setOf(SampleData.ACME_TENANT), filtered.viewFilter)
        assertEquals(listOf("ACME"), filtered.filterNames)
        // Outside the global view the section and the names disappear, the stored filter stays.
        val inAcme = ui(services, services.tenants.scope.value.copy(currentTenantId = SampleData.ACME_TENANT, viewFilter = emptySet()))
        assertEquals(emptyList<String>(), inAcme.filterNames)
        assertEquals(listOf(SampleData.ACME_TENANT), services.registry.state.value.byId(SampleData.PROD)!!.viewFilter)
    }

    @Test fun `a tap toggles, Tous les tenants clears, every tenant is no filter`() {
        val all = listOf(SampleData.DEFAULT_TENANT, SampleData.ACME_TENANT)
        assertEquals(setOf(SampleData.ACME_TENANT), ViewFilterChoice.next(emptySet(), all, SampleData.ACME_TENANT))
        assertEquals(emptySet<Long>(), ViewFilterChoice.next(setOf(SampleData.ACME_TENANT), all, SampleData.ACME_TENANT))
        assertEquals(emptySet<Long>(), ViewFilterChoice.next(setOf(SampleData.ACME_TENANT), all, null))
        assertEquals("both selected = no filter", emptySet<Long>(), ViewFilterChoice.next(setOf(SampleData.ACME_TENANT), all, SampleData.DEFAULT_TENANT))
        assertEquals(setOf(4L, 7L), ViewFilterChoice.next(setOf(4L), listOf(1L, 4L, 7L), 7L))
    }

    @Test fun `counts are two pageSize=1 queries per tenant on the active server`() = runBlocking {
        val sample = SampleObliServices()
        val queries = mutableListOf<Pair<DeviceQuery, ServerId?>>()
        val recording = object : DevicesRepository by sample.devices {
            override suspend fun page(query: DeviceQuery, serverId: ServerId?): ApiOutcome<DevicePage> {
                queries += query to serverId
                return sample.devices.page(query, serverId)
            }
        }
        val counts = TenantCountsLoader(recording).load(SampleData.PROD, listOf(SampleData.DEFAULT_TENANT, SampleData.ACME_TENANT))
        // §4 sample: ACME has 7 approved devices (KIOSK-ACCUEIL-02 waits for approval), PC-COMPTA-03 critical.
        assertEquals(TenantCount(7, 1), counts[SampleData.ACME_TENANT])
        assertEquals(TenantCount(4, 0), counts[SampleData.DEFAULT_TENANT])
        assertEquals(4, queries.size)
        assertTrue(queries.all { (q, server) -> server == SampleData.PROD && q.pageSize == 1 && q.approvalStatus == "approved" && q.tenantIds.size == 1 })
        assertEquals(2, queries.count { it.first.status == "critical" })
    }

    @Test fun `a failed count only hides that tenant and at most 12 tenants are counted`() = runBlocking {
        val sample = SampleObliServices()
        var calls = 0
        val flaky = object : DevicesRepository by sample.devices {
            override suspend fun page(query: DeviceQuery, serverId: ServerId?): ApiOutcome<DevicePage> {
                calls++
                return if (query.tenantIds == listOf(SampleData.ACME_TENANT)) ApiOutcome.Failure(null, FailureKind.NETWORK) else sample.devices.page(query, serverId)
            }
        }
        val counts = TenantCountsLoader(flaky).load(SampleData.PROD, listOf(SampleData.DEFAULT_TENANT, SampleData.ACME_TENANT))
        assertEquals(setOf(SampleData.DEFAULT_TENANT), counts.keys)

        calls = 0
        TenantCountsLoader(flaky).load(SampleData.PROD, (100L..119L).toList())
        assertEquals(TenantCountsLoader.MAX_TENANTS * 2, calls)
    }
}
