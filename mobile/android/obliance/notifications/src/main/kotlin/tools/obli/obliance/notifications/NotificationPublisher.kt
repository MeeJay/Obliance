package tools.obli.obliance.notifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.createBitmap
import tools.obli.core.model.ServerId

/** Posts and cancels the notifications of the engine (tag = server id). */
internal interface NotificationPublisher {
    /** POST_NOTIFICATIONS granted (Android 13+) and notifications enabled for the app. */
    fun canPost(): Boolean

    /** False when nothing was posted (not allowed). */
    fun post(n: PlannedNotification): Boolean

    fun cancel(serverId: ServerId, id: Int)

    /** Every notification of that server, summary included. */
    fun cancelAll(serverId: ServerId)

    /** Ids currently on screen for that server. */
    fun activeIds(serverId: ServerId): Set<Int>

    fun isShown(serverId: ServerId, id: Int): Boolean = id in activeIds(serverId)
}

internal class AndroidNotificationPublisher(
    private val context: Context,
    private val launchIntent: (Context) -> Intent,
) : NotificationPublisher {
    private val manager get() = NotificationManagerCompat.from(context)

    override fun canPost(): Boolean = permissionGranted(context) && manager.areNotificationsEnabled()

    @SuppressLint("MissingPermission") // canPost() checks POST_NOTIFICATIONS just before.
    override fun post(n: PlannedNotification): Boolean {
        if (!canPost()) return false
        return try {
            manager.notify(n.serverId.value, n.id, build(n))
            true
        } catch (_: SecurityException) {
            false
        }
    }

    override fun cancel(serverId: ServerId, id: Int) = manager.cancel(serverId.value, id)

    override fun cancelAll(serverId: ServerId) {
        activeIds(serverId).forEach { cancel(serverId, it) }
    }

    override fun activeIds(serverId: ServerId): Set<Int> {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return emptySet()
        return runCatching { nm.activeNotifications }.getOrNull().orEmpty()
            .filter { it.tag == serverId.value }
            .map { it.id }
            .toSet()
    }

    internal fun build(n: PlannedNotification): Notification {
        val channel = n.channel.id(n.serverId)
        val public = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.notif_ic_stat)
            .setColor(BRAND)
            .setContentTitle(n.publicTitle)
            .build()
        val b = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.notif_ic_stat)
            .setColor(BRAND)
            .setContentTitle(n.title)
            .setContentText(n.text)
            .setSubText(n.subText)
            .setGroup(NotificationChannels.groupId(n.serverId))
            .setAutoCancel(true)
            .setOnlyAlertOnce(n.onlyAlertOnce)
            .setSilent(n.silent)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(public)
            .setContentIntent(openIntent(n.content, n.id, slot = 0))
            .addExtras(Bundle().apply { putBoolean(EXTRA_SILENT, n.silent) })
        n.category?.let(b::setCategory)
        if (n.whenMs != null) b.setWhen(n.whenMs).setShowWhen(true)
        n.largeIcon?.let { b.setLargeIcon(ServerTileBitmap.draw(context, it)) }
        if (n.summary) {
            val style = NotificationCompat.InboxStyle()
            n.summaryLines.forEach(style::addLine)
            b.setStyle(style).setGroupSummary(true).setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        } else {
            b.setStyle(NotificationCompat.BigTextStyle().bigText(n.text))
        }
        n.actions.forEachIndexed { index, action ->
            val slot = index + 1
            val pending = when (action) {
                is PlannedAction.Open -> openIntent(action.route, n.id, slot)
                is PlannedAction.Broadcast -> broadcastIntent(action, n.id, slot)
            }
            b.addAction(
                NotificationCompat.Action.Builder(0, action.label, pending)
                    // T0/T1 from a notification: only once the device is unlocked (design doc §7.6).
                    .setAuthenticationRequired(true)
                    .build(),
            )
        }
        return b.build()
    }

    /** Activity PendingIntent: explicit launch intent + ACTION_OPEN + the route extras. */
    private fun openIntent(route: NotificationRoute, id: Int, slot: Int): PendingIntent {
        val intent = launchIntent(context).apply {
            action = ObliNotifications.ACTION_OPEN
            // Distinct data per (notification, slot): PendingIntents ignore extras when comparing.
            data = uniqueUri("open", id, slot)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            RouteExtras.write(this, route)
        }
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun broadcastIntent(action: PlannedAction.Broadcast, id: Int, slot: Int): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java)
            .setAction(action.kind.action)
            .setData(uniqueUri("action", id, slot))
        ActionExtras.write(intent, action.target)
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    companion object {
        /** Brand red of the small icon tint (#E03A3A). */
        const val BRAND = 0xFFE03A3A.toInt()

        /** Marks a notification posted without sound (on-call SILENT, recoveries). */
        const val EXTRA_SILENT = "tools.obli.obliance.notifications.silent"

        fun permissionGranted(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        private fun uniqueUri(kind: String, id: Int, slot: Int): Uri =
            Uri.Builder().scheme("obli-notification").authority(kind).appendPath(id.toString()).appendPath(slot.toString()).build()
    }
}

/** Extras of a broadcast action (NotificationActionReceiver). */
internal object ActionExtras {
    private const val P = "tools.obli.obliance.notifications.action."
    const val SERVER = P + "server"
    const val NOTIFICATION = P + "notification"
    const val ALERT = P + "alert"
    const val DEVICE = P + "device"
    const val TENANT = P + "tenant"
    const val LABEL = P + "label"

    fun write(intent: Intent, target: ActionTarget) {
        intent.putExtra(SERVER, target.serverId.value).putExtra(NOTIFICATION, target.notificationId)
        target.alertId?.let { intent.putExtra(ALERT, it) }
        target.deviceId?.let { intent.putExtra(DEVICE, it) }
        target.tenantId?.let { intent.putExtra(TENANT, it) }
        target.label?.let { intent.putExtra(LABEL, it) }
    }

    fun read(intent: Intent): ActionTarget? {
        val server = intent.getStringExtra(SERVER)?.takeIf { it.isNotBlank() && it.length <= 64 } ?: return null
        if (!intent.hasExtra(NOTIFICATION)) return null
        fun long(key: String) = if (intent.hasExtra(key)) intent.getLongExtra(key, -1).takeIf { it >= 0 } else null
        return ActionTarget(
            serverId = ServerId(server),
            notificationId = intent.getIntExtra(NOTIFICATION, 0),
            alertId = long(ALERT),
            deviceId = long(DEVICE),
            tenantId = long(TENANT),
            label = intent.getStringExtra(LABEL)?.take(120),
        )
    }
}

/**
 * The server tile of design doc §2.10 drawn on a bitmap (large icon of the
 * notifications from two servers): colour at 18 % over the chrome colour,
 * 1 px border at 40 %, monospace bold monogram in the colour.
 */
internal object ServerTileBitmap {
    private const val CHROME = 0xFF0F1220.toInt()

    fun draw(context: Context, spec: TileSpec): Bitmap {
        val density = context.resources.displayMetrics.density
        val size = (64 * density).toInt().coerceIn(48, 256)
        val bitmap = createBitmap(size, size)
        val canvas = Canvas(bitmap)
        val color = spec.color.argb.toInt()
        val radius = size * 5f / 28f
        val stroke = (size / 28f).coerceAtLeast(1f)
        val rect = RectF(stroke / 2, stroke / 2, size - stroke / 2, size - stroke / 2)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = CHROME
        canvas.drawRoundRect(rect, radius, radius, paint)
        paint.color = withAlpha(color, 0.18f)
        canvas.drawRoundRect(rect, radius, radius, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = stroke
        paint.color = withAlpha(color, 0.40f)
        canvas.drawRoundRect(rect, radius, radius, paint)
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textSize = size * 13f / 28f
            textAlign = Paint.Align.CENTER
        }
        val y = size / 2f - (text.descent() + text.ascent()) / 2f
        canvas.drawText(spec.monogram.take(2), size / 2f, y, text)
        return bitmap
    }

    private fun withAlpha(argb: Int, alpha: Float): Int = (Math.round(alpha * 255) shl 24) or (argb and 0xFFFFFF)
}
