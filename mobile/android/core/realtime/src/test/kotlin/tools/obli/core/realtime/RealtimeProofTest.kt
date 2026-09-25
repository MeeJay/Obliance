package tools.obli.core.realtime

import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.BeforeClass
import org.junit.Test

/**
 * Phase 0 proof (design doc §10.6, risk R5): socket.io-client 2.x forced onto
 * OkHttp 5 talks to a real Socket.IO 4 server, with the session cookie in the
 * handshake, events, acks, and the 'Unauthorized' refusal.
 */
class RealtimeProofTest {
    companion object {
        private var node: Process? = null
        private var origin: String? = null

        @BeforeClass @JvmStatic fun startServer() {
            val root = File(System.getProperty("obli.repo.root") ?: return)
            val modules = File(root, "node_modules/socket.io")
            val script = File(RealtimeProofTest::class.java.getResource("/fake-socketio-server.js")?.toURI() ?: return)
            if (!modules.isDirectory) return
            val p = try {
                ProcessBuilder("node", script.absolutePath)
                    .apply { environment()["NODE_PATH"] = File(root, "node_modules").absolutePath }
                    .redirectErrorStream(true)
                    .start()
            } catch (_: Exception) {
                return
            }
            val line = p.inputStream.bufferedReader().readLine()
            val port = line?.removePrefix("PORT ")?.trim()?.toIntOrNull()
            if (port == null) { p.destroy(); return }
            node = p
            origin = "http://127.0.0.1:$port"
        }

        @AfterClass @JvmStatic fun stopServer() {
            node?.let { it.outputStream.close(); it.destroy(); it.waitFor(5, TimeUnit.SECONDS) }
        }
    }

    private val http = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()

    private fun client(cookie: String) = SocketIoRealtimeClient(
        origin = origin!!,
        okHttp = http,
        cookieHeader = { cookie },
        userAgent = "Proof ObliApp/0 (obliance; JVM)",
        eventNames = setOf("NOTIFICATION_NEW", "DEVICE_PROCESSES_UPDATED"),
    )

    @Test fun okHttp5IsTheOneOnTheClasspath() {
        // Would be 3.12.x if the exclusion failed.
        assertEquals("5", okhttp3.OkHttp.VERSION.substringBefore('.'))
    }

    @Test fun cookieHandshakeEventsAndAcks() = runBlocking {
        assumeTrue("node + node_modules/socket.io not available", origin != null)
        val c = client("connect.sid=s%3Agood-session.sig; other=1")
        val first = async { c.events.first { it.name == "NOTIFICATION_NEW" } }
        c.connect()
        withTimeout(10_000) { c.state.first { it == ConnectionState.CONNECTED } }
        val notif = withTimeout(10_000) { first.await() }
        assertEquals("SRV-AD2: Hors ligne", notif.payload!!.jsonObject["title"]!!.jsonPrimitive.content)

        val processes = async { c.events.first { it.name == "DEVICE_PROCESSES_UPDATED" } }
        val ack = c.emitWithAck("PROCESS_SUBSCRIBE", buildJsonObject { put("deviceId", 508) })
        assertEquals(JsonPrimitive(true), (ack as JsonObject)["ok"])
        assertEquals(508L, ack["deviceId"]!!.jsonPrimitive.content.toLong())
        val update = withTimeout(10_000) { processes.await() }
        assertEquals("EBP.Compta.exe", update.payload!!.jsonObject["processes"]!!.jsonArray[0].jsonObject["name"]!!.jsonPrimitive.content)

        c.reconnect()
        withTimeout(10_000) { c.state.first { it == ConnectionState.CONNECTED } }
        c.disconnect()
        assertEquals(ConnectionState.DISCONNECTED, c.state.value)
        assertNull(c.emitWithAck("PROCESS_SUBSCRIBE", null, 100))
    }

    @Test fun refusedSessionIsUnauthorized() = runBlocking {
        assumeTrue("node + node_modules/socket.io not available", origin != null)
        val c = client("connect.sid=s%3Aexpired.sig")
        c.connect()
        withTimeout(10_000) { c.state.first { it == ConnectionState.UNAUTHORIZED } }
        assertEquals(false, c.emit("PROCESS_SUBSCRIBE", null))
    }
}
