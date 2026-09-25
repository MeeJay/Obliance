package tools.obli.obliance.remote

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okio.ByteString
import okio.ByteString.Companion.encodeUtf8
import okio.ByteString.Companion.toByteString
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.auth.AuthState
import tools.obli.core.security.ActionResult
import tools.obli.core.security.Tier

/**
 * S60 end to end against a MockWebServer: the exact requests of the web
 * client (`remote.api.ts`), the tunnel protocol of `remote.service.ts`, and
 * the session life in the process-level manager.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TerminalSessionTest {
    private val token = "a1b2c3d4e5f60718".repeat(4)
    private val sessionId = "5f0c2a1e-8d3b-4c6f-9a7e-2b1d0c9e8f7a"
    private lateinit var server: MockWebServer
    private val main = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val texts = TerminalTexts("Ouvrir PowerShell", "Un shell distant s'ouvre.", "Terminer la session", "L'appareil est hors ligne.", "legacy")

    @Before fun setUp() {
        Dispatchers.setMain(main)
        server = MockWebServer()
        server.start()
        SessionManager.serviceEnabled = false
        SessionManager.clear()
        RemoteAccess.configure(OkHttpClient(), "ObliApp/test (obliance; Android)") { "connect.sid=s%3Aprod" }
    }

    @After fun tearDown() {
        server.close()
        SessionManager.clear()
        Dispatchers.resetMain()
        main.close()
    }

    private fun origin() = server.url("/").toString().trimEnd('/')

    private fun started(withToken: Boolean = true) = MockResponse.Builder().code(201).addHeader("Content-Type", "application/json")
        .body("""{"data":{"id":"$sessionId","deviceId":187,"tenantId":2,"protocol":"powershell","status":"waiting",${if (withToken) "\"sessionToken\":\"$token\"," else ""}"startedBy":3,"startedAt":"2026-09-25T01:24:00Z"}}""")
        .build()

    private fun vm(services: MockOriginServices, deviceId: Long = 187, protocol: String = "powershell", wts: Int? = null) =
        TerminalViewModel(services, PROD, deviceId, protocol, wts, resumeId = null, engineFactory = null).also { vm ->
            waitUntil(what = "device loaded") { vm.ui.value.deviceLoaded }
        }

    private fun body(request: mockwebserver3.RecordedRequest): JsonObject = Json.parseToJsonElement(request.body!!.utf8()).jsonObject

    @Test fun opens_a_powershell_session_exactly_like_the_web_and_ends_it() {
        val services = MockOriginServices(origin())
        val relay = Relay()
        server.enqueue(started())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(relay).build())
        server.enqueue(MockResponse.Builder().code(204).build())
        val prompter = RecordingPrompter()
        val vm = vm(services)

        runBlocking { vm.start(prompter.runner, texts) }

        // T1 confirmation naming the device, its server and tenant (3 servers in the sample).
        val spec = prompter.confirmed.single()
        assertEquals(Tier.T1, spec.tier)
        assertEquals("PC-COMPTA-03", spec.target)
        assertEquals("Obliance Prod › ACME", spec.scope)

        val start = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", start.method)
        assertEquals("/api/remote/sessions", start.url.encodedPath)
        // remoteApi.startSession(deviceId, protocol): no notes, no sessionId for SYSTEM.
        assertEquals(Json.parseToJsonElement("""{"deviceId":187,"protocol":"powershell"}"""), body(start))

        val upgrade = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/remote/tunnel/$token", upgrade.url.encodedPath)
        assertEquals("connect.sid=s%3Aprod", upgrade.headers["Cookie"])
        assertEquals("ObliApp/test (obliance; Android)", upgrade.headers["User-Agent"])

        val shell = vm.session!!
        assertEquals(sessionId, shell.id)
        assertEquals(shell, SessionManager.find(sessionId))
        waitUntil(what = "waiting") { shell.phase.value == SessionPhase.Waiting }
        assertFalse(shell.toString().contains(token))

        // Typed before pairing: kept, nothing reaches the relay.
        shell.inputForTest("hostname\r".toByteArray())
        assertNull(relay.received.poll(200, TimeUnit.MILLISECONDS))

        relay.socket!!.send("""{"type":"paired"}""")
        // First frame after pairing: the size, then the queued input.
        assertEquals("T:" + """{"type":"resize","cols":80,"rows":24}""", relay.received.poll(5, TimeUnit.SECONDS))
        assertEquals("hostname\r".encodeUtf8(), relay.received.poll(5, TimeUnit.SECONDS))
        waitUntil(what = "connected") { shell.phase.value is SessionPhase.Connected }

        // Output split in the middle of « é » (4 096-byte frames do that).
        val out = "Copyright (C) Microsoft Corporation. Tous droits réservés.\r\nPS C:\\Windows\\system32> ".toByteArray()
        val cut = out.indexOfFirst { it == 0xC3.toByte() } + 1
        relay.socket!!.send(out.copyOfRange(0, cut).toByteString())
        relay.socket!!.send(out.copyOfRange(cut, out.size).toByteString())
        relay.socket!!.send("""{"type":"agent_info"}""") // control JSON: not terminal output
        waitUntil(what = "prompt") { shell.lastLine() == "PS C:\\Windows\\system32>" }
        assertEquals("Copyright (C) Microsoft Corporation. Tous droits réservés.", shell.transcript.lines().first())

        shell.resizeForTest(100, 30)
        assertEquals("T:" + """{"type":"resize","cols":100,"rows":30}""", relay.received.poll(5, TimeUnit.SECONDS))
        shell.engine.key(TermKey.UP, Mods())
        assertEquals("\u001B[A".encodeUtf8(), relay.received.poll(5, TimeUnit.SECONDS))
        shell.engine.text("c", Mods(ctrl = true))
        assertEquals(ByteString.of(3), relay.received.poll(5, TimeUnit.SECONDS))

        // « Terminer » : T1, POST /end, then the tunnel closes.
        prompter.confirmed.clear()
        val leave = runBlocking { vm.terminate(prompter.runner, texts) }
        assertTrue(leave)
        assertEquals(Tier.T1, prompter.confirmed.single().tier)
        val end = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", end.method)
        assertEquals("/api/remote/sessions/$sessionId/end", end.url.encodedPath)
        assertEquals("CLOSE:1000", relay.received.poll(5, TimeUnit.SECONDS))
        assertEquals(SessionPhase.Ended(EndReason.ENDED_BY_USER), shell.phase.value)
        assertNull(SessionManager.find(sessionId))
    }

    @Test fun a_chosen_windows_session_is_sent_as_sessionId() {
        val services = MockOriginServices(origin())
        server.enqueue(started())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(Relay()).build())
        val vm = vm(services, protocol = "cmd", wts = 2)
        runBlocking { vm.start(RecordingPrompter().runner, texts) }
        assertEquals(Json.parseToJsonElement("""{"deviceId":187,"protocol":"cmd","sessionId":2}"""), body(server.takeRequest(5, TimeUnit.SECONDS)!!))
    }

    @Test fun the_remote_end_closing_is_a_shell_exit_and_a_new_session_can_be_opened() {
        val services = MockOriginServices(origin())
        val relay = Relay()
        server.enqueue(started())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(relay).build())
        val vm = vm(services)
        runBlocking { vm.start(RecordingPrompter().runner, texts) }
        val shell = vm.session!!
        waitUntil { relay.socket != null && shell.phase.value == SessionPhase.Waiting }
        relay.socket!!.send("""{"type":"paired"}""")
        waitUntil { shell.phase.value is SessionPhase.Connected }
        relay.socket!!.close(1000, "")
        waitUntil(what = "ended") { shell.phase.value is SessionPhase.Ended }
        assertEquals(SessionPhase.Ended(EndReason.SHELL_CLOSED), shell.phase.value)
        // Still listed (the user sees why it ended) until closed or replaced.
        assertEquals(shell, SessionManager.find(sessionId))
        vm.forgetEnded()
        assertNull(SessionManager.find(sessionId))
        assertEquals(StartState.Idle, vm.ui.value.start)
        assertNull(vm.ui.value.sessionId)
    }

    @Test fun a_refused_upgrade_marks_the_session_expired() {
        val services = MockOriginServices(origin())
        server.enqueue(started())
        server.enqueue(MockResponse.Builder().code(401).body("Authentication required").build())
        val vm = vm(services)
        runBlocking { vm.start(RecordingPrompter().runner, texts) }
        val shell = vm.session!!
        waitUntil(what = "ended") { shell.phase.value is SessionPhase.Ended }
        assertEquals(SessionPhase.Ended(EndReason.SESSION_EXPIRED), shell.phase.value)
        assertEquals(AuthState.Expired, services.sessions.session(PROD)!!.auth.value)
    }

    @Test fun a_session_without_token_is_ended_at_once() {
        val services = MockOriginServices(origin())
        server.enqueue(started(withToken = false))
        server.enqueue(MockResponse.Builder().code(204).build())
        val vm = vm(services)
        runBlocking { vm.start(RecordingPrompter().runner, texts) }
        assertEquals(StartState.NoToken, vm.ui.value.start)
        server.takeRequest(5, TimeUnit.SECONDS)
        assertEquals("/api/remote/sessions/$sessionId/end", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
        assertTrue(SessionManager.entries.value.isEmpty())
    }

    @Test fun an_offline_device_is_blocked_before_any_call() {
        val services = MockOriginServices(origin())
        val prompter = RecordingPrompter()
        val vm = vm(services, deviceId = 211) // SRV-AD2, offline since 03:08
        runBlocking { vm.start(prompter.runner, texts) }
        assertEquals(StartState.Failed(ActionResult.Blocked("L'appareil est hors ligne.")), vm.ui.value.start)
        assertEquals(0, server.requestCount)
        assertTrue(prompter.confirmed.isEmpty())
    }

    @Test fun legacy_refusal_and_cancel_do_not_create_sessions() {
        val services = MockOriginServices(origin())
        server.enqueue(
            MockResponse.Builder().code(409).addHeader("Content-Type", "application/json")
                .body("""{"success":false,"error":"Remote sessions (SSH / CMD / PowerShell / ObliReach) are not supported on the legacy agent. Upgrade the agent first."}""").build(),
        )
        val vm = vm(services)
        runBlocking { vm.start(RecordingPrompter().runner, texts) }
        assertTrue((vm.ui.value.start as StartState.Failed).result is ActionResult.Failed)

        val declined = vm(services)
        runBlocking { declined.start(RecordingPrompter(accept = false).runner, texts) }
        assertEquals(StartState.Failed(ActionResult.Cancelled), declined.ui.value.start)
        assertEquals(1, server.requestCount)
        assertTrue(SessionManager.entries.value.isEmpty())
    }

    @Test fun an_open_session_is_resumed_instead_of_opening_another() {
        val services = MockOriginServices(origin())
        server.enqueue(started())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(Relay()).build())
        val first = vm(services)
        runBlocking { first.start(RecordingPrompter().runner, texts) }
        val again = vm(services)
        assertEquals(sessionId, again.ui.value.sessionId)
        val byId = TerminalViewModel(services, PROD, 187, "powershell", null, resumeId = sessionId, engineFactory = null)
        assertEquals(sessionId, byId.ui.value.sessionId)
        // Another protocol is another session.
        assertNull(vm(services, protocol = "cmd").ui.value.sessionId)
    }
}
