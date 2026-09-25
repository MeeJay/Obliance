package tools.obli.obliance.devices

import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flowOf
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.api.CpuMetrics
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DiskMetrics
import tools.obli.obliance.api.MemoryMetrics
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.DeviceSort
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.api.LiveMetricsAck
import tools.obli.obliance.api.NetworkMetrics
import tools.obli.obliance.data.DevicesRepository
import tools.obli.obliance.data.LiveSample
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** 03:22 in Paris on the night of 25 September (design doc §4): SRV-AD2 is offline since 03:08. */
internal val NIGHT_NOW: Long = Instant.parse("2026-09-25T01:22:00Z").toEpochMilli()
internal val PARIS: ZoneId = ZoneId.of("Europe/Paris")

internal class MutableClock(var now: Long = NIGHT_NOW) {
    val clock = DevicesClock(now = { now }, zone = PARIS, ticking = false)
}

internal val NETWORK_DOWN: ApiOutcome<Nothing> = ApiOutcome.Failure(null, FailureKind.NETWORK)

/**
 * Devices repository over the §4 sample data that records every call (with
 * the server it targeted) and lets a test replace answers.
 */
internal class RecordingDevices(private val base: DevicesRepository) : DevicesRepository {
    val pages = mutableListOf<Pair<DeviceQuery, ServerId?>>()
    val summaries = mutableListOf<ServerId?>()
    val details = mutableListOf<Pair<ServerId, Long>>()
    val liveRequests = mutableListOf<Pair<ServerId, Long>>()

    var pageAnswer: (suspend (DeviceQuery, ServerId?) -> ApiOutcome<DevicePage>)? = null
    var summaryAnswer: (suspend (ServerId?) -> ApiOutcome<FleetSummary>)? = null
    var detailAnswer: (suspend (ServerId, Long) -> ApiOutcome<Device>)? = null
    var liveAnswer: ((ServerId, Long) -> Flow<LiveSample>)? = null

    /** Rows and details go through this before being returned (realistic server fields). */
    var enrich: (Device) -> Device = { it }

    val signalFlow = MutableSharedFlow<DeviceSignal>(extraBufferCapacity = 16)

    override suspend fun page(query: DeviceQuery, serverId: ServerId?): ApiOutcome<DevicePage> {
        pages += query to serverId
        val out = pageAnswer?.invoke(query, serverId) ?: base.page(query, serverId)
        return if (out is ApiOutcome.Ok) ApiOutcome.Ok(out.value.copy(items = sortLikeServer(out.value.items.map(enrich), query.sortBy))) else out
    }

    override suspend fun summary(serverId: ServerId?): ApiOutcome<FleetSummary> {
        summaries += serverId
        return summaryAnswer?.invoke(serverId) ?: base.summary(serverId)
    }

    override suspend fun detail(serverId: ServerId, deviceId: Long): ApiOutcome<Device> {
        details += serverId to deviceId
        val out = detailAnswer?.invoke(serverId, deviceId) ?: base.detail(serverId, deviceId)
        return if (out is ApiOutcome.Ok) ApiOutcome.Ok(enrich(out.value)) else out
    }

    override fun liveMetrics(serverId: ServerId, deviceId: Long): Flow<LiveSample> {
        liveRequests += serverId to deviceId
        return liveAnswer?.invoke(serverId, deviceId) ?: base.liveMetrics(serverId, deviceId)
    }

    override fun signals(): Flow<DeviceSignal> = signalFlow
}

/** Order of device.service.ts: status = critical, warning, updating, others, offline, online, then name. */
internal fun sortLikeServer(items: List<Device>, sort: DeviceSort?): List<Device> = when (sort) {
    DeviceSort.STATUS -> items.sortedWith(compareBy<Device>({ statusRank(it.statusKind) }, { it.label.lowercase() }))
    DeviceSort.NAME -> items.sortedBy { it.label.lowercase() }
    else -> items
}

private fun statusRank(s: DeviceStatus): Int = when (s) {
    DeviceStatus.CRITICAL -> 0
    DeviceStatus.WARNING -> 1
    DeviceStatus.UPDATING -> 2
    DeviceStatus.OFFLINE -> 4
    DeviceStatus.ONLINE -> 5
    else -> 3
}

/** The §4 sample services with a recording devices repository. */
internal class TestServices(
    val base: SampleObliServices = SampleObliServices(),
) : ObliServices by base {
    val recording = RecordingDevices(base.devices)
    override val devices: DevicesRepository get() = recording
}

/** Network-free [DeviceRemote] recording the server of every call. */
internal class FakeRemote(
    private val paths: Map<Long, List<String>> = mapOf(GROUP_COMPTA to listOf("Siège", "Comptabilité"), GROUP_LINUX to listOf("Infra", "Linux")),
    private val thresholds: Map<Long, Thresholds> = emptyMap(),
    var pushAnswer: ApiOutcome<LiveMetricsAck> = ApiOutcome.Ok(LiveMetricsAck(sent = true, mode = "push_now")),
) : DeviceRemote {
    val calls = mutableListOf<Pair<String, ServerId>>()

    override suspend fun groupPath(serverId: ServerId, groupId: Long): List<String>? {
        calls += "groups" to serverId
        return paths[groupId]
    }

    override suspend fun groupThresholds(serverId: ServerId, groupId: Long): Thresholds? {
        calls += "thresholds" to serverId
        return thresholds[groupId]
    }

    override suspend fun pushNow(serverId: ServerId, deviceId: Long): ApiOutcome<LiveMetricsAck> {
        calls += "push_now" to serverId
        return pushAnswer
    }
}

internal const val GROUP_COMPTA = 12L
internal const val GROUP_LINUX = 31L

/**
 * Fields a real Obliance Prod would send for the §4 devices and that the
 * shared sample leaves out: group ids, the S31 example hardware of
 * PC-COMPTA-03, the outdated agent of BOB01 (4.5.61 < 4.5.79).
 */
internal fun realistic(d: Device): Device = when (d.hostname) {
    "PC-COMPTA-03" -> d.copy(groupId = GROUP_COMPTA, ramTotalGb = 16.0, cpuModel = "Intel Core i5-12500", ipPublic = null)
    "PC-COMPTA-01", "PC-COMPTA-02" -> d.copy(groupId = GROUP_COMPTA)
    "BOB01" -> d.copy(groupId = GROUP_LINUX, updateAvailable = true)
    "140" -> d.copy(groupId = GROUP_LINUX)
    // Last values pushed before the outage (STYLEKIT `metric-band-offline`).
    "SRV-AD2" -> d.copy(
        latestMetrics = DeviceMetrics(
            cpu = CpuMetrics(percent = 3.0),
            memory = MemoryMetrics(percent = 41.0),
            disks = listOf(DiskMetrics(mount = "C:", percent = 58.0)),
            updatedAt = "2026-09-25T01:08:00Z",
        ),
    )
    else -> d
}

/** The live sample of PC-COMPTA-03 at 03:22 (S30 header: CPU 97 %, S31 network example). */
internal fun comptaLiveSample(now: Long): LiveSample {
    val base = SampleData.devices.first { it.id == 187L }.latestMetrics!!
    return LiveSample(
        base.copy(cpu = CpuMetrics(percent = 97.0), network = NetworkMetrics(inBytesPerSec = 2.4 * 1024 * 1024, outBytesPerSec = 310.0 * 1024)),
        live = true,
        receivedAt = now,
    )
}

internal fun liveOf(sample: LiveSample): Flow<LiveSample> = flowOf(sample)
