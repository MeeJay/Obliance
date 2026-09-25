package tools.obli.obliance.api

import kotlinx.serialization.Serializable
import tools.obli.core.model.ObliUser
import tools.obli.core.model.SessionProbe
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ApiResponses
import tools.obli.core.network.ObliHttp

/** `GET /health` (server/src/app.ts, public, not enveloped). */
@Serializable
data class Health(
    val status: String = "",
    val version: String? = null,
    val timestamp: String? = null,
) {
    val isOk: Boolean get() = status == "ok"
}

/** `GET /api/auth/sso-config` → `data` (obligate.service.ts getSsoConfig). */
@Serializable
data class SsoConfig(
    val obligateUrl: String? = null,
    val obligateReachable: Boolean = false,
    val obligateEnabled: Boolean = false,
) {
    /** The "Se connecter avec Obligate" button is offered only when both are true. */
    val offersObligate: Boolean get() = obligateEnabled && obligateReachable && !obligateUrl.isNullOrBlank()
}

/** Second factors of the account, from `data.methods` of a login that needs 2FA. */
@Serializable
data class TwoFactorMethods(val totp: Boolean = false, val email: Boolean = false)

enum class TwoFactorMethod(val wire: String) { TOTP("totp"), EMAIL("email") }

@Serializable
internal data class LoginPayload(
    val requires2fa: Boolean = false,
    val methods: TwoFactorMethods = TwoFactorMethods(),
    val user: ObliUser? = null,
)

/** Outcome of `POST /api/auth/login` and of its 2FA continuation. */
sealed interface LoginResult {
    /** The session cookie is set; the account is signed in. */
    data class SignedIn(val user: ObliUser) : LoginResult

    /** Step 1 done (`pendingMfaUserId` in the session): send the code with [AuthApi.verifyTwoFactor]. */
    data class TwoFactorRequired(val methods: TwoFactorMethods) : LoginResult

    /** 401 on login: `Invalid username or password`. */
    data object InvalidCredentials : LoginResult

    /** 401 on 2FA verify: `Invalid code` (the pending session is kept, try again). */
    data object InvalidCode : LoginResult

    /** 400 `No pending 2FA session`: the pending login expired, start again. */
    data object TwoFactorSessionLost : LoginResult

    /** 429 from authLimiter / mfaLimiter. */
    data class RateLimited(val retryAfterSec: Int?) : LoginResult

    /** Anything else (validation, network, 5xx…), for the screen to explain. */
    data class Failed(val outcome: ApiOutcome<Nothing>) : LoginResult
}

/**
 * Sign-in calls of ONE server (server/src/controllers/auth.controller.ts,
 * twoFactor.controller.ts, routes/obligateCallback.routes.ts).
 *
 * Flow: [login] → either [LoginResult.SignedIn], or [LoginResult.TwoFactorRequired]
 * (the server keeps `pendingMfaUserId` in the session cookie and, for e-mail
 * OTP, has already sent a code) → [verifyTwoFactor] with `{code, method}`
 * ([resendEmailCode] sends a new e-mail code). The cookie jar carries the
 * session between the two steps: use the same origin and client.
 */
class AuthApi(private val http: ObliHttp) {
    suspend fun health(): ApiOutcome<Health> = http.call(ObliHttp.Method.GET, "/health", decode = ApiJson.unwrapped(Health.serializer()))

    suspend fun ssoConfig(): ApiOutcome<SsoConfig> =
        http.call(ObliHttp.Method.GET, "/api/auth/sso-config", decode = ApiJson.unwrapped(SsoConfig.serializer()))

    /** `GET /api/auth/me` (also done by ServerSession.probe()). */
    suspend fun me(): ApiOutcome<SessionProbe> =
        http.call(ObliHttp.Method.GET, "/api/auth/me", decode = ApiJson.unwrapped(SessionProbe.serializer()))

    suspend fun login(username: String, password: String): LoginResult {
        val out = http.call(
            ObliHttp.Method.POST,
            "/api/auth/login",
            ApiJson.body("username" to username.trim(), "password" to password),
            decode = ApiJson.unwrapped(LoginPayload.serializer()),
        )
        return when (out) {
            is ApiOutcome.Ok -> step(out.value)
            is ApiOutcome.Accepted -> step(out.value)
            // Any 401 here is the credentials: there is no session to expire yet.
            ApiOutcome.SessionExpired, ApiOutcome.StepUpRejected, is ApiOutcome.StepUpRequired -> LoginResult.InvalidCredentials
            else -> failure(out)
        }
    }

    suspend fun verifyTwoFactor(method: TwoFactorMethod, code: String): LoginResult {
        val out = http.call(
            ObliHttp.Method.POST,
            "/api/profile/2fa/verify",
            ApiJson.body("code" to code.filter { !it.isWhitespace() }, "method" to method.wire),
            decode = ApiJson.unwrapped(LoginPayload.serializer()),
        )
        return when (out) {
            is ApiOutcome.Ok -> out.value.user?.let { LoginResult.SignedIn(it) } ?: LoginResult.Failed(ApiResponses.network("no user"))
            is ApiOutcome.Accepted -> out.value.user?.let { LoginResult.SignedIn(it) } ?: LoginResult.Failed(ApiResponses.network("no user"))
            ApiOutcome.SessionExpired, ApiOutcome.StepUpRejected, is ApiOutcome.StepUpRequired -> LoginResult.InvalidCode
            is ApiOutcome.Validation ->
                if (out.message.contains("pending 2FA", ignoreCase = true)) LoginResult.TwoFactorSessionLost else LoginResult.Failed(out)
            else -> failure(out)
        }
    }

    /** `POST /api/profile/2fa/resend-email` (only while a login is pending). */
    suspend fun resendEmailCode(): ApiOutcome<Unit> =
        http.call(ObliHttp.Method.POST, "/api/profile/2fa/resend-email", decode = ApiJson.ignoreBody)

    /** `POST /api/auth/logout`: destroys the server session (the cookie is cleared by the server). */
    suspend fun logout(): ApiOutcome<Unit> = http.call(ObliHttp.Method.POST, "/api/auth/logout", decode = ApiJson.ignoreBody)

    private fun step(payload: LoginPayload): LoginResult = when {
        payload.requires2fa -> LoginResult.TwoFactorRequired(payload.methods)
        payload.user != null -> LoginResult.SignedIn(payload.user)
        else -> LoginResult.Failed(ApiResponses.network("unexpected login answer"))
    }

    @Suppress("UNCHECKED_CAST")
    private fun failure(out: ApiOutcome<*>): LoginResult = when (out) {
        is ApiOutcome.RateLimited -> LoginResult.RateLimited(out.retryAfterSec)
        else -> LoginResult.Failed(out as ApiOutcome<Nothing>)
    }
}
