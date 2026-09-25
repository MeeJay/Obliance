package tools.obli.obliance.access

import java.util.TimeZone
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.auth.AuthState
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerColor
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.api.TwoFactorMethod
import tools.obli.obliance.api.TwoFactorMethods
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * Screenshots of the access screens over design doc §4 data (Obliance Prod /
 * Dev / Qual, tenants Default and ACME), French locale, phone 390 × 844 dp
 * (tablet 1280 × 800 where the layout differs). Recorded under
 * build/outputs/roborazzi.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class AccessScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val prodOrigin = "https://obliance-prod.example.org"
    private val devOrigin = "https://obliance-dev.example.org"

    @Before fun setUp() {
        TimeZone.setDefault(TimeZone.getTimeZone("Europe/Paris"))
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After fun tearDown() = Dispatchers.resetMain()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun capture(name: String, services: ObliServices = SampleObliServices(), content: @Composable () -> Unit) {
        compose.setContent { ObliTheme { CompositionLocalProvider(LocalObliServices provides services) { content() } } }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    /** Full-screen content on the app background (the sheets are captured at their own height). */
    @Composable
    private fun Screen(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(ObliTheme.colors.bg)) { content() }
    }

    private val prodProbe = ProbeInfo(prodOrigin, "5.1.110", offersSso = true, obligateHost = "id.example.org")

    private fun first(step: SignInStep, change: SignInUiState.() -> SignInUiState = { this }) =
        SignInUiState(SignInMode.FIRST, step, address = "obliance-prod.example.org").change()

    // ---- S01 -------------------------------------------------------------------------------

    @Test fun signInAddress() = capture("access_signin_address.png", SampleObliServices(1)) {
        SignInLayout(SignInUiState(SignInMode.FIRST, SignInStep.ADDRESS), SignInActions.None)
    }

    @Test fun signInAddressError() = capture("access_signin_address_error.png", SampleObliServices(1)) {
        SignInLayout(first(SignInStep.ADDRESS) { copy(address = "http://obliance-prod.example.org", problem = SignInProblem(ProblemKind.ADDRESS_NOT_HTTPS)) }, SignInActions.None)
    }

    @Test fun signInMethod() = capture("access_signin_method.png", SampleObliServices(1)) {
        SignInLayout(first(SignInStep.METHOD) { copy(probe = prodProbe) }, SignInActions.None)
    }

    @Test fun signInLocalOpen() = capture("access_signin_local_error.png", SampleObliServices(1)) {
        SignInLayout(
            first(SignInStep.METHOD) {
                copy(probe = prodProbe, localExpanded = true, username = "karim.benali", password = "motdepasse", problem = SignInProblem(ProblemKind.CREDENTIALS))
            },
            SignInActions.None,
        )
    }

    @Test fun signInLocalOnly() = capture("access_signin_obligate_unreachable.png", SampleObliServices(1)) {
        SignInLayout(
            first(SignInStep.METHOD) {
                copy(probe = ProbeInfo(prodOrigin, "5.1.110", offersSso = false, obligateUnreachable = true, obligateHost = "id.example.org"), localExpanded = true)
            },
            SignInActions.None,
        )
    }

    @Test fun signInSsoFailed() = capture("access_signin_sso_failed.png", SampleObliServices(1)) {
        SignInLayout(first(SignInStep.METHOD) { copy(probe = prodProbe, localExpanded = true, problem = SignInProblem(ProblemKind.SSO_FAILED)) }, SignInActions.None)
    }

    @Test fun signInTwoFactor() = capture("access_signin_2fa.png", SampleObliServices(1)) {
        SignInLayout(
            first(SignInStep.TWO_FACTOR) {
                copy(probe = prodProbe, twoFactor = TwoFactorUi(TwoFactorMethods(totp = true, email = true), TwoFactorMethod.TOTP, code = ""))
            },
            SignInActions.None,
            clipboard = ClipboardAccess(true) { "482913" },
        )
    }

    @Test fun signInTwoFactorRefused() = capture("access_signin_2fa_refused.png", SampleObliServices(1)) {
        SignInLayout(
            first(SignInStep.TWO_FACTOR) {
                copy(
                    probe = prodProbe,
                    twoFactor = TwoFactorUi(TwoFactorMethods(email = true), TwoFactorMethod.EMAIL, code = "4829", resent = true),
                    problem = SignInProblem(ProblemKind.CODE),
                )
            },
            SignInActions.None,
        )
    }

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun signInTablet() = capture("access_signin_tablet.png", SampleObliServices(1)) {
        SignInLayout(first(SignInStep.METHOD) { copy(probe = prodProbe) }, SignInActions.None)
    }

    // ---- S02 -------------------------------------------------------------------------------

    @Test fun ssoFrame() = capture("access_sso_sheet_chrome.png", SampleObliServices(1)) {
        Screen { SsoFrame(host = "id.example.org", progress = 40, onCancel = {}) {} }
    }

    // ---- S93 -------------------------------------------------------------------------------

    private fun add(step: SignInStep, change: SignInUiState.() -> SignInUiState = { this }) =
        SignInUiState(SignInMode.ADD, step, address = "obliance-dev.example.org", serverCount = 3, color = ServerColor.TEAL).change()

    @Test fun addServerAddress() = capture("access_add_server_address.png") {
        AddServerLayout(add(SignInStep.ADDRESS) { copy(address = "") }, SignInActions.None, onBack = {})
    }

    @Test fun addServerExisting() = capture("access_add_server_existing.png") {
        AddServerLayout(
            add(SignInStep.ADDRESS) { copy(address = "obliance-prod.example.org", problem = SignInProblem(ProblemKind.ALREADY_CONFIGURED, "Obliance Prod")) },
            SignInActions.None,
            onBack = {},
        )
    }

    @Test fun addServerMethod() = capture("access_add_server.png") {
        AddServerLayout(
            add(SignInStep.METHOD) {
                copy(probe = ProbeInfo(devOrigin, "5.1.108", offersSso = true, obligateHost = "id.example.org", obligateSessionKnown = true), displayName = "Obliance Dev")
            },
            SignInActions.None,
            onBack = {},
        )
    }

    @Test fun addServerAdded() = capture("access_add_server_added.png") {
        val dev = SampleData.profiles[1]
        AddServerLayout(add(SignInStep.ADDED) { copy(added = AddedServer(dev, "Obliance Prod")) }, SignInActions.None, onBack = {})
    }

    // ---- S92 -------------------------------------------------------------------------------

    @Test fun servers() = capture("access_servers.png") {
        ServersScreen(onAddServer = {}, onBack = {})
    }

    @Test fun serversExpanded() {
        val services = SampleObliServices()
        services.sessions.session(SampleData.QUAL)!!.markExpired()
        val registry = services.registry.state.value.let { s ->
            s.copy(profiles = s.profiles.map { if (it.id == SampleData.QUAL) it.copy(notify = NotifyScope.CRITICAL_ONLY) else it })
        }
        val auth = registry.profiles.associate { it.id to services.sessions.session(it.id)!!.auth.value }
        val cards = ServerCardUi.build(
            registry,
            auth,
            ConnectionState.CONNECTED,
            services.alerts.snapshot.value,
            mapOf(SampleData.PROD to "5.1.110", SampleData.DEV to "5.1.108", SampleData.QUAL to "5.0.94"),
        )
        capture("access_servers_expanded.png", services) {
            ServersBody(cards, expanded = SampleData.QUAL, busy = emptySet(), actions = ServersActions.None, onAddServer = {}, onBack = {})
        }
    }

    @Test fun serversSingle() {
        val services = SampleObliServices(1)
        val registry = services.registry.state.value
        val auth = registry.profiles.associate { it.id to services.sessions.session(it.id)!!.auth.value }
        val cards = ServerCardUi.build(registry, auth, ConnectionState.CONNECTED, services.alerts.snapshot.value, mapOf(SampleData.PROD to "5.1.110"))
        capture("access_servers_single.png", services) {
            ServersBody(cards, expanded = SampleData.PROD, busy = emptySet(), actions = ServersActions.None, onAddServer = {}, onBack = {})
        }
    }

    @Test fun removeDialog() {
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(LocalObliServices provides SampleObliServices()) {
                    Screen { RemoveServerDialog(SampleData.profiles[2], onConfirm = {}, onDismiss = {}) }
                }
            }
        }
        compose.waitForIdle()
        captureScreenRoboImage(shot("access_servers_remove_confirm.png"))
    }

    // ---- S81 -------------------------------------------------------------------------------

    @Test fun scopeSheet() = capture("access_scope_sheet.png") {
        ScopeSheetContent(onDone = {}, onManageServers = {})
    }

    @Test fun scopeSheetSingle() = capture("access_scope_sheet_single.png", SampleObliServices(1)) {
        ScopeSheetContent(onDone = {}, onManageServers = {})
    }

    @Test fun scopeSheetStates() {
        val services = SampleObliServices()
        services.sessions.session(SampleData.QUAL)!!.markExpired()
        val registry = services.registry.state.value
        val auth = registry.profiles.associate { p ->
            p.id to if (p.id == SampleData.DEV) AuthState.Unreachable(1_790_298_120_000L) else services.sessions.session(p.id)!!.auth.value
        }
        val alerts = services.alerts.snapshot.value.let { s ->
            s.copy(feeds = s.feeds.map { if (it.serverId == SampleData.QUAL) it.copy(status = FeedStatus.EXPIRED) else it })
        }
        val ui = ScopeUi.build(registry, auth, ConnectionState.RECONNECTING, alerts, services.tenants.scope.value)
        capture("access_scope_sheet_states.png", services) {
            ScopeSheetBody(ui, switchingTo = "ACME", problem = null, onServer = {}, onTenant = {}, onRetryTenants = {}, onManageServers = {})
        }
    }

    // ---- S03 -------------------------------------------------------------------------------

    @Test fun reauth() {
        val services = SampleObliServices()
        services.sessions.session(SampleData.QUAL)!!.markExpired()
        capture("access_reauth.png", services) { ReauthContent(SampleData.QUAL, onDone = {}) }
    }

    @Test fun reauthSignedOutSingle() = capture("access_reauth_signed_out.png", SampleObliServices(1)) {
        val prod = SampleData.profiles[0]
        ReauthBody(
            profile = prod,
            multiServer = false,
            signedOut = true,
            state = SignInUiState(SignInMode.REAUTH, SignInStep.METHOD, address = "obliance-prod.example.org", probe = prodProbe, localExpanded = true),
            actions = SignInActions.None,
            onLater = {},
        )
    }
}
