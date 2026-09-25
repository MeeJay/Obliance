package tools.obli.obliance.notifications

import android.content.res.Resources
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.zip.CRC32
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.obliance.domain.AlertCategory

/** The per-server channels (design doc §9): id `<serverId>.<suffix>`, inside group `server.<serverId>`. */
internal enum class NotifChannel(val suffix: String) {
    CRITICAL("critical"),
    ATTENTION("attention"),
    RECOVERY("recovery"),
    ESCALATIONS("escalations"),
    ENROLMENTS("enrolments"),
    ACCOUNT("account"),
    ;

    fun id(serverId: ServerId): String = "${serverId.value}.$suffix"
}

/** What a broadcast action of a notification does (T0/T1 only, design doc §7.6). */
internal enum class ActionKind(val action: String) {
    MARK_READ("tools.obli.obliance.notifications.action.MARK_READ"),
    APPROVE("tools.obli.obliance.notifications.action.APPROVE"),
    REFUSE("tools.obli.obliance.notifications.action.REFUSE"),
    ;

    companion object {
        fun of(action: String?): ActionKind? = entries.firstOrNull { it.action == action }
    }
}

/** The item a broadcast action is about; always sent to [serverId]'s own session. */
internal data class ActionTarget(
    val serverId: ServerId,
    val notificationId: Int,
    val alertId: Long? = null,
    val deviceId: Long? = null,
    val tenantId: Long? = null,
    val label: String? = null,
)

internal sealed interface PlannedAction {
    val label: String

    /** Opens the app on [route] (activity PendingIntent). */
    data class Open(override val label: String, val route: NotificationRoute) : PlannedAction

    /** Handled in the background by NotificationActionReceiver. */
    data class Broadcast(override val label: String, val kind: ActionKind, val target: ActionTarget) : PlannedAction
}

/** Server identity drawn as the large icon (from two servers). */
internal data class TileSpec(val color: ServerColor, val monogram: String)

/**
 * One notification as the engine decided it, with every text resolved.
 * [NotificationPublisher] turns it into an Android notification (tag =
 * server id, group = `server.<id>`).
 */
internal data class PlannedNotification(
    val serverId: ServerId,
    val id: Int,
    val channel: NotifChannel,
    val title: String,
    val text: String,
    val subText: String?,
    /** Lock-screen version (VISIBILITY_PRIVATE): never a host name. */
    val publicTitle: String,
    val content: NotificationRoute,
    val actions: List<PlannedAction> = emptyList(),
    val whenMs: Long? = null,
    val silent: Boolean = false,
    val onlyAlertOnce: Boolean = true,
    val largeIcon: TileSpec? = null,
    /** Group summary: InboxStyle [summaryLines]. */
    val summary: Boolean = false,
    val summaryLines: List<String> = emptyList(),
    val category: String? = null,
)

/** Stable notification ids: hash(serverId, kind, item) folded into 0x40000000..0x7FFFFFFF. */
internal object NotificationIds {
    fun of(serverId: ServerId, kind: String, item: String): Int {
        val crc = CRC32()
        crc.update("${serverId.value}|$kind|$item".toByteArray(Charsets.UTF_8))
        return 0x40000000 or (crc.value.toInt() and 0x3FFFFFFF)
    }

    fun alert(serverId: ServerId, alertId: Long) = of(serverId, "alert", alertId.toString())
    fun approval(serverId: ServerId, approvalId: Long) = of(serverId, "approval", approvalId.toString())
    fun enrolment(serverId: ServerId, deviceId: Long) = of(serverId, "enrolment", deviceId.toString())

    /** « N appareils en attente » of that server (the rest of a burst). */
    fun enrolmentsMore(serverId: ServerId) = of(serverId, "enrolments", "more")

    /** « N demandes d'approbation en attente » of that server. */
    fun approvalsMore(serverId: ServerId) = of(serverId, "approvals", "more")
    fun expired(serverId: ServerId) = of(serverId, "account", "expired")
    fun summary(serverId: ServerId) = of(serverId, "summary", "0")
    fun test(serverId: ServerId) = of(serverId, "test", "0")
}

/** Kind of an alert notification. */
internal enum class AlertKind { CRITICAL, WARNING, RECOVERY }

/** Every text of the notifications, from the module's resources (English / French). */
internal class NotificationTexts(private val res: Resources, private val zone: ZoneId = ZoneId.systemDefault()) {
    private val hhmm: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    fun time(epochMs: Long): String = hhmm.format(Instant.ofEpochMilli(epochMs).atZone(zone))

    fun severity(kind: AlertKind): String = res.getString(
        when (kind) {
            AlertKind.CRITICAL -> R.string.notif_severity_critical
            AlertKind.WARNING -> R.string.notif_severity_warning
            AlertKind.RECOVERY -> R.string.notif_severity_recovered
        },
    )

    /**
     * "CRITIQUE · ACME — PC-COMPTA-03" with one server, "CRITIQUE · Obliance
     * Qual › Default — SRV-QUAL01" from two (design doc §2.10, §9).
     */
    fun alertTitle(kind: AlertKind, server: String?, tenant: String?, device: String): String {
        val scope = listOfNotNull(server?.takeIf { it.isNotBlank() }, tenant?.takeIf { it.isNotBlank() }).joinToString(" › ")
        val gravity = severity(kind)
        return if (scope.isEmpty()) "$gravity — $device" else "$gravity · $scope — $device"
    }

    /** "Hors ligne : aucun push reçu depuis 5 min." / "Offline: no push received for 5 min." */
    fun alertText(category: AlertCategory, kind: AlertKind, message: String, title: String): String {
        val label = when (category) {
            AlertCategory.OFFLINE -> R.string.notif_category_offline
            AlertCategory.METRIC -> if (kind == AlertKind.CRITICAL) R.string.notif_category_metric_critical else R.string.notif_category_metric
            AlertCategory.DISK_HEALTH -> R.string.notif_category_disk_health
            AlertCategory.IDENTITY -> R.string.notif_category_identity
            AlertCategory.RECOVERY -> R.string.notif_category_recovery
            AlertCategory.OTHER -> null
        }
        val body = message.trim().ifEmpty { title.trim() }
        return if (label == null) body else res.getString(R.string.notif_text_format, res.getString(label), lowerFirst(body))
    }

    fun recoveredAt(epochMs: Long): String = res.getString(R.string.notif_recovered_at, time(epochMs))

    fun publicAlert(kind: AlertKind, tenant: String?): String {
        val t = tenant?.takeIf { it.isNotBlank() }
        return when (kind) {
            AlertKind.CRITICAL -> if (t != null) res.getString(R.string.notif_public_critical, t) else res.getString(R.string.notif_public_critical_bare)
            AlertKind.WARNING -> if (t != null) res.getString(R.string.notif_public_warning, t) else res.getString(R.string.notif_public_warning_bare)
            AlertKind.RECOVERY -> if (t != null) res.getString(R.string.notif_public_recovery, t) else res.getString(R.string.notif_public_recovery_bare)
        }
    }

    fun subText(server: String?, tenant: String?): String? =
        listOfNotNull(server?.takeIf { it.isNotBlank() }, tenant?.takeIf { it.isNotBlank() }).joinToString(" · ").ifEmpty { null }

    fun string(id: Int, vararg args: Any): String = res.getString(id, *args)

    fun plural(id: Int, count: Int, vararg args: Any): String = res.getQuantityString(id, count, *args)

    fun approvalType(requestType: String): String = res.getString(
        when (requestType) {
            "batch_command" -> R.string.notif_approval_type_batch
            "device_uninstall" -> R.string.notif_approval_type_uninstall
            "setting_change" -> R.string.notif_approval_type_setting
            else -> R.string.notif_approval_type_other
        },
    )

    companion object {
        /** "Aucun push reçu…" → "aucun push reçu…" after a label; "CPU 98 %" stays. */
        fun lowerFirst(s: String): String =
            if (s.length >= 2 && s[0].isUpperCase() && s[1].isLowerCase()) s[0].lowercaseChar() + s.substring(1) else s

        /** ISO-8601 (`2026-09-25T01:12:04.000Z`, or with an offset) → epoch ms. */
        fun parseTime(raw: String?): Long? {
            val s = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            return runCatching { Instant.parse(s).toEpochMilli() }.getOrNull()
                ?: runCatching { OffsetDateTime.parse(s.replace(' ', 'T')).toInstant().toEpochMilli() }.getOrNull()
        }
    }
}
