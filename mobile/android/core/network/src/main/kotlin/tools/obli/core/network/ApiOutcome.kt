package tools.obli.core.network

/**
 * Typed result of one call to an Obli server (design doc §10.4). The server
 * guard rails (step-up 2FA, two-person approval, privacy lock) are states, not
 * errors: [tools.obli.core.network.ApiResponses] maps each of them here, and
 * the action runner turns them into sheets (S42, S43, S44).
 */
sealed interface ApiOutcome<out T> {
    /** 2xx with a decoded payload (204 decodes `null`). */
    data class Ok<T>(val value: T) : ApiOutcome<T>

    /** 202 carrying a payload that is NOT an approval (e.g. scripts/execute: the executions). */
    data class Accepted<T>(val value: T) : ApiOutcome<T>

    /** 202 `{data:{approvalId, status:'pending_approval'}}`: a two-person approval was created. */
    data class PendingApproval(val approvalId: Long) : ApiOutcome<Nothing>

    /** 401 `{twoFactorRequired:true, action, currentIp}`: resend the SAME body with `twoFactorCode`. */
    data class StepUpRequired(val action: String?, val currentIp: String?) : ApiOutcome<Nothing>

    /** 401 `Invalid 2FA code` after a step-up: the code was wrong, the session is fine. */
    data object StepUpRejected : ApiOutcome<Nothing>

    /** 423: privacy mode blocks [feature]; [passwordSet] = unlock goes through the privacy password. */
    data class PrivacyLocked(val feature: String?, val passwordSet: Boolean, val message: String) : ApiOutcome<Nothing>

    /** 409: legacy agent, already handled, not applicable. [message] is the server text. */
    data class Unsupported(val message: String) : ApiOutcome<Nothing>

    data class Forbidden(val reason: ForbiddenReason, val message: String, val capability: String? = null) : ApiOutcome<Nothing>

    /** 503: the agent (or the server-side dependency) is not reachable. */
    data class AgentOffline(val message: String) : ApiOutcome<Nothing>

    /** 401 `Authentication required`: the session cookie is gone or expired (S03). */
    data object SessionExpired : ApiOutcome<Nothing>

    data class RateLimited(val retryAfterSec: Int?) : ApiOutcome<Nothing>

    /** 400 with `details` (zod `fieldErrors`). */
    data class Validation(val message: String, val fields: Map<String, List<String>>) : ApiOutcome<Nothing>

    data class Failure(val status: Int?, val kind: FailureKind, val message: String? = null) : ApiOutcome<Nothing>
}

enum class ForbiddenReason {
    /** `Capability 'x' not permitted for your team…` (remembered per device and capability). */
    CAPABILITY,

    /** A sensitive action needs TOTP on the profile first. */
    NO_TOTP,

    /** Restricted action with no approval path configured. */
    NO_APPROVAL_PATH,
    OTHER,
}

enum class FailureKind {
    NOT_FOUND,
    SERVER,

    /** A 2xx on an /api/… route that is not JSON (the SPA fallback may answer index.html). */
    NOT_JSON,

    /** Any other 4xx. */
    CLIENT,

    /** No HTTP answer at all (DNS, TLS, timeout, reset). */
    NETWORK,
}

/** Never an automatic replay after these (design doc §7.6, §10.4). */
val ApiOutcome<*>.isSuccess: Boolean get() = this is ApiOutcome.Ok || this is ApiOutcome.Accepted
