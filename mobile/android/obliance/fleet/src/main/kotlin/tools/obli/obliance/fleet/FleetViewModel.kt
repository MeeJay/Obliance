package tools.obli.obliance.fleet

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.data.ObliServices

/**
 * S70 "Flotte" of the ACTIVE server, in its session tenant. Loads while the
 * screen collects [ui]: at once, then every [pollMs] (design doc §2.3 rule 3:
 * `summary` and `group-stats` every 60 s while visible), and again whenever the
 * active server or the session tenant changes. Every call of one load targets
 * the server that was active when it started; a switch cancels it.
 */
internal class FleetViewModel(
    private val services: ObliServices,
    private val source: FleetSource = ServicesFleetSource(services),
    private val clock: () -> Long = System::currentTimeMillis,
    private val pollMs: Long = POLL_MS,
) : ViewModel() {
    private val state = MutableStateFlow(FleetUi())
    private val manual = Channel<Unit>(Channel.CONFLATED)

    private data class ScopeKey(val serverId: ServerId?, val tenantId: Long?, val globalView: Boolean, val filter: FleetFilter? = null)

    val ui: StateFlow<FleetUi> = channelFlow {
        launch { state.collect { send(it) } }
        services.tenants.scope
            .map {
                // "Filtrer la vue globale" (§2.3): empty outside the global view (TenantScope rules).
                val filter = if (it.viewFiltered) FleetFilter(it.listTenantIds, it.filterTenants.map { t -> t.name }) else null
                ScopeKey(it.serverId ?: services.registry.state.value.activeId, it.currentTenantId, it.isGlobalView, filter)
            }
            .distinctUntilChanged()
            .collectLatest { key ->
                val serverId = key.serverId
                if (serverId == null) {
                    state.value = FleetUi(loading = false, noServer = true)
                    return@collectLatest
                }
                // Another server, tenant or filter: never keep showing the previous scope's figures.
                if (key != shownScope) state.value = FleetUi(loading = true, filter = key.filter)
                shownScope = key
                while (true) {
                    load(serverId, key.globalView, key.filter)
                    // Next poll, or earlier on pull to refresh.
                    withTimeoutOrNull(pollMs) { manual.receive() }
                }
            }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FleetUi())

    /** Scope of the figures in [state] (a new subscription of the same scope keeps them while it reloads). */
    @Volatile private var shownScope: ScopeKey? = null

    /** Pull to refresh / retry. */
    fun refresh() {
        state.update { it.copy(refreshing = it.data != null) }
        manual.trySend(Unit)
    }

    private suspend fun load(serverId: ServerId, globalView: Boolean, filter: FleetFilter?) {
        val admin = source.isPlatformAdmin(serverId)
        val result = when {
            filter != null -> loadFiltered(serverId, globalView, filter, admin)
            admin -> loadAggregates(serverId, globalView)
            else -> loadVisible(serverId, globalView)
        }
        when (result) {
            is Loaded.Data -> state.value = FleetUi(loading = false, data = result.data, updatedAt = clock(), filter = filter)
            is Loaded.Failed -> state.update {
                it.copy(loading = false, refreshing = false, problem = FleetMapper.problemOf(result.outcome))
            }
        }
    }

    private sealed interface Loaded {
        data class Data(val data: FleetData) : Loaded
        data class Failed(val outcome: ApiOutcome<*>) : Loaded
    }

    private suspend fun loadAggregates(serverId: ServerId, globalView: Boolean): Loaded = coroutineScope {
        val summary = async { source.summary(serverId) }
        val priority = async { source.byPriority(serverId, ATTENTION_PAGE) }
        val groups = async { source.groupStats(serverId) }
        val disks = async { source.diskSaturation(serverId) }
        val updates = async { source.updateStats(serverId) }
        val hourly = async { source.hourly(serverId) }
        val s = summary.await()
        if (s !is ApiOutcome.Ok) return@coroutineScope Loaded.Failed(s)
        Loaded.Data(
            FleetData(
                serverId = serverId,
                summary = s.value,
                serverAggregates = true,
                attention = (priority.await() as? ApiOutcome.Ok)?.value?.items.orEmpty().needingAttention(ATTENTION_ROWS),
                groups = (groups.await() as? ApiOutcome.Ok)?.value,
                disks = (disks.await() as? ApiOutcome.Ok)?.value,
                updates = (updates.await() as? ApiOutcome.Ok)?.value,
                hourly = (hourly.await() as? ApiOutcome.Ok)?.value,
                showTenants = globalView,
            ),
        )
    }

    /** Non-admins (design doc §5 S70): indicators and attention from the list they can see; no server aggregates. */
    private suspend fun loadVisible(serverId: ServerId, globalView: Boolean): Loaded {
        val page = source.byPriority(serverId, VISIBLE_PAGE)
        if (page !is ApiOutcome.Ok) return Loaded.Failed(page)
        val items = page.value.items
        val summary: FleetSummary = FleetMapper.summaryOf(items)
        return Loaded.Data(
            FleetData(
                serverId = serverId,
                summary = summary,
                serverAggregates = false,
                attention = items.needingAttention(ATTENTION_ROWS),
                showTenants = globalView,
            ),
        )
    }

    /**
     * The global view filtered on some tenants (§2.3): indicators and attention
     * are computed from the filtered device list, like the non-admin path
     * (`/devices/summary` ignores `tenantIds`). For admins, the cards the server
     * cannot filter (group stats, full disks, updates, 24 h activity) still load,
     * for the whole global view; the screen captions them so.
     */
    private suspend fun loadFiltered(serverId: ServerId, globalView: Boolean, filter: FleetFilter, admin: Boolean): Loaded = coroutineScope {
        val page = async { source.byPriority(serverId, VISIBLE_PAGE, filter.tenantIds) }
        val summary = if (admin) async { source.summary(serverId) } else null
        val groups = if (admin) async { source.groupStats(serverId) } else null
        val disks = if (admin) async { source.diskSaturation(serverId) } else null
        val updates = if (admin) async { source.updateStats(serverId) } else null
        val hourly = if (admin) async { source.hourly(serverId) } else null
        val p = page.await()
        if (p !is ApiOutcome.Ok) return@coroutineScope Loaded.Failed(p)
        val items = p.value.items
        Loaded.Data(
            FleetData(
                serverId = serverId,
                summary = FleetMapper.summaryOf(items),
                serverAggregates = admin,
                attention = items.needingAttention(ATTENTION_ROWS),
                groups = (groups?.await() as? ApiOutcome.Ok)?.value,
                disks = (disks?.await() as? ApiOutcome.Ok)?.value,
                updates = (updates?.await() as? ApiOutcome.Ok)?.value,
                hourly = (hourly?.await() as? ApiOutcome.Ok)?.value,
                showTenants = globalView,
                filter = filter,
                globalSummary = (summary?.await() as? ApiOutcome.Ok)?.value,
            ),
        )
    }

    companion object {
        const val POLL_MS = 60_000L
        const val ATTENTION_ROWS = 5
        private const val ATTENTION_PAGE = 20
        /** The server filters visibility after its LIMIT: ask its maximum, never a partial window. */
        private const val VISIBLE_PAGE = DeviceQuery.MAX_PAGE_SIZE
    }
}
