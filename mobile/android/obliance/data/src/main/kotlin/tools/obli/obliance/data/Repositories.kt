package tools.obli.obliance.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject
import tools.obli.core.auth.AddServerResult
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.model.SessionProbe
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.Approval
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.api.Health
import tools.obli.obliance.api.LoginResult
import tools.obli.obliance.api.MASTER_TENANT_ID
import tools.obli.obliance.api.SsoConfig
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.api.TwoFactorMethod
import tools.obli.obliance.domain.ServerAlert
import tools.obli.obliance.domain.Triage
import tools.obli.obliance.domain.TriageList
import tools.obli.shell.alerts.AlertSeverity
import tools.obli.shell.net.ServerUrl

// ---------------------------------------------------------------------------
// Authentication (S01 sign-in, S03 session expired, S93 add a server)
// ---------------------------------------------------------------------------

/** Result of checking a typed server address before signing in. */
sealed interface ServerCheck {
    /** An Obliance server answered at [origin]. [existing] = a profile already uses this origin. */
    data class Ok(val origin: String, val health: Health, val sso: SsoConfig, val existing: ServerProfile?) : ServerCheck

    /** The address itself is unusable (empty, http://, credentials…). */
    data class Invalid(val problem: ServerUrl.Problem) : ServerCheck

    /** Something answered, but not an Obli server (`/health` is not `{status:'ok'}`). */
    data class NotObliance(val origin: String) : ServerCheck

    /** No usable answer (DNS, TLS, timeout, 5xx). */
    data class Unreachable(val origin: String, val outcome: ApiOutcome<Nothing>) : ServerCheck

    /** 8 servers are configured already and [origin] is not one of them. */
    data class LimitReached(val origin: String) : ServerCheck
}

sealed interface SignInResult {
    /** The profile exists (created if new), its session is signed in; active if requested. */
    data class Done(val profile: ServerProfile, val probe: SessionProbe) : SignInResult

    /** The registry refused the server (invalid address, limit reached). */
    data class Refused(val reason: AddServerResult) : SignInResult

    /** `/api/auth/me` did not confirm the session (cookie refused, server down…). */
    data class NotSignedIn(val state: AuthState) : SignInResult
}

/**
 * Sign-in and sign-out of one server. The steps take an ORIGIN (not a
 * ServerId) because a new server has no profile until [completeSignIn].
 * The shared cookie jar carries the session cookie from [login] to
 * [verifyTwoFactor] to [completeSignIn]: always use the same origin.
 */
interface AuthRepository {
    /** Normalises [address] (https only), then `GET /health` + `GET /api/auth/sso-config`. */
    suspend fun checkServer(address: String): ServerCheck

    /** `POST /api/auth/login` on [origin]. */
    suspend fun login(origin: String, username: String, password: String): LoginResult

    /** `POST /api/profile/2fa/verify` after [LoginResult.TwoFactorRequired]. */
    suspend fun verifyTwoFactor(origin: String, method: TwoFactorMethod, code: String): LoginResult

    /** `POST /api/profile/2fa/resend-email` while a login is pending. */
    suspend fun resendEmailCode(origin: String): ApiOutcome<Unit>

    /**
     * After [LoginResult.SignedIn]: adds the profile when [origin] is new
     * ([displayName] or the host), confirms the session with `/api/auth/me`
     * and, when [activate], makes it the active server (its socket connects).
     * Runs in the application scope: leaving the screen does not cancel it.
     */
    suspend fun completeSignIn(origin: String, displayName: String? = null, activate: Boolean = true): SignInResult

    /**
     * Signs out of ONE server (design doc §2.10 "Se déconnecter de ce serveur"):
     * `POST /api/auth/logout`, its cookies are cleared, its session becomes
     * SignedOut and its socket closes. The profile stays. The local sign-out
     * happens even when the server cannot be reached.
     */
    suspend fun signOut(serverId: ServerId): ApiOutcome<Unit>
}

// ---------------------------------------------------------------------------
// Tenants of the active server (S81)
// ---------------------------------------------------------------------------

data class TenantScope(
    /** The active server these tenants belong to (null: no server yet). */
    val serverId: ServerId? = null,
    val tenants: List<Tenant> = emptyList(),
    /** The SESSION tenant (`currentTenantId` of `/api/auth/me`). */
    val currentTenantId: Long? = null,
    val loading: Boolean = false,
    /** Last failure of the tenant list, if any. */
    val error: ApiOutcome<Nothing>? = null,
    /**
     * Global-view filter (design doc §2.3 "Filtrer la vue globale"): the active
     * profile's stored filter (ServerProfile.viewFilter) restricted to the ids
     * present in [tenants]. EMPTY when the session is not on the master tenant
     * ([isGlobalView] false) or when it would select every tenant. Build it with
     * [effectiveViewFilter] / [withStoredViewFilter]. Session and socket are not
     * involved: only list requests change ([listTenantIds]).
     */
    val viewFilter: Set<Long> = emptySet(),
) {
    val current: Tenant? get() = tenants.firstOrNull { it.id == currentTenantId }

    /** Session on the master tenant: lists cover every tenant ("Default · Vue globale"). */
    val isGlobalView: Boolean get() = currentTenantId == MASTER_TENANT_ID

    /** The scope sheet only offers "Travailler dans un tenant" with 2 tenants or more. */
    val canSwitch: Boolean get() = tenants.size >= 2

    /** A global-view filter is applied (top bar chip "ACME · filtre"). */
    val viewFiltered: Boolean get() = viewFilter.isNotEmpty()

    /** The filtered tenants, in [tenants] order (empty without a filter). */
    val filterTenants: List<Tenant> get() = if (viewFilter.isEmpty()) emptyList() else tenants.filter { it.id in viewFilter }

    /** What list screens pass as `DeviceQuery.tenantIds`: the sorted filter, or empty (no `tenantIds=`). */
    val listTenantIds: List<Long> get() = viewFilter.sorted()

    /** This scope with [stored] (the profile's filter) applied by the rules of [viewFilter]. */
    fun withStoredViewFilter(stored: Collection<Long>): TenantScope =
        copy(viewFilter = effectiveViewFilter(stored, tenants, currentTenantId))

    companion object {
        /**
         * The rules of [viewFilter]: [stored] ids restricted to [tenants]; empty
         * outside the master tenant, and empty when every tenant would be selected
         * (that is "Tous les tenants", not a filter).
         */
        fun effectiveViewFilter(stored: Collection<Long>, tenants: List<Tenant>, currentTenantId: Long?): Set<Long> {
            if (stored.isEmpty() || currentTenantId != MASTER_TENANT_ID) return emptySet()
            val known = tenants.mapTo(HashSet()) { it.id }
            val kept = stored.filterTo(LinkedHashSet()) { it in known }
            return if (kept.size >= known.size) emptySet() else kept
        }
    }
}

interface TenantsRepository {
    /** Tenants and session tenant of the ACTIVE server; follows server switches. */
    val scope: StateFlow<TenantScope>

    /** Reloads `GET /api/tenants` of the active server. */
    suspend fun refresh(): ApiOutcome<List<Tenant>>

    /**
     * `POST /api/tenant/switch` on [serverId] (null = the active server), then:
     * `/api/auth/me` is probed again (new session tenant), the socket reconnects
     * when it is the active server (rooms are joined at connection) and the last
     * tenant is remembered in the profile. Runs in the application scope: leaving
     * the calling screen does not cancel it halfway. Screens reload when
     * [TenantScope.currentTenantId] changes.
     */
    suspend fun switchTo(tenantId: Long, serverId: ServerId? = null): ApiOutcome<Unit>

    /**
     * "Filtrer la vue globale" (design doc §2.3, §5 S81): stores [tenantIds] as
     * the global-view filter of [serverId] (null = the active server) in its
     * profile; [scope] re-emits at once with [TenantScope.viewFilter]. No server
     * call: session, tenant and socket stay as they are; list screens reload with
     * `tenantIds=` ([TenantScope.listTenantIds]). An empty set, or every tenant of
     * the loaded list, clears the filter. The filter is kept per server and
     * survives tenant switches (it applies again back on the master tenant).
     * Returns false when the server is unknown.
     *
     * The default (for test fakes) stores nothing.
     */
    suspend fun setViewFilter(tenantIds: Set<Long>, serverId: ServerId? = null): Boolean = false
}

// ---------------------------------------------------------------------------
// "À traiter": alerts and approvals of every connected server (S10, S11)
// ---------------------------------------------------------------------------

/** A two-person approval request with the server it lives on ("escalation" item). */
data class ServerApproval(val serverId: ServerId, val approval: Approval)

enum class FeedStatus {
    /** Never loaded yet. */
    LOADING,
    OK,

    /** 401: shown greyed with "Session expirée · Se reconnecter"; last items kept. */
    EXPIRED,

    /** Network or server error; last items kept. */
    UNREACHABLE,

    /** Signed out of this server: no items. */
    SIGNED_OUT,

    /** The profile has `includeInTriage = false`: no items. */
    EXCLUDED,
}

data class ServerFeed(val serverId: ServerId, val status: FeedStatus, val updatedAt: Long? = null)

data class AlertsSnapshot(
    /** Alerts of every included server, each with its [ServerAlert.serverId]. */
    val alerts: List<ServerAlert> = emptyList(),
    /** Pending approvals of the servers where the user is a platform admin. */
    val escalations: List<ServerApproval> = emptyList(),
    /** Per-server state, in registry order. */
    val feeds: List<ServerFeed> = emptyList(),
    val refreshing: Boolean = false,
    /** Time of the last completed refresh (epoch ms). */
    val updatedAt: Long? = null,
) {
    /** The sorted, filtered list of S10 (domain rules: priority, unread first, outages). */
    fun triage(serverFilter: Set<ServerId>? = null, severityFilter: Set<AlertSeverity>? = null): TriageList =
        Triage.build(alerts, serverFilter, severityFilter)

    /** Badge of "À traiter" (§2.1): unread critical + warning, plus pending approvals. */
    val badgeCount: Int
        get() = alerts.count { it.alert.readAt == null && it.alert.severity != AlertSeverity.INFO } +
            escalations.count { it.approval.isPending }

    fun feed(serverId: ServerId): ServerFeed? = feeds.firstOrNull { it.serverId == serverId }
}

/**
 * The multi-server "À traiter" feed. [snapshot] is hot while collected: it
 * refreshes every 60 s and listens to `NOTIFICATION_NEW` / `NOTIFICATION_RESOLVED`
 * / `APPROVAL_*` on the active server's socket; nothing is polled when nobody
 * collects it. Every action goes to the item's OWN server (never a switch,
 * design doc §2.10 item 4). Only ACTIVE alerts are listed: since 0.3.1 the
 * server leaves resolved ones out, and a `NOTIFICATION_RESOLVED` removes them
 * at once (list and badge).
 */
interface AlertsRepository {
    val snapshot: StateFlow<AlertsSnapshot>

    /** Reloads every included server now (pull to refresh). */
    suspend fun refresh()

    /** `PATCH /api/live-alerts/:id/read` on the alert's server; the item is updated locally on success. */
    suspend fun markRead(alert: ServerAlert): ApiOutcome<Unit>

    /** `DELETE /api/live-alerts/:id` on the alert's server; removed locally on success. */
    suspend fun delete(alert: ServerAlert): ApiOutcome<Unit>

    /** `POST /api/live-alerts/read-all` on [serverId]: only its SESSION tenant; that server is reloaded. */
    suspend fun markAllRead(serverId: ServerId): ApiOutcome<Unit>

    /**
     * Approve / deny on the approval's server. [extra] carries step-up fields
     * (`twoFactorCode`, `trustIp`) when the call runs inside ActionRunner (T2).
     */
    suspend fun approve(item: ServerApproval, reason: String? = null, extra: JsonObject? = null): ApiOutcome<Approval>

    suspend fun deny(item: ServerApproval, reason: String? = null, extra: JsonObject? = null): ApiOutcome<Approval>
}

// ---------------------------------------------------------------------------
// Devices (S20, S30, S70) — the ACTIVE server unless a serverId is given
// ---------------------------------------------------------------------------

/** One live metrics sample of a device. [live] = pushed on the socket, false = REST fallback. */
data class LiveSample(val metrics: DeviceMetrics, val live: Boolean, val receivedAt: Long)

interface DevicesRepository {
    /** `GET /api/devices` on [serverId] (null = the active server). */
    suspend fun page(query: DeviceQuery = DeviceQuery(), serverId: ServerId? = null): ApiOutcome<DevicePage>

    /** `GET /api/devices/summary` on [serverId] (null = the active server). */
    suspend fun summary(serverId: ServerId? = null): ApiOutcome<FleetSummary>

    /** `GET /api/devices/:id` on the device's server. */
    suspend fun detail(serverId: ServerId, deviceId: Long): ApiOutcome<Device>

    /**
     * Live CPU/RAM/disk of one device while collected: arms the agent's live
     * mode (`POST /api/devices/:id/live-metrics`, re-armed every 30 s) and
     * emits every `DEVICE_METRICS_PUSHED` of that device from the server's
     * socket. When no push arrived for 15 s (agent offline, device of a child
     * tenant seen from the global view…), it falls back to `GET /api/devices/:id`
     * every 15 s ([LiveSample.live] = false).
     */
    fun liveMetrics(serverId: ServerId, deviceId: Long): Flow<LiveSample>

    /** Device changes pushed on the ACTIVE server's socket (status, deletion…). */
    fun signals(): Flow<DeviceSignal>
}
