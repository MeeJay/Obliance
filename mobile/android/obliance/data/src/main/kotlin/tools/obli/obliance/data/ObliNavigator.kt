package tools.obli.obliance.data

import androidx.compose.runtime.staticCompositionLocalOf
import tools.obli.core.model.ServerId

/**
 * Navigation requests a screen module may make without knowing the shell
 * (see obliance/CONTRACT.md §3). Provided by :obliance:app through
 * [LocalObliNavigator]; the default (previews, screenshot tests) does nothing.
 */
interface ObliNavigator {
    /**
     * S90: opens [path] (same-origin, starting with "/", e.g. "/admin/users")
     * of the ACTIVE server in the web view, pushed on the current destination
     * (full screen on phones). [title] is the native top bar's title.
     */
    fun openWeb(path: String, title: String)

    /** S30 of [deviceId] on [serverId] (implicit server switch with "Revenir", §2.10). */
    fun openDevice(serverId: ServerId, deviceId: Long)

    object None : ObliNavigator {
        override fun openWeb(path: String, title: String) = Unit
        override fun openDevice(serverId: ServerId, deviceId: Long) = Unit
    }
}

val LocalObliNavigator = staticCompositionLocalOf<ObliNavigator> { ObliNavigator.None }
