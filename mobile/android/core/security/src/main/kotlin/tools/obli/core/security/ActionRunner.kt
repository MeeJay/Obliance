package tools.obli.core.security

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import tools.obli.core.network.ApiOutcome

/** Safety tiers of design doc §7.6. */
enum class Tier {
    /** Immediate, no confirmation. */
    T0,

    /** Compact sheet naming the target, one button, no delay. */
    T1,

    /** Sheet + biometric prompt naming the target. */
    T2,

    /** Hold 1.5 s + biometric; bulk ≥ 10 also asks to type the count. */
    T3,
}

/** What a confirmation shows: action, target and where it runs (server › tenant). */
data class ActionSpec(
    val key: String,
    val tier: Tier,
    val title: String,
    val target: String,
    val scope: String,
    val consequence: String? = null,
    /** > 1 for bulk actions: disables the trust window. */
    val targetCount: Int = 1,
)

sealed interface Preflight {
    data object Ok : Preflight

    /** Shown as is (offline, privacy, legacy agent, missing right…); nothing is sent. */
    data class Blocked(val reason: String) : Preflight

    /** Action routes are bound to the session tenant: switch first ("Basculer et continuer"). */
    data class NeedsTenantSwitch(val tenantName: String, val switch: suspend () -> Boolean) : Preflight
}

data class TwoFactorAnswer(val code: String, val trustIp: Boolean)

/** The UI host (root Compose host) implements the prompts: sheets S41–S44, S03. */
interface ActionPrompter {
    suspend fun confirmTenantSwitch(spec: ActionSpec, tenantName: String): Boolean

    /** Tier-appropriate confirmation (T1 sheet, T2 biometric, T3 hold + biometric). */
    suspend fun confirm(spec: ActionSpec): Boolean

    /** S42; [previousWasWrong] after a rejected code. Null = cancelled. */
    suspend fun askTwoFactor(spec: ActionSpec, currentIp: String?, previousWasWrong: Boolean): TwoFactorAnswer?

    /** S43: the request is waiting for a second person. */
    suspend fun approvalRequested(spec: ActionSpec, approvalId: Long)

    /** S44: returns true when the device was unlocked and one retry may be made. */
    suspend fun unlockPrivacy(spec: ActionSpec, feature: String?, passwordSet: Boolean): Boolean

    /** S03 over the current screen. The action is NEVER replayed afterwards. */
    suspend fun sessionExpired()
}

sealed interface ActionResult<out T> {
    data class Done<T>(val value: T) : ActionResult<T>
    data class AwaitingApproval(val approvalId: Long) : ActionResult<Nothing>
    data object Cancelled : ActionResult<Nothing>
    data class Blocked(val reason: String) : ActionResult<Nothing>
    data object SessionExpired : ActionResult<Nothing>

    /** Any other server answer (403, 409, 503, network…), to be explained by the screen. */
    data class Failed(val outcome: ApiOutcome<Nothing>) : ActionResult<Nothing>
}

/**
 * The single path of every call that changes something (design doc §10.4):
 * preflight → local tier → call → server guard rails, in this order:
 * `401 twoFactorRequired` → S42 and the SAME body again with `twoFactorCode`
 * (3 attempts); `202 pending_approval` → S43, never a success; `423` → S44 and
 * one retry; `401` session → S03, never replayed. No automatic retry otherwise.
 */
class ActionRunner(
    private val prompter: ActionPrompter,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    @Volatile private var lastStrongConfirmAt: Long? = null

    suspend fun <T> run(
        spec: ActionSpec,
        preflight: suspend () -> Preflight = { Preflight.Ok },
        call: suspend (extra: JsonObject) -> ApiOutcome<T>,
    ): ActionResult<T> {
        when (val p = preflight()) {
            is Preflight.Blocked -> return ActionResult.Blocked(p.reason)
            is Preflight.NeedsTenantSwitch -> {
                if (!prompter.confirmTenantSwitch(spec, p.tenantName)) return ActionResult.Cancelled
                if (!p.switch()) return ActionResult.Blocked("tenant switch failed")
            }
            Preflight.Ok -> Unit
        }

        if (spec.tier != Tier.T0 && !withinTrustWindow(spec)) {
            if (!prompter.confirm(spec)) return ActionResult.Cancelled
            if (spec.tier == Tier.T2) lastStrongConfirmAt = clock()
        }

        var extra = JsonObject(emptyMap())
        var codeAttempts = 0
        var wrongCode = false
        var privacyRetried = false
        while (true) {
            when (val out = call(extra)) {
                is ApiOutcome.Ok -> return ActionResult.Done(out.value)
                is ApiOutcome.Accepted -> return ActionResult.Done(out.value)
                is ApiOutcome.PendingApproval -> {
                    prompter.approvalRequested(spec, out.approvalId)
                    return ActionResult.AwaitingApproval(out.approvalId)
                }
                is ApiOutcome.StepUpRequired, ApiOutcome.StepUpRejected -> {
                    if (out == ApiOutcome.StepUpRejected) wrongCode = true
                    if (codeAttempts >= MAX_CODE_ATTEMPTS) return ActionResult.Failed(ApiOutcome.StepUpRejected)
                    val ip = (out as? ApiOutcome.StepUpRequired)?.currentIp
                    val answer = prompter.askTwoFactor(spec, ip, wrongCode) ?: return ActionResult.Cancelled
                    codeAttempts++
                    extra = buildJsonObject {
                        extra.forEach { (k, v) -> if (k != "twoFactorCode" && k != "trustIp") put(k, v) }
                        put("twoFactorCode", JsonPrimitive(answer.code.trim()))
                        if (answer.trustIp) put("trustIp", JsonPrimitive(true))
                    }
                }
                is ApiOutcome.PrivacyLocked -> {
                    if (privacyRetried || !prompter.unlockPrivacy(spec, out.feature, out.passwordSet)) {
                        return ActionResult.Failed(out)
                    }
                    privacyRetried = true
                }
                ApiOutcome.SessionExpired -> {
                    prompter.sessionExpired()
                    return ActionResult.SessionExpired
                }
                is ApiOutcome.Unsupported -> return ActionResult.Failed(out)
                is ApiOutcome.Forbidden -> return ActionResult.Failed(out)
                is ApiOutcome.AgentOffline -> return ActionResult.Failed(out)
                is ApiOutcome.RateLimited -> return ActionResult.Failed(out)
                is ApiOutcome.Validation -> return ActionResult.Failed(out)
                is ApiOutcome.Failure -> return ActionResult.Failed(out)
            }
        }
    }

    /** 60 s after a successful T2 biometric, later T2 on single targets skip the prompt (§7.6). */
    private fun withinTrustWindow(spec: ActionSpec): Boolean {
        if (spec.tier != Tier.T2 || spec.targetCount > 1) return false
        val at = lastStrongConfirmAt ?: return false
        return clock() - at in 0 until TRUST_WINDOW_MS
    }

    companion object {
        const val MAX_CODE_ATTEMPTS = 3
        const val TRUST_WINDOW_MS = 60_000L
    }
}
