package tools.obli.obliance.fleet

import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.data.sample.SampleData

class FleetMapperTest {
    private val prod = FleetData(
        serverId = SampleData.PROD,
        summary = SampleData.summary,
        serverAggregates = true,
        attention = SampleData.devices.needingAttention(5),
        updates = UpdateStats(available = 61, critical = 9),
    )

    @Test fun `featured card follows design doc 4 totals`() {
        val f = FleetMapper.featured(SampleData.summary)
        assertEquals(312, f.total)
        assertEquals(296, f.connected)
        assertEquals(16, f.offline)
        assertEquals(Delta(3, DeltaTrend.NEUTRAL, DeltaPeriod.YESTERDAY), f.delta)
        // Problems on the left, then online, offline, pending.
        assertEquals(
            listOf(RibbonKind.CRITICAL to 1, RibbonKind.WARNING to 5, RibbonKind.UPDATING to 1, RibbonKind.ONLINE to 289, RibbonKind.OFFLINE to 16, RibbonKind.PENDING to 3),
            f.segments.map { it.kind to it.count },
        )
        // Legend chips = "Critique 1 · Attention 5 · Hors ligne 16 · En attente 3".
        assertEquals(listOf(RibbonKind.CRITICAL, RibbonKind.WARNING, RibbonKind.OFFLINE, RibbonKind.PENDING), f.legend.map { it.kind })
    }

    @Test fun `a healthy fleet shows only the online chip`() {
        val f = FleetMapper.featured(FleetSummary(total = 12, online = 12))
        assertEquals(listOf(RibbonKind.ONLINE), f.legend.map { it.kind })
        assertNull(f.delta)
    }

    @Test fun `update errors count as offline like the web dashboard`() {
        val s = FleetSummary(total = 10, online = 7, offline = 2, updateError = 1)
        assertEquals(3, FleetMapper.offline(s))
        assertEquals(3, FleetMapper.featured(s).offline)
    }

    @Test fun `indicators with deltas, never the brand red`() {
        val kpis = FleetMapper.kpis(prod).associateBy { it.kind }
        assertEquals(289, kpis.getValue(KpiKind.ONLINE).value)
        assertEquals(16, kpis.getValue(KpiKind.OFFLINE).value)
        // More offline than yesterday is a degradation (amber), fewer pending updates an improvement (green).
        assertEquals(DeltaTrend.WORSE, kpis.getValue(KpiKind.OFFLINE).delta!!.trend)
        assertEquals(Delta(-12, DeltaTrend.BETTER, DeltaPeriod.WEEK), kpis.getValue(KpiKind.PENDING_UPDATES).delta)
        assertEquals(47, kpis.getValue(KpiKind.PENDING_UPDATES).value)
        assertEquals(9, kpis.getValue(KpiKind.PENDING_UPDATES).criticalUpdates)
        assertEquals(293, kpis.getValue(KpiKind.AGENTS_UP_TO_DATE).value)
        assertEquals(312, kpis.getValue(KpiKind.AGENTS_UP_TO_DATE).outOf)
        assertEquals(ObliTokens.Status.CRITICAL, kpis.getValue(KpiKind.CRITICAL).status)
        assertNull(kpis.getValue(KpiKind.CRITICAL).delta)
    }

    @Test fun `no critical updates mention without pending updates`() {
        val kpis = FleetMapper.kpis(prod.copy(summary = FleetSummary(total = 5, online = 5))).associateBy { it.kind }
        assertNull(kpis.getValue(KpiKind.PENDING_UPDATES).criticalUpdates)
    }

    @Test fun `zero critical is not painted red`() {
        val kpis = FleetMapper.kpis(prod.copy(summary = FleetSummary(total = 5, online = 5))).associateBy { it.kind }
        assertNull(kpis.getValue(KpiKind.CRITICAL).status)
        assertNull(kpis.getValue(KpiKind.OFFLINE).status)
    }

    @Test fun `non-admins only get the indicators computed from their list`() {
        val kpis = FleetMapper.kpis(prod.copy(serverAggregates = false))
        assertEquals(listOf(KpiKind.ONLINE, KpiKind.OFFLINE, KpiKind.CRITICAL, KpiKind.WARNING), kpis.map { it.kind })
    }

    @Test fun `summary of a visible list excludes enrolments from the total`() {
        val s = FleetMapper.summaryOf(SampleData.devices)
        assertEquals(11, s.total) // KIOSK-ACCUEIL-02 is pending
        assertEquals(1, s.pending)
        assertEquals(1, s.critical)
        assertEquals(2, s.warning)
        assertEquals(2, s.offline)
        assertEquals(6, s.online)
    }

    @Test fun `attention lists the most urgent devices first`() {
        val names = SampleData.devices.needingAttention(5).map { it.label }
        assertEquals(listOf("PC-COMPTA-03", "BOB01", "SRV-FILES01", "SRV-AD2", "PC-ATELIER-02"), names)
    }

    @Test fun `attention reasons`() {
        val rows = FleetMapper.attention(SampleData.devices.needingAttention(5), NIGHT_NOW).associateBy { it.device.label }
        assertEquals(AttentionReason.Metric(MetricKind.CPU, 98), rows.getValue("PC-COMPTA-03").reason)
        val bob = rows.getValue("BOB01").reason as AttentionReason.Metric
        assertEquals(MetricKind.DISK, bob.kind)
        assertEquals(94, bob.percent)
        assertEquals("/", bob.mount)
        assertEquals(12.0, bob.freeGb!!, 0.01)
        // No metric above 85 %: identity line.
        assertEquals(AttentionReason.Identity("Windows Server 2019", "10.20.0.30"), rows.getValue("SRV-FILES01").reason)
        // Offline since 03:08 (same night) and since 3 days.
        assertEquals(AttentionReason.OfflineSince(Instant.parse("2026-09-25T01:08:00Z").toEpochMilli(), 0), rows.getValue("SRV-AD2").reason)
        assertEquals(3, (rows.getValue("PC-ATELIER-02").reason as AttentionReason.OfflineSince).days)
        assertEquals(ObliTokens.Status.CRITICAL, rows.getValue("PC-COMPTA-03").status)
        assertEquals(ObliTokens.Status.OFFLINE, rows.getValue("SRV-AD2").status)
    }

    @Test fun `groups aggregate subtrees and show troubled subgroups first`() {
        val rows = FleetMapper.groups(SampleFleetSource.PROD_GROUPS)
        assertEquals(listOf("Siège", "Serveurs"), rows[0].path)
        assertEquals(6, rows[0].total)
        assertEquals(1, rows[0].online)
        assertTrue(rows[0].hasProblem)
        val siege = rows.first { it.path == listOf("Siège") }
        assertEquals(248, siege.total)
        assertEquals(230, siege.online)
        assertEquals(14, siege.offline)
        assertEquals(1, siege.critical)
        assertEquals(3, siege.warning)
        assertEquals(91.0, siege.complianceScore!!, 0.0)
        val infra = rows.first { it.path == listOf("Infra") }
        assertEquals(64, infra.total)
        assertEquals(59, infra.online)
        // The ungrouped pseudo-row never shows.
        assertTrue(rows.none { it.path.contains("Unknown") })
    }

    @Test fun `ribbon keeps small segments visible and fills the width`() {
        val w = FleetMapper.ribbonWidths(listOf(1, 5, 1, 289, 16, 3), available = 308f, min = 6f)
        assertTrue(w.all { it >= 6f - 0.001f })
        assertEquals(308f, w.sum(), 0.5f)
        assertTrue(w[3] > 200f)
        assertEquals(listOf(0f, 0f), FleetMapper.ribbonWidths(listOf(0, 0), 100f, 6f))
    }

    @Test fun `hours are parsed and sorted`() {
        val points = FleetMapper.hours(SampleFleetSource.PROD_HOURS.reversed())
        assertEquals(24, points.size)
        assertTrue(points.zipWithNext().all { (a, b) -> a.at < b.at })
    }

    @Test fun `problems`() {
        assertEquals(FleetProblem.SESSION_EXPIRED, FleetMapper.problemOf(ApiOutcome.SessionExpired))
        assertEquals(FleetProblem.OFFLINE, FleetMapper.problemOf(ApiOutcome.Failure(null, FailureKind.NETWORK)))
        assertEquals(FleetProblem.SERVER, FleetMapper.problemOf(ApiOutcome.Failure(502, FailureKind.SERVER)))
    }

    @Test fun `time formatting`() {
        val t = FleetTime(NIGHT_NOW, ZoneId.of("Europe/Paris"))
        assertEquals("03:22", t.clock(NIGHT_NOW))
        assertEquals("12,1", t.decimal(12.08, Locale.FRANCE))
        assertEquals("12.1", t.decimal(12.08, Locale.US))
    }
}
