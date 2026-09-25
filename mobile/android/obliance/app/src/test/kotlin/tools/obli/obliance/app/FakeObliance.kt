package tools.obli.obliance.app

import android.app.Application
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.CookieJar
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.auth.ServerRegistryStore
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.model.SessionProbe
import tools.obli.core.network.ObliHttp
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.api.Approval
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.api.LiveMetricsAck
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.data.DefaultObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.shell.alerts.LiveAlert
import tools.obli.shell.nav.Origins

/** Robolectric Application of the shell tests: [MainActivity] reads its services from [host]. */
class ShellTestApplication : Application(), ObliServicesHost {
    lateinit var host: ObliServicesHost

    override val services: ObliServices get() = host.services
    override val ready: StateFlow<Boolean> get() = host.ready
}

/** One fake Obliance server: answers "METHOD /path" (query ignored) and records every request. */
internal class FakeObliServer(private val route: (method: String, path: String) -> Pair<Int, String>?) : AutoCloseable {
    val requests = CopyOnWriteArrayList<String>()
    private val server = MockWebServer()

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val key = "${request.method} ${request.url.encodedPath}"
                requests += key
                val (code, body) = route(request.method, request.url.encodedPath) ?: (404 to """{"success":false,"error":"Not found"}""")
                return MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()
            }
        }
        server.start()
    }

    /** The mock's real origin (http://127.0.0.1:port). */
    val origin: String get() = Origins.of(server.url("/").toString())!!

    override fun close() = server.close()
}

/** Realtime of a fake server: connected, silent. */
internal class FakeRealtime : RealtimeClient {
    override val state: StateFlow<ConnectionState> = MutableStateFlow(ConnectionState.CONNECTED)
    override val events: SharedFlow<RealtimeEvent> = MutableSharedFlow()
    override fun connect() = Unit
    override fun reconnect() = Unit
    override fun disconnect() = Unit
    override fun emit(name: String, payload: JsonElement?) = false
    override suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long): JsonElement? = null
}

/**
 * The PRODUCTION services ([DefaultObliServices]: registry, sessions, repositories,
 * active-server lifecycle) over one fake HTTP server per profile of design doc §4
 * (Obliance Prod active, Obliance Dev, Obliance Qual). The registry keeps the
 * https origins of §4; each session is bound to its own mock, the way the app
 * binds it to its real origin, so a request can only reach that server's mock.
 */
internal class FakeObliance(
    serverCount: Int = 3,
    /** Servers whose `/api/auth/me` answers 401 (session expired). */
    expired: Set<ServerId> = emptySet(),
) : ObliServicesHost, AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val profiles = SampleData.profiles.take(serverCount)
    val servers: Map<ServerId, FakeObliServer> = profiles.associate { it.id to FakeObliServer(routes(it.id, it.id in expired)) }
    private val byOrigin = profiles.associate { it.origin to servers.getValue(it.id) }
    private val client = ObliHttp.defaultClient(CookieJar.NO_COOKIES, "ObliApp-test")

    private class MemoryStore(var saved: ServerRegistryState?) : ServerRegistryStore {
        override suspend fun load() = saved
        override suspend fun save(state: ServerRegistryState) { saved = state }
    }

    val registry = ServerRegistry(MemoryStore(profiles.takeIf { it.isNotEmpty() }?.let { ServerRegistryState(it, it.first().id) }))

    private val sessions = ServerSessions(
        registry,
        { p, now -> ServerSession(p.id, now, ObliHttp(byOrigin.getValue(p.origin).origin, client), { FakeRealtime() }) },
        scope,
    )

    private val defaultServices = DefaultObliServices(
        registry = registry,
        sessions = sessions,
        httpFor = { origin -> ObliHttp(byOrigin[origin]?.origin ?: origin, client) },
        clearCookies = {},
        scope = scope,
        // 03:21 in Paris on 25 September 2026 (design doc §4).
        clock = { Instant.parse("2026-09-25T01:21:00Z").toEpochMilli() },
    )
    override val services: ObliServices get() = defaultServices
    override val ready = MutableStateFlow(false)

    /** Same order as AppGraph.start(): load the registry, follow the active server, then show the UI. */
    fun start() = runBlocking {
        registry.load()
        defaultServices.start()
        ready.value = true
    }

    fun requests(id: ServerId): List<String> = servers.getValue(id).requests.toList()

    override fun close() {
        scope.cancel()
        servers.values.forEach { it.close() }
    }

    private companion object {
        const val EXPIRED = """{"success":false,"error":"Authentication required"}"""
        val DEVICE_PATH = Regex("/api/devices/(\\d+)")

        fun <T> ok(serializer: KSerializer<T>, value: T): Pair<Int, String> = ok(ApiJson.json.encodeToJsonElement(serializer, value))
        fun ok(data: JsonElement): Pair<Int, String> = 200 to JsonObject(mapOf("success" to JsonPrimitive(true), "data" to data)).toString()

        /** `GET /api/live-alerts/all` as the server sends it (no envelope). */
        fun alertsFeed(alerts: List<LiveAlert>): String = buildJsonObject {
            put(
                "alerts",
                buildJsonArray {
                    alerts.forEach { a ->
                        add(
                            buildJsonObject {
                                put("id", a.id)
                                put("tenantId", a.tenantId)
                                put("tenantName", a.tenantName)
                                put("severity", a.severity.name.lowercase())
                                put("title", a.title)
                                put("message", a.message)
                                put("navigateTo", a.navigateTo)
                                put("readAt", a.readAt)
                                put("createdAt", a.createdAt)
                            },
                        )
                    }
                },
            )
            put("tenants", buildJsonArray { SampleData.tenants.forEach { t -> add(buildJsonObject { put("id", t.id); put("name", t.name) }) } })
        }.toString()

        fun summaryOf(devices: List<Device>) = FleetSummary(
            total = devices.count { it.status != "pending" },
            online = devices.count { it.status == "online" },
            offline = devices.count { it.status == "offline" },
            warning = devices.count { it.status == "warning" },
            critical = devices.count { it.status == "critical" },
            pending = devices.count { it.status == "pending" },
            latestAgentVersion = "4.5.79",
        )

        /** The fleet aggregates of Obliance Prod (shapes of server/src/routes/device.routes.ts and update.routes.ts). */
        val GROUP_STATS = """[
            {"groupId":31,"groupName":"Comptabilité","parentId":null,"tenantId":4,"tenantName":"ACME","online":2,"offline":0,"warning":0,"critical":1,"total":3},
            {"groupId":30,"groupName":"Serveurs","parentId":null,"tenantId":4,"tenantName":"ACME","online":1,"offline":1,"warning":0,"critical":0,"total":2},
            {"groupId":12,"groupName":"Linux","parentId":null,"tenantId":1,"tenantName":"Default","online":1,"offline":0,"warning":1,"critical":0,"total":2}
        ]"""
        const val DISKS = """{"count":2,"threshold":0,"top":[{"deviceId":15,"hostname":"BOB01","pct":94,"mountpoint":"/","warn":85},{"deviceId":30,"hostname":"SRV-FILES01","pct":72,"mountpoint":"D:","warn":85}]}"""
        const val UPDATES = """{"available":47,"critical":6,"important":12,"approved":20,"installed":310,"failed":1}"""

        fun hourly(): JsonArray = buildJsonArray {
            for (h in 0 until 24) {
                val offline = if (h >= 22) 16 else 11 + h % 3
                add(buildJsonObject { put("hour", "2026-09-24T%02d:00:00.000Z".format((h + 2) % 24)); put("total", 312); put("online", 312 - offline); put("offline", offline) })
            }
        }

        fun routes(server: ServerId, expired: Boolean): (String, String) -> Pair<Int, String>? {
            val devices = if (server == SampleData.PROD) SampleData.devices else SampleData.otherDevices[server].orEmpty()
            val alerts = SampleData.alerts.filter { it.serverId == server }.map { it.alert }
            val approvals = SampleData.escalations.filter { it.serverId == server }.map { it.approval }
            val prod = server == SampleData.PROD
            return route@{ method, path ->
                // Public routes (no session): what S01 and S03 check first.
                if (path == "/health") return@route 200 to """{"status":"ok","version":"5.1.110","timestamp":"2026-09-25T01:21:00.000Z"}"""
                if (path == "/api/auth/sso-config") {
                    return@route 200 to """{"success":true,"data":{"obligateUrl":"https://id.example.org","obligateReachable":true,"obligateEnabled":true}}"""
                }
                if (expired && path.startsWith("/api/")) return@route 401 to EXPIRED
                val deviceId = DEVICE_PATH.matchEntire(path)?.groupValues?.get(1)?.toLong()
                when {
                    path == "/api/auth/me" -> ok(SessionProbe.serializer(), SampleData.probe(server))
                    path == "/api/tenants" -> ok(ListSerializer(Tenant.serializer()), SampleData.tenants)
                    path == "/api/live-alerts/all" -> 200 to alertsFeed(alerts)
                    path == "/api/approvals" -> ok(ListSerializer(Approval.serializer()), approvals)
                    path == "/api/devices" -> ok(DevicePage.serializer(), DevicePage(devices, devices.size, 1, 50))
                    path == "/api/devices/summary" -> ok(FleetSummary.serializer(), if (prod) SampleData.summary else summaryOf(devices))
                    path == "/api/devices/group-stats" -> ok(ApiJson.json.parseToJsonElement(if (prod) GROUP_STATS else "[]"))
                    path == "/api/devices/disk-saturated" -> ok(ApiJson.json.parseToJsonElement(if (prod) DISKS else """{"count":0,"top":[]}"""))
                    path == "/api/updates/stats" -> ok(ApiJson.json.parseToJsonElement(UPDATES))
                    path == "/api/devices/fleet-hourly" -> ok(if (prod) hourly() else JsonArray(emptyList()))
                    path == "/api/groups" -> ok(JsonArray(emptyList()))
                    method == "POST" && path.endsWith("/live-metrics") -> ok(LiveMetricsAck.serializer(), LiveMetricsAck(sent = true, mode = "live", windowSec = 60))
                    deviceId != null -> devices.find { it.id == deviceId }?.let { ok(Device.serializer(), it) }
                    else -> null
                }
            }
        }
    }
}
