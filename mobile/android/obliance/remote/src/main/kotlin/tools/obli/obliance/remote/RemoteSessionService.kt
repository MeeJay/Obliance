package tools.obli.obliance.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground service (`specialUse`) that keeps the process — hence the
 * tunnels of the [SessionManager] — alive while remote sessions are open and
 * the app is in the background (design doc §2.6, §10.9). Its persistent
 * notification reads « 2 sessions actives — PowerShell PC-COMPTA-03, SSH 140 »
 * with **Tout terminer**. It stops itself when no session is live.
 */
class RemoteSessionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var watch: Job? = null
    private var foreground = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Always honour the startForegroundService() contract first.
        goForeground(SessionManager.live.value)
        if (intent?.action == ACTION_END_ALL) SessionManager.terminateAll()
        if (watch == null) {
            watch = scope.launch {
                SessionManager.live.collect { list ->
                    if (list.isEmpty()) {
                        ServiceCompat.stopForeground(this@RemoteSessionService, ServiceCompat.STOP_FOREGROUND_REMOVE)
                        foreground = false
                        stopSelf()
                    } else {
                        goForeground(list)
                    }
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun goForeground(list: List<RemoteEntry>) {
        val notification = notification(this, list)
        if (!foreground) {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
            foreground = true
        } else {
            getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "remote_sessions"
        private const val NOTIFICATION_ID = 6060
        private const val ACTION_END_ALL = "tools.obli.obliance.remote.END_ALL"

        /** Extra of the launch intent: the session to resume (`RemoteSessionRef.id`). */
        const val EXTRA_SESSION_ID = "tools.obli.obliance.remote.SESSION_ID"

        internal fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, RemoteSessionService::class.java))
            } catch (_: RuntimeException) {
                // Background start refused (ForegroundServiceStartNotAllowedException): the
                // session still works while the app is in front.
            }
        }

        internal fun notification(context: Context, list: List<RemoteEntry>): Notification {
            ensureChannel(context)
            val res = context.resources
            val count = list.size.coerceAtLeast(1)
            val names = list.joinToString(", ") { "${protocolLabel(context, it.protocol)} ${it.deviceLabel}" }
            val title = res.getQuantityString(R.plurals.remote_notification_title, count, count)
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                list.firstOrNull()?.let { putExtra(EXTRA_SESSION_ID, it.id) }
            }
            val content = launch?.let {
                PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            }
            val endAll = PendingIntent.getService(
                context, 1,
                Intent(context, RemoteSessionService::class.java).setAction(ACTION_END_ALL),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val action = NotificationCompat.Action.Builder(0, context.getString(R.string.remote_notification_end_all), endAll)
                // T1 from a notification: only once the device is unlocked (design doc §7.6).
                .setAuthenticationRequired(true)
                .build()
            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.remote_ic_terminal)
                .setContentTitle(title)
                .setContentText(names)
                .setStyle(NotificationCompat.BigTextStyle().bigText(names))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .apply { content?.let(::setContentIntent) }
                .addAction(action)
                .build()
        }

        private fun ensureChannel(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            if (nm.getNotificationChannel(CHANNEL_ID) != null) return
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, context.getString(R.string.remote_notification_channel), NotificationManager.IMPORTANCE_LOW).apply {
                    description = context.getString(R.string.remote_notification_channel_description)
                    setShowBadge(false)
                },
            )
        }
    }
}

/** « PowerShell », « CMD », « SSH », « ObliReach ». */
internal fun protocolLabel(context: Context, protocol: String): String = context.getString(
    when (protocol) {
        "powershell" -> R.string.remote_protocol_powershell
        "cmd" -> R.string.remote_protocol_cmd
        "ssh" -> R.string.remote_protocol_ssh
        else -> R.string.remote_protocol_oblireach
    },
)
