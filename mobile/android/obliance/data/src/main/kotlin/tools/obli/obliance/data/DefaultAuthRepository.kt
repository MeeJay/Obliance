package tools.obli.obliance.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import tools.obli.core.auth.AddServerResult
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.auth.ServerSessions
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.AuthApi
import tools.obli.obliance.api.LoginResult
import tools.obli.obliance.api.SsoConfig
import tools.obli.obliance.api.TwoFactorMethod
import tools.obli.shell.net.ServerUrl

internal class DefaultAuthRepository(
    private val registry: ServerRegistry,
    private val sessions: ServerSessions,
    /** HTTP client of an origin that may not be configured yet (same OkHttp client and cookie jar). */
    private val httpFor: (origin: String) -> ObliHttp,
    /** Expires the cookies of an origin (WebCookieJar.clearOrigin). */
    private val clearCookies: (origin: String) -> Unit,
    private val appScope: CoroutineScope,
) : AuthRepository {

    override suspend fun checkServer(address: String): ServerCheck {
        val origin = when (val r = ServerUrl.normalize(address)) {
            is ServerUrl.Result.Ok -> r.url
            is ServerUrl.Result.Invalid -> return ServerCheck.Invalid(r.problem)
        }
        val existing = registry.state.value.byUrl(origin)
        if (existing == null && registry.state.value.profiles.size >= ServerRegistry.MAX_SERVERS) {
            return ServerCheck.LimitReached(origin)
        }
        val api = AuthApi(httpFor(origin))
        val health = when (val out = api.health()) {
            is ApiOutcome.Ok -> out.value
            is ApiOutcome.Failure -> return ServerCheck.Unreachable(origin, out)
            else -> return ServerCheck.NotObliance(origin)
        }
        if (!health.isOk) return ServerCheck.NotObliance(origin)
        // sso-config always answers 200 on an Obliance server; a failure only hides the SSO button.
        val sso = (api.ssoConfig() as? ApiOutcome.Ok)?.value ?: SsoConfig()
        return ServerCheck.Ok(origin, health, sso, existing)
    }

    override suspend fun login(origin: String, username: String, password: String): LoginResult =
        AuthApi(httpFor(origin)).login(username, password)

    override suspend fun verifyTwoFactor(origin: String, method: TwoFactorMethod, code: String): LoginResult =
        AuthApi(httpFor(origin)).verifyTwoFactor(method, code)

    override suspend fun resendEmailCode(origin: String): ApiOutcome<Unit> = AuthApi(httpFor(origin)).resendEmailCode()

    override suspend fun completeSignIn(origin: String, displayName: String?, activate: Boolean): SignInResult =
        // Not cancelled with the calling screen: the registry changes (a first
        // server swaps the sign-in screen for the shell) before this returns.
        appScope.async { doCompleteSignIn(origin, displayName, activate) }.await()

    private suspend fun doCompleteSignIn(origin: String, displayName: String?, activate: Boolean): SignInResult {
        val profile = registry.state.value.byUrl(origin) ?: when (val added = registry.add(origin, displayName)) {
            is AddServerResult.Added -> added.profile
            is AddServerResult.AlreadyConfigured -> added.existing
            else -> return SignInResult.Refused(added)
        }
        val session = sessions.session(profile.id) ?: return SignInResult.NotSignedIn(AuthState.Unknown)
        val state = session.probe()
        if (state !is AuthState.SignedIn) return SignInResult.NotSignedIn(state)
        val wasActive = registry.state.value.activeId == profile.id
        when {
            // Closes the previous server's socket and opens this one.
            activate && !wasActive -> sessions.activate(profile.id)
            // New cookie (first server, or signed in again): handshake again with it.
            wasActive -> session.realtime.reconnect()
        }
        return SignInResult.Done(registry.state.value.byId(profile.id) ?: profile, state.probe)
    }

    override suspend fun signOut(serverId: ServerId): ApiOutcome<Unit> {
        val session = sessions.session(serverId) ?: return noServer
        val out = AuthApi(session.http).logout()
        clearCookies(session.profile.origin)
        session.realtime.disconnect()
        session.markSignedOut()
        return out
    }
}
