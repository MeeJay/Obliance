package tools.obli.obliance.app

import android.content.Intent
import android.os.Bundle
import android.service.quicksettings.TileService
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliTheme
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.more.AppLockGate
import tools.obli.obliance.more.AppSettings
import tools.obli.obliance.more.SecureWindow
import tools.obli.obliance.more.rememberAppTheme
import tools.obli.obliance.notifications.NotificationRoute
import tools.obli.obliance.remote.RemoteSessionService

/**
 * A FragmentActivity so the action host can show BiometricPrompt (T2/T3, design
 * doc §7.6) and the S00 lock its unlock prompt.
 *
 * Intents it takes (singleTask: while the app runs they arrive in [onNewIntent]):
 * the sessions notification (resume a remote session), an alert notification
 * (a [NotificationRoute], held until the S00 lock has passed) and the long
 * press on the « Astreinte » Quick Settings tile (S84).
 */
class MainActivity : FragmentActivity() {
    /** Remote session to resume, from a tap on the sessions notification (design doc §2.6). */
    private val resumeSession = MutableStateFlow<String?>(null)

    /** Where a tapped alert notification leads; cleared by the shell once handled. */
    private val route = MutableStateFlow<NotificationRoute?>(null)

    /** The Quick Settings tile was long-pressed: open S84. */
    private val notificationSettings = MutableStateFlow(false)

    private val host: ObliServicesHost get() = application as ObliServicesHost

    override fun onCreate(savedInstanceState: Bundle?) {
        // Dark only: light icons on transparent system bars.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        val host = host
        val settings = AppSettings.store(this)
        // A recreation (rotation) keeps the original intent: only a fresh start takes from it.
        if (savedInstanceState == null) {
            takeResume(intent)
            takeRoute(intent)
        }
        setContent {
            val ready by host.ready.collectAsStateWithLifecycle()
            val resume by resumeSession.collectAsStateWithLifecycle()
            val pendingRoute by route.collectAsStateWithLifecycle()
            val openNotificationSettings by notificationSettings.collectAsStateWithLifecycle()
            val prefs by settings.prefs.collectAsStateWithLifecycle()
            // S83 « Bloquer les captures d'écran partout »: outside the gate, so the S00 screen is covered too.
            SecureWindow(prefs.blockScreenshots)
            // The active server's web theme, resolved with the S83 choice (Operator / Nuit, Nuit automatique 22:00–07:00).
            ObliTheme(variant = rememberAppTheme(rememberActiveServerTheme(host.services))) {
                CompositionLocalProvider(LocalObliServices provides host.services) {
                    // S00: nothing of the app is composed while locked; a pending route opens after the unlock.
                    AppLockGate(reason = routeLockReason(pendingRoute)) {
                        ObliNextApp(
                            ready = ready,
                            resumeSessionId = resume,
                            onResumeHandled = { resumeSession.value = null },
                            route = pendingRoute,
                            onRouteHandled = { route.value = null },
                            openNotificationSettings = openNotificationSettings,
                            onNotificationSettingsOpened = { notificationSettings.value = false },
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        takeResume(intent)
        takeRoute(intent)
    }

    /** Takes the session id out of the intent, so a recreation does not resume it again. */
    private fun takeResume(intent: Intent?) {
        val id = intent?.getStringExtra(RemoteSessionService.EXTRA_SESSION_ID) ?: return
        intent.removeExtra(RemoteSessionService.EXTRA_SESSION_ID)
        resumeSession.value = id
    }

    /**
     * The Quick Settings tile preferences, or the route of an alert notification.
     * The route is read once the registry is loaded (it must name a configured
     * server) and removed from the intent, so a recreation does not replay it.
     */
    private fun takeRoute(intent: Intent?) {
        if (intent == null) return
        if (intent.action == TileService.ACTION_QS_TILE_PREFERENCES) {
            notificationSettings.value = true
            return
        }
        lifecycleScope.launch {
            host.ready.first { it }
            host.routeFrom(intent)?.let { route.value = it }
        }
    }
}

/**
 * The S00 subtitle while a route waits behind the lock: « Déverrouillez pour
 * ouvrir les processus de PC-COMPTA-03 ». Null without a route.
 */
@Composable
internal fun routeLockReason(route: NotificationRoute?): String? {
    if (route == null) return null
    val services = LocalObliServices.current
    val registry by services.registry.state.collectAsStateWithLifecycle()
    val serverName = registry.byId(route.serverId)?.displayName.orEmpty()
    val target = when (route) {
        is NotificationRoute.Device -> {
            val name = route.label?.takeIf { it.isNotBlank() } ?: stringResource(R.string.app_device_fallback, route.deviceId)
            when (route.tab) {
                "services" -> stringResource(R.string.app_route_tab_services, name)
                "processes" -> stringResource(R.string.app_route_tab_processes, name)
                "tasks" -> stringResource(R.string.app_route_tab_tasks, name)
                else -> name
            }
        }
        is NotificationRoute.Path -> stringResource(R.string.app_route_page, serverName)
        is NotificationRoute.Approval -> stringResource(R.string.app_route_approval)
        is NotificationRoute.Enrolment ->
            stringResource(R.string.app_route_enrolment, route.label?.takeIf { it.isNotBlank() } ?: stringResource(R.string.app_device_fallback, route.deviceId))
        is NotificationRoute.Enrolments -> stringResource(R.string.app_route_enrolments)
        is NotificationRoute.Approvals -> stringResource(R.string.app_route_approvals)
        is NotificationRoute.Inbox -> stringResource(R.string.app_route_inbox)
        is NotificationRoute.SignIn -> stringResource(R.string.app_route_sign_in, serverName)
    }
    return stringResource(R.string.app_unlock_to_open, target)
}
