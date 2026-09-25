package tools.obli.obliance.more

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
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
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.model.SessionProbe
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

class MoreMapperTest {
    private val three = ServerRegistryState(SampleData.profiles, SampleData.PROD)
    private val scope = TenantScope(SampleData.PROD, SampleData.tenants, SampleData.DEFAULT_TENANT)

    @Test fun `account of the active server, Obligate, three servers`() {
        val ui = MoreMapper.map(three, AuthState.SignedIn(SampleData.probe(SampleData.PROD)), scope)
        assertEquals("Obliance Prod", ui.server?.displayName)
        assertEquals("obliance-prod.example.org", ui.host)
        assertEquals(3, ui.serverCount)
        assertTrue(ui.multiServer)
        assertEquals("og_karim.benali", ui.user?.username)
        assertTrue(ui.obligate)
        assertEquals("KB", ui.initials)
        assertEquals("Default", ui.tenantName)
        assertTrue(ui.globalView)
        assertEquals(AccountState.SIGNED_IN, ui.account)
    }

    @Test fun `og_ prefix alone means Obligate, a local account does not`() {
        val og = SampleData.karimSso.copy(foreignSource = null)
        assertTrue(MoreMapper.map(three, AuthState.SignedIn(SessionProbe(og)), scope).obligate)
        assertFalse(MoreMapper.map(three, AuthState.SignedIn(SessionProbe(SampleData.karimLocal)), scope).obligate)
    }

    @Test fun `single server, expired session, stale scope`() {
        val one = ServerRegistryState(SampleData.profiles.take(1), SampleData.PROD)
        val ui = MoreMapper.map(one, AuthState.Expired, scope.copy(serverId = SampleData.DEV))
        assertFalse(ui.multiServer)
        assertNull(ui.user)
        assertEquals(AccountState.EXPIRED, ui.account)
        // The scope of another server is never shown as this server's tenant.
        assertNull(ui.tenantName)
        assertFalse(ui.globalView)
    }

    @Test fun `ACME is not the global view`() {
        val ui = MoreMapper.map(three, AuthState.SignedIn(SampleData.probe(SampleData.PROD)), scope.copy(currentTenantId = SampleData.ACME_TENANT))
        assertEquals("ACME", ui.tenantName)
        assertFalse(ui.globalView)
    }

    @Test fun `host of an origin`() {
        assertEquals("obliance-qual.example.org", MoreMapper.hostOf("https://obliance-qual.example.org"))
        assertEquals("obliance.example.org:8443", MoreMapper.hostOf("https://obliance.example.org:8443"))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class MoreViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)

    @After fun tearDown() = Dispatchers.resetMain()

    @Test fun `ui follows the active server`() = runTest(dispatcher) {
        val services = SampleObliServices()
        val vm = MoreViewModel(services)
        backgroundScope.launch { vm.ui.collect { } }
        runCurrent()
        assertEquals("Obliance Prod", vm.ui.value.server?.displayName)
        services.openOn(SampleData.QUAL)
        runCurrent()
        assertEquals("Obliance Qual", vm.ui.value.server?.displayName)
        assertEquals("karim.benali", vm.ui.value.user?.username)
        assertFalse(vm.ui.value.obligate)
    }

    @Test fun `sign out only after confirmation, of the named server`() = runTest(dispatcher) {
        val services = SampleObliServices()
        val vm = MoreViewModel(services)
        vm.askSignOut()
        runCurrent()
        assertEquals(SignOutConfirm(SampleData.PROD, "Obliance Prod"), vm.confirm.value)
        assertTrue(services.sessions.session(SampleData.PROD)!!.auth.value is AuthState.SignedIn)
        vm.answer(true)
        runCurrent()
        assertNull(vm.confirm.value)
        assertEquals(AuthState.SignedOut, services.sessions.session(SampleData.PROD)!!.auth.value)
        // The other servers keep their sessions.
        assertTrue(services.sessions.session(SampleData.DEV)!!.auth.value is AuthState.SignedIn)
        assertTrue(services.sessions.session(SampleData.QUAL)!!.auth.value is AuthState.SignedIn)
    }

    @Test fun `cancel keeps the session`() = runTest(dispatcher) {
        val services = SampleObliServices()
        val vm = MoreViewModel(services)
        vm.askSignOut()
        runCurrent()
        vm.answer(false)
        runCurrent()
        assertNull(vm.confirm.value)
        assertTrue(services.sessions.session(SampleData.PROD)!!.auth.value is AuthState.SignedIn)
    }

    @Test fun `the confirmed server is signed out even if another became active meanwhile`() = runTest(dispatcher) {
        val services = SampleObliServices()
        val vm = MoreViewModel(services)
        vm.askSignOut()
        runCurrent()
        services.openOn(SampleData.DEV)
        vm.answer(true)
        runCurrent()
        assertEquals(AuthState.SignedOut, services.sessions.session(SampleData.PROD)!!.auth.value)
        assertTrue(services.sessions.session(SampleData.DEV)!!.auth.value is AuthState.SignedIn)
    }
}
