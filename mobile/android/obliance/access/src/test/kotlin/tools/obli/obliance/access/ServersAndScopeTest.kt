package tools.obli.obliance.access

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.auth.AuthState
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.sample.SampleData

@OptIn(ExperimentalCoroutinesApi::class)
class ServersAndScopeTest {
    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After fun tearDown() = Dispatchers.resetMain()

    private fun authOf(services: TestServices): Map<ServerId, AuthState> =
        services.registry.state.value.profiles.associate { it.id to services.sessions.session(it.id)!!.auth.value }

    @Test fun `scope sheet lists the servers with state and unread count, then the active server's tenants`() {
        val services = TestServices(3)
        services.sessions.session(SampleData.QUAL)!!.markExpired()
        val snapshot = services.alerts.snapshot.value
        val ui = ScopeUi.build(services.registry.state.value, authOf(services), ConnectionState.CONNECTED, snapshot, services.tenants.scope.value)

        assertEquals(listOf("Obliance Prod", "Obliance Dev", "Obliance Qual"), ui.servers.map { it.profile.displayName })
        assertEquals(listOf(true, false, false), ui.servers.map { it.active })
        assertEquals(ServerStatus.Live, ui.servers[0].status)
        assertTrue(ui.servers[1].status is ServerStatus.Checked)
        assertEquals(ServerStatus.Expired, ui.servers[2].status)
        // Unread alerts of the sample night: 5 on Prod, 1 on Dev, 1 on Qual.
        assertEquals(listOf(5, 1, 1), ui.servers.map { it.unread })

        assertEquals(listOf("Default", "ACME"), ui.tenants.map { it.tenant.name })
        assertEquals(listOf(true, false), ui.tenants.map { it.current })
        assertEquals(listOf(3, 2), ui.tenants.map { it.unread })
        assertTrue(ui.canSwitchTenant)
        assertTrue(ui.globalView)
        assertEquals("Default", ui.currentTenantName)
        assertEquals("Karim Benali", ui.userLabel)
    }

    @Test fun `one server - no server section, and tenants of another server are never shown`() {
        val services = TestServices(1)
        val ui = ScopeUi.build(services.registry.state.value, authOf(services), ConnectionState.CONNECTED, services.alerts.snapshot.value, services.tenants.scope.value)
        assertTrue(ui.servers.isEmpty())
        assertFalse(ui.multiServer)

        val stale = TenantScope(serverId = SampleData.DEV, tenants = SampleData.tenants, currentTenantId = 1)
        val other = ScopeUi.build(services.registry.state.value, authOf(services), null, services.alerts.snapshot.value, stale)
        assertTrue(other.tenants.isEmpty())
        assertFalse(other.canSwitchTenant)
    }

    @Test fun `server cards carry version, account and state`() {
        val services = TestServices(3)
        val alerts = services.alerts.snapshot.value.let { s ->
            s.copy(feeds = s.feeds.map { if (it.serverId == SampleData.DEV) it.copy(status = FeedStatus.UNREACHABLE) else it })
        }
        val cards = ServerCardUi.build(services.registry.state.value, authOf(services), ConnectionState.CONNECTED, alerts, mapOf(SampleData.PROD to "5.1.110"))
        assertEquals("5.1.110", cards[0].version)
        assertNull(cards[1].version)
        assertEquals("og_karim.benali", cards[0].user?.username)
        assertTrue(cards[0].user!!.isObligate)
        assertEquals("karim.benali", cards[2].user?.username)
        assertEquals(ServerStatus.Unreachable(null), cards[1].status)
    }

    @Test fun `servers view model edits the registry`() {
        val services = TestServices(3)
        val vm = ServersViewModel(services)
        assertEquals("5.1.110", vm.versions[SampleData.PROD])
        vm.toggle(SampleData.QUAL)
        assertEquals(SampleData.QUAL, vm.expanded)
        vm.rename(SampleData.QUAL, "Obliance Recette")
        vm.recolor(SampleData.QUAL, ServerColor.SAND)
        vm.setNotify(SampleData.QUAL, NotifyScope.CRITICAL_ONLY)
        vm.setIncludeInTriage(SampleData.QUAL, false)
        vm.move(SampleData.QUAL, -1)
        val qual = services.registry.state.value.byId(SampleData.QUAL)!!
        assertEquals("Obliance Recette", qual.displayName)
        assertEquals("OR", qual.monogram)
        assertEquals(ServerColor.SAND, qual.color)
        assertEquals(NotifyScope.CRITICAL_ONLY, qual.notify)
        assertFalse(qual.includeInTriage)
        assertEquals(listOf(SampleData.PROD, SampleData.QUAL, SampleData.DEV), services.registry.state.value.profiles.map { it.id })
        vm.move(SampleData.PROD, -1)
        assertEquals("the first cannot move up", SampleData.PROD, services.registry.state.value.profiles.first().id)
    }

    @Test fun `signing out of the active server moves to the next signed-in one`() {
        val services = TestServices(3)
        services.sessions.session(SampleData.DEV)!!.markExpired()
        val vm = ServersViewModel(services)
        vm.signOut(SampleData.PROD)
        assertEquals(listOf(SampleData.PROD), services.auth.signedOut)
        assertEquals(SampleData.QUAL, services.registry.state.value.activeId)
        assertEquals(AuthState.SignedOut, services.sessions.session(SampleData.PROD)!!.auth.value)
        assertEquals("the profile stays", 3, services.registry.state.value.profiles.size)
    }

    @Test fun `removing a server asks first, signs it out and keeps at least one`() {
        val services = TestServices(2)
        val vm = ServersViewModel(services)
        vm.askRemove(SampleData.PROD)
        assertEquals(SampleData.PROD, vm.removing)
        vm.cancelRemove()
        assertNull(vm.removing)
        assertEquals(2, services.registry.state.value.profiles.size)

        vm.askRemove(SampleData.PROD)
        vm.confirmRemove()
        assertEquals(listOf(SampleData.PROD), services.auth.signedOut)
        assertEquals(listOf(SampleData.DEV), services.registry.state.value.profiles.map { it.id })
        assertEquals(SampleData.DEV, services.registry.state.value.activeId)

        vm.askRemove(SampleData.DEV)
        assertNull("the last server cannot be removed", vm.removing)
    }
}
