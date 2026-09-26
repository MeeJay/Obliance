package tools.obli.shell.alerts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveAlertsTest {
    /** Shape of GET /api/live-alerts/all (liveAlert.controller getAllTenantAlerts + rowToAlert). */
    private val body = """
        {"alerts":[
          {"id":42,"tenantId":1,"tenantName":"Default","severity":"critical","title":"PC-01 offline",
           "message":"No heartbeat for 5 min","navigateTo":"/devices/12","stableKey":"offline:12",
           "readAt":null,"createdAt":"2026-09-24T10:00:00.000Z"},
          {"id":41,"tenantId":2,"tenantName":"Acme","severity":"warning","title":"Disk 91%",
           "message":"C: almost full","navigateTo":null,"stableKey":null,
           "readAt":"2026-09-24T09:59:00.000Z","createdAt":"2026-09-24T09:58:00.000Z"},
          {"id":40,"tenantId":2,"severity":"weird","title":"x","message":"y","navigateTo":null,"readAt":null,"createdAt":"2026-09-24T09:00:00.000Z"},
          {"id":"bad"}
        ],
        "tenants":[{"id":1,"name":"Default"},{"id":2,"name":"Acme"}]}
    """.trimIndent()

    @Test fun parsesTheServerShape() {
        val alerts = LiveAlerts.parse(body)!!
        assertEquals(3, alerts.size)
        val a = alerts[0]
        assertEquals(42L, a.id)
        assertEquals(1L, a.tenantId)
        assertEquals("Default", a.tenantName)
        assertEquals(AlertSeverity.CRITICAL, a.severity)
        assertEquals("PC-01 offline", a.title)
        assertEquals("/devices/12", a.navigateTo)
        assertNull(a.readAt)
        assertEquals(AlertSeverity.WARNING, alerts[1].severity)
        assertEquals("2026-09-24T09:59:00.000Z", alerts[1].readAt)
        assertEquals(AlertSeverity.INFO, alerts[2].severity)
        assertNull(alerts[2].tenantName)
        // The incident key of the row (null or absent: none).
        assertEquals("offline:12", a.stableKey)
        assertNull(alerts[1].stableKey)
        assertNull(alerts[2].stableKey)
    }

    @Test fun invalidBodiesAreNull() {
        assertNull(LiveAlerts.parse("<html>"))
        assertNull(LiveAlerts.parse("""{"error":"Authentication required"}"""))
        assertEquals(0, LiveAlerts.parse("""{"alerts":[],"tenants":[]}""")!!.size)
    }

    private fun alert(id: Long, read: Boolean = false) = LiveAlert(
        id = id, tenantId = 1, tenantName = null, severity = AlertSeverity.INFO, title = "t$id",
        message = "", navigateTo = null, readAt = if (read) "2026-01-01T00:00:00Z" else null, createdAt = null,
    )

    @Test fun firstRunOnlyRecordsTheMark() {
        val r = LiveAlerts.process(listOf(alert(5), alert(9), alert(7)), highWater = null)
        assertTrue(r.toNotify.isEmpty())
        assertEquals(9L, r.newHighWater)
    }

    @Test fun firstRunWithoutAlertsRecordsZero() {
        val r = LiveAlerts.process(emptyList(), highWater = null)
        assertEquals(0L, r.newHighWater)
    }

    @Test fun notifiesOnlyNewUnreadAlertsOldestFirst() {
        val r = LiveAlerts.process(listOf(alert(12), alert(10), alert(11, read = true), alert(9), alert(13)), highWater = 9)
        assertEquals(listOf(10L, 12L, 13L), r.toNotify.map { it.id })
        assertEquals(0, r.overflow)
        assertEquals(13L, r.newHighWater)
    }

    @Test fun nothingNewKeepsTheMark() {
        val r = LiveAlerts.process(listOf(alert(3), alert(9)), highWater = 9)
        assertTrue(r.toNotify.isEmpty())
        assertEquals(9L, r.newHighWater)
        val empty = LiveAlerts.process(emptyList(), highWater = 9)
        assertEquals(9L, empty.newHighWater)
    }

    @Test fun burstIsCappedWithOverflowCount() {
        val many = (101L..112L).map { alert(it) }
        val r = LiveAlerts.process(many, highWater = 100, maxNotifications = 5)
        assertEquals(listOf(108L, 109L, 110L, 111L, 112L), r.toNotify.map { it.id })
        assertEquals(7, r.overflow)
        assertEquals(112L, r.newHighWater)
    }

    @Test fun databaseResetRebaselines() {
        val r = LiveAlerts.process(listOf(alert(1), alert(2)), highWater = 500)
        assertTrue(r.toNotify.isEmpty())
        assertEquals(2L, r.newHighWater)
    }
}
