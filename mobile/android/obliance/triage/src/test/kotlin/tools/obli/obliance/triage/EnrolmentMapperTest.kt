package tools.obli.obliance.triage

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.elementNames
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.auth.ServerRegistryState
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

class EnrolmentMapperTest {
    private val services = SampleObliServices()
    private val registry: ServerRegistryState = services.registry.state.value
    private val scope: TenantScope = services.tenants.scope.value
    private val snapshot: AlertsSnapshot = services.alerts.snapshot.value

    private val prod = ServerEnrolments(
        SampleData.PROD, FeedStatus.OK, canApprove = true, sessionTenantId = SampleData.DEFAULT_TENANT,
        items = listOf(KIOSK), keys = SampleEnrolmentsSource.KEYS.associateBy { it.id }, updatedAt = NIGHT_NOW,
    )
    private val devAllowedEmpty = ServerEnrolments(SampleData.DEV, FeedStatus.OK, canApprove = true, updatedAt = NIGHT_NOW)
    private val qualNotAllowed = ServerEnrolments(SampleData.QUAL, FeedStatus.OK, canApprove = false, updatedAt = NIGHT_NOW)

    private fun map(state: EnrolmentsState, local: LocalState = LocalState(segment = TriageSegment.ENROLMENTS), reg: ServerRegistryState = registry) =
        TriageMapper.map(snapshot, reg, scope, true, true, local, emptyMap(), NIGHT_NOW, state)

    @Test fun segmentCountsOneWhenAServerAllowsApproval() {
        val ui = map(EnrolmentsState(listOf(prod, devAllowedEmpty, qualNotAllowed)))
        assertTrue(ui.showEnrolments)
        assertEquals(TriageSegment.ENROLMENTS, ui.segment)
        assertEquals(1, ui.enrolmentCount)
        assertEquals(ListState.CONTENT, ui.enrolmentState)
    }

    @Test fun segmentIsAbsentWhenNoServerAllowsApproval() {
        val none = EnrolmentsState(listOf(prod.copy(canApprove = false, items = emptyList()), devAllowedEmpty.copy(canApprove = false), qualNotAllowed))
        val ui = map(none)
        assertFalse(ui.showEnrolments)
        assertEquals(0, ui.enrolmentCount)
        // A remembered choice of the hidden segment falls back to Alertes.
        assertEquals(TriageSegment.ALERTS, ui.segment)
        // Nothing loaded yet: hidden too.
        assertFalse(map(EnrolmentsState()).showEnrolments)
    }

    @Test fun itemsAreGroupedUnderServerAndTenant() {
        val ui = map(EnrolmentsState(listOf(prod, devAllowedEmpty, qualNotAllowed)))
        val group = ui.enrolmentGroups.single()
        assertEquals("Obliance Prod", group.serverName)
        assertEquals("OP", group.server?.monogram)
        assertEquals("ACME", group.tenantName)
        assertEquals(SampleData.ACME_TENANT, group.tenantId)
        val item = group.items.single()
        assertEquals("KIOSK-ACCUEIL-02", item.label)
        assertEquals("Site Siège", item.keyName)
        assertEquals("Accueil", item.keyDefaultGroupName)
        assertEquals("Obliance Prod", item.serverName)
        assertNull(item.stale)
        assertTrue(item.actionable)
        // One section: « Tout approuver » needs two devices.
        assertFalse(group.canBulk)
    }

    @Test fun singleServerShowsTheTenantOnly() {
        val one = SampleObliServices(serverCount = 1)
        val ui = TriageMapper.map(one.alerts.snapshot.value, one.registry.state.value, one.tenants.scope.value, true, true, LocalState(), emptyMap(), NIGHT_NOW, EnrolmentsState(listOf(prod)))
        val group = ui.enrolmentGroups.single()
        assertNull(group.server)
        assertNull(group.serverName)
        assertEquals("ACME", group.tenantName)
        assertNull(group.items.single().server)
    }

    @Test fun serverChipFiltersEnrolmentsAndCountsThem() {
        val state = EnrolmentsState(listOf(prod, devAllowedEmpty, qualNotAllowed))
        val dev = map(state, LocalState(segment = TriageSegment.ENROLMENTS, serverFilter = SampleData.DEV))
        assertTrue(dev.showEnrolments)
        assertTrue(dev.enrolmentGroups.isEmpty())
        assertEquals(0, dev.enrolmentCount)
        assertEquals(ListState.EMPTY, dev.enrolmentState)
        assertEquals(listOf(1, 0, 0), dev.serverChips.map { it.pending })
        val prodOnly = map(state, LocalState(segment = TriageSegment.ENROLMENTS, serverFilter = SampleData.PROD))
        assertEquals(listOf("KIOSK-ACCUEIL-02"), prodOnly.enrolmentGroups.flatMap { g -> g.items.map { it.label } })
    }

    @Test fun expiredServerKeepsItsItemsGreyedWithANotice() {
        val ui = map(EnrolmentsState(listOf(prod.copy(status = FeedStatus.EXPIRED), devAllowedEmpty)))
        val item = ui.enrolmentGroups.single().items.single()
        assertEquals(EnrolmentStale.Expired, item.stale)
        assertFalse(item.actionable)
        assertTrue(ui.enrolmentNotices.single() is FeedNotice.Expired)
        assertEquals("Obliance Prod", ui.enrolmentNotices.single().server.displayName)

        val unreachable = map(EnrolmentsState(listOf(prod.copy(status = FeedStatus.UNREACHABLE))))
        assertEquals(EnrolmentStale.Unreachable(NIGHT_NOW), unreachable.enrolmentGroups.single().items.single().stale)
    }

    @Test fun signedOutServerLeaves() {
        val ui = map(EnrolmentsState(listOf(prod.copy(status = FeedStatus.SIGNED_OUT, items = emptyList()))))
        assertFalse(ui.showEnrolments)
    }

    @Test fun emptyAndErrorStates() {
        val empty = map(EnrolmentsState(listOf(prod.copy(items = emptyList()))))
        assertTrue(empty.showEnrolments)
        assertEquals(ListState.EMPTY, empty.enrolmentState)
        val never = map(EnrolmentsState(listOf(prod.copy(status = FeedStatus.UNREACHABLE, items = emptyList(), updatedAt = null))))
        assertEquals(ListState.ERROR, never.enrolmentState)
    }

    @Test fun sectionsOrderMasterFirstAndNewestFirst() {
        val state = EnrolmentsState(listOf(prod.copy(items = listOf(KIOSK, ATELIER, HV01, BOB01))))
        val ui = map(state)
        assertEquals(listOf("Default", "ACME"), ui.enrolmentGroups.map { it.tenantName })
        // ATELIER (03:21) before KIOSK (02:59).
        assertEquals(listOf("PC-ATELIER-02", "KIOSK-ACCUEIL-02"), ui.enrolmentGroups[1].items.map { it.label })
        assertTrue(ui.enrolmentGroups.all { it.canBulk })
        // A busy item is not sent again by « Tout approuver ».
        val busy = map(state.copy(busy = setOf(EnrolmentKey(SampleData.PROD, 240))))
        assertEquals(listOf(241L), busy.enrolmentGroups[1].bulk.map { it.device.id })
        assertFalse(busy.enrolmentGroups[1].canBulk)
    }

    @Test fun tenantNameFallsBackToTheActiveServersList() {
        val ui = map(EnrolmentsState(listOf(prod.copy(items = listOf(KIOSK.copy(tenantName = null))))))
        assertEquals("ACME", ui.enrolmentGroups.single().tenantName)
    }

    @Test fun groupPathsFollowParents() {
        val paths = GroupPaths.of(SampleEnrolmentsSource.GROUPS)
        assertEquals("Siège › Accueil", paths[44])
        assertEquals("Infra › Linux", paths[31])
        assertEquals("Siège", paths[40])
        // A cycle is cut, a missing parent ends the path.
        val cyclic = listOf(GroupInfo(1, 4, null, 2, "A"), GroupInfo(2, 4, null, 1, "B"), GroupInfo(3, 4, null, 99, "C"))
        assertEquals("B › A", GroupPaths.of(cyclic)[1])
        assertEquals("C", GroupPaths.of(cyclic)[3])
        val choices = groupChoices(SampleEnrolmentsSource.GROUPS, SampleData.ACME_TENANT, 44)
        assertEquals(listOf("Siège", "Siège › Accueil", "Siège › Atelier", "Siège › Comptabilité", "Siège › Direction", "Siège › Serveurs"), choices.map { it.path })
        assertEquals(listOf(44L), choices.filter { it.isKeyDefault }.map { it.id })
    }

    @Test fun theEnrolmentKeySecretNeverReachesTheUi() {
        val secret = "3f5e0c9a41b27d86e1f04a2b9c7d3e58f6a1b0c2d4e6f8091a2b3c4d5e6f7a8b"
        val payload = """{"success":true,"data":[{"id":12,"tenantId":4,"name":"Site Siège","key":"$secret","defaultGroupId":44,
            "defaultGroupName":"Accueil","createdBy":3,"createdAt":"2026-06-02T08:00:00.000Z","lastUsedAt":null,"deviceCount":17}]}"""
        val keys = ApiJson.unwrapped(ListSerializer(AgentKeyInfo.serializer()))(ApiJson.json.parseToJsonElement(payload))!!
        assertEquals(listOf(AgentKeyInfo(12, 4, "Site Siège", 44, "Accueil")), keys)
        assertFalse("key" in AgentKeyInfo.serializer().descriptor.elementNames)
        val state = EnrolmentsState(listOf(prod.copy(keys = keys.associateBy { it.id })))
        val ui = map(state)
        assertEquals("Site Siège", ui.enrolmentGroups.single().items.single().keyName)
        assertFalse(state.toString().contains(secret))
        assertFalse(ui.toString().contains(secret))
        assertFalse(EnrolmentReviewState(ui.enrolmentGroups.single().items.single()).toString().contains(secret))
    }
}
