package tools.obli.obliance.devices

import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ApiResponses
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.ApiJson

// ---------------------------------------------------------------------------
// Server shapes (shared/src/types.ts), every field defaulted (tolerant decoding)
// ---------------------------------------------------------------------------

/** shared `CommandResult`. */
@Serializable
internal data class CommandResultDto(
    val exitCode: Int? = null,
    val stdout: String? = null,
    val stderr: String? = null,
    val error: String? = null,
    val duration: Long? = null,
)

/** shared `Command` (command.service.ts rowToCommand), as REST and `COMMAND_UPDATED` send it. */
@Serializable
internal data class CommandDto(
    val id: String = "",
    val deviceId: Long = 0,
    val type: String = "",
    val payload: JsonObject? = null,
    val status: String = "",
    val priority: String? = null,
    val sentAt: String? = null,
    val ackedAt: String? = null,
    val finishedAt: String? = null,
    val expiresAt: String? = null,
    val result: CommandResultDto? = null,
    val sourceType: String? = null,
    val createdBy: Long? = null,
    val createdByName: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val durationMs: Long? = null,
) {
    val state: CommandState get() = CommandState.parse(status)

    /** `payload.name` (services) / `payload.pid` (kill_process). */
    val payloadName: String? get() = (payload?.get("name") as? JsonPrimitive)?.takeIf { it.isString }?.content
    val payloadPid: Long? get() = (payload?.get("pid") as? JsonPrimitive)?.let { it.longOrNull ?: it.content.toLongOrNull() }
}

/** shared `CommandStatus`; [UNKNOWN] for a newer server value. */
internal enum class CommandState(val wire: String) {
    PENDING("pending"), SENT("sent"), RUNNING("ack_running"), SUCCESS("success"), FAILURE("failure"),
    TIMEOUT("timeout"), CANCELLED("cancelled"), UNKNOWN(""),
    ;

    /** The web's `['success','failure','timeout']` plus cancelled. */
    val terminal: Boolean get() = this == SUCCESS || this == FAILURE || this == TIMEOUT || this == CANCELLED

    companion object {
        fun parse(raw: String?): CommandState = entries.firstOrNull { it.wire == raw && it != UNKNOWN } ?: UNKNOWN
    }
}

/** shared `ServiceInfo` (`GET /api/devices/:id/services`, `DEVICE_SERVICES_UPDATED`). */
@Serializable
internal data class ServiceInfo(
    val name: String = "",
    val displayName: String? = null,
    val status: String = "",
    val startType: String? = null,
    val runAsUser: String? = null,
) {
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: name
    val running: Boolean get() = status.equals("running", ignoreCase = true)
    val stopped: Boolean get() = status.equals("stopped", ignoreCase = true)
    val automatic: Boolean get() = startType?.lowercase()?.startsWith("auto") == true
}

/** shared `ProcessInfo` (payload of `DEVICE_PROCESSES_UPDATED`). */
@Serializable
internal data class ProcessInfo(
    val pid: Long = 0,
    val name: String = "",
    val cpuPercent: Double = 0.0,
    val memBytes: Long = 0,
    val user: String = "",
    val command: String? = null,
)

/** `GET /api/commands` → `data`. */
internal data class CommandPage(val items: List<CommandDto>, val total: Int)

/** Tolerant list decoding: a malformed row is dropped, not the whole list. */
internal fun <T> decodeList(serializer: KSerializer<T>, element: JsonElement?): List<T>? =
    (element as? JsonArray)?.mapNotNull { ApiJson.decode(serializer, it) }

// ---------------------------------------------------------------------------
// Calls over ONE server's http (CONTRACT §7), exactly as the web client sends them
// ---------------------------------------------------------------------------

/**
 * The command routes of client/src/api/command.api.ts and the device routes
 * of device.routes.ts, over the http of the device's OWN server.
 */
internal class CommandCalls(private val http: ObliHttp) {

    /**
     * `POST /api/commands {deviceId, type, payload, priority}` (commandApi.enqueue)
     * plus the step-up fields of [extra] (`twoFactorCode`, `trustIp`). The
     * answer is `{data: Command}`; 202 = pending approval (ApiOutcome).
     */
    suspend fun enqueue(deviceId: Long, type: String, payload: JsonObject, priority: String, extra: JsonObject): ApiOutcome<CommandDto> =
        http.call(ObliHttp.Method.POST, "/api/commands", commandBody(deviceId, type, payload, priority, extra)) { body ->
            ApiJson.decode(CommandDto.serializer(), ApiResponses.unwrap(body)) ?: CommandDto(deviceId = deviceId, type = type, status = CommandState.PENDING.wire)
        }

    /** `POST /api/devices/:id/airgap/enable|disable` (deviceApi.enableAirgap / disableAirgap): `{data:{success:true}}`. */
    suspend fun airgap(deviceId: Long, enable: Boolean, extra: JsonObject): ApiOutcome<Unit> =
        http.call(ObliHttp.Method.POST, "/api/devices/$deviceId/airgap/${if (enable) "enable" else "disable"}", JsonObject(extra)) { Unit }

    /** `GET /api/commands?deviceId=&limit=` (commandApi.list): newest first. */
    suspend fun list(deviceId: Long, limit: Int = TASKS_LIMIT): ApiOutcome<CommandPage> =
        http.call(ObliHttp.Method.GET, "/api/commands?deviceId=$deviceId&page=1&limit=$limit") { body ->
            val data = ApiResponses.unwrap(body) as? JsonObject ?: return@call null
            val items = decodeList(CommandDto.serializer(), data["items"]) ?: return@call null
            val total = (data["total"] as? JsonPrimitive)?.let { it.longOrNull ?: it.content.toLongOrNull() }?.toInt() ?: items.size
            CommandPage(items, total)
        }

    /** `DELETE /api/commands/:id` (commandApi.cancel): 204; only `pending` rows are cancelled server-side. */
    suspend fun cancel(commandId: String, extra: JsonObject): ApiOutcome<Unit> =
        http.call(ObliHttp.Method.DELETE, "/api/commands/$commandId", extra.takeIf { it.isNotEmpty() }) { Unit }

    /** `GET /api/devices/:id/services`: the list the agent last reported (`latest_services`). */
    suspend fun services(deviceId: Long): ApiOutcome<List<ServiceInfo>> =
        http.call(ObliHttp.Method.GET, "/api/devices/$deviceId/services") { body ->
            val data = ApiResponses.unwrap(body)
            if (data == null || data is kotlinx.serialization.json.JsonNull) emptyList() else decodeList(ServiceInfo.serializer(), data)
        }

    companion object {
        const val TASKS_LIMIT = 50

        fun commandBody(deviceId: Long, type: String, payload: JsonObject, priority: String, extra: JsonObject): JsonObject = buildJsonObject {
            put("deviceId", JsonPrimitive(deviceId))
            put("type", JsonPrimitive(type))
            put("payload", payload)
            put("priority", JsonPrimitive(priority))
            extra.forEach { (k, v) -> put(k, v) }
        }
    }
}

/** What the device screen needs from the server, per [ServerId] (never another origin). */
internal interface CommandRemote {
    suspend fun enqueue(
        serverId: ServerId,
        deviceId: Long,
        type: String,
        payload: JsonObject = JsonObject(emptyMap()),
        priority: String = "normal",
        extra: JsonObject = JsonObject(emptyMap()),
    ): ApiOutcome<CommandDto>

    suspend fun airgap(serverId: ServerId, deviceId: Long, enable: Boolean, extra: JsonObject = JsonObject(emptyMap())): ApiOutcome<Unit>

    suspend fun commands(serverId: ServerId, deviceId: Long): ApiOutcome<CommandPage>

    suspend fun cancel(serverId: ServerId, commandId: String, extra: JsonObject = JsonObject(emptyMap())): ApiOutcome<Unit>

    suspend fun services(serverId: ServerId, deviceId: Long): ApiOutcome<List<ServiceInfo>>
}

/** Screenshot and ViewModel tests provide a fake; the app uses [HttpCommandRemote]. */
internal val LocalCommandRemote = staticCompositionLocalOf<CommandRemote?> { null }

internal val NO_SERVER: ApiOutcome<Nothing> = ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server")

internal class HttpCommandRemote(private val sessions: ServerSessions) : CommandRemote {

    private suspend fun <T> on(serverId: ServerId, block: suspend CommandCalls.() -> ApiOutcome<T>): ApiOutcome<T> {
        val s: ServerSession = sessions.session(serverId) ?: return NO_SERVER
        return CommandCalls(s.http).block().also { if (it == ApiOutcome.SessionExpired) s.markExpired() }
    }

    override suspend fun enqueue(serverId: ServerId, deviceId: Long, type: String, payload: JsonObject, priority: String, extra: JsonObject) =
        on(serverId) { enqueue(deviceId, type, payload, priority, extra) }

    override suspend fun airgap(serverId: ServerId, deviceId: Long, enable: Boolean, extra: JsonObject) =
        on(serverId) { airgap(deviceId, enable, extra) }

    override suspend fun commands(serverId: ServerId, deviceId: Long) = on(serverId) { list(deviceId) }

    override suspend fun cancel(serverId: ServerId, commandId: String, extra: JsonObject) = on(serverId) { cancel(commandId, extra) }

    override suspend fun services(serverId: ServerId, deviceId: Long) = on(serverId) { services(deviceId) }
}
