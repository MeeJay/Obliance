package tools.obli.obliance.notifications

import androidx.core.app.NotificationCompat
import tools.obli.core.model.ServerProfile
import tools.obli.obliance.api.Approval
import tools.obli.obliance.api.Device
import tools.obli.obliance.domain.AlertClassification
import tools.obli.obliance.domain.QuickAction
import tools.obli.shell.alerts.LiveAlert

/**
 * The content of every notification of the module (design doc §2.10, §9;
 * mockup Notifications.dc.html). With two servers or more the server name
 * prefixes the scope ("CRITIQUE · Obliance Qual › Default — SRV-QUAL01"), is
 * the sub-text and its tile is the large icon.
 */
internal class NotificationFactory(private val texts: NotificationTexts) {

    private fun serverName(profile: ServerProfile, multi: Boolean): String? = if (multi) profile.displayName else null

    private fun tile(profile: ServerProfile, multi: Boolean): TileSpec? = if (multi) TileSpec(profile.color, profile.monogram) else null

    private fun tenantOf(alert: LiveAlert, tenants: Map<Long, String>): String? =
        alert.tenantName?.takeIf { it.isNotBlank() } ?: alert.tenantId?.let { tenants[it] }

    private fun deviceOf(alert: LiveAlert, c: AlertClassification): String = c.deviceName?.takeIf { it.isNotBlank() } ?: alert.title

    fun alertRoute(profile: ServerProfile, alert: LiveAlert, c: AlertClassification): NotificationRoute =
        NotificationRoutes.fromNavigateTo(profile.id, profile.origin, alert.navigateTo, alert.tenantId, deviceOf(alert, c))

    /** Critical-class or attention alert: "Ouvrir" · ["Processus"] · "Marquer lu". */
    fun alert(
        profile: ServerProfile,
        multi: Boolean,
        alert: LiveAlert,
        c: AlertClassification,
        kind: AlertKind,
        tenants: Map<Long, String>,
        silent: Boolean,
        onlyAlertOnce: Boolean = true,
    ): PlannedNotification {
        val id = NotificationIds.alert(profile.id, alert.id)
        val tenant = tenantOf(alert, tenants)
        val device = deviceOf(alert, c)
        val route = alertRoute(profile, alert, c)
        val server = serverName(profile, multi)
        val actions = buildList {
            add(PlannedAction.Open(texts.string(R.string.notif_action_open), route))
            if (kind == AlertKind.CRITICAL && c.quickAction == QuickAction.PROCESSES && route is NotificationRoute.Device) {
                add(PlannedAction.Open(texts.string(R.string.notif_action_processes), route.copy(tab = TAB_PROCESSES)))
            }
            add(
                PlannedAction.Broadcast(
                    texts.string(R.string.notif_action_mark_read),
                    ActionKind.MARK_READ,
                    ActionTarget(profile.id, id, alertId = alert.id, deviceId = NotificationRoutes.deviceIdOf(alert.navigateTo), tenantId = alert.tenantId, label = device),
                ),
            )
        }
        return PlannedNotification(
            serverId = profile.id,
            id = id,
            channel = if (kind == AlertKind.CRITICAL) NotifChannel.CRITICAL else NotifChannel.ATTENTION,
            title = texts.alertTitle(kind, server, tenant, device),
            text = texts.alertText(c.category, kind, alert.message, alert.title),
            subText = texts.subText(server, tenant),
            publicTitle = texts.publicAlert(kind, tenant),
            content = route,
            actions = actions,
            whenMs = NotificationTexts.parseTime(alert.createdAt),
            silent = silent,
            onlyAlertOnce = onlyAlertOnce,
            largeIcon = tile(profile, multi),
            category = if (kind == AlertKind.CRITICAL) NotificationCompat.CATEGORY_ERROR else NotificationCompat.CATEGORY_STATUS,
        )
    }

    /**
     * A recovery ("SRV-AD2: De retour en ligne"). [original] set: it REPLACES
     * that device's earlier notification (same id), silently, with
     * "Rétabli à HH:mm" (design doc §9 #1); otherwise a new silent one.
     */
    fun recovery(
        profile: ServerProfile,
        multi: Boolean,
        recovery: LiveAlert,
        c: AlertClassification,
        tenants: Map<Long, String>,
        original: LiveAlert?,
        originalId: Long?,
    ): PlannedNotification {
        val tenant = tenantOf(recovery, tenants) ?: original?.let { tenantOf(it, tenants) }
        val device = deviceOf(recovery, c)
        val server = serverName(profile, multi)
        val at = NotificationTexts.parseTime(recovery.createdAt)
        val recovered = at?.let(texts::recoveredAt)
        val message = recovery.message.trim()
        val text = listOfNotNull(recovered, message.takeIf { it.isNotEmpty() }).joinToString(" · ").ifEmpty { recovery.title }
        val route = NotificationRoutes.fromNavigateTo(
            profile.id, profile.origin, original?.navigateTo ?: recovery.navigateTo, recovery.tenantId ?: original?.tenantId, device,
        )
        return PlannedNotification(
            serverId = profile.id,
            id = NotificationIds.alert(profile.id, originalId ?: recovery.id),
            channel = NotifChannel.RECOVERY,
            title = texts.alertTitle(AlertKind.RECOVERY, server, tenant, device),
            text = text,
            subText = texts.subText(server, tenant),
            publicTitle = texts.publicAlert(AlertKind.RECOVERY, tenant),
            content = route,
            whenMs = at,
            silent = true,
            largeIcon = tile(profile, multi),
            category = NotificationCompat.CATEGORY_STATUS,
        )
    }

    /** "Session expirée sur Obliance Qual" · "Se reconnecter", once per server (§2.10 item 5). */
    fun expired(profile: ServerProfile, multi: Boolean, now: Long): PlannedNotification {
        val route = NotificationRoute.SignIn(profile.id)
        return PlannedNotification(
            serverId = profile.id,
            id = NotificationIds.expired(profile.id),
            channel = NotifChannel.ACCOUNT,
            title = texts.string(R.string.notif_expired_title, profile.displayName),
            text = texts.string(R.string.notif_expired_text),
            subText = serverName(profile, multi),
            publicTitle = texts.string(R.string.notif_public_expired),
            content = route,
            actions = listOf(PlannedAction.Open(texts.string(R.string.notif_action_sign_in), route)),
            whenMs = now,
            largeIcon = tile(profile, multi),
            category = NotificationCompat.CATEGORY_STATUS,
        )
    }

    /** Two-person approval: ONE action "Examiner", never approve or deny from a notification (§7.6). */
    fun approval(profile: ServerProfile, multi: Boolean, approval: Approval, tenants: Map<Long, String>, silent: Boolean): PlannedNotification {
        val tenant = approval.tenantId?.let { tenants[it] }
        val what = approval.description.trim().ifEmpty { texts.approvalType(approval.requestType) }
        val expires = NotificationTexts.parseTime(approval.expiresAt)
        val text = listOfNotNull(
            approval.requestedByName?.takeIf { it.isNotBlank() }?.let { texts.string(R.string.notif_approval_by, it) },
            tenant,
            expires?.let { texts.string(R.string.notif_approval_expires, texts.time(it)) },
        ).joinToString(" · ")
        val route = NotificationRoute.Approval(profile.id, approval.id, approval.tenantId)
        return PlannedNotification(
            serverId = profile.id,
            id = NotificationIds.approval(profile.id, approval.id),
            channel = NotifChannel.ESCALATIONS,
            title = texts.string(R.string.notif_approval_title, what),
            text = text,
            subText = serverName(profile, multi),
            publicTitle = texts.string(R.string.notif_public_approval),
            content = route,
            actions = listOf(PlannedAction.Open(texts.string(R.string.notif_action_review), route)),
            whenMs = NotificationTexts.parseTime(approval.createdAt),
            silent = silent,
            largeIcon = tile(profile, multi),
            category = NotificationCompat.CATEGORY_REMINDER,
        )
    }

    /**
     * A device waiting for approval. "Approuver" / "Refuser" (T1, device
     * authentication) only when it belongs to the SESSION tenant: the server
     * scopes approve and refuse to it. Otherwise "Examiner" opens S12.
     */
    fun enrolment(profile: ServerProfile, multi: Boolean, device: Device, sessionTenantId: Long?, tenants: Map<Long, String>, silent: Boolean): PlannedNotification {
        val id = NotificationIds.enrolment(profile.id, device.id)
        val tenant = device.tenantName?.takeIf { it.isNotBlank() } ?: device.tenantId?.let { tenants[it] }
        val route = NotificationRoute.Enrolment(profile.id, device.id, device.tenantId, device.label)
        val actions = if (device.tenantId != null && device.tenantId == sessionTenantId) {
            val target = ActionTarget(profile.id, id, deviceId = device.id, tenantId = device.tenantId, label = device.label)
            listOf(
                PlannedAction.Broadcast(texts.string(R.string.notif_action_approve), ActionKind.APPROVE, target),
                PlannedAction.Broadcast(texts.string(R.string.notif_action_refuse), ActionKind.REFUSE, target),
            )
        } else {
            listOf(PlannedAction.Open(texts.string(R.string.notif_action_review), route))
        }
        return PlannedNotification(
            serverId = profile.id,
            id = id,
            channel = NotifChannel.ENROLMENTS,
            title = texts.string(R.string.notif_enrolment_title),
            text = listOfNotNull(device.label, device.osName, device.ipLocal).filter { it.isNotBlank() }.joinToString(" · "),
            subText = texts.subText(serverName(profile, multi), tenant),
            publicTitle = texts.string(R.string.notif_public_enrolment),
            content = route,
            actions = actions,
            whenMs = NotificationTexts.parseTime(device.createdAt),
            silent = silent,
            largeIcon = tile(profile, multi),
            category = NotificationCompat.CATEGORY_STATUS,
        )
    }

    /** What an enrolment action left: "KIOSK-ACCUEIL-02 approuvé", or "Ouvrez Obliance pour terminer". */
    fun enrolmentResult(profile: ServerProfile, multi: Boolean, target: ActionTarget, label: String, outcome: ActionKind?, tenant: String?): PlannedNotification {
        val route = NotificationRoute.Enrolment(profile.id, target.deviceId ?: 0, target.tenantId, label)
        val title = when (outcome) {
            ActionKind.APPROVE -> texts.string(R.string.notif_enrolment_approved, label)
            ActionKind.REFUSE -> texts.string(R.string.notif_enrolment_refused, label)
            else -> texts.string(R.string.notif_enrolment_open_app)
        }
        val text = if (outcome == null) texts.string(R.string.notif_enrolment_failed_text, label) else ""
        return PlannedNotification(
            serverId = profile.id,
            id = target.notificationId,
            channel = NotifChannel.ENROLMENTS,
            title = title,
            text = text,
            subText = texts.subText(serverName(profile, multi), tenant),
            publicTitle = texts.string(R.string.notif_public_enrolment),
            content = if (outcome == null) route else NotificationRoute.Inbox(profile.id),
            silent = true,
            largeIcon = tile(profile, multi),
            category = NotificationCompat.CATEGORY_STATUS,
        )
    }

    /** One summary per server: lines per tenant ("ACME · 5 alertes") and the overflow ("+4 autres"). */
    fun summary(profile: ServerProfile, multi: Boolean, perTenant: List<Pair<String, Int>>, total: Int, overflow: Int): PlannedNotification {
        val lines = perTenant.map { (tenant, count) -> texts.plural(R.plurals.notif_summary_tenant, count, tenant, count) } +
            listOfNotNull(overflow.takeIf { it > 0 }?.let { texts.plural(R.plurals.notif_summary_overflow, it, it) })
        return PlannedNotification(
            serverId = profile.id,
            id = NotificationIds.summary(profile.id),
            channel = NotifChannel.ATTENTION,
            title = profile.displayName,
            text = if (total > 0) texts.plural(R.plurals.notif_summary_count, total, total) else profile.displayName,
            subText = serverName(profile, multi),
            publicTitle = texts.string(R.string.notif_public_summary),
            content = NotificationRoute.Inbox(profile.id),
            silent = true,
            largeIcon = tile(profile, multi),
            summary = true,
            summaryLines = lines,
        )
    }

    /** S84 "Envoyer une notification de test" (attention channel of the active server). */
    fun test(profile: ServerProfile, multi: Boolean, now: Long): PlannedNotification = PlannedNotification(
        serverId = profile.id,
        id = NotificationIds.test(profile.id),
        channel = NotifChannel.ATTENTION,
        title = texts.string(R.string.notif_test_title, profile.displayName),
        text = texts.string(R.string.notif_test_text),
        subText = serverName(profile, multi),
        publicTitle = texts.string(R.string.notif_public_summary),
        content = NotificationRoute.Inbox(profile.id),
        whenMs = now,
        onlyAlertOnce = false,
        largeIcon = tile(profile, multi),
    )

    companion object {
        const val TAB_PROCESSES = "processes"
    }
}
