package tools.obli.obliance.notifications

import java.time.ZonedDateTime

/** How urgent an item is for the on-call rules. */
internal enum class Urgency {
    /** Critical-class alert (rank 0 or 1 of AlertClassifier): the "Appareils critiques" channel. */
    CRITICAL,

    /** Two-person approval waiting (time-sensitive, design doc §9 "Escalades de droits"). */
    ESCALATION,

    /** Attention, recovery, enrolment. */
    NORMAL,
}

/** What the on-call rules allow for one notification. */
internal enum class Delivery { NORMAL, SILENT, DROP }

/**
 * On-call rules (design doc §5 S84, §9 #2), pure.
 *
 * - Active = enabled, inside the window and the window's START day is
 *   selected: 19:00–08:00 on "Friday" covers Friday 19:00 → Saturday 08:00.
 * - A server with "Inclus dans l'astreinte" off always follows the outside rule.
 * - Outside rule: CRITICAL_ONLY keeps critical-class alerts and escalations;
 *   SILENT posts everything without sound; NONE posts nothing (the marks still
 *   advance: nothing floods later).
 * - On-call disabled = normal mode: only the server's notify scope applies.
 */
internal object OnCallPolicy {
    fun isActive(settings: OnCallSettings, at: ZonedDateTime): Boolean {
        if (!settings.enabled) return false
        val minute = at.hour * 60 + at.minute
        val today = at.dayOfWeek.value
        val yesterday = at.minusDays(1).dayOfWeek.value
        val start = settings.startMinute.coerceIn(0, MINUTES_PER_DAY - 1)
        val end = settings.endMinute.coerceIn(0, MINUTES_PER_DAY - 1)
        return when {
            // Same start and end: the whole day of each selected day.
            start == end -> today in settings.days
            start < end -> today in settings.days && minute >= start && minute < end
            // Crosses midnight: the evening belongs to today, the morning to yesterday's window.
            else -> (minute >= start && today in settings.days) || (minute < end && yesterday in settings.days)
        }
    }

    fun delivery(settings: OnCallSettings, serverInOnCall: Boolean, at: ZonedDateTime, urgency: Urgency): Delivery {
        if (!settings.enabled) return Delivery.NORMAL
        if (serverInOnCall && isActive(settings, at)) return Delivery.NORMAL
        return when (settings.outside) {
            OutsideRule.CRITICAL_ONLY -> if (urgency == Urgency.NORMAL) Delivery.DROP else Delivery.NORMAL
            OutsideRule.SILENT -> Delivery.SILENT
            OutsideRule.NONE -> Delivery.DROP
        }
    }

    /** Reminders only while this server is actually on call (design doc §9 #2). */
    fun remindersApply(settings: OnCallSettings, serverInOnCall: Boolean, at: ZonedDateTime): Boolean =
        settings.enabled && settings.remindCritical && serverInOnCall && isActive(settings, at)

    private const val MINUTES_PER_DAY = 24 * 60
}

/**
 * "Rappeler une alerte critique non lue toutes les 5 min (3 fois max)" (S84),
 * pure: attempt N (1..[MAX]) re-posts the same notification WITH sound when
 * it is still on screen, its alert is still unread on its server and the
 * server is still on call.
 */
internal object ReminderPolicy {
    const val MAX = 3
    const val DELAY_MINUTES = 5L

    sealed interface Decision {
        /** Re-post with sound, then schedule [next] (null: that was the last one). */
        data class Repost(val next: Int?) : Decision

        /** The server could not be asked: nothing now, try again at [next]. */
        data class Wait(val next: Int?) : Decision

        data object Stop : Decision
    }

    /** [unread]: true unread, false read or gone, null unknown (server unreachable). */
    fun decide(attempt: Int, stillShown: Boolean, unread: Boolean?, remindersApply: Boolean): Decision {
        if (attempt !in 1..MAX || !stillShown || !remindersApply) return Decision.Stop
        val next = if (attempt < MAX) attempt + 1 else null
        return when (unread) {
            true -> Decision.Repost(next)
            null -> if (next != null) Decision.Wait(next) else Decision.Stop
            false -> Decision.Stop
        }
    }
}
