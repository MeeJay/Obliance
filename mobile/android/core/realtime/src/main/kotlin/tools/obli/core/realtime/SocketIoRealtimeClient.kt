package tools.obli.core.realtime

import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import java.net.URI
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject

/**
 * [RealtimeClient] on `io.socket:socket.io-client` 2.x (Engine.IO v4, matches
 * the server's socket.io 4.x), running on the app's OkHttp 5 client.
 *
 * WebSocket transport only; the session cookie is read from [cookieHeader] at
 * every (re)connection, so a renewed cookie is picked up. Events are decoded
 * to kotlinx JSON; unknown events are passed through, filtering is the app's job.
 */
class SocketIoRealtimeClient(
    private val origin: String,
    private val okHttp: OkHttpClient,
    private val cookieHeader: () -> String?,
    private val userAgent: String,
    /** Event names to listen to (Socket.IO has no catch-all listener). */
    private val eventNames: Set<String>,
) : RealtimeClient {
    private val _state = MutableStateFlow(ConnectionState.DISCONNECTED)
    override val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 256, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()

    @Volatile private var socket: Socket? = null

    @Synchronized
    override fun connect() {
        if (socket != null) return
        val opts = IO.Options().apply {
            transports = arrayOf("websocket")
            reconnection = true
            reconnectionDelay = 1_000
            reconnectionDelayMax = 30_000
            timeout = 20_000
            callFactory = okHttp
            webSocketFactory = okHttp
            extraHeaders = headers()
        }
        val s = IO.socket(URI.create(origin), opts)
        s.on(Socket.EVENT_CONNECT) { _state.value = ConnectionState.CONNECTED }
        s.on(Socket.EVENT_DISCONNECT) { args ->
            val reason = args.firstOrNull()?.toString()
            // "io server disconnect": the server closed us; socket.io does not retry.
            _state.value = if (reason == "io server disconnect" || reason == "io client disconnect") ConnectionState.DISCONNECTED
            else ConnectionState.RECONNECTING
        }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val message = when (val e = args.firstOrNull()) {
                is JSONObject -> e.optString("message")
                is Throwable -> e.message
                else -> e?.toString()
            }.orEmpty()
            if (message.startsWith("Unauthorized") || message == "Authentication failed") {
                _state.value = ConnectionState.UNAUTHORIZED
                s.off(); s.close()
                synchronized(this) { if (socket === s) socket = null }
            } else {
                _state.value = ConnectionState.RECONNECTING
            }
        }
        // Headers are captured per connection attempt: refresh the cookie on retries.
        s.io().on(io.socket.client.Manager.EVENT_RECONNECT_ATTEMPT) { opts.extraHeaders = headers() }
        for (name in eventNames) {
            s.on(name) { args -> _events.tryEmit(RealtimeEvent(name, args.firstOrNull()?.let(::toJson))) }
        }
        socket = s
        _state.value = ConnectionState.CONNECTING
        s.connect()
    }

    override fun reconnect() {
        disconnect()
        connect()
    }

    @Synchronized
    override fun disconnect() {
        socket?.let { it.off(); it.close() }
        socket = null
        _state.value = ConnectionState.DISCONNECTED
    }

    override fun emit(name: String, payload: JsonElement?): Boolean {
        val s = socket?.takeIf { it.connected() } ?: return false
        if (payload == null) s.emit(name) else s.emit(name, fromJson(payload))
        return true
    }

    override suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long): JsonElement? {
        val s = socket?.takeIf { it.connected() } ?: return null
        val answer = CompletableDeferred<JsonElement?>()
        val ack = Ack { args -> answer.complete(args.firstOrNull()?.let(::toJson)) }
        if (payload == null) s.emit(name, ack) else s.emit(name, fromJson(payload), ack)
        return withTimeoutOrNull(timeoutMs) { answer.await() }
    }

    private fun headers(): Map<String, List<String>> = buildMap {
        put("User-Agent", listOf(userAgent))
        cookieHeader()?.takeIf { it.isNotBlank() }?.let { put("Cookie", listOf(it)) }
    }

    companion object {
        private val json = Json

        /** org.json (what socket.io-client hands over) → kotlinx JSON. */
        fun toJson(value: Any?): JsonElement = when (value) {
            null, JSONObject.NULL -> JsonNull
            is JSONObject, is JSONArray -> json.parseToJsonElement(value.toString())
            is String -> JsonPrimitive(value)
            is Number -> JsonPrimitive(value)
            is Boolean -> JsonPrimitive(value)
            else -> JsonPrimitive(value.toString())
        }

        /** kotlinx JSON → what socket.io-client expects (JSONObject / JSONArray / primitives). */
        fun fromJson(element: JsonElement): Any = when (element) {
            is JsonObject -> JSONObject(element.toString())
            is JsonArray -> JSONArray(element.toString())
            is JsonNull -> JSONObject.NULL
            is JsonPrimitive -> when {
                element.isString -> element.content
                element.content == "true" || element.content == "false" -> element.content.toBoolean()
                else -> element.content.toLongOrNull() ?: element.content.toDouble()
            }
        }
    }
}
