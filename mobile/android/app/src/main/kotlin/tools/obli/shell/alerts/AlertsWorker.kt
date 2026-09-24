package tools.obli.shell.alerts

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import tools.obli.shell.BuildConfig
import tools.obli.shell.R
import tools.obli.shell.Shell
import tools.obli.shell.bridge.BridgeValidators
import tools.obli.shell.nav.Origins
import tools.obli.shell.net.Http
import tools.obli.shell.notify.Notifications

/** Keeps the periodic background poll in line with the settings. */
object AlertScheduler {
    private const val WORK_NAME = "obli-live-alerts"

    fun sync(context: Context) {
        val prefs = Shell.prefs
        val wm = WorkManager.getInstance(context)
        if (!prefs.alertsEnabled || prefs.serverUrl == null) {
            wm.cancelUniqueWork(WORK_NAME)
            return
        }
        val request = PeriodicWorkRequestBuilder<AlertsWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
            .build()
        wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }
}

/**
 * Background catch-up of live alerts (contract §7): GET /api/live-alerts/all
 * with the WebView session cookie, notify what is newer than the high-water
 * mark. A 401 posts ONE "sign in again" notification and pauses polling until
 * the app is opened.
 */
class AlertsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = Shell.prefs
        if (!prefs.alertsEnabled || prefs.alertsPausedForAuth) return Result.success()
        val server = prefs.serverUrl ?: return Result.success()
        val origin = Origins.of(server) ?: return Result.success()

        val cookie = Http.webViewCookie(server)
        if (cookie == null) {
            signInRequired()
            return Result.success()
        }

        return when (val r = Http.get("$server/api/live-alerts/all", withCookies = true)) {
            is Http.Result.Error -> Result.retry()
            is Http.Result.Response -> when {
                r.code == 401 || r.code == 403 -> { signInRequired(); Result.success() }
                r.code != 200 -> if (r.code >= 500) Result.retry() else Result.success()
                else -> {
                    val alerts = LiveAlerts.parse(r.body) ?: return Result.retry()
                    // The server may have been changed while this ran.
                    if (prefs.serverUrl != server) return Result.success()
                    val result = LiveAlerts.process(alerts, prefs.alertsHighWater, MAX_PER_RUN)
                    result.toNotify.forEach { notify(it, origin) }
                    if (result.overflow > 0) notifyOverflow(result.overflow)
                    prefs.alertsHighWater = result.newHighWater
                    Result.success()
                }
            }
        }
    }

    private fun notify(alert: LiveAlert, origin: String) {
        val ctx = applicationContext
        val navigateTo = BridgeValidators.navigateTo(alert.navigateTo, origin)?.removePrefix(origin)
        val n = Notifications.builder(ctx, Notifications.channelFor(alert.severity))
            .setContentTitle(alert.title.ifBlank { ctx.getString(R.string.alert_untitled) })
            .setContentText(alert.message)
            .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(alert.message))
            .setSubText(alert.tenantName)
            .setGroup(Notifications.GROUP_ALERTS)
            .setContentIntent(Notifications.openAppIntent(ctx, (alert.id % Int.MAX_VALUE).toInt(), navigateTo))
            .build()
        Notifications.post(ctx, notificationId(alert.id), n)
    }

    private fun notifyOverflow(count: Int) {
        val ctx = applicationContext
        val text = ctx.resources.getQuantityString(R.plurals.alert_overflow, count, count)
        val n = Notifications.builder(ctx, Notifications.CH_INFO)
            .setContentTitle(ctx.getString(R.string.app_name))
            .setContentText(text)
            .setGroup(Notifications.GROUP_ALERTS)
            .setContentIntent(Notifications.openAppIntent(ctx, Notifications.ID_ALERT_SUMMARY, null))
            .build()
        Notifications.post(ctx, Notifications.ID_ALERT_SUMMARY, n)
    }

    private fun signInRequired() {
        val ctx = applicationContext
        Shell.prefs.alertsPausedForAuth = true
        val n = Notifications.builder(ctx, Notifications.CH_SESSION)
            .setContentTitle(ctx.getString(R.string.signin_again_title))
            .setContentText(ctx.getString(R.string.signin_again_text))
            .setOnlyAlertOnce(true)
            .setContentIntent(Notifications.openAppIntent(ctx, Notifications.ID_SIGN_IN, null))
            .build()
        Notifications.post(ctx, Notifications.ID_SIGN_IN, n)
        if (BuildConfig.DEBUG) Log.d(TAG, "session expired: background alerts paused")
    }

    companion object {
        private const val TAG = "ObliAlerts"
        private const val MAX_PER_RUN = 5

        /** Stable, non-colliding with the fixed ids (1001..1003). */
        fun notificationId(alertId: Long): Int = 100_000 + (alertId % 1_000_000_000L).toInt()
    }
}
