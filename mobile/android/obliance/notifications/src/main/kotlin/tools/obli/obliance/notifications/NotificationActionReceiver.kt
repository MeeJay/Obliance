package tools.obli.obliance.notifications

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerSession
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.AlertsApi
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DevicesApi

/**
 * "Marquer lu" (T0) and "Approuver" / "Refuser" an enrolment (T1) from a
 * notification (design doc §7.6, §10.8). On Android 12+ Android already asked
 * for the device credential (`setAuthenticationRequired`). Before API 31 that
 * flag does nothing: an action tapped on the lock screen of a locked phone is
 * NOT sent (see [NotificationActions.handle]). Each call goes to the ITEM's
 * server session only; nothing is ever replayed.
 */
internal class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending: PendingResult? = goAsync()
        val app = context.applicationContext
        scope.launch {
            try {
                withTimeoutOrNull(TIMEOUT_MS) { NotificationActions.handle(app, intent) }
            } finally {
                pending?.finish()
            }
        }
    }

    companion object {
        /** A broadcast receiver has 10 s (goAsync) before Android considers it stuck. */
        const val TIMEOUT_MS = 9_500L
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }
}

internal object NotificationActions {
    private const val STATE_TIMEOUT_MS = 2_000L

    /** Handles one action intent; false when nothing could be done. */
    suspend fun handle(context: Context, intent: Intent): Boolean {
        val rt = ObliNotifications.runtime ?: return false
        val kind = ActionKind.of(intent.action) ?: return false
        val target = ActionExtras.read(intent) ?: return false
        if (!rt.awaitReady(STATE_TIMEOUT_MS)) return false
        val profile = rt.services.registry.state.value.byId(target.serverId) ?: return false
        val session = rt.services.sessions.session(target.serverId) ?: return false
        if (lockedWithoutAuthentication(context)) {
            // Android 8-11 ran the action from the lock screen, no unlock asked: nothing is sent.
            // An enrolment says « Ouvrez Obliance pour terminer » (opening S12 asks for the unlock);
            // « Marquer lu » leaves the alert as it is.
            if (kind != ActionKind.MARK_READ) {
                val multi = rt.services.registry.state.value.isMultiServer
                rt.publisher.post(NotificationFactory(rt.texts()).enrolmentResult(profile, multi, target, target.label ?: "", null, null))
                updateState(rt, target.serverId) { s -> s.copy(postedEnrolments = s.postedEnrolments - (target.deviceId ?: -1)) }
            }
            return false
        }
        return when (kind) {
            ActionKind.MARK_READ -> markRead(rt, session, target)
            ActionKind.APPROVE, ActionKind.REFUSE -> {
                val done = enrolment(session, target, kind)
                val factory = NotificationFactory(rt.texts())
                val multi = rt.services.registry.state.value.isMultiServer
                val label = done?.label ?: target.label ?: ""
                val tenant = done?.tenantName
                rt.publisher.post(factory.enrolmentResult(profile, multi, target, label, if (done != null) kind else null, tenant))
                // The pass must neither cancel the result nor post the device again.
                updateState(rt, target.serverId) { s -> s.copy(postedEnrolments = s.postedEnrolments - (target.deviceId ?: -1)) }
                done != null
            }
        }
    }

    /** `PATCH /api/live-alerts/:id/read` on the alert's own server, then the notification goes. */
    private suspend fun markRead(rt: NotificationRuntime, session: ServerSession, target: ActionTarget): Boolean {
        val alertId = target.alertId ?: return false
        return when (val out = AlertsApi(session.http).markRead(alertId)) {
            is ApiOutcome.Ok -> {
                rt.publisher.cancel(target.serverId, target.notificationId)
                rt.work.cancelReminder(target.serverId, alertId)
                updateState(rt, target.serverId) { s -> s.copy(postedAlerts = s.postedAlerts.filterNot { it.alertId == alertId }) }
                dropSummaryIfAlone(rt, target.serverId)
                true
            }
            ApiOutcome.SessionExpired -> false.also { session.markExpired() }
            // Offline or refused: the notification stays, the user can try again.
            else -> false
        }
    }

    /**
     * Enrolment T1: re-checks that the device is still pending and in the
     * SESSION tenant (the server scopes approve and refuse to it), then
     * `POST /api/devices/:id/approve|refuse`. Success only when the answer says
     * `approved` / `refused`; the device (as the server returned it) or null.
     */
    private suspend fun enrolment(session: ServerSession, target: ActionTarget, kind: ActionKind): Device? {
        val deviceId = target.deviceId ?: return null
        val device = when (val out = DevicesApi(session.http).detail(deviceId)) {
            is ApiOutcome.Ok -> out.value
            ApiOutcome.SessionExpired -> return null.also { session.markExpired() }
            else -> return null
        }
        if (device.approvalStatus != "pending") return null
        val sessionTenant = ((session.auth.value as? AuthState.SignedIn) ?: (session.probe() as? AuthState.SignedIn))?.probe?.currentTenantId
        if (device.tenantId == null || device.tenantId != sessionTenant) return null
        val verb = if (kind == ActionKind.APPROVE) "approve" else "refuse"
        val expected = if (kind == ActionKind.APPROVE) "approved" else "refused"
        val out = session.http.call(ObliHttp.Method.POST, "/api/devices/$deviceId/$verb", decode = ApiJson.unwrapped(Device.serializer()))
        if (out == ApiOutcome.SessionExpired) session.markExpired()
        val result = (out as? ApiOutcome.Ok)?.value ?: return null
        return result.takeIf { it.approvalStatus == expected }
    }

    /**
     * Before API 31 `setAuthenticationRequired` is ignored: a broadcast action
     * runs on a locked phone. True then (and when the keyguard cannot be read:
     * fail closed); always false from API 31, where Android asked for the unlock.
     */
    internal fun lockedWithoutAuthentication(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return false
        val keyguard = context.getSystemService(KeyguardManager::class.java) ?: return true
        return keyguard.isDeviceLocked
    }

    private suspend fun updateState(rt: NotificationRuntime, serverId: ServerId, change: (ServerNotifState) -> ServerNotifState) {
        // Under the pass lock, but never longer than the receiver may run.
        withTimeoutOrNull(STATE_TIMEOUT_MS) { PassLock.mutex.withLock { rt.store.updateServer(serverId, change) } }
    }

    private fun dropSummaryIfAlone(rt: NotificationRuntime, serverId: ServerId) {
        val summary = NotificationIds.summary(serverId)
        if ((rt.publisher.activeIds(serverId) - summary).isEmpty()) rt.publisher.cancel(serverId, summary)
    }
}
