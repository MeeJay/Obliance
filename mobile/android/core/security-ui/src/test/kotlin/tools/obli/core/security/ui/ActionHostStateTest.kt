package tools.obli.core.security.ui

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionEndpoints
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Preflight
import tools.obli.core.security.PrivacyUnlockResult
import tools.obli.core.security.Tier

/** The host state machine driven through the real ActionRunner (design doc §7.6, §10.4). */
@OptIn(ExperimentalCoroutinesApi::class)
class ActionHostStateTest {
    private class FakeAuth(var available: Boolean = true, answers: List<Boolean> = listOf(true)) : StrongAuthenticator {
        val asked = mutableListOf<ActionSpec>()
        private val queue = ArrayDeque(answers)
        override fun isAvailable() = available
        override suspend fun authenticate(spec: ActionSpec): Boolean {
            asked += spec
            return queue.removeFirstOrNull() ?: true
        }
    }

    private class FakeEndpoints(unlocks: List<PrivacyUnlockResult> = emptyList()) : ActionEndpoints {
        val log = mutableListOf<String>()
        private val queue = ArrayDeque(unlocks)
        override suspend fun cancelApproval(approvalId: Long): ApiOutcome<Unit> {
            log += "cancel:$approvalId"
            return ApiOutcome.Ok(Unit)
        }
        override suspend fun unlockPrivacy(feature: String, password: String): PrivacyUnlockResult {
            log += "unlock:$feature:$password"
            return queue.removeFirst()
        }
    }

    private val restart = ActionSpec("device.restart_service", Tier.T1, "Redémarrer le service", "Spouleur d'impression", "Obliance Prod › ACME")
    private val reboot = ActionSpec("device.reboot", Tier.T2, "Redémarrer", "SRV-AD2", "Obliance Prod › ACME", "2 utilisateurs sont connectés.")
    private val shutdown = ActionSpec("device.shutdown", Tier.T3, "Éteindre", "SRV-AD2", "Obliance Prod › ACME")

    private fun <T> scripted(vararg answers: ApiOutcome<T>): Pair<MutableList<JsonObject>, suspend (JsonObject) -> ApiOutcome<T>> {
        val bodies = mutableListOf<JsonObject>()
        val queue = ArrayDeque(answers.toList())
        return bodies to { extra -> bodies += extra; queue.removeFirst() }
    }

    private inline fun <reified P : ActionPrompt> ActionHostState.current(): P = prompt.value as P

    private fun TestScope.launchRun(runner: ActionRunner, spec: ActionSpec, preflight: suspend () -> Preflight = { Preflight.Ok }, call: suspend (JsonObject) -> ApiOutcome<Unit>) =
        backgroundScope.async { runner.run(spec, preflight, call) }.also { runCurrent() }

    @Test fun cancelledConfirmationSendsNothingAndClosesTheSheet() = runTest {
        val host = ActionHostState(FakeAuth())
        val (bodies, call) = scripted<Unit>()
        val run = launchRun(ActionRunner(host), restart, call = call)
        val p = host.current<ActionPrompt.Confirm>()
        assertEquals(restart, p.spec)
        assertFalse(p.strong)
        host.cancel()
        runCurrent()
        assertEquals(ActionResult.Cancelled, run.await())
        assertTrue(bodies.isEmpty())
        assertNull(host.prompt.value)
    }

    @Test fun t1ConfirmsWithoutBiometric() = runTest {
        val auth = FakeAuth()
        val host = ActionHostState(auth)
        val (bodies, call) = scripted(ApiOutcome.Ok(Unit))
        val run = launchRun(ActionRunner(host), restart, call = call)
        host.accept(host.current())
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
        assertTrue(auth.asked.isEmpty())
        assertEquals(1, bodies.size)
    }

    @Test fun t2AsksTheBiometricNamingTheTargetAndKeepsTheSheetAfterACancel() = runTest {
        val auth = FakeAuth(answers = listOf(false, true))
        val host = ActionHostState(auth)
        val (bodies, call) = scripted(ApiOutcome.Ok(Unit))
        val run = launchRun(ActionRunner(host), reboot, call = call)
        val p = host.current<ActionPrompt.Confirm>()
        assertTrue(p.strongAuthAvailable)
        host.accept(p)
        assertTrue(p.authFailed)
        assertTrue(bodies.isEmpty())
        assertEquals(p, host.prompt.value)
        host.accept(p)
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
        assertEquals(listOf(reboot, reboot), auth.asked)
        assertEquals("SRV-AD2 · Obliance Prod › ACME", BiometricAuthenticator.subtitleOf(reboot))
    }

    @Test fun withoutScreenLockTheSheetAloneConfirms() = runTest {
        val auth = FakeAuth(available = false)
        val host = ActionHostState(auth)
        val (_, call) = scripted(ApiOutcome.Ok(Unit))
        val run = launchRun(ActionRunner(host), reboot, call = call)
        val p = host.current<ActionPrompt.Confirm>()
        assertFalse(p.strongAuthAvailable)
        host.accept(p)
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
        assertTrue(auth.asked.isEmpty())
    }

    @Test fun t3AccessibleAlternativeNeedsTwoPressesThenBiometric() = runTest {
        val auth = FakeAuth()
        val host = ActionHostState(auth, accessibilityMode = { true })
        val (bodies, call) = scripted(ApiOutcome.Ok(Unit))
        val run = launchRun(ActionRunner(host), shutdown, call = call)
        val p = host.current<ActionPrompt.Confirm>()
        assertTrue(p.accessible)
        assertFalse(p.usesHold)
        host.accept(p)
        assertTrue(p.armed)
        assertTrue(auth.asked.isEmpty())
        assertTrue(bodies.isEmpty())
        host.accept(p)
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
        assertEquals(listOf(shutdown), auth.asked)
    }

    @Test fun t3WithoutAccessibilityUsesTheHold() = runTest {
        val host = ActionHostState(FakeAuth())
        val (_, call) = scripted(ApiOutcome.Ok(Unit))
        val run = launchRun(ActionRunner(host), shutdown, call = call)
        val p = host.current<ActionPrompt.Confirm>()
        assertTrue(p.usesHold)
        host.accept(p) // the end of the hold
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
    }

    @Test fun bulkT3NeedsTheTypedCount() = runTest {
        val host = ActionHostState(FakeAuth())
        val (bodies, call) = scripted(ApiOutcome.Ok(Unit))
        val bulk = shutdown.copy(target = "12 appareils", targetCount = 12)
        val run = launchRun(ActionRunner(host), bulk, call = call)
        val p = host.current<ActionPrompt.Confirm>()
        assertTrue(p.needsCount)
        host.accept(p)
        p.typedCount = "11"
        host.accept(p)
        assertTrue(bodies.isEmpty())
        p.typedCount = "12"
        host.accept(p)
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
    }

    @Test fun twoFactorRetryFlowThroughTheRunner() = runTest {
        val host = ActionHostState(FakeAuth())
        val (bodies, call) = scripted(
            ApiOutcome.StepUpRequired("device.reboot", "92.184.107.21"),
            ApiOutcome.StepUpRejected,
            ApiOutcome.Ok(Unit),
        )
        val run = launchRun(ActionRunner(host), reboot, call = call)
        host.accept(host.current())
        runCurrent()
        val first = host.current<ActionPrompt.TwoFactor>()
        assertEquals("92.184.107.21", first.currentIp)
        assertFalse(first.previousWasWrong)
        first.code = "12345"
        host.submitCode(first) // 5 digits: refused
        runCurrent()
        assertEquals(first, host.prompt.value)
        first.code = "482913"
        host.submitCode(first)
        runCurrent()
        val second = host.current<ActionPrompt.TwoFactor>()
        assertTrue(second.previousWasWrong)
        assertEquals("92.184.107.21", second.currentIp)
        assertEquals("", second.code)
        second.code = "482914"
        second.trustIp = true
        host.submitCode(second)
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
        assertEquals(JsonPrimitive("482913"), bodies[1]["twoFactorCode"])
        assertNull(bodies[1]["trustIp"])
        assertEquals(JsonPrimitive("482914"), bodies[2]["twoFactorCode"])
        assertEquals(JsonPrimitive(true), bodies[2]["trustIp"])
    }

    @Test fun cancelledCodeCancelsTheAction() = runTest {
        val host = ActionHostState(FakeAuth())
        val (bodies, call) = scripted<Unit>(ApiOutcome.StepUpRequired(null, null))
        val run = launchRun(ActionRunner(host), reboot, call = call)
        host.accept(host.current())
        runCurrent()
        host.current<ActionPrompt.TwoFactor>()
        host.cancel()
        runCurrent()
        assertEquals(ActionResult.Cancelled, run.await())
        assertEquals(1, bodies.size)
    }

    @Test fun approvalRequestIsNeverASuccessAndCanBeWithdrawn() = runTest {
        val endpoints = FakeEndpoints()
        val host = ActionHostState(FakeAuth())
        val (_, call) = scripted<Unit>(ApiOutcome.PendingApproval(41))
        val run = launchRun(ActionRunner(host), shutdown.copy(tier = Tier.T0, endpoints = endpoints), call = call)
        val p = host.current<ActionPrompt.ApprovalSent>()
        assertEquals(41L, p.approvalId)
        host.cancelApproval(p)
        assertEquals(ActionPrompt.CancelState.CANCELLED, p.cancel)
        assertEquals(listOf("cancel:41"), endpoints.log)
        host.acknowledge(p)
        runCurrent()
        assertEquals(ActionResult.AwaitingApproval(41), run.await())
    }

    @Test fun privacyUnlockRetriesOnceAfterTheRightPassword() = runTest {
        val endpoints = FakeEndpoints(listOf(PrivacyUnlockResult.WrongPassword, PrivacyUnlockResult.Unlocked(900)))
        val host = ActionHostState(FakeAuth())
        val locked = ApiOutcome.PrivacyLocked("remote", false, "Privacy mode is active — unlock required for feature 'remote'")
        val (bodies, call) = scripted(locked, ApiOutcome.Ok(Unit))
        val run = launchRun(ActionRunner(host), reboot.copy(tier = Tier.T0, endpoints = endpoints), call = call)
        val p = host.current<ActionPrompt.PrivacyUnlock>()
        assertEquals("remote", p.selectedFeature)
        assertTrue(p.canUnlock)
        p.password = "faux"
        host.unlock(p)
        assertEquals(PrivacyUnlockResult.WrongPassword, p.error)
        assertEquals("", p.password)
        p.password = "correct horse"
        host.unlock(p)
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
        assertEquals(listOf("unlock:remote:faux", "unlock:remote:correct horse"), endpoints.log)
        assertEquals(2, bodies.size)
    }

    @Test fun privacyWithoutPasswordCannotBeUnlocked() = runTest {
        val endpoints = FakeEndpoints(listOf(PrivacyUnlockResult.NoPasswordSet))
        val host = ActionHostState(FakeAuth())
        val locked = ApiOutcome.PrivacyLocked("scripts", false, "Privacy mode is active — unlock required for feature 'scripts'")
        val (_, call) = scripted<Unit>(locked)
        val run = launchRun(ActionRunner(host), reboot.copy(tier = Tier.T0, endpoints = endpoints), call = call)
        val p = host.current<ActionPrompt.PrivacyUnlock>()
        p.password = "x"
        host.unlock(p)
        assertFalse(p.canUnlock)
        host.cancel()
        runCurrent()
        assertEquals(ActionResult.Failed(locked), run.await())
    }

    @Test fun tenantSwitchComesFirst() = runTest {
        val host = ActionHostState(FakeAuth())
        var switched = false
        val (_, call) = scripted(ApiOutcome.Ok(Unit))
        val run = launchRun(ActionRunner(host), restart, { Preflight.NeedsTenantSwitch("ACME") { switched = true; true } }, call)
        val p = host.current<ActionPrompt.TenantSwitch>()
        assertEquals("ACME", p.tenantName)
        host.switchTenant(p)
        runCurrent()
        assertTrue(switched)
        host.accept(host.current())
        runCurrent()
        assertEquals(ActionResult.Done(Unit), run.await())
    }

    @Test fun leavingTheScreenRemovesThePrompt() = runTest {
        val host = ActionHostState(FakeAuth())
        val (bodies, call) = scripted<Unit>()
        val run = launchRun(ActionRunner(host), reboot, call = call)
        host.current<ActionPrompt.Confirm>()
        run.cancel()
        runCurrent()
        assertNull(host.prompt.value)
        assertTrue(bodies.isEmpty())
    }

    @Test fun expiredSessionCallsTheAppHook() = runTest {
        var hook = 0
        val host = ActionHostState(FakeAuth(), onSessionExpired = { hook++ })
        val (_, call) = scripted<Unit>(ApiOutcome.SessionExpired)
        val run = launchRun(ActionRunner(host), restart.copy(tier = Tier.T0), call = call)
        assertEquals(ActionResult.SessionExpired, run.await())
        assertEquals(1, hook)
    }

    @Test fun promptsAreSerialised() = runTest {
        val host = ActionHostState(FakeAuth())
        val runner = ActionRunner(host)
        val (_, call1) = scripted(ApiOutcome.Ok(Unit))
        val (_, call2) = scripted(ApiOutcome.Ok(Unit))
        val a = launchRun(runner, restart, call = call1)
        val b = launchRun(runner, restart.copy(target = "Planificateur"), call = call2)
        assertEquals("Spouleur d'impression", host.current<ActionPrompt.Confirm>().spec.target)
        host.accept(host.current())
        runCurrent()
        assertEquals(ActionResult.Done(Unit), a.await())
        assertEquals("Planificateur", host.current<ActionPrompt.Confirm>().spec.target)
        host.accept(host.current())
        runCurrent()
        assertEquals(ActionResult.Done(Unit), b.await())
    }
}
