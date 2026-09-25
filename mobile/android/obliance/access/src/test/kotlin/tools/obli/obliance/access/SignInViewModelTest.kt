package tools.obli.obliance.access

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerColor
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.api.Health
import tools.obli.obliance.api.LoginResult
import tools.obli.obliance.api.SsoConfig
import tools.obli.obliance.api.TwoFactorMethod
import tools.obli.obliance.api.TwoFactorMethods
import tools.obli.obliance.data.ServerCheck
import tools.obli.obliance.data.SignInResult
import tools.obli.obliance.data.sample.SampleData

@OptIn(ExperimentalCoroutinesApi::class)
class SignInViewModelTest {
    private val dev = "https://obliance-dev.example.org"

    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After fun tearDown() = Dispatchers.resetMain()

    private fun vm(services: TestServices, mode: SignInMode, fixedOrigin: String? = null, now: () -> Long = { 0L }, cookies: (String) -> Boolean = { false }) =
        SignInViewModel(services, mode, fixedOrigin, cookies, now)

    @Test fun `an http address is refused before any call`() {
        val services = TestServices(1)
        val vm = vm(services, SignInMode.FIRST)
        vm.setAddress("http://obliance-prod.example.org")
        vm.check()
        assertEquals(SignInStep.ADDRESS, vm.state.step)
        assertEquals(ProblemKind.ADDRESS_NOT_HTTPS, vm.state.problem?.kind)
        vm.setAddress("https://obliance-prod.example.org")
        assertNull("typing clears the address problem", vm.state.problem)
    }

    @Test fun `a probed server shows the probe card, a suggested name and the next free colour`() {
        val services = TestServices(1) // Obliance Prod only (violet)
        val vm = vm(services, SignInMode.ADD, cookies = { it == "https://id.example.org/" })
        vm.setAddress("obliance-dev.example.org")
        vm.check()
        val s = vm.state
        assertEquals(SignInStep.METHOD, s.step)
        assertEquals(dev, s.probe?.origin)
        assertEquals("5.1.110", s.probe?.version)
        assertTrue(s.probe!!.offersSso)
        assertEquals("id.example.org", s.probe!!.obligateHost)
        assertTrue("an Obligate cookie exists: the session is reused", s.probe!!.obligateSessionKnown)
        assertEquals("Obliance Dev", s.displayName)
        assertEquals(ServerColor.TEAL, s.color)
        assertFalse("Obligate first: the local form starts folded", s.localExpanded)
    }

    @Test fun `adding an origin that is already configured names the existing server`() {
        val services = TestServices(3)
        val vm = vm(services, SignInMode.ADD)
        vm.setAddress("OBLIANCE-PROD.example.org/devices")
        vm.check()
        assertEquals(SignInStep.ADDRESS, vm.state.step)
        assertEquals(SignInProblem(ProblemKind.ALREADY_CONFIGURED, "Obliance Prod"), vm.state.problem)
    }

    @Test fun `network failures are explained`() {
        val services = TestServices(1)
        val vm = vm(services, SignInMode.FIRST)
        vm.setAddress("obliance-dev.example.org")
        services.auth.check = { ServerCheck.Unreachable(dev, ApiOutcome.Failure(null, FailureKind.NETWORK, "SSLHandshakeException")) }
        vm.check()
        assertEquals(ProblemKind.TLS, vm.state.problem?.kind)
        services.auth.check = { ServerCheck.Unreachable(dev, ApiOutcome.Failure(null, FailureKind.NETWORK, "UnknownHostException")) }
        vm.check()
        assertEquals(ProblemKind.HOST_NOT_FOUND, vm.state.problem?.kind)
        services.auth.check = { ServerCheck.NotObliance(dev) }
        vm.check()
        assertEquals(ProblemKind.NOT_OBLIANCE, vm.state.problem?.kind)
        services.auth.check = { ServerCheck.LimitReached(dev) }
        vm.check()
        assertEquals(ProblemKind.LIMIT, vm.state.problem?.kind)
    }

    @Test fun `without Obligate the local form is open, and an unreachable Obligate is announced`() {
        val services = TestServices(1)
        services.auth.check = { ServerCheck.Ok(dev, Health("ok", "5.0.94"), SsoConfig("https://id.example.org", obligateReachable = false, obligateEnabled = true), null) }
        val vm = vm(services, SignInMode.FIRST)
        vm.setAddress("obliance-dev.example.org")
        vm.check()
        assertTrue(vm.state.localOnly)
        assertTrue(vm.state.localExpanded)
        assertTrue(vm.state.probe!!.obligateUnreachable)
        vm.toggleLocal()
        assertTrue("the only way in cannot be folded", vm.state.localExpanded)
        vm.startSso()
        assertFalse("no Obligate button, no sheet", vm.state.ssoOpen)
    }

    @Test fun `local sign-in with a second factor, then the server is added with its name and colour`() {
        val services = TestServices(1)
        val vm = vm(services, SignInMode.ADD)
        vm.setAddress("obliance-dev.example.org")
        vm.check()
        vm.setDisplayName("  Obliance Dev  ")
        vm.setColor(ServerColor.MINT)
        vm.toggleLocal()
        vm.signInLocal()
        assertEquals(ProblemKind.CREDENTIALS_MISSING, vm.state.problem?.kind)

        vm.setUsername(SampleData.karimLocal.username) // the sample asks this account for TOTP
        vm.setPassword("secret")
        vm.signInLocal()
        assertEquals(SignInStep.TWO_FACTOR, vm.state.step)
        assertEquals(TwoFactorMethod.TOTP, vm.state.twoFactor?.method)
        assertEquals("", vm.state.password)

        vm.setCode("12a345")
        assertEquals("12345", vm.state.twoFactor?.code)
        assertTrue("5 digits: nothing sent yet", services.auth.verified.isEmpty())
        vm.setCode("123456")
        assertEquals(listOf(TwoFactorMethod.TOTP to "123456"), services.auth.verified)

        val s = vm.state
        assertEquals(SignInStep.ADDED, s.step)
        assertEquals(Triple(dev, "Obliance Dev", false), services.auth.completed.single())
        val added = services.registry.state.value.byUrl(dev)!!
        assertEquals("Obliance Dev", added.displayName)
        assertEquals(ServerColor.MINT, added.color)
        assertEquals("the current server stays active", SampleData.PROD, services.registry.state.value.activeId)
        assertEquals("Obliance Prod", s.added?.activeName)

        vm.switchToAdded()
        assertEquals(added.id, services.registry.state.value.activeId)
        assertTrue(vm.state.finished)
    }

    @Test fun `a refused code shakes and clears, an expired login goes back to the password`() {
        val services = TestServices(1)
        services.auth.loginResult = LoginResult.TwoFactorRequired(TwoFactorMethods(totp = true))
        val vm = vm(services, SignInMode.FIRST)
        vm.setAddress("obliance-dev.example.org")
        vm.check()
        vm.setUsername("karim.benali")
        vm.setPassword("secret")
        vm.signInLocal()
        services.auth.verifyResult = LoginResult.InvalidCode
        vm.setCode("000000")
        assertEquals(ProblemKind.CODE, vm.state.problem?.kind)
        assertEquals(1, vm.state.twoFactor?.rejections)
        assertEquals("", vm.state.twoFactor?.code)

        services.auth.verifyResult = LoginResult.TwoFactorSessionLost
        vm.setCode("111111")
        assertEquals(SignInStep.METHOD, vm.state.step)
        assertEquals(ProblemKind.CODE_EXPIRED, vm.state.problem?.kind)
        assertTrue(vm.state.localExpanded)
    }

    @Test fun `the e-mail code can be sent again after 30 s`() {
        var now = 1_000L
        val services = TestServices(1)
        services.auth.loginResult = LoginResult.TwoFactorRequired(TwoFactorMethods(totp = true, email = true))
        val vm = vm(services, SignInMode.FIRST, now = { now })
        vm.setAddress("obliance-dev.example.org")
        vm.check()
        vm.setUsername("karim.benali")
        vm.setPassword("secret")
        vm.signInLocal()
        val tf = vm.state.twoFactor!!
        assertTrue(tf.offersChoice)
        assertEquals("TOTP first when both exist", TwoFactorMethod.TOTP, tf.method)
        vm.selectMethod(TwoFactorMethod.EMAIL)
        assertEquals(TwoFactorMethod.EMAIL, vm.state.twoFactor?.method)
        vm.resend()
        assertEquals("the server sent a code at login: wait 30 s", 0, services.auth.resends)
        now += RESEND_COOLDOWN_MS
        vm.resend()
        assertEquals(1, services.auth.resends)
        assertTrue(vm.state.twoFactor!!.resent)
        assertEquals(now + RESEND_COOLDOWN_MS, vm.state.twoFactor!!.resendAvailableAt)
        vm.setCode("482913")
        assertEquals(TwoFactorMethod.EMAIL to "482913", services.auth.verified.single())
    }

    @Test fun `wrong credentials and rate limits are shown in the local form`() {
        val services = TestServices(1)
        val vm = vm(services, SignInMode.FIRST)
        vm.setAddress("obliance-dev.example.org")
        vm.check()
        vm.setUsername("karim")
        vm.setPassword("x")
        services.auth.loginResult = LoginResult.InvalidCredentials
        vm.signInLocal()
        assertEquals(SignInProblem(ProblemKind.CREDENTIALS), vm.state.problem)
        assertEquals(ProblemArea.LOCAL, vm.state.problem?.kind?.area)
        services.auth.loginResult = LoginResult.RateLimited(60)
        vm.signInLocal()
        assertEquals(ProblemKind.RATE_LIMITED, vm.state.problem?.kind)
        services.auth.loginResult = LoginResult.Failed(ApiOutcome.Failure(500, FailureKind.SERVER))
        vm.signInLocal()
        assertEquals(SignInProblem(ProblemKind.SIGN_IN_FAILED, "500"), vm.state.problem)
    }

    @Test fun `Obligate failures and success`() {
        val services = TestServices(1)
        val vm = vm(services, SignInMode.FIRST)
        vm.setAddress("obliance-dev.example.org")
        vm.check()
        vm.startSso()
        assertTrue(vm.state.ssoOpen)
        vm.onSso(SsoOutcome.Failed(SsoFailure.FAILED))
        assertFalse(vm.state.ssoOpen)
        assertEquals(ProblemKind.SSO_FAILED, vm.state.problem?.kind)
        assertTrue("the local form opens after a failure", vm.state.localExpanded)

        vm.startSso()
        vm.onSso(SsoOutcome.Cancelled)
        assertNull(vm.state.problem)
        assertTrue(services.auth.completed.isEmpty())

        vm.startSso()
        vm.onSso(SsoOutcome.SignedIn)
        assertEquals(Triple(dev, "Obliance Dev", true), services.auth.completed.single())
        assertTrue(vm.state.finished)
        assertEquals("S01: the new server becomes active", services.registry.state.value.byUrl(dev)?.id, services.registry.state.value.activeId)
    }

    @Test fun `a session the server does not confirm is reported`() {
        val services = TestServices(1)
        services.auth.completeResult = SignInResult.NotSignedIn(AuthState.Expired)
        val vm = vm(services, SignInMode.FIRST)
        vm.setAddress("obliance-dev.example.org")
        vm.check()
        vm.startSso()
        vm.onSso(SsoOutcome.SignedIn)
        assertEquals(ProblemKind.SESSION_NOT_CONFIRMED, vm.state.problem?.kind)
        assertFalse(vm.state.finished)
    }

    @Test fun `sign in again probes the origin and never activates`() {
        val services = TestServices(3)
        val qual = services.registry.state.value.byId(SampleData.QUAL)!!
        services.sessions.session(SampleData.QUAL)!!.markExpired()
        val vm = vm(services, SignInMode.REAUTH, fixedOrigin = qual.origin)
        assertEquals(SignInStep.METHOD, vm.state.step)
        assertNotNull(vm.state.probe)
        assertTrue(vm.state.probe!!.offersSso)
        vm.changeServer()
        assertEquals("the origin cannot be changed", SignInStep.METHOD, vm.state.step)
        vm.startSso()
        vm.onSso(SsoOutcome.SignedIn)
        assertEquals(Triple(qual.origin, null, false), services.auth.completed.single())
        assertTrue(vm.state.finished)
        assertEquals(SampleData.PROD, services.registry.state.value.activeId)
        assertTrue(services.sessions.session(SampleData.QUAL)!!.auth.value is AuthState.SignedIn)
    }

    @Test fun `sign in again stays usable when the probe fails`() {
        val services = TestServices(3)
        val qual = services.registry.state.value.byId(SampleData.QUAL)!!
        services.auth.check = { ServerCheck.Unreachable(qual.origin, ApiOutcome.Failure(502, FailureKind.SERVER)) }
        val vm = vm(services, SignInMode.REAUTH, fixedOrigin = qual.origin)
        assertEquals(ProblemKind.UNREACHABLE, vm.state.problem?.kind)
        assertTrue(vm.state.localOnly)
        assertTrue(vm.state.localExpanded)
        assertNull(vm.state.busy)
    }
}
