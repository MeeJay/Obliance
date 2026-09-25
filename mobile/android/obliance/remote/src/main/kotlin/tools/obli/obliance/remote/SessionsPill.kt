package tools.obli.obliance.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.core.security.ui.LocalActionRunner

/** One row of the sessions surfaces (stateless, for the screenshot tests too). */
internal data class SessionRow(
    val ref: RemoteSessionRef,
    val tenant: String?,
    val phase: SessionPhase,
    val lastLine: String,
)

/**
 * Phone pill (design doc §2.6): floats above the navigation bar while at
 * least one session is live — « >_ 2 sessions · PowerShell PC-COMPTA-03 ».
 * Tap = resume the latest session through [onOpen]. Draws nothing otherwise.
 */
@Composable
fun SessionsPill(onOpen: (RemoteSessionRef) -> Unit, modifier: Modifier = Modifier) {
    val live by SessionManager.live.collectAsState()
    val latest = live.firstOrNull() ?: return
    SessionsPillContent(live.size, latest.protocol, latest.deviceLabel, onClick = { onOpen(latest.ref) }, modifier = modifier)
}

@Composable
internal fun SessionsPillContent(count: Int, protocol: String, deviceLabel: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val context = LocalContext.current
    val text = pluralStringResource(R.plurals.remote_pill, count, count, protocolLabel(context, protocol), deviceLabel)
    val a11y = stringResource(R.string.remote_pill_a11y, text)
    Row(
        modifier
            .widthIn(max = 420.dp)
            .heightIn(min = 48.dp)
            .clip(CircleShape)
            .background(c.surface2)
            .border(1.dp, c.divider, CircleShape)
            .clickable(role = Role.Button, onClickLabel = stringResource(R.string.remote_resume), onClick = onClick)
            .semantics { contentDescription = a11y }
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(RemoteIcons.Terminal, contentDescription = null, tint = ObliTokens.Status.ONLINE.argb.toColor(), modifier = Modifier.size(18.dp))
        Text(text, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * « Sessions ouvertes » of Activité (design doc §2.6, S55): every session the
 * app holds, with Reprendre / Terminer (T1) — ended ones with Fermer. Draws
 * nothing when there is none.
 */
@Composable
fun RemoteSessionsSection(onOpen: (RemoteSessionRef) -> Unit, modifier: Modifier = Modifier) {
    val entries by SessionManager.entries.collectAsState()
    if (entries.isEmpty()) return
    val runner = LocalActionRunner.current
    val scope = rememberCoroutineScope()
    val endTitle = stringResource(R.string.remote_end_session)
    val rows = entries.map { e ->
        key(e.id) {
            val phase by e.phase.collectAsState()
            SessionRow(e.ref, e.tenantName, phase, e.lastLine())
        }
    }
    RemoteSessionsContent(
        rows = rows,
        onOpen = onOpen,
        onEnd = { row ->
            val entry = SessionManager.find(row.ref.id) ?: return@RemoteSessionsContent
            if (!entry.phase.value.isLive) {
                SessionManager.remove(entry.id)
                return@RemoteSessionsContent
            }
            scope.launch {
                val spec = ActionSpec(key = "remote.session_end", tier = Tier.T1, title = endTitle, target = entry.deviceLabel, scope = entry.tenantName.orEmpty())
                if (runner.run(spec) { entry.terminate() } is ActionResult.Done) SessionManager.remove(entry.id)
            }
        },
        modifier = modifier,
    )
}

@Composable
internal fun RemoteSessionsContent(rows: List<SessionRow>, onOpen: (RemoteSessionRef) -> Unit, onEnd: (SessionRow) -> Unit, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val context = LocalContext.current
    val now by produceNow(rows.any { it.phase is SessionPhase.Connected })
    Column(modifier.fillMaxWidth()) {
        Text(
            stringResource(R.string.remote_sessions_title).uppercase(),
            style = ObliTypography.overline,
            color = c.textMuted,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp).semantics { heading() },
        )
        rows.forEach { row ->
            val live = row.phase.isLive
            val status = when (val p = row.phase) {
                SessionPhase.Connecting -> stringResource(R.string.remote_status_connecting)
                SessionPhase.Waiting -> stringResource(R.string.remote_status_waiting)
                is SessionPhase.Connected -> if (row.ref.protocol == "oblireach") stringResource(R.string.remote_reach_web_viewer) else stringResource(R.string.remote_status_connected_for, formatDuration(now - p.sinceMs))
                is SessionPhase.Ended -> stringResource(if (p.reason == EndReason.CONNECTION_LOST) R.string.remote_status_lost else R.string.remote_status_ended)
            }
            val dot = when (row.phase) {
                is SessionPhase.Connected -> ObliTokens.Status.ONLINE
                is SessionPhase.Ended -> if ((row.phase as SessionPhase.Ended).reason == EndReason.CONNECTION_LOST) ObliTokens.Status.WARNING else ObliTokens.Status.OFFLINE
                else -> ObliTokens.Status.PENDING
            }
            Row(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button, onClickLabel = stringResource(R.string.remote_resume)) { onOpen(row.ref) }
                    .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2), contentAlignment = Alignment.Center) {
                    Icon(if (row.ref.protocol == "oblireach") RemoteIcons.Screen else RemoteIcons.Terminal, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        "${protocolLabel(context, row.ref.protocol)} · ${row.ref.deviceLabel}" + (row.tenant?.let { " · $it" } ?: ""),
                        style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.size(6.dp).clip(CircleShape).background(dot.argb.toColor()))
                        Text(status, style = ObliTypography.labelSmall, color = c.text2, maxLines = 1)
                    }
                    if (row.lastLine.isNotBlank()) {
                        Text(row.lastLine, style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                TextAction(stringResource(if (live) R.string.remote_end else R.string.remote_close), { onEnd(row) }, tonal = false)
            }
        }
    }
}
