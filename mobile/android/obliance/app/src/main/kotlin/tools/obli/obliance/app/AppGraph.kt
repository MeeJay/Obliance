package tools.obli.obliance.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.data.AndroidWebCookies
import tools.obli.core.data.DataStoreServerRegistryStore
import tools.obli.core.network.ObliHttp
import tools.obli.core.network.WebCookieJar
import tools.obli.core.realtime.SocketIoRealtimeClient
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.DefaultObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.remote.RemoteAccess

/**
 * The manual dependency graph of the application (design doc §10.3): ONE
 * OkHttp client (shared cookie jar = the WebView CookieManager), the persisted
 * server registry, one session per server with its Socket.IO client, the
 * repositories, and the transport of the remote-access tunnels. Built once in [ObliNextApplication].
 *
 * The process also starts in the background (notification worker every 15
 * minutes, a notification action, the Quick Settings tile): [foreground]
 * follows the process lifecycle so the socket only opens while an activity is
 * visible (DefaultObliServices.start).
 */
class AppGraph(context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val cookieJar = WebCookieJar(AndroidWebCookies())
    val client: OkHttpClient = ObliHttp.defaultClient(cookieJar, USER_AGENT)
    val registry = ServerRegistry(DataStoreServerRegistryStore(context)).apply {
        // A removed server leaves no session cookie behind (design doc §2.10).
        addRemovalListener { profile -> cookieJar.clearOrigin(profile.origin) }
    }

    val sessions = ServerSessions(
        registry,
        { profile, profileNow ->
            ServerSession(
                id = profile.id,
                profileNow = profileNow,
                http = ObliHttp(profile.origin, client),
                realtimeFactory = { session ->
                    val origin = session.profile.origin
                    SocketIoRealtimeClient(origin, client, { cookieJar.headerFor(origin) }, USER_AGENT, ObliEvents.LISTENED)
                },
            )
        },
        scope,
    )

    init {
        // Terminal and ObliReach tunnels: the same client, user agent and cookie session (design doc §10.4).
        RemoteAccess.configure(client, USER_AGENT, cookieJar::headerFor)
    }

    private val defaultServices = DefaultObliServices(
        registry = registry,
        sessions = sessions,
        httpFor = { origin -> ObliHttp(origin, client) },
        clearCookies = cookieJar::clearOrigin,
        scope = scope,
    )
    val services: ObliServices get() = defaultServices

    private val _ready = MutableStateFlow(false)

    /** True once the registry is loaded (before that, the UI shows the bare background). */
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    private val _foreground = MutableStateFlow(false)

    /** True between ProcessLifecycleOwner ON_START and ON_STOP (an activity of the app is visible). */
    val foreground: StateFlow<Boolean> = _foreground.asStateFlow()

    /** Call once, from Application.onCreate (main thread). */
    fun start() {
        if (Looper.myLooper() == Looper.getMainLooper()) observeForeground() else Handler(Looper.getMainLooper()).post(::observeForeground)
        scope.launch {
            registry.load()
            defaultServices.start(foreground)
            _ready.value = true
        }
    }

    /** Runs [block] in the application scope once the registry is loaded. */
    fun whenReady(block: suspend () -> Unit) {
        scope.launch {
            ready.first { it }
            block()
        }
    }

    /** ProcessLifecycleOwner observers must be added on the main thread. */
    private fun observeForeground() {
        val lifecycle = ProcessLifecycleOwner.get().lifecycle
        _foreground.value = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    _foreground.value = true
                }

                override fun onStop(owner: LifecycleOwner) {
                    _foreground.value = false
                }
            },
        )
    }

    companion object {
        /** The server sees the app like the WebView shell, with the native marker. */
        val USER_AGENT = "Mozilla/5.0 (Linux; Android ${android.os.Build.VERSION.RELEASE}) ObliApp/${BuildConfig.VERSION_NAME} (obliance; Android)"
    }
}
