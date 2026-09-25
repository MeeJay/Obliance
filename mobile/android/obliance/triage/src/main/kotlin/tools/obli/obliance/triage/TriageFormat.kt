package tools.obli.obliance.triage

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.toColor
import tools.obli.obliance.domain.AlertCategory
import tools.obli.shell.alerts.AlertSeverity

/** Clock and zone of the screen: injected so screenshots and tests are stable. */
internal data class TriageTime(val now: Long, val zone: ZoneId)

private val HH_MM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

internal fun Instant.hhmm(zone: ZoneId): String = atZone(zone).format(HH_MM)

internal fun Long.hhmm(zone: ZoneId): String = Instant.ofEpochMilli(this).hhmm(zone)

/** Relative age of the overline: "maintenant", "4 min", "2 h", "3 j". */
@Composable
internal fun relativeAge(at: Instant?, now: Long): String? {
    at ?: return null
    val minutes = ((now - at.toEpochMilli()) / 60_000L).coerceAtLeast(0)
    return when {
        minutes < 1 -> stringResource(R.string.triage_age_now)
        minutes < 60 -> stringResource(R.string.triage_age_minutes, minutes.toInt())
        minutes < 24 * 60 -> stringResource(R.string.triage_age_hours, (minutes / 60).toInt())
        else -> stringResource(R.string.triage_age_days, (minutes / (24 * 60)).toInt())
    }
}

/** Whole minutes left before [expiresAt] (at least 1 while pending), 0 when expired, null when unknown. */
internal fun minutesLeft(expiresAt: Instant?, now: Long): Int? {
    expiresAt ?: return null
    val ms = expiresAt.toEpochMilli() - now
    return if (ms <= 0) 0 else (ms / 60_000).toInt().coerceAtLeast(1)
}

/** Expiry colours (STYLEKIT expiry-ring): blue above 10 min, amber at 10 min and less, red at 3 min and less. */
internal fun expiryColor(minutes: Int?): Color = when {
    minutes == null -> ObliTokens.UNREAD.toColor()
    minutes <= 3 -> ObliTokens.Status.CRITICAL.argb.toColor()
    minutes <= 10 -> ObliTokens.Status.WARNING.argb.toColor()
    else -> ObliTokens.UNREAD.toColor()
}

/** Severity as shown on a card: a recovery reads "Rétabli" in green whatever the server severity. */
internal enum class SeverityLook(val label: Int, val bar: Long, val text: Long) {
    CRITICAL(R.string.triage_severity_critical, ObliTokens.SEVERITY_CRITICAL, ObliTokens.Status.CRITICAL.argb),
    WARNING(R.string.triage_severity_warning, ObliTokens.SEVERITY_WARNING, ObliTokens.Status.WARNING.argb),
    INFO(R.string.triage_severity_info, ObliTokens.SEVERITY_INFO, ObliTokens.UNREAD),
    RECOVERY(R.string.triage_severity_recovered, ObliTokens.SEVERITY_RECOVERY, ObliTokens.Status.ONLINE.argb),
    ;

    val icon: ImageVector
        get() = when (this) {
            CRITICAL -> ObliIcons.CircleAlert
            WARNING -> ObliIcons.TriangleAlert
            INFO -> ObliIcons.Info
            RECOVERY -> ObliIcons.CircleCheck
        }

    companion object {
        fun of(severity: AlertSeverity, category: AlertCategory): SeverityLook = when {
            category == AlertCategory.RECOVERY -> RECOVERY
            severity == AlertSeverity.CRITICAL -> CRITICAL
            severity == AlertSeverity.WARNING -> WARNING
            else -> INFO
        }

        fun of(severity: AlertSeverity): SeverityLook = of(severity, AlertCategory.OTHER)
    }
}

/** "SRV-AD2 — Hors ligne"; the server title as is when the category is unknown. */
@Composable
internal fun incidentTitle(item: IncidentUi): String {
    val device = item.deviceName ?: return item.rawTitle
    val category = when (item.category) {
        AlertCategory.OFFLINE -> stringResource(R.string.triage_category_offline)
        AlertCategory.METRIC -> when (item.severity) {
            AlertSeverity.CRITICAL -> stringResource(R.string.triage_category_metric_critical)
            AlertSeverity.WARNING -> stringResource(R.string.triage_category_metric_warning)
            AlertSeverity.INFO -> stringResource(R.string.triage_category_metric)
        }
        AlertCategory.DISK_HEALTH -> stringResource(R.string.triage_category_disk_health)
        AlertCategory.RECOVERY -> stringResource(R.string.triage_category_recovery)
        AlertCategory.IDENTITY -> stringResource(R.string.triage_category_identity)
        AlertCategory.OTHER -> return item.rawTitle
    }
    return stringResource(R.string.triage_card_title, device, category)
}

/** Label of a two-person approval type (approval.service.ts request types). */
@Composable
internal fun requestTypeLabel(type: String): String = stringResource(
    when (type) {
        "device_uninstall" -> R.string.triage_request_device_uninstall
        "batch_command" -> R.string.triage_request_batch_command
        "setting_change" -> R.string.triage_request_setting_change
        else -> R.string.triage_request_other
    },
)
