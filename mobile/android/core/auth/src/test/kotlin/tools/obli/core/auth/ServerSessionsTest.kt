package tools.obli.core.auth

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.model.ServerColor
import tools.obli.core.network.ObliHttp
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.shell.nav.Origins

class ServerSessionsTest {
    private class FakeRealtime(val name: String, val log: MutableList<String>) : RealtimeClient {
        override val state: StateFlow<ConnectionState> = MutableStateFlow(ConnectionState.DISCONNECTED)
        override val events: SharedFlow<RealtimeEvent> = MutableSharedFlow()
        override fun connect() { log += "connect:$name" }
        override fun reconnect() { log += "reconnect:$name" }
        override fun disconnect() { log += "disconnect:$name" }
        override fun emit(name: String, payload: JsonElement?) = false
        override suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long): JsonElement? = null
    }

    private class MemoryStore : ServerRegistryStore {
        var saved: ServerRegistryState? = null
        override suspend fun load() = saved
        override suspend fun save(state: ServerRegistryState) { saved = state }
    }

    private val scope = CoroutineScope(Dispatchers.Unconfined)
    private val server = MockWebServer().apply { start() }
    private val client = ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA")

    @After fun tearDown() { scope.cancel(); server.close() }

    private fun setUp(): Triple<ServerRegistry, ServerSessions, MutableList<String>> {
        val log = mutableListOf<String>()
        var n = 0
        val registry = ServerRegistry(MemoryStore()) { "id-${++n}" }
        val sessions = ServerSessions(registry, { p, now ->
            ServerSession(p.id, now, ObliHttp(p.origin, client), { s -> FakeRealtime(s.profile.monogram, log) })
        }, scope)
        return Triple(registry, sessions, log)
    }

    @Test fun oneSocketTheActiveServers() = runBlocking {
        val (registry, sessions, log) = setUp()
        val bh = (registry.add("obliance.binaryhearts.me", "BinaryHearts") as AddServerResult.Added).profile
        val at = (registry.add("atelier.binaryhearts.me", "Atelier") as AddServerResult.Added).profile
        assertEquals(bh.id, sessions.active.value!!.id)
        sessions.activate(bh.id)
        sessions.activate(at.id)
        assertEquals(at.id, sessions.active.value!!.id)
        assertEquals(listOf("connect:BH", "disconnect:BH", "connect:AT"), log)
    }

    @Test fun editingAProfileKeepsTheSession() = runBlocking {
        val (registry, sessions, _) = setUp()
        val cd = (registry.add("rmm.durand-associes.fr") as AddServerResult.Added).profile
        val before = sessions.session(cd.id)!!
        registry.rename(cd.id, "Client Durand")
        registry.recolor(cd.id, ServerColor.FUCHSIA)
        val after = sessions.session(cd.id)!!
        assertSame(before, after)
        assertEquals("Client Durand", after.profile.displayName)
        assertEquals("CD", after.profile.monogram)
    }

    @Test fun removedServerLosesItsSessionAndSocket() = runBlocking {
        val (registry, sessions, log) = setUp()
        val bh = (registry.add("obliance.binaryhearts.me", "BinaryHearts") as AddServerResult.Added).profile
        val at = (registry.add("atelier.binaryhearts.me", "Atelier") as AddServerResult.Added).profile
        sessions.activate(at.id)
        registry.remove(at.id)
        assertNull(sessions.session(at.id))
        assertTrue("disconnect:AT" in log)
        assertEquals(bh.id, sessions.active.value!!.id)
        assertEquals(listOf(bh.id), sessions.all().map { it.id })
    }

    @Test fun probeReadsAuthMe() = runBlocking {
        val origin = Origins.of(server.url("/").toString())!!
        val s = ServerSession(tools.obli.core.model.ServerId("x"), {
            tools.obli.core.model.ServerProfile(tools.obli.core.model.ServerId("x"), origin, "BH", ServerColor.VIOLET, "BH", 0)
        }, ObliHttp(origin, client), { error("no realtime") })
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(
            """{"success":true,"data":{"user":{"id":3,"username":"og_karim.benali","displayName":"Karim Benali","role":"admin","isActive":true,"foreignSource":"obligate","preferences":{}},"permissions":{},"requires2faSetup":false,"currentTenantId":1}}""",
        ).build())
        val state = s.probe() as AuthState.SignedIn
        assertEquals("Karim Benali", state.probe.user.label)
        assertTrue(state.probe.user.isPlatformAdmin && state.probe.user.isObligate)
        assertEquals(1L, state.probe.currentTenantId)

        // Offline afterwards: the signed-in state is kept.
        server.enqueue(MockResponse.Builder().code(502).body("bad gateway").build())
        assertSame(state, s.probe())

        server.enqueue(MockResponse.Builder().code(401).addHeader("Content-Type", "application/json").body("""{"success":false,"error":"Authentication required"}""").build())
        assertEquals(AuthState.Expired, s.probe())
    }
}
