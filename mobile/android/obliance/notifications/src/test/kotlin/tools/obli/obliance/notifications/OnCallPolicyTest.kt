package tools.obli.obliance.notifications

import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** On-call rules of S84 (design doc §9 #2), pure JVM. 25 September 2026 is a Friday. */
class OnCallPolicyTest {
    private val paris = ZoneId.of("Europe/Paris")
    private fun at(iso: String): ZonedDateTime = LocalDateTime.parse(iso).atZone(paris)

    private val nights = OnCallSettings(enabled = true, startMinute = 19 * 60, endMinute = 8 * 60)

    @Test fun nineteenToEightCrossesMidnight() {
        assertTrue(OnCallPolicy.isActive(nights, at("2026-09-24T23:00")))
        assertTrue(OnCallPolicy.isActive(nights, at("2026-09-25T03:20")))
        assertTrue(OnCallPolicy.isActive(nights, at("2026-09-25T07:59")))
        assertFalse(OnCallPolicy.isActive(nights, at("2026-09-25T08:00")))
        assertFalse(OnCallPolicy.isActive(nights, at("2026-09-25T12:00")))
        assertFalse(OnCallPolicy.isActive(nights, at("2026-09-25T18:59")))
        assertTrue(OnCallPolicy.isActive(nights, at("2026-09-25T19:00")))
    }

    @Test fun theWindowBelongsToItsStartDay() {
        val fridayOnly = nights.copy(days = setOf(5))
        // Friday 03:20 belongs to Thursday's night: not selected.
        assertFalse(OnCallPolicy.isActive(fridayOnly, at("2026-09-25T03:20")))
        assertTrue(OnCallPolicy.isActive(fridayOnly, at("2026-09-25T20:00")))
        // Saturday 07:00 is still Friday's night.
        assertTrue(OnCallPolicy.isActive(fridayOnly, at("2026-09-26T07:00")))
        assertFalse(OnCallPolicy.isActive(fridayOnly, at("2026-09-26T20:00")))
    }

    @Test fun aDaytimeWindowStaysInItsDay() {
        val office = OnCallSettings(enabled = true, days = setOf(1, 2, 3, 4, 5), startMinute = 8 * 60, endMinute = 18 * 60)
        assertTrue(OnCallPolicy.isActive(office, at("2026-09-25T10:00")))
        assertFalse(OnCallPolicy.isActive(office, at("2026-09-25T18:00")))
        assertFalse(OnCallPolicy.isActive(office, at("2026-09-26T10:00")))
    }

    @Test fun sameStartAndEndCoversTheWholeDay() {
        val allDay = OnCallSettings(enabled = true, days = setOf(5), startMinute = 0, endMinute = 0)
        assertTrue(OnCallPolicy.isActive(allDay, at("2026-09-25T12:34")))
        assertFalse(OnCallPolicy.isActive(allDay, at("2026-09-26T12:34")))
    }

    @Test fun disabledOnCallIsNormalMode() {
        val off = nights.copy(enabled = false, outside = OutsideRule.NONE)
        assertFalse(OnCallPolicy.isActive(off, at("2026-09-25T03:20")))
        Urgency.entries.forEach { assertEquals(Delivery.NORMAL, OnCallPolicy.delivery(off, true, at("2026-09-25T12:00"), it)) }
    }

    @Test fun duringOnCallEverythingIsDelivered() {
        val night = at("2026-09-25T03:20")
        Urgency.entries.forEach { assertEquals(Delivery.NORMAL, OnCallPolicy.delivery(nights.copy(outside = OutsideRule.NONE), true, night, it)) }
    }

    @Test fun outsideCriticalOnlyKeepsCriticalsAndEscalations() {
        val noon = at("2026-09-25T12:00")
        val s = nights.copy(outside = OutsideRule.CRITICAL_ONLY)
        assertEquals(Delivery.NORMAL, OnCallPolicy.delivery(s, true, noon, Urgency.CRITICAL))
        assertEquals(Delivery.NORMAL, OnCallPolicy.delivery(s, true, noon, Urgency.ESCALATION))
        assertEquals(Delivery.DROP, OnCallPolicy.delivery(s, true, noon, Urgency.NORMAL))
    }

    @Test fun outsideSilentPostsEverythingWithoutSound() {
        val noon = at("2026-09-25T12:00")
        Urgency.entries.forEach { assertEquals(Delivery.SILENT, OnCallPolicy.delivery(nights.copy(outside = OutsideRule.SILENT), true, noon, it)) }
    }

    @Test fun outsideNonePostsNothing() {
        val noon = at("2026-09-25T12:00")
        Urgency.entries.forEach { assertEquals(Delivery.DROP, OnCallPolicy.delivery(nights.copy(outside = OutsideRule.NONE), true, noon, it)) }
    }

    @Test fun aServerOutOfOnCallAlwaysFollowsTheOutsideRule() {
        val night = at("2026-09-25T03:20")
        assertEquals(Delivery.DROP, OnCallPolicy.delivery(nights.copy(outside = OutsideRule.NONE), false, night, Urgency.CRITICAL))
        assertEquals(Delivery.DROP, OnCallPolicy.delivery(nights.copy(outside = OutsideRule.CRITICAL_ONLY), false, night, Urgency.NORMAL))
        assertEquals(Delivery.NORMAL, OnCallPolicy.delivery(nights.copy(outside = OutsideRule.CRITICAL_ONLY), false, night, Urgency.CRITICAL))
        assertFalse(OnCallPolicy.remindersApply(nights, false, night))
        assertTrue(OnCallPolicy.remindersApply(nights, true, night))
        assertFalse(OnCallPolicy.remindersApply(nights.copy(remindCritical = false), true, night))
    }

    @Test fun remindersRepeatThreeTimesAtMost() {
        assertEquals(ReminderPolicy.Decision.Repost(2), ReminderPolicy.decide(1, stillShown = true, unread = true, remindersApply = true))
        assertEquals(ReminderPolicy.Decision.Repost(3), ReminderPolicy.decide(2, stillShown = true, unread = true, remindersApply = true))
        assertEquals(ReminderPolicy.Decision.Repost(null), ReminderPolicy.decide(3, stillShown = true, unread = true, remindersApply = true))
        assertEquals(ReminderPolicy.Decision.Stop, ReminderPolicy.decide(4, stillShown = true, unread = true, remindersApply = true))
    }

    @Test fun remindersStopWhenReadDismissedOrOffCall() {
        assertEquals(ReminderPolicy.Decision.Stop, ReminderPolicy.decide(1, stillShown = true, unread = false, remindersApply = true))
        assertEquals(ReminderPolicy.Decision.Stop, ReminderPolicy.decide(1, stillShown = false, unread = true, remindersApply = true))
        assertEquals(ReminderPolicy.Decision.Stop, ReminderPolicy.decide(1, stillShown = true, unread = true, remindersApply = false))
        // Server unreachable: no sound now, try again at the next slot.
        assertEquals(ReminderPolicy.Decision.Wait(2), ReminderPolicy.decide(1, stillShown = true, unread = null, remindersApply = true))
        assertEquals(ReminderPolicy.Decision.Stop, ReminderPolicy.decide(3, stillShown = true, unread = null, remindersApply = true))
    }
}
