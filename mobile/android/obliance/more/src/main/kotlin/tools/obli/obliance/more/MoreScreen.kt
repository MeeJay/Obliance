package tools.obli.obliance.more

import android.content.Context
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliScreenHeader
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.obliance.data.LocalObliServices

/** Shown when the package manager has no version name (tests, previews). Same as the app's `versionName`. */
internal const val FALLBACK_APP_VERSION = "0.3.0-alpha"

/** Shown when the package manager has no version code (tests, previews). Same as the app's `versionCode`. */
internal const val FALLBACK_APP_VERSION_CODE = 3

/**
 * S80: account, servers, scope and the "Compte" entries (design doc §5 S80,
 * mockup More.dc.html). [notificationsSummary] is the S84 state line
 * ("Astreinte active · 19:00–08:00"); without it the row says "Alertes de vos serveurs".
 */
@Composable
fun MoreScreen(
    onOpenServers: () -> Unit,
    onOpenScope: () -> Unit,
    onOpenSettings: () -> Unit = {},
    onOpenNotifications: () -> Unit = {},
    onOpenAbout: () -> Unit = {},
    notificationsSummary: String? = null,
) {
    val context = LocalContext.current
    val version = remember(context) { appVersion(context) }
    val offer by AppUpdates.offer.collectAsStateWithLifecycle()
    MoreRoute(
        MoreActions(onOpenServers, onOpenScope, onOpenSettings = onOpenSettings, onOpenNotifications = onOpenNotifications, onOpenAbout = onOpenAbout),
        version,
        notificationsSummary = notificationsSummary,
        updateAvailable = offer != null,
    )
}

@Composable
internal fun MoreRoute(
    actions: MoreActions,
    appVersion: String,
    notificationsSummary: String? = null,
    updateAvailable: Boolean = false,
) {
    val services = LocalObliServices.current
    val vm = viewModel { MoreViewModel(services) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val confirm by vm.confirm.collectAsStateWithLifecycle()
    MoreContent(ui, appVersion, actions.copy(onSignOut = vm::askSignOut), notificationsSummary, updateAvailable)
    confirm?.let { SignOutSheet(it, ui.multiServer, vm::answer) }
}

internal data class MoreActions(
    val onOpenServers: () -> Unit = {},
    val onOpenScope: () -> Unit = {},
    val onSignOut: () -> Unit = {},
    val onOpenSettings: () -> Unit = {},
    val onOpenNotifications: () -> Unit = {},
    val onOpenAbout: () -> Unit = {},
)

/** The version name of the installed app (the application module's `versionName`). */
internal fun appVersion(context: Context): String = runCatching {
    val pm = context.packageManager
    val info = if (Build.VERSION.SDK_INT >= 33) {
        pm.getPackageInfo(context.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
    } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(context.packageName, 0)
    }
    info.versionName
}.getOrNull()?.takeIf { it.isNotBlank() } ?: FALLBACK_APP_VERSION

/** The version code of the installed app (the application module's `versionCode`). */
internal fun appVersionCode(context: Context): Int =
    AppUpdates.installedVersionCode(context).takeIf { it > 0 } ?: FALLBACK_APP_VERSION_CODE

@Composable
internal fun MoreContent(
    ui: MoreUi,
    appVersion: String,
    actions: MoreActions,
    notificationsSummary: String? = null,
    updateAvailable: Boolean = false,
) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliScreenHeader(stringResource(R.string.more_title), trailing = {
            ui.host?.let { Text(it, style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 220.dp)) }
        })
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = 640.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AccountCard(ui, actions.onOpenScope)
                Card {
                    val server = ui.server
                    if (ui.multiServer) {
                        val value = pluralStringResource(R.plurals.more_servers_value, ui.serverCount, ui.serverCount, server?.displayName.orEmpty())
                        EntryRow(ObliIcons.Server, stringResource(R.string.more_servers), value, actions.onOpenServers)
                    } else {
                        EntryRow(ObliIcons.Server, stringResource(R.string.more_server_single), ui.host, actions.onOpenServers, monoValue = true)
                    }
                }
                // The account card's chip already opens the scope sheet (S81): no second "Serveur et tenant" row.
                SectionTitle(stringResource(R.string.more_section_account))
                Card {
                    // S85 is not in this version: listed, clearly marked, not tappable.
                    EntryRow(MoreIcons.ShieldCheck, stringResource(R.string.more_profile), stringResource(R.string.more_soon), onClick = null)
                    EntryRow(
                        MoreIcons.Bell,
                        stringResource(R.string.more_notifications),
                        notificationsSummary ?: stringResource(R.string.more_notifications_value),
                        actions.onOpenNotifications,
                    )
                    EntryRow(MoreIcons.Settings, stringResource(R.string.more_app_settings), stringResource(R.string.more_app_settings_value), actions.onOpenSettings)
                    if (updateAvailable) {
                        EntryRow(ObliIcons.Info, stringResource(R.string.more_about), stringResource(R.string.more_update_available), actions.onOpenAbout, badge = true)
                    } else {
                        EntryRow(ObliIcons.Info, stringResource(R.string.more_about), appVersion, actions.onOpenAbout, monoValue = true)
                    }
                    if (ui.account != AccountState.SIGNED_OUT && ui.server != null) {
                        EntryRow(ObliIcons.LogOut, stringResource(R.string.more_sign_out), ui.server.displayName, actions.onSignOut, chevron = false)
                    }
                }
                if (ui.server != null) {
                    Text(
                        listOfNotNull(ui.server.displayName, ui.host).joinToString(" · "),
                        style = ObliTypography.monoCaption,
                        color = c.textMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    )
                }
            }
        }
    }
}

/** "Obliance Prod › Default" (server only with two servers or more; the tile says it then). */
@Composable
private fun scopeText(ui: MoreUi): String? {
    val tenant = ui.tenantName
    val server = ui.server?.displayName
    return when {
        server != null && tenant != null -> "$server › $tenant"
        else -> server ?: tenant
    }
}

// --- Account card ------------------------------------------------------------

@Composable
private fun AccountCard(ui: MoreUi, onOpenScope: () -> Unit) {
    val c = ObliTheme.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface1).padding(start = 16.dp, end = 12.dp, top = 14.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(48.dp).clip(CircleShape).background(c.divider), contentAlignment = Alignment.Center) {
                if (ui.initials.isNotEmpty()) {
                    Text(ui.initials, style = ObliTypography.cardTitle.copy(fontSize = 18.sp), color = c.text, modifier = Modifier.clearAndSetSemantics { })
                } else {
                    Icon(ObliIcons.Lock, contentDescription = null, tint = c.text2, modifier = Modifier.size(20.dp))
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                val user = ui.user
                if (user != null) {
                    Text(user.label, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(user.username, style = ObliTypography.monoCaption, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        stringResource(if (ui.obligate) R.string.more_account_obligate else R.string.more_account_local),
                        style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal),
                        color = c.textMuted,
                    )
                } else {
                    Text(ui.server?.displayName.orEmpty(), style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        stringResource(
                            when (ui.account) {
                                AccountState.EXPIRED -> R.string.more_account_expired
                                AccountState.SIGNED_OUT -> R.string.more_account_signed_out
                                else -> R.string.more_account_unknown
                            },
                        ),
                        style = ObliTypography.body,
                        color = c.text2,
                    )
                }
            }
        }
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(stringResource(R.string.more_scope_label), style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal), color = c.textMuted, modifier = Modifier.weight(1f))
            ScopeChip(ui, onOpenScope)
        }
    }
}

/** "[OP] Obliance Prod › Default ▾" (tile only with two servers or more, design doc §2.10). */
@Composable
private fun ScopeChip(ui: MoreUi, onOpenScope: () -> Unit) {
    val c = ObliTheme.colors
    val server = ui.server ?: return
    val text = scopeText(ui).orEmpty()
    val a11y = stringResource(R.string.more_scope_chip_a11y, text)
    Box(
        Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onOpenScope)
            .clearAndSetSemantics { contentDescription = a11y },
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).background(c.hover).padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (ui.multiServer) {
                ObliServerTile(server.color, server.monogram, server.displayName)
            } else {
                Icon(ObliIcons.Building2, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
            }
            Text(server.displayName, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 140.dp))
            ui.tenantName?.let {
                Text("›", style = ObliTypography.label, color = c.textMuted)
                Text(it, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 100.dp))
            }
            Icon(ObliIcons.ChevronDown, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
        }
    }
}

// --- Rows ------------------------------------------------------------------------

@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(ObliTheme.colors.surface1).padding(vertical = 4.dp), content = content)
}

@Composable
private fun EntryRow(
    icon: ImageVector,
    title: String,
    value: String?,
    onClick: (() -> Unit)?,
    chevron: Boolean = true,
    monoValue: Boolean = false,
    badge: Boolean = false,
) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).background(c.hover), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = ObliTypography.label.copy(fontSize = 16.sp, lineHeight = 22.sp), color = c.text)
            if (!value.isNullOrEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    // Info dot (STYLEKIT: the Plus badge), never colour alone: the text says it.
                    if (badge) Box(Modifier.size(8.dp).clip(CircleShape).background(ObliTokens.UNREAD.toColor()))
                    Text(
                        value,
                        style = if (monoValue) ObliTypography.monoCaption.copy(fontSize = 13.sp, lineHeight = 18.sp) else ObliTypography.body,
                        color = if (badge) c.text2 else c.textMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (onClick != null && chevron) Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(20.dp))
    }
}

// --- Sign-out confirmation (T1 sheet naming the server) ------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SignOutSheet(confirm: SignOutConfirm, multiServer: Boolean, onAnswer: (Boolean) -> Unit) {
    val c = ObliTheme.colors
    ModalBottomSheet(
        onDismissRequest = { if (!confirm.busy) onAnswer(false) },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.surface1,
        contentColor = c.text,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
    ) {
        SignOutConfirmContent(confirm, multiServer, onConfirm = { onAnswer(true) }, onDismiss = { onAnswer(false) })
    }
}

@Composable
internal fun SignOutConfirmContent(confirm: SignOutConfirm, multiServer: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val c = ObliTheme.colors
    Column(
        Modifier.fillMaxWidth().background(c.surface1).padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(c.hover), contentAlignment = Alignment.Center) {
                Icon(ObliIcons.LogOut, contentDescription = null, tint = c.text2, modifier = Modifier.size(20.dp))
            }
            Text(
                stringResource(R.string.more_sign_out_confirm_title, confirm.serverName),
                style = ObliTypography.dialogTitle,
                color = c.text,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        }
        Text(
            stringResource(if (multiServer) R.string.more_sign_out_body_multi else R.string.more_sign_out_body_single, confirm.serverName),
            style = ObliTypography.body,
            color = c.text2,
        )
        Spacer(Modifier.height(4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onDismiss, enabled = !confirm.busy, modifier = Modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(8.dp)) {
                Text(stringResource(R.string.more_cancel), style = ObliTypography.label, color = c.text2)
            }
            Button(
                onClick = onConfirm,
                enabled = !confirm.busy,
                modifier = Modifier.heightIn(min = 48.dp),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = c.accentFill,
                    contentColor = c.onAccentFill,
                    disabledContainerColor = c.hover,
                    disabledContentColor = c.textMuted,
                ),
            ) { Text(stringResource(R.string.more_sign_out_confirm), style = ObliTypography.label) }
        }
    }
}
