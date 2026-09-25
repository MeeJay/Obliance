package tools.obli.obliance.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.LiveSample
import tools.obli.obliance.data.ObliServices

/** Where the metrics on screen come from (freshness stamp, §7.3 and §2.3 rule 3). */
internal enum class MetricsFeed {
    /** Only the snapshot of `GET /api/devices/:id` so far: "Mis à jour à HH:MM". */
    SNAPSHOT,

    /** Samples pushed on the socket (`DEVICE_METRICS_PUSHED`): "En direct". */
    LIVE,

    /** No push for 15 s: REST every 15 s, "Actualisation toutes les 15 s". */
    POLLING,
}

internal data class DeviceDetailState(
    val device: Device? = null,
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val problem: LoadProblem? = null,
    /** Latest live sample (null until the first one). */
    val sample: LiveSample? = null,
    /** Group names from the root ("Siège", "Comptabilité"); null while unknown. */
    val groupPath: List<String>? = null,
    val thresholds: Thresholds = Thresholds.SYSTEM,
    /** Pull to refresh sent `push_now`: "Mesures demandées…" until the next push. */
    val pushRequested: Boolean = false,
    /** Epoch ms of the last successful `GET /api/devices/:id`. */
    val loadedAt: Long? = null,
    /** Last contact, advanced by every pushed sample (like the web's useSocket). */
    val lastSeenAt: Long? = null,
) {
    val metrics: DeviceMetrics? get() = sample?.metrics?.takeIf { !it.isEmpty } ?: device?.latestMetrics?.takeIf { !it.isEmpty }

    val feed: MetricsFeed
        get() = when {
            sample == null -> MetricsFeed.SNAPSHOT
            sample.live -> MetricsFeed.LIVE
            else -> MetricsFeed.POLLING
        }

    /** Epoch ms the metrics on screen describe. */
    fun metricsAt(): Long? = sample?.receivedAt?.takeIf { sample.live } ?: DeviceFormat.parse(metrics?.updatedAt) ?: loadedAt
}

/**
 * S30/S31 (read-only alpha): one device of [serverId]. Every call goes
 * through THAT server's session (the app made it the active server before
 * opening, CONTRACT §2), never another one.
 */
internal class DeviceDetailViewModel(
    private val services: ObliServices,
    private val remote: DeviceRemote,
    private val clock: DevicesClock,
    val serverId: ServerId,
    val deviceId: Long,
) : ViewModel() {

    private val _state = MutableStateFlow(DeviceDetailState())
    val state: StateFlow<DeviceDetailState> = _state.asStateFlow()

    private var loadJob: Job? = null
    private var lookedUpGroup: Long? = null

    init {
        load()
    }

    private fun load(refresh: Boolean = false) {
        loadJob?.cancel()
        _state.update { it.copy(loading = it.device == null, refreshing = refresh && it.device != null) }
        loadJob = viewModelScope.launch {
            val out = services.devices.detail(serverId, deviceId)
            val device = (out as? ApiOutcome.Ok)?.value
            _state.update { s ->
                if (device == null) {
                    s.copy(loading = false, refreshing = false, problem = out.toProblem("/api/devices/$deviceId"))
                } else {
                    s.copy(
                        device = device,
                        loading = false,
                        refreshing = false,
                        problem = null,
                        loadedAt = clock.now(),
                        lastSeenAt = maxOfNullable(s.lastSeenAt, DeviceFormat.parse(device.lastSeenAt)),
                    )
                }
            }
            val groupId = device?.groupId ?: return@launch
            if (groupId == lookedUpGroup) return@launch
            lookedUpGroup = groupId
            coroutineScope {
                val path = async { remote.groupPath(serverId, groupId) }
                val thresholds = async { remote.groupThresholds(serverId, groupId) }
                val p = path.await()
                val t = thresholds.await()
                _state.update { it.copy(groupPath = p ?: it.groupPath, thresholds = t ?: it.thresholds) }
            }
        }
    }

    /** Pull to refresh (§7.3): reload, and ask the agent for one immediate push. */
    fun refresh() {
        load(refresh = true)
        viewModelScope.launch {
            val ack = remote.pushNow(serverId, deviceId)
            if (ack is ApiOutcome.Ok && ack.value.sent) _state.update { it.copy(pushRequested = true) }
        }
    }

    fun retry() = load()

    /**
     * Runs while the screen is visible (the UI calls it under
     * `repeatOnLifecycle(STARTED)`): live metrics as the web DeviceDetailPage
     * does (live mode armed every 30 s, `DEVICE_METRICS_PUSHED` of this device,
     * REST fallback) and status changes of this device. Leaving the screen or
     * going to background cancels it, which stops arming the agent.
     */
    suspend fun followLive() {
        coroutineScope {
            launch {
                services.devices.signals().collect { signal ->
                    // signals() is the ACTIVE server's socket: ignore it when this device lives elsewhere.
                    if (services.registry.state.value.activeId == serverId) onSignal(signal)
                }
            }
            launch {
                services.devices.liveMetrics(serverId, deviceId).collect(::onSample)
            }
        }
    }

    internal fun onSample(sample: LiveSample) {
        _state.update { s ->
            s.copy(
                sample = sample,
                pushRequested = if (sample.live) false else s.pushRequested,
                lastSeenAt = if (sample.live) maxOfNullable(s.lastSeenAt, sample.receivedAt) else s.lastSeenAt,
            )
        }
    }

    internal fun onSignal(signal: DeviceSignal) {
        if (signal.deviceId != deviceId) return
        when (signal.event) {
            ObliEvents.DEVICE_DELETED -> _state.update { it.copy(problem = LoadProblem(ProblemKind.NOT_FOUND, 404)) }
            ObliEvents.DEVICE_UPDATED, ObliEvents.DEVICE_ONLINE, ObliEvents.DEVICE_OFFLINE, ObliEvents.DEVICE_APPROVED -> {
                val status = signal.status ?: when (signal.event) {
                    ObliEvents.DEVICE_ONLINE -> DeviceStatus.ONLINE
                    ObliEvents.DEVICE_OFFLINE -> DeviceStatus.OFFLINE
                    else -> null
                }
                if (status != null && status != DeviceStatus.UNKNOWN) {
                    _state.update { s -> s.copy(device = s.device?.copy(status = status.wire)) }
                }
                if (signal.event == ObliEvents.DEVICE_APPROVED) load(refresh = true)
            }
            else -> Unit
        }
    }

    private fun maxOfNullable(a: Long?, b: Long?): Long? = when {
        a == null -> b
        b == null -> a
        else -> maxOf(a, b)
    }
}
