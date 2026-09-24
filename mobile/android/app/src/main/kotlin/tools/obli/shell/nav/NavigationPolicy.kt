package tools.obli.shell.nav

/** What the shell does with a navigation. */
sealed interface NavDecision {
    /** Let the WebView load it (configured server or Obligate). */
    data object LoadInWebView : NavDecision

    /** Another Obli app: its Android shell if installed, else a Custom Tab. */
    data class OpenObliApp(val appId: String, val url: String) : NavDecision

    /** Any other web page: a Custom Tab (the user's browser). */
    data class OpenCustomTab(val url: String) : NavDecision

    /** mailto:, tel:, otpauth:, intent: — handed to Android as ACTION_VIEW. */
    data class OpenExternalIntent(val url: String) : NavDecision

    /** Dropped (javascript:, file:, content:, data:, unknown schemes...). */
    data object Block : NavDecision
}

/**
 * The single rule book deciding where a URL is opened. Pure Kotlin, no Android
 * types, unit-tested.
 *
 * - The configured server origin and the Obligate (SSO) origin stay in the
 *   WebView: the SSO dance MUST stay in one cookie jar, or the OAuth `state`
 *   check fails ("state mismatch").
 * - A server redirect (request.isRedirect) landing on one of those two origins
 *   also stays (explicit rule; it matters for the SSO hops).
 * - Other Obli app origins (learned from /api/oblitools/manifest) open their
 *   own Android shell, or a Custom Tab.
 * - Everything else http(s) opens a Custom Tab; mailto/tel/otpauth/intent go to
 *   Android; every other scheme is blocked.
 * - Sub-frames may load http(s) (they cannot escape their frame) and nothing
 *   else.
 */
class NavigationPolicy(
    serverOrigin: String,
    obligateOrigin: String?,
    /** origin -> Obli app id (null when the app kind is unknown). */
    private val linkedApps: Map<String, String?> = emptyMap(),
    /** This flavor's app id: a "linked app" of the same kind is just another server. */
    private val selfAppId: String? = null,
) {
    private val server: String = requireNotNull(Origins.of(serverOrigin)) { "invalid server origin" }
    private val obligate: String? = Origins.of(obligateOrigin)

    val trustedOrigins: Set<String> = setOfNotNull(server, obligate)

    fun isServer(url: String?): Boolean = Origins.of(url) == server

    fun isTrusted(url: String?): Boolean = Origins.of(url) in trustedOrigins

    /**
     * [isRedirect] is part of the signature because the WebView reports it and
     * the rule is explicit about it: redirects to the trusted origins stay, and
     * redirects anywhere else are treated like links (never silently followed).
     */
    @Suppress("UNUSED_PARAMETER")
    fun decide(url: String, isMainFrame: Boolean = true, isRedirect: Boolean = false): NavDecision {
        val scheme = Origins.scheme(url) ?: return NavDecision.Block

        if (!isMainFrame) {
            return when (scheme) {
                "http", "https", "about" -> NavDecision.LoadInWebView
                else -> NavDecision.Block
            }
        }

        return when (scheme) {
            "http", "https" -> decideWeb(url)
            "about" -> if (url.trim().equals("about:blank", ignoreCase = true)) NavDecision.LoadInWebView else NavDecision.Block
            in EXTERNAL_SCHEMES -> NavDecision.OpenExternalIntent(url)
            else -> NavDecision.Block
        }
    }

    private fun decideWeb(url: String): NavDecision {
        val origin = Origins.of(url) ?: return NavDecision.Block
        // Server and Obligate stay, whether the navigation is a link or a
        // server-issued redirect: the SSO hops are redirects.
        if (origin in trustedOrigins) return NavDecision.LoadInWebView
        // A redirect towards any other origin leaves the WebView exactly like
        // a link would: the page that issued it stays, the target opens outside.
        if (linkedApps.containsKey(origin)) {
            val appId = linkedApps[origin]
            return if (appId != null && appId != selfAppId) NavDecision.OpenObliApp(appId, url)
            else NavDecision.OpenCustomTab(url)
        }
        return NavDecision.OpenCustomTab(url)
    }

    companion object {
        val EXTERNAL_SCHEMES = setOf("mailto", "tel", "otpauth", "intent")
    }
}
