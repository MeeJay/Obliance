package tools.obli.obliance.remote

import android.content.ClipboardManager
import android.content.Context
import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ui.ActionMessages
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.data.LocalObliServices

/**
 * S60 — native terminal (PowerShell, CMD, SSH) over the relay tunnel (design
 * doc §5 S60, parcours F5). Opens a session (T1 confirmation) or resumes the
 * live one of that device and protocol. [onMinimize] leaves the screen and
 * keeps the session (← and system back); « Terminer la session » ends it.
 *
 * @param protocol `powershell` or `cmd` (Windows), `ssh` (Linux, macOS) — what the web offers.
 * @param wtsSessionId Windows user session chosen in [SessionChoiceSheet]; null = SYSTEM (default).
 * @param resumeId a [RemoteSessionRef.id] from [SessionsPill] / [RemoteSessionsSection].
 */
@Composable
fun TerminalScreen(
    serverId: ServerId,
    deviceId: Long,
    protocol: String,
    onMinimize: () -> Unit,
    modifier: Modifier = Modifier,
    wtsSessionId: Int? = null,
    resumeId: String? = null,
) {
    val services = LocalObliServices.current
    val runner = LocalActionRunner.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val vm = viewModel(key = "terminal-${serverId.value}-$deviceId-$protocol-$wtsSessionId-$resumeId") {
        TerminalViewModel(services, serverId, deviceId, protocol, wtsSessionId, resumeId)
    }
    val ui by vm.ui.collectAsState()
    val session = vm.session
    val phaseFlow: kotlinx.coroutines.flow.StateFlow<SessionPhase?> = remember(session) { session?.phase ?: kotlinx.coroutines.flow.MutableStateFlow(null) }
    val phase by phaseFlow.collectAsState()
    val noTokenText = stringResource(R.string.remote_no_token)
    val texts = terminalTexts(protocol)

    LaunchedEffect(Unit) { SessionManager.bind(context) }
    // A new session once the device is known (its label is in the confirmation).
    LaunchedEffect(ui.deviceLoaded, ui.sessionId, ui.start) {
        if (ui.deviceLoaded && ui.sessionId == null && ui.start == StartState.Idle) vm.start(runner, texts)
    }
    // Cancelled confirmation: nothing was opened, leave.
    LaunchedEffect(ui.start) {
        if ((ui.start as? StartState.Failed)?.result == ActionResult.Cancelled) onMinimize()
    }

    SecureImmersive(immersive = false)
    BackHandler { onMinimize() }

    val hardKeyboard = LocalConfiguration.current.hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO
    var keyBarForced by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val keyBarVisible = keyBarForced ?: !hardKeyboard
    val modifiers = remember(session) { StickyModifiers() }
    val now by produceNow(phase is SessionPhase.Connected)

    val body: TerminalBody = when {
        session != null && phase != null -> when (val p = phase!!) {
            SessionPhase.Connecting -> TerminalBody.Connecting
            SessionPhase.Waiting -> TerminalBody.Waiting
            is SessionPhase.Connected -> TerminalBody.Live
            is SessionPhase.Ended -> TerminalBody.Ended(p.reason)
        }
        ui.start is StartState.Failed -> TerminalBody.StartFailed(startFailure(context, (ui.start as StartState.Failed).result))
        ui.start == StartState.NoToken -> TerminalBody.StartFailed(noTokenText)
        else -> TerminalBody.Connecting
    }
    val header = TerminalHeader(
        deviceLabel = vm.deviceLabel,
        tenant = ui.device?.tenantName ?: session?.tenantName,
        protocol = protocol,
        context = contextLabel(protocol, wtsSessionId),
        status = statusLabel(body, (phase as? SessionPhase.Connected)?.sinceMs, now),
        dot = dotFor(body),
    )

    TerminalContent(
        header = header,
        body = body,
        keyBarVisible = keyBarVisible && body == TerminalBody.Live,
        modifiers = modifiers,
        onMinimize = onMinimize,
        onToggleKeyBar = { keyBarForced = !keyBarVisible },
        onPaste = { clipboardText(context)?.let { session?.engine?.paste(it) } },
        onEnd = { scope.launch { if (vm.terminate(runner, texts)) onMinimize() } },
        onReopen = { vm.forgetEnded() },
        onRetry = { vm.retry() },
        onKey = { key ->
            session?.engine?.key(key, modifiers.mods)
            modifiers.clearTransients()
        },
        onText = { text ->
            session?.engine?.text(text, modifiers.mods)
            modifiers.clearTransients()
        },
        onCtrl = { letter -> session?.engine?.text(letter, Mods(ctrl = true)) },
        modifier = modifier,
    ) {
        session?.engine?.Render(
            modifier = Modifier.fillMaxSize(),
            modifiers = modifiers,
            showSoftKeyboard = !hardKeyboard,
            description = stringResource(R.string.remote_terminal_output, protocolLabel(context, protocol)),
        )
    }
}

internal data class TerminalHeader(
    val deviceLabel: String,
    val tenant: String?,
    val protocol: String,
    val context: String?,
    val status: String,
    val dot: ObliTokens.Status,
)

internal sealed interface TerminalBody {
    data object Connecting : TerminalBody
    data object Waiting : TerminalBody
    data object Live : TerminalBody
    data class Ended(val reason: EndReason) : TerminalBody
    data class StartFailed(val message: String) : TerminalBody
}

/** Stateless S60 (screenshot tests render it with a transcript as [terminal]). */
@Composable
internal fun TerminalContent(
    header: TerminalHeader,
    body: TerminalBody,
    keyBarVisible: Boolean,
    modifiers: StickyModifiers,
    onMinimize: () -> Unit,
    onToggleKeyBar: () -> Unit,
    onPaste: () -> Unit,
    onEnd: () -> Unit,
    onReopen: () -> Unit,
    onRetry: () -> Unit,
    onKey: (TermKey) -> Unit,
    onText: (String) -> Unit,
    onCtrl: (String) -> Unit,
    modifier: Modifier = Modifier,
    terminal: @Composable () -> Unit,
) {
    Column(modifier.fillMaxSize().background(TermColors.background).imePadding()) {
        TerminalTopBar(header, body, onMinimize, onToggleKeyBar, onPaste, onEnd)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (body) {
                TerminalBody.Live -> terminal()
                is TerminalBody.Ended -> Column(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f).fillMaxWidth()) { terminal() }
                    EndedPanel(body.reason, onReopen, onMinimize)
                }
                TerminalBody.Connecting -> StatePanel(
                    title = stringResource(R.string.remote_state_connecting),
                    progress = true,
                )
                TerminalBody.Waiting -> StatePanel(
                    title = stringResource(R.string.remote_state_waiting),
                    progress = true,
                    action = stringResource(R.string.remote_cancel) to onEnd,
                )
                is TerminalBody.StartFailed -> StatePanel(
                    title = body.message,
                    progress = false,
                    action = stringResource(R.string.remote_retry) to onRetry,
                    secondary = stringResource(R.string.remote_close) to onMinimize,
                )
            }
        }
        if (keyBarVisible) KeyBar(modifiers, onKey, onText, onCtrl, onPaste)
    }
}

@Composable
private fun TerminalTopBar(
    header: TerminalHeader,
    body: TerminalBody,
    onMinimize: () -> Unit,
    onToggleKeyBar: () -> Unit,
    onPaste: () -> Unit,
    onEnd: () -> Unit,
) {
    val c = ObliTheme.colors
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    val a11y = stringResource(
        R.string.remote_header_a11y,
        protocolLabel(context, header.protocol),
        header.context.orEmpty(),
        header.status,
    )
    Row(
        Modifier.fillMaxWidth().height(64.dp).background(c.chrome).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        ObliIconButton(ObliIcons.ArrowLeft, stringResource(R.string.remote_minimize), onMinimize, tint = c.text)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    header.deviceLabel,
                    style = ObliTypography.screenTitle,
                    color = c.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false).semantics { heading() },
                )
                header.tenant?.let { TenantChip(it) }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.clearAndSetSemantics { contentDescription = a11y; liveRegion = LiveRegionMode.Polite },
            ) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(header.dot.argb.toColor()))
                Text(
                    listOfNotNull(protocolLabel(context, header.protocol), header.context, header.status).joinToString(" · "),
                    style = ObliTypography.labelSmall,
                    color = c.text2,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (body == TerminalBody.Live) {
            ObliIconButton(RemoteIcons.Keyboard, stringResource(R.string.remote_key_bar_toggle), onToggleKeyBar)
        }
        Box {
            ObliIconButton(ObliIcons.EllipsisVertical, stringResource(R.string.remote_more), { menu = true })
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = c.surface1) {
                if (body == TerminalBody.Live) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.remote_paste), color = c.text) }, onClick = { menu = false; onPaste() })
                }
                DropdownMenuItem(
                    text = { Text(stringResource(if (body is TerminalBody.Ended || body is TerminalBody.StartFailed) R.string.remote_close else R.string.remote_end_session), color = c.text) },
                    onClick = { menu = false; onEnd() },
                )
            }
        }
    }
}

@Composable
private fun TenantChip(name: String) {
    val c = ObliTheme.colors
    Text(
        name,
        style = ObliTypography.overline.copy(letterSpacing = ObliTypography.monoCaption.letterSpacing),
        color = c.text2,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.surface2).padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

@Composable
private fun StatePanel(
    title: String,
    progress: Boolean,
    action: Pair<String, () -> Unit>? = null,
    secondary: Pair<String, () -> Unit>? = null,
) {
    val c = ObliTheme.colors
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (progress) {
            CircularProgressIndicator(color = c.text2, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
            Spacer(Modifier.height(16.dp))
        }
        Text(
            title,
            style = ObliTypography.body,
            color = c.text,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 360.dp).semantics { liveRegion = LiveRegionMode.Polite },
        )
        if (action != null || secondary != null) {
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                secondary?.let { (label, onClick) -> TextAction(label, onClick, tonal = false) }
                action?.let { (label, onClick) -> TextAction(label, onClick, tonal = true) }
            }
        }
    }
}

@Composable
private fun EndedPanel(reason: EndReason, onReopen: () -> Unit, onClose: () -> Unit) {
    val c = ObliTheme.colors
    val (message, tip) = when (reason) {
        EndReason.SHELL_CLOSED -> stringResource(R.string.remote_ended_shell) to null
        EndReason.CONNECTION_LOST -> stringResource(R.string.remote_ended_lost) to stringResource(R.string.remote_ended_lost_tip)
        EndReason.ENDED_BY_USER -> stringResource(R.string.remote_ended_user) to null
        EndReason.DEVICE_TIMEOUT -> stringResource(R.string.remote_ended_timeout) to null
        EndReason.SESSION_EXPIRED -> stringResource(R.string.remote_ended_expired) to null
        EndReason.REFUSED -> stringResource(R.string.remote_ended_refused) to null
    }
    val action = stringResource(if (reason == EndReason.CONNECTION_LOST) R.string.remote_reopen else R.string.remote_new_session)
    Column(
        Modifier.fillMaxWidth().background(c.surface1).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val icon = if (reason == EndReason.CONNECTION_LOST) ObliIcons.TriangleAlert else ObliIcons.Info
            val tint = if (reason == EndReason.CONNECTION_LOST) ObliTokens.Status.WARNING.argb.toColor() else c.text2
            androidx.compose.material3.Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            Text(message, style = ObliTypography.body, color = c.text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }
        tip?.let { Text(it, style = ObliTypography.labelSmall, color = c.text2, modifier = Modifier.padding(start = 30.dp)) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            TextAction(stringResource(R.string.remote_close), onClose, tonal = false)
            if (reason != EndReason.SESSION_EXPIRED) {
                Spacer(Modifier.size(8.dp))
                TextAction(action, onReopen, tonal = true)
            }
        }
    }
}

/** 48 dp text button: tonal (accent2 12 %) for the main action, plain otherwise. */
@Composable
internal fun TextAction(label: String, onClick: () -> Unit, tonal: Boolean, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (tonal) c.accent2.copy(alpha = 0.12f) else Color.Transparent)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = ObliTypography.label, color = if (tonal) c.accent2 else c.text2)
    }
}

@Composable
private fun terminalTexts(protocol: String): TerminalTexts = TerminalTexts(
    startTitle = stringResource(
        when (protocol) {
            "powershell" -> R.string.remote_start_powershell
            "cmd" -> R.string.remote_start_cmd
            else -> R.string.remote_start_ssh
        },
    ),
    startConsequence = stringResource(R.string.remote_start_consequence),
    endTitle = stringResource(R.string.remote_end_session),
    offline = stringResource(R.string.remote_blocked_offline),
    legacy = stringResource(R.string.remote_blocked_legacy),
)

/** « SYSTÈME » for a Windows shell without a chosen user session. */
@Composable
private fun contextLabel(protocol: String, wtsSessionId: Int?): String? = when {
    protocol == "ssh" -> null
    wtsSessionId == null -> stringResource(R.string.remote_context_system)
    else -> stringResource(R.string.remote_context_session, wtsSessionId)
}

@Composable
private fun statusLabel(body: TerminalBody, sinceMs: Long?, now: Long): String = when (body) {
    TerminalBody.Connecting -> stringResource(R.string.remote_status_connecting)
    TerminalBody.Waiting -> stringResource(R.string.remote_status_waiting)
    TerminalBody.Live -> sinceMs?.let { formatDuration(now - it) } ?: stringResource(R.string.remote_status_connected)
    is TerminalBody.Ended -> stringResource(if (body.reason == EndReason.CONNECTION_LOST) R.string.remote_status_lost else R.string.remote_status_ended)
    is TerminalBody.StartFailed -> stringResource(R.string.remote_status_not_started)
}

private fun dotFor(body: TerminalBody): ObliTokens.Status = when (body) {
    TerminalBody.Live -> ObliTokens.Status.ONLINE
    TerminalBody.Connecting, TerminalBody.Waiting -> ObliTokens.Status.PENDING
    is TerminalBody.Ended -> if (body.reason == EndReason.CONNECTION_LOST) ObliTokens.Status.WARNING else ObliTokens.Status.OFFLINE
    is TerminalBody.StartFailed -> ObliTokens.Status.OFFLINE
}

/** 00:04:12 */
internal fun formatDuration(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%02d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60)
}

/** Current time, ticking every second while [ticking]. */
@Composable
internal fun produceNow(ticking: Boolean): androidx.compose.runtime.State<Long> {
    val now = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(ticking) {
        while (ticking) {
            now.longValue = System.currentTimeMillis()
            delay(1_000)
        }
    }
    return now
}

private fun clipboardText(context: Context): String? {
    val cm = context.getSystemService(ClipboardManager::class.java) ?: return null
    val clip = cm.primaryClip ?: return null
    if (clip.itemCount == 0) return null
    return clip.getItemAt(0).coerceToText(context)?.toString()?.takeIf { it.isNotEmpty() }
}

/** The start failure in the words of §7.8 (403 remote, 409 legacy), else the action host's text. */
private fun startFailure(context: Context, result: ActionResult<*>): String {
    val res = context.resources
    val outcome = (result as? ActionResult.Failed)?.outcome
    return when {
        outcome is ApiOutcome.Unsupported && outcome.message.contains("legacy", ignoreCase = true) -> res.getString(R.string.remote_blocked_legacy)
        outcome is ApiOutcome.Forbidden && outcome.message.contains("Remote access not permitted", ignoreCase = true) -> res.getString(R.string.remote_forbidden)
        else -> ActionMessages.describe(res, result, done = "")?.text?.takeIf { it.isNotEmpty() } ?: res.getString(R.string.remote_start_failed)
    }
}
