package tools.obli.obliance.app

import android.app.Application
import android.content.Intent
import kotlinx.coroutines.flow.StateFlow
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.more.AppLock
import tools.obli.obliance.more.AppSettings
import tools.obli.obliance.more.AppUpdates
import tools.obli.obliance.notifications.NotificationRoute
import tools.obli.obliance.notifications.ObliNotifications

/**
 * What [MainActivity] takes from its Application: the services and whether the
 * server registry is loaded. The app provides [AppGraph]; the Robolectric
 * shell tests provide real repositories over fake servers.
 */
interface ObliServicesHost {
    val services: ObliServices

    /** True once the registry is loaded (before that, the UI shows the bare background). */
    val ready: StateFlow<Boolean>

    /**
     * The route of a tapped notification carried by [intent] (read and removed),
     * or null. Called once [ready]: the route names a server of the registry.
     * The shell tests replace it (the notification engine is not installed there).
     */
    fun routeFrom(intent: Intent?): NotificationRoute? = ObliNotifications.routeFrom(intent)
}

class ObliNextApplication : Application(), ObliServicesHost {
    lateinit var graph: AppGraph
        private set

    override val services: ObliServices get() = graph.services
    override val ready: StateFlow<Boolean> get() = graph.ready

    override fun onCreate() {
        super.onCreate()
        // CookieManager (inside AndroidWebCookies) is created here, on the main thread.
        graph = AppGraph(this)
        graph.start()
        // S00 lock (S83 choice, process lifecycle): before any activity.
        AppLock.install(this, AppSettings.store(this))
        // Background notifications of every server (worker, channels, tile, actions).
        ObliNotifications.install(this, graph.services, graph.ready, launchIntent = { Intent(it, MainActivity::class.java) })
        // S86: at most once per 24 h, once a server is signed in.
        graph.whenReady { AppUpdates.checkIfDue(this, graph.services) }
    }
}
