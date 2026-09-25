package tools.obli.core.network

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.shell.nav.Origins

class ObliHttpTest {
    private val server = MockWebServer()
    private lateinit var http: ObliHttp
    private val jar = object : CookieJar {
        val store = mutableMapOf<String, MutableList<Cookie>>()
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) { store.getOrPut(url.host) { mutableListOf() }.addAll(cookies) }
        override fun loadForRequest(url: HttpUrl): List<Cookie> = store[url.host].orEmpty()
    }

    @Before fun setUp() {
        server.start()
        val origin = Origins.of(server.url("/").toString())!!
        http = ObliHttp(origin, ObliHttp.defaultClient(jar, "Mozilla/5.0 ObliApp/1.0 (obliance; Android)"))
    }

    @After fun tearDown() = server.close()

    private fun json(code: Int, body: String) =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json; charset=utf-8").body(body).build()

    @Test fun getSendsUserAgentAndCookieAndUnwraps() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).addHeader("Set-Cookie", "connect.sid=s%3Aabc; Path=/; HttpOnly")
            .addHeader("Content-Type", "application/json").body("""{"success":true,"data":{"id":7}}""").build())
        server.enqueue(json(200, """{"data":{"ok":true}}"""))
        val first = http.get("/api/auth/me")
        assertEquals(JsonPrimitive(7), ((first as ApiOutcome.Ok).value as JsonObject)["id"])
        http.get("/api/tenants")
        val r1 = server.takeRequest(); val r2 = server.takeRequest()
        assertEquals("Mozilla/5.0 ObliApp/1.0 (obliance; Android)", r1.headers["User-Agent"])
        assertNull(r1.headers["Cookie"])
        assertEquals("connect.sid=s%3Aabc", r2.headers["Cookie"])
    }

    @Test fun postBodyIsSentAsIs() = runBlocking {
        server.enqueue(json(202, """{"data":{"approvalId":41,"status":"pending_approval"}}"""))
        val body = buildJsonObject { put("type", "reboot"); put("deviceId", 508) }
        assertEquals(ApiOutcome.PendingApproval(41), http.post("/api/commands", body))
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals(body.toString(), req.body?.utf8())
        assertTrue(req.headers["Content-Type"]!!.startsWith("application/json"))
    }

    @Test fun otherOriginsAndOddPathsAreRefusedWithoutACall() = runBlocking {
        for (p in listOf("//evil.example.org/api", "https://evil.example.org/api", "api/x", "/a\\b", "/a b")) {
            assertEquals(ApiOutcome.Failure(null, FailureKind.CLIENT, "refused path"), http.get(p))
        }
        assertEquals(0, server.requestCount)
    }

    @Test fun redirectsAreNotFollowed() = runBlocking {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "https://evil.example.org/").build())
        assertEquals(ApiOutcome.Failure(302, FailureKind.CLIENT), http.get("/api/x"))
    }

    @Test fun networkFailure() = runBlocking {
        val dead = ObliHttp("https://127.0.0.1:1", ObliHttp.defaultClient(jar, "UA"))
        val out = dead.get("/health")
        assertEquals(FailureKind.NETWORK, (out as ApiOutcome.Failure).kind)
    }

    @Test fun postIsNeverRetried() = runBlocking {
        server.enqueue(MockResponse.Builder().onResponseStart(mockwebserver3.SocketEffect.ShutdownConnection).build())
        server.enqueue(json(200, "{}"))
        val out = http.post("/api/commands", buildJsonObject { put("type", "reboot") })
        assertEquals(FailureKind.NETWORK, (out as ApiOutcome.Failure).kind)
        assertEquals(1, server.requestCount)
        server.takeRequest(1, TimeUnit.SECONDS)
        Unit
    }
}
