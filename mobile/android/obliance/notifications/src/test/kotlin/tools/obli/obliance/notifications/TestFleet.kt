package tools.obli.obliance.notifications

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.service.notification.StatusBarNotification
import androidx.test.core.app.ApplicationProvider
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.CookieJar
import org.robolectric.Shadows.shadowOf
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.auth.ServerRegistryStore
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ObliHttp
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.obliance.data.DefaultObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.shell.nav.Origins

/** One fake Obliance server: answers by "METHOD path" and records every request. */
class FakeServer : AutoCloseable {
    val routes = ConcurrentHashMap<String, Pair<Int, String>>()
    val requests = CopyOnWriteArrayList<String>()
    val delays = ConcurrentHashMap<String, Long>()
    private val server = MockWebServer()

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val key = "${request.method} ${request.url.encodedPath}"
                requests += key
                val (code, body) = routes[key] ?: (404 to """{"error":"Not found"}""")
                val builder = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body)
                delays[key]?.let { builder.headersDelay(it, java.util.concurrent.TimeUnit.MILLISECONDS) }
                return builder.build()
            }
        }
        server.start()
    }

    val origin: String get() = Origins.of(server.url("/").toString())!!

    fun on(route: String, body: String, code: Int = 200) {
        routes[route] = code to body
    }

    fun count(route: String): Int = requests.count { it == route }

    override fun close() = server.close()
}

class SilentRealtime : RealtimeClient {
    override val state = kotlinx.coroutines.flow.MutableStateFlow(ConnectionState.DISCONNECTED)
    override val events = kotlinx.coroutines.flow.MutableSharedFlow<RealtimeEvent>()
    override fun connect() = Unit
    override fun reconnect() = Unit
    override fun disconnect() = Unit
    override fun emit(name: String, payload: kotlinx.serialization.json.JsonElement?) = false
    override suspend fun emitWithAck(name: String, payload: kotlinx.serialization.json.JsonElement?, timeoutMs: Long): kotlinx.serialization.json.JsonElement? = null
}

/** A live alert row as liveAlert.service.ts rowToAlert sends it. */
data class Row(
    val id: Long,
    val severity: String,
    val title: String,
    val message: String = "",
    val tenantId: Long = SampleData.DEFAULT_TENANT,
    val device: Long? = null,
    val at: String = "2026-09-25T01:00:00Z",
    val readAt: String? = null,
)

fun feedJson(vararg rows: Row): String = buildJsonObject {
    put(
        "alerts",
        JsonArray(
            rows.map { r ->
                buildJsonObject {
                    put("id", r.id)
                    put("tenantId", r.tenantId)
                    put("tenantName", if (r.tenantId == SampleData.ACME_TENANT) "ACME" else "Default")
                    put("severity", r.severity)
                    put("title", r.title)
                    put("message", r.message)
                    put("navigateTo", r.device?.let { JsonPrimitive("/devices/$it") } ?: JsonNull)
                    put("stableKey", JsonNull)
                    put("readAt", r.readAt?.let(::JsonPrimitive) ?: JsonNull)
                    put("createdAt", r.at)
                }
            },
        ),
    )
    put(
        "tenants",
        buildJsonArray {
            add(buildJsonObject { put("id", SampleData.DEFAULT_TENANT); put("name", "Default") })
            add(buildJsonObject { put("id", SampleData.ACME_TENANT); put("name", "ACME") })
        },
    )
}.toString()

fun approvalsJson(vararg approvals: Triple<Long, String, String>): String =
    """{"success":true,"data":[""" + approvals.joinToString(",") { (id, status, expiresAt) ->
        """{"id":$id,"tenantId":4,"requestedBy":12,"requestedByName":"og_julien.moreau","requestType":"device_uninstall","description":"Désinstaller l'agent de PC-ATELIER-02","payload":{"deviceId":233},"status":"$status","createdAt":"2026-09-25T01:21:08Z","expiresAt":"$expiresAt"}"""
    } + "]}"

const val KIOSK_PENDING = """{"id":240,"tenantId":4,"tenantName":"ACME","hostname":"KIOSK-ACCUEIL-02","osName":"Windows 11 IoT Enterprise","ipLocal":"10.0.3.41","status":"pending","approvalStatus":"pending","createdAt":"2026-09-25T00:59:00Z"}"""

/** A pending agent of ACME, as GET /api/devices lists it. */
fun pendingJson(id: Long, host: String = "PC-DEPLOY-%03d".format(id)): String =
    """{"id":$id,"tenantId":4,"tenantName":"ACME","hostname":"$host","osName":"Windows 11 Pro","ipLocal":"10.0.4.${id % 250}","status":"pending","approvalStatus":"pending","createdAt":"2026-09-25T01:00:00Z"}"""

fun devicesJson(vararg items: String): String = """{"success":true,"data":{"items":[${items.joinToString(",")}],"total":${items.size},"page":1,"pageSize":50}}"""

fun me(role: String, tenant: Long = 1): String {
    val (id, user) = if (role == "admin") 3 to "og_karim.benali" else 7 to "karim.benali"
    return """{"success":true,"data":{"user":{"id":$id,"username":"$user","displayName":"Karim Benali","role":"$role"},"permissions":{},"requires2faSetup":false,"currentTenantId":$tenant}}"""
}

fun permissionsJson(vararg capabilities: String): String =
    """{"success":true,"data":{"canCreate":false,"teams":[],"permissions":{},"tenantCapabilities":[${capabilities.joinToString(",") { "\"$it\"" }}]}}"""

const val EXPIRED_BODY = """{"success":false,"error":"Authentication required"}"""
const val NO_APPROVALS = """{"success":true,"data":[]}"""

/** Records what the engine asked WorkManager for. */
class RecordingWork : WorkScheduler {
    val log = CopyOnWriteArrayList<String>()
    override fun enqueuePeriodic() { log += "periodic" }
    override fun cancelPeriodic() { log += "cancel-periodic" }
    override fun checkNow() { log += "check-now" }
    override fun scheduleReminder(serverId: ServerId, alertId: Long, attempt: Int) { log += "reminder ${serverId.value} $alertId $attempt" }
    override fun cancelReminder(serverId: ServerId, alertId: Long) { log += "cancel-reminder ${serverId.value} $alertId" }
    override fun cancelReminders(serverId: ServerId) { log += "cancel-reminders ${serverId.value}" }
}

/**
 * The real Android publisher, plus a record of what was posted (silent flag,
 * route…). [drop]: like Android over its per-app quota, `notify` "succeeds"
 * but nothing shows.
 */
internal class RecordingPublisher(private val delegate: NotificationPublisher) : NotificationPublisher by delegate {
    val posted = CopyOnWriteArrayList<PlannedNotification>()
    @Volatile var drop: (PlannedNotification) -> Boolean = { false }
    override fun post(n: PlannedNotification): Boolean {
        if (drop(n)) return true.also { posted += n }
        return delegate.post(n).also { if (it) posted += n }
    }
}

/**
 * Up to three §4 servers (Obliance Prod, Dev, Qual) behind MockWebServers,
 * the real registry, sessions and repositories, the real Android publisher
 * (Robolectric's NotificationManager) and a fixed clock (03:20 in Paris).
 */
internal class TestFleet(serverCount: Int = 3) : AutoCloseable {
    val app: Application = ApplicationProvider.getApplicationContext()
    val prod = FakeServer()
    val dev = FakeServer()
    val qual = FakeServer()
    val prodId = SampleData.PROD
    val devId = SampleData.DEV
    val qualId = SampleData.QUAL
    private val mocks = mapOf(prodId to prod, devId to dev, qualId to qual)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val client = ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA")

    private class MemoryStore(var saved: ServerRegistryState?) : ServerRegistryStore {
        override suspend fun load() = saved
        override suspend fun save(state: ServerRegistryState) { saved = state }
    }

    val registry = ServerRegistry(MemoryStore(ServerRegistryState(SampleData.profiles.take(serverCount), prodId))).also { runBlocking { it.load() } }
    val sessions = ServerSessions(registry, { p, now -> ServerSession(p.id, now, ObliHttp(mocks.getValue(p.id).origin, client), { SilentRealtime() }) }, scope)
    val services = DefaultObliServices(registry, sessions, httpFor = { ObliHttp(it, client) }, clearCookies = {}, scope = scope)
    val store = InMemoryNotificationStore()
    val work = RecordingWork()
    val launch: (android.content.Context) -> Intent = { ctx -> Intent().setClassName(ctx.packageName, "tools.obli.obliance.app.MainActivity") }
    val publisher = RecordingPublisher(AndroidNotificationPublisher(app, launch))
    var now: Instant = NIGHT
    var foreground = false
    val nm: NotificationManager = app.getSystemService(NotificationManager::class.java)

    init {
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        NotificationChannels.ensure(app, registry.state.value.profiles)
        prod.on("GET /api/auth/me", me("admin"))
        dev.on("GET /api/auth/me", me("admin"))
        qual.on("GET /api/auth/me", me("user"))
        for (s in listOf(prod, dev, qual)) {
            s.on("GET /api/live-alerts/all", feedJson())
            s.on("GET /api/approvals", NO_APPROVALS)
            s.on("GET /api/auth/permissions", permissionsJson())
            s.on("GET /api/devices", devicesJson())
        }
    }

    fun server(id: ServerId): FakeServer = mocks.getValue(id)

    /** [timeoutMs]: budget of each network step; [verifyDelayMs]: Robolectric posts at once. */
    fun pass(timeoutMs: Long = 5_000, verifyDelayMs: Long = 0): List<ServerPassReport> = runBlocking {
        NotificationPass(
            services, store, publisher,
            clock = { now.toEpochMilli() },
            isForeground = { foreground },
            texts = NotificationTexts(app.resources, PARIS),
            work = work,
            zone = PARIS,
            stepTimeoutMs = timeoutMs,
            verifyDelayMs = verifyDelayMs,
        ).run()
    }

    fun state(id: ServerId): ServerNotifState = store.current.server(id)

    /** Notifications on screen (group summaries excluded). */
    fun shown(): List<StatusBarNotification> = nm.activeNotifications.filter { it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0 }

    fun summaries(): List<StatusBarNotification> = nm.activeNotifications.filter { it.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0 }

    fun shownFor(id: ServerId) = shown().filter { it.tag == id.value }

    fun installRuntime(): NotificationRuntime = ObliNotifications.install(
        context = app,
        services = services,
        ready = kotlinx.coroutines.flow.MutableStateFlow(true),
        launchIntent = launch,
        store = store,
        work = work,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
        publisher = publisher,
        clock = { now.toEpochMilli() },
        zone = PARIS,
    )

    override fun close() {
        ObliNotifications.runtime?.scope?.cancel()
        ObliNotifications.runtime = null
        scope.cancel()
        prod.close()
        dev.close()
        qual.close()
    }

    companion object {
        val PARIS: ZoneId = ZoneId.of("Europe/Paris")

        /** 03:20 in Paris on Friday 25 September 2026 (design doc §4). */
        val NIGHT: Instant = Instant.parse("2026-09-25T01:20:00Z")
    }
}

val StatusBarNotification.title: String? get() = notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
val StatusBarNotification.text: String? get() = notification.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
val StatusBarNotification.actionTitles: List<String> get() = notification.actions.orEmpty().map { it.title.toString() }

/** The intent a PendingIntent would send (Robolectric). */
fun PendingIntent.saved(): Intent = shadowOf(this).savedIntent
