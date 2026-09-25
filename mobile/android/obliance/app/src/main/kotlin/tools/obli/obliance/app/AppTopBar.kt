package tools.obli.obliance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import tools.obli.core.auth.AuthState
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.data.LocalObliServices

/**
 * First row of the top bar of a top-level screen (design doc §2.2): the scope
 * chip (server tile when 2+ servers, tenant, "Vue globale" on the master
 * tenant) and the account avatar whose 2 dp ring gives the realtime state.
 * The screen draws the second row (title + freshness) itself.
 */
@Composable
internal fun AppTopBar(onScope: () -> Unit, onAccount: () -> Unit) {
    val services = LocalObliServices.current
    val registry by services.registry.state.collectAsStateWithLifecycle()
    val tenants by services.tenants.scope.collectAsStateWithLifecycle()
    val session by services.sessions.active.collectAsStateWithLifecycle()
    val c = ObliTheme.colors
    val server = registry.active

    Row(
        Modifier.fillMaxWidth().height(56.dp).background(c.chrome).padding(start = 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Scope chip: 36 dp visual inside a 48 dp touch target.
        val tenantName = tenants.current?.name ?: server?.displayName.orEmpty()
        val globalView = tenants.isGlobalView
        val globalLabel = stringResource(R.string.app_scope_global_view)
        val scopeText = listOfNotNull(
            server?.displayName?.takeIf { registry.isMultiServer },
            tenantName.takeIf { it.isNotEmpty() },
            globalLabel.takeIf { globalView },
        ).joinToString(", ")
        val scopeLabel = if (scopeText.isEmpty()) stringResource(R.string.app_scope_unknown) else stringResource(R.string.app_scope_label, scopeText)
        Box(
            Modifier.height(48.dp).widthIn(max = 280.dp).clickable(onClick = onScope).clearAndSetSemantics {
                contentDescription = scopeLabel
                role = Role.Button
            },
            contentAlignment = Alignment.Center,
        ) {
            Row(
                Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).background(c.hover).padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (registry.isMultiServer && server != null) {
                    ObliServerTile(server.color, server.monogram, server.displayName)
                } else {
                    Icon(ObliIcons.Building2, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
                }
                Text(tenantName, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (globalView) {
                    Text(
                        globalLabel.uppercase(),
                        style = ObliTypography.overline,
                        color = c.text2,
                        maxLines = 1,
                        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.divider).padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
                Icon(ObliIcons.ChevronDown, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(16.dp))
            }
        }
        Spacer(Modifier.weight(1f))

        // Avatar with the realtime ring.
        val auth = session?.auth?.collectAsStateWithLifecycle()?.value
        val user = (auth as? AuthState.SignedIn)?.probe?.user
        val realtime = session?.realtime?.state?.collectAsStateWithLifecycle()?.value ?: ConnectionState.DISCONNECTED
        val (ring, stateLabel) = when (realtime) {
            ConnectionState.CONNECTED -> ObliTokens.Status.ONLINE.argb.toColor() to stringResource(R.string.app_realtime_connected)
            ConnectionState.CONNECTING, ConnectionState.RECONNECTING -> ObliTokens.Status.WARNING.argb.toColor() to stringResource(R.string.app_realtime_reconnecting)
            else -> ObliTokens.Status.OFFLINE.argb.toColor() to stringResource(R.string.app_realtime_disconnected)
        }
        val name = user?.label.orEmpty()
        val accountLabel = stringResource(R.string.app_account, name, stateLabel)
        Box(
            Modifier.size(48.dp).clip(CircleShape).clickable(onClick = onAccount).clearAndSetSemantics {
                contentDescription = accountLabel
                role = Role.Button
            },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier.size(36.dp).border(2.dp, ring, CircleShape).padding(2.dp).clip(CircleShape).background(c.divider),
                contentAlignment = Alignment.Center,
            ) {
                Text(initials(name), style = ObliTypography.labelSmall, color = c.text)
            }
        }
    }
}

/** "Karim Benali" -> "KB"; one word -> its first two letters. */
internal fun initials(name: String): String {
    val words = name.split(Regex("[\\s._-]+")).filter { it.isNotEmpty() }
    return when {
        words.size >= 2 -> "${words[0].first()}${words[1].first()}".uppercase()
        words.size == 1 -> words[0].take(2).uppercase()
        else -> ""
    }
}
