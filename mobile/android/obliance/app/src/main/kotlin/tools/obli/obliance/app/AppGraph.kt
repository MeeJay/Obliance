package tools.obli.obliance.app

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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

    fun start() {
        scope.launch {
            registry.load()
            defaultServices.start()
            _ready.value = true
        }
    }

    companion object {
        /** The server sees the app like the WebView shell, with the native marker. */
        val USER_AGENT = "Mozilla/5.0 (Linux; Android ${android.os.Build.VERSION.RELEASE}) ObliApp/${BuildConfig.VERSION_NAME} (obliance; Android)"
    }
}
