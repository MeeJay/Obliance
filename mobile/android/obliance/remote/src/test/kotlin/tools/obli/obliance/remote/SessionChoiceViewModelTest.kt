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
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.obliance.api.ObliEvents

@OptIn(ExperimentalCoroutinesApi::class)
class SessionChoiceViewModelTest {
    private lateinit var server: MockWebServer
    private val main = Executors.newSingleThreadExecutor().asCoroutineDispatcher()

    @Before fun setUp() {
        Dispatchers.setMain(main)
        server = MockWebServer()
        server.start()
    }

    @After fun tearDown() {
        server.close()
        Dispatchers.resetMain()
        main.close()
    }

    private fun queued() = MockResponse.Builder().addHeader("Content-Type", "application/json")
        .body("""{"data":{"id":"c7a1","deviceId":187,"type":"list_wts_sessions","status":"sent","priority":"high","result":{}}}""").build()

    @Test fun lists_windows_sessions_like_the_web() {
        val services = MockOriginServices(server.url("/").toString().trimEnd('/'))
        server.enqueue(queued())
        val vm = SessionChoiceViewModel(services, PROD, 187, pollMs = 60_000)
        vm.load(RecordingPrompter().runner, "Lister les sessions Windows")

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/commands", request.url.encodedPath)
        // commandApi.enqueue(device.id, 'list_wts_sessions', {}, 'high')
        assertEquals(
            Json.parseToJsonElement("""{"deviceId":187,"type":"list_wts_sessions","payload":{},"priority":"high"}"""),
            Json.parseToJsonElement(request.body!!.utf8()),
        )
        // Another command's update is ignored; ours ends the wait.
        waitUntil { services.realtime.flow.subscriptionCount.value > 0 }
        runBlocking {
            services.realtime.flow.emit(RealtimeEvent(ObliEvents.COMMAND_UPDATED, Json.parseToJsonElement("""{"id":"other","status":"success","result":{"sessions":[]}}""")))
            services.realtime.flow.emit(
                RealtimeEvent(
                    ObliEvents.COMMAND_UPDATED,
                    Json.parseToJsonElement(
                        """{"id":"c7a1","deviceId":187,"type":"list_wts_sessions","status":"success","result":{"sessions":[
                        {"id":1,"name":"Console","username":"m.durand","domain":"ACME","state":"active"},
                        {"id":3,"name":"RDP-Tcp#3","username":"a.lefebvre","domain":"ACME","state":"disconnected"}]}}""",
                    ),
                ),
            )
        }
        waitUntil(what = "loaded") { vm.state.value is WtsState.Loaded }
        val sessions = (vm.state.value as WtsState.Loaded).sessions
        assertEquals(listOf(1, 3), sessions.map { it.id })
        assertEquals("m.durand", sessions[0].username)
        assertEquals("disconnected", sessions[1].state)
    }

    @Test fun polling_finds_the_result_when_the_socket_is_silent() {
        val services = MockOriginServices(server.url("/").toString().trimEnd('/'))
        server.enqueue(queued())
        server.enqueue(
            MockResponse.Builder().addHeader("Content-Type", "application/json")
                .body("""{"data":{"items":[{"id":"c7a1","deviceId":187,"type":"list_wts_sessions","status":"success","result":{"sessions":[]}}],"total":1}}""").build(),
        )
        val vm = SessionChoiceViewModel(services, PROD, 187, pollMs = 50)
        vm.load(RecordingPrompter().runner, "Lister")
        waitUntil(what = "loaded") { vm.state.value is WtsState.Loaded }
        assertEquals(emptyList<WtsSession>(), (vm.state.value as WtsState.Loaded).sessions)
        server.takeRequest(5, TimeUnit.SECONDS)
        assertEquals("/api/commands?deviceId=187&limit=20", server.takeRequest(5, TimeUnit.SECONDS)!!.target)
    }

    @Test fun a_refused_listing_leaves_system_only() {
        val services = MockOriginServices(server.url("/").toString().trimEnd('/'))
        server.enqueue(MockResponse.Builder().code(503).addHeader("Content-Type", "application/json").body("""{"error":"Agent offline"}""").build())
        val vm = SessionChoiceViewModel(services, PROD, 187)
        vm.load(RecordingPrompter().runner, "Lister")
        waitUntil(what = "unavailable") { vm.state.value == WtsState.Unavailable }
    }
}
