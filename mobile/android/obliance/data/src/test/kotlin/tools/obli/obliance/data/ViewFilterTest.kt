package tools.obli.obliance.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.auth.ServerRegistryStore
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** "Filtrer la vue globale" (design doc §2.3): the rules of TenantScope.viewFilter. */
class TenantScopeViewFilterTest {
    private val default = Tenant(1, "Default", "default")
    private val acme = Tenant(4, "ACME", "acme")
    private val global = TenantScope(ServerId("prod"), listOf(default, acme), currentTenantId = 1)

    @Test fun appliesOnlyInTheGlobalView() {
        val filtered = global.withStoredViewFilter(listOf(4L))
        assertEquals(setOf(4L), filtered.viewFilter)
        assertTrue(filtered.viewFiltered)
        assertEquals(listOf(acme), filtered.filterTenants)
        assertEquals(listOf(4L), filtered.listTenantIds)

        val inAcme = global.copy(currentTenantId = 4).withStoredViewFilter(listOf(4L))
        assertTrue(inAcme.viewFilter.isEmpty())
        assertFalse(inAcme.viewFiltered)
        assertEquals(emptyList<Long>(), inAcme.listTenantIds)
        assertEquals(emptyList<Tenant>(), inAcme.filterTenants)

        // Session tenant not known yet (/me pending): no filter.
        assertTrue(global.copy(currentTenantId = null).withStoredViewFilter(listOf(4L)).viewFilter.isEmpty())
    }

    @Test fun unknownTenantsAreDropped() {
        assertEquals(setOf(4L), global.withStoredViewFilter(listOf(4L, 99L)).viewFilter)
        assertTrue(global.withStoredViewFilter(listOf(99L)).viewFilter.isEmpty())
        // Tenant list not loaded yet: nothing can be matched.
        assertTrue(global.copy(tenants = emptyList()).withStoredViewFilter(listOf(4L)).viewFilter.isEmpty())
    }

    @Test fun everyTenantIsNoFilter() {
        assertTrue(global.withStoredViewFilter(listOf(1L, 4L)).viewFilter.isEmpty())
        assertTrue(global.withStoredViewFilter(listOf(4L, 1L, 99L)).viewFilter.isEmpty())
        assertTrue(global.withStoredViewFilter(emptyList()).viewFilter.isEmpty())
    }

    @Test fun listOrderAndSortedIds() {
        val both = TenantScope(ServerId("prod"), listOf(default, acme, Tenant(7, "x", "x")), currentTenantId = 1).withStoredViewFilter(listOf(7L, 4L))
        assertEquals(listOf(4L, 7L), both.listTenantIds)
        assertEquals(listOf(4L, 7L), both.filterTenants.map { it.id })
    }
}

/** The filter through DefaultTenantsRepository, against two fake servers. */
class ViewFilterRepositoryTest {
    private val prod = FakeServer()
    private val qual = FakeServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val client = ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA")
    private val prodId = ServerId("prod")
    private val qualId = ServerId("qual")
    private val prodOrigin = "https://obliance-prod.example.org"
    private val qualOrigin = "https://obliance-qual.example.org"
    private val mockOf = mapOf(prodOrigin to prod, qualOrigin to qual)
    private var saved: ServerRegistryState? = null

    private val tenantsJson = """{"success":true,"data":[{"id":4,"name":"ACME","slug":"acme"},{"id":1,"name":"Default","slug":"default"}]}"""

    private fun services(): DefaultObliServices = runBlocking {
        val store = object : ServerRegistryStore {
            override suspend fun load() = saved ?: ServerRegistryState(
                listOf(
                    ServerProfile(prodId, prodOrigin, "Obliance Prod", ServerColor.VIOLET, "OP", 0),
                    ServerProfile(qualId, qualOrigin, "Obliance Qual", ServerColor.FUCHSIA, "OQ", 1),
                ),
                prodId,
            )
            override suspend fun save(state: ServerRegistryState) { saved = state }
        }
        val registry = ServerRegistry(store).also { it.load() }
        val sessions = ServerSessions(registry, { p, now ->
            ServerSession(p.id, now, ObliHttp(mockOf.getValue(p.origin).origin, client), { FakeRealtime() })
        }, scope)
        DefaultObliServices(registry, sessions, { ObliHttp(mockOf[it]?.origin ?: it, client) }, { }, scope)
    }

    @After fun tearDown() {
        scope.cancel()
        prod.close()
        qual.close()
    }

    private suspend fun DefaultObliServices.signedInGlobalView(): TenantScope {
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        prod.on("GET /api/tenants", body = tenantsJson)
        sessions.session(prodId)!!.probe()
        return withTimeout(5_000) { tenants.scope.first { it.tenants.size == 2 && it.isGlobalView } }
    }

    @Test fun setViewFilterReEmitsAtOnceAndIsPersisted() = runBlocking {
        val s = services()
        assertFalse(s.signedInGlobalView().viewFiltered)

        assertTrue(s.tenants.setViewFilter(setOf(4L)))
        val filtered = withTimeout(5_000) { s.tenants.scope.first { it.viewFiltered } }
        assertEquals(listOf(4L), filtered.listTenantIds)
        assertEquals(listOf("ACME"), filtered.filterTenants.map { it.name })
        assertEquals(listOf(4L), saved!!.byId(prodId)!!.viewFilter)
        // No server call, no socket change: only the profile.
        assertEquals(0, prod.count("POST /api/tenant/switch"))

        // Every tenant = "Tous les tenants": nothing stored.
        assertTrue(s.tenants.setViewFilter(setOf(1L, 4L)))
        withTimeout(5_000) { s.tenants.scope.first { !it.viewFiltered } }
        assertEquals(emptyList<Long>(), saved!!.byId(prodId)!!.viewFilter)

        assertFalse(s.tenants.setViewFilter(setOf(4L), ServerId("unknown")))
    }

    @Test fun filterOfOneServerNeverChangesAnother() = runBlocking {
        val s = services()
        s.signedInGlobalView()
        assertTrue(s.tenants.setViewFilter(setOf(4L), qualId))
        assertEquals(listOf(4L), s.registry.state.value.byId(qualId)!!.viewFilter)
        assertEquals(emptyList<Long>(), s.registry.state.value.byId(prodId)!!.viewFilter)
        // The active server's scope stays unfiltered.
        kotlinx.coroutines.delay(100)
        assertFalse(s.tenants.scope.value.viewFiltered)

        assertTrue(s.tenants.setViewFilter(setOf(4L)))
        assertTrue(s.tenants.setViewFilter(emptySet(), qualId))
        assertEquals(listOf(4L), s.registry.state.value.byId(prodId)!!.viewFilter)
        assertEquals(emptyList<Long>(), s.registry.state.value.byId(qualId)!!.viewFilter)
    }

    @Test fun switchingToAcmeAndBackRestoresTheStoredFilter() = runBlocking {
        val s = services()
        s.signedInGlobalView()
        s.tenants.setViewFilter(setOf(4L))
        withTimeout(5_000) { s.tenants.scope.first { it.viewFiltered } }

        prod.on("POST /api/tenant/switch", body = """{"success":true,"data":{"currentTenantId":4}}""")
        prod.on("GET /api/auth/me", body = ME_ADMIN.replace("\"currentTenantId\":1", "\"currentTenantId\":4"))
        assertEquals(ApiOutcome.Ok(Unit), s.tenants.switchTo(4))
        val inAcme = withTimeout(5_000) { s.tenants.scope.first { it.currentTenantId == 4L } }
        assertFalse("no filter outside the global view", inAcme.viewFiltered)
        assertEquals("the stored filter stays", listOf(4L), s.registry.state.value.byId(prodId)!!.viewFilter)

        prod.on("POST /api/tenant/switch", body = """{"success":true,"data":{"currentTenantId":1}}""")
        prod.on("GET /api/auth/me", body = ME_ADMIN)
        assertEquals(ApiOutcome.Ok(Unit), s.tenants.switchTo(1))
        val back = withTimeout(5_000) { s.tenants.scope.first { it.currentTenantId == 1L } }
        assertEquals(setOf(4L), back.viewFilter)
    }

    @Test fun serverSwitchShowsThatServersOwnFilter() = runBlocking {
        val s = services()
        s.signedInGlobalView()
        s.tenants.setViewFilter(setOf(4L))
        withTimeout(5_000) { s.tenants.scope.first { it.viewFiltered } }
        qual.on("GET /api/auth/me", body = ME_ADMIN)
        qual.on("GET /api/tenants", body = tenantsJson)
        s.openOn(qualId)
        val onQual = withTimeout(5_000) { s.tenants.scope.first { it.serverId == qualId && it.tenants.size == 2 } }
        assertFalse(onQual.viewFiltered)
        s.openOn(prodId)
        val back = withTimeout(5_000) { s.tenants.scope.first { it.serverId == prodId && it.viewFilter == setOf(4L) } }
        assertEquals(listOf(4L), back.listTenantIds)
    }
}

/** The in-memory services other modules' tests rely on. */
class SampleViewFilterTest {
    @Test fun sampleStoresTheFilterAndItsDevicesHonourIt() = runBlocking {
        val sample = SampleObliServices()
        assertFalse(sample.tenants.scope.value.viewFiltered)
        assertTrue(sample.tenants.setViewFilter(setOf(SampleData.ACME_TENANT)))
        assertEquals(listOf(SampleData.ACME_TENANT), sample.tenants.scope.value.listTenantIds)
        assertEquals(listOf(SampleData.ACME_TENANT), sample.registry.state.value.byId(SampleData.PROD)!!.viewFilter)

        val acme = (sample.devices.page(DeviceQuery(tenantIds = sample.tenants.scope.value.listTenantIds)) as ApiOutcome.Ok).value
        assertTrue(acme.items.all { it.tenantId == SampleData.ACME_TENANT })
        assertEquals(8, acme.total)
        val approved = (sample.devices.page(DeviceQuery(tenantIds = listOf(SampleData.ACME_TENANT), approvalStatus = "approved", pageSize = 1)) as ApiOutcome.Ok).value
        assertEquals(7, approved.total)
        val critical = (sample.devices.page(DeviceQuery(tenantIds = listOf(SampleData.ACME_TENANT), approvalStatus = "approved", status = "critical", pageSize = 1)) as ApiOutcome.Ok).value
        assertEquals(1, critical.total)
        // Unchanged without the new fields: every device of Obliance Prod.
        assertEquals(12, (sample.devices.page() as ApiOutcome.Ok).value.total)

        // ACME and back to Default: the stored filter applies again.
        sample.tenants.switchTo(SampleData.ACME_TENANT)
        assertFalse(sample.tenants.scope.value.viewFiltered)
        sample.tenants.switchTo(SampleData.DEFAULT_TENANT)
        assertEquals(setOf(SampleData.ACME_TENANT), sample.tenants.scope.value.viewFilter)

        // Every tenant: cleared. A filter written in the registry directly shows too.
        assertTrue(sample.tenants.setViewFilter(setOf(SampleData.DEFAULT_TENANT, SampleData.ACME_TENANT)))
        assertFalse(sample.tenants.scope.value.viewFiltered)
        sample.registry.setViewFilter(SampleData.PROD, listOf(SampleData.DEFAULT_TENANT))
        assertEquals(setOf(SampleData.DEFAULT_TENANT), sample.tenants.scope.value.viewFilter)
    }

    @Test fun sampleFilterOfAnotherServerLeavesTheActiveOneAlone() = runBlocking {
        val sample = SampleObliServices()
        assertTrue(sample.tenants.setViewFilter(setOf(SampleData.ACME_TENANT), SampleData.DEV))
        assertFalse(sample.tenants.scope.value.viewFiltered)
        assertEquals(listOf(SampleData.ACME_TENANT), sample.registry.state.value.byId(SampleData.DEV)!!.viewFilter)
        assertEquals(emptyList<Long>(), sample.registry.state.value.byId(SampleData.PROD)!!.viewFilter)
    }
}
