package tools.obli.obliance.app

import androidx.annotation.StringRes
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable
import tools.obli.core.designsystem.ObliIcons

/** Navigation 3 keys of the shell (saved with the back stacks, hence @Serializable). */
@Serializable
sealed interface AppKey : NavKey

@Serializable
data object TriageKey : AppKey

@Serializable
data object DevicesKey : AppKey

@Serializable
data object ActivityKey : AppKey

@Serializable
data object FleetKey : AppKey

@Serializable
data object MoreKey : AppKey

/** S30, pushed on the stack it was opened from (À traiter or Appareils). */
@Serializable
data class DeviceKey(val serverId: String, val deviceId: Long) : AppKey

/** S90: a same-origin page of [serverId] in the web view, pushed on the current destination. */
@Serializable
data class WebKey(val serverId: String, val path: String, val title: String) : AppKey

/*
 * 0.2.0 "Agir": pushed on the CURRENT destination's stack (device flows on the
 * stack of the device detail, usually Appareils; Activité flows on Activité).
 * Full screen on phones; detail pane on wide windows, except ObliReach.
 */

/** S60 terminal: [wtsSessionId] null = SYSTEM; [resumeId] = a live session to resume (pill, notification, Activité). */
@Serializable
data class TerminalKey(
    val serverId: String,
    val deviceId: Long,
    val protocol: String,
    val wtsSessionId: Int? = null,
    val resumeId: String? = null,
) : AppKey

/** S62 ObliReach viewer, always full screen. */
@Serializable
data class ReachKey(val serverId: String, val deviceId: Long) : AppKey

/** S50 script picker; [deviceIds] may be empty (from Activité: targets chosen in S51). */
@Serializable
data class ScriptPickerKey(val serverId: String, val deviceIds: List<Long>) : AppKey

/** S51 run preparation; [rerunOf] = the batch whose failures are re-run. */
@Serializable
data class RunScriptKey(val serverId: String, val scriptId: Long, val deviceIds: List<Long>, val rerunOf: String? = null) : AppKey

/** S52/S53 batch in flight and outputs. */
@Serializable
data class BatchKey(val serverId: String, val batchId: String) : AppKey

/** S57 schedules and S58 scenarios of the active server. */
@Serializable
data object SchedulesKey : AppKey

@Serializable
data object ScenariosKey : AppKey

/** S92 and S93, pushed on the Plus stack. */
@Serializable
data object ServersKey : AppKey

@Serializable
data object AddServerKey : AppKey

/** The 5 destinations of design doc §2.1, in this order; each has its own back stack. */
enum class Destination(val root: AppKey, @param:StringRes val label: Int, val icon: ImageVector) {
    TRIAGE(TriageKey, R.string.app_nav_triage, ObliIcons.Siren),
    DEVICES(DevicesKey, R.string.app_nav_devices, ObliIcons.Monitor),
    ACTIVITY(ActivityKey, R.string.app_nav_activity, ObliIcons.Activity),
    FLEET(FleetKey, R.string.app_nav_fleet, ObliIcons.LayoutDashboard),
    MORE(MoreKey, R.string.app_nav_more, ObliIcons.Menu),
}
