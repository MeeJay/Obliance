package tools.obli.core.realtime

import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,

    /** Transport lost; the client retries with a growing delay (1 → 30 s). */
    RECONNECTING,

    /** The server refused the handshake ('Unauthorized'): the session expired (S03). */
    UNAUTHORIZED,
}

/** One server event. [payload] is the first argument, as JSON (null when absent). */
data class RealtimeEvent(val name: String, val payload: JsonElement?)

/**
 * The real-time connection to ONE server (the active one, design doc §2.10).
 * The server identifies the user from the session cookie of the handshake and
 * joins the rooms of the session's current tenant: after a tenant switch the
 * client must [reconnect] (design doc §10.6).
 */
interface RealtimeClient {
    val state: StateFlow<ConnectionState>
    val events: SharedFlow<RealtimeEvent>

    fun connect()

    /** Closes and reopens the connection (tenant switch, new cookie). */
    fun reconnect()

    fun disconnect()

    /** Fire and forget; false when not connected (nothing is queued). */
    fun emit(name: String, payload: JsonElement?): Boolean

    /** Emits and waits for the server acknowledgement; null on timeout or when not connected. */
    suspend fun emitWithAck(name: String, payload: JsonElement?, timeoutMs: Long = 10_000): JsonElement?
}
