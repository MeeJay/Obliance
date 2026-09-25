package tools.obli.obliance.devices

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.realtime.ConnectionState
import tools.obli.core.realtime.RealtimeClient
import tools.obli.core.realtime.RealtimeEvent
import tools.obli.core.security.ActionPrompter
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.TwoFactorAnswer

/** Prompter that accepts everything and records what it was asked. */
internal class RecordingPrompter(var accept: Boolean = true) : ActionPrompter {
    val confirmed = mutableListOf<ActionSpec>()
    val switches = mutableListOf<String>()
    val unlocks = mutableListOf<String?>()

    override suspend fun confirmTenantSwitch(spec: ActionSpec, tenantName: String): Boolean = accept.also { switches += tenantName }
    override suspend fun confirm(spec: ActionSpec): Boolean = accept.also { confirmed += spec }
    override suspend fun askTwoFactor(spec: ActionSpec, currentIp: String?, previousWasWrong: Boolean): TwoFactorAnswer? = null
    override suspend fun approvalRequested(spec: ActionSpec, approvalId: Long) = Unit
    override suspend fun unlockPrivacy(spec: ActionSpec, feature: String?, passwordSet: Boolean): Boolean = accept.also { unlocks += feature }
    override suspend fun sessionExpired() = Unit
}

internal fun testRunner(prompter: ActionPrompter = RecordingPrompter()): ActionRunner = ActionRunner(prompter, clock = { NIGHT_NOW })

/** One recorded call of [FakeCommandRemote]. */
internal data class RemoteCall(val serverId: ServerId, val what: String, val deviceId: Long? = null, val type: String? = null, val payload: JsonObject? = null, val priority: String? = null)

/** Network-free [CommandRemote] answering like the server, recording every call and its server. */
internal class FakeCommandRemote(
    var services: List<ServiceInfo> = SAMPLE_SERVICES,
    var tasks: List<CommandDto> = SAMPLE_TASKS,
) : CommandRemote {
    val calls = mutableListOf<RemoteCall>()
    var enqueueAnswer: ((String) -> ApiOutcome<CommandDto>)? = null
    var servicesAnswer: ApiOutcome<List<ServiceInfo>>? = null
    private var next = 1

    override suspend fun enqueue(serverId: ServerId, deviceId: Long, type: String, payload: JsonObject, priority: String, extra: JsonObject): ApiOutcome<CommandDto> {
        calls += RemoteCall(serverId, "enqueue", deviceId, type, payload, priority)
        enqueueAnswer?.let { return it(type) }
        return ApiOutcome.Ok(CommandDto(id = "cmd-${next++}", deviceId = deviceId, type = type, payload = payload, status = "pending", priority = priority, createdAt = "2026-09-25T01:22:00Z"))
    }

    override suspend fun airgap(serverId: ServerId, deviceId: Long, enable: Boolean, extra: JsonObject): ApiOutcome<Unit> {
        calls += RemoteCall(serverId, if (enable) "airgap.enable" else "airgap.disable", deviceId)
        return ApiOutcome.Ok(Unit)
    }

    override suspend fun commands(serverId: ServerId, deviceId: Long): ApiOutcome<CommandPage> {
        calls += RemoteCall(serverId, "commands", deviceId)
        return ApiOutcome.Ok(CommandPage(tasks, tasks.size))
    }

    override suspend fun cancel(serverId: ServerId, commandId: String, extra: JsonObject): ApiOutcome<Unit> {
        calls += RemoteCall(serverId, "cancel:$commandId")
        return ApiOutcome.Ok(Unit)
    }

    override suspend fun services(serverId: ServerId, deviceId: Long): ApiOutcome<List<ServiceInfo>> {
        calls += RemoteCall(serverId, "services", deviceId)
        return servicesAnswer ?: ApiOutcome.Ok(services)
    }
}

/** Realtime client whose events a test pushes, recording what the screen emits. */
internal class FakeRealtime(initial: ConnectionState = ConnectionState.CONNECTED) : RealtimeClient {
    val stateFlow = MutableStateFlow(initial)
    val eventFlow = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 16)
    val emitted = mutableListOf<Pair<String, JsonElement?>>()
    override val state: StateFlow<ConnectionState> = stateFlow
    override val events: SharedFlow<RealtimeEvent> = eventFlow
    override fun connect() = Unit
    override fun reconnect() = Unit
    override fun disconnect() = Unit
    override fun emit(name: String, payload: JsonElement?): Boolean = true.also { emitted += name to payload }
    override suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long): JsonElement? = null
}

/** Services of PC-COMPTA-03 (§5 S32 example): the print spooler is stopped although automatic. */
internal val SAMPLE_SERVICES = listOf(
    ServiceInfo("Spooler", "Spouleur d'impression", "stopped", "auto", "LocalSystem"),
    ServiceInfo("wuauserv", "Windows Update", "running", "manual", "LocalSystem"),
    ServiceInfo("EBPService", "EBP Compta Service", "running", "auto", "SIEGE\\svc-ebp"),
    ServiceInfo("Dnscache", "Client DNS", "running", "auto", "NetworkService"),
    ServiceInfo("Fax", "Télécopie", "stopped", "manual", "NetworkService"),
    ServiceInfo("OblianceAgent", "Obliance Agent", "running", "auto", "LocalSystem"),
)

/** Processes of PC-COMPTA-03 at 03:22 (§4, §5 S33). */
internal val SAMPLE_PROCESSES = listOf(
    ProcessInfo(7312, "EBP.Compta.exe", 71.4, 1_420_000_000, "SIEGE\\m.durand", "\"C:\\Program Files\\EBP\\Compta\\EBP.Compta.exe\" /dossier:ACME2026"),
    ProcessInfo(4120, "MsMpEng.exe", 14.2, 380_000_000, "SYSTEM", "C:\\ProgramData\\Microsoft\\Windows Defender\\MsMpEng.exe"),
    ProcessInfo(9004, "chrome.exe", 6.1, 610_000_000, "SIEGE\\m.durand"),
    ProcessInfo(688, "lsass.exe", 0.4, 42_000_000, "SYSTEM", "C:\\Windows\\system32\\lsass.exe"),
    ProcessInfo(2210, "obliance-agent.exe", 0.8, 38_000_000, "SYSTEM"),
    ProcessInfo(5520, "explorer.exe", 0.6, 150_000_000, "SIEGE\\m.durand"),
)

/** Tasks of PC-COMPTA-03 (§5 S36 examples). */
internal val SAMPLE_TASKS = listOf(
    CommandDto(
        id = "c-3", deviceId = 187, type = "scan_inventory", status = "pending", createdByName = "Karim Benali",
        createdAt = "2026-09-25T01:20:00Z", expiresAt = "2026-09-25T01:25:00Z",
    ),
    CommandDto(
        id = "c-2", deviceId = 187, type = "restart_service", status = "success", createdByName = "Karim Benali",
        createdAt = "2026-09-25T01:17:00Z", durationMs = 1_800,
        payload = kotlinx.serialization.json.buildJsonObject { put("name", kotlinx.serialization.json.JsonPrimitive("Spooler")) },
    ),
    CommandDto(
        id = "c-1", deviceId = 187, type = "scan_updates", status = "failure", createdByName = "Karim Benali",
        createdAt = "2026-09-25T00:40:00Z", durationMs = 4_800, result = CommandResultDto(exitCode = 1, error = "Windows Update service is stopped"),
    ),
)
