package tools.obli.obliance.notifications

import android.app.NotificationManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.auth.AuthState
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerId
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * S84 and the S04 permission / battery dialogs over the design doc §4 data
 * (Karim, three servers, 03:20 on 25 September), French. Recorded under
 * build/outputs/roborazzi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class NotificationSettingsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private val paris = ZoneId.of("Europe/Paris")
    private val checkedAt = Instant.parse("2026-09-25T01:20:00Z").toEpochMilli()
    private val unreachableSince = Instant.parse("2026-09-25T01:02:00Z").toEpochMilli()

    private val state = NotificationState(
        servers = mapOf(
            SampleData.PROD.value to ServerNotifState(lastPass = LastPass(checkedAt, PassResult.OK), knownTenants = mapOf(1L to "Default", 4L to "ACME"), lastCriticalUnread = 2),
            SampleData.DEV.value to ServerNotifState(lastPass = LastPass(checkedAt, PassResult.OK), knownTenants = mapOf(1L to "Default")),
            SampleData.QUAL.value to ServerNotifState(
                lastPass = LastPass(checkedAt, PassResult.UNREACHABLE, since = unreachableSince),
                knownTenants = mapOf(1L to "Default"),
                inOnCall = false,
            ),
        ),
        onCall = OnCallSettings(enabled = true),
    )

    private fun channels(ids: List<ServerId>): Map<String, ChannelInfo> = ids.flatMap { id ->
        listOf(
            NotifChannel.CRITICAL.id(id) to ChannelInfo(NotificationManager.IMPORTANCE_HIGH, sound = true, vibrate = true, bypassDnd = id == SampleData.PROD),
            NotifChannel.ATTENTION.id(id) to ChannelInfo(NotificationManager.IMPORTANCE_DEFAULT, sound = true, vibrate = false, bypassDnd = false),
            NotifChannel.RECOVERY.id(id) to ChannelInfo(NotificationManager.IMPORTANCE_LOW, sound = false, vibrate = false, bypassDnd = false),
            NotifChannel.ESCALATIONS.id(id) to ChannelInfo(NotificationManager.IMPORTANCE_HIGH, sound = true, vibrate = true, bypassDnd = false),
            NotifChannel.ENROLMENTS.id(id) to ChannelInfo(NotificationManager.IMPORTANCE_DEFAULT, sound = false, vibrate = true, bypassDnd = false),
            NotifChannel.ACCOUNT.id(id) to ChannelInfo(NotificationManager.IMPORTANCE_DEFAULT, sound = true, vibrate = false, bypassDnd = false),
        )
    }.toMap()

    private fun ui(serverCount: Int, granted: Boolean = true, battery: Boolean = true): SettingsUi {
        val services = SampleObliServices(serverCount)
        if (serverCount >= 3) runBlocking { services.registry.setNotify(SampleData.QUAL, NotifyScope.CRITICAL_ONLY) }
        val registry = services.registry.state.value
        val ids = registry.profiles.map { it.id }
        val auth = ids.associateWith { AuthState.SignedIn(SampleData.probe(it)) as AuthState }
        val env = EnvSnapshot(permissionGranted = granted, notificationsEnabled = true, batteryIgnored = battery, channels = channels(ids))
        return SettingsMapper.map(registry, auth, state.copy(servers = state.servers.filterKeys { k -> ids.any { it.value == k } }), env, paris)
    }

    private fun capture(name: String, content: @Composable () -> Unit) {
        compose.setContent { ObliTheme { content() } }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    @Test fun threeServers() = capture("notifications_s84_three_servers.png") {
        NotificationSettingsContent(ui(3), SettingsActions())
    }

    @Test fun threeServersPerServerCards() = capture("notifications_s84_three_servers_cards.png") {
        NotificationSettingsContent(ui(3), SettingsActions(), rememberScrollState(3_000))
    }

    @Test fun threeServersCategoriesAndDiagnostic() = capture("notifications_s84_three_servers_bottom.png") {
        NotificationSettingsContent(ui(3), SettingsActions(), rememberScrollState(100_000))
    }

    @Test fun singleServer() = capture("notifications_s84_single_server.png") {
        NotificationSettingsContent(ui(1), SettingsActions())
    }

    @Test fun singleServerBottom() = capture("notifications_s84_single_server_bottom.png") {
        NotificationSettingsContent(ui(1), SettingsActions(), rememberScrollState(100_000))
    }

    @Test fun permissionDenied() = capture("notifications_s84_permission_denied.png") {
        NotificationSettingsContent(ui(3, granted = false, battery = false), SettingsActions())
    }

    @Test fun permissionDialog() = capture("notifications_permission_dialog.png") {
        DialogOver { PermissionRationaleContent(onAllow = {}, onLater = {}) }
    }

    @Test fun batteryDialog() = capture("notifications_battery_dialog.png") {
        DialogOver { BatteryRationaleContent(onAllow = {}, onLater = {}) }
    }

    @Test fun publicEntryPoint() {
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(LocalObliServices provides SampleObliServices()) {
                    NotificationSettingsScreen(onBack = {}, onOpenServers = {})
                }
            }
        }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot("notifications_s84_entry_point.png"))
    }

    @Composable
    private fun DialogOver(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize()) {
            NotificationSettingsContent(ui(3), SettingsActions())
            Box(Modifier.fillMaxSize().background(ObliTheme.colors.bg.copy(alpha = 0.7f)))
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { content() }
        }
    }
}
