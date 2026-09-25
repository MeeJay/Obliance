package tools.obli.obliance.triage

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ForbiddenReason
import tools.obli.core.security.ActionResult
import tools.obli.core.security.Tier
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.sample.SampleData

/**
 * Enrolments in À traiter (design doc §5 S10, S12, §2.10 item 4, §2.3, §7.6
 * T1) and the TriageRequest routing, over the §4 sample services and a
 * network-free source that answers like device.routes.ts.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnrolmentViewModelTest {
    private val main = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(main)

    @After fun tearDown() = Dispatchers.resetMain()

    private class Started(val vm: TriageViewModel, val events: MutableList<TriageEvent>)

    private fun TestScope.start(services: ObliServices, source: EnrolmentsSource): Started {
        val vm = TriageViewModel(services, clock = { NIGHT_NOW }, detachedScope = backgroundScope, enrolmentsSource = source)
        val events = mutableListOf<TriageEvent>()
        backgroundScope.launch { vm.ui.collect {} }
        backgroundScope.launch { vm.events.collect { events += it } }
        advanceUntilIdle()
        runCurrent()
        return Started(vm, events)
    }

    private fun TestScope.settle() {
        advanceUntilIdle()
        runCurrent() // background collectors (events) run on runCurrent, not advanceUntilIdle
    }

    private val TriageViewModel.kiosk: EnrolmentItemUi
        get() = ui.value.enrolment(EnrolmentKey(SampleData.PROD, 240))!!

    @Test fun segmentShowsTheProdEnrolmentUnderItsServerAndTenant() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        val ui = s.vm.ui.value
        assertTrue(ui.showEnrolments)
        assertEquals(1, ui.enrolmentCount)
        val group = ui.enrolmentGroups.single()
        assertEquals("Obliance Prod", group.serverName)
        assertEquals("ACME", group.tenantName)
        assertEquals("KIOSK-ACCUEIL-02", group.items.single().label)
        assertEquals("Site Siège", group.items.single().keyName)
    }

    @Test fun approveFromTheMasterSessionSwitchesThatServersTenantFirst() = runTest(main) {
        val services = EnrolServices()
        val source = FakeEnrolments(services, services.log)
        val s = start(services, source)
        assertEquals(SampleData.DEFAULT_TENANT, services.sessionTenant(SampleData.PROD))
        val prompter = RecordingPrompter(services.log)

        s.vm.approveEnrolment(s.vm.kiosk, testRunner(prompter), TestWording)
        settle()

        // T1 naming the device and « Serveur › Tenant » (3 servers configured).
        val spec = prompter.confirmed.single()
        assertEquals(Tier.T1, spec.tier)
        assertEquals("Approuver l'enrôlement", spec.title)
        assertEquals("KIOSK-ACCUEIL-02", spec.target)
        assertEquals("Obliance Prod › ACME", spec.scope)
        assertEquals(listOf("ACME"), prompter.switches)
        // The switch of THAT server completed before the approval was sent on its session.
        val steps = services.log.filter { it.startsWith("switch") || it.startsWith("approve") }
        assertEquals(listOf("switch 4 ${SampleData.PROD.value}", "approve ${SampleData.PROD.value} 240"), steps)
        assertTrue(source.mutations.all { it.serverId == SampleData.PROD })
        assertEquals(SampleData.PROD, services.registry.state.value.activeId)
        // Success: the card left the list, « KIOSK-ACCUEIL-02 approuvé ».
        assertNull(s.vm.ui.value.enrolment(EnrolmentKey(SampleData.PROD, 240)))
        assertEquals(TriageEvent.Enrolment(EnrolmentOutcome.Approved("KIOSK-ACCUEIL-02")), s.events.last())
    }

    @Test fun refusingTheTenantSwitchSendsNothing() = runTest(main) {
        val services = EnrolServices()
        val source = FakeEnrolments(services)
        val s = start(services, source)
        s.vm.approveEnrolment(s.vm.kiosk, testRunner(RecordingPrompter(accept = false)), TestWording)
        settle()
        assertTrue(source.mutations.isEmpty())
        assertEquals(SampleData.DEFAULT_TENANT, services.sessionTenant(SampleData.PROD))
        assertNotNull(s.vm.ui.value.enrolment(EnrolmentKey(SampleData.PROD, 240)))
        assertTrue(s.events.isEmpty())
    }

    @Test fun anAnswerStillPendingIsAFailure() = runTest(main) {
        val services = EnrolServices().inTenant(SampleData.PROD, SampleData.ACME_TENANT)
        val source = FakeEnrolments(services).apply { decideAnswer = { _, _ -> ApiOutcome.Ok(DeviceAnswer(KIOSK)) } }
        val s = start(services, source)
        s.vm.approveEnrolment(s.vm.kiosk, testRunner(RecordingPrompter()), TestWording)
        settle()
        assertEquals(1, source.mutations.size)
        assertEquals(TriageEvent.Enrolment(EnrolmentOutcome.NotApplied), s.events.last())
        assertNotNull(s.vm.ui.value.enrolment(EnrolmentKey(SampleData.PROD, 240)))
    }

    @Test fun aNullDeviceIsAFailureToo() = runTest(main) {
        val services = EnrolServices().inTenant(SampleData.PROD, SampleData.ACME_TENANT)
        val source = FakeEnrolments(services).apply { decideAnswer = { _, _ -> ApiOutcome.Ok(DeviceAnswer(null)) } }
        val s = start(services, source)
        s.vm.refuseEnrolment(s.vm.kiosk, testRunner(RecordingPrompter()), TestWording)
        settle()
        assertEquals(TriageEvent.Enrolment(EnrolmentOutcome.NotApplied), s.events.last())
    }

    @Test fun forbiddenIsReportedWithItsOutcome() = runTest(main) {
        val services = EnrolServices().inTenant(SampleData.PROD, SampleData.ACME_TENANT)
        val forbidden = ApiOutcome.Forbidden(ForbiddenReason.OTHER, "Insufficient permissions")
        val source = FakeEnrolments(services).apply { decideAnswer = { _, _ -> forbidden } }
        val s = start(services, source)
        s.vm.approveEnrolment(s.vm.kiosk, testRunner(RecordingPrompter()), TestWording)
        settle()
        assertEquals(TriageEvent.Enrolment(EnrolmentOutcome.Failed(ActionResult.Failed(forbidden))), s.events.last())
        assertNotNull(s.vm.ui.value.enrolment(EnrolmentKey(SampleData.PROD, 240)))
    }

    @Test fun refuseIsT1AndPostsRefuse() = runTest(main) {
        val services = EnrolServices().inTenant(SampleData.PROD, SampleData.ACME_TENANT)
        val source = FakeEnrolments(services)
        val s = start(services, source)
        val prompter = RecordingPrompter()
        s.vm.refuseEnrolment(s.vm.kiosk, testRunner(prompter), TestWording)
        settle()
        val spec = prompter.confirmed.single()
        assertEquals(Tier.T1, spec.tier)
        assertEquals("Refuser l'enrôlement", spec.title)
        assertEquals("L'agent sera refusé et suspendu.", spec.consequence)
        assertTrue(prompter.switches.isEmpty())
        assertEquals(listOf(EnrolCall(SampleData.PROD, "refuse", 240, extra = kotlinx.serialization.json.JsonObject(emptyMap()))), source.mutations)
        assertEquals(TriageEvent.Enrolment(EnrolmentOutcome.Refused("KIOSK-ACCUEIL-02")), s.events.last())
    }

    @Test fun approveAllSendsOneBulkCallWithExactlyThatSectionsIds() = runTest(main) {
        val services = EnrolServices()
        val source = FakeEnrolments(services, services.log, pending = mapOf(SampleData.PROD to listOf(KIOSK, ATELIER, HV01, BOB01)))
        val s = start(services, source)
        val groups = s.vm.ui.value.enrolmentGroups
        // Two « Serveur › Tenant » sections on Obliance Prod, master tenant first.
        assertEquals(listOf("Default", "ACME"), groups.map { it.tenantName })
        assertTrue(groups.all { it.canBulk })
        val acme = groups.single { it.tenantName == "ACME" }
        val prompter = RecordingPrompter(services.log)

        s.vm.approveAllEnrolments(acme, testRunner(prompter), TestWording)
        settle()

        val bulk = source.mutations.single()
        assertEquals("bulk", bulk.what)
        assertEquals(SampleData.PROD, bulk.serverId)
        assertEquals(setOf(240L, 241L), bulk.ids.toSet())
        assertEquals(2, bulk.ids.size)
        val spec = prompter.confirmed.single()
        assertEquals(Tier.T1, spec.tier)
        assertEquals("Approuver 2 appareils", spec.title)
        assertEquals("2 appareils", spec.target)
        assertEquals(2, spec.targetCount)
        assertEquals(listOf("ACME"), prompter.switches)
        assertTrue(services.log.indexOf("switch 4 ${SampleData.PROD.value}") < services.log.indexOfFirst { it.startsWith("bulk") })
        assertEquals(TriageEvent.Enrolment(EnrolmentOutcome.ApprovedMany(2)), s.events.last())
        assertTrue(s.vm.ui.value.enrolmentGroups.none { g -> g.items.any { it.device.id == 240L || it.device.id == 241L } })
    }

    @Test fun approveAllStillPendingAfterTheReloadIsAFailure() = runTest(main) {
        // The bulk route answers {success, count} without device state: the reload is the proof.
        val services = EnrolServices().inTenant(SampleData.PROD, SampleData.ACME_TENANT)
        val source = FakeEnrolments(services, pending = mapOf(SampleData.PROD to listOf(KIOSK, ATELIER))).apply { bulkIgnored = true }
        val s = start(services, source)
        val acme = s.vm.ui.value.enrolmentGroups.single()
        s.vm.approveAllEnrolments(acme, testRunner(RecordingPrompter()), TestWording)
        settle()
        assertEquals(1, source.mutations.size)
        assertEquals(TriageEvent.Enrolment(EnrolmentOutcome.NotApplied), s.events.last())
        assertEquals(2, s.vm.ui.value.enrolmentCount)
    }

    @Test fun approveAndMoveApprovesThenPatchesTheGroup() = runTest(main) {
        val services = EnrolServices().inTenant(SampleData.PROD, SampleData.ACME_TENANT)
        val source = FakeEnrolments(services, services.log)
        val s = start(services, source)
        s.vm.openEnrolment(s.vm.kiosk)
        settle()
        val review = s.vm.enrolReview.value!!
        assertEquals("Siège › Accueil", review.keyGroupPath)
        val target = review.choices.single { it.path == "Siège › Accueil" }
        assertTrue(target.isKeyDefault)
        assertTrue(review.choices.none { it.path.startsWith("Infra") }) // other tenant's groups are not offered
        val prompter = RecordingPrompter(services.log)

        s.vm.enrolmentStep(EnrolmentStep.PICK_GROUP)
        s.vm.approveAndMove(review.item, target, testRunner(prompter), TestWording)
        settle()

        assertEquals(listOf("approve", "move"), source.mutations.map { it.what })
        assertEquals(44L, source.mutations[1].groupId)
        assertTrue(source.mutations.all { it.serverId == SampleData.PROD && it.deviceId == 240L })
        // One confirmation (T1 naming the group); the PATCH is covered by it.
        assertEquals(listOf("Approuver et déplacer vers Siège › Accueil"), prompter.confirmed.map { it.title })
        assertEquals(Tier.T1, prompter.confirmed.single().tier)
        assertNull(s.vm.enrolReview.value)
        assertEquals(TriageEvent.Enrolment(EnrolmentOutcome.ApprovedAndMoved("KIOSK-ACCUEIL-02", "Siège › Accueil")), s.events.last())
    }

    @Test fun aFailureSentFromTheSheetStaysInTheSheet() = runTest(main) {
        val services = EnrolServices().inTenant(SampleData.PROD, SampleData.ACME_TENANT)
        val source = FakeEnrolments(services).apply { decideAnswer = { _, _ -> ApiOutcome.Ok(DeviceAnswer(KIOSK)) } }
        val s = start(services, source)
        s.vm.openEnrolment(s.vm.kiosk)
        settle()
        s.vm.approveEnrolment(s.vm.enrolReview.value!!.item, testRunner(RecordingPrompter()), TestWording)
        settle()
        assertEquals(EnrolmentOutcome.NotApplied, s.vm.enrolReview.value?.problem)
        assertTrue(s.events.none { it is TriageEvent.Enrolment })
    }

    @Test fun anExpiredServerKeepsItsCardsGreyed() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        services.base.sessions.session(SampleData.PROD)!!.markExpired()
        settle()
        val ui = s.vm.ui.value
        assertTrue(ui.showEnrolments)
        val item = ui.enrolment(EnrolmentKey(SampleData.PROD, 240))!!
        assertEquals(EnrolmentStale.Expired, item.stale)
        assertFalse(item.actionable)
        assertEquals(listOf("Obliance Prod"), ui.enrolmentNotices.map { it.server.displayName })
        assertTrue(ui.enrolmentNotices.single() is FeedNotice.Expired)
    }

    @Test fun unreachableServerKeepsItsLastItems() = runTest(main) {
        val services = EnrolServices()
        val source = FakeEnrolments(services)
        val s = start(services, source)
        source.pendingAnswer[SampleData.PROD] = FAILURE
        s.vm.refresh()
        settle()
        val item = s.vm.ui.value.enrolment(EnrolmentKey(SampleData.PROD, 240))!!
        // Last successful load kept: « Injoignable depuis 03:24 ».
        assertEquals(EnrolmentStale.Unreachable(NIGHT_NOW), item.stale)
        assertTrue(s.vm.ui.value.enrolmentNotices.single() is FeedNotice.Unreachable)
    }

    @Test fun teamMemberWithoutTheRightHasNoSegment() = runTest(main) {
        // Karim is a team member (no platform admin) everywhere, without agent_config:approval.
        val services = EnrolServices()
        SampleData.profiles.forEach { p ->
            services.base.sessions.session(p.id)!!.markSignedIn(SampleData.probe(p.id).copy(user = SampleData.karimLocal))
        }
        val source = FakeEnrolments(services)
        val s = start(services, source)
        assertFalse(s.vm.ui.value.showEnrolments)
        assertTrue(source.calls.none { it.what == "pending" })
        // With the capability (asked once per server and tenant), the segment comes back.
        source.capabilities = mapOf(SampleData.PROD to listOf(CAP_APPROVAL))
        services.base.sessions.session(SampleData.PROD)!!.markSignedIn(
            SampleData.probe(SampleData.PROD).copy(user = SampleData.karimLocal, currentTenantId = SampleData.ACME_TENANT),
        )
        settle()
        assertTrue(s.vm.ui.value.showEnrolments)
        assertEquals(1, s.vm.ui.value.enrolmentCount)
    }

    @Test fun serverChipFiltersEnrolments() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        s.vm.selectSegment(TriageSegment.ENROLMENTS)
        s.vm.selectServer(SampleData.DEV)
        settle()
        assertEquals(TriageSegment.ENROLMENTS, s.vm.ui.value.segment)
        assertTrue(s.vm.ui.value.enrolmentGroups.isEmpty())
        assertEquals(listOf(1, 0, 0), s.vm.ui.value.serverChips.map { it.pending })
        s.vm.selectServer(SampleData.PROD)
        settle()
        assertEquals(1, s.vm.ui.value.enrolmentCount)
    }

    // --- TriageRequest --------------------------------------------------------------

    @Test fun approvalRequestOpensTheReviewSheet() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        assertTrue(s.vm.handle(TriageRequest.Approval(SampleData.PROD, 17)))
        settle()
        assertEquals(TriageSegment.APPROVALS, s.vm.ui.value.segment)
        assertEquals(17L, s.vm.review.value?.item?.approval?.id)
    }

    @Test fun approvalRequestWaitsForTheFeed() = runTest(main) {
        val services = TestServices(snapshot = AlertsSnapshot())
        val s = start(services, EnrolmentsSource.None)
        s.vm.handle(TriageRequest.Approval(SampleData.PROD, 17))
        advanceTimeBy(3_000)
        runCurrent()
        assertNull(s.vm.review.value)
        assertEquals(1, services.recording.refreshes) // the feed is reloaded at once
        services.recording.state.update { it.copy(escalations = SampleData.escalations) }
        runCurrent()
        assertEquals(17L, s.vm.review.value?.item?.approval?.id)
        assertTrue(s.events.none { it is TriageEvent.RequestGone })
    }

    @Test fun approvalRequestGoneAfterTenSeconds() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        s.vm.handle(TriageRequest.Approval(SampleData.PROD, 99))
        advanceTimeBy(TriageViewModel.REQUEST_WAIT_MS - 100)
        runCurrent()
        assertTrue(s.events.isEmpty())
        advanceTimeBy(200)
        runCurrent()
        assertNull(s.vm.review.value)
        assertEquals(TriageEvent.RequestGone(enrolment = false), s.events.single())
    }

    @Test fun enrolmentRequestOpensS12ForTheDevice() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        s.vm.selectServer(SampleData.QUAL) // a filter hiding the item is dropped
        s.vm.handle(TriageRequest.Enrolment(SampleData.PROD, 240))
        settle()
        assertEquals(TriageSegment.ENROLMENTS, s.vm.ui.value.segment)
        assertNull(s.vm.ui.value.serverFilter)
        assertEquals(EnrolmentKey(SampleData.PROD, 240), s.vm.enrolReview.value?.key)
    }

    @Test fun enrolmentRequestGoneWhenNotPending() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        s.vm.handle(TriageRequest.Enrolment(SampleData.PROD, 999))
        settle()
        assertNull(s.vm.enrolReview.value)
        assertEquals(TriageEvent.RequestGone(enrolment = true), s.events.single())
    }

    @Test fun alertsRequestSelectsThatServerChip() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        s.vm.selectSegment(TriageSegment.ENROLMENTS)
        s.vm.handle(TriageRequest.Alerts(SampleData.QUAL))
        settle()
        assertEquals(TriageSegment.ALERTS, s.vm.ui.value.segment)
        assertEquals(SampleData.QUAL, s.vm.ui.value.serverFilter?.id)
        assertEquals(listOf("SRV-QUAL01"), s.vm.ui.value.unread.map { it.deviceName })
        s.vm.handle(TriageRequest.Alerts(null))
        settle()
        assertNull(s.vm.ui.value.serverFilter)
    }

    @Test fun theSameRequestIsHandledOnce() = runTest(main) {
        val services = EnrolServices()
        val s = start(services, FakeEnrolments(services))
        val request = TriageRequest.Alerts(SampleData.QUAL)
        assertTrue(s.vm.handle(request))
        assertFalse(s.vm.handle(request))
        // An equal but new request (another tap) is handled again.
        assertTrue(s.vm.handle(TriageRequest.Alerts(SampleData.QUAL)))
    }
}
