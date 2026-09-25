package tools.obli.obliance.more

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.designsystem.ObliTheme
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * Screenshots of S80 over the design doc §4 data (Karim on Obliance Prod,
 * Default, three servers), French locale. Recorded under build/outputs/roborazzi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class MoreScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun capture(name: String, services: ObliServices = SampleObliServices(), content: @Composable () -> Unit) {
        compose.setContent { ObliTheme { CompositionLocalProvider(LocalObliServices provides services) { content() } } }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    @Test fun more() = capture("more_phone.png") { MoreRoute(onOpenServers = {}, onOpenScope = {}, appVersion = FALLBACK_APP_VERSION) }

    @Test fun publicEntryPoint() = capture("more_phone_entry_point.png") { MoreScreen(onOpenServers = {}, onOpenScope = {}) }

    @Test fun singleServerLocalAccount() {
        val services = SampleObliServices(serverCount = 1)
        val registry = ServerRegistryState(listOf(SampleData.profiles[2].copy(order = 0)), SampleData.QUAL)
        val ui = MoreMapper.map(
            registry,
            AuthState.SignedIn(SampleData.probe(SampleData.QUAL)),
            TenantScope(SampleData.QUAL, SampleData.tenants.take(1), SampleData.DEFAULT_TENANT),
        )
        capture("more_phone_single_server.png", services) { MoreContent(ui, FALLBACK_APP_VERSION, MoreActions()) }
    }

    @Test fun sessionExpired() {
        val base = SampleObliServices()
        val ui = MoreMapper.map(base.registry.state.value, AuthState.Expired, base.tenants.scope.value)
        capture("more_phone_expired.png", base) { MoreContent(ui, FALLBACK_APP_VERSION, MoreActions()) }
    }

    @Test fun signOutConfirmation() {
        val base = SampleObliServices()
        val ui = MoreMapper.map(base.registry.state.value, AuthState.SignedIn(SampleData.probe(SampleData.PROD)), base.tenants.scope.value)
        capture("more_phone_sign_out_confirm.png", base) { SignOutOver(ui) }
    }

    @Composable
    private fun SignOutOver(ui: MoreUi) {
        Box(Modifier.fillMaxSize()) {
            MoreContent(ui, FALLBACK_APP_VERSION, MoreActions())
            Box(Modifier.fillMaxSize().background(ObliTheme.colors.bg.copy(alpha = 0.6f)))
            Box(Modifier.align(Alignment.BottomCenter)) {
                SignOutConfirmContent(SignOutConfirm(SampleData.PROD, "Obliance Prod"), multiServer = true, onConfirm = {}, onDismiss = {})
            }
        }
    }

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun tablet() = capture("more_tablet.png") { MoreRoute(onOpenServers = {}, onOpenScope = {}, appVersion = FALLBACK_APP_VERSION) }
}
