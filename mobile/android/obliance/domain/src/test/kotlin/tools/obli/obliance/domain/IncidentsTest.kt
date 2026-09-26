package tools.obli.obliance.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import tools.obli.shell.alerts.AlertSeverity
import tools.obli.shell.alerts.LiveAlert

/** 0.3.1: one device + one alert kind with a recovery counterpart = one incident. */
class IncidentsTest {
    private fun alert(title: String, device: Long? = 211, stableKey: String? = null, severity: AlertSeverity = AlertSeverity.WARNING) =
        LiveAlert(1, 4, "ACME", severity, title, "", device?.let { "/devices/$it" }, null, "2026-09-25T01:12:04Z", stableKey)

    @Test fun warningAndCriticalOfAMetricAreTheSameIncident() {
        val warning = alert("SRV-AD2: Alerte", stableKey = "device:211:metric:warning")
        val critical = alert("SRV-AD2: Critique", stableKey = "device:211:metric:critical", severity = AlertSeverity.CRITICAL)
        assertEquals("device:211:metric", Incidents.key(warning))
        assertEquals(Incidents.key(warning), Incidents.key(critical))
    }

    @Test fun stableKeysOfEachKind() {
        assertEquals("device:211:offline", Incidents.key(alert("SRV-AD2: Hors ligne", stableKey = "device:211:offline")))
        assertEquals("device:30:diskhealth", Incidents.key(alert("SRV-FILES01: santé disque critique", device = 30, stableKey = "device:30:diskhealth:bad")))
        assertEquals("device:30:diskhealth", Incidents.key(alert("SRV-FILES01: santé disque à surveiller", device = 30, stableKey = "device:30:diskhealth:warning")))
    }

    @Test fun withoutAStableKeyTheTitleAndTheDeviceDecide() {
        assertEquals("device:211:metric", Incidents.key(alert("SRV-AD2: Critique")))
        assertEquals("device:211:offline", Incidents.key(alert("SRV-AD2: Hors ligne")))
        assertEquals("device:30:diskhealth", Incidents.key(alert("SRV-FILES01: santé disque critique", device = 30)))
        // Same device, another kind: another incident.
        assertEquals("device:211:metric", Incidents.key(alert("SRV-AD2: Alerte", stableKey = "something-else")))
    }

    @Test fun recoveriesAndOtherAlertsHaveNoIncident() {
        assertNull(Incidents.key(alert("SRV-AD2: De retour en ligne")))
        assertNull(Incidents.key(alert("SRV-AD2: retour à la normale")))
        assertNull(Incidents.key(alert("SRV-FILES01: santé disque revenue à la normale", device = 30)))
        assertNull("no device, no incident", Incidents.key(alert("SRV-AD2: Critique", device = null)))
    }

    @Test fun aDuplicateAgentIdIsAnIncidentToo() {
        assertEquals("device:211:duplicate_agent_id", Incidents.key(alert("PC-01: ID agent dupliqué suspecté", stableKey = "device:211:duplicate_agent_id")))
        assertEquals("device:211:duplicate_agent_id", Incidents.key(alert("PC-01: ID agent dupliqué suspecté")))
    }

    @Test fun storedCategoriesMapToTheSameKeys() {
        assertEquals("device:211:metric", Incidents.key(211L, AlertCategory.METRIC.name))
        assertEquals("device:211:offline", Incidents.key(211L, AlertCategory.OFFLINE))
        assertNull(Incidents.key(211L, AlertCategory.RECOVERY.name))
        assertNull(Incidents.key(211L, null as String?))
        assertNull(Incidents.key(null, AlertCategory.METRIC))
    }
}
