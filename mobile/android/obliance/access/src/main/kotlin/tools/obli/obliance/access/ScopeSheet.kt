package tools.obli.obliance.access

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.network.ApiOutcome
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.TenantScope

/*
 * S81 "Serveur et tenant" (design doc §2.3, §2.10, §5 S81): the servers
 * (2+ servers) with their state and unread count, "Gérer les serveurs", then
 * the tenants of the ACTIVE server with the switch.
 */

internal data class ScopeServerRow(val profile: ServerProfile, val active: Boolean, val status: ServerStatus, val unread: Int)

internal data class ScopeTenantRow(val tenant: Tenant, val current: Boolean, val unread: Int)

internal data class ScopeUi(
    val servers: List<ScopeServerRow>,
    val activeName: String?,
    val multiServer: Boolean,
    val serverCount: Int,
    val tenants: List<ScopeTenantRow>,
    /** "Travailler dans un tenant" is offered (2 tenants or more). */
    val canSwitchTenant: Boolean,
    val tenantsLoading: Boolean,
    val tenantsFailed: Boolean,
    val currentTenantName: String?,
    val globalView: Boolean,
    val userLabel: String?,
    /** The active server (the tenant counts are loaded from it). */
    val activeId: ServerId? = null,
    /** "Filtrer la vue globale" is offered: session on the master tenant with 2 tenants or more (§5 S81). */
    val showViewFilter: Boolean = false,
    /** Tenant ids of the global-view filter; empty = "Tous les tenants". */
    val viewFilter: Set<Long> = emptySet(),
) {
    /** Names of the filtered tenants, in list order ("· filtre ACME"). */
    val filterNames: List<String> get() = tenants.filter { it.tenant.id in viewFilter }.map { it.tenant.name }

    companion object {
        /** Pure mapping of the services' state (unit-tested). */
        fun build(
            registry: ServerRegistryState,
            auth: Map<ServerId, AuthState>,
            activeRealtime: ConnectionState?,
            alerts: AlertsSnapshot,
            tenants: TenantScope,
        ): ScopeUi {
            val unreadByServer = alerts.alerts.filter { it.alert.readAt == null }.groupingBy { it.serverId }.eachCount()
            val activeId = registry.activeId
            val servers = if (!registry.isMultiServer) {
                emptyList()
            } else {
                registry.profiles.map { p ->
                    val active = p.id == activeId
                    ScopeServerRow(
                        profile = p,
                        active = active,
                        status = ServerStatus.of(active, auth[p.id] ?: AuthState.Unknown, if (active) activeRealtime else null, alerts.feed(p.id)),
                        unread = unreadByServer[p.id] ?: 0,
                    )
                }
            }
            // The tenant list belongs to the active server only (it follows server switches).
            val tenantList = if (tenants.serverId == activeId) tenants.tenants else emptyList()
            val unreadByTenant = alerts.alerts
                .filter { it.serverId == activeId && it.alert.readAt == null }
                .groupingBy { it.alert.tenantId }
                .eachCount()
            val user = (auth[activeId ?: ServerId("none")] as? AuthState.SignedIn)?.probe?.user?.label
            // Filtering only exists in the global view (§2.3): other sessions only see their tenant.
            val showFilter = tenants.isGlobalView && tenantList.size >= 2
            val listed = tenantList.mapTo(HashSet()) { it.id }
            return ScopeUi(
                servers = servers,
                activeName = registry.active?.displayName,
                multiServer = registry.isMultiServer,
                serverCount = registry.profiles.size,
                tenants = tenantList.map { t -> ScopeTenantRow(t, t.id == tenants.currentTenantId, unreadByTenant[t.id] ?: 0) },
                canSwitchTenant = tenantList.size >= 2,
                tenantsLoading = tenants.loading && tenantList.isEmpty(),
                tenantsFailed = tenants.error != null && tenantList.isEmpty(),
                currentTenantName = tenantList.firstOrNull { it.id == tenants.currentTenantId }?.name,
                globalView = tenants.isGlobalView,
                userLabel = user,
                activeId = activeId,
                showViewFilter = showFilter,
                viewFilter = if (showFilter) tenants.viewFilter.filterTo(LinkedHashSet()) { it in listed } else emptySet(),
            )
        }
    }
}

/** S81 "Serveur et tenant": servers (2+) then tenants of the active server. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScopeSheet(onDismiss: () -> Unit, onManageServers: () -> Unit) {
    val c = ObliTheme.colors
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.surface1,
        dragHandle = { BottomSheetDefaults.DragHandle(color = c.textFaint) },
    ) {
        ScopeSheetContent(onDone = onDismiss, onManageServers = onManageServers)
    }
}

@Composable
internal fun rememberScopeUi(services: ObliServices): ScopeUi {
    val registry by services.registry.state.collectAsStateWithLifecycle()
    val tenants by services.tenants.scope.collectAsStateWithLifecycle()
    val alerts by services.alerts.snapshot.collectAsStateWithLifecycle()
    val auth = rememberAuthStates(services, registry)
    val activeRealtime = rememberActiveRealtime(services)
    return ScopeUi.build(registry, auth, activeRealtime, alerts, tenants)
}

/** Auth state of every configured server (the sessions' StateFlows). */
@Composable
internal fun rememberAuthStates(services: ObliServices, registry: ServerRegistryState): Map<ServerId, AuthState> {
    val out = LinkedHashMap<ServerId, AuthState>()
    registry.profiles.forEach { p ->
        key(p.id.value) {
            val session = remember(p.id) { services.sessions.session(p.id) }
            val state = session?.auth?.collectAsStateWithLifecycle()?.value ?: AuthState.Unknown
            out[p.id] = state
        }
    }
    return out
}

/** Socket state of the ACTIVE server only (other servers have no socket). */
@Composable
internal fun rememberActiveRealtime(services: ObliServices): ConnectionState? {
    val active by services.sessions.active.collectAsStateWithLifecycle()
    val session = active ?: return null
    return key(session.id.value) { session.realtime.state.collectAsStateWithLifecycle().value }
}

private enum class SwitchProblem { NOT_MEMBER, FAILED }

@Composable
internal fun ScopeSheetContent(onDone: () -> Unit, onManageServers: () -> Unit) {
    val services = LocalObliServices.current
    val ui = rememberScopeUi(services)
    val scope = rememberCoroutineScope()
    var switching by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<SwitchProblem?>(null) }
    val counts = rememberTenantCounts(services, ui)
    ScopeSheetBody(
        ui = ui,
        counts = counts,
        // A tap applies at once (no server call); the sheet stays open.
        onViewFilter = { tenantId ->
            val next = ViewFilterChoice.next(ui.viewFilter, ui.tenants.map { it.tenant.id }, tenantId)
            if (next != ui.viewFilter) scope.launch { services.tenants.setViewFilter(next) }
        },
        switchingTo = switching,
        problem = when (problem) {
            SwitchProblem.NOT_MEMBER -> stringResource(R.string.access_scope_not_member)
            SwitchProblem.FAILED -> stringResource(R.string.access_scope_switch_failed)
            null -> null
        },
        onServer = { row ->
            if (switching == null && !row.active) {
                switching = row.profile.displayName
                problem = null
                scope.launch {
                    try {
                        services.openOn(row.profile.id)
                        onDone()
                    } finally {
                        switching = null
                    }
                }
            }
        },
        onTenant = { row ->
            if (switching == null && !row.current) {
                switching = row.tenant.name
                problem = null
                scope.launch {
                    val out = services.tenants.switchTo(row.tenant.id)
                    switching = null
                    when (out) {
                        is ApiOutcome.Ok, is ApiOutcome.Accepted -> onDone()
                        is ApiOutcome.Forbidden -> problem = SwitchProblem.NOT_MEMBER
                        // SessionExpired: the app shows S03; the sheet stays calm.
                        else -> problem = SwitchProblem.FAILED
                    }
                }
            }
        },
        onRetryTenants = { scope.launch { services.tenants.refresh() } },
        onManageServers = onManageServers,
    )
}

@Composable
internal fun ScopeSheetBody(
    ui: ScopeUi,
    switchingTo: String?,
    problem: String?,
    onServer: (ScopeServerRow) -> Unit,
    onTenant: (ScopeTenantRow) -> Unit,
    onRetryTenants: () -> Unit,
    onManageServers: () -> Unit,
    /** Device counts of the filter chips, by tenant id (missing = not shown). */
    counts: Map<Long, TenantCount> = emptyMap(),
    /** Tap on a filter chip: a tenant id, or null for "Tous les tenants". */
    onViewFilter: (Long?) -> Unit = {},
) {
    val c = ObliTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.surface1)
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, bottom = 18.dp),
    ) {
        Text(stringResource(R.string.access_scope_title), style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
        scopeSubtitle(ui)?.let { Text(it, style = FieldLabel, color = c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis) }

        val enabled = switchingTo == null
        if (ui.multiServer) {
            SheetHeader(stringResource(R.string.access_scope_servers))
            ui.servers.forEach { row -> ServerScopeRow(row, enabled) { onServer(row) } }
            ManageServersRow(onManageServers)
        }

        if (ui.canSwitchTenant || ui.tenantsLoading || ui.tenantsFailed) {
            SheetHeader(
                if (ui.multiServer && ui.activeName != null) stringResource(R.string.access_scope_tenants_of, ui.activeName) else stringResource(R.string.access_scope_tenants),
            )
            when {
                ui.tenantsLoading -> Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = c.text2)
                    Text(stringResource(R.string.access_scope_tenants_loading), style = ObliTypography.body, color = c.text2)
                }
                ui.tenantsFailed -> Column(Modifier.padding(horizontal = 8.dp)) {
                    Text(stringResource(R.string.access_scope_tenants_failed), style = ObliTypography.body, color = c.text2)
                    LinkButton(stringResource(R.string.access_retry), onRetryTenants)
                }
                else -> {
                    // "Filtrer la vue globale" (§2.3, §5 S81): between the servers and the switch.
                    if (ui.showViewFilter) ViewFilterSection(ui, counts, enabled, onViewFilter)
                    Text(
                        stringResource(R.string.access_scope_work_in),
                        style = ObliTypography.labelSmall,
                        color = c.text2,
                        modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 2.dp, bottom = 4.dp),
                    )
                    ui.tenants.forEach { row -> TenantScopeRow(row, enabled) { onTenant(row) } }
                }
            }
        }

        // One server: no server section; "Gérer les serveurs" (to add one) closes the list.
        if (!ui.multiServer) {
            Spacer(Modifier.height(6.dp))
            ManageServersRow(onManageServers)
        }
        if (problem != null) ErrorLine(problem, Modifier.padding(start = 8.dp, end = 8.dp, top = 10.dp))
        Spacer(Modifier.height(10.dp))
        if (switchingTo != null) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = c.text2)
                Text(stringResource(R.string.access_scope_switching, switchingTo), style = ObliTypography.body, color = c.text2)
            }
        } else {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(ObliIcons.Info, contentDescription = null, tint = c.textMuted, modifier = Modifier.padding(top = 1.dp).size(14.dp))
                val footer = stringResource(R.string.access_scope_footer) +
                    if (ui.multiServer) " " + pluralStringResource(R.plurals.access_scope_footer_servers, ui.serverCount, ui.serverCount) else ""
                Text(footer, style = FieldLabel, color = c.textMuted)
            }
        }
    }
}

@Composable
private fun scopeSubtitle(ui: ScopeUi): String? {
    val parts = mutableListOf<String>()
    val place = listOfNotNull(if (ui.multiServer) ui.activeName else null, ui.currentTenantName).joinToString(" › ")
    if (place.isNotEmpty()) parts += if (ui.globalView && ui.currentTenantName != null) place + " · " + stringResource(R.string.access_scope_global_view_lower) else place
    // "Obliance Prod › Default · vue globale · filtre ACME".
    viewFilterLabel(ui.filterNames)?.let { parts += it }
    ui.userLabel?.let { parts += it }
    return parts.joinToString(" · ").ifEmpty { null }
}

@Composable
private fun SheetHeader(text: String) {
    Overline(text, Modifier.padding(start = 8.dp, end = 8.dp, top = 14.dp, bottom = 4.dp))
}

private val RowShape = RoundedCornerShape(8.dp)

@Composable
private fun ServerScopeRow(row: ScopeServerRow, enabled: Boolean, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val p = row.profile
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(RowShape)
            .background(if (row.active) c.active else Color.Transparent)
            .clickable(enabled = enabled && !row.active, role = Role.Button, onClick = onClick)
            .semantics { selected = row.active }
            .padding(start = 8.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ObliServerTile(p.color, p.monogram, p.displayName, size = 28.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(p.displayName, style = ItemLabel, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(ServerNames.hostOf(p.origin), style = ObliTypography.monoCaption, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            StatusLine(row.status, activePrefix = true)
        }
        if (row.unread > 0) UnreadCount(pluralStringResource(R.plurals.access_unread_short, row.unread, row.unread))
        if (row.active) {
            Icon(ObliIcons.Check, contentDescription = stringResource(R.string.access_scope_active_server), tint = c.text, modifier = Modifier.size(20.dp))
        } else {
            Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun TenantScopeRow(row: ScopeTenantRow, enabled: Boolean, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val t = row.tenant
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RowShape)
            .background(if (row.current) c.active else Color.Transparent)
            .clickable(enabled = enabled && !row.current, role = Role.Button, onClick = onClick)
            .semantics { selected = row.current }
            .padding(start = 8.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(28.dp).clip(FieldShape).background(if (row.current) c.divider else c.hover), contentAlignment = Alignment.Center) {
            Icon(ObliIcons.Building2, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(t.name, style = ItemLabel, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (t.isMaster) Tag(stringResource(R.string.access_scope_global_view_tag))
                t.role?.takeIf { it.isNotBlank() }?.let { Text(it, style = ObliTypography.monoCaption, color = c.textMuted) }
            }
            if (row.unread > 0) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(AccessColors.link))
                    Text(pluralStringResource(R.plurals.access_unread_alerts, row.unread, row.unread), style = FieldLabel, color = c.text2)
                }
            }
        }
        if (row.current) {
            Icon(ObliIcons.Check, contentDescription = stringResource(R.string.access_scope_current_tenant), tint = c.text, modifier = Modifier.size(20.dp))
        } else {
            Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun ManageServersRow(onClick: () -> Unit) {
    val c = ObliTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RowShape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(start = 8.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
            Icon(ObliIcons.Server, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
        }
        Text(stringResource(R.string.access_scope_manage_servers), style = ObliTypography.label, color = AccessColors.link, modifier = Modifier.weight(1f))
        Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
    }
}

/** Mono upper-case tag ("VUE GLOBALE", "ACTIF"). */
@Composable
internal fun Tag(text: String) {
    val c = ObliTheme.colors
    Text(
        text.uppercase(),
        style = ObliTypography.overline.copy(letterSpacing = ObliTypography.overline.letterSpacing * 0.6f),
        color = c.text2,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.divider).padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

@Composable
private fun UnreadCount(text: String) {
    val c = ObliTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(AccessColors.link))
        Text(text, style = FieldLabel, color = c.text2, maxLines = 1)
    }
}

/** State line with its dot (the text always carries the meaning, the dot only reinforces it). */
@Composable
internal fun StatusLine(status: ServerStatus, activePrefix: Boolean, suffix: String? = null, maxLines: Int = 2) {
    val c = ObliTheme.colors
    val dot = when (status) {
        ServerStatus.Live -> ObliTokens.Status.ONLINE.argb.toColor()
        ServerStatus.Expired -> ObliTokens.Status.WARNING.argb.toColor()
        is ServerStatus.Unreachable, ServerStatus.SignedOut -> ObliTokens.Status.OFFLINE.argb.toColor()
        else -> null
    }
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (dot != null) Box(Modifier.padding(top = 5.dp).size(6.dp).clip(CircleShape).background(dot))
        val text = statusText(status, activePrefix) + (suffix?.let { " · $it" } ?: "")
        Text(text, style = FieldLabel, color = if (status == ServerStatus.Live || status.needsSignIn) c.text2 else c.textMuted, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
internal fun statusText(status: ServerStatus, activePrefix: Boolean): String = when (status) {
    ServerStatus.Live -> stringResource(if (activePrefix) R.string.access_status_active_live else R.string.access_status_live)
    ServerStatus.Connecting -> stringResource(if (activePrefix) R.string.access_status_active_connecting else R.string.access_status_connecting)
    is ServerStatus.Checked -> stringResource(R.string.access_status_checked, Clock24.format(status.at))
    ServerStatus.SignedIn -> stringResource(R.string.access_status_signed_in)
    ServerStatus.Checking -> stringResource(R.string.access_status_checking)
    is ServerStatus.Unreachable -> status.since?.let { stringResource(R.string.access_status_unreachable_since, Clock24.format(it)) }
        ?: stringResource(R.string.access_status_unreachable)
    ServerStatus.Expired -> stringResource(R.string.access_status_expired)
    ServerStatus.SignedOut -> stringResource(R.string.access_status_signed_out)
}
