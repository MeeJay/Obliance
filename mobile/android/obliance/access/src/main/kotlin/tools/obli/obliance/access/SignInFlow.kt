package tools.obli.obliance.access

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerProfile
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.api.LoginResult
import tools.obli.obliance.api.TwoFactorMethod
import tools.obli.obliance.api.TwoFactorMethods
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.ServerCheck
import tools.obli.obliance.data.SignInResult
import tools.obli.shell.nav.Origins
import tools.obli.shell.net.ServerUrl

/*
 * The progressive sign-in of design doc S01 (first server), S93 (one more
 * server) and S03 (session expired): address → probe card → Obligate (S02) or
 * local account → second factor. One state machine for the three screens.
 */

internal enum class SignInMode {
    /** S01: no server yet; the new server becomes active (the app then swaps to the shell). */
    FIRST,

    /** S93: one more server, added without leaving the current one; ends on a confirmation. */
    ADD,

    /** S03: sign in again on a configured origin; nothing else changes. */
    REAUTH,
}

internal enum class SignInStep { ADDRESS, METHOD, TWO_FACTOR, ADDED }

internal enum class Busy { CHECKING, SIGNING_IN, VERIFYING, COMPLETING }

/** Where a problem is shown: under the address, above the Obligate button, in the local form, under the code. */
internal enum class ProblemArea { ADDRESS, SSO, LOCAL, CODE }

internal enum class ProblemKind(val area: ProblemArea) {
    ADDRESS_EMPTY(ProblemArea.ADDRESS),
    ADDRESS_NOT_HTTPS(ProblemArea.ADDRESS),
    ADDRESS_MALFORMED(ProblemArea.ADDRESS),
    ADDRESS_CREDENTIALS(ProblemArea.ADDRESS),
    NOT_OBLIANCE(ProblemArea.ADDRESS),
    TLS(ProblemArea.ADDRESS),
    HOST_NOT_FOUND(ProblemArea.ADDRESS),
    UNREACHABLE(ProblemArea.ADDRESS),

    /** arg = name of the profile that already uses this origin. */
    ALREADY_CONFIGURED(ProblemArea.ADDRESS),
    LIMIT(ProblemArea.ADDRESS),
    SSO_FAILED(ProblemArea.SSO),
    SSO_MISCONFIGURED(ProblemArea.SSO),
    SSO_NOT_CONFIGURED(ProblemArea.SSO),
    SSO_PAGE(ProblemArea.SSO),
    SSO_TLS(ProblemArea.SSO),

    /** `/api/auth/me` did not confirm the session after a successful sign-in. */
    SESSION_NOT_CONFIRMED(ProblemArea.SSO),
    CREDENTIALS(ProblemArea.LOCAL),
    CREDENTIALS_MISSING(ProblemArea.LOCAL),
    RATE_LIMITED(ProblemArea.LOCAL),
    SIGN_IN_UNREACHABLE(ProblemArea.LOCAL),

    /** arg = HTTP status when known. */
    SIGN_IN_FAILED(ProblemArea.LOCAL),
    CODE_EXPIRED(ProblemArea.LOCAL),
    CODE(ProblemArea.CODE),
    CODE_INCOMPLETE(ProblemArea.CODE),
    CODE_RATE_LIMITED(ProblemArea.CODE),
    CODE_FAILED(ProblemArea.CODE),
    RESEND_FAILED(ProblemArea.CODE),
}

internal data class SignInProblem(val kind: ProblemKind, val arg: String? = null)

/** What `GET /health` + `GET /api/auth/sso-config` said about the server. */
internal data class ProbeInfo(
    val origin: String,
    val version: String?,
    /** "Se connecter avec Obligate" is offered (enabled, reachable, URL known). */
    val offersSso: Boolean,
    /** Obligate is configured but not reachable right now (banner, local sign-in first). */
    val obligateUnreachable: Boolean = false,
    /** Host of the Obligate instance ("id.example.org"). */
    val obligateHost: String? = null,
    /** The shared cookie store already holds an Obligate session (S93 "sera réutilisée"). */
    val obligateSessionKnown: Boolean = false,
) {
    val host: String get() = ServerNames.hostOf(origin)
}

internal data class TwoFactorUi(
    val methods: TwoFactorMethods,
    val method: TwoFactorMethod,
    val code: String = "",
    /** Epoch ms from which "Renvoyer le code" is enabled again (e-mail, 30 s). */
    val resendAvailableAt: Long = 0L,
    /** Incremented on each refused code (the boxes shake). */
    val rejections: Int = 0,
    /** A new e-mail code was sent after "Renvoyer le code". */
    val resent: Boolean = false,
) {
    val offersChoice: Boolean get() = methods.totp && methods.email
}

/** S93 end state: the new profile and the server that stays active unless the user switches. */
internal data class AddedServer(val profile: ServerProfile, val activeName: String?)

internal data class SignInUiState(
    val mode: SignInMode,
    val step: SignInStep,
    val address: String = "",
    val probe: ProbeInfo? = null,
    val localExpanded: Boolean = false,
    val username: String = "",
    val password: String = "",
    val passwordVisible: Boolean = false,
    val twoFactor: TwoFactorUi? = null,
    val busy: Busy? = null,
    val problem: SignInProblem? = null,
    /** The Obligate sheet (S02) is open on [ProbeInfo.origin]. */
    val ssoOpen: Boolean = false,
    /** S93: display name and colour of the new server. */
    val displayName: String = "",
    val nameEdited: Boolean = false,
    val color: ServerColor = ServerColor.VIOLET,
    val added: AddedServer? = null,
    /** Servers configured when the screen opened (S93 subtitle "Serveur 4 sur 8 au plus"). */
    val serverCount: Int = 0,
    /** The flow is over: the host screen calls its callback (onSignedIn / onDone). */
    val finished: Boolean = false,
) {
    fun problemIn(area: ProblemArea): SignInProblem? = problem?.takeIf { it.kind.area == area }

    /** No Obligate button: the local form is the only way in, shown open and with the primary button. */
    val localOnly: Boolean get() = probe != null && !probe.offersSso

    val monogramName: String get() = displayName.trim().ifEmpty { probe?.let { ServerNames.suggest(it.origin) } ?: "" }
}

/** Seconds of the e-mail resend cooldown (design doc S01 "délai 30 s"). */
internal const val RESEND_COOLDOWN_MS = 30_000L

internal class SignInViewModel(
    private val services: ObliServices,
    val mode: SignInMode,
    /** REAUTH: the origin to sign in again on. */
    private val fixedOrigin: String? = null,
    /** Whether the shared cookie store holds cookies for an Obligate URL (AndroidCookies on a device). */
    private val hasCookiesFor: (url: String) -> Boolean = { false },
    private val now: () -> Long = System::currentTimeMillis,
) : ViewModel(), SignInActions {

    var state by mutableStateOf(initialState())
        private set

    init {
        if (fixedOrigin != null) probe(fixedOrigin)
    }

    private fun initialState(): SignInUiState {
        val registry = services.registry.state.value
        return if (fixedOrigin != null) {
            SignInUiState(mode, SignInStep.METHOD, address = ServerNames.hostOf(fixedOrigin), busy = Busy.CHECKING, serverCount = registry.profiles.size)
        } else {
            SignInUiState(mode, SignInStep.ADDRESS, serverCount = registry.profiles.size, color = ServerRegistry.nextColor(registry.profiles))
        }
    }

    // ---- Address -------------------------------------------------------------------------

    override fun setAddress(value: String) = update { copy(address = value.take(256), problem = problem?.takeIf { it.kind.area != ProblemArea.ADDRESS }) }

    override fun check() {
        if (state.busy != null || state.step != SignInStep.ADDRESS) return
        val address = state.address
        run(Busy.CHECKING) {
            when (val r = services.auth.checkServer(address)) {
                is ServerCheck.Ok -> when {
                    mode == SignInMode.ADD && r.existing != null ->
                        fail(ProblemKind.ALREADY_CONFIGURED, r.existing!!.displayName)
                    else -> onProbed(r)
                }
                is ServerCheck.Invalid -> fail(
                    when (r.problem) {
                        ServerUrl.Problem.EMPTY -> ProblemKind.ADDRESS_EMPTY
                        ServerUrl.Problem.NOT_HTTPS -> ProblemKind.ADDRESS_NOT_HTTPS
                        ServerUrl.Problem.MALFORMED -> ProblemKind.ADDRESS_MALFORMED
                        ServerUrl.Problem.HAS_CREDENTIALS -> ProblemKind.ADDRESS_CREDENTIALS
                    },
                )
                is ServerCheck.NotObliance -> fail(ProblemKind.NOT_OBLIANCE)
                is ServerCheck.Unreachable -> fail(unreachable(r.outcome))
                is ServerCheck.LimitReached -> fail(ProblemKind.LIMIT)
            }
        }
    }

    /** "obliance-prod.example.org · Changer": back to the address, everything after it is forgotten. */
    override fun changeServer() {
        if (fixedOrigin != null || state.busy != null) return
        update {
            copy(step = SignInStep.ADDRESS, probe = null, twoFactor = null, problem = null, password = "", localExpanded = false, nameEdited = false)
        }
    }

    private fun probe(origin: String) = run(Busy.CHECKING) {
        when (val r = services.auth.checkServer(origin)) {
            is ServerCheck.Ok -> onProbed(r)
            // Sign in again even when the probe failed: the local form stays usable.
            is ServerCheck.Unreachable -> update { copy(probe = ProbeInfo(origin, null, false), localExpanded = true, problem = SignInProblem(unreachable(r.outcome))) }
            else -> update { copy(probe = ProbeInfo(origin, null, false), localExpanded = true) }
        }
    }

    private fun onProbed(r: ServerCheck.Ok) {
        val obligateUrl = r.sso.obligateUrl?.takeIf { it.isNotBlank() }
        val obligateOrigin = Origins.of(obligateUrl)
        val info = ProbeInfo(
            origin = r.origin,
            version = r.health.version?.takeIf { it.isNotBlank() },
            offersSso = r.sso.offersObligate,
            obligateUnreachable = r.sso.obligateEnabled && !r.sso.obligateReachable,
            obligateHost = obligateOrigin?.let(Origins::host),
            obligateSessionKnown = r.sso.offersObligate && obligateOrigin != null && runCatching { hasCookiesFor("$obligateOrigin/") }.getOrDefault(false),
        )
        update {
            copy(
                step = SignInStep.METHOD,
                probe = info,
                problem = null,
                localExpanded = !info.offersSso,
                displayName = if (nameEdited) displayName else ServerNames.suggest(r.origin),
            )
        }
    }

    // ---- S93 display -----------------------------------------------------------------------

    override fun setDisplayName(value: String) = update { copy(displayName = value.take(ServerRegistry.MAX_NAME), nameEdited = true) }

    override fun setColor(color: ServerColor) = update { copy(color = color) }

    // ---- Local account --------------------------------------------------------------------

    override fun toggleLocal() = update { copy(localExpanded = !localExpanded || localOnly) }

    override fun setUsername(value: String) = update { copy(username = value.take(128), problem = problem?.takeIf { it.kind.area != ProblemArea.LOCAL }) }

    override fun setPassword(value: String) = update { copy(password = value.take(256), problem = problem?.takeIf { it.kind.area != ProblemArea.LOCAL }) }

    override fun togglePasswordVisible() = update { copy(passwordVisible = !passwordVisible) }

    override fun signInLocal() {
        val s = state
        val origin = s.probe?.origin ?: return
        if (s.busy != null || s.step != SignInStep.METHOD) return
        if (s.username.isBlank() || s.password.isEmpty()) {
            update { copy(problem = SignInProblem(ProblemKind.CREDENTIALS_MISSING)) }
            return
        }
        run(Busy.SIGNING_IN) { handle(origin, services.auth.login(origin, s.username, s.password)) }
    }

    // ---- Second factor --------------------------------------------------------------------

    override fun selectMethod(method: TwoFactorMethod) {
        val tf = state.twoFactor ?: return
        if (tf.method == method || state.busy != null) return
        update { copy(twoFactor = tf.copy(method = method, code = ""), problem = null) }
    }

    /** Digits only; the 6th digit sends the code (design doc S01 "envoi automatique au 6e chiffre"). */
    override fun setCode(value: String) {
        val tf = state.twoFactor ?: return
        val code = OtpCodes.sanitize(value)
        if (code == tf.code) return
        update { copy(twoFactor = tf.copy(code = code), problem = problem?.takeIf { it.kind.area != ProblemArea.CODE }) }
        if (code.length == OtpCodes.LENGTH) verify()
    }

    override fun verify() {
        val s = state
        val tf = s.twoFactor ?: return
        val origin = s.probe?.origin ?: return
        if (s.busy != null) return
        if (tf.code.length != OtpCodes.LENGTH) {
            update { copy(problem = SignInProblem(ProblemKind.CODE_INCOMPLETE)) }
            return
        }
        run(Busy.VERIFYING) { handle(origin, services.auth.verifyTwoFactor(origin, tf.method, tf.code)) }
    }

    override fun resend() {
        val s = state
        val tf = s.twoFactor ?: return
        val origin = s.probe?.origin ?: return
        if (s.busy != null || now() < tf.resendAvailableAt) return
        update { copy(twoFactor = tf.copy(resendAvailableAt = now() + RESEND_COOLDOWN_MS, resent = false)) }
        viewModelScope.launch {
            val out = services.auth.resendEmailCode(origin)
            val current = state.twoFactor ?: return@launch
            update {
                when (out) {
                    is ApiOutcome.Ok, is ApiOutcome.Accepted -> copy(twoFactor = current.copy(resent = true))
                    is ApiOutcome.RateLimited -> copy(problem = SignInProblem(ProblemKind.CODE_RATE_LIMITED))
                    else -> copy(problem = SignInProblem(ProblemKind.RESEND_FAILED))
                }
            }
        }
    }

    /** "Utiliser un autre compte": back to the methods, the pending login is abandoned. */
    override fun leaveTwoFactor() {
        if (state.busy != null) return
        update { copy(step = SignInStep.METHOD, twoFactor = null, password = "", problem = null, localExpanded = true) }
    }

    // ---- Obligate (S02) -------------------------------------------------------------------

    override fun startSso() {
        val s = state
        if (s.busy != null || s.probe?.offersSso != true || s.step != SignInStep.METHOD) return
        update { copy(ssoOpen = true, problem = null) }
    }

    override fun onSso(outcome: SsoOutcome) {
        val origin = state.probe?.origin
        update { copy(ssoOpen = false) }
        when (outcome) {
            SsoOutcome.Cancelled -> Unit
            is SsoOutcome.Failed -> update {
                copy(
                    problem = SignInProblem(
                        when (outcome.reason) {
                            SsoFailure.FAILED -> ProblemKind.SSO_FAILED
                            SsoFailure.MISCONFIGURED -> ProblemKind.SSO_MISCONFIGURED
                            SsoFailure.NOT_CONFIGURED -> ProblemKind.SSO_NOT_CONFIGURED
                            SsoFailure.PAGE_ERROR -> ProblemKind.SSO_PAGE
                            SsoFailure.TLS -> ProblemKind.SSO_TLS
                        },
                    ),
                    localExpanded = true,
                )
            }
            // The WebView came back to the server: its session cookie is in the shared store.
            SsoOutcome.SignedIn -> if (origin != null) run(Busy.COMPLETING) { complete(origin) }
        }
    }

    // ---- S93 confirmation -----------------------------------------------------------------

    /** "Passer sur Obliance Dev". */
    override fun switchToAdded() {
        val added = state.added ?: return
        if (state.busy != null) return
        run(Busy.COMPLETING) {
            services.openOn(added.profile.id)
            update { copy(finished = true) }
        }
    }

    /** "Rester sur Obliance Prod". */
    override fun stay() = update { copy(finished = true) }

    // ---- Internals ------------------------------------------------------------------------

    private suspend fun handle(origin: String, result: LoginResult) {
        when (result) {
            is LoginResult.SignedIn -> complete(origin)
            is LoginResult.TwoFactorRequired -> {
                val methods = result.methods
                val method = if (methods.totp || !methods.email) TwoFactorMethod.TOTP else TwoFactorMethod.EMAIL
                // With e-mail OTP the server already sent a code at login: the resend waits 30 s.
                val resendAt = if (methods.email) now() + RESEND_COOLDOWN_MS else 0L
                update { copy(step = SignInStep.TWO_FACTOR, twoFactor = TwoFactorUi(methods, method, resendAvailableAt = resendAt), password = "", problem = null) }
            }
            LoginResult.InvalidCredentials -> fail(ProblemKind.CREDENTIALS)
            LoginResult.InvalidCode -> {
                val tf = state.twoFactor ?: return
                update { copy(twoFactor = tf.copy(code = "", rejections = tf.rejections + 1), problem = SignInProblem(ProblemKind.CODE)) }
            }
            LoginResult.TwoFactorSessionLost ->
                update { copy(step = SignInStep.METHOD, twoFactor = null, localExpanded = true, problem = SignInProblem(ProblemKind.CODE_EXPIRED)) }
            is LoginResult.RateLimited ->
                fail(if (state.step == SignInStep.TWO_FACTOR) ProblemKind.CODE_RATE_LIMITED else ProblemKind.RATE_LIMITED)
            is LoginResult.Failed -> {
                val net = (result.outcome as? ApiOutcome.Failure)?.kind == FailureKind.NETWORK
                val status = (result.outcome as? ApiOutcome.Failure)?.status?.toString()
                when {
                    state.step == SignInStep.TWO_FACTOR -> fail(ProblemKind.CODE_FAILED, status)
                    net -> fail(ProblemKind.SIGN_IN_UNREACHABLE)
                    else -> fail(ProblemKind.SIGN_IN_FAILED, status)
                }
            }
        }
    }

    private suspend fun complete(origin: String) {
        val name = when (mode) {
            SignInMode.FIRST -> ServerNames.suggest(origin)
            SignInMode.ADD -> state.displayName.trim().ifEmpty { ServerNames.suggest(origin) }
            SignInMode.REAUTH -> null
        }
        val activeBefore = services.registry.state.value.active
        when (val r = services.auth.completeSignIn(origin, name, activate = mode == SignInMode.FIRST)) {
            is SignInResult.Done -> when (mode) {
                SignInMode.ADD -> {
                    if (r.profile.color != state.color) services.registry.recolor(r.profile.id, state.color)
                    val profile = services.registry.state.value.byId(r.profile.id) ?: r.profile
                    update { copy(step = SignInStep.ADDED, added = AddedServer(profile, activeBefore?.displayName), twoFactor = null, password = "", problem = null) }
                }
                else -> update { copy(finished = true, password = "", problem = null) }
            }
            is SignInResult.Refused -> fail(ProblemKind.LIMIT)
            is SignInResult.NotSignedIn -> fail(ProblemKind.SESSION_NOT_CONFIRMED)
        }
    }

    private fun unreachable(outcome: ApiOutcome<Nothing>): ProblemKind {
        val failure = outcome as? ApiOutcome.Failure ?: return ProblemKind.UNREACHABLE
        val cause = failure.message.orEmpty()
        return when {
            failure.kind != FailureKind.NETWORK -> ProblemKind.UNREACHABLE
            cause.startsWith("SSL") || cause.contains("Certificate", ignoreCase = true) -> ProblemKind.TLS
            cause == "UnknownHostException" -> ProblemKind.HOST_NOT_FOUND
            else -> ProblemKind.UNREACHABLE
        }
    }

    private fun fail(kind: ProblemKind, arg: String? = null) = update { copy(problem = SignInProblem(kind, arg)) }

    private inline fun update(change: SignInUiState.() -> SignInUiState) {
        state = state.change()
    }

    private fun run(busy: Busy, block: suspend () -> Unit) {
        if (state.busy != null && state.busy != busy) return
        update { copy(busy = busy, problem = null) }
        viewModelScope.launch {
            try {
                block()
            } finally {
                update { copy(busy = null) }
            }
        }
    }
}

/** How the Obligate sheet (S02) ended. */
internal sealed interface SsoOutcome {
    data object Cancelled : SsoOutcome

    /** Back on the server: the session cookie is in the shared cookie store. */
    data object SignedIn : SsoOutcome

    data class Failed(val reason: SsoFailure) : SsoOutcome
}

/** What the sign-in screens can ask the flow (implemented by [SignInViewModel]; no-op in screenshots). */
internal interface SignInActions {
    fun setAddress(value: String) {}
    fun check() {}
    fun changeServer() {}
    fun setDisplayName(value: String) {}
    fun setColor(color: ServerColor) {}
    fun toggleLocal() {}
    fun setUsername(value: String) {}
    fun setPassword(value: String) {}
    fun togglePasswordVisible() {}
    fun signInLocal() {}
    fun selectMethod(method: TwoFactorMethod) {}
    fun setCode(value: String) {}
    fun verify() {}
    fun resend() {}
    fun leaveTwoFactor() {}
    fun startSso() {}
    fun onSso(outcome: SsoOutcome) {}
    fun switchToAdded() {}
    fun stay() {}

    object None : SignInActions
}
