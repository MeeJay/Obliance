package tools.obli.obliance.triage

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices
import tools.obli.obliance.domain.AlertCategory
import tools.obli.shell.alerts.AlertSeverity

class TriageMapperTest {
    private val services = SampleObliServices()
    private val registry: ServerRegistryState = services.registry.state.value
    private val scope: TenantScope = services.tenants.scope.value
    private val snapshot: AlertsSnapshot = services.alerts.snapshot.value
    private val prodDevices: Map<DeviceRef, Device> = SampleData.devices.associateBy { DeviceRef(SampleData.PROD, it.id) }

    private fun map(
        snap: AlertsSnapshot = snapshot,
        reg: ServerRegistryState = registry,
        local: LocalState = LocalState(),
        admin: Boolean = true,
        live: Boolean = true,
        tenant: TenantScope = scope,
        devices: Map<DeviceRef, Device> = prodDevices,
    ) = TriageMapper.map(snap, reg, tenant, admin, live, local, devices, NIGHT_NOW)

    @Test fun unreadFollowsTheComputedPriorityOfSection4() {
        val ui = map()
        assertEquals(
            listOf("SRV-AD2", "PC-COMPTA-03", "SRV-QUAL01", "BOB01", "NAS-DEV01", "SRV-FILES01", "140"),
            ui.unread.map { it.deviceName },
        )
        assertEquals(ListState.CONTENT, ui.listState)
        assertEquals(7, ui.alertCount)
        assertTrue(ui.multiServer)
        // Every card carries its server tile when 2+ servers are configured.
        assertEquals("OQ", ui.unread[2].server?.monogram)
    }

    @Test fun singleServerHasNoTilesAndNoServerChips() {
        val one = SampleObliServices(serverCount = 1)
        val ui = TriageMapper.map(one.alerts.snapshot.value, one.registry.state.value, one.tenants.scope.value, true, true, LocalState(), prodDevices, NIGHT_NOW)
        assertFalse(ui.multiServer)
        assertTrue(ui.serverChips.isEmpty())
        assertTrue(ui.unread.all { it.server == null })
        assertTrue(ui.unread.none { it.alert.serverId != SampleData.PROD })
    }

    @Test fun liveLineOnlyForTheActiveServerAndVisibleTenants() {
        val ui = map()
        val byName = ui.unread.associateBy { it.deviceName }
        assertEquals(LiveLine.OtherServer, byName.getValue("SRV-QUAL01").live)
        assertEquals(LiveLine.OtherServer, byName.getValue("NAS-DEV01").live)
        assertEquals(LiveLine.State(DeviceStatus.OFFLINE, null, AlertCategory.OFFLINE), byName.getValue("SRV-AD2").live)
        assertEquals(LiveLine.State(DeviceStatus.CRITICAL, Reading(MetricKind.CPU, null, 98), AlertCategory.METRIC), byName.getValue("PC-COMPTA-03").live)
        assertEquals(LiveLine.State(DeviceStatus.WARNING, Reading(MetricKind.DISK, "/", 94), AlertCategory.METRIC), byName.getValue("BOB01").live)

        // Session in the ACME tenant (not the global view): Default devices say "open to check".
        val acme = scope.copy(currentTenantId = SampleData.ACME_TENANT)
        val inAcme = map(tenant = acme).unread.associateBy { it.deviceName }
        assertEquals(LiveLine.OtherTenant, inAcme.getValue("BOB01").live)
        assertTrue(inAcme.getValue("SRV-AD2").live is LiveLine.State)
    }

    @Test fun liveDevicesAreTheActiveServersVisibleDevicesOnly() {
        val refs = TriageMapper.liveDevices(snapshot, registry, scope)
        assertTrue(refs.all { it.serverId == SampleData.PROD })
        assertEquals(listOf(211L, 187L, 15L, 30L, 140L), refs.map { it.deviceId })
        val acme = TriageMapper.liveDevices(snapshot, registry, scope.copy(currentTenantId = SampleData.ACME_TENANT))
        assertEquals(listOf(211L, 187L), acme.map { it.deviceId })
    }

    @Test fun expiredAndUnreachableServersKeepTheirCardsWithAMention() {
        val snap = snapshot.copy(feeds = feeds(SampleData.PROD to FeedStatus.OK, SampleData.DEV to FeedStatus.UNREACHABLE, SampleData.QUAL to FeedStatus.EXPIRED))
        val ui = map(snap = snap)
        val byName = ui.unread.associateBy { it.deviceName }
        assertEquals(LiveLine.SessionExpired, byName.getValue("SRV-QUAL01").live)
        assertEquals(LiveLine.Unreachable, byName.getValue("NAS-DEV01").live)
        assertEquals(listOf("Obliance Dev", "Obliance Qual"), ui.notices.map { it.server.displayName })
        assertTrue(ui.notices[0] is FeedNotice.Unreachable)
        assertTrue(ui.notices[1] is FeedNotice.Expired)
        assertEquals(Freshness.STALE, ui.freshness)
        assertFalse(ui.offline)
    }

    @Test fun everyServerUnreachableIsOfflineWithCacheOrErrorWithout() {
        val all = feeds(SampleData.PROD to FeedStatus.UNREACHABLE, SampleData.DEV to FeedStatus.UNREACHABLE, SampleData.QUAL to FeedStatus.UNREACHABLE)
        val cached = map(snap = snapshot.copy(feeds = all))
        assertTrue(cached.offline)
        assertEquals(ListState.CONTENT, cached.listState)
        assertTrue(cached.notices.isEmpty())
        assertTrue(cached.unread.none { it.canDelete })

        val never = map(snap = AlertsSnapshot(feeds = feeds(SampleData.PROD to FeedStatus.UNREACHABLE, updatedAt = null)))
        assertEquals(ListState.ERROR, never.listState)
    }

    @Test fun loadingEmptyAndFilteredStates() {
        val loading = map(snap = AlertsSnapshot(feeds = feeds(SampleData.PROD to FeedStatus.LOADING, SampleData.DEV to FeedStatus.LOADING, SampleData.QUAL to FeedStatus.LOADING)))
        assertEquals(ListState.LOADING, loading.listState)

        val empty = map(snap = AlertsSnapshot(feeds = feeds(SampleData.PROD to FeedStatus.OK), updatedAt = NIGHT_NOW))
        assertEquals(ListState.EMPTY, empty.listState)
        assertEquals(Freshness.LIVE, empty.freshness)

        // Only info alerts left, filter on critical: the chips say why the list is empty.
        val filtered = map(local = LocalState(severities = setOf(AlertSeverity.CRITICAL)), snap = snapshot.copy(alerts = snapshot.alerts.filter { it.alert.severity == AlertSeverity.INFO }))
        assertTrue(filtered.filteredOut)
        assertTrue(filtered.unread.isEmpty())
    }

    @Test fun severityChipsCountUnreadAndFilter() {
        val ui = map(local = LocalState(severities = setOf(AlertSeverity.CRITICAL)))
        assertEquals(listOf(3, 3, 1), ui.severityChips.map { it.count })
        assertEquals(listOf(true, false, false), ui.severityChips.map { it.selected })
        assertEquals(listOf("SRV-AD2", "PC-COMPTA-03", "SRV-QUAL01"), ui.unread.map { it.deviceName })
    }

    @Test fun serverFilterKeepsOneServerButEscalationsStayGlobal() {
        val ui = map(local = LocalState(serverFilter = SampleData.QUAL))
        assertEquals(listOf("SRV-QUAL01"), ui.unread.map { it.deviceName })
        assertEquals("Obliance Qual", ui.serverFilter?.displayName)
        assertEquals(1, ui.escalations.size)
        assertEquals(0, ui.approvals.size)
        assertEquals(listOf(SampleData.QUAL), ui.markAllServers)
        assertEquals(listOf(5, 1, 1), ui.serverChips.map { it.unread })
    }

    @Test fun approvalsOnlyForPlatformAdmins() {
        val admin = map()
        assertTrue(admin.showApprovals)
        assertEquals(1, admin.approvalCount)
        assertEquals("ACME", admin.escalations.single().tenantName)
        val user = map(admin = false, local = LocalState(segment = TriageSegment.APPROVALS))
        assertFalse(user.showApprovals)
        assertEquals(TriageSegment.ALERTS, user.segment)
        assertTrue(user.escalations.isEmpty())
    }

    @Test fun expiredRequestsLeaveTheListAndTheCounts() {
        // 01:52Z: the §4 request expired at 01:51:08Z (the server never sweeps it, it stays "pending").
        val later = java.time.Instant.parse("2026-09-25T01:52:00Z").toEpochMilli()
        val ui = TriageMapper.map(snapshot, registry, scope, true, true, LocalState(), emptyMap(), later)
        assertTrue(ui.escalations.isEmpty())
        assertTrue(ui.approvals.isEmpty())
        assertEquals(0, ui.approvalCount)
    }

    @Test fun tenantNameOfAnotherServersRequestComesFromItsAlerts() {
        val qualRequest = snapshot.escalations.single().let { it.copy(serverId = SampleData.QUAL) }
        val qualAlert = snapshot.alerts.first { it.serverId == SampleData.QUAL }
        val tenantId = qualAlert.alert.tenantId!!
        val ui = map(snap = snapshot.copy(escalations = listOf(qualRequest.copy(approval = qualRequest.approval.copy(tenantId = tenantId)))))
        assertEquals(qualAlert.alert.tenantName, ui.escalations.single().tenantName)
    }

    @Test fun pendingDeletesAreHiddenAtOnce() {
        val first = snapshot.alerts.first()
        val ui = map(local = LocalState(pendingDeletes = setOf(first.key)))
        assertTrue(ui.unread.none { it.key == first.key })
        assertEquals(6, ui.unread.size)
    }

    @Test fun newAlertsAreHeldBackWhileScrolled() {
        val shown = snapshot.alerts.drop(1).map { it.key }.toSet()
        val scrolled = map(local = LocalState(atTop = false, acknowledged = shown))
        assertEquals(1, scrolled.heldBack)
        assertEquals(6, scrolled.unread.size)
        val atTop = map(local = LocalState(atTop = true, acknowledged = shown))
        assertEquals(0, atTop.heldBack)
        assertEquals(7, atTop.unread.size)
    }

    @Test fun readSectionKeepsTheLast24Hours() {
        val recent = snapshot.alerts[0].let { it.copy(alert = it.alert.copy(readAt = "2026-09-25T01:20:00Z")) }
        val old = snapshot.alerts[1].let { it.copy(alert = it.alert.copy(readAt = "2026-09-25T01:20:00Z", createdAt = "2026-09-23T20:00:00Z")) }
        val ui = map(snap = snapshot.copy(alerts = listOf(recent, old) + snapshot.alerts.drop(2)))
        assertEquals(listOf(recent.key), ui.read.map { it.key })
        assertFalse(ui.read.single().unread)
    }

    @Test fun siteOutageNeverMixesServers() {
        val outage = listOf(
            offlineAlert(9801, "SRV-AD2", 211, "2026-09-25T01:07:10Z"),
            offlineAlert(9802, "SRV-LEGACY", 205, "2026-09-25T01:08:05Z"),
            offlineAlert(9803, "PC-ATELIER-02", 233, "2026-09-25T01:09:00Z"),
            offlineAlert(513, "SRV-QUAL01", 5, "2026-09-25T01:08:30Z", server = SampleData.QUAL, tenant = SampleData.DEFAULT_TENANT),
        )
        val ui = map(snap = snapshot.copy(alerts = outage))
        val o = ui.outages.single()
        assertEquals(SampleData.PROD, o.outage.serverId)
        assertEquals("ACME", o.tenantName)
        assertEquals(listOf("SRV-AD2" to 211L, "SRV-LEGACY" to 205L, "PC-ATELIER-02" to 233L), o.devices)
    }

    @Test fun deviceIdComesFromNavigateTo() {
        val a = snapshot.alerts.first()
        assertEquals(211L, a.deviceId())
        assertEquals(12L, a.copy(alert = a.alert.copy(navigateTo = "/devices/12?tab=processes")).deviceId())
        assertNull(a.copy(alert = a.alert.copy(navigateTo = "/scripts/12")).deviceId())
        assertNull(a.copy(alert = a.alert.copy(navigateTo = "https://elsewhere.example.org/devices/12")).deviceId())
        assertNull(a.copy(alert = a.alert.copy(navigateTo = null)).deviceId())
    }

    @Test fun readingIsTheMetricNamedByTheMessage() {
        val compta = SampleData.devices.first { it.hostname == "PC-COMPTA-03" }
        assertEquals(Reading(MetricKind.CPU, null, 98), TriageMapper.reading("CPU 98 % (seuil 90 %)", compta))
        assertEquals(Reading(MetricKind.RAM, null, 72), TriageMapper.reading("RAM 95 % (seuil 90 %)", compta))
        assertEquals(Reading(MetricKind.DISK, "C:", 42), TriageMapper.reading("Disque C: 97 %", compta))
        assertNull(TriageMapper.reading("Disque 1 : 5 secteurs réalloués", compta))
    }

    @Test fun realtimeDownIsNotLive() {
        assertEquals(Freshness.UPDATED, map(live = false).freshness)
        assertEquals(Freshness.LIVE, map(live = true).freshness)
    }

    @Test fun sampleDetailAnswersForProdDevices() = runBlocking {
        // The screen asks the device of an alert on the ALERT'S server.
        assertTrue(services.devices.detail(SampleData.PROD, 211) is ApiOutcome.Ok)
    }
}
