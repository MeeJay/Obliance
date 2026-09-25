package tools.obli.obliance.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DeviceSignal
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.DevicesApi
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.api.ObliEvents
import tools.obli.obliance.data.ObliServices

/** What the list depends on: reloaded when any of it changes (CONTRACT §6 devices). */
internal data class ListContext(
    val serverId: ServerId?,
    val tenantId: Long?,
    val auth: AuthKind,
    val admin: Boolean,
    val globalView: Boolean,
    /** Global-view filter of the active server (TenantScope.listTenantIds): a change reloads. */
    val viewTenantIds: List<Long> = emptyList(),
    /** Names of the filtered tenants (the "Filtre : ACME" row). */
    val filterNames: List<String> = emptyList(),
)

internal enum class AuthKind { UNKNOWN, SIGNED_IN, LOST, UNREACHABLE }

internal data class DeviceListState(
    val serverId: ServerId? = null,
    val tenantId: Long? = null,
    /** Platform admin: summary counts, pageSize 100, pending devices listed (§5 S20). */
    val admin: Boolean = true,
    /** Session on the master tenant: rows carry their tenant tag. */
    val globalView: Boolean = false,
    val filters: ListFilters = ListFilters(),
    /** Rows in server order, with live patches applied. */
    val devices: List<Device> = emptyList(),
    /** Section of each row when it was loaded (the order never moves under the finger). */
    val sectionOf: Map<Long, DeviceSection> = emptyMap(),
    /** Per-row flash counter: bumped on each live change (600 ms flash, §7.4). */
    val flashes: Map<Long, Int> = emptyMap(),
    /** A first page arrived for the current server, tenant and filters. */
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    /** A filter or search change is being loaded (the previous rows stay). */
    val filtering: Boolean = false,
    val loadingMore: Boolean = false,
    val moreFailed: Boolean = false,
    val page: Int = 0,
    val total: Int = 0,
    val hasMore: Boolean = false,
    /** `/api/devices/summary` of the active server (admins). */
    val summary: FleetSummary? = null,
    /** Per-status counts of the last unfiltered load (non-admins: chip counts are local). */
    val localCounts: Map<DeviceStatus, Int>? = null,
    /** Last load failure; the previous rows (if any) stay on screen. */
    val problem: LoadProblem? = null,
    /** Epoch ms of the last successful load (freshness stamp). */
    val updatedAt: Long? = null,
    /** Rows whose status changed section since the load: "N changements · Actualiser l'ordre". */
    val pendingChanges: Int = 0,
    /** Global-view filter sent as `tenantIds=` (§2.3 "Filtrer la vue globale"); empty = none. */
    val viewTenantIds: List<Long> = emptyList(),
    /** Names of the filtered tenants, in tenant-list order. */
    val filterNames: List<String> = emptyList(),
) {
    /** The global view is narrowed to some tenants. */
    val viewFiltered: Boolean get() = viewTenantIds.isNotEmpty()

    val sections: List<SectionUi>
        get() = buildSections(
            devices = devices,
            frozen = sectionOf,
            problemsFirst = filters.problemsFirst,
            total = total,
            hasMore = hasMore,
            // Summary counts describe the list only without search, OS filter nor tenant filter
            // (`/devices/summary` ignores `tenantIds`).
            summary = summary?.takeIf { admin && filters.search.isBlank() && filters.os == null && !viewFiltered },
        )

    /**
     * Count shown on a status chip: summary for admins, local otherwise (§5 S20).
     * Hidden while the global view is filtered: the summary covers every tenant.
     */
    fun chipCount(chip: StatusChip): Int? = when {
        viewFiltered -> null
        admin -> summary?.count(DeviceSection.of(chip.status))
        else -> localCounts?.get(chip.status)
    }

    /** Status chips offered: enrolment requests only for admins (non-admins only see approved devices). */
    val statusChips: List<StatusChip> get() = if (admin) StatusChip.entries else StatusChip.entries - StatusChip.PENDING
}

/**
 * S20: devices of the ACTIVE server, in its session tenant. Reloads on server,
 * tenant, global-view filter (`tenantIds=`, §2.3) and sign-in changes; merges
 * live status changes and metrics pushed on
 * the active server's socket while [followRealtime] runs (screen visible).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class DeviceListViewModel(
    private val services: ObliServices,
    private val clock: DevicesClock,
    private val searchDebounceMs: Long = SEARCH_DEBOUNCE_MS,
    private val metricsEveryMs: Long = METRICS_EVERY_MS,
) : ViewModel() {

    private val _state = MutableStateFlow(DeviceListState())
    val state: StateFlow<DeviceListState> = _state.asStateFlow()

    /** Realtime state of the active server (freshness stamp "En direct"). */
    val realtime: StateFlow<ConnectionState> = services.sessions.active
        .flatMapLatest { s -> s?.realtime?.state ?: flowOf(ConnectionState.DISCONNECTED) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), services.sessions.active.value?.realtime?.state?.value ?: ConnectionState.DISCONNECTED)

    private var loadJob: Job? = null
    private var moreJob: Job? = null
    private var searchJob: Job? = null
    private var flushJob: Job? = null
    private val pendingMetrics = LinkedHashMap<Long, DeviceMetrics>()
    private var lastFlushAt = Long.MIN_VALUE

    init {
        viewModelScope.launch { contexts().collect(::onContext) }
    }

    private fun contexts(): Flow<ListContext> = combine(
        services.sessions.active.flatMapLatest { s ->
            s?.auth?.map { a -> s.id to a } ?: flowOf(null to AuthState.Unknown)
        },
        services.tenants.scope,
    ) { (id, auth), scope ->
        val probe = (auth as? AuthState.SignedIn)?.probe
        val tenantId = scope.currentTenantId?.takeIf { scope.serverId == id } ?: probe?.currentTenantId
        ListContext(
            serverId = id,
            tenantId = tenantId,
            auth = when (auth) {
                is AuthState.SignedIn -> AuthKind.SIGNED_IN
                AuthState.Expired, AuthState.SignedOut -> AuthKind.LOST
                is AuthState.Unreachable -> AuthKind.UNREACHABLE
                AuthState.Unknown -> AuthKind.UNKNOWN
            },
            // Unknown until the probe answers: behave as the web does for admins; a
            // non-admin reloads with the server maximum page size as soon as the probe arrives.
            admin = probe?.user?.isPlatformAdmin ?: true,
            globalView = tenantId == tools.obli.obliance.api.MASTER_TENANT_ID,
            // The scope's filter is empty outside the global view (TenantScope rules).
            viewTenantIds = if (scope.serverId == id) scope.listTenantIds else emptyList(),
            filterNames = if (scope.serverId == id) scope.filterTenants.map { it.name } else emptyList(),
        )
    }.distinctUntilChanged()

    private fun onContext(ctx: ListContext) {
        val before = _state.value
        // A tenant that just became known (cold start: /me answered after the
        // first page) is the one the server already used: same scope.
        val sameScope = before.serverId == ctx.serverId && (before.tenantId == ctx.tenantId || before.tenantId == null)
        val filterChanged = before.viewTenantIds != ctx.viewTenantIds
        _state.value = if (sameScope) {
            before.copy(
                tenantId = ctx.tenantId, admin = ctx.admin, globalView = ctx.globalView,
                viewTenantIds = ctx.viewTenantIds, filterNames = ctx.filterNames,
            )
        } else {
            // Another server or tenant: nothing of the previous one may stay on screen.
            DeviceListState(
                serverId = ctx.serverId, tenantId = ctx.tenantId, admin = ctx.admin, globalView = ctx.globalView, filters = before.filters,
                viewTenantIds = ctx.viewTenantIds, filterNames = ctx.filterNames,
            )
        }
        when {
            ctx.serverId == null -> {
                cancelLoads()
                _state.update { it.copy(loading = false, problem = LoadProblem(ProblemKind.NO_SERVER)) }
            }
            // The app shows S03; do not hammer the server with 401s meanwhile.
            ctx.auth == AuthKind.LOST -> {
                cancelLoads()
                _state.update { it.copy(loading = false, refreshing = false, filtering = false, problem = LoadProblem(ProblemKind.SESSION_EXPIRED, 401)) }
            }
            !sameScope || !before.loaded -> load(Mode.INITIAL)
            // "Filtrer la vue globale" changed (§2.3): reload like a filter chip, rows stay meanwhile.
            filterChanged -> load(Mode.FILTER)
            before.admin != ctx.admin || before.problem != null -> load(Mode.REFRESH)
        }
    }

    /** "Effacer le filtre" of the list (§2.3): clears the global-view filter of the list's server. */
    fun clearViewFilter() {
        val serverId = _state.value.serverId ?: return
        viewModelScope.launch { services.tenants.setViewFilter(emptySet(), serverId) }
    }

    private enum class Mode { INITIAL, REFRESH, FILTER }

    private fun cancelLoads() {
        loadJob?.cancel()
        moreJob?.cancel()
    }

    private fun load(mode: Mode) {
        cancelLoads()
        val s = _state.value
        val serverId = s.serverId ?: return
        _state.update {
            it.copy(
                loading = mode == Mode.INITIAL || it.devices.isEmpty(),
                refreshing = mode == Mode.REFRESH && it.devices.isNotEmpty(),
                filtering = mode == Mode.FILTER && it.devices.isNotEmpty(),
                loadingMore = false,
                moreFailed = false,
            )
        }
        val filters = s.filters
        val admin = s.admin
        val tenantIds = s.viewTenantIds
        loadJob = viewModelScope.launch {
            coroutineScope {
                // The summary ignores `tenantIds`: not asked while the global view is filtered.
                val summary = if (admin && tenantIds.isEmpty()) async { services.devices.summary(serverId) } else null
                val out = services.devices.page(filters.toQuery(1, admin, tenantIds), serverId)
                val sum = (summary?.await() as? ApiOutcome.Ok)?.value
                _state.update { st ->
                    // A late answer of another server, filter set or tenant filter is dropped.
                    if (st.serverId != serverId || st.filters != filters || st.viewTenantIds != tenantIds) return@update st
                    when (out) {
                        is ApiOutcome.Ok -> {
                            val rows = out.value.items.distinctBy { it.id }
                            st.copy(
                                devices = rows,
                                sectionOf = rows.associate { it.id to DeviceSection.of(it.statusKind) },
                                flashes = emptyMap(),
                                loaded = true,
                                loading = false,
                                refreshing = false,
                                filtering = false,
                                page = 1,
                                total = out.value.total,
                                hasMore = out.value.hasMore,
                                summary = sum ?: st.summary,
                                localCounts = if (!filters.narrowed && tenantIds.isEmpty()) rows.groupingBy { it.statusKind }.eachCount() else st.localCounts,
                                problem = null,
                                updatedAt = clock.now(),
                                pendingChanges = 0,
                            )
                        }
                        else -> st.copy(
                            loading = false,
                            refreshing = false,
                            filtering = false,
                            summary = sum ?: st.summary,
                            problem = out.toProblem("/api/devices"),
                        )
                    }
                }
            }
        }
    }

    /** Pull to refresh, "Réessayer", "Actualiser l'ordre". */
    fun refresh() = load(Mode.REFRESH)

    /** Infinite scroll (admins, pages of 100). */
    fun loadMore() {
        val s = _state.value
        val serverId = s.serverId ?: return
        if (!s.hasMore || s.loadingMore || loadJob?.isActive == true || !s.loaded) return
        _state.update { it.copy(loadingMore = true, moreFailed = false) }
        val filters = s.filters
        val tenantIds = s.viewTenantIds
        val next = s.page + 1
        moreJob = viewModelScope.launch {
            val out = services.devices.page(filters.toQuery(next, s.admin, tenantIds), serverId)
            _state.update { st ->
                if (st.serverId != serverId || st.filters != filters || st.viewTenantIds != tenantIds || st.page != next - 1) return@update st.copy(loadingMore = false)
                when (out) {
                    is ApiOutcome.Ok -> {
                        val known = st.devices.mapTo(HashSet()) { it.id }
                        val added = out.value.items.filter { it.id !in known }
                        st.copy(
                            devices = st.devices + added,
                            sectionOf = st.sectionOf + added.associate { it.id to DeviceSection.of(it.statusKind) },
                            page = next,
                            total = out.value.total,
                            hasMore = out.value.hasMore && added.isNotEmpty(),
                            loadingMore = false,
                        )
                    }
                    else -> st.copy(loadingMore = false, moreFailed = true)
                }
            }
        }
    }

    fun setSearch(text: String) {
        if (text == _state.value.filters.search) return
        _state.update { it.copy(filters = it.filters.copy(search = text)) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(searchDebounceMs)
            load(Mode.FILTER)
        }
    }

    fun toggleStatus(chip: StatusChip) = setFilters { it.copy(status = if (it.status == chip) null else chip) }

    fun toggleOs(chip: OsChip) = setFilters { it.copy(os = if (it.os == chip) null else chip) }

    fun toggleProblemsFirst() = setFilters { it.copy(problemsFirst = !it.problemsFirst) }

    fun clearFilters() = setFilters { ListFilters(problemsFirst = it.problemsFirst) }

    private fun setFilters(change: (ListFilters) -> ListFilters) {
        searchJob?.cancel()
        val next = change(_state.value.filters)
        if (next == _state.value.filters) return
        _state.update { it.copy(filters = next) }
        load(Mode.FILTER)
    }

    /**
     * Runs while the screen is visible (the UI calls it under
     * `repeatOnLifecycle(STARTED)`): device signals and metrics pushed on the
     * ACTIVE server's socket. Cancelled in background (§7.4 "Cycle de vie").
     */
    suspend fun followRealtime() {
        coroutineScope {
            launch {
                services.devices.signals().collect { onSignal(it, services.registry.state.value.activeId) }
            }
            launch {
                services.sessions.active.flatMapLatest { s ->
                    s?.realtime?.events?.mapNotNull { e ->
                        if (e.name != ObliEvents.DEVICE_METRICS_PUSHED) null else DevicesApi.decodeMetricsPush(e.payload)?.let { s.id to it }
                    } ?: emptyFlow()
                }.collect { (serverId, push) -> onMetricsPush(serverId, push.deviceId, push.metrics) }
            }
        }
    }

    /**
     * A device changed on [fromServer] (§5 S20 "Temps réel"). Only rows already
     * listed are patched: events are not filtered by visibility on the server.
     */
    internal fun onSignal(signal: DeviceSignal, fromServer: ServerId?) {
        _state.update { s ->
            if (fromServer == null || s.serverId != fromServer) return@update s
            val index = s.devices.indexOfFirst { it.id == signal.deviceId }
            if (index < 0) return@update s
            val device = s.devices[index]
            when (signal.event) {
                ObliEvents.DEVICE_DELETED -> s.copy(
                    devices = s.devices.filterNot { it.id == device.id },
                    sectionOf = s.sectionOf - device.id,
                    total = (s.total - 1).coerceAtLeast(0),
                )
                ObliEvents.DEVICE_APPROVED -> s.copy(
                    devices = s.devices.toMutableList().also { it[index] = device.copy(approvalStatus = "approved", status = signal.status?.wire ?: device.status) },
                    flashes = s.flashes.bump(device.id),
                    pendingChanges = s.pendingChanges + 1,
                )
                else -> {
                    val status = signal.status ?: when (signal.event) {
                        ObliEvents.DEVICE_ONLINE -> DeviceStatus.ONLINE
                        ObliEvents.DEVICE_OFFLINE -> DeviceStatus.OFFLINE
                        else -> null
                    }
                    if (status == null || status == DeviceStatus.UNKNOWN || status == device.statusKind) return@update s
                    val moved = (s.sectionOf[device.id] ?: DeviceSection.of(device.statusKind)) != DeviceSection.of(status)
                    val wasMoved = s.sectionOf[device.id] != DeviceSection.of(device.statusKind)
                    s.copy(
                        devices = s.devices.toMutableList().also { it[index] = device.copy(status = status.wire) },
                        flashes = s.flashes.bump(device.id),
                        pendingChanges = s.pendingChanges + when {
                            moved && !wasMoved -> 1
                            !moved && wasMoved -> -1
                            else -> 0
                        },
                    )
                }
            }
        }
    }

    /** Metrics of listed rows, applied at most once per second (§7.4 "Plafonds"). */
    internal fun onMetricsPush(fromServer: ServerId, deviceId: Long, metrics: DeviceMetrics) {
        val s = _state.value
        if (s.serverId != fromServer || s.devices.none { it.id == deviceId }) return
        pendingMetrics[deviceId] = metrics
        val wait = if (lastFlushAt == Long.MIN_VALUE) 0 else metricsEveryMs - (clock.now() - lastFlushAt)
        if (wait <= 0) {
            flushMetrics()
        } else if (flushJob?.isActive != true) {
            flushJob = viewModelScope.launch {
                delay(wait)
                flushMetrics()
            }
        }
    }

    private fun flushMetrics() {
        lastFlushAt = clock.now()
        if (pendingMetrics.isEmpty()) return
        val batch = HashMap(pendingMetrics)
        pendingMetrics.clear()
        _state.update { s -> s.copy(devices = s.devices.map { d -> batch[d.id]?.let { d.copy(latestMetrics = it) } ?: d }) }
    }

    private fun Map<Long, Int>.bump(id: Long): Map<Long, Int> = this + (id to (this[id] ?: 0) + 1)

    companion object {
        const val SEARCH_DEBOUNCE_MS = 300L
        const val METRICS_EVERY_MS = 1_000L
    }
}
