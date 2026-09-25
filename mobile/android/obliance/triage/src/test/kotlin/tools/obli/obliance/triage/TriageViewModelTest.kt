package tools.obli.obliance.triage

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.CreationExtras
import kotlin.reflect.KClass
import kotlinx.coroutines.CoroutineScope
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
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices
import tools.obli.obliance.domain.AlertCategory

@OptIn(ExperimentalCoroutinesApi::class)
class TriageViewModelTest {
    private val main = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(main)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.start(services: TestServices = TestServices(), detached: CoroutineScope = backgroundScope): Pair<TriageViewModel, MutableList<TriageEvent>> {
        val vm = TriageViewModel(services, clock = { NIGHT_NOW }, detachedScope = detached)
        val events = mutableListOf<TriageEvent>()
        backgroundScope.launch { vm.ui.collect {} }
        backgroundScope.launch { vm.events.collect { events += it } }
        advanceUntilIdle()
        return vm to events
    }

    private val approveSpec = ActionSpec(TriageViewModel.KEY_APPROVE, Tier.T2, "Approve", "Désinstaller l'agent de PC-ATELIER-02", "Obliance Prod › ACME")
    private val denySpec = ActionSpec(TriageViewModel.KEY_DENY, Tier.T1, "Deny", "Désinstaller l'agent de PC-ATELIER-02", "Obliance Prod › ACME")

    @Test fun liveStateComesFromTheActiveServer() = runTest(main) {
        val (vm, _) = start()
        val byName = vm.ui.value.unread.associateBy { it.deviceName }
        assertEquals(LiveLine.State(DeviceStatus.OFFLINE, null, AlertCategory.OFFLINE), byName.getValue("SRV-AD2").live)
        assertEquals(LiveLine.OtherServer, byName.getValue("SRV-QUAL01").live)
    }

    @Test fun deleteIsSentOnlyAfterTheUndoDelay() = runTest(main) {
        val services = TestServices()
        val (vm, events) = start(services)
        val item = vm.ui.value.unread.first()
        vm.delete(item)
        runCurrent()
        assertTrue(vm.ui.value.unread.none { it.key == item.key })
        assertEquals(TriageEvent.Deleted(item.key), events.single())
        advanceTimeBy(TriageViewModel.UNDO_MS - 100)
        runCurrent()
        assertTrue(services.recording.deleted.isEmpty())
        advanceTimeBy(200)
        runCurrent()
        assertEquals(listOf(item.alert), services.recording.deleted)
        // The call went to the alert's own server (the repository is per item) and nothing switched.
        assertEquals(SampleData.PROD, services.registry.state.value.activeId)
    }

    @Test fun undoKeepsTheAlert() = runTest(main) {
        val services = TestServices()
        val (vm, _) = start(services)
        val item = vm.ui.value.unread[2]
        vm.delete(item)
        runCurrent()
        vm.undoDelete(item.key)
        advanceTimeBy(TriageViewModel.UNDO_MS * 2)
        runCurrent()
        assertTrue(services.recording.deleted.isEmpty())
        assertTrue(vm.ui.value.unread.any { it.key == item.key })
    }

    @Test fun leavingTheScreenSendsPendingDeletions() = runTest(main) {
        val services = TestServices()
        val store = ViewModelStore()
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: KClass<T>, extras: CreationExtras): T =
                TriageViewModel(services, clock = { NIGHT_NOW }, detachedScope = backgroundScope) as T
        }
        val vm = ViewModelProvider.create(store, factory)[TriageViewModel::class]
        backgroundScope.launch { vm.ui.collect {} }
        advanceUntilIdle()
        val item = vm.ui.value.unread.first()
        vm.delete(item)
        runCurrent()
        store.clear()
        advanceUntilIdle()
        assertEquals(listOf(item.alert), services.recording.deleted)
    }

    @Test fun markReadGoesToTheAlertsServer() = runTest(main) {
        val services = TestServices()
        val (vm, _) = start(services)
        val qual = vm.ui.value.unread.first { it.key.serverId == SampleData.QUAL }
        vm.markRead(qual)
        advanceUntilIdle()
        assertEquals(SampleData.QUAL, services.recording.markedRead.single().serverId)
        assertEquals(SampleData.PROD, services.registry.state.value.activeId)
        assertTrue(vm.ui.value.unread.none { it.key == qual.key })
    }

    @Test fun newAlertsWaitInThePillWhileScrolled() = runTest(main) {
        val services = TestServices()
        val (vm, _) = start(services)
        vm.setAtTop(false)
        runCurrent()
        val fresh = offlineAlert(9830, "HV-01", 10, "2026-09-25T01:23:00Z", tenant = SampleData.DEFAULT_TENANT)
        services.recording.state.update { it.copy(alerts = it.alerts + fresh) }
        advanceUntilIdle()
        assertEquals(1, vm.ui.value.heldBack)
        assertTrue(vm.ui.value.unread.none { it.key == fresh.key })
        vm.showHeldBack()
        advanceUntilIdle()
        assertEquals(0, vm.ui.value.heldBack)
        assertTrue(vm.ui.value.unread.any { it.key == fresh.key })
    }

    @Test fun markAllReadCallsEachServer() = runTest(main) {
        val services = TestServices()
        val (vm, events) = start(services)
        vm.markAllRead(vm.ui.value.markAllServers)
        advanceUntilIdle()
        runCurrent() // background collectors (events) run on runCurrent, not advanceUntilIdle
        assertEquals(listOf(SampleData.PROD, SampleData.DEV, SampleData.QUAL), services.recording.markedAll)
        assertEquals(TriageEvent.MarkedAllRead(3), events.last())
    }

    @Test fun approveAsksConfirmationThenCallsTheApprovalsServer() = runTest(main) {
        val services = TestServices().onTheRequestsTenant()
        val (vm, events) = start(services)
        val escalation = vm.ui.value.escalations.single()
        vm.openReview(escalation)
        advanceUntilIdle()
        assertEquals("PC-ATELIER-02", vm.review.value?.target?.label)
        vm.decide(true, approveSpec)
        runCurrent()
        val step = vm.review.value?.step
        assertTrue(step is ReviewStep.Confirm && step.approve)
        assertTrue(services.recording.approved.isEmpty())
        vm.answerConfirm(true)
        advanceUntilIdle()
        assertEquals(escalation.item, services.recording.approved.single().first)
        assertNull(vm.review.value)
        assertEquals(TriageEvent.ApprovalDone(true), events.last())
    }

    @Test fun stepUpCodeIsSentWithTheSameRequest() = runTest(main) {
        val services = TestServices().onTheRequestsTenant()
        services.recording.approveAnswers += ApiOutcome.StepUpRequired("approval_approve", "92.184.107.21")
        val (vm, _) = start(services)
        vm.openReview(vm.ui.value.escalations.single())
        vm.decide(true, approveSpec)
        runCurrent()
        vm.answerConfirm(true)
        advanceUntilIdle()
        assertEquals(ReviewStep.TwoFactor(wrongCode = false), vm.review.value?.step)
        vm.answerCode("123456")
        advanceUntilIdle()
        assertEquals(2, services.recording.approved.size)
        assertEquals(JsonPrimitive("123456"), services.recording.approved[1].second?.get("twoFactorCode"))
        assertNull(vm.review.value)
    }

    @Test fun alreadyResolvedIsExplainedInTheSheet() = runTest(main) {
        val services = TestServices().onTheRequestsTenant()
        services.recording.approveAnswers += ApiOutcome.Unsupported("Approval already resolved")
        val (vm, _) = start(services)
        vm.openReview(vm.ui.value.escalations.single())
        vm.decide(true, approveSpec)
        runCurrent()
        vm.answerConfirm(true)
        advanceUntilIdle()
        assertEquals(ReviewProblem.ALREADY_RESOLVED, vm.review.value?.problem)
        assertEquals(false, vm.review.value?.busy)
    }

    @Test fun cancellingTheConfirmationSendsNothing() = runTest(main) {
        val services = TestServices().onTheRequestsTenant()
        val (vm, _) = start(services)
        vm.openReview(vm.ui.value.escalations.single())
        vm.decide(true, approveSpec)
        runCurrent()
        vm.answerConfirm(false)
        advanceUntilIdle()
        assertTrue(services.recording.approved.isEmpty())
        assertEquals(ReviewStep.Details, vm.review.value?.step)
    }

    @Test fun denyNeedsAReason() = runTest(main) {
        val services = TestServices().onTheRequestsTenant()
        val (vm, events) = start(services)
        vm.openReview(vm.ui.value.escalations.single())
        vm.decide(false, denySpec)
        runCurrent()
        assertEquals(ReviewStep.Details, vm.review.value?.step)
        vm.setReason("Mauvaise cible")
        vm.decide(false, denySpec)
        runCurrent()
        vm.answerConfirm(true)
        advanceUntilIdle()
        assertEquals("Mauvaise cible", services.recording.denied.single().second)
        assertEquals(TriageEvent.ApprovalDone(false), events.last())
    }

    @Test fun childTenantRequestSwitchesItsOwnServerFirst() = runTest(main) {
        // Global view (Default): approve / deny are bound to the session tenant (§2.3).
        val services = TestServices()
        val (vm, events) = start(services)
        val escalation = vm.ui.value.escalations.single()
        vm.openReview(escalation)
        vm.decide(true, approveSpec)
        runCurrent()
        assertEquals(ReviewStep.TenantSwitch("ACME"), vm.review.value?.step)
        assertTrue(services.recording.approved.isEmpty())
        vm.answerConfirm(true) // "Basculer et continuer"
        advanceUntilIdle()
        assertEquals(SampleData.ACME_TENANT, sessionTenant(services, escalation.item.serverId))
        val step = vm.review.value?.step
        assertTrue(step is ReviewStep.Confirm && step.approve)
        vm.answerConfirm(true)
        advanceUntilIdle()
        assertEquals(escalation.item, services.recording.approved.single().first)
        assertEquals(TriageEvent.ApprovalDone(true), events.last())
    }

    @Test fun refusingTheTenantSwitchSendsNothing() = runTest(main) {
        val services = TestServices()
        val (vm, _) = start(services)
        val escalation = vm.ui.value.escalations.single()
        vm.openReview(escalation)
        vm.decide(true, approveSpec)
        runCurrent()
        vm.answerConfirm(false)
        advanceUntilIdle()
        assertEquals(ReviewStep.Details, vm.review.value?.step)
        assertEquals(false, vm.review.value?.busy)
        assertTrue(services.recording.approved.isEmpty())
        assertEquals(SampleData.DEFAULT_TENANT, sessionTenant(services, escalation.item.serverId))
    }

    @Test fun sampleServerRefusesARequestOfAnotherTenant() = runTest(main) {
        // The sample mirrors approval.service.ts, so a missing switch cannot pass unnoticed.
        val sample = SampleObliServices()
        val item = sample.alerts.snapshot.value.escalations.single()
        assertEquals(404, (sample.alerts.approve(item) as ApiOutcome.Failure).status)
        sample.tenants.switchTo(SampleData.ACME_TENANT, item.serverId)
        assertTrue(sample.alerts.approve(item) is ApiOutcome.Ok)
    }

    @Test fun problemMapping() {
        assertEquals(ReviewProblem.ALREADY_RESOLVED, TriageViewModel.problemOf(ApiOutcome.Unsupported("x")))
        assertEquals(ReviewProblem.EXPIRED, TriageViewModel.problemOf(ApiOutcome.Failure(410, tools.obli.core.network.FailureKind.CLIENT)))
        assertEquals(ReviewProblem.SESSION_EXPIRED, TriageViewModel.problemOf(ApiOutcome.SessionExpired))
        assertEquals(ReviewProblem.FAILED, TriageViewModel.problemOf(FAILURE))
    }
}

/** The session of the request's server already works in its tenant (ACME): no switch step. */
private fun TestServices.onTheRequestsTenant(): TestServices = apply {
    val session = base.sessions.session(SampleData.PROD)!!
    session.markSignedIn(SampleData.probe(SampleData.PROD).copy(currentTenantId = SampleData.ACME_TENANT))
}

private fun sessionTenant(services: TestServices, serverId: tools.obli.core.model.ServerId): Long? =
    (services.base.sessions.session(serverId)!!.auth.value as? tools.obli.core.auth.AuthState.SignedIn)?.probe?.currentTenantId
