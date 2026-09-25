package tools.obli.obliance.more

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.net.URI
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.model.ObliUser
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.security.ActionPrompter
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.core.security.TwoFactorAnswer
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.TenantScope

/** Account state of the ACTIVE server, as S80 shows it. */
internal enum class AccountState { SIGNED_IN, EXPIRED, SIGNED_OUT, UNKNOWN }

internal data class MoreUi(
    /** The active server (the account shown is the one of this server, design doc §5 S80). */
    val server: ServerProfile? = null,
    val host: String? = null,
    val serverCount: Int = 0,
    val multiServer: Boolean = false,
    val user: ObliUser? = null,
    val account: AccountState = AccountState.UNKNOWN,
    val tenantName: String? = null,
    val globalView: Boolean = false,
) {
    /** "og_" usernames and Obligate-sourced accounts (design doc §5 S85). */
    val obligate: Boolean get() = user?.let { it.isObligate || it.username.startsWith("og_") } == true

    /** Two letters of the avatar: "Karim Benali" -> "KB". */
    val initials: String
        get() {
            val label = user?.label ?: return ""
            val words = label.split(Regex("[^\\p{L}\\p{N}]+")).filter { it.isNotEmpty() }
            return when {
                words.size >= 2 -> "${words[0].first()}${words[1].first()}"
                words.size == 1 -> words[0].take(2)
                else -> ""
            }.uppercase()
        }
}

/** The "Se déconnecter de ce serveur" confirmation: it names the server it was opened for. */
internal data class SignOutConfirm(val serverId: ServerId, val serverName: String, val busy: Boolean = false)

internal object MoreMapper {
    fun map(registry: ServerRegistryState, auth: AuthState?, scope: TenantScope): MoreUi {
        val active = registry.active
        val probe = (auth as? AuthState.SignedIn)?.probe
        return MoreUi(
            server = active,
            host = active?.origin?.let(::hostOf),
            serverCount = registry.profiles.size,
            multiServer = registry.isMultiServer,
            user = probe?.user,
            account = when (auth) {
                is AuthState.SignedIn -> AccountState.SIGNED_IN
                AuthState.Expired -> AccountState.EXPIRED
                AuthState.SignedOut -> AccountState.SIGNED_OUT
                // Unreachable keeps the last signed-in state in ServerSession; otherwise nothing is known yet.
                is AuthState.Unreachable, AuthState.Unknown, null -> AccountState.UNKNOWN
            },
            // The scope follows the active server; ignore a stale one during a switch.
            tenantName = scope.takeIf { it.serverId == null || it.serverId == active?.id }?.current?.name,
            globalView = scope.serverId == active?.id && scope.isGlobalView,
        )
    }

    /** "https://obliance-prod.example.org" -> "obliance-prod.example.org" (port kept when not 443). */
    fun hostOf(origin: String): String = runCatching {
        val uri = URI(origin)
        val host = uri.host ?: return origin
        if (uri.port > 0 && uri.port != 443) "$host:${uri.port}" else host
    }.getOrDefault(origin)
}

/**
 * S80 "Plus": the account of the active server, its scope, the servers entry
 * and "Se déconnecter de ce serveur" (T1 through [ActionRunner], the
 * confirmation names the server, design doc §2.10).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class MoreViewModel(private val services: ObliServices) : ViewModel() {
    val ui: StateFlow<MoreUi> = combine(
        services.registry.state,
        services.sessions.active.flatMapLatest { it?.auth ?: flowOf(null) },
        services.tenants.scope,
        MoreMapper::map,
    ).stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        MoreMapper.map(services.registry.state.value, services.sessions.active.value?.auth?.value, services.tenants.scope.value),
    )

    private val _confirm = MutableStateFlow<SignOutConfirm?>(null)
    val confirm: StateFlow<SignOutConfirm?> = _confirm.asStateFlow()

    private var pending: CompletableDeferred<Boolean>? = null

    private val prompter = object : ActionPrompter {
        override suspend fun confirmTenantSwitch(spec: ActionSpec, tenantName: String): Boolean = false

        override suspend fun confirm(spec: ActionSpec): Boolean {
            val answer = CompletableDeferred<Boolean>().also { pending = it }
            return answer.await()
        }

        override suspend fun askTwoFactor(spec: ActionSpec, currentIp: String?, previousWasWrong: Boolean): TwoFactorAnswer? = null
        override suspend fun approvalRequested(spec: ActionSpec, approvalId: Long) = Unit
        override suspend fun unlockPrivacy(spec: ActionSpec, feature: String?, passwordSet: Boolean): Boolean = false

        // The application shows S03 for the active server.
        override suspend fun sessionExpired() = Unit
    }

    private val runner = ActionRunner(prompter)

    /** Opens the confirmation for the server active NOW; the sign-out targets that server even if another becomes active meanwhile. */
    fun askSignOut() {
        val server = services.registry.state.value.active ?: return
        if (_confirm.value != null) return
        _confirm.value = SignOutConfirm(server.id, server.displayName)
        viewModelScope.launch {
            val spec = ActionSpec(key = KEY_SIGN_OUT, tier = Tier.T1, title = KEY_SIGN_OUT, target = server.displayName, scope = server.displayName)
            // Done, cancelled or refused: the sheet closes; the app reacts to the SignedOut session (S03 / next server).
            runner.run(spec) { services.auth.signOut(server.id) }
            _confirm.value = null
        }
    }

    /** Answer of the confirmation sheet. */
    fun answer(confirmed: Boolean) {
        if (confirmed) _confirm.update { it?.copy(busy = true) }
        pending?.complete(confirmed)
        pending = null
    }

    companion object {
        const val KEY_SIGN_OUT = "auth.sign_out"
    }
}
