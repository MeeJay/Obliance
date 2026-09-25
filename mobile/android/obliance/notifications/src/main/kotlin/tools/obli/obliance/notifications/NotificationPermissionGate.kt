package tools.obli.obliance.notifications

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices

/**
 * S04 steps 1-2 (design doc §5 S04), once at least one server is signed in:
 * on Android 13+, when POST_NOTIFICATIONS was never asked under THIS module's
 * key, a rationale dialog « Autoriser les notifications » [Autoriser] [Plus
 * tard]; after a grant, when Android still optimises the app's battery, «
 * Autoriser Obliance à fonctionner en arrière-plan ». Both count as asked
 * whatever the answer: a refusal is never asked again automatically (S84
 * offers it). [next] (S04 step 3, the app lock of `:obliance:more`) is
 * composed only once a server is signed in and nothing of steps 1-2 is shown
 * or waiting (the system permission dialog included), so the steps never
 * overlap. Place it once at the root of the signed-in app.
 */
@Composable
fun NotificationPermissionGate(next: @Composable () -> Unit = {}) {
    val services = LocalObliServices.current
    val signedIn by remember(services) { anySignedIn(services) }.collectAsStateWithLifecycle(initialValue = false)
    if (!signedIn) return
    val runtime = ObliNotifications.runtime
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || LocalInspectionMode.current || runtime == null) {
        next()
        return
    }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by runtime.store.state.collectAsStateWithLifecycle(initialValue = null)
    var requested by rememberSaveable { mutableStateOf(false) }
    var battery by rememberSaveable { mutableStateOf(false) }
    /** The system permission dialog is open: step 3 waits for its answer. */
    var awaiting by rememberSaveable { mutableStateOf(false) }

    fun markAsked(permission: Boolean = false, batteryShown: Boolean = false) {
        scope.launch(Dispatchers.Default) {
            runtime.store.update { it.copy(permissionAsked = it.permissionAsked || permission, batteryAsked = it.batteryAsked || batteryShown) }
        }
    }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        awaiting = false
        if (granted) {
            ObliNotifications.sync(context)
            if (!ObliNotifications.ignoringBatteryOptimizations(context) && state?.batteryAsked != true) battery = true
        }
    }

    val st = state ?: return
    val granted = AndroidNotificationPublisher.permissionGranted(context)
    if (!requested && !granted && !st.permissionAsked) {
        Dialog(onDismissRequest = { requested = true; markAsked(permission = true) }) {
            PermissionRationaleContent(
                onAllow = {
                    requested = true
                    awaiting = true
                    markAsked(permission = true)
                    launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                },
                onLater = { requested = true; markAsked(permission = true) },
            )
        }
        return
    }
    if (battery) {
        Dialog(onDismissRequest = { battery = false; markAsked(batteryShown = true) }) {
            BatteryRationaleContent(
                onAllow = {
                    battery = false
                    markAsked(batteryShown = true)
                    SystemSettings.ignoreBatteryOptimizations(context)
                },
                onLater = { battery = false; markAsked(batteryShown = true) },
            )
        }
        return
    }
    if (!awaiting) next()
}

/** « Autoriser les notifications » (S04 step 1). */
@Composable
internal fun PermissionRationaleContent(onAllow: () -> Unit, onLater: () -> Unit) {
    NotifDialogCard(
        icon = NotifIcons.Bell,
        title = stringResource(R.string.notif_perm_title),
        body = stringResource(R.string.notif_perm_body),
        confirm = stringResource(R.string.notif_allow),
        dismiss = stringResource(R.string.notif_later),
        onConfirm = onAllow,
        onDismiss = onLater,
    )
}

/** « Autoriser Obliance à fonctionner en arrière-plan » (S04 step 2). */
@Composable
internal fun BatteryRationaleContent(onAllow: () -> Unit, onLater: () -> Unit) {
    NotifDialogCard(
        icon = NotifIcons.BatteryCharging,
        title = stringResource(R.string.notif_battery_title),
        body = stringResource(R.string.notif_battery_body),
        confirm = stringResource(R.string.notif_allow),
        dismiss = stringResource(R.string.notif_later),
        onConfirm = onAllow,
        onDismiss = onLater,
    )
}

/**
 * "Astreinte active · 19:00–08:00" / "Astreinte désactivée" (S83 row, S80),
 * or null when the engine is not installed.
 */
@Composable
fun rememberOnCallSummary(): String? {
    val flow: Flow<NotificationState?> = remember { ObliNotifications.runtime?.store?.state ?: flowOf(null) }
    val state by flow.collectAsStateWithLifecycle(initialValue = null)
    val onCall = state?.onCall ?: return null
    return if (onCall.enabled) {
        stringResource(R.string.notif_oncall_summary_active, ObliNotifications.minutes(onCall.startMinute), ObliNotifications.minutes(onCall.endMinute))
    } else {
        stringResource(R.string.notif_oncall_summary_off)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
private fun anySignedIn(services: ObliServices): Flow<Boolean> = services.registry.state.flatMapLatest { st ->
    val flows = st.profiles.mapNotNull { services.sessions.session(it.id)?.auth }
    if (flows.isEmpty()) flowOf(false) else combine(flows) { states -> states.any { it is AuthState.SignedIn } }
}
