package tools.obli.shell.notify

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import tools.obli.shell.MainActivity
import tools.obli.shell.R
import tools.obli.shell.alerts.AlertSeverity

/** Notification channels and posting helpers. */
object Notifications {
    /** Bridge notify() — the contract's « alertes » channel. */
    const val CH_ALERTS = "alerts"
    const val CH_CRITICAL = "alerts_critical"
    const val CH_WARNING = "alerts_warning"
    const val CH_INFO = "alerts_info"
    const val CH_DOWNLOADS = "downloads"
    const val CH_UPDATES = "updates"
    const val CH_SESSION = "session"

    const val GROUP_ALERTS = "tools.obli.shell.ALERTS"

    const val ID_SIGN_IN = 1001
    const val ID_UPDATE = 1002
    const val ID_ALERT_SUMMARY = 1003

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        fun ch(id: String, name: Int, importance: Int, desc: Int) =
            NotificationChannel(id, context.getString(name), importance).apply {
                description = context.getString(desc)
            }
        nm.createNotificationChannels(
            listOf(
                ch(CH_ALERTS, R.string.channel_alerts, NotificationManager.IMPORTANCE_DEFAULT, R.string.channel_alerts_desc),
                ch(CH_CRITICAL, R.string.channel_critical, NotificationManager.IMPORTANCE_HIGH, R.string.channel_critical_desc),
                ch(CH_WARNING, R.string.channel_warning, NotificationManager.IMPORTANCE_DEFAULT, R.string.channel_warning_desc),
                ch(CH_INFO, R.string.channel_info, NotificationManager.IMPORTANCE_LOW, R.string.channel_info_desc),
                ch(CH_DOWNLOADS, R.string.channel_downloads, NotificationManager.IMPORTANCE_LOW, R.string.channel_downloads_desc),
                ch(CH_UPDATES, R.string.channel_updates, NotificationManager.IMPORTANCE_DEFAULT, R.string.channel_updates_desc),
                ch(CH_SESSION, R.string.channel_session, NotificationManager.IMPORTANCE_DEFAULT, R.string.channel_session_desc),
            ),
        )
    }

    fun channelFor(severity: AlertSeverity): String = when (severity) {
        AlertSeverity.CRITICAL -> CH_CRITICAL
        AlertSeverity.WARNING -> CH_WARNING
        AlertSeverity.INFO -> CH_INFO
    }

    fun permissionGranted(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun canPost(context: Context): Boolean =
        permissionGranted(context) && NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** Posts [n] when allowed; returns false (silently) otherwise. */
    @SuppressLint("MissingPermission") // checked by canPost() just above
    fun post(context: Context, id: Int, n: Notification): Boolean {
        if (!canPost(context)) return false
        return try {
            NotificationManagerCompat.from(context).notify(id, n)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    fun cancel(context: Context, id: Int) = NotificationManagerCompat.from(context).cancel(id)

    /** Opens the app, optionally on a same-origin path of the server. */
    fun openAppIntent(context: Context, requestCode: Int, navigateTo: String?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = MainActivity.ACTION_OPEN
            if (navigateTo != null) putExtra(MainActivity.EXTRA_NAVIGATE_TO, navigateTo)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        return PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    fun builder(context: Context, channel: String): NotificationCompat.Builder =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.obli_accent))
            .setAutoCancel(true)
}
