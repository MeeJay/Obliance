package tools.obli.core.tunnel

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.encodeUtf8
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TunnelSocketTest {
    private val token = "0123456789abcdef".repeat(4)
    private lateinit var server: MockWebServer

    /** Server end of the relay: records what the app sends. */
    private class Relay : WebSocketListener() {
        val received = LinkedBlockingQueue<Any>()
        @Volatile var socket: WebSocket? = null
        val opened = LinkedBlockingQueue<WebSocket>()

        override fun onOpen(webSocket: WebSocket, response: Response) {
            socket = webSocket
            opened.add(webSocket)
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

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After fun tearDown() {
        server.close()
    }

    private fun origin() = server.url("/").toString().trimEnd('/')

    private fun awaitState(t: TunnelSocket, timeoutMs: Long = 5_000, predicate: (TunnelState) -> Boolean): TunnelState {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            val s = t.state.value
            if (predicate(s)) return s
            Thread.sleep(10)
        }
        throw AssertionError("state never matched, last = ${t.state.value}")
    }

    @Test fun url_is_built_from_the_origin_and_refuses_malformed_tokens() {
        assertEquals("wss://obliance.example.org/api/remote/tunnel/$token", TunnelSocket.tunnelUrl("https://obliance.example.org", token))
        assertEquals("wss://obliance.example.org:8443/api/remote/tunnel/$token", TunnelSocket.tunnelUrl("https://obliance.example.org:8443", token))
        assertNull(TunnelSocket.tunnelUrl("https://obliance.example.org", "ABC"))
        assertNull(TunnelSocket.tunnelUrl("https://obliance.example.org", token.uppercase()))
        assertNull(TunnelSocket.tunnelUrl("https://obliance.example.org", "$token/../x"))
        assertNull(TunnelSocket.tunnelUrl("javascript:alert(1)", token))
    }

    @Test fun malformed_token_fails_without_any_request() {
        val t = TunnelSocket(OkHttpClient(), origin(), "not-a-token", onFrame = {})
        t.connect()
        assertTrue(t.state.value is TunnelState.Failed.Protocol)
        assertEquals(0, server.requestCount)
    }

    @Test fun upgrade_carries_the_session_cookie_and_nothing_is_sent_before_paired() {
        val relay = Relay()
        server.enqueue(MockResponse.Builder().webSocketUpgrade(relay).build())
        val frames = CopyOnWriteArrayList<TunnelFrame>()
        val t = TunnelSocket(
            OkHttpClient(), origin(), token,
            onFrame = { frames.add(it) },
            cookieHeader = { "connect.sid=s%3Aabc" },
            userAgent = "ObliApp/test",
            onPairedFirst = { TunnelSocket.resizeMessage(120, 40) },
        )
        t.connect()
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/remote/tunnel/$token", request.url.encodedPath)
        assertEquals("connect.sid=s%3Aabc", request.headers["Cookie"])
        assertEquals("ObliApp/test", request.headers["User-Agent"])
        assertEquals(origin(), request.headers["Origin"])

        awaitState(t) { it == TunnelState.Waiting }
        assertTrue(t.send("dir\r".toByteArray()))
        assertTrue(t.sendText(TunnelSocket.resizeMessage(80, 24)))
        assertEquals(2, t.queuedFrames)
        // Nothing reached the relay while waiting for the agent.
        assertNull(relay.received.poll(300, TimeUnit.MILLISECONDS))

        relay.socket!!.send("""{"type":"paired"}""")
        awaitState(t) { it == TunnelState.Paired }
        // The size first, then the queue in order, frame types preserved (stdin binary, control text).
        assertEquals("T:" + """{"type":"resize","cols":120,"rows":40}""", relay.received.poll(5, TimeUnit.SECONDS))
        assertEquals("dir\r".encodeUtf8(), relay.received.poll(5, TimeUnit.SECONDS))
        assertEquals("T:" + """{"type":"resize","cols":80,"rows":24}""", relay.received.poll(5, TimeUnit.SECONDS))
        assertEquals(0, t.queuedFrames)
        // The paired control frame is consumed, not delivered.
        assertTrue(frames.isEmpty())

        relay.socket!!.send("PS C:\\> ".encodeUtf8())
        awaitState(t) { it == TunnelState.Open }
        relay.socket!!.send("plain text")
        val end = System.currentTimeMillis() + 5_000
        while (frames.size < 2 && System.currentTimeMillis() < end) Thread.sleep(10)
        assertEquals("PS C:\\> ", String((frames[0] as TunnelFrame.Binary).bytes))
        assertEquals(TunnelFrame.Text("plain text"), frames[1])

        // After pairing, frames go straight out.
        assertTrue(t.send(byteArrayOf(3)))
        assertEquals(ByteString.of(3), relay.received.poll(5, TimeUnit.SECONDS))

        t.close()
        assertEquals(TunnelState.Closed(1000, "", byPeer = false), t.state.value)
        assertEquals("CLOSE:1000", relay.received.poll(5, TimeUnit.SECONDS))
        assertFalse(t.send(byteArrayOf(1)))
    }

    @Test fun cookie_jar_of_the_shared_client_is_used() {
        val relay = Relay()
        server.enqueue(MockResponse.Builder().webSocketUpgrade(relay).build())
        val jar = object : CookieJar {
            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = Unit
            override fun loadForRequest(url: HttpUrl): List<Cookie> =
                listOf(Cookie.Builder().name("connect.sid").value("jar").hostOnlyDomain(url.host).build())
        }
        val t = TunnelSocket(OkHttpClient.Builder().cookieJar(jar).build(), origin(), token, onFrame = {})
        t.connect()
        assertEquals("connect.sid=jar", server.takeRequest(5, TimeUnit.SECONDS)!!.headers["Cookie"])
        t.close()
    }

    @Test fun refused_upgrade_is_reported_with_its_status() {
        for (status in listOf(401, 403, 404)) {
            server.enqueue(MockResponse.Builder().code(status).body("Not the session owner").build())
            val t = TunnelSocket(OkHttpClient(), origin(), token, onFrame = {})
            t.connect()
            assertEquals(TunnelState.Failed.Refused(status), awaitState(t) { it.isTerminal })
            assertFalse(t.state.value.toString().contains(token))
            assertFalse(t.toString().contains(token))
        }
    }

    @Test fun queue_is_bounded_before_pairing() {
        val relay = Relay()
        server.enqueue(MockResponse.Builder().webSocketUpgrade(relay).build())
        val t = TunnelSocket(OkHttpClient(), origin(), token, onFrame = {}, queueLimitBytes = 10, queueLimitFrames = 3)
        t.connect()
        awaitState(t) { it == TunnelState.Waiting }
        assertTrue(t.send(ByteArray(4)))
        assertTrue(t.send(ByteArray(4)))
        assertFalse("byte limit", t.send(ByteArray(4)))
        assertTrue(t.send(ByteArray(1)))
        assertFalse("frame limit", t.send(ByteArray(1)))
        assertEquals(3, t.queuedFrames)
        t.close()
    }

    @Test fun peer_close_is_reported_as_closed_by_peer() {
        val relay = Relay()
        server.enqueue(MockResponse.Builder().webSocketUpgrade(relay).build())
        val t = TunnelSocket(OkHttpClient(), origin(), token, onFrame = {})
        t.connect()
        awaitState(t) { it == TunnelState.Waiting }
        relay.opened.poll(5, TimeUnit.SECONDS)!!.send("""{"type":"paired"}""")
        awaitState(t) { it == TunnelState.Paired }
        relay.socket!!.close(1000, "")
        val s = awaitState(t) { it.isTerminal }
        assertTrue(s is TunnelState.Closed && s.byPeer)
    }

    @Test fun network_loss_is_a_failure() {
        val relay = Relay()
        server.enqueue(MockResponse.Builder().webSocketUpgrade(relay).build())
        val t = TunnelSocket(OkHttpClient(), origin(), token, onFrame = {})
        t.connect()
        awaitState(t) { it == TunnelState.Waiting }
        relay.opened.poll(5, TimeUnit.SECONDS)!!
        // The server goes away without a close frame.
        server.close()
        assertTrue(awaitState(t) { it.isTerminal } is TunnelState.Failed.Network)
    }

    @Test fun paired_detection_is_strict() {
        assertTrue(TunnelSocket.isPaired("""{"type":"paired"}"""))
        assertTrue(TunnelSocket.isPaired("""{ "type" : "paired", "x": 1 }"""))
        assertFalse(TunnelSocket.isPaired("paired"))
        assertFalse(TunnelSocket.isPaired("""{"type":"init"}"""))
        assertFalse(TunnelSocket.isPaired("""{"type":"paired""""))
    }
}
