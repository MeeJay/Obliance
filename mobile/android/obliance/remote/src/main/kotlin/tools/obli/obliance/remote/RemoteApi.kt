package tools.obli.obliance.remote

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import tools.obli.core.auth.ServerSession
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.ApiJson

/**
 * `POST /api/remote/sessions` → `data` (remote.service.ts `rowToSession`,
 * shared `RemoteSession`). [sessionToken] is only sent to the user who
 * started the session: it is the relay key and is never logged ([toString]).
 */
@Serializable
internal data class StartedSession(
    val id: String = "",
    val deviceId: Long = 0,
    val tenantId: Long? = null,
    val protocol: String = "",
    val status: String = "",
    val sessionToken: String? = null,
    val startedBy: Long? = null,
) {
    override fun toString(): String = "StartedSession(id=$id, deviceId=$deviceId, protocol=$protocol, status=$status)"
}

/** One user session of `list_wts_sessions` (agent/wts_windows.go `WtsSession`). */
@Serializable
internal data class WtsSession(
    val id: Int = 0,
    val name: String = "",
    val username: String = "",
    val domain: String = "",
    /** `active`, `connected`, `disconnected` or `other`. */
    val state: String = "",
)

@Serializable
internal data class WtsResult(val sessions: List<WtsSession> = emptyList())

/** `POST /api/commands` → `data` / `COMMAND_UPDATED` payload (command.service.ts `rowToCommand`). */
@Serializable
internal data class CommandRow(
    val id: String = "",
    val deviceId: Long = 0,
    val type: String = "",
    val status: String = "",
    val result: JsonElement? = null,
)

@Serializable
internal data class CommandPage(val items: List<CommandRow> = emptyList(), val total: Int = 0)

/**
 * The remote-access calls of the web client (`client/src/api/remote.api.ts`,
 * `commandApi.enqueue`), always over the session of the device's OWN server.
 * Mutating calls take the `extra` fields of the action runner (step-up code).
 */
internal object RemoteApi {
    const val SESSIONS = "/api/remote/sessions"

    /** Body of `startSession(deviceId, protocol, notes?, sessionId?)`: `sessionId` only when a WTS session was chosen. */
    fun startBody(deviceId: Long, protocol: String, wtsSessionId: Int?, extra: JsonObject = JsonObject(emptyMap())): JsonObject = buildJsonObject {
        put("deviceId", JsonPrimitive(deviceId))
        put("protocol", JsonPrimitive(protocol))
        if (wtsSessionId != null) put("sessionId", JsonPrimitive(wtsSessionId))
        extra.forEach { (k, v) -> put(k, v) }
    }

    suspend fun start(session: ServerSession, deviceId: Long, protocol: String, wtsSessionId: Int?, extra: JsonObject): ApiOutcome<StartedSession> =
        session.http.call(ObliHttp.Method.POST, SESSIONS, startBody(deviceId, protocol, wtsSessionId, extra), decode = decoder(StartedSession.serializer()))
            .also { if (it == ApiOutcome.SessionExpired) session.markExpired() }

    /** `POST /api/remote/sessions/:id/end` (204). */
    suspend fun end(session: ServerSession, sessionId: String): ApiOutcome<Unit> {
        if (!UUID.matches(sessionId)) return ApiOutcome.Failure(404, FailureKind.NOT_FOUND)
        return when (val out = session.http.post("$SESSIONS/$sessionId/end")) {
            is ApiOutcome.Ok, is ApiOutcome.Accepted -> ApiOutcome.Ok(Unit)
            ApiOutcome.SessionExpired -> ApiOutcome.SessionExpired.also { session.markExpired() }
            else -> @Suppress("UNCHECKED_CAST") (out as ApiOutcome<Unit>)
        }
    }

    /** The web's `commandApi.enqueue(deviceId, 'list_wts_sessions', {}, 'high')`. */
    fun listWtsBody(deviceId: Long, extra: JsonObject = JsonObject(emptyMap())): JsonObject = buildJsonObject {
        put("deviceId", JsonPrimitive(deviceId))
        put("type", JsonPrimitive("list_wts_sessions"))
        put("payload", JsonObject(emptyMap()))
        put("priority", JsonPrimitive("high"))
        extra.forEach { (k, v) -> put(k, v) }
    }

    suspend fun enqueueListWts(session: ServerSession, deviceId: Long, extra: JsonObject): ApiOutcome<CommandRow> =
        session.http.call(ObliHttp.Method.POST, "/api/commands", listWtsBody(deviceId, extra), decode = decoder(CommandRow.serializer()))
            .also { if (it == ApiOutcome.SessionExpired) session.markExpired() }

    /** `GET /api/commands?deviceId=…&limit=…`: fallback when the socket misses `COMMAND_UPDATED`. */
    suspend fun recentCommands(session: ServerSession, deviceId: Long): ApiOutcome<CommandPage> =
        session.http.call(ObliHttp.Method.GET, "/api/commands?deviceId=$deviceId&limit=20", decode = decoder(CommandPage.serializer()))
            .also { if (it == ApiOutcome.SessionExpired) session.markExpired() }

    /** Sessions of a finished `list_wts_sessions`, or null while it runs. */
    fun wtsSessionsOf(row: CommandRow): List<WtsSession>? {
        if (row.status != "success") return null
        val result = row.result ?: return emptyList()
        return try {
            ApiJson.json.decodeFromJsonElement(WtsResult.serializer(), result).sessions
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun isFinished(row: CommandRow): Boolean = row.status in FINISHED

    private val FINISHED = setOf("success", "failure", "timeout", "cancelled", "expired", "failed")
    private val UUID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

    private fun <T> decoder(serializer: KSerializer<T>): (JsonElement?) -> T? = ApiJson.unwrapped(serializer)
}
