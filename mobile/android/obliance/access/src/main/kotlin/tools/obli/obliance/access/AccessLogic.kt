package tools.obli.obliance.access

import java.net.URI
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.ServerFeed
import tools.obli.shell.nav.Origins

/*
 * Pure logic of the access screens (no Compose, no Android): unit-tested on the JVM.
 */

/** Display name suggested for a new server (design doc S93 "prérempli par le nom de l'instance ou l'hôte"). */
internal object ServerNames {
    private val ipv4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

    /**
     * "https://obliance-dev.example.org" → "Obliance Dev": the first DNS label,
     * split on '-' / '_', each word capitalised. IP addresses and hosts without
     * a usable first label are kept as they are.
     */
    fun suggest(origin: String): String {
        val host = Origins.host(origin) ?: return origin.take(ServerRegistry.MAX_NAME)
        if (host.startsWith("[") || ipv4.matches(host)) return host
        val words = host.substringBefore('.').split('-', '_').filter { it.isNotEmpty() }
        if (words.isEmpty()) return host.take(ServerRegistry.MAX_NAME)
        return words.joinToString(" ") { w -> w.replaceFirstChar { it.uppercaseChar() } }.take(ServerRegistry.MAX_NAME)
    }

    /** Host of an origin for display ("obliance-prod.example.org", port kept when not default). */
    fun hostOf(origin: String): String = origin.substringAfter("://")
}

/** A 6-digit second-factor code found in a pasted text ("482913", "482 913", "Code: 482-913"). */
internal object OtpCodes {
    const val LENGTH = 6

    fun fromText(text: CharSequence?): String? {
        if (text.isNullOrBlank() || text.length > 64) return null
        val digits = text.filter { it.isDigit() }
        return digits.takeIf { it.length == LENGTH }?.toString()
    }

    /** Keeps what a code field accepts: digits only, at most [LENGTH]. */
    fun sanitize(input: String): String = input.filter { it.isDigit() }.take(LENGTH)

    /** "482913" → "482 913" (chip label). */
    fun grouped(code: String): String = if (code.length == LENGTH) code.substring(0, 3) + " " + code.substring(3) else code
}

/** Where the Obligate sign-in WebView (S02) is, for one navigation of its main frame. */
internal sealed interface SsoStep {
    /** Let the WebView load it (Obligate pages, `/auth/sso-redirect`, `/auth/callback?code=…`). */
    data object Continue : SsoStep

    /** Back on the server outside `/auth` and `/login`: the session cookie is set, close the sheet. */
    data object SignedIn : SsoStep

    data class Failed(val reason: SsoFailure) : SsoStep

    /** Never loaded (cleartext http, intent:, javascript:, file:…). */
    data object Blocked : SsoStep
}

internal enum class SsoFailure {
    /** `/login?error=sso_failed`, or Obligate came back without a code (cancelled, refused). */
    FAILED,

    /** `/login?error=sso_misconfigured`. */
    MISCONFIGURED,

    /** `/login` without error: Obligate is not configured on this server any more. */
    NOT_CONFIGURED,

    /** The page could not be loaded (network error on the main frame). */
    PAGE_ERROR,

    /** The HTTPS certificate of a page was refused. */
    TLS,
}

/**
 * Navigation rules of the Obligate WebView (server/src/routes/obligateCallback.routes.ts):
 * `/auth/sso-redirect` → Obligate `/authorize` → `/auth/callback?code&state` →
 * (meta refresh) `/` on success, or `/login?error=sso_failed|sso_misconfigured`.
 * The flow must stay in the WebView: the OAuth `state` lives in the server session.
 */
internal object SsoNavigation {
    const val START_PATH = "/auth/sso-redirect"
    private const val CALLBACK_PATH = "/auth/callback"

    fun startUrl(origin: String): String = origin + START_PATH

    fun classify(origin: String, url: String?): SsoStep {
        if (url.isNullOrBlank()) return SsoStep.Continue
        val scheme = Origins.scheme(url)
        if (scheme == "about") return SsoStep.Continue
        if (scheme != "https") return SsoStep.Blocked
        val urlOrigin = Origins.of(url) ?: return SsoStep.Blocked
        if (urlOrigin != origin) return SsoStep.Continue
        val uri = try {
            URI(url.trim())
        } catch (_: Exception) {
            return SsoStep.Continue
        }
        val path = uri.rawPath.orEmpty().ifEmpty { "/" }
        val query = uri.rawQuery.orEmpty()
        return when {
            path == CALLBACK_PATH -> if (param(query, "code").isNullOrEmpty()) SsoStep.Failed(SsoFailure.FAILED) else SsoStep.Continue
            path.startsWith("/auth/") || path == "/auth" -> SsoStep.Continue
            path == "/login" || path.startsWith("/login/") -> when (param(query, "error")) {
                null, "" -> SsoStep.Failed(SsoFailure.NOT_CONFIGURED)
                "sso_misconfigured" -> SsoStep.Failed(SsoFailure.MISCONFIGURED)
                else -> SsoStep.Failed(SsoFailure.FAILED)
            }
            else -> SsoStep.SignedIn
        }
    }

    private fun param(query: String, name: String): String? =
        query.split('&').firstOrNull { it.substringBefore('=') == name }?.substringAfter('=', "")
}

/** State line of a server in S81 and S92 (design doc §2.10, §5 S81/S92). */
internal sealed interface ServerStatus {
    /** Active server, socket connected: "Actif · temps réel connecté". */
    data object Live : ServerStatus

    /** Active server, socket not connected (yet). */
    data object Connecting : ServerStatus

    /** Signed in, last feed refresh at [at] (epoch ms): "Vérifié à 03:20". */
    data class Checked(val at: Long) : ServerStatus

    /** Signed in, no refresh time known. */
    data object SignedIn : ServerStatus

    /** Not probed yet. */
    data object Checking : ServerStatus

    /** "Injoignable depuis 03:02" ([since] null: time unknown). */
    data class Unreachable(val since: Long?) : ServerStatus

    /** "Session expirée · Se reconnecter". */
    data object Expired : ServerStatus

    data object SignedOut : ServerStatus

    /** The user can sign in again from this row. */
    val needsSignIn: Boolean get() = this == Expired || this == SignedOut

    companion object {
        fun of(active: Boolean, auth: AuthState, realtime: ConnectionState?, feed: ServerFeed?): ServerStatus = when {
            auth == AuthState.Expired || feed?.status == FeedStatus.EXPIRED -> Expired
            auth == AuthState.SignedOut || feed?.status == FeedStatus.SIGNED_OUT -> SignedOut
            auth is AuthState.Unreachable -> Unreachable(auth.since)
            feed?.status == FeedStatus.UNREACHABLE -> Unreachable(null)
            auth == AuthState.Unknown -> Checking
            active && realtime == ConnectionState.CONNECTED -> Live
            active -> Connecting
            feed?.updatedAt != null -> Checked(feed.updatedAt!!)
            else -> SignedIn
        }
    }
}

/** "03:20" in the device time zone (24 h, design doc §8 micro-typography). */
internal object Clock24 {
    private val format = DateTimeFormatter.ofPattern("HH:mm")

    fun format(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        format.format(Instant.ofEpochMilli(epochMs).atZone(zone))
}
