package tools.obli.obliance.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.core.security.ui.LocalActionRunner
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.actionEndpoints

/**
 * S61 — « Sur quelle session ouvrir ? » for a Windows shell (design doc §5
 * S61): « Session SYSTÈME (aucun utilisateur) » (default) then the user
 * sessions reported by the agent, exactly like the web's context picker
 * (`list_wts_sessions`, priority high, result through `COMMAND_UPDATED`).
 * [onChoose] receives null for SYSTEM, else the WTS session id to pass to
 * [TerminalScreen].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionChoiceSheet(
    serverId: ServerId,
    deviceId: Long,
    protocol: String,
    onChoose: (wtsSessionId: Int?) -> Unit,
    onDismiss: () -> Unit,
) {
    val services = LocalObliServices.current
    val runner = LocalActionRunner.current
    val vm = viewModel(key = "wts-${serverId.value}-$deviceId") { SessionChoiceViewModel(services, serverId, deviceId) }
    val state by vm.state.collectAsState()
    val title = stringResource(R.string.remote_choice_list_title)
    LaunchedEffect(Unit) { vm.load(runner, title) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = ObliTheme.colors.surface1,
    ) {
        SessionChoiceContent(protocol, state, onChoose)
    }
}

internal sealed interface WtsState {
    data object Loading : WtsState
    data class Loaded(val sessions: List<WtsSession>) : WtsState

    /** Could not ask the agent (offline, refused, timeout): SYSTEM only. */
    data object Unavailable : WtsState
}

internal class SessionChoiceViewModel(
    private val services: ObliServices,
    private val serverId: ServerId,
    private val deviceId: Long,
    private val timeoutMs: Long = 15_000,
    private val pollMs: Long = 2_000,
) : ViewModel() {
    private val _state = MutableStateFlow<WtsState>(WtsState.Loading)
    val state: StateFlow<WtsState> = _state.asStateFlow()
    private var job: Job? = null

    fun load(runner: ActionRunner, title: String) {
        if (job != null) return
        job = viewModelScope.launch {
            val server = services.sessions.session(serverId) ?: return@launch run { _state.value = WtsState.Unavailable }
            // T0 (a read-only listing) — still through the runner: step-up, approval and privacy apply.
            val spec = ActionSpec(key = "command.list_wts_sessions", tier = Tier.T0, title = title, target = "#$deviceId", scope = "", endpoints = server.actionEndpoints(deviceId))
            val result = runner.run(spec) { extra -> RemoteApi.enqueueListWts(server, deviceId, extra) }
            val command = (result as? ActionResult.Done)?.value ?: return@launch run { _state.value = WtsState.Unavailable }
            val found = CompletableDeferred<List<WtsSession>?>()
            // Socket first (the active server's), polling as a fallback.
            val socket = launch {
                server.realtime.events.collect { e ->
                    if (e.name != ObliEvents.COMMAND_UPDATED) return@collect
                    val row = ApiJson.decode(CommandRow.serializer(), e.payload) ?: return@collect
                    if (row.id == command.id && RemoteApi.isFinished(row)) found.complete(RemoteApi.wtsSessionsOf(row) ?: emptyList())
                }
            }
            val poll = launch {
                while (!found.isCompleted) {
                    delay(pollMs)
                    val page = (RemoteApi.recentCommands(server, deviceId) as? ApiOutcome.Ok)?.value ?: continue
                    val row = page.items.firstOrNull { it.id == command.id } ?: continue
                    if (RemoteApi.isFinished(row)) found.complete(RemoteApi.wtsSessionsOf(row) ?: emptyList())
                }
            }
            val sessions = withTimeoutOrNull(timeoutMs) { found.await() }
            socket.cancel()
            poll.cancel()
            _state.value = if (sessions == null) WtsState.Unavailable else WtsState.Loaded(sessions)
        }
    }
}

@Composable
internal fun SessionChoiceContent(protocol: String, state: WtsState, onChoose: (Int?) -> Unit) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        Text(
            stringResource(R.string.remote_choice_title),
            style = ObliTypography.dialogTitle,
            color = c.text,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp).semantics { heading() },
        )
        Text(
            stringResource(if (protocol == "cmd") R.string.remote_protocol_cmd else R.string.remote_protocol_powershell),
            style = ObliTypography.labelSmall,
            color = c.textMuted,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        ChoiceRow(
            title = stringResource(R.string.remote_choice_system),
            subtitle = stringResource(R.string.remote_choice_system_detail),
            dot = ObliTokens.Status.PENDING,
            onClick = { onChoose(null) },
        )
        when (state) {
            WtsState.Loading -> Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CircularProgressIndicator(color = c.text2, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                Text(stringResource(R.string.remote_choice_loading), style = ObliTypography.body, color = c.text2)
            }
            WtsState.Unavailable -> Note(stringResource(R.string.remote_choice_unavailable))
            is WtsState.Loaded -> if (state.sessions.isEmpty()) {
                Note(stringResource(R.string.remote_choice_none))
            } else {
                state.sessions.forEach { s ->
                    val user = if (s.domain.isNotBlank()) "${s.domain}\\${s.username}" else s.username
                    val stateLabel = when (s.state.lowercase()) {
                        "active" -> stringResource(R.string.remote_choice_state_active)
                        "disconnected" -> stringResource(R.string.remote_choice_state_disconnected)
                        else -> s.state
                    }
                    ChoiceRow(
                        title = listOf(s.name.ifBlank { stringResource(R.string.remote_context_session, s.id) }, user).joinToString(" — "),
                        subtitle = stringResource(R.string.remote_choice_session_detail, s.id, stateLabel),
                        dot = when (s.state.lowercase()) {
                            "active" -> ObliTokens.Status.ONLINE
                            "disconnected" -> ObliTokens.Status.WARNING
                            else -> ObliTokens.Status.OFFLINE
                        },
                        onClick = { onChoose(s.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ChoiceRow(title: String, subtitle: String, dot: ObliTokens.Status, onClick: () -> Unit) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 24.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(dot.argb.toColor()))
        Column(Modifier.weight(1f)) {
            Text(title, style = ObliTypography.rowTitle, color = c.text)
            Text(subtitle, style = ObliTypography.labelSmall, color = c.text2)
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(text, style = ObliTypography.body, color = ObliTheme.colors.text2, modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp))
}
