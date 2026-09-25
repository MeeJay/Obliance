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
import tools.obli.core.designsystem.ObliThemeVariant
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

    private fun capture(name: String, services: ObliServices = SampleObliServices(), variant: ObliThemeVariant = ObliThemeVariant.OPERATOR, content: @Composable () -> Unit) {
        compose.setContent { ObliTheme(variant = variant) { CompositionLocalProvider(LocalObliServices provides services) { content() } } }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    @Test fun more() = capture("more_phone.png") { MoreRoute(MoreActions(), appVersion = FALLBACK_APP_VERSION) }

    /** S80 with the 0.3.0 rows: notifications (S84 summary), settings, about with an update offered. */
    @Test fun moreNewRows() = capture("more_phone_new_rows.png") {
        MoreRoute(MoreActions(), appVersion = FALLBACK_APP_VERSION, notificationsSummary = "Astreinte active · 19:00–08:00", updateAvailable = true)
    }

    /** The app's current call (0.2.0 signature) must keep compiling and rendering. */
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
    @Test fun tablet() = capture("more_tablet.png") { MoreRoute(MoreActions(), appVersion = FALLBACK_APP_VERSION) }
}

/** S83, S86 and S00 over the design doc §4 data, French, phone. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class SettingsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun capture(name: String, content: @Composable () -> Unit) {
        compose.setContent { ObliTheme { CompositionLocalProvider(LocalObliServices provides SampleObliServices()) { content() } } }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    private fun settingsUi(serverCount: Int = 3, lockAvailable: Boolean = true, prefs: AppPrefs = AppPrefs()): AppSettingsUi {
        val profiles = SampleData.profiles.take(serverCount).mapIndexed { i, p -> p.copy(order = i) }
        return AppSettingsMapper.map(
            ServerRegistryState(profiles, SampleData.PROD),
            prefs,
            lockAvailable,
            FALLBACK_APP_VERSION,
            mapOf(SampleData.PROD to "5.1.110"),
        )
    }

    @Test fun settingsThreeServers() = capture("more_settings_three_servers.png") {
        AppSettingsContent(settingsUi(prefs = AppPrefs(lockEnabled = true, themeMode = ThemeMode.OPERATOR)), "Astreinte active · 19:00–08:00", AppSettingsActions())
    }

    /** The whole page (Apparence and À propos below the fold of the phone capture). */
    @Config(qualifiers = "fr-rFR-w390dp-h1700dp-xxhdpi")
    @Test fun settingsThreeServersFullPage() = capture("more_settings_three_servers_full.png") {
        AppSettingsContent(settingsUi(prefs = AppPrefs(lockEnabled = true, themeMode = ThemeMode.OPERATOR)), "Astreinte active · 19:00–08:00", AppSettingsActions())
    }

    @Test fun settingsOneServer() = capture("more_settings_one_server.png") {
        AppSettingsContent(settingsUi(serverCount = 1, prefs = AppPrefs(lockTimeout = LockTimeout.ONE_MIN, autoNight = true, blockScreenshots = true)), null, AppSettingsActions())
    }

    @Test fun settingsLockUnavailable() = capture("more_settings_lock_unavailable.png") {
        AppSettingsContent(settingsUi(lockAvailable = false), null, AppSettingsActions())
    }

    private val sampleOffer = UpdateOffer(
        serverId = SampleData.PROD,
        serverName = "Obliance Prod",
        versionName = "0.3.1-alpha",
        versionCode = 4,
        releaseNotes = "- Notifications de fond pour tous les serveurs\n- Enrôlements dans À traiter\n- Réglages de l’application",
        required = false,
        sha256 = "a".repeat(64),
        signerSha256 = "b".repeat(64),
        downloadUrl = "/api/mobile/android/download",
    )

    private fun aboutUi(update: UpdatePanel) = AboutUi(
        appVersionName = FALLBACK_APP_VERSION,
        appVersionCode = FALLBACK_APP_VERSION_CODE,
        multiServer = true,
        servers = listOf(
            AboutServer(SampleData.PROD, "Obliance Prod", SampleData.profiles[0].color, "OP", ServerVersion.Known("5.1.110")),
            AboutServer(SampleData.DEV, "Obliance Dev", SampleData.profiles[1].color, "OD", ServerVersion.Known("5.1.108")),
            AboutServer(SampleData.QUAL, "Obliance Qual", SampleData.profiles[2].color, "OQ", ServerVersion.Unknown),
        ),
        update = update,
    )

    @Test fun aboutNothingPublished() = capture("more_about_nothing_published.png") {
        AboutContent(aboutUi(UpdatePanel.NothingPublished), AboutActions())
    }

    @Test fun aboutOffer() = capture("more_about_offer.png") {
        AboutContent(aboutUi(UpdatePanel.Offer(sampleOffer)), AboutActions())
    }

    @Test fun lockScreenWithReason() = capture("more_lock_screen.png") {
        LockScreen("Déverrouillez pour ouvrir les processus de PC-COMPTA-03", onUnlock = {})
    }
}
