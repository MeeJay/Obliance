package tools.obli.obliance.devices

import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.designsystem.Contrast
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ForbiddenReason
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DeviceSort
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.api.DiskMetrics
import tools.obli.obliance.data.sample.SampleData

class DeviceModelsTest {
    private val prod = SampleData.devices

    @Test fun sectionsFollowTheServerProblemsFirstOrder() {
        // The sample is in enrolment order; the sections put problems first.
        val sections = buildSections(prod, emptyMap(), problemsFirst = true, total = prod.size, hasMore = false, summary = null)
        assertEquals(
            listOf(DeviceSection.CRITICAL, DeviceSection.WARNING, DeviceSection.PENDING, DeviceSection.OFFLINE, DeviceSection.ONLINE),
            sections.map { it.section },
        )
        assertEquals(listOf("PC-COMPTA-03"), sections[0].devices.map { it.label })
        assertEquals(setOf("BOB01", "SRV-FILES01"), sections[1].devices.map { it.label }.toSet())
        assertEquals(listOf(1, 2, 1, 2, 6), sections.map { it.count })
    }

    @Test fun summaryCountsReplaceLoadedCounts() {
        val sections = buildSections(prod, emptyMap(), true, prod.size, hasMore = false, summary = SampleData.summary)
        // §4 totals: 1 critical, 5 warning, 3 pending, 16 offline, 289 online.
        assertEquals(listOf(1, 5, 3, 16, 289), sections.map { it.count })
        assertTrue(sections.none { it.atLeast })
    }

    @Test fun lastLoadedSectionIsALowerBoundWhenMorePagesExist() {
        val sections = buildSections(prod, emptyMap(), true, total = 300, hasMore = true, summary = null)
        assertTrue(sections.last().atLeast)
        assertFalse(sections.first().atLeast)
    }

    @Test fun frozenSectionKeepsARowInPlaceAfterALiveChange() {
        val compta = prod.first { it.label == "PC-COMPTA-03" }
        val recovered = prod.map { if (it.id == compta.id) it.copy(status = "online") else it }
        val sections = buildSections(recovered, mapOf(compta.id to DeviceSection.CRITICAL), true, prod.size, false, null)
        assertEquals(DeviceSection.CRITICAL, sections.first().section)
        assertEquals(DeviceStatus.ONLINE, sections.first().devices.single().statusKind)
    }

    @Test fun byNameIsOneFlatBlock() {
        val sections = buildSections(prod, emptyMap(), problemsFirst = false, total = 312, hasMore = true, summary = null)
        assertEquals(1, sections.size)
        assertNull(sections.single().section)
        assertEquals(312, sections.single().count)
    }

    @Test fun adminQueryIsProblemsFirstByHundred() {
        val q = ListFilters().toQuery(page = 1, admin = true)
        assertEquals(100, q.pageSize)
        assertEquals(DeviceSort.STATUS, q.sortBy)
        assertNull(q.approvalStatus)
        assertEquals("/api/devices?page=1&pageSize=100&sortBy=status&sortOrder=asc", q.toPath())
    }

    @Test fun memberQueryAsksEverythingApprovedAtOnce() {
        val q = ListFilters(search = "  compta ", status = StatusChip.OFFLINE, os = OsChip.WINDOWS, problemsFirst = false).toQuery(1, admin = false)
        assertEquals(10_000, q.pageSize)
        assertEquals("approved", q.approvalStatus)
        assertEquals("compta", q.search)
        assertEquals("offline", q.status)
        assertEquals("windows", q.osType)
        assertEquals(DeviceSort.NAME, q.sortBy)
        // What is actually SENT: the server filters visibility after its LIMIT, so no smaller cap.
        assertTrue(q.toPath().startsWith("/api/devices?page=1&pageSize=10000&"))
    }

    @Test fun systemThresholdsColourTheSampleLikeTheMockup() {
        val t = Thresholds.SYSTEM
        assertEquals(MetricLevel.CRITICAL, t.cpu.levelOf(98.0)) // PC-COMPTA-03 CPU 98 %
        assertEquals(MetricLevel.NORMAL, t.ram.levelOf(71.7)) // its RAM 71 %
        assertEquals(MetricLevel.WARNING, t.forDisk("/").levelOf(94.0)) // BOB01 / 94 %
        assertEquals(MetricLevel.WARNING, t.forDisk("/volume1").levelOf(91.0)) // NAS-DEV01
        assertEquals(MetricLevel.CRITICAL, t.disk.levelOf(95.0)) // at-or-above
        assertEquals(95.0, t.cpu.crossed(MetricLevel.CRITICAL))
        assertNull(t.cpu.crossed(MetricLevel.NORMAL))
    }

    @Test fun perMountThresholdWins() {
        val t = Thresholds.SYSTEM.copy(diskByMount = mapOf("D:" to Threshold(60.0, 70.0)))
        assertEquals(MetricLevel.CRITICAL, t.forDisk("D:").levelOf(72.0))
        assertEquals(MetricLevel.NORMAL, t.forDisk("C:").levelOf(72.0))
    }

    @Test fun mainDiskPrefersSystemVolume() {
        val m = DeviceMetrics(disks = listOf(DiskMetrics("D:", percent = 90.0), DiskMetrics("C:", percent = 40.0)))
        assertEquals("C:", m.mainDisk()?.mount)
        val linux = DeviceMetrics(disks = listOf(DiskMetrics("/boot", percent = 30.0), DiskMetrics("/", percent = 94.0)))
        assertEquals("/", linux.mainDisk()?.mount)
        val nas = DeviceMetrics(disks = listOf(DiskMetrics("/volume2", percent = 12.0), DiskMetrics("/volume1", percent = 91.0)))
        assertEquals("/volume1", nas.mainDisk()?.mount)
    }

    @Test fun outcomesMapToCalmProblems() {
        assertEquals(ProblemKind.SESSION_EXPIRED, ApiOutcome.SessionExpired.toProblem()?.kind)
        assertEquals(ProblemKind.NETWORK, ApiOutcome.Failure(null, FailureKind.NETWORK).toProblem()?.kind)
        assertEquals(LoadProblem(ProblemKind.SERVER, 502, "/api/devices"), ApiOutcome.Failure(502, FailureKind.SERVER).toProblem("/api/devices"))
        assertEquals(ProblemKind.NOT_FOUND, ApiOutcome.Failure(404, FailureKind.NOT_FOUND).toProblem()?.kind)
        assertEquals(ProblemKind.FORBIDDEN, ApiOutcome.Forbidden(ForbiddenReason.OTHER, "no").toProblem()?.kind)
        assertEquals(ProblemKind.NO_SERVER, ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server").toProblem()?.kind)
        assertNull(ApiOutcome.Ok(1).toProblem())
    }

    @Test fun groupPathWalksUpToTheRoot() {
        val groups = Json.parseToJsonElement(
            """[{"id":3,"tenantId":4,"parentId":null,"name":"Siège"},
                {"id":12,"tenantId":4,"parentId":3,"name":"Comptabilité"},
                {"id":13,"tenantId":4,"parentId":3,"name":"Serveurs"},
                {"id":40,"parentId":41,"name":"Loop A"},{"id":41,"parentId":40,"name":"Loop B"}]""",
        ) as JsonArray
        assertEquals(listOf("Siège", "Comptabilité"), RemoteParsing.groupPath(groups, 12))
        assertEquals(listOf("Siège"), RemoteParsing.groupPath(groups, 3))
        assertNull(RemoteParsing.groupPath(groups, 99))
        // A corrupt parent loop never hangs.
        assertEquals(listOf("Loop A", "Loop B"), RemoteParsing.groupPath(groups, 41))
    }

    @Test fun resolvedThresholdsKeepSystemDefaultsForMissingSlots() {
        val obj = Json.parseToJsonElement("""{"cpu":{"warn":70,"crit":"90"},"disk":{"warn":80},"diskByMount":{"D:":{"crit":88}}}""") as JsonObject
        val t = RemoteParsing.thresholds(obj)
        assertEquals(Threshold(70.0, 90.0), t.cpu)
        assertEquals(Thresholds.SYSTEM.ram, t.ram)
        assertEquals(Threshold(80.0, 95.0), t.disk)
        assertEquals(Threshold(80.0, 88.0), t.forDisk("D:"))
    }

    @Test fun timesAndSizesUseTheDeviceLocaleAndZone() {
        val offline = DeviceFormat.parse("2026-09-25T01:08:00.000Z")!!
        assertEquals("03:08", DeviceFormat.hhmm(offline, PARIS))
        assertEquals("25/09 03:08", DeviceFormat.dateTime(offline, PARIS))
        assertEquals(Age.Minutes(14), Age.between(NIGHT_NOW, offline))
        assertEquals(Age.JustNow, Age.between(NIGHT_NOW, NIGHT_NOW - 30_000))
        assertEquals(Age.Days(2), Age.between(NIGHT_NOW, DeviceFormat.parse("2026-09-22T07:40:00Z")!!))
        assertEquals("11,4", DeviceFormat.gigabytes(11.4, Locale.FRANCE))
        assertEquals("237", DeviceFormat.gigabytes(237.2, Locale.FRANCE))
        assertEquals("16", DeviceFormat.gigabytes(16.0, Locale.FRANCE))
        assertEquals("2,4" to DeviceFormat.RateUnit.MB, DeviceFormat.rate(2.4 * 1024 * 1024, Locale.FRANCE))
        assertEquals("310" to DeviceFormat.RateUnit.KB, DeviceFormat.rate(310.0 * 1024, Locale.FRANCE))
        assertEquals(98, DeviceFormat.percent(97.6))
        assertNull(DeviceFormat.parse("not a date"))
    }

    @Test fun textPairsOfTheScreensReachFourPointFive() {
        val s = ObliTokens.operator
        // Row text and overlines on bg, chip labels on surface2 and active, card text on surface1.
        val pairs = listOf(
            s.text to s.bg, s.text2 to s.bg, s.textMuted to s.bg,
            s.text2 to s.surface2, s.textMuted to s.surface2, s.text to s.active, s.text2 to s.active,
            s.text to s.surface1, s.text2 to s.surface1, s.textMuted to s.surface1,
            ObliTokens.UNREAD to s.bg, ObliTokens.UNREAD to s.hover,
            ObliTokens.Status.PENDING_UNINSTALL.argb to s.surface1,
        ) + ObliTokens.Status.entries.map { it.argb to Contrast.blend(Contrast.withAlpha(it.argb, 0.12), s.bg) } +
            ObliTokens.Status.entries.map { it.argb to s.bg }
        pairs.forEach { (fg, bg) ->
            val r = Contrast.ratio(fg, bg)
            assertTrue("0x${fg.toString(16)} on 0x${bg.toString(16)} = $r", r >= 4.5)
        }
    }
}
