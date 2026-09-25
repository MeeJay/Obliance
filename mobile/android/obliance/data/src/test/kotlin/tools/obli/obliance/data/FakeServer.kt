package tools.obli.obliance.data

import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.shell.nav.Origins

/** One fake Obliance server: answers by "METHOD path" and records every request. */
class FakeServer : AutoCloseable {
    val routes = java.util.concurrent.ConcurrentHashMap<String, Pair<Int, String>>()
    val requests = CopyOnWriteArrayList<String>()

    /** Answer of a route held back this long (ms), to act while a call is in flight. */
    val delays = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val server = MockWebServer()

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val key = "${request.method} ${request.url.encodedPath}"
                requests += key
                val (code, body) = routes[key] ?: (404 to """{"error":"Not found"}""")
                val builder = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body)
                delays[key]?.let { builder.headersDelay(it, java.util.concurrent.TimeUnit.MILLISECONDS) }
                return builder.build()
            }
        }
        server.start()
    }

    /** The mock's real (http://127.0.0.1:port) origin. */
    val origin: String get() = Origins.of(server.url("/").toString())!!

    fun on(route: String, code: Int = 200, body: String) {
        routes[route] = code to body
    }

    fun count(route: String): Int = requests.count { it == route }

    override fun close() = server.close()
}

class FakeRealtime : RealtimeClient {
    val log = CopyOnWriteArrayList<String>()
    override val state: StateFlow<ConnectionState> = MutableStateFlow(ConnectionState.CONNECTED)
    val flow = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 16)
    override val events: SharedFlow<RealtimeEvent> = flow
    override fun connect() { log += "connect" }
    override fun reconnect() { log += "reconnect" }
    override fun disconnect() { log += "disconnect" }
    override fun emit(name: String, payload: JsonElement?) = false
    override suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long): JsonElement? = null
}

const val ME_ADMIN = """{"success":true,"data":{"user":{"id":3,"username":"og_karim.benali","displayName":"Karim Benali","role":"admin","foreignSource":"obligate"},"permissions":{},"requires2faSetup":false,"currentTenantId":1}}"""
const val ME_USER = """{"success":true,"data":{"user":{"id":7,"username":"karim.benali","displayName":"Karim Benali","role":"user"},"permissions":{},"requires2faSetup":false,"currentTenantId":1}}"""
const val EXPIRED = """{"success":false,"error":"Authentication required"}"""

fun alertsJson(vararg rows: Triple<Long, String, String>): String =
    """{"alerts":[""" + rows.joinToString(",") { (id, severity, title) ->
        """{"id":$id,"tenantId":1,"tenantName":"Default","severity":"$severity","title":"$title","message":"","navigateTo":null,"stableKey":null,"readAt":null,"createdAt":"2026-09-25T01:0${id % 10}:00.000Z"}"""
    } + """],"tenants":[{"id":1,"name":"Default"}]}"""
