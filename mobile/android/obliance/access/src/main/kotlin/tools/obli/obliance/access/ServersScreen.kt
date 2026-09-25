package tools.obli.obliance.access

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.model.Monogram
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ObliUser
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.ServerCheck

/*
 * S92 "Serveurs" (design doc §2.10, §5 S92): one card per server; the card
 * opens in place on its settings (name, colour, notifications, À traiter,
 * order, session, removal).
 */

internal data class ServerCardUi(
    val profile: ServerProfile,
    val active: Boolean,
    val status: ServerStatus,
    val version: String?,
    val user: ObliUser?,
) {
    companion object {
        fun build(
            registry: ServerRegistryState,
            auth: Map<ServerId, AuthState>,
            activeRealtime: ConnectionState?,
            alerts: AlertsSnapshot,
            versions: Map<ServerId, String>,
        ): List<ServerCardUi> = registry.profiles.map { p ->
            val active = p.id == registry.activeId
            val state = auth[p.id] ?: AuthState.Unknown
            ServerCardUi(
                profile = p,
                active = active,
                status = ServerStatus.of(active, state, if (active) activeRealtime else null, alerts.feed(p.id)),
                version = versions[p.id],
                user = (state as? AuthState.SignedIn)?.probe?.user,
            )
        }
    }
}

/** What the S92 cards can do (implemented by [ServersViewModel]; no-op in screenshots). */
internal interface ServersActions {
    fun toggle(id: ServerId) {}
    fun rename(id: ServerId, name: String) {}
    fun recolor(id: ServerId, color: ServerColor) {}
    fun setNotify(id: ServerId, scope: NotifyScope) {}
    fun setIncludeInTriage(id: ServerId, include: Boolean) {}
    fun move(id: ServerId, delta: Int) {}
    fun signOut(id: ServerId) {}
    fun signInAgain(id: ServerId) {}
    fun askRemove(id: ServerId) {}

    object None : ServersActions
}

internal class ServersViewModel(private val services: ObliServices) : ViewModel(), ServersActions {
    var versions by mutableStateOf<Map<ServerId, String>>(emptyMap())
        private set
    var expanded by mutableStateOf<ServerId?>(null)
        private set
    var removing by mutableStateOf<ServerId?>(null)
        private set
    var reauth by mutableStateOf<ServerId?>(null)
        private set
    var busy by mutableStateOf<Set<ServerId>>(emptySet())
        private set

    init {
        loadVersions()
    }

    /** "Obliance 5.1.110" of each server (`GET /health` through its own origin). */
    fun loadVersions() {
        services.registry.state.value.profiles.forEach { p ->
            viewModelScope.launch {
                val version = (services.auth.checkServer(p.origin) as? ServerCheck.Ok)?.health?.version?.takeIf { it.isNotBlank() }
                if (version != null) versions = versions + (p.id to version)
            }
        }
    }

    override fun toggle(id: ServerId) {
        expanded = if (expanded == id) null else id
    }

    override fun rename(id: ServerId, name: String) {
        viewModelScope.launch { services.registry.rename(id, name) }
    }

    override fun recolor(id: ServerId, color: ServerColor) {
        viewModelScope.launch { services.registry.recolor(id, color) }
    }

    override fun setNotify(id: ServerId, scope: NotifyScope) {
        viewModelScope.launch { services.registry.setNotify(id, scope) }
    }

    override fun setIncludeInTriage(id: ServerId, include: Boolean) {
        viewModelScope.launch { services.registry.setIncludeInTriage(id, include) }
    }

    override fun move(id: ServerId, delta: Int) {
        val ids = services.registry.state.value.profiles.map { it.id }.toMutableList()
        val from = ids.indexOf(id)
        val to = from + delta
        if (from < 0 || to !in ids.indices) return
        ids.add(to, ids.removeAt(from))
        viewModelScope.launch { services.registry.reorder(ids) }
    }

    /**
     * "Se déconnecter de ce serveur" (§2.10): only this server. When it is the
     * active one and another server is signed in, the app moves to that one first.
     */
    override fun signOut(id: ServerId) = guarded(id) {
        moveAwayFrom(id, signedInOnly = true)
        services.auth.signOut(id)
    }

    override fun signInAgain(id: ServerId) {
        reauth = id
    }

    fun reauthDone() {
        reauth = null
    }

    override fun askRemove(id: ServerId) {
        if (services.registry.state.value.profiles.size > 1) removing = id
    }

    fun cancelRemove() {
        removing = null
    }

    /**
     * "Retirer ce serveur" (T1, confirmed by name): the active server moves to
     * another one, then this server is signed out (its session and the cookies
     * of its origin go) and its profile is removed. The last server stays.
     */
    fun confirmRemove() {
        val id = removing ?: return
        removing = null
        if (services.registry.state.value.profiles.size <= 1) return
        guarded(id) {
            moveAwayFrom(id, signedInOnly = false)
            services.auth.signOut(id)
            services.registry.remove(id)
            if (expanded == id) expanded = null
        }
    }

    private suspend fun moveAwayFrom(id: ServerId, signedInOnly: Boolean) {
        val state = services.registry.state.value
        if (state.activeId != id) return
        val others = state.profiles.filter { it.id != id }
        val next = others.firstOrNull { services.sessions.session(it.id)?.auth?.value is AuthState.SignedIn }
            ?: if (signedInOnly) null else others.firstOrNull()
        if (next != null) services.openOn(next.id)
    }

    private fun guarded(id: ServerId, block: suspend () -> Unit) {
        if (id in busy) return
        busy = busy + id
        viewModelScope.launch {
            try {
                block()
            } finally {
                busy = busy - id
            }
        }
    }
}

/** S92: the configured servers and the settings of each. */
@Composable
fun ServersScreen(onAddServer: () -> Unit, onBack: () -> Unit) {
    val services = LocalObliServices.current
    val vm = viewModel(key = "access-servers") { ServersViewModel(services) }
    val registry by services.registry.state.collectAsStateWithLifecycle()
    val alerts by services.alerts.snapshot.collectAsStateWithLifecycle()
    val auth = rememberAuthStates(services, registry)
    val realtime = rememberActiveRealtime(services)
    val cards = ServerCardUi.build(registry, auth, realtime, alerts, vm.versions)
    ServersBody(cards, vm.expanded, vm.busy, vm, onAddServer, onBack)
    vm.removing?.let { id ->
        registry.byId(id)?.let { profile -> RemoveServerDialog(profile, onConfirm = vm::confirmRemove, onDismiss = vm::cancelRemove) }
    }
    vm.reauth?.let { id -> ReauthSheet(id, onDone = vm::reauthDone) }
}

@Composable
internal fun ServersBody(
    cards: List<ServerCardUi>,
    expanded: ServerId?,
    busy: Set<ServerId>,
    actions: ServersActions,
    onAddServer: () -> Unit,
    onBack: () -> Unit,
) {
    val c = ObliTheme.colors
    val count = cards.size
    val multi = count >= 2
    val atLimit = count >= ServerRegistry.MAX_SERVERS
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliDetailTopBar(
            title = stringResource(R.string.access_servers_title),
            onBack = onBack,
            backLabel = stringResource(R.string.access_back),
            subtitle = pluralStringResource(R.plurals.access_servers_count, count, count, ServerRegistry.MAX_SERVERS),
            actions = {
                TonalButton(stringResource(R.string.access_add_server_title), onAddServer, icon = ObliIcons.Plus, enabled = !atLimit, modifier = Modifier.padding(end = 8.dp))
            },
        )
        LazyColumn(
            Modifier.fillMaxSize().imePadding(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            items(cards, key = { it.profile.id.value }) { card ->
                ServerCard(
                    card = card,
                    index = cards.indexOf(card),
                    count = count,
                    multiServer = multi,
                    expanded = card.profile.id == expanded,
                    busy = card.profile.id in busy,
                    actions = actions,
                    modifier = Modifier.widthIn(max = 720.dp),
                )
            }
            item {
                Text(
                    if (atLimit) stringResource(R.string.access_problem_limit) else pluralStringResource(R.plurals.access_servers_count, count, count, ServerRegistry.MAX_SERVERS),
                    style = ObliTypography.monoCaption,
                    color = c.textMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun ServerCard(
    card: ServerCardUi,
    index: Int,
    count: Int,
    multiServer: Boolean,
    expanded: Boolean,
    busy: Boolean,
    actions: ServersActions,
    modifier: Modifier = Modifier,
) {
    val c = ObliTheme.colors
    val p = card.profile
    AccessCard(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = { actions.toggle(p.id) })
                .padding(start = 14.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (multiServer) ObliServerTile(p.color, p.monogram, p.displayName, size = 28.dp, modifier = Modifier.padding(top = 2.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(p.displayName, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (card.active && multiServer) Tag(stringResource(R.string.access_servers_active_tag))
                }
                Text(ServerNames.hostOf(p.origin), style = ObliTypography.monoCaption, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val meta = listOfNotNull(
                    card.version?.let { stringResource(R.string.access_probe_version, it) },
                    card.user?.let { u -> stringResource(if (u.isObligate) R.string.access_account_obligate else R.string.access_account_local, u.username) },
                ).joinToString(" · ")
                if (meta.isNotEmpty()) Text(meta, style = FieldLabel, color = c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                StatusLine(card.status, activePrefix = false, suffix = notifyLabel(p.notify))
            }
            ObliIconButton(
                icon = if (expanded) AccessIcons.ChevronUp else ObliIcons.ChevronDown,
                contentDescription = stringResource(if (expanded) R.string.access_servers_hide_details else R.string.access_servers_show_details, p.displayName),
                onClick = { actions.toggle(p.id) },
                tint = c.textMuted,
            )
        }
        if (expanded) ServerDetails(card, index, count, multiServer, busy, actions)
    }
}

@Composable
private fun notifyLabel(scope: NotifyScope): String = stringResource(
    when (scope) {
        NotifyScope.ALL -> R.string.access_notify_line_all
        NotifyScope.CRITICAL_ONLY -> R.string.access_notify_line_critical
        NotifyScope.NONE -> R.string.access_notify_line_none
    },
)

@Composable
private fun ServerDetails(card: ServerCardUi, index: Int, count: Int, multiServer: Boolean, busy: Boolean, actions: ServersActions) {
    val c = ObliTheme.colors
    val p = card.profile
    HorizontalDivider(color = c.divider, modifier = Modifier.padding(horizontal = 14.dp))
    Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        var name by rememberSaveable(p.id.value, p.displayName) { mutableStateOf(p.displayName) }
        val changed = name.trim().isNotEmpty() && name.trim() != p.displayName
        AccessField(
            value = name,
            onValueChange = { name = it.take(ServerRegistry.MAX_NAME) },
            label = stringResource(R.string.access_field_display_name),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (changed) actions.rename(p.id, name) }),
            trailing = if (changed) {
                { ObliIconButton(ObliIcons.Check, stringResource(R.string.access_servers_save_name), { actions.rename(p.id, name) }, tint = c.text) }
            } else {
                null
            },
        )
        if (multiServer) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Overline(stringResource(R.string.access_color_label), Modifier.padding(start = 4.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ColorSwatches(p.color, { actions.recolor(p.id, it) }, columns = 4)
                    val previewName = name.trim().ifEmpty { p.displayName }
                    MonogramPreview(p.color, Monogram.of(previewName), previewName, Modifier.weight(1f))
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SettingLabel(AccessIcons.Bell, stringResource(R.string.access_notify_title))
            Segmented(
                options = listOf(stringResource(R.string.access_notify_all), stringResource(R.string.access_notify_critical), stringResource(R.string.access_notify_none)),
                selected = NotifyScope.entries.indexOf(p.notify),
                onSelect = { actions.setNotify(p.id, NotifyScope.entries[it]) },
                track = c.chrome,
            )
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            SettingLabel(AccessIcons.Inbox, stringResource(R.string.access_include_triage), Modifier.weight(1f))
            AccessSwitch(p.includeInTriage, { actions.setIncludeInTriage(p.id, it) })
        }
        if (multiServer) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.access_servers_order, index + 1, count), style = ItemLabel, color = c.text, modifier = Modifier.weight(1f).padding(start = 50.dp))
                ObliIconButton(AccessIcons.ArrowUp, stringResource(R.string.access_servers_move_up, p.displayName), { actions.move(p.id, -1) }, enabled = index > 0)
                ObliIconButton(AccessIcons.ArrowDown, stringResource(R.string.access_servers_move_down, p.displayName), { actions.move(p.id, 1) }, enabled = index < count - 1)
            }
        }
        Column {
            if (card.status.needsSignIn) {
                ActionRow(AccessIcons.RotateCcw, stringResource(R.string.access_servers_sign_in_again), null, enabled = !busy) { actions.signInAgain(p.id) }
            } else {
                ActionRow(ObliIcons.LogOut, stringResource(R.string.access_servers_sign_out), null, enabled = !busy) { actions.signOut(p.id) }
            }
            if (count > 1) {
                ActionRow(ObliIcons.Trash, stringResource(R.string.access_servers_remove), stringResource(R.string.access_servers_remove_help), danger = true, enabled = !busy) {
                    actions.askRemove(p.id)
                }
            } else {
                Text(stringResource(R.string.access_servers_last_server), style = FieldLabel, color = c.textMuted, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
            }
        }
    }
}

@Composable
private fun SettingLabel(icon: ImageVector, text: String, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(36.dp).clip(FieldShape).background(c.hover), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
        }
        Text(text, style = ItemLabel, color = c.text)
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, help: String?, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val tint = if (danger) AccessColors.dangerText else c.text2
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(ButtonShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(36.dp).clip(FieldShape).background(if (danger) AccessColors.dangerText.copy(alpha = 0.10f) else c.hover),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = ItemLabel, color = if (danger) AccessColors.dangerText else c.text)
            if (help != null) Text(help, style = FieldLabel, color = c.textMuted)
        }
    }
}

/** T1 confirmation naming the server (design doc S92). Danger fill only here, never focused by default. */
@Composable
internal fun RemoveServerDialog(profile: ServerProfile, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val c = ObliTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = c.surface1,
        icon = { Icon(ObliIcons.TriangleAlert, contentDescription = null, tint = AccessColors.danger) },
        title = { Text(stringResource(R.string.access_remove_title, profile.displayName), style = ObliTypography.dialogTitle, color = c.text) },
        text = { RemoveServerText(profile) },
        confirmButton = {
            Button(
                onClick = onConfirm,
                shape = ButtonShape,
                colors = ButtonDefaults.buttonColors(containerColor = AccessColors.danger, contentColor = Color.White),
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.access_remove_confirm), style = ObliTypography.label) }
        },
        dismissButton = { LinkButton(stringResource(R.string.access_cancel), onDismiss, color = c.text) },
    )
}

@Composable
private fun RemoveServerText(profile: ServerProfile) {
    val c = ObliTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier.fillMaxWidth().clip(ButtonShape).background(c.surface2).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ObliServerTile(profile.color, profile.monogram, profile.displayName, size = 28.dp)
            Column {
                Text(profile.displayName, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(ServerNames.hostOf(profile.origin), style = ObliTypography.monoCaption, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Text(stringResource(R.string.access_remove_body), style = ObliTypography.body, color = c.text2)
    }
}
