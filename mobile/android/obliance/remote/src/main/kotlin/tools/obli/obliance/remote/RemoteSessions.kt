package tools.obli.obliance.remote

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import tools.obli.core.auth.ServerSession
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.tunnel.TunnelFrame
import tools.obli.core.tunnel.TunnelSocket
import tools.obli.core.tunnel.TunnelState

/**
 * A remote session the app holds open (terminal or ObliReach viewer), as the
 * application navigates to it: [id] is the server's `remote_sessions.id` for a
 * shell, a local id for the web viewer. [protocol]: `powershell`, `cmd`,
 * `ssh` or `oblireach`.
 */
data class RemoteSessionRef(
    val id: String,
    val serverId: ServerId,
    val deviceId: Long,
    val protocol: String,
    val deviceLabel: String,
)

/**
 * Transport of the tunnels. By default the module uses its own OkHttp client
 * and reads the session cookie from the process-wide `CookieManager` (the
 * store the app's `WebCookieJar` and every WebView share). The application may
 * hand over its single client instead (design doc §10.4):
 * `RemoteAccess.configure(graph.client, AppGraph.USER_AGENT)`.
 */
object RemoteAccess {
    @Volatile internal var client: OkHttpClient? = null
        private set

    @Volatile internal var userAgent: String? = null
        private set

    @Volatile internal var cookieHeader: (origin: String) -> String? = ::webViewCookies
        private set

    fun configure(client: OkHttpClient, userAgent: String?, cookieHeader: ((origin: String) -> String?)? = null) {
        this.client = client
        this.userAgent = userAgent
        if (cookieHeader != null) this.cookieHeader = cookieHeader
    }

    internal val httpClient: OkHttpClient
        get() = client ?: defaultClient

    /** Live sessions (not ended), most recent first: the app places the pill and asks for notifications with it. */
    val liveSessions: StateFlow<List<RemoteSessionRef>> by lazy {
        SessionManager.live.map { list -> list.map { it.ref } }.stateIn(SessionManager.scope, SharingStarted.Eagerly, emptyList())
    }

    /** The session [id] the app holds (live or ended), e.g. from the notification's `EXTRA_SESSION_ID`; null when unknown. */
    fun session(id: String?): RemoteSessionRef? = SessionManager.find(id)?.ref

    private val defaultClient: OkHttpClient by lazy { OkHttpClient.Builder().retryOnConnectionFailure(false).followRedirects(false).build() }

    private fun webViewCookies(origin: String): String? =
        runCatching { android.webkit.CookieManager.getInstance().getCookie("$origin/") }.getOrNull()?.takeIf { it.isNotBlank() }
}

/** What a session is doing, for every surface (screen, pill, Activité, notification). */
internal sealed interface SessionPhase {
    /** Upgrade of the tunnel in progress. */
    data object Connecting : SessionPhase

    /** Tunnel open, the agent has not attached yet (up to 6 min on the server). */
    data object Waiting : SessionPhase

    data class Connected(val sinceMs: Long) : SessionPhase

    data class Ended(val reason: EndReason) : SessionPhase

    val isLive: Boolean get() = this !is Ended
}

internal enum class EndReason {
    /** The relay closed the tunnel: the shell exited, or the session was ended elsewhere. */
    SHELL_CLOSED,

    /** Transport lost: the relay tore the session down, a running command may have been interrupted. */
    CONNECTION_LOST,

    /** « Terminer » (here, from the notification, or the Activité list). */
    ENDED_BY_USER,

    /** The agent never attached. */
    DEVICE_TIMEOUT,

    /** 401 on the upgrade: the session cookie expired. */
    SESSION_EXPIRED,

    /** 403 / 404 on the upgrade: not the starter any more, or the session is already closed. */
    REFUSED,
}

/** One entry of the [SessionManager]. */
internal sealed interface RemoteEntry {
    val id: String
    val serverId: ServerId
    val deviceId: Long
    val deviceLabel: String
    val tenantName: String?
    val protocol: String
    val phase: StateFlow<SessionPhase>
    val ref: RemoteSessionRef get() = RemoteSessionRef(id, serverId, deviceId, protocol, deviceLabel)

    /** Last line of output (terminal) for the previews; empty otherwise. */
    fun lastLine(): String

    /** Ends the session on the server and closes the local end. No confirmation here: callers confirm first. */
    suspend fun terminate(): ApiOutcome<Unit>
}

/**
 * A remote shell: the tunnel, the emulator and the transcript. Output is fed
 * to the emulator even while no screen shows it, so coming back to the
 * terminal shows everything that happened (design doc §2.6).
 */
internal class ShellSession(
    override val id: String,
    override val serverId: ServerId,
    override val deviceId: Long,
    override val deviceLabel: String,
    override val tenantName: String?,
    override val protocol: String,
    val wtsSessionId: Int?,
    val wtsLabel: String?,
    private val server: ServerSession,
    token: String,
    private val scope: CoroutineScope,
    engineFactory: ((onInput: (ByteArray) -> Unit, onResize: (Int, Int) -> Unit) -> TerminalEngine)? = null,
    client: OkHttpClient = RemoteAccess.httpClient,
    private val clock: () -> Long = System::currentTimeMillis,
    private val waitTimeoutMs: Long = WAIT_TIMEOUT_MS,
) : RemoteEntry {
    val transcript = Transcript()
    private val _phase = MutableStateFlow<SessionPhase>(SessionPhase.Connecting)
    override val phase: StateFlow<SessionPhase> = _phase.asStateFlow()

    @Volatile private var size: Pair<Int, Int> = 80 to 24
    @Volatile private var endedByUser = false
    private var watcher: Job? = null

    private val tunnel = TunnelSocket(
        client = client,
        origin = server.http.origin,
        token = token,
        onFrame = ::onFrame,
        cookieHeader = { RemoteAccess.cookieHeader(server.http.origin) },
        userAgent = RemoteAccess.userAgent,
        // First frame after pairing: the size of the terminal (design doc §5 S60 « Protocole »).
        onPairedFirst = { TunnelSocket.resizeMessage(size.first, size.second) },
    )

    val engine: TerminalEngine = engineFactory?.let { factory ->
        runCatching { factory(::onInput, ::onResize) }.getOrNull()
    } ?: TranscriptEngine(transcript, ::onInput)

    val tunnelState: StateFlow<TunnelState> get() = tunnel.state

    fun start() {
        watcher = scope.launch {
            tunnel.state.collect { s -> onTunnel(s) }
        }
        scope.launch {
            delay(waitTimeoutMs)
            if (_phase.value == SessionPhase.Waiting || _phase.value == SessionPhase.Connecting) {
                _phase.value = SessionPhase.Ended(EndReason.DEVICE_TIMEOUT)
                tunnel.close(1000, "timeout")
                RemoteApi.end(server, id)
            }
        }
        tunnel.connect()
    }

    private fun onTunnel(s: TunnelState) {
        if (_phase.value is SessionPhase.Ended) return
        _phase.value = when (s) {
            TunnelState.Idle, TunnelState.Connecting -> SessionPhase.Connecting
            TunnelState.Waiting -> SessionPhase.Waiting
            TunnelState.Paired, TunnelState.Open -> {
                val current = _phase.value
                if (current is SessionPhase.Connected) current else SessionPhase.Connected(clock())
            }
            is TunnelState.Closed -> SessionPhase.Ended(if (endedByUser || !s.byPeer) EndReason.ENDED_BY_USER else EndReason.SHELL_CLOSED)
            is TunnelState.Failed.Refused -> {
                if (s.httpStatus == 401) server.markExpired()
                SessionPhase.Ended(if (s.httpStatus == 401) EndReason.SESSION_EXPIRED else EndReason.REFUSED)
            }
            is TunnelState.Failed.Network, is TunnelState.Failed.Protocol -> SessionPhase.Ended(EndReason.CONNECTION_LOST)
        }
    }

    private fun onFrame(frame: TunnelFrame) {
        val bytes = when (frame) {
            is TunnelFrame.Binary -> frame.bytes
            // JSON control messages of the agent are not terminal output (same as the web).
            is TunnelFrame.Text -> if (frame.text.startsWith("{")) return else frame.text.toByteArray(Charsets.UTF_8)
        }
        transcript.feed(bytes)
        engine.feed(bytes)
    }

    /** Keystrokes of the emulator (IME, key bar, paste): binary frames, like the web's `TextEncoder` bytes. */
    private fun onInput(bytes: ByteArray) {
        if (_phase.value is SessionPhase.Ended) return
        tunnel.send(bytes)
    }

    /** New grid size of the emulator; sent right away once paired, else on pairing. */
    private fun onResize(cols: Int, rows: Int) {
        if (cols <= 0 || rows <= 0) return
        size = cols to rows
        if (tunnel.state.value.isConnected) tunnel.sendText(TunnelSocket.resizeMessage(cols, rows))
    }

    /** Test hook: what a resize of the view would do. */
    internal fun resizeForTest(cols: Int, rows: Int) = onResize(cols, rows)

    /** Test hook: typed input. */
    internal fun inputForTest(bytes: ByteArray) = onInput(bytes)

    override fun lastLine(): String = transcript.lastLine()

    override suspend fun terminate(): ApiOutcome<Unit> {
        endedByUser = true
        val out = if (_phase.value is SessionPhase.Ended) ApiOutcome.Ok(Unit) else RemoteApi.end(server, id)
        // Whatever the answer, the local end goes: the relay then ends the session too (browser_disconnect).
        tunnel.close()
        _phase.update { if (it is SessionPhase.Ended) it else SessionPhase.Ended(EndReason.ENDED_BY_USER) }
        return out
    }

    override fun toString(): String = "ShellSession($protocol on #$deviceId, ${_phase.value})"

    companion object {
        /** The server gives a waiting session 6 min; a little more here before giving up. */
        const val WAIT_TIMEOUT_MS = 6 * 60_000L + 30_000L
    }
}

/**
 * The process-level registry of remote sessions (design doc §2.6): they
 * survive navigation, rotation, tenant switches and the background (a
 * foreground service keeps the process while one is live). Only « Terminer »
 * or the remote end closes them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal object SessionManager {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _entries = MutableStateFlow<List<RemoteEntry>>(emptyList())
    val entries: StateFlow<List<RemoteEntry>> = _entries.asStateFlow()

    /** Entries not ended, most recent first. */
    val live: StateFlow<List<RemoteEntry>> = _entries
        .flatMapLatest { list ->
            if (list.isEmpty()) flowOf(emptyList()) else combine(list.map { it.phase }) { phases -> list.filterIndexed { i, _ -> phases[i].isLive } }
        }
        .stateIn(scope, SharingStarted.Eagerly, emptyList())

    @Volatile private var appContext: Context? = null

    /** Off in JVM tests: no foreground service. */
    @Volatile var serviceEnabled = true

    fun bind(context: Context) {
        if (appContext == null) appContext = context.applicationContext
    }

    fun add(entry: RemoteEntry) {
        _entries.update { listOf(entry) + it.filterNot { e -> e.id == entry.id } }
        appContext?.takeIf { serviceEnabled }?.let { RemoteSessionService.start(it) }
    }

    fun remove(id: String) {
        _entries.update { list -> list.filterNot { it.id == id } }
    }

    fun find(id: String?): RemoteEntry? = id?.let { i -> _entries.value.firstOrNull { it.id == i } }

    /** Newest live shell of that device and protocol (resume instead of opening a second one). */
    fun findShell(serverId: ServerId, deviceId: Long, protocol: String, wtsSessionId: Int?): ShellSession? =
        _entries.value.filterIsInstance<ShellSession>().firstOrNull {
            it.serverId == serverId && it.deviceId == deviceId && it.protocol == protocol && it.wtsSessionId == wtsSessionId && it.phase.value.isLive
        }

    /** « Tout terminer » (notification): ends every live session on its own server. */
    fun terminateAll() {
        val list = _entries.value
        scope.launch {
            list.filter { it.phase.value.isLive }.forEach { runCatching { it.terminate() } }
            _entries.update { current -> current.filterNot { it in list } }
        }
    }

    /** Tests only. */
    internal fun clear() {
        _entries.value = emptyList()
    }
}
