package tools.obli.obliance.notifications

import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile

/** What S84 shows of one channel (the Android settings stay the reference). */
internal data class ChannelInfo(
    val importance: Int,
    val sound: Boolean,
    val vibrate: Boolean,
    val bypassDnd: Boolean,
)

/**
 * One NotificationChannelGroup per server, named after it (design doc §9),
 * holding the six channels `<serverId>.<category>`. Always grouped, even with
 * one server (a group needs a name; the system shows it with the channels).
 * Names and descriptions come from resources and are re-applied at every
 * install, so a language change renames them. The remote module's
 * "remote_sessions" channel is not touched.
 */
internal object NotificationChannels {
    private const val GROUP_PREFIX = "server."

    /** Three long pulses (design doc §9: critical devices). */
    val CRITICAL_VIBRATION = longArrayOf(0, 700, 300, 700, 300, 700)

    fun groupId(serverId: ServerId): String = GROUP_PREFIX + serverId.value

    fun ensure(context: Context, profiles: List<ServerProfile>) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        for (profile in profiles) {
            val group = groupId(profile.id)
            nm.createNotificationChannelGroup(NotificationChannelGroup(group, profile.displayName))
            nm.createNotificationChannels(NotifChannel.entries.map { channel(context, profile.id, it, group) })
        }
    }

    /** A removed server leaves nothing behind (design doc §2.10 "Retirer ce serveur"). */
    fun delete(context: Context, serverId: ServerId) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        runCatching { nm.deleteNotificationChannelGroup(groupId(serverId)) }
        // Belt and braces: a channel created outside its group (older build) goes too.
        NotifChannel.entries.forEach { c -> if (nm.getNotificationChannel(c.id(serverId)) != null) runCatching { nm.deleteNotificationChannel(c.id(serverId)) } }
    }

    /** Groups of servers that no longer exist (removed while the process was not running). */
    fun deleteOrphans(context: Context, keep: Set<ServerId>) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val keepIds = keep.map(::groupId).toSet()
        runCatching { nm.notificationChannelGroups }.getOrNull().orEmpty()
            .filter { it.id.startsWith(GROUP_PREFIX) && it.id !in keepIds }
            .forEach { runCatching { nm.deleteNotificationChannelGroup(it.id) } }
    }

    fun info(context: Context, serverId: ServerId, channel: NotifChannel): ChannelInfo? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val c = nm.getNotificationChannel(channel.id(serverId)) ?: return null
        return ChannelInfo(
            importance = c.importance,
            sound = c.sound != null,
            vibrate = c.shouldVibrate(),
            bypassDnd = c.canBypassDnd(),
        )
    }

    private fun channel(context: Context, serverId: ServerId, channel: NotifChannel, group: String): NotificationChannel {
        val (name, description, importance) = when (channel) {
            NotifChannel.CRITICAL -> Triple(R.string.notif_channel_critical, R.string.notif_channel_critical_desc, NotificationManager.IMPORTANCE_HIGH)
            NotifChannel.ATTENTION -> Triple(R.string.notif_channel_attention, R.string.notif_channel_attention_desc, NotificationManager.IMPORTANCE_DEFAULT)
            NotifChannel.RECOVERY -> Triple(R.string.notif_channel_recovery, R.string.notif_channel_recovery_desc, NotificationManager.IMPORTANCE_LOW)
            NotifChannel.ESCALATIONS -> Triple(R.string.notif_channel_escalations, R.string.notif_channel_escalations_desc, NotificationManager.IMPORTANCE_HIGH)
            NotifChannel.ENROLMENTS -> Triple(R.string.notif_channel_enrolments, R.string.notif_channel_enrolments_desc, NotificationManager.IMPORTANCE_DEFAULT)
            NotifChannel.ACCOUNT -> Triple(R.string.notif_channel_account, R.string.notif_channel_account_desc, NotificationManager.IMPORTANCE_DEFAULT)
        }
        return NotificationChannel(channel.id(serverId), context.getString(name), importance).apply {
            this.description = context.getString(description)
            this.group = group
            if (channel == NotifChannel.CRITICAL) {
                enableVibration(true)
                vibrationPattern = CRITICAL_VIBRATION
            }
            if (channel == NotifChannel.RECOVERY) setShowBadge(false)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setAllowBubbles(false)
        }
    }
}
