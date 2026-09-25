package tools.obli.obliance.automations

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.toColor

/** « Agent approuvé », « Planifié × 2 »… for the trigger chips of a scenario (§5 S58). */
@Composable
internal fun triggerLabels(s: ScenarioDto): List<String> {
    val counts = s.triggerCounts.filterValues { it > 0 }.ifEmpty { s.triggerType?.let { mapOf(it to 1) }.orEmpty() }
    return counts.entries.sortedBy { TRIGGER_ORDER.indexOf(it.key).let { i -> if (i < 0) 99 else i } }.map { (k, n) ->
        val name = triggerName(k)
        if (n > 1) stringResource(R.string.automations_trigger_times, name, n) else name
    }
}

private val TRIGGER_ORDER = listOf(
    "manual", "schedule_cron", "agent_approved", "session_login", "machine_boot", "group_join",
    "schedule_failure", "agent_back_online", "metric_warning", "metric_critical", "metric_custom",
)

@Composable
internal fun triggerName(key: String): String = when (key.removePrefix("trigger_")) {
    "manual" -> stringResource(R.string.automations_trigger_manual)
    "schedule_cron" -> stringResource(R.string.automations_trigger_schedule)
    "agent_approved" -> stringResource(R.string.automations_trigger_agent_approved)
    "session_login" -> stringResource(R.string.automations_trigger_session_login)
    "machine_boot" -> stringResource(R.string.automations_trigger_boot)
    "group_join" -> stringResource(R.string.automations_trigger_group_join)
    "schedule_failure" -> stringResource(R.string.automations_trigger_schedule_failure)
    "agent_back_online" -> stringResource(R.string.automations_trigger_back_online)
    "metric_warning" -> stringResource(R.string.automations_trigger_metric_warning)
    "metric_critical" -> stringResource(R.string.automations_trigger_metric_critical)
    "metric_custom" -> stringResource(R.string.automations_trigger_metric_custom)
    else -> key
}

/** Actif / Brouillon / Désactivé with its dot colour (never red). */
@Composable
internal fun scenarioStatus(status: String): Pair<String, Color> = when (status) {
    "active" -> stringResource(R.string.automations_scenario_active) to ObliTokens.Status.ONLINE.argb.toColor()
    "disabled" -> stringResource(R.string.automations_scenario_disabled) to ObliTheme.colors.textMuted
    else -> stringResource(R.string.automations_scenario_draft) to ObliTokens.Status.PENDING.argb.toColor()
}

/** Run / node statuses of scenarios mapped onto the execution steps. */
internal fun runStep(status: String): ExecStep = when (status) {
    "pending" -> ExecStep.QUEUED
    "running" -> ExecStep.RUNNING
    "success" -> ExecStep.SUCCESS
    "failure", "failed" -> ExecStep.FAILURE
    "timeout" -> ExecStep.TIMEOUT
    "cancelled" -> ExecStep.CANCELLED
    "skipped" -> ExecStep.SKIPPED
    else -> ExecStep.QUEUED
}

@Composable
internal fun cronText(desc: CronDesc, zone: ZoneId): String {
    fun hm(h: Int, m: Int) = String.format(Locale.ROOT, "%02d:%02d", h, m)
    return when (desc) {
        is CronDesc.EveryMinutes -> pluralStringResource(R.plurals.automations_cron_every_minutes, desc.n, desc.n)
        is CronDesc.Hourly -> stringResource(R.string.automations_cron_hourly, String.format(Locale.ROOT, "%02d", desc.minute))
        is CronDesc.Daily -> stringResource(R.string.automations_cron_daily, hm(desc.hour, desc.minute))
        is CronDesc.Weekdays -> stringResource(R.string.automations_cron_weekdays, hm(desc.hour, desc.minute))
        is CronDesc.Weekly -> {
            val day = DayOfWeek.of(if (desc.day == 0) 7 else desc.day).getDisplayName(TextStyle.FULL, currentLocale())
            stringResource(R.string.automations_cron_weekly, day.replaceFirstChar { it.titlecase() }, hm(desc.hour, desc.minute))
        }
        is CronDesc.Monthly -> stringResource(R.string.automations_cron_monthly, desc.day, hm(desc.hour, desc.minute))
        is CronDesc.Once -> stringResource(R.string.automations_cron_once, Fmt.time(desc.at, zone) ?: desc.at)
        is CronDesc.Raw -> desc.expression
    }
}

@Composable
internal fun currentLocale(): Locale = androidx.compose.ui.platform.LocalLocale.current.platformLocale

/** « 3 appareils ». */
@Composable
internal fun devicesCount(n: Int): String = pluralStringResource(R.plurals.automations_devices, n, n)

/** Localised step label. */
@Composable
internal fun stepText(step: ExecStep): String = stringResource(step.label)

/** Parameter line « Âge minimum (jours) = 7 » / « = oui » / « = •••••• ». */
@Composable
internal fun paramText(p: ParamLine): String = when {
    p.secret -> stringResource(R.string.automations_param_line, p.label, "••••••")
    p.flag != null -> stringResource(R.string.automations_param_line, p.label, stringResource(if (p.flag) R.string.automations_yes else R.string.automations_no))
    else -> stringResource(R.string.automations_param_line, p.label, p.text.orEmpty())
}
