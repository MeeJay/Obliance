package tools.obli.obliance.data

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import tools.obli.core.auth.ServerSession
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.DevicesApi
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.api.ObliEvents

@OptIn(ExperimentalCoroutinesApi::class)
internal class DefaultDevicesRepository(
    private val sessions: ServerSessions,
    private val clock: () -> Long = System::currentTimeMillis,
    private val armEveryMs: Long = ARM_EVERY_MS,
    private val fallbackMs: Long = FALLBACK_MS,
) : DevicesRepository {

    private fun target(serverId: ServerId?): ServerSession? =
        if (serverId == null) sessions.active.value else sessions.session(serverId)

    override suspend fun page(query: DeviceQuery, serverId: ServerId?): ApiOutcome<DevicePage> {
        val s = target(serverId) ?: return noServer
        return DevicesApi(s.http).list(query).watchedBy(s)
    }

    override suspend fun summary(serverId: ServerId?): ApiOutcome<FleetSummary> {
        val s = target(serverId) ?: return noServer
        return DevicesApi(s.http).summary().watchedBy(s)
    }

    override suspend fun detail(serverId: ServerId, deviceId: Long): ApiOutcome<Device> {
        val s = sessions.session(serverId) ?: return noServer
        return DevicesApi(s.http).detail(deviceId).watchedBy(s)
    }

    override fun liveMetrics(serverId: ServerId, deviceId: Long): Flow<LiveSample> = channelFlow {
        val s = sessions.session(serverId) ?: return@channelFlow
        val api = DevicesApi(s.http)
        val lastAt = AtomicLong(0L)

        // 1. Keep the agent in live mode (the server window is 60 s; re-armed every 30 s).
        launch {
            while (true) {
                api.requestLiveMetrics(deviceId, live = true, windowSec = 60).watchedBy(s)
                delay(armEveryMs)
            }
        }
        // 2. REST fallback when nothing is pushed (offline agent, child tenant seen from Default).
        launch {
            while (true) {
                delay(fallbackMs)
                if (clock() - lastAt.get() >= fallbackMs) {
                    val metrics = (api.detail(deviceId).watchedBy(s) as? ApiOutcome.Ok)?.value?.latestMetrics
                    if (metrics != null && !metrics.isEmpty && clock() - lastAt.get() >= fallbackMs) {
                        send(LiveSample(metrics, live = false, receivedAt = clock()))
                    }
                }
            }
        }
        // 3. Pushed samples of this device on this server's socket.
        s.realtime.events.collect { event ->
            if (event.name != ObliEvents.DEVICE_METRICS_PUSHED) return@collect
            val push = DevicesApi.decodeMetricsPush(event.payload) ?: return@collect
            if (push.deviceId != deviceId) return@collect
            val now = clock()
            lastAt.set(now)
            send(LiveSample(push.metrics, live = true, receivedAt = now))
        }
    }

    override fun signals(): Flow<DeviceSignal> = sessions.active.flatMapLatest { s ->
        s?.realtime?.events?.mapNotNull { e ->
            when (e.name) {
                ObliEvents.DEVICE_UPDATED, ObliEvents.DEVICE_ONLINE, ObliEvents.DEVICE_OFFLINE,
                ObliEvents.DEVICE_DELETED, ObliEvents.DEVICE_APPROVED, ObliEvents.MAINTENANCE_CHANGED,
                -> DevicesApi.decodeDeviceSignal(e.name, e.payload)
                else -> null
            }
        } ?: emptyFlow()
    }

    companion object {
        const val ARM_EVERY_MS = 30_000L
        const val FALLBACK_MS = 15_000L
    }
}
