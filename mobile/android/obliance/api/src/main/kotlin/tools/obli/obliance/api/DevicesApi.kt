package tools.obli.obliance.api

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.shell.core.str
import tools.obli.shell.core.strictLong

/**
 * Device calls of ONE server (server/src/routes/device.routes.ts). Every route
 * is bound to the session tenant (master tenant = every tenant).
 *
 * Live metrics, as the web DeviceDetailPage does it: [requestLiveMetrics] with
 * `mode=live` asks the agent to push every ~3 s for `windowSec` (5..600, the
 * server default is 60); re-arm it every 30 s while the screen is visible. The
 * samples arrive on the socket as `DEVICE_METRICS_PUSHED {deviceId, metrics}`
 * in the room of the DEVICE's tenant ([decodeMetricsPush]).
 */
class DevicesApi(private val http: ObliHttp) {
    suspend fun list(query: DeviceQuery = DeviceQuery()): ApiOutcome<DevicePage> =
        http.call(ObliHttp.Method.GET, query.toPath(), decode = ApiJson.unwrapped(DevicePage.serializer()))

    suspend fun summary(): ApiOutcome<FleetSummary> =
        http.call(ObliHttp.Method.GET, "/api/devices/summary", decode = ApiJson.unwrapped(FleetSummary.serializer()))

    suspend fun detail(deviceId: Long): ApiOutcome<Device> =
        http.call(ObliHttp.Method.GET, "/api/devices/$deviceId", decode = ApiJson.unwrapped(Device.serializer()))

    /** `mode = "live"` (push every ~3 s for [windowSec]) or `"push_now"` (one immediate push). */
    suspend fun requestLiveMetrics(deviceId: Long, live: Boolean = true, windowSec: Int = 60): ApiOutcome<LiveMetricsAck> =
        http.call(
            ObliHttp.Method.POST,
            "/api/devices/$deviceId/live-metrics",
            if (live) ApiJson.body("mode" to "live", "windowSec" to windowSec.coerceIn(5, 600)) else ApiJson.body("mode" to "push_now"),
            decode = ApiJson.unwrapped(LiveMetricsAck.serializer()),
        )

    companion object {
        fun decodeMetricsPush(payload: JsonElement?): MetricsPush? {
            val obj = payload as? JsonObject ?: return null
            val id = obj.strictLong("deviceId") ?: return null
            val raw = obj["metrics"]
            // Legacy callers stringify the metrics blob (DeviceDetailPage parses both).
            val element = if (raw is JsonPrimitive && raw.isString) {
                runCatching { ApiJson.json.parseToJsonElement(raw.content) }.getOrNull()
            } else {
                raw
            }
            val metrics = ApiJson.decode(DeviceMetrics.serializer(), element) ?: return null
            return MetricsPush(id, metrics)
        }

        /**
         * `DEVICE_UPDATED` carries either `{deviceId, status}` or a whole Device
         * (`id`); `DEVICE_DELETED` carries `{id}` (device.service.ts).
         */
        fun decodeDeviceSignal(event: String, payload: JsonElement?): DeviceSignal? {
            val obj = payload as? JsonObject ?: return null
            val id = obj.strictLong("deviceId") ?: obj.strictLong("id") ?: return null
            return DeviceSignal(event, id, obj.str("status")?.let(DeviceStatus::parse))
        }
    }
}
