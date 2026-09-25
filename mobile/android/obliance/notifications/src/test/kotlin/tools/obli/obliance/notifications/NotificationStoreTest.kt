package tools.obli.obliance.notifications

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import tools.obli.core.model.NotifyScope
import tools.obli.obliance.data.sample.SampleData

/** The persisted state (DataStore "obli_notifications", JSON) and the id rules. */
class NotificationStoreTest {
    private val full = NotificationState(
        servers = mapOf(
            SampleData.PROD.value to ServerNotifState(
                alertsMark = 9812, approvalsMark = 17, enrolmentsMark = 240, expiredNotified = true,
                postedAlerts = listOf(PostedAlert(9812, 211, critical = true), PostedAlert(9790, 15, recovered = true)),
                postedApprovals = listOf(17), postedEnrolments = listOf(240),
                knownTenants = mapOf(1L to "Default", 4L to "ACME"), excludedTenants = setOf(4L), inOnCall = false,
                lastPass = LastPass(1_758_763_200_000, PassResult.UNREACHABLE, since = 1_758_762_120_000), lastCriticalUnread = 2,
                lastNotify = NotifyScope.CRITICAL_ONLY,
            ),
        ),
        onCall = OnCallSettings(enabled = true, days = setOf(1, 2, 3, 4, 5), startMinute = 20 * 60, endMinute = 7 * 60, outside = OutsideRule.SILENT, remindCritical = false),
        permissionAsked = true,
        batteryAsked = true,
    )

    @Test fun theStateSurvivesJson() {
        assertEquals(full, DataStoreNotificationStore.decode(DataStoreNotificationStore.encode(full)))
    }

    @Test fun anUnreadableBlobStartsOver() {
        assertEquals(NotificationState(), DataStoreNotificationStore.decode("{not json"))
        assertEquals(NotificationState(), DataStoreNotificationStore.decode(null))
        // Unknown fields of a newer version are ignored.
        assertEquals(NotificationState(permissionAsked = true), DataStoreNotificationStore.decode("""{"permissionAsked":true,"future":1}"""))
    }

    @Test fun defaultsMatchTheDesign() {
        val oc = OnCallSettings()
        assertEquals(false, oc.enabled)
        assertEquals((1..7).toSet(), oc.days)
        assertEquals(19 * 60, oc.startMinute)
        assertEquals(8 * 60, oc.endMinute)
        assertEquals(OutsideRule.CRITICAL_ONLY, oc.outside)
        assertEquals(true, oc.remindCritical)
        assertEquals(true, ServerNotifState().inOnCall)
    }

    @Test fun updatesAreAtomicPerServer() = runBlocking {
        val store = InMemoryNotificationStore()
        store.updateServer(SampleData.PROD) { it.copy(alertsMark = 1) }
        store.updateServer(SampleData.QUAL) { it.copy(alertsMark = 2) }
        store.update { it.without(SampleData.PROD) }
        assertEquals(setOf(SampleData.QUAL.value), store.current.servers.keys)
    }

    @Test fun idsAreStableAndInTheirOwnRange() {
        val ids = listOf(
            NotificationIds.alert(SampleData.PROD, 9812),
            NotificationIds.alert(SampleData.QUAL, 9812),
            NotificationIds.approval(SampleData.PROD, 17),
            NotificationIds.enrolment(SampleData.PROD, 240),
            NotificationIds.expired(SampleData.PROD),
            NotificationIds.summary(SampleData.PROD),
        )
        ids.forEach { org.junit.Assert.assertTrue("id $it out of range", it in 0x40000000..0x7FFFFFFF) }
        assertEquals(ids.size, ids.toSet().size)
        assertEquals(NotificationIds.alert(SampleData.PROD, 9812), NotificationIds.alert(SampleData.PROD, 9812))
    }

    @Test fun serialIdsFollowTheHighWaterRule() {
        assertEquals(240L to emptyList<Long>(), NotificationPass.advance(null, listOf(12, 240)) { m -> listOf(m) })
        assertEquals(0L to emptyList<Long>(), NotificationPass.advance(null, emptyList()) { m -> listOf(m) })
        assertEquals(241L to listOf(241L), NotificationPass.advance(240, listOf(241, 12)) { m -> listOf(241L).filter { it > m } })
        // The mark never goes back.
        assertEquals(240L to emptyList<Long>(), NotificationPass.advance(240, listOf(12)) { m -> listOf(12L).filter { it > m } })
    }
}
