package tools.obli.obliance.remote

import java.util.concurrent.LinkedBlockingQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ObliHttp
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.core.security.ActionPrompter
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.TwoFactorAnswer
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** A socket the test drives. */
internal class FakeRealtime : RealtimeClient {
    override val state: StateFlow<ConnectionState> = MutableStateFlow(ConnectionState.CONNECTED)
    val flow = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 16)
    override val events: SharedFlow<RealtimeEvent> = flow
    override fun connect() = Unit
    override fun reconnect() = Unit
    override fun disconnect() = Unit
    override fun emit(name: String, payload: JsonElement?) = false
    override suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long): JsonElement? = null
}

/**
 * The §4 sample services, except that every server's HTTP client points at
 * [origin] (a MockWebServer): the remote calls are real HTTP requests.
 */
internal class MockOriginServices(
    origin: String,
    val realtime: FakeRealtime = FakeRealtime(),
    private val base: SampleObliServices = SampleObliServices(),
) : ObliServices by base {
    private val client = OkHttpClient()
    override val sessions: ServerSessions = ServerSessions(
        base.registry,
        { profile, now ->
            ServerSession(profile.id, now, ObliHttp(origin, client), { realtime }).also { it.markSignedIn(SampleData.probe(profile.id)) }
        },
        CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
    )
}

/** Confirms everything and records what was asked. */
internal class RecordingPrompter(var accept: Boolean = true) : ActionPrompter {
    val confirmed = mutableListOf<ActionSpec>()
    override suspend fun confirmTenantSwitch(spec: ActionSpec, tenantName: String) = accept
    override suspend fun confirm(spec: ActionSpec): Boolean {
        confirmed += spec
        return accept
    }
    override suspend fun askTwoFactor(spec: ActionSpec, currentIp: String?, previousWasWrong: Boolean): TwoFactorAnswer? = null
    override suspend fun approvalRequested(spec: ActionSpec, approvalId: Long) = Unit
    override suspend fun unlockPrivacy(spec: ActionSpec, feature: String?, passwordSet: Boolean) = false
    override suspend fun sessionExpired() = Unit

    val runner get() = ActionRunner(this)
}

/** Server end of the relay. */
internal class Relay : WebSocketListener() {
    val received = LinkedBlockingQueue<Any>()
    @Volatile var socket: WebSocket? = null

    override fun onOpen(webSocket: WebSocket, response: Response) {
        socket = webSocket
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        received.add("T:$text")
    }

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        received.add(bytes)
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        received.add("CLOSE:$code")
        webSocket.close(1000, null)
    }
}

internal val PROD: ServerId = SampleData.PROD

internal fun waitUntil(timeoutMs: Long = 5_000, what: String = "condition", predicate: () -> Boolean) {
    val end = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < end) {
        if (predicate()) return
        Thread.sleep(10)
    }
    throw AssertionError("$what never happened")
}
