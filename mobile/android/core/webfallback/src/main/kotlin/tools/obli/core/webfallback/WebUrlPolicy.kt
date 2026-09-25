package tools.obli.core.webfallback

import tools.obli.shell.nav.Origins

/** What the web view does with a main-frame navigation. */
sealed interface WebNav {
    /** Same origin as the server: loads in the web view, with the session cookie. */
    data object Stay : WebNav

    /** Same origin, but the app has a native screen for it (`/devices/12` → S30): not loaded. */
    data class InApp(val path: String) : WebNav

    /** An http(s) page of another origin: opened outside (Custom Tab), never with the session. */
    data class External(val url: String) : WebNav

    /** mailto:, tel:: handed to Android. */
    data class System(val url: String) : WebNav

    /** javascript:, file:, content:, data:, intent:… : refused. */
    data object Blocked : WebNav
}

/**
 * URL rules of the S90 web view (design doc §2.8): only the server's own
 * origin loads inside (the shared CookieManager session goes nowhere else);
 * other origins leave through a Custom Tab; a same-origin path the app shows
 * natively is handed to the app. Pure JVM, unit-tested.
 */
object WebUrlPolicy {
    private val SYSTEM_SCHEMES = setOf("mailto", "tel", "sms", "geo")

    /** Absolute URL of a same-origin [path] ("/admin/users"), or null if [path] would leave [origin]. */
    fun startUrl(origin: String, path: String): String? = Origins.resolveRelativePath(origin, path)

    /** Path + query + fragment of a same-origin [url] ("/devices/12?tab=x"), or null. */
    fun pathOf(origin: String, url: String?): String? {
        if (url == null || Origins.of(url) != origin) return null
        val afterScheme = url.substringAfter("://")
        val slash = afterScheme.indexOfAny(charArrayOf('/', '?', '#'))
        if (slash < 0) return "/"
        val rest = afterScheme.substring(slash)
        return if (rest.startsWith("/")) rest else "/$rest"
    }

    /**
     * Classifies a main-frame navigation of the web view on [origin]. [inApp]
     * receives the same-origin path and returns true when the app opens it
     * natively instead.
     */
    fun classify(origin: String, url: String?, inApp: (String) -> Boolean = { false }): WebNav {
        val scheme = Origins.scheme(url) ?: return WebNav.Blocked
        return when (scheme) {
            "http", "https" -> {
                val target = Origins.of(url) ?: return WebNav.Blocked
                if (target == origin) {
                    val path = pathOf(origin, url) ?: "/"
                    if (inApp(path)) WebNav.InApp(path) else WebNav.Stay
                } else {
                    // Also an http:// downgrade of the same host: a different origin.
                    WebNav.External(url!!.trim())
                }
            }
            in SYSTEM_SCHEMES -> WebNav.System(url!!.trim())
            else -> WebNav.Blocked
        }
    }

    /** Downloads carry the session cookie only to the server's own origin. */
    fun isSameOrigin(origin: String, url: String?): Boolean = Origins.of(url) == origin
}
