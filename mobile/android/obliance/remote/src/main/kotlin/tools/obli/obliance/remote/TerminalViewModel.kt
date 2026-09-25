package tools.obli.obliance.remote

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Preflight
import tools.obli.core.security.Tier
import tools.obli.obliance.api.Device
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.actionEndpoints

/** Texts of the confirmations, resolved by the screen (resources). */
internal data class TerminalTexts(
    val startTitle: String,
    val startConsequence: String,
    val endTitle: String,
    val offline: String,
    val legacy: String,
)

internal sealed interface StartState {
    /** No session yet: the screen starts one as soon as the device is known. */
    data object Idle : StartState
    data object Starting : StartState

    /** Refused by the server or the user (the message is resolved by the screen). */
    data class Failed(val result: ActionResult<*>) : StartState

    /** The server did not return the relay token (web `MissingSessionTokenError`). */
    data object NoToken : StartState
}

internal data class TerminalUi(
    val device: Device? = null,
    val deviceLoaded: Boolean = false,
    val sessionId: String? = null,
    val start: StartState = StartState.Idle,
)

/**
 * S60 state: which [ShellSession] of the [SessionManager] this screen shows,
 * and the start / end of sessions through the action runner. The session
 * itself outlives this ViewModel (process-level manager).
 */
internal class TerminalViewModel(
    private val services: ObliServices,
    val serverId: ServerId,
    val deviceId: Long,
    val protocol: String,
    val wtsSessionId: Int?,
    resumeId: String?,
    private val engineFactory: ((onInput: (ByteArray) -> Unit, onResize: (Int, Int) -> Unit) -> TerminalEngine)? = ::TermlibEngine,
) : ViewModel() {
    private val _ui = MutableStateFlow(
        TerminalUi(
            sessionId = (SessionManager.find(resumeId) as? ShellSession)?.id
                ?: SessionManager.findShell(serverId, deviceId, protocol, wtsSessionId)?.id,
        ),
    )
    val ui: StateFlow<TerminalUi> = _ui.asStateFlow()

    val session: ShellSession? get() = SessionManager.find(_ui.value.sessionId) as? ShellSession

    init {
        viewModelScope.launch {
            val device = (services.devices.detail(serverId, deviceId) as? ApiOutcome.Ok<Device>)?.value
            _ui.update { it.copy(device = device, deviceLoaded = true) }
        }
    }

    val deviceLabel: String get() = _ui.value.device?.label ?: session?.deviceLabel ?: "#$deviceId"

    /** « Obliance Prod › ACME » with 2+ servers, « ACME » otherwise (design doc §7.6). */
    fun scopeLabel(): String {
        val reg = services.registry.state.value
        val tenant = _ui.value.device?.tenantName
        val server = reg.byId(serverId)?.displayName
        return listOfNotNull(server.takeIf { reg.isMultiServer }, tenant).joinToString(" › ").ifEmpty { server.orEmpty() }
    }

    /**
     * [start] in the ViewModel's scope: the screen's effect restarts when `start`
     * turns to Starting, which would otherwise cancel the pending T1 confirmation.
     */
    fun begin(runner: ActionRunner, texts: TerminalTexts) {
        viewModelScope.launch { start(runner, texts) }
    }

    /** Opens a new session: T1 confirmation, then `POST /api/remote/sessions`, then the tunnel. */
    suspend fun start(runner: ActionRunner, texts: TerminalTexts) {
        if (_ui.value.start == StartState.Starting) return
        val server = services.sessions.session(serverId) ?: return
        _ui.update { it.copy(start = StartState.Starting) }
        val device = _ui.value.device
        val spec = ActionSpec(
            key = "remote.session_start",
            tier = Tier.T1,
            title = texts.startTitle,
            target = deviceLabel,
            scope = scopeLabel(),
            consequence = texts.startConsequence,
            endpoints = server.actionEndpoints(deviceId),
        )
        val result = runner.run(spec, preflight = {
            when {
                device != null && device.isLegacyAgent -> Preflight.Blocked(texts.legacy)
                device != null && !device.statusKind.isConnected -> Preflight.Blocked(texts.offline)
                else -> Preflight.Ok
            }
        }) { extra -> RemoteApi.start(server, deviceId, protocol, wtsSessionId, extra) }

        if (result !is ActionResult.Done) {
            _ui.update { it.copy(start = StartState.Failed(result)) }
            return
        }
        val started = result.value
        val token = started.sessionToken
        if (token == null || !tools.obli.core.tunnel.TunnelSocket.isValidToken(token)) {
            // Never keep a session nobody can attach to.
            RemoteApi.end(server, started.id)
            _ui.update { it.copy(start = StartState.NoToken) }
            return
        }
        val shell = ShellSession(
            id = started.id,
            serverId = serverId,
            deviceId = deviceId,
            deviceLabel = deviceLabel,
            tenantName = device?.tenantName,
            protocol = protocol,
            wtsSessionId = wtsSessionId,
            wtsLabel = null,
            server = server,
            token = token,
            scope = SessionManager.scope,
            engineFactory = engineFactory,
        )
        SessionManager.add(shell)
        shell.start()
        _ui.update { it.copy(sessionId = shell.id, start = StartState.Idle) }
    }

    /**
     * « Terminer » (T1, design doc §7.6 « terminer sa propre session distante »);
     * « Annuler » while the device has not answered yet is T0. Returns true when
     * the screen should leave.
     */
    suspend fun terminate(runner: ActionRunner, texts: TerminalTexts): Boolean {
        val shell = session ?: return true
        if (!shell.phase.value.isLive) {
            SessionManager.remove(shell.id)
            return true
        }
        val waiting = shell.phase.value !is SessionPhase.Connected
        val spec = ActionSpec(
            key = "remote.session_end",
            tier = if (waiting) Tier.T0 else Tier.T1,
            title = texts.endTitle,
            target = deviceLabel,
            scope = scopeLabel(),
        )
        val result = runner.run(spec) { shell.terminate() }
        if (result is ActionResult.Done) SessionManager.remove(shell.id)
        return result is ActionResult.Done
    }

    /** « Rouvrir » / « Nouvelle session »: a new session on the same device and protocol (design doc F5 step 7). */
    fun forgetEnded() {
        session?.let { if (!it.phase.value.isLive) SessionManager.remove(it.id) }
        _ui.update { it.copy(sessionId = null, start = StartState.Idle) }
    }

    /** Leaves the failed state so the screen can retry. */
    fun retry() = _ui.update { it.copy(start = StartState.Idle) }
}
