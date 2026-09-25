package tools.obli.obliance.data.sample

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.auth.ServerRegistryStore
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ObliHttp
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.obliance.api.Approval
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.api.Health
import tools.obli.obliance.api.LoginResult
import tools.obli.obliance.api.SsoConfig
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.api.TwoFactorMethod
import tools.obli.obliance.api.TwoFactorMethods
import tools.obli.obliance.data.AlertsRepository
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.AuthRepository
import tools.obli.obliance.data.DevicesRepository
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.LiveSample
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.ServerApproval
import tools.obli.obliance.data.ServerCheck
import tools.obli.obliance.data.ServerFeed
import tools.obli.obliance.data.SignInResult
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.TenantsRepository
import tools.obli.obliance.domain.ServerAlert
import tools.obli.shell.net.ServerUrl

/**
 * In-memory [ObliServices] over [SampleData] (design doc §4), for `@Preview`s,
 * Roborazzi screenshot tests and UI tests. Nothing touches the network: the
 * sessions are signed in from the start, actions change the in-memory state.
 *
 * @param serverCount 1 (single-server look: no tiles), 2 or 3 servers.
 */
class SampleObliServices(
    serverCount: Int = 3,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
) : ObliServices {
    private val store = object : ServerRegistryStore {
        var saved: ServerRegistryState? = ServerRegistryState(SampleData.profiles.take(serverCount.coerceIn(1, 3)), SampleData.PROD)
        override suspend fun load() = saved
        override suspend fun save(state: ServerRegistryState) { saved = state }
    }

    override val registry: ServerRegistry = ServerRegistry(store).also { runBlocking { it.load() } }

    private val client by lazy { OkHttpClient() }

    override val sessions: ServerSessions = ServerSessions(
        registry,
        { profile, now -> ServerSession(profile.id, now, ObliHttp(profile.origin, client), { SilentRealtime() }).also { it.markSignedIn(SampleData.probe(profile.id)) } },
        scope,
    )

    override val auth: AuthRepository = SampleAuth()
    override val tenants: TenantsRepository = SampleTenants()
    override val alerts: AlertsRepository = SampleAlerts()
    override val devices: DevicesRepository = SampleDevices()

    override suspend fun openOn(serverId: ServerId): ServerId? {
        val previous = registry.state.value.activeId
        if (previous == serverId || registry.state.value.byId(serverId) == null) return null
        sessions.activate(serverId)
        return previous
    }

    /** A connected socket that never emits (tests may use [emit] on their own fake instead). */
    private class SilentRealtime : RealtimeClient {
        override val state: StateFlow<ConnectionState> = MutableStateFlow(ConnectionState.CONNECTED)
        override val events: SharedFlow<RealtimeEvent> = MutableSharedFlow()
        override fun connect() = Unit
        override fun reconnect() = Unit
        override fun disconnect() = Unit
        override fun emit(name: String, payload: JsonElement?) = false
        override suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long): JsonElement? = null
    }

    private inner class SampleAuth : AuthRepository {
        override suspend fun checkServer(address: String): ServerCheck = when (val r = ServerUrl.normalize(address)) {
            is ServerUrl.Result.Invalid -> ServerCheck.Invalid(r.problem)
            is ServerUrl.Result.Ok -> ServerCheck.Ok(
                origin = r.url,
                health = Health("ok", "5.1.110"),
                sso = SsoConfig("https://id.example.org", obligateReachable = true, obligateEnabled = true),
                existing = registry.state.value.byUrl(r.url),
            )
        }

        override suspend fun login(origin: String, username: String, password: String): LoginResult = when {
            password.isEmpty() -> LoginResult.InvalidCredentials
            username.trim() == SampleData.karimLocal.username -> LoginResult.TwoFactorRequired(TwoFactorMethods(totp = true))
            else -> LoginResult.SignedIn(SampleData.karimSso)
        }

        override suspend fun verifyTwoFactor(origin: String, method: TwoFactorMethod, code: String): LoginResult =
            if (code.length == 6) LoginResult.SignedIn(SampleData.karimLocal) else LoginResult.InvalidCode

        override suspend fun resendEmailCode(origin: String): ApiOutcome<Unit> = ApiOutcome.Ok(Unit)

        override suspend fun completeSignIn(origin: String, displayName: String?, activate: Boolean): SignInResult {
            val profile = registry.state.value.byUrl(origin)
                ?: (registry.add(origin, displayName) as? tools.obli.core.auth.AddServerResult.Added)?.profile
                ?: return SignInResult.NotSignedIn(AuthState.Unknown)
            val probe = SampleData.probe(profile.id)
            sessions.session(profile.id)?.markSignedIn(probe)
            if (activate) sessions.activate(profile.id)
            return SignInResult.Done(profile, probe)
        }

        override suspend fun signOut(serverId: ServerId): ApiOutcome<Unit> {
            sessions.session(serverId)?.markSignedOut()
            return ApiOutcome.Ok(Unit)
        }
    }

    private inner class SampleTenants : TenantsRepository {
        private val state = MutableStateFlow(TenantScope(SampleData.PROD, SampleData.tenants, SampleData.DEFAULT_TENANT))
        override val scope: StateFlow<TenantScope> = state.asStateFlow()
        override suspend fun refresh(): ApiOutcome<List<Tenant>> = ApiOutcome.Ok(state.value.tenants)
        override suspend fun switchTo(tenantId: Long, serverId: ServerId?): ApiOutcome<Unit> {
            val id = serverId ?: registry.state.value.activeId ?: return ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server")
            val session = sessions.session(id) ?: return ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server")
            val probe = (session.auth.value as? AuthState.SignedIn)?.probe ?: SampleData.probe(id)
            session.markSignedIn(probe.copy(currentTenantId = tenantId))
            if (id == state.value.serverId) state.update { it.copy(currentTenantId = tenantId) }
            return ApiOutcome.Ok(Unit)
        }
    }

    private inner class SampleAlerts : AlertsRepository {
        private val ids = registry.state.value.profiles.map { it.id }.toSet()
        private val state = MutableStateFlow(
            AlertsSnapshot(
                alerts = SampleData.alerts.filter { it.serverId in ids },
                escalations = SampleData.escalations.filter { it.serverId in ids },
                feeds = registry.state.value.profiles.map { ServerFeed(it.id, FeedStatus.OK, UPDATED_AT) },
                updatedAt = UPDATED_AT,
            ),
        )
        override val snapshot: StateFlow<AlertsSnapshot> = state.asStateFlow()
        override suspend fun refresh() = Unit

        override suspend fun markRead(alert: ServerAlert): ApiOutcome<Unit> {
            state.update { s -> s.copy(alerts = s.alerts.map { if (it == alert) it.copy(alert = it.alert.copy(readAt = "2026-09-25T01:14:00Z")) else it }) }
            return ApiOutcome.Ok(Unit)
        }

        override suspend fun delete(alert: ServerAlert): ApiOutcome<Unit> {
            state.update { s -> s.copy(alerts = s.alerts - alert) }
            return ApiOutcome.Ok(Unit)
        }

        override suspend fun markAllRead(serverId: ServerId): ApiOutcome<Unit> {
            state.update { s -> s.copy(alerts = s.alerts.map { if (it.serverId == serverId) it.copy(alert = it.alert.copy(readAt = "2026-09-25T01:14:00Z")) else it }) }
            return ApiOutcome.Ok(Unit)
        }

        override suspend fun approve(item: ServerApproval, reason: String?, extra: JsonObject?): ApiOutcome<Approval> = resolve(item, "approved")
        override suspend fun deny(item: ServerApproval, reason: String?, extra: JsonObject?): ApiOutcome<Approval> = resolve(item, "denied")

        private fun resolve(item: ServerApproval, status: String): ApiOutcome<Approval> {
            // Like approval.service.ts: the request is looked up in the SESSION tenant of its server.
            val current = (sessions.session(item.serverId)?.auth?.value as? AuthState.SignedIn)?.probe?.currentTenantId
            if (item.approval.tenantId != null && current != null && current != item.approval.tenantId) {
                return ApiOutcome.Failure(404, FailureKind.NOT_FOUND, "Not found")
            }
            state.update { s -> s.copy(escalations = s.escalations - item) }
            return ApiOutcome.Ok(item.approval.copy(status = status))
        }
    }

    private inner class SampleDevices : DevicesRepository {
        private fun devicesOf(serverId: ServerId?): List<Device> {
            val id = serverId ?: registry.state.value.activeId
            return if (id == SampleData.PROD) SampleData.devices else SampleData.otherDevices[id].orEmpty()
        }

        override suspend fun page(query: DeviceQuery, serverId: ServerId?): ApiOutcome<DevicePage> {
            val all = devicesOf(serverId).filter { d ->
                (query.search.isNullOrBlank() || d.label.contains(query.search!!.trim(), ignoreCase = true) || d.ipLocal.orEmpty().contains(query.search!!.trim())) &&
                    (query.status.isNullOrBlank() || d.status == query.status)
            }
            val from = ((query.page - 1) * query.pageSize).coerceAtMost(all.size)
            return ApiOutcome.Ok(DevicePage(all.drop(from).take(query.pageSize), all.size, query.page, query.pageSize))
        }

        override suspend fun summary(serverId: ServerId?): ApiOutcome<FleetSummary> {
            val id = serverId ?: registry.state.value.activeId
            if (id == SampleData.PROD) return ApiOutcome.Ok(SampleData.summary)
            val list = devicesOf(id)
            return ApiOutcome.Ok(
                FleetSummary(
                    total = list.size,
                    online = list.count { it.status == "online" },
                    offline = list.count { it.status == "offline" },
                    warning = list.count { it.status == "warning" },
                    critical = list.count { it.status == "critical" },
                ),
            )
        }

        override suspend fun detail(serverId: ServerId, deviceId: Long): ApiOutcome<Device> =
            devicesOf(serverId).firstOrNull { it.id == deviceId }?.let { ApiOutcome.Ok(it) }
                ?: ApiOutcome.Failure(404, FailureKind.NOT_FOUND, "Device not found")

        override fun liveMetrics(serverId: ServerId, deviceId: Long): Flow<LiveSample> =
            devicesOf(serverId).firstOrNull { it.id == deviceId }?.latestMetrics
                ?.let { flowOf(LiveSample(it, live = true, receivedAt = UPDATED_AT)) } ?: emptyFlow()

        override fun signals(): Flow<DeviceSignal> = emptyFlow()
    }

    private companion object {
        /** 2026-09-25T01:14:00Z (03:14 in Paris). */
        const val UPDATED_AT = 1_790_298_840_000L
    }
}
