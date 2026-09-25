package tools.obli.obliance.devices

import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ApiResponses
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.DevicesApi
import tools.obli.obliance.api.LiveMetricsAck

/**
 * Calls that `:obliance:api` does not offer (CONTRACT §7), always made over
 * the session of the device's OWN server: never another origin.
 */
internal interface DeviceRemote {
    /** `GET /api/groups`: names from the root group down to [groupId] ("Siège", "Comptabilité"). */
    suspend fun groupPath(serverId: ServerId, groupId: Long): List<String>?

    /** `GET /api/groups/:id/thresholds-resolved`: global, tenant and group layers of the cascade. */
    suspend fun groupThresholds(serverId: ServerId, groupId: Long): Thresholds?

    /** `POST /api/devices/:id/live-metrics {mode:'push_now'}`: one immediate push (pull to refresh, §7.3). */
    suspend fun pushNow(serverId: ServerId, deviceId: Long): ApiOutcome<LiveMetricsAck>
}

/** Screenshot tests provide a network-free [DeviceRemote]; the app uses [HttpDeviceRemote]. */
internal val LocalDeviceRemote = staticCompositionLocalOf<DeviceRemote?> { null }

internal class HttpDeviceRemote(private val sessions: ServerSessions) : DeviceRemote {

    private suspend fun <T> ServerSession.getData(path: String, decode: (JsonElement?) -> T?): T? {
        val out = http.call(ObliHttp.Method.GET, path) { decode(ApiResponses.unwrap(it)) }
        if (out == ApiOutcome.SessionExpired) markExpired()
        return (out as? ApiOutcome.Ok)?.value
    }

    override suspend fun groupPath(serverId: ServerId, groupId: Long): List<String>? {
        val s = sessions.session(serverId) ?: return null
        val groups = s.getData("/api/groups") { it as? JsonArray } ?: return null
        return RemoteParsing.groupPath(groups, groupId)
    }

    override suspend fun groupThresholds(serverId: ServerId, groupId: Long): Thresholds? {
        val s = sessions.session(serverId) ?: return null
        return s.getData("/api/groups/$groupId/thresholds-resolved") { it as? JsonObject }?.let(RemoteParsing::thresholds)
    }

    override suspend fun pushNow(serverId: ServerId, deviceId: Long): ApiOutcome<LiveMetricsAck> {
        val s = sessions.session(serverId) ?: return ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server")
        return DevicesApi(s.http).requestLiveMetrics(deviceId, live = false)
            .also { if (it == ApiOutcome.SessionExpired) s.markExpired() }
    }
}

/** Tolerant parsers of the private calls above (shapes copied from the server code). */
internal object RemoteParsing {
    private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { it.longOrNull ?: it.content.toLongOrNull() }

    private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content

    /**
     * `DeviceGroup[]` (shared/src/types.ts: `id`, `parentId`, `name`) → names
     * from the root down to [groupId]; null when the group is unknown.
     */
    fun groupPath(groups: JsonArray, groupId: Long): List<String>? {
        val byId = groups.mapNotNull { it as? JsonObject }.mapNotNull { g ->
            val id = g.long("id") ?: return@mapNotNull null
            id to (g.long("parentId") to g.string("name").orEmpty())
        }.toMap()
        if (groupId !in byId) return null
        val names = ArrayDeque<String>()
        var cursor: Long? = groupId
        val seen = HashSet<Long>()
        while (cursor != null && seen.add(cursor) && seen.size <= MAX_DEPTH) {
            val (parent, name) = byId[cursor] ?: break
            if (name.isNotBlank()) names.addFirst(name)
            cursor = parent
        }
        return names.toList().takeIf { it.isNotEmpty() }
    }

    /** threshold.service.ts `ResolvedThresholds` → [Thresholds]; missing slots keep the system default. */
    fun thresholds(obj: JsonObject): Thresholds {
        fun slot(o: JsonObject?, fallback: Threshold): Threshold =
            if (o == null) fallback else Threshold(o.double("warn") ?: fallback.warn, o.double("crit") ?: fallback.crit)
        val sys = Thresholds.SYSTEM
        val disk = slot(obj["disk"] as? JsonObject, sys.disk)
        val byMount = (obj["diskByMount"] as? JsonObject)?.mapNotNull { (mount, v) ->
            (v as? JsonObject)?.let { mount to slot(it, disk) }
        }?.toMap().orEmpty()
        return Thresholds(
            cpu = slot(obj["cpu"] as? JsonObject, sys.cpu),
            ram = slot(obj["ram"] as? JsonObject, sys.ram),
            disk = disk,
            diskByMount = byMount,
        )
    }

    private const val MAX_DEPTH = 32
}
