package tools.obli.obliance.access

import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.LoginResult
import tools.obli.obliance.api.TwoFactorMethod
import tools.obli.obliance.data.AuthRepository
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.ServerCheck
import tools.obli.obliance.data.SignInResult
import tools.obli.obliance.data.sample.SampleObliServices

/** [AuthRepository] over the sample one, with scripted answers and a record of the calls. */
internal class FakeAuth(private val base: AuthRepository) : AuthRepository {
    var check: ((String) -> ServerCheck)? = null
    var loginResult: LoginResult? = null
    var verifyResult: LoginResult? = null
    var completeResult: SignInResult? = null
    var resendResult: ApiOutcome<Unit> = ApiOutcome.Ok(Unit)
    val logins = mutableListOf<Pair<String, String>>()
    val verified = mutableListOf<Pair<TwoFactorMethod, String>>()
    val completed = mutableListOf<Triple<String, String?, Boolean>>()
    val signedOut = mutableListOf<ServerId>()
    var resends = 0

    override suspend fun checkServer(address: String): ServerCheck = check?.invoke(address) ?: base.checkServer(address)

    override suspend fun login(origin: String, username: String, password: String): LoginResult {
        logins += origin to username
        return loginResult ?: base.login(origin, username, password)
    }

    override suspend fun verifyTwoFactor(origin: String, method: TwoFactorMethod, code: String): LoginResult {
        verified += method to code
        return verifyResult ?: base.verifyTwoFactor(origin, method, code)
    }

    override suspend fun resendEmailCode(origin: String): ApiOutcome<Unit> {
        resends++
        return resendResult
    }

    override suspend fun completeSignIn(origin: String, displayName: String?, activate: Boolean): SignInResult {
        completed += Triple(origin, displayName, activate)
        return completeResult ?: base.completeSignIn(origin, displayName, activate)
    }

    override suspend fun signOut(serverId: ServerId): ApiOutcome<Unit> {
        signedOut += serverId
        return base.signOut(serverId)
    }
}

/** Sample services (design doc §4 data) whose auth is scriptable. */
internal class TestServices(
    serverCount: Int = 3,
    val base: SampleObliServices = SampleObliServices(serverCount),
    override val auth: FakeAuth = FakeAuth(base.auth),
) : ObliServices by base
