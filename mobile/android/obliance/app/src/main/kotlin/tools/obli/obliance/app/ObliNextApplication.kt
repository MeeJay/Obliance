package tools.obli.obliance.app

import android.app.Application
import kotlinx.coroutines.flow.StateFlow
import tools.obli.obliance.data.ObliServices

/**
 * What [MainActivity] takes from its Application: the services and whether the
 * server registry is loaded. The app provides [AppGraph]; the Robolectric
 * shell tests provide real repositories over fake servers.
 */
interface ObliServicesHost {
    val services: ObliServices

    /** True once the registry is loaded (before that, the UI shows the bare background). */
    val ready: StateFlow<Boolean>
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
    }
}
