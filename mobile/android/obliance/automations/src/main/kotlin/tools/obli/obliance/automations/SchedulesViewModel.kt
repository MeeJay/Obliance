package tools.obli.obliance.automations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.obliance.data.ObliServices

/** A cron expression in words (design doc §5 S57 « Tous les jours à 02:00 »). */
internal sealed interface CronDesc {
    data class EveryMinutes(val n: Int) : CronDesc
    data class Hourly(val minute: Int) : CronDesc
    data class Daily(val hour: Int, val minute: Int) : CronDesc
    data class Weekdays(val hour: Int, val minute: Int) : CronDesc

    /** [day] 0 = Sunday … 6 = Saturday (cron). */
    data class Weekly(val day: Int, val hour: Int, val minute: Int) : CronDesc
    data class Monthly(val day: Int, val hour: Int, val minute: Int) : CronDesc
    data class Once(val at: String) : CronDesc
    data class Raw(val expression: String) : CronDesc

    companion object {
        fun of(cron: String?, fireOnceAt: String?): CronDesc {
            if (cron.isNullOrBlank()) return if (fireOnceAt != null) Once(fireOnceAt) else Raw("—")
            val p = cron.trim().split(Regex("\\s+"))
            if (p.size != 5) return Raw(cron.trim())
            val (mi, h, dom, mon, dow) = p
            val minute = mi.toIntOrNull()
            val hour = h.toIntOrNull()
            return when {
                mi.startsWith("*/") && h == "*" && dom == "*" && mon == "*" && dow == "*" -> mi.removePrefix("*/").toIntOrNull()?.let { EveryMinutes(it) } ?: Raw(cron)
                minute != null && h == "*" && dom == "*" && mon == "*" && dow == "*" -> Hourly(minute)
                minute == null || hour == null || minute !in 0..59 || hour !in 0..23 -> Raw(cron.trim())
                dom == "*" && mon == "*" && dow == "*" -> Daily(hour, minute)
                dom == "*" && mon == "*" && (dow == "1-5" || dow == "MON-FRI") -> Weekdays(hour, minute)
                dom == "*" && mon == "*" && dow.toIntOrNull() != null -> Weekly(dow.toInt() % 7, hour, minute)
                dom.toIntOrNull() != null && mon == "*" && dow == "*" -> Monthly(dom.toInt(), hour, minute)
                else -> Raw(cron.trim())
            }
        }
    }
}

internal data class SchedulesUiState(
    val serverId: ServerId?,
    val loading: Boolean = true,
    val problem: ApiOutcome<Nothing>? = null,
    val schedules: List<ScheduleDto> = emptyList(),
    /** Last batch per schedule among the recent ones. */
    val lastRuns: Map<Long, BatchSummary> = emptyMap(),
    val sessionTenantId: Long? = null,
    val busy: Set<Long> = emptySet(),
) {
    /** Master schedule seen from a child tenant: read-only, switch disabled (§5 S57). */
    fun readOnly(s: ScheduleDto): Boolean = s.tenantId != null && sessionTenantId != null && s.tenantId != sessionTenantId

    val activeCount: Int get() = schedules.count { it.enabled }
}

/**
 * S57 (read-only list): schedules of the ACTIVE server (`GET /api/schedules`),
 * their last result from the recent batches, and the pause switch
 * (`PATCH /api/schedules/:id {enabled}`, T1). Creation and edition stay in
 * the web view.
 */
internal class SchedulesViewModel(
    private val services: ObliServices,
    private val remote: AutomationsRemote,
) : ViewModel() {
    private val facts = ServerFacts(services)
    private val serverId: ServerId? = services.registry.state.value.activeId
    private val _state = MutableStateFlow(SchedulesUiState(serverId, sessionTenantId = serverId?.let { facts.sessionTenant(it) }))
    val state: StateFlow<SchedulesUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        val id = serverId ?: return
        viewModelScope.launch {
            coroutineScope {
                val s = async { remote.schedules(id) }
                val b = async { remote.batches(id, 1, 100) }
                val out = s.await()
                val last = b.await().valueOrNull?.items.orEmpty().filter { it.scheduleId != null }.groupBy { it.scheduleId!! }.mapValues { it.value.first() }
                _state.update {
                    when (out) {
                        is ApiOutcome.Ok -> it.copy(loading = false, problem = null, schedules = out.value.sortedWith(compareByDescending<ScheduleDto> { s -> s.enabled }.thenBy { s -> s.name.lowercase() }), lastRuns = last)
                        else -> it.copy(loading = false, problem = out.asFailure())
                    }
                }
            }
        }
    }

    /** Pause / resume, T1 (design doc §7.6 "mettre en pause une planification"). */
    suspend fun setEnabled(s: ScheduleDto, enabled: Boolean, runner: ActionRunner, title: String, consequence: String?): ActionResult<ScheduleDto> {
        val id = serverId ?: return ActionResult.Cancelled
        val spec = ActionSpec(key = if (enabled) "schedule.enable" else "schedule.pause", tier = Tier.T1, title = title, target = s.name, scope = facts.scope(id, null), consequence = consequence)
        _state.update { it.copy(busy = it.busy + s.id) }
        val result = try {
            runner.run(spec) { extra -> remote.setScheduleEnabled(id, s.id, enabled, extra) }
        } finally {
            _state.update { it.copy(busy = it.busy - s.id) }
        }
        if (result is ActionResult.Done) {
            _state.update { st -> st.copy(schedules = st.schedules.map { if (it.id == s.id) it.copy(enabled = if (result.value.id == s.id) result.value.enabled else enabled, nextRunAt = result.value.nextRunAt ?: it.nextRunAt) else it }) }
        }
        return result
    }
}
