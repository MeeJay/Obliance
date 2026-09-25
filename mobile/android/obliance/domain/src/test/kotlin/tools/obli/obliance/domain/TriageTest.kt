package tools.obli.obliance.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.model.ServerId
import tools.obli.shell.alerts.AlertSeverity
import tools.obli.shell.alerts.LiveAlert

/** Reference data of the design doc §4 (night of 25 September 2026). */
class TriageTest {
    private val bh = ServerId("binaryhearts")
    private val at = ServerId("atelier")
    private val cd = ServerId("client-durand")

    private fun alert(id: Long, time: String, title: String, message: String, severity: AlertSeverity, tenant: Long = 1, read: Boolean = false) =
        LiveAlert(id, tenant, null, severity, title, message, "/devices/$id", if (read) "2026-09-25T03:30:00Z" else null, "2026-09-25T${time}:00Z")

    private val night = listOf(
        ServerAlert(bh, alert(512, "03:12", "SRV-AD2: Hors ligne", "Aucun push reçu depuis 4 min.", AlertSeverity.CRITICAL, 4), DeviceHints(isServer = true)),
        ServerAlert(bh, alert(508, "03:05", "PC-COMPTA-03: Critique", "CPU 98 % (seuil 90 %)", AlertSeverity.CRITICAL, 4)),
        ServerAlert(cd, alert(77, "02:58", "SRV-DURAND01: Hors ligne", "Aucun push reçu depuis 5 min.", AlertSeverity.CRITICAL), DeviceHints(isServer = true)),
        ServerAlert(bh, alert(503, "02:47", "BOB01: Alerte", "Disque / 94 % (seuil 90 %)", AlertSeverity.WARNING)),
        ServerAlert(at, alert(19, "01:50", "NAS-ATELIER: Alerte", "Disque /volume1 91 % (seuil 90 %)", AlertSeverity.WARNING)),
        ServerAlert(bh, alert(497, "01:30", "SRV-FILES01: santé disque à surveiller", "Disque 1 : 5 secteurs réalloués", AlertSeverity.WARNING)),
        ServerAlert(bh, alert(490, "00:58", "140: De retour en ligne", "", AlertSeverity.INFO)),
    )

    @Test fun categoriesFromServerTitles() {
        assertEquals(AlertCategory.OFFLINE, AlertClassifier.category("SRV-AD2: Hors ligne"))
        assertEquals(AlertCategory.METRIC, AlertClassifier.category("PC-COMPTA-03: Critique"))
        assertEquals(AlertCategory.METRIC, AlertClassifier.category("BOB01: Alerte"))
        assertEquals(AlertCategory.DISK_HEALTH, AlertClassifier.category("SRV-FILES01: santé disque critique"))
        assertEquals(AlertCategory.RECOVERY, AlertClassifier.category("SRV-FILES01: santé disque revenue à la normale"))
        assertEquals(AlertCategory.RECOVERY, AlertClassifier.category("PC-COMPTA-03: retour à la normale"))
        assertEquals(AlertCategory.RECOVERY, AlertClassifier.category("140: De retour en ligne"))
        assertEquals(AlertCategory.IDENTITY, AlertClassifier.category("KIOSK-02: ID agent dupliqué suspecté"))
        assertEquals(AlertCategory.OTHER, AlertClassifier.category("Nouvelle version disponible"))
    }

    @Test fun quickActions() {
        assertEquals(listOf(QuickAction.WATCH, QuickAction.PROCESSES, QuickAction.WATCH, QuickAction.SCRIPTS, QuickAction.SCRIPTS, QuickAction.DISKS, null),
            night.map { it.classification.quickAction })
        assertEquals("SRV-AD2", night[0].classification.deviceName)
    }

    @Test fun workstationOfflineSentAsInfoNeverWakesAnyone() {
        val c = AlertClassifier.classify(alert(1, "03:00", "PC-ACCUEIL-01: Hors ligne", "", AlertSeverity.INFO))
        assertEquals(3, c.rank)
        assertFalse(c.wakesUp)
        val server = AlertClassifier.classify(alert(2, "03:00", "SRV-X: Hors ligne", "", AlertSeverity.INFO), DeviceHints(isServer = true))
        assertEquals(1, server.rank)
        assertTrue(server.wakesUp)
    }

    @Test fun aggregatedAcrossServersInDesignOrder() {
        val list = Triage.build(night.shuffled(java.util.Random(7)))
        assertEquals(listOf(512L, 508L, 77L, 503L, 19L, 497L, 490L), list.unread.map { it.alert.id })
        assertEquals(mapOf(bh to 5, cd to 1, at to 1), list.unreadByServer)
    }

    @Test fun serverFilterAndReadSection() {
        val withRead = night + ServerAlert(at, alert(18, "01:10", "NAS-ATELIER: retour à la normale", "", AlertSeverity.INFO, read = true))
        val list = Triage.build(withRead, serverFilter = setOf(at))
        assertEquals(listOf(19L), list.unread.map { it.alert.id })
        assertEquals(listOf(18L), list.read.map { it.alert.id })
    }

    @Test fun siteOutageNeverMixesServers() {
        fun off(server: ServerId, id: Long, time: String, tenant: Long) =
            ServerAlert(server, alert(id, time, "SRV-$id: Hors ligne", "", AlertSeverity.CRITICAL, tenant))
        val bash = listOf(off(bh, 601, "03:07", 4), off(bh, 602, "03:08", 4), off(bh, 603, "03:08", 4), off(bh, 604, "03:09", 4), off(bh, 605, "03:09", 4))
        val others = listOf(off(cd, 606, "03:08", 4), off(bh, 607, "03:30", 4), off(bh, 608, "03:08", 1))
        val outages = Triage.outages(bash + others)
        assertEquals(1, outages.size)
        assertEquals(bh, outages[0].serverId)
        assertEquals(4L, outages[0].tenantId)
        assertEquals(5, outages[0].alerts.size)
        assertEquals("2026-09-25T03:07:00Z", outages[0].from.toString())
        assertEquals("2026-09-25T03:09:00Z", outages[0].to.toString())
        assertTrue(Triage.outages(bash.take(2) + others).isEmpty())
    }

    @Test fun timestampsFromPostgres() {
        assertEquals("2026-09-25T03:12:04.123Z", parseInstant("2026-09-25 03:12:04.123+00")?.toString())
        assertNull(parseInstant("hier"))
    }
}
