package tools.obli.obliance.automations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome

internal data class PickerUiState(
    val serverId: ServerId,
    val loading: Boolean = true,
    val problem: ApiOutcome<Nothing>? = null,
    val scripts: List<ScriptDto> = emptyList(),
    val categories: List<ScriptCategoryDto> = emptyList(),
    val query: String = "",
    /** Platform chip: deduced from the targets, null = every platform. */
    val platform: String? = null,
    /** Platforms of the targets (the chips offered). */
    val targetPlatforms: Set<String> = emptySet(),
    val categoryId: Long? = null,
    val recentOnly: Boolean = false,
    /** Script ids of my recent batches, most recent first. */
    val recent: List<Long> = emptyList(),
    val sessionTenantId: Long? = null,
    /** Preview sheet: `GET /api/scripts/:id` (parameters, content). */
    val preview: ScriptDto? = null,
    val previewLoading: Boolean = false,
    val previewProblem: ApiOutcome<Nothing>? = null,
) {
    val visible: List<ScriptDto>
        get() {
            val q = query.trim()
            val base = scripts.filter { s ->
                (platform == null || s.platform == "all" || s.platform == platform) &&
                    (categoryId == null || s.categoryId == categoryId) &&
                    (q.isEmpty() || s.name.contains(q, ignoreCase = true) || s.description.orEmpty().contains(q, ignoreCase = true)) &&
                    (!recentOnly || s.id in recent)
            }
            return if (recentOnly) base.sortedBy { recent.indexOf(it.id) } else base
        }

    /** Master-owned script seen from a child tenant: runnable, not editable (§5 S50 "Vue globale"). */
    fun managedByMaster(s: ScriptDto): Boolean = s.tenantId == MASTER_TENANT && sessionTenantId != null && sessionTenantId != MASTER_TENANT
}

/**
 * S50: scripts of [serverId] (`GET /api/scripts` once, then local search and
 * chips so "all"-platform scripts stay listed next to the Windows ones),
 * categories, and the preview of one script. [deviceIds] (may be empty) set
 * the platform chip.
 */
internal class ScriptPickerViewModel(
    private val services: tools.obli.obliance.data.ObliServices,
    private val remote: AutomationsRemote,
    private val serverId: ServerId,
    private val deviceIds: List<Long>,
) : ViewModel() {
    private val facts = ServerFacts(services)
    private val _state = MutableStateFlow(PickerUiState(serverId, sessionTenantId = facts.sessionTenant(serverId)))
    val state: StateFlow<PickerUiState> = _state.asStateFlow()
    private var previewJob: Job? = null

    init {
        viewModelScope.launch { load() }
        viewModelScope.launch { loadPlatforms() }
        viewModelScope.launch { loadRecent() }
    }

    fun retry() {
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        _state.update { it.copy(loading = true, problem = null) }
        val scripts = remote.scripts(serverId)
        val categories = remote.categories(serverId)
        _state.update {
            when (scripts) {
                is ApiOutcome.Ok -> it.copy(loading = false, scripts = scripts.value, categories = categories.valueOrNull.orEmpty().sortedBy { c -> c.sortOrder })
                else -> it.copy(loading = false, problem = scripts.asFailure())
            }
        }
    }

    private suspend fun loadPlatforms() {
        if (deviceIds.isEmpty()) return
        val devices = coroutineScope { deviceIds.distinct().map { id -> async { services.devices.detail(serverId, id).valueOrNull } }.awaitAll() }.filterNotNull()
        val platforms = devices.mapNotNull { platformOf(it) }.toSet()
        _state.update { it.copy(targetPlatforms = platforms, platform = platforms.singleOrNull()) }
    }

    private suspend fun loadRecent() {
        val me = facts.me(serverId)
        val batches = remote.batches(serverId, 1, 30).valueOrNull?.items.orEmpty()
        val mine = batches.filter { me == null || it.triggeredByUsername == null || it.triggeredByUsername == me.label || it.triggeredByUsername == me.username }
            .filter { it.scheduleId == null }
        _state.update { it.copy(recent = mine.map { b -> b.scriptId }.distinct()) }
    }

    fun setQuery(q: String) = _state.update { it.copy(query = q) }
    fun setPlatform(p: String?) = _state.update { it.copy(platform = if (it.platform == p) null else p) }
    fun setCategory(id: Long?) = _state.update { it.copy(categoryId = if (it.categoryId == id) null else id) }
    fun toggleRecent() = _state.update { it.copy(recentOnly = !it.recentOnly) }

    fun openPreview(script: ScriptDto) {
        previewJob?.cancel()
        _state.update { it.copy(preview = script, previewLoading = true, previewProblem = null) }
        previewJob = viewModelScope.launch {
            when (val out = remote.script(serverId, script.id)) {
                is ApiOutcome.Ok -> _state.update { if (it.preview?.id == script.id) it.copy(preview = out.value.copy(usage = out.value.usage ?: script.usage), previewLoading = false) else it }
                else -> _state.update { it.copy(previewLoading = false, previewProblem = out.asFailure()) }
            }
        }
    }

    fun closePreview() {
        previewJob?.cancel()
        _state.update { it.copy(preview = null, previewLoading = false, previewProblem = null) }
    }
}
