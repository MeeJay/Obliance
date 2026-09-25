package tools.obli.core.security

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ForbiddenReason

class ActionRunnerTest {
    private class FakePrompter : ActionPrompter {
        val log = mutableListOf<String>()
        var confirmAnswer = true
        var switchAnswer = true
        var codes = ArrayDeque(listOf<TwoFactorAnswer?>())
        var unlockAnswer = true

        override suspend fun confirmTenantSwitch(spec: ActionSpec, tenantName: String) = switchAnswer.also { log += "switch?$tenantName" }
        override suspend fun confirm(spec: ActionSpec) = confirmAnswer.also { log += "confirm:${spec.tier}" }
        override suspend fun askTwoFactor(spec: ActionSpec, currentIp: String?, previousWasWrong: Boolean): TwoFactorAnswer? {
            log += "2fa:$currentIp:$previousWasWrong"
            return codes.removeFirstOrNull()
        }
        override suspend fun approvalRequested(spec: ActionSpec, approvalId: Long) { log += "approval:$approvalId" }
        override suspend fun unlockPrivacy(spec: ActionSpec, feature: String?, passwordSet: Boolean) = unlockAnswer.also { log += "privacy:$feature" }
        override suspend fun sessionExpired() { log += "expired" }
    }

    private val reboot = ActionSpec("device.reboot", Tier.T2, "Redémarrer", "SRV-AD2", "Obliance Prod › ACME", "2 utilisateurs sont connectés")

    private fun <T> scripted(vararg answers: ApiOutcome<T>): Pair<MutableList<JsonObject>, suspend (JsonObject) -> ApiOutcome<T>> {
        val bodies = mutableListOf<JsonObject>()
        val queue = ArrayDeque(answers.toList())
        return bodies to { extra -> bodies += extra; queue.removeFirst() }
    }

    @Test fun t0SkipsConfirmation() = runBlocking {
        val p = FakePrompter()
        val (_, call) = scripted(ApiOutcome.Ok(Unit))
        val r = ActionRunner(p).run(reboot.copy(tier = Tier.T0), call = call)
        assertEquals(ActionResult.Done(Unit), r)
        assertTrue(p.log.isEmpty())
    }

    @Test fun cancelledConfirmationSendsNothing() = runBlocking {
        val p = FakePrompter().apply { confirmAnswer = false }
        val (bodies, call) = scripted<Unit>()
        assertEquals(ActionResult.Cancelled, ActionRunner(p).run(reboot, call = call))
        assertTrue(bodies.isEmpty())
    }

    @Test fun stepUpResendsTheSameCallWithTheCode() = runBlocking {
        val p = FakePrompter().apply { codes = ArrayDeque(listOf(TwoFactorAnswer(" 482913 ", false), TwoFactorAnswer("482914", true))) }
        val (bodies, call) = scripted(
            ApiOutcome.StepUpRequired("device.reboot", "92.184.107.21"),
            ApiOutcome.StepUpRejected,
            ApiOutcome.Ok("done"),
        )
        assertEquals(ActionResult.Done("done"), ActionRunner(p).run(reboot, call = call))
        assertEquals(listOf("confirm:T2", "2fa:92.184.107.21:false", "2fa:null:true"), p.log)
        assertEquals(JsonObject(emptyMap()), bodies[0])
        assertEquals(JsonPrimitive("482913"), bodies[1]["twoFactorCode"])
        assertEquals(null, bodies[1]["trustIp"])
        assertEquals(JsonPrimitive("482914"), bodies[2]["twoFactorCode"])
        assertEquals(JsonPrimitive(true), bodies[2]["trustIp"])
    }

    @Test fun threeWrongCodesStop() = runBlocking {
        val p = FakePrompter().apply { codes = ArrayDeque(List(5) { TwoFactorAnswer("000000", false) }) }
        val (bodies, call) = scripted<Unit>(ApiOutcome.StepUpRequired(null, null), ApiOutcome.StepUpRejected, ApiOutcome.StepUpRejected, ApiOutcome.StepUpRejected)
        assertEquals(ActionResult.Failed(ApiOutcome.StepUpRejected), ActionRunner(p).run(reboot, call = call))
        assertEquals(4, bodies.size)
    }

    @Test fun pendingApprovalIsNeverASuccess() = runBlocking {
        val p = FakePrompter()
        val (_, call) = scripted<Unit>(ApiOutcome.PendingApproval(41))
        assertEquals(ActionResult.AwaitingApproval(41), ActionRunner(p).run(reboot, call = call))
        assertEquals("approval:41", p.log.last())
    }

    @Test fun privacyUnlockGetsOneRetryOnly() = runBlocking {
        val p = FakePrompter()
        val locked = ApiOutcome.PrivacyLocked("remote", false, "Privacy mode is active")
        val (bodies, call) = scripted<Unit>(locked, locked)
        assertEquals(ActionResult.Failed(locked), ActionRunner(p).run(reboot, call = call))
        assertEquals(2, bodies.size)
        assertEquals(1, p.log.count { it.startsWith("privacy") })
    }

    @Test fun expiredSessionIsNeverReplayed() = runBlocking {
        val p = FakePrompter()
        val (bodies, call) = scripted<Unit>(ApiOutcome.SessionExpired, ApiOutcome.Ok(Unit))
        assertEquals(ActionResult.SessionExpired, ActionRunner(p).run(reboot, call = call))
        assertEquals(1, bodies.size)
        assertEquals("expired", p.log.last())
    }

    @Test fun serverRefusalsAreReturnedAsIs() = runBlocking {
        for (o in listOf<ApiOutcome<Unit>>(
            ApiOutcome.Forbidden(ForbiddenReason.CAPABILITY, "Capability 'power' not permitted", "power"),
            ApiOutcome.Unsupported("legacy"), ApiOutcome.AgentOffline("offline"),
            ApiOutcome.Failure(null, FailureKind.NETWORK),
        )) {
            val (bodies, call) = scripted(o)
            @Suppress("UNCHECKED_CAST")
            assertEquals(ActionResult.Failed(o as ApiOutcome<Nothing>), ActionRunner(FakePrompter()).run(reboot, call = call))
            assertEquals(1, bodies.size)
        }
    }

    @Test fun preflightBlocksOrSwitchesTenantFirst() = runBlocking {
        val p = FakePrompter()
        val (bodies, call) = scripted(ApiOutcome.Ok(Unit))
        assertEquals(ActionResult.Blocked("SRV-AD2 est hors ligne"), ActionRunner(p).run(reboot, { Preflight.Blocked("SRV-AD2 est hors ligne") }, call))
        assertTrue(bodies.isEmpty())

        var switched = false
        val r = ActionRunner(p).run(reboot, { Preflight.NeedsTenantSwitch("ACME") { switched = true; true } }, call)
        assertEquals(ActionResult.Done(Unit), r)
        assertTrue(switched)
        assertEquals(listOf("switch?ACME", "confirm:T2"), p.log)
    }

    @Test fun trustWindowForSingleT2Only() = runBlocking {
        var now = 1_000_000L
        val p = FakePrompter()
        val runner = ActionRunner(p) { now }
        suspend fun go(spec: ActionSpec) = runner.run(spec) { ApiOutcome.Ok(Unit) }
        go(reboot)
        now += 12_000; go(reboot)
        now += 1_000; go(reboot.copy(targetCount = 3))
        now += 1_000; go(reboot.copy(tier = Tier.T3))
        now += 60_000; go(reboot)
        assertEquals(listOf("confirm:T2", "confirm:T2", "confirm:T3", "confirm:T2"), p.log)
    }
}
