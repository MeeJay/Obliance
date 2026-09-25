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
