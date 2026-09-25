package tools.obli.obliance.automations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filter
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ObliUser
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices

/** The remote of the screen: the test one when provided, else HTTP over the services' sessions. */
@Composable
internal fun rememberAutomationsRemote(): AutomationsRemote {
    val provided = LocalAutomationsRemote.current
    val services = LocalObliServices.current
    return provided ?: remember(services) { HttpAutomationsRemote(services.sessions) }
}

/** Server and session facts every automation screen needs (pure reads of [ObliServices]). */
internal class ServerFacts(private val services: ObliServices) {
    fun isActive(serverId: ServerId): Boolean = services.registry.state.value.activeId == serverId

    fun serverName(serverId: ServerId): String? = services.registry.state.value.byId(serverId)?.displayName

    val multiServer: Boolean get() = services.registry.state.value.isMultiServer

    /** The signed-in user of [serverId] (`/api/auth/me`), if known. */
    fun me(serverId: ServerId): ObliUser? = (services.sessions.session(serverId)?.auth?.value as? AuthState.SignedIn)?.probe?.user

    /** SESSION tenant of [serverId]: the scope's for the active server, the probe's otherwise. */
    fun sessionTenant(serverId: ServerId): Long? {
        val scope = services.tenants.scope.value
        if (scope.serverId == serverId && scope.currentTenantId != null) return scope.currentTenantId
        return (services.sessions.session(serverId)?.auth?.value as? AuthState.SignedIn)?.probe?.currentTenantId
    }

    fun tenantName(serverId: ServerId, tenantId: Long?): String? {
        tenantId ?: return null
        val scope = services.tenants.scope.value
        return if (scope.serverId == serverId) scope.tenants.firstOrNull { it.id == tenantId }?.name else null
    }

    /** "Obliance Prod › ACME" when two servers or more are configured, "ACME" otherwise (§7.6). */
    fun scope(serverId: ServerId, tenantName: String?): String {
        val server = serverName(serverId)
        val tenant = tenantName ?: tenantName(serverId, sessionTenant(serverId))
        return when {
            multiServer && server != null && tenant != null -> "$server › $tenant"
            multiServer && server != null -> server
            else -> tenant ?: server.orEmpty()
        }
    }

    /** Events of [serverId]'s socket, only when it is the active server (the only connected one). */
    fun events(serverId: ServerId, vararg names: String): Flow<RealtimeEvent> {
        if (!isActive(serverId)) return emptyFlow()
        val rt = services.sessions.session(serverId)?.realtime ?: return emptyFlow()
        val set = names.toSet()
        return rt.events.filter { it.name in set }
    }

    fun socketConnected(serverId: ServerId): Boolean =
        isActive(serverId) && services.sessions.session(serverId)?.realtime?.state?.value == ConnectionState.CONNECTED
}

/** Ok or Accepted → the value; anything else → null. */
internal val <T> ApiOutcome<T>.valueOrNull: T?
    get() = when (this) {
        is ApiOutcome.Ok -> value
        is ApiOutcome.Accepted -> value
        else -> null
    }

/** Master tenant id (shared `isMasterTenant`). */
internal const val MASTER_TENANT = 1L

/** Events of the automation screens (shared/src/socketEvents.ts values). */
internal object AutoEvents {
    const val COMMAND_UPDATED = "COMMAND_UPDATED"
    const val EXECUTION_UPDATED = "EXECUTION_UPDATED"
    const val APPROVAL_CREATED = "APPROVAL_CREATED"
    const val APPROVAL_UPDATED = "APPROVAL_UPDATED"

    /** In `ObliEvents.LISTENED` since 0.2.0: S58 refreshes on them, polling stays as the fallback. */
    const val SCENARIO_RUN_UPDATED = "SCENARIO_RUN_UPDATED"
    const val SCENARIO_NODE_UPDATED = "SCENARIO_NODE_UPDATED"
}
