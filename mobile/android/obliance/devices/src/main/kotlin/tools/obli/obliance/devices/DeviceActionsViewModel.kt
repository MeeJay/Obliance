package tools.obli.obliance.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ForbiddenReason
import tools.obli.core.network.isSuccess
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Preflight
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.ObliServices

/** The last action started from this screen (S40 header "Dernière action : … (03:17)"). */
internal data class LastAction(
    val title: String,
    val at: Long,
    /** Commands it enqueued, followed by `COMMAND_UPDATED` (REST fallback). */
    val commandIds: List<String> = emptyList(),
    val awaitingApproval: Boolean = false,
)

internal data class ServicesUi(
    val items: List<ServiceInfo> = emptyList(),
    val loaded: Boolean = false,
    val loading: Boolean = false,
    /** `list_services` sent, waiting for the agent (spinner, 90 s timeout like the web). */
    val listing: Boolean = false,
    val listTimedOut: Boolean = false,
    val problem: LoadProblem? = null,
    /** When the list on screen was received (REST load or socket push). */
    val receivedAt: Long? = null,
    /** Service name → command type in flight. */
    val pending: Map<String, String> = emptyMap(),
)

internal data class ProcessesUi(
    val items: List<ProcessInfo> = emptyList(),
    val receivedAt: Long? = null,
    /** "Figer": the display keeps the last list, the subscription stays. */
    val frozen: Boolean = false,
    val killing: Set<Long> = emptySet(),
)

internal data class TasksUi(
    val items: List<CommandDto> = emptyList(),
    val total: Int = 0,
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val problem: LoadProblem? = null,
    val cancelling: Set<String> = emptySet(),
)

internal data class ActionsState(
    /** Commands started here, by id, as the server last described them. */
    val commands: Map<String, CommandDto> = emptyMap(),
    val last: LastAction? = null,
    /** Capabilities the server refused (403) on this device during this visit. */
    val refused: Set<String> = emptySet(),
    /** Keys of actions whose confirmation / call is in progress. */
    val running: Set<String> = emptySet(),
    val services: ServicesUi = ServicesUi(),
    val processes: ProcessesUi = ProcessesUi(),
    val tasks: TasksUi = TasksUi(),
) {
    /** The command of [last] still in progress, else its final state. */
    val lastCommand: CommandDto? get() = last?.commandIds?.mapNotNull { commands[it] }?.let { cmds -> cmds.firstOrNull { !it.state.terminal } ?: cmds.firstOrNull() }

    val hasActiveCommands: Boolean get() = commands.values.any { !it.state.terminal }
}

/** Target of the tenant switch the S40 banner and the runner ask for. */
internal data class TenantTarget(val tenantId: Long, val name: String)

/**
 * Actions of S30/S40 and the Services, Processus and Tâches tabs (§5 S30–S36)
 * of one device of [serverId]. Every mutating call goes through [runner]
 * (the app's LocalActionRunner) over THAT server's session; commands are
 * followed by `COMMAND_UPDATED` on the socket, with a REST fallback.
 */
internal class DeviceActionsViewModel(
    private val services: ObliServices,
    private val remote: CommandRemote,
    private val runner: ActionRunner,
    private val clock: DevicesClock,
    val serverId: ServerId,
    val deviceId: Long,
    private val realtimeOf: (ServerId) -> RealtimeClient? = { services.sessions.session(it)?.realtime },
    private val listTimeoutMs: Long = LIST_TIMEOUT_MS,
) : ViewModel() {

    private val _state = MutableStateFlow(ActionsState())
    val state: StateFlow<ActionsState> = _state.asStateFlow()

    private var listTimeout: Job? = null

    // -- tenant (§2.3): action routes are bound to the SESSION tenant -------------------------

    /** The tenant to switch to before acting on [device], null when the session is already on it. */
    fun tenantTarget(device: Device): TenantTarget? {
        val target = device.tenantId ?: return null
        val session = services.sessions.session(serverId) ?: return null
        val current = (session.auth.value as? AuthState.SignedIn)?.probe?.currentTenantId ?: return null
        if (current == target) return null
        val name = device.tenantName?.takeIf { it.isNotBlank() }
            ?: services.tenants.scope.value.takeIf { it.serverId == serverId }?.tenants?.firstOrNull { it.id == target }?.name
            ?: "#$target"
        return TenantTarget(target, name)
    }

    private suspend fun switchTo(target: TenantTarget): Boolean = services.tenants.switchTo(target.tenantId, serverId).isSuccess

    /** "Basculer et continuer" of the S40 banner. */
    fun switchTenant(device: Device, onDone: (Boolean) -> Unit = {}) {
        val target = tenantTarget(device) ?: return onDone(true)
        viewModelScope.launch { onDone(switchTo(target)) }
    }

    private fun preflight(device: Device, blocked: String?): Preflight {
        if (blocked != null) return Preflight.Blocked(blocked)
        val target = tenantTarget(device) ?: return Preflight.Ok
        return Preflight.NeedsTenantSwitch(target.name) { switchTo(target) }
    }

    // -- running an action --------------------------------------------------------------------

    /**
     * Runs [call] through the runner: [blocked] (offline, legacy… already
     * localised) stops it before anything is sent; the tenant switch is asked
     * first when needed. Commands returned by [call] are followed.
     */
    private fun <T> launchAction(
        spec: ActionSpec,
        device: Device,
        blocked: String?,
        onResult: (ActionResult<T>) -> Unit,
        commandsOf: (T) -> List<CommandDto> = { emptyList() },
        call: suspend (JsonObject) -> ApiOutcome<T>,
    ): Job? {
        if (spec.key in _state.value.running) return null
        _state.update { it.copy(running = it.running + spec.key) }
        return viewModelScope.launch {
            val result = try {
                runner.run(spec, preflight = { preflight(device, blocked) }, call = call)
            } finally {
                _state.update { it.copy(running = it.running - spec.key) }
            }
            when (result) {
                is ActionResult.Done -> {
                    val cmds = commandsOf(result.value)
                    _state.update { s ->
                        s.copy(
                            commands = s.commands + cmds.filter { it.id.isNotEmpty() }.associateBy { it.id },
                            last = LastAction(spec.title, clock.now(), cmds.map { it.id }.filter { it.isNotEmpty() }),
                        )
                    }
                }
                is ActionResult.AwaitingApproval -> _state.update { it.copy(last = LastAction(spec.title, clock.now(), awaitingApproval = true)) }
                is ActionResult.Failed -> learnRefusal(result.outcome)
                else -> Unit
            }
            onResult(result)
        }
    }

    private fun learnRefusal(outcome: ApiOutcome<Nothing>) {
        val cap = (outcome as? ApiOutcome.Forbidden)?.takeIf { it.reason == ForbiddenReason.CAPABILITY }?.capability ?: return
        _state.update { it.copy(refused = it.refused + cap) }
    }

    /** `POST /api/commands {deviceId, type, payload, priority}` for the header / S40 commands. */
    fun command(spec: ActionSpec, device: Device, type: String, blocked: String?, onResult: (ActionResult<CommandDto>) -> Unit) {
        launchAction(spec, device, blocked, onResult, commandsOf = { listOf(it) }) { extra ->
            remote.enqueue(serverId, deviceId, type, JsonObject(emptyMap()), "normal", extra)
        }
    }

    /** "Tout analyser" (T0): scan_inventory, scan_updates, check_compliance, as the web's handleScanAll. */
    fun scanAll(spec: ActionSpec, device: Device, blocked: String?, onResult: (ActionResult<List<CommandDto>>) -> Unit) {
        launchAction(spec, device, blocked, onResult, commandsOf = { it }) { extra ->
            val sent = mutableListOf<CommandDto>()
            for (type in SCAN_ALL) {
                when (val out = remote.enqueue(serverId, deviceId, type, JsonObject(emptyMap()), "normal", extra)) {
                    is ApiOutcome.Ok -> sent += out.value
                    is ApiOutcome.Accepted -> sent += out.value
                    else -> if (sent.isEmpty()) return@launchAction out.nothing() else break
                }
            }
            ApiOutcome.Ok(sent.toList())
        }
    }

    /** "Envoyer les mesures maintenant" (T0): `POST /api/devices/:id/live-metrics {mode:'push_now'}`. */
    fun pushMetrics(spec: ActionSpec, device: Device, blocked: String?, push: suspend () -> ApiOutcome<*>, onResult: (ActionResult<Unit>) -> Unit) {
        launchAction(spec, device, blocked, onResult) { _ ->
            when (val out = push()) {
                is ApiOutcome.Ok, is ApiOutcome.Accepted -> ApiOutcome.Ok(Unit)
                else -> out.nothing()
            }
        }
    }

    /** Isolate (T2) / restore (T3) the network: `POST /api/devices/:id/airgap/enable|disable`. */
    fun airgap(spec: ActionSpec, device: Device, enable: Boolean, blocked: String?, onResult: (ActionResult<Unit>) -> Unit) {
        launchAction(spec, device, blocked, onResult) { extra -> remote.airgap(serverId, deviceId, enable, extra) }
    }

    /**
     * S44 on demand ("Déverrouiller", privacy banner): the runner opens the
     * unlock sheet on a 423; the call answers 423 for [feature] until the
     * sheet unlocked the device (`POST /api/devices/:id/privacy/unlock`), then Ok.
     */
    fun unlockPrivacy(spec: ActionSpec, device: Device, feature: String, onResult: (ActionResult<Unit>) -> Unit) {
        var asked = false
        launchAction(spec, device, null, onResult) { _ ->
            if (!asked) {
                asked = true
                ApiOutcome.PrivacyLocked(feature, device.privacyPasswordSet, "")
            } else {
                ApiOutcome.Ok(Unit)
            }
        }
    }

    // -- Services (S32) ------------------------------------------------------------------------

    /** `GET /api/devices/:id/services`: the list the agent last reported. */
    fun loadServices() {
        if (_state.value.services.loading) return
        _state.update { it.copy(services = it.services.copy(loading = true)) }
        viewModelScope.launch {
            val out = remote.services(serverId, deviceId)
            _state.update { s ->
                val list = (out as? ApiOutcome.Ok)?.value
                s.copy(
                    services = if (list != null) {
                        // A live push may already have replaced it: keep the newest.
                        if (s.services.receivedAt != null && s.services.loaded) s.services.copy(loading = false)
                        else s.services.copy(items = list, loaded = true, loading = false, problem = null, receivedAt = if (list.isEmpty()) null else clock.now())
                    } else {
                        s.services.copy(loading = false, problem = out.toProblem("/api/devices/$deviceId/services"))
                    },
                )
            }
        }
    }

    /** "Actualiser" / pull (T0, §7.3): `list_services`; the agent answers with `DEVICE_SERVICES_UPDATED`. */
    fun listServices(spec: ActionSpec, device: Device, blocked: String?, onResult: (ActionResult<CommandDto>) -> Unit) {
        launchAction(spec, device, blocked, { r ->
            if (r is ActionResult.Done) {
                _state.update { it.copy(services = it.services.copy(listing = true, listTimedOut = false)) }
                listTimeout?.cancel()
                listTimeout = viewModelScope.launch {
                    delay(listTimeoutMs)
                    _state.update { it.copy(services = it.services.copy(listing = false, listTimedOut = true)) }
                }
            }
            onResult(r)
        }, commandsOf = { listOf(it) }) { extra ->
            remote.enqueue(serverId, deviceId, "list_services", JsonObject(emptyMap()), "normal", extra)
        }
    }

    /** Start / restart (T1) / stop (T2) one service: `{type, payload:{name}}` as handleServiceAction. */
    fun serviceAction(spec: ActionSpec, device: Device, service: ServiceInfo, type: String, blocked: String?, onResult: (ActionResult<CommandDto>) -> Unit) {
        launchAction(spec, device, blocked, { r ->
            if (r !is ActionResult.Done) _state.update { it.copy(services = it.services.copy(pending = it.services.pending - service.name)) }
            onResult(r)
        }, commandsOf = { listOf(it) }) { extra ->
            _state.update { it.copy(services = it.services.copy(pending = it.services.pending + (service.name to type))) }
            remote.enqueue(serverId, deviceId, type, buildJsonObject { put("name", JsonPrimitive(service.name)) }, "normal", extra)
        }
    }

    // -- Processes (S33) -----------------------------------------------------------------------

    fun setFrozen(frozen: Boolean) = _state.update { it.copy(processes = it.processes.copy(frozen = frozen)) }

    /** Kill (T1, T2 for the critical list): `{type:'kill_process', payload:{pid, name}, priority:'high'}`. */
    fun kill(spec: ActionSpec, device: Device, process: ProcessInfo, blocked: String?, onResult: (ActionResult<CommandDto>) -> Unit) {
        launchAction(spec, device, blocked, { r ->
            if (r !is ActionResult.Done) _state.update { it.copy(processes = it.processes.copy(killing = it.processes.killing - process.pid)) }
            onResult(r)
        }, commandsOf = { listOf(it) }) { extra ->
            _state.update { it.copy(processes = it.processes.copy(killing = it.processes.killing + process.pid)) }
            val payload = buildJsonObject {
                put("pid", JsonPrimitive(process.pid))
                put("name", JsonPrimitive(process.name))
            }
            remote.enqueue(serverId, deviceId, "kill_process", payload, "high", extra)
        }
    }

    /**
     * While the Processus tab is visible: `PROCESS_SUBSCRIBE {deviceId}`
     * (again after every reconnection), `PROCESS_UNSUBSCRIBE` when it stops,
     * exactly like the web ProcessesTab.
     */
    suspend fun watchProcesses() {
        val rt = realtimeOf(serverId) ?: return
        val payload = buildJsonObject { put("deviceId", JsonPrimitive(deviceId)) }
        try {
            rt.state.collect { s -> if (s == ConnectionState.CONNECTED) rt.emit(ObliEvents.PROCESS_SUBSCRIBE, payload) }
        } finally {
            rt.emit(ObliEvents.PROCESS_UNSUBSCRIBE, payload)
        }
    }

    // -- Tasks (S36) ---------------------------------------------------------------------------

    /** `GET /api/commands?deviceId=&limit=50`. */
    fun loadTasks() {
        if (_state.value.tasks.loading) return
        _state.update { it.copy(tasks = it.tasks.copy(loading = true)) }
        viewModelScope.launch { refreshTasks() }
    }

    private suspend fun refreshTasks() {
        val out = remote.commands(serverId, deviceId)
        _state.update { s ->
            val page = (out as? ApiOutcome.Ok)?.value
            if (page == null) {
                s.copy(tasks = s.tasks.copy(loading = false, problem = out.toProblem("/api/commands")))
            } else {
                val byId = page.items.associateBy { it.id }
                s.copy(
                    tasks = s.tasks.copy(items = page.items, total = page.total, loaded = true, loading = false, problem = null),
                    // REST fallback of the tracking: the list is newer than what we followed.
                    commands = s.commands.mapValues { (id, c) -> byId[id] ?: c },
                ).withServiceOutcomes(page.items)
            }
        }
    }

    /** Cancel a pending command (T1): `DELETE /api/commands/:id`. */
    fun cancelTask(spec: ActionSpec, device: Device, command: CommandDto, onResult: (ActionResult<Unit>) -> Unit) {
        _state.update { it.copy(tasks = it.tasks.copy(cancelling = it.tasks.cancelling + command.id)) }
        launchAction(spec, device, null, { r ->
            _state.update { s ->
                val done = r is ActionResult.Done
                s.copy(
                    tasks = s.tasks.copy(
                        cancelling = s.tasks.cancelling - command.id,
                        items = if (done) s.tasks.items.map { if (it.id == command.id) it.copy(status = CommandState.CANCELLED.wire) else it } else s.tasks.items,
                    ),
                )
            }
            onResult(r)
        }) { extra -> remote.cancel(serverId, command.id, extra) }
    }

    // -- realtime ------------------------------------------------------------------------------

    /**
     * While the screen is visible: `COMMAND_UPDATED` / `COMMAND_RESULT`,
     * `DEVICE_SERVICES_UPDATED` and `DEVICE_PROCESSES_UPDATED` of this device;
     * while a followed command is not finished, `GET /api/commands` every 5 s
     * without a socket (every 15 s with one, in case an event was missed).
     */
    suspend fun followRealtime() {
        coroutineScope {
            val rt = realtimeOf(serverId)
            if (rt != null) {
                launch {
                    rt.events.collect { e ->
                        // Only the active server's socket is connected; its events are about this server.
                        if (services.registry.state.value.activeId == serverId) onEvent(e.name, e.payload)
                    }
                }
            }
            launch {
                while (true) {
                    _state.filter { it.hasActiveCommands }.first()
                    val live = rt?.state?.value == ConnectionState.CONNECTED
                    delay(if (live) SOCKET_FALLBACK_MS else POLL_MS)
                    if (_state.value.hasActiveCommands) refreshTasks()
                }
            }
        }
    }

    internal fun onEvent(name: String, payload: JsonElement?) {
        when (name) {
            ObliEvents.COMMAND_UPDATED, ObliEvents.COMMAND_RESULT -> {
                val cmd = tools.obli.obliance.api.ApiJson.decode(CommandDto.serializer(), payload) ?: return
                if (cmd.deviceId != deviceId || cmd.id.isEmpty()) return
                onCommand(cmd)
            }
            ObliEvents.DEVICE_SERVICES_UPDATED -> {
                val obj = payload as? JsonObject ?: return
                if (obj.long("deviceId") != deviceId) return
                val list = decodeList(ServiceInfo.serializer(), obj["services"]) ?: return
                listTimeout?.cancel()
                _state.update { s ->
                    s.copy(services = s.services.copy(items = list, loaded = true, listing = false, listTimedOut = false, problem = null, receivedAt = clock.now()))
                }
            }
            ObliEvents.DEVICE_PROCESSES_UPDATED -> {
                val obj = payload as? JsonObject ?: return
                if (obj.long("deviceId") != deviceId) return
                val list = decodeList(ProcessInfo.serializer(), obj["processes"]) ?: return
                _state.update { s ->
                    if (s.processes.frozen) s
                    else s.copy(processes = s.processes.copy(items = list, receivedAt = clock.now()))
                }
            }
        }
    }

    internal fun onCommand(cmd: CommandDto) {
        _state.update { s ->
            val tasks = s.tasks.items
            val idx = tasks.indexOfFirst { it.id == cmd.id }
            val newTasks = if (idx >= 0) tasks.toMutableList().also { it[idx] = cmd } else listOf(cmd) + tasks
            var next = s.copy(
                commands = if (cmd.id in s.commands) s.commands + (cmd.id to cmd) else s.commands,
                tasks = if (s.tasks.loaded) s.tasks.copy(items = newTasks, total = if (idx >= 0) s.tasks.total else s.tasks.total + 1) else s.tasks,
            ).withServiceOutcomes(listOf(cmd))
            if (cmd.type == "list_services" && cmd.state.terminal) {
                listTimeout?.cancel()
                next = next.copy(services = next.services.copy(listing = false))
            }
            if (cmd.type == "kill_process" && cmd.state.terminal) {
                val pid = cmd.payloadPid
                if (pid != null) {
                    next = next.copy(
                        processes = next.processes.copy(
                            killing = next.processes.killing - pid,
                            items = if (cmd.state == CommandState.SUCCESS) next.processes.items.filter { it.pid != pid } else next.processes.items,
                        ),
                    )
                }
            }
            next
        }
    }

    /** A finished start/stop/restart clears the row's pending state; success updates it optimistically (web). */
    private fun ActionsState.withServiceOutcomes(cmds: List<CommandDto>): ActionsState {
        var s = this
        for (cmd in cmds) {
            if (cmd.type !in SERVICE_COMMANDS || !cmd.state.terminal) continue
            val name = cmd.payloadName ?: continue
            if (s.services.pending[name] == null) continue
            val status = when (cmd.type) {
                "start_service" -> "running"
                "stop_service" -> "stopped"
                else -> null
            }
            s = s.copy(
                services = s.services.copy(
                    pending = s.services.pending - name,
                    items = if (cmd.state == CommandState.SUCCESS && status != null) s.services.items.map { if (it.name == name) it.copy(status = status) else it } else s.services.items,
                ),
            )
        }
        return s
    }

    private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.let { it.longOrNull ?: it.content.toLongOrNull() }

    companion object {
        val SCAN_ALL = listOf("scan_inventory", "scan_updates", "check_compliance")
        val SERVICE_COMMANDS = setOf("start_service", "stop_service", "restart_service")
        const val LIST_TIMEOUT_MS = 90_000L
        const val POLL_MS = 5_000L
        const val SOCKET_FALLBACK_MS = 15_000L
    }
}

@Suppress("UNCHECKED_CAST")
private fun ApiOutcome<*>.nothing(): ApiOutcome<Nothing> = this as ApiOutcome<Nothing>
