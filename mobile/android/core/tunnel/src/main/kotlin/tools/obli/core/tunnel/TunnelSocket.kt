package tools.obli.core.tunnel

import java.io.IOException
import java.net.ProtocolException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/**
 * Lifecycle of a relay tunnel (design doc §10.9):
 * `Idle → Connecting → Waiting → Paired → Open → Closed | Failed`.
 *
 * - [Connecting]: HTTP upgrade in progress (the server checks the session
 *   cookie and the token BEFORE the handshake: a refusal is [Failed.Refused]).
 * - [Waiting]: the socket is open, the relay waits for the agent end.
 * - [Paired]: the relay sent `{"type":"paired"}`; frames queued meanwhile have
 *   been flushed, new frames go straight out.
 * - [Open]: the first frame of the agent arrived after pairing.
 */
sealed interface TunnelState {
    data object Idle : TunnelState
    data object Connecting : TunnelState
    data object Waiting : TunnelState
    data object Paired : TunnelState
    data object Open : TunnelState

    /** Closing handshake completed. [byPeer]: the relay (agent end gone, session ended) closed it. */
    data class Closed(val code: Int, val reason: String, val byPeer: Boolean) : TunnelState

    sealed interface Failed : TunnelState {
        /** The upgrade was answered with a plain HTTP status (401 no session, 403 not the starter, 404 closed). */
        data class Refused(val httpStatus: Int) : Failed

        /** Transport failure (network lost, TLS, reset): the relay tears the session down. */
        data class Network(val cause: String) : Failed

        /** Malformed token, invalid origin, or the outgoing buffer of OkHttp overflowed. */
        data class Protocol(val cause: String) : Failed
    }

    /** Frames may be exchanged (the agent is attached). */
    val isConnected: Boolean get() = this == Paired || this == Open

    /** Nothing more will happen on this tunnel. */
    val isTerminal: Boolean get() = this is Closed || this is Failed
}

/** One frame received from the agent end, with its WebSocket frame type preserved (the relay keeps it). */
sealed interface TunnelFrame {
    class Binary(val bytes: ByteArray) : TunnelFrame
    data class Text(val text: String) : TunnelFrame
}

/**
 * The browser end of the relay `/api/remote/tunnel/<token>` of a remote
 * session, over OkHttp — exactly what the web client opens
 * (`remote.api.ts getTunnelWsUrl`), with the SAME credentials:
 *
 * - the session cookie of the user who started the session (the server
 *   refuses any other user, `remoteSessionSecurity.evaluateBrowserTunnelAccess`):
 *   through [client]'s cookie jar, or [cookieHeader] when the client has none;
 * - the 64-hex `sessionToken` returned by `POST /api/remote/sessions` (only
 *   to its starter). The token is never logged, never part of [toString] or
 *   of any [TunnelState].
 *
 * Nothing is sent before `{"type":"paired"}`: the relay only bridges the
 * browser to the agent once both ends are attached, earlier frames would be
 * lost. They wait in a bounded queue ([queueLimitBytes], [queueLimitFrames])
 * and are flushed in order on pairing, after [onPairedFirst] (e.g. the
 * `resize` the agent needs first); [send] returns false when it is full.
 * Keep-alive: WebSocket ping every [pingIntervalMs] (the server pings too).
 *
 * Frames of the agent are delivered to [onFrame] on OkHttp's reader thread,
 * in order. The `paired` control frame itself is consumed here.
 */
class TunnelSocket(
    client: OkHttpClient,
    private val origin: String,
    token: String,
    private val onFrame: (TunnelFrame) -> Unit,
    private val cookieHeader: () -> String? = { null },
    private val userAgent: String? = null,
    private val queueLimitBytes: Int = DEFAULT_QUEUE_BYTES,
    private val queueLimitFrames: Int = DEFAULT_QUEUE_FRAMES,
    pingIntervalMs: Long = DEFAULT_PING_MS,
    /** Text frame sent first on pairing, before the queued frames (the terminal size). */
    private val onPairedFirst: () -> String? = { null },
) {
    private val url: String? = tunnelUrl(origin, token)

    // Long-lived socket: no read or call timeout (the pings detect a dead peer).
    private val client: OkHttpClient = client.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(pingIntervalMs, TimeUnit.MILLISECONDS)
        .build()

    private val lock = Any()
    private val _state = MutableStateFlow<TunnelState>(TunnelState.Idle)
    val state: StateFlow<TunnelState> = _state.asStateFlow()

    private var socket: WebSocket? = null
    private val queue = ArrayDeque<Outgoing>()
    private var queuedBytes = 0
    private var closedByUs = false

    private sealed interface Outgoing {
        val size: Int

        class Bin(val bytes: ByteString) : Outgoing {
            override val size get() = bytes.size
        }

        class Txt(val text: String) : Outgoing {
            override val size get() = text.length
        }
    }

    /** Opens the socket (once). A malformed token or origin fails at once, nothing is sent. */
    fun connect() {
        synchronized(lock) {
            if (_state.value != TunnelState.Idle) return
            val target = url ?: run {
                _state.value = TunnelState.Failed.Protocol("invalid tunnel address")
                return
            }
            _state.value = TunnelState.Connecting
            val request = Request.Builder().url(target).apply {
                header("Origin", origin)
                cookieHeader()?.takeIf { it.isNotBlank() }?.let { header("Cookie", it) }
                userAgent?.let { header("User-Agent", it) }
            }.build()
            socket = client.newWebSocket(request, Listener())
        }
    }

    /** Raw input for the remote shell (binary frame, like the web's `TextEncoder` bytes). */
    fun send(bytes: ByteArray): Boolean = enqueue(Outgoing.Bin(bytes.toByteString()))

    /** JSON control message (text frame), e.g. `{"type":"resize","cols":80,"rows":24}`. */
    fun sendText(text: String): Boolean = enqueue(Outgoing.Txt(text))

    /** Frames waiting for the pairing (tests, diagnostics). */
    val queuedFrames: Int get() = synchronized(lock) { queue.size }

    /** Normal close (1000). The relay then ends the session (`browser_disconnect`). */
    fun close(code: Int = 1000, reason: String = "") {
        synchronized(lock) {
            closedByUs = true
            queue.clear()
            queuedBytes = 0
            val s = _state.value
            if (s.isTerminal) return
            val ws = socket
            if (ws == null) {
                _state.value = TunnelState.Closed(code, reason, byPeer = false)
                return
            }
            ws.close(code, reason.take(MAX_REASON))
            // Do not wait for the peer's close frame to report it: the user asked.
            _state.value = TunnelState.Closed(code, reason, byPeer = false)
            // Hard stop if the peer never answers the close frame.
            ws.cancelLater()
        }
    }

    private fun WebSocket.cancelLater() {
        val ws = this
        Thread {
            try {
                Thread.sleep(CLOSE_GRACE_MS)
            } catch (_: InterruptedException) {
                return@Thread
            }
            ws.cancel()
        }.apply { isDaemon = true; name = "tunnel-close" }.start()
    }

    private fun enqueue(frame: Outgoing): Boolean = synchronized(lock) {
        val s = _state.value
        when {
            s.isTerminal || closedByUs -> false
            s.isConnected -> write(frame)
            else -> {
                if (queue.size >= queueLimitFrames || queuedBytes + frame.size > queueLimitBytes) return@synchronized false
                queue.addLast(frame)
                queuedBytes += frame.size
                true
            }
        }
    }

    /** Under [lock]. False (and the tunnel failed) when OkHttp's own 16 MiB buffer is full or it is closing. */
    private fun write(frame: Outgoing): Boolean {
        val ws = socket ?: return false
        val ok = when (frame) {
            is Outgoing.Bin -> ws.send(frame.bytes)
            is Outgoing.Txt -> ws.send(frame.text)
        }
        if (!ok && !_state.value.isTerminal) {
            _state.value = TunnelState.Failed.Protocol("send buffer full")
            ws.cancel()
        }
        return ok
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            synchronized(lock) {
                if (_state.value == TunnelState.Connecting) _state.value = TunnelState.Waiting
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (isPaired(text)) {
                synchronized(lock) {
                    if (_state.value != TunnelState.Waiting) return
                    _state.value = TunnelState.Paired
                    onPairedFirst()?.let { write(Outgoing.Txt(it)) }
                    while (queue.isNotEmpty()) {
                        if (!write(queue.removeFirst())) break
                    }
                    queue.clear()
                    queuedBytes = 0
                }
                return
            }
            markOpen()
            onFrame(TunnelFrame.Text(text))
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            markOpen()
            onFrame(TunnelFrame.Binary(bytes.toByteArray()))
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code.takeIf { it in 1000..4999 && it != 1005 && it != 1006 } ?: 1000, null)
            finish(TunnelState.Closed(code, reason, byPeer = true))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            finish(TunnelState.Closed(code, reason, byPeer = true))
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            val status = response?.code
            response?.close()
            finish(
                when {
                    status != null && status != 101 -> TunnelState.Failed.Refused(status)
                    t is ProtocolException -> TunnelState.Failed.Protocol(t.javaClass.simpleName)
                    t is IOException -> TunnelState.Failed.Network(t.javaClass.simpleName)
                    else -> TunnelState.Failed.Protocol(t.javaClass.simpleName)
                },
            )
        }
    }

    private fun markOpen() = synchronized(lock) {
        if (_state.value == TunnelState.Paired) _state.value = TunnelState.Open
    }

    private fun finish(end: TunnelState) = synchronized(lock) {
        queue.clear()
        queuedBytes = 0
        if (!_state.value.isTerminal) _state.value = end
    }

    /** Never shows the token. */
    override fun toString(): String = "TunnelSocket(origin=$origin, state=${_state.value})"

    companion object {
        const val DEFAULT_PING_MS = 20_000L
        const val DEFAULT_QUEUE_BYTES = 64 * 1024
        const val DEFAULT_QUEUE_FRAMES = 256
        private const val CLOSE_GRACE_MS = 5_000L
        private const val MAX_REASON = 120

        /** Same pattern as the server (`BROWSER_RE`): 64 lower-case hex characters. */
        private val TOKEN = Regex("[0-9a-f]{64}")
        private val ORIGIN = Regex("(https?)://([^/?#@\\s]+)")
        private val json = Json { ignoreUnknownKeys = true }

        fun isValidToken(token: String?): Boolean = token != null && TOKEN.matches(token)

        /**
         * `wss://host/api/remote/tunnel/<token>` for an `https://host` origin
         * (`ws://` for `http://`, tests only), or null when either is malformed.
         */
        fun tunnelUrl(origin: String, token: String): String? {
            if (!isValidToken(token)) return null
            val m = ORIGIN.matchEntire(origin) ?: return null
            val scheme = if (m.groupValues[1] == "https") "wss" else "ws"
            return "$scheme://${m.groupValues[2]}/api/remote/tunnel/$token"
        }

        /** The relay's pairing signal (`remote.service.ts _flushAndBridgeBrowser`). */
        fun isPaired(text: String): Boolean {
            if (!text.startsWith("{")) return false
            val obj = try {
                json.parseToJsonElement(text) as? JsonObject
            } catch (_: Exception) {
                null
            } ?: return false
            return (obj["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content == "paired"
        }

        /** `{"type":"resize","cols":…,"rows":…}` — the web's `sendResize`. */
        fun resizeMessage(cols: Int, rows: Int): String = """{"type":"resize","cols":$cols,"rows":$rows}"""
    }
}
