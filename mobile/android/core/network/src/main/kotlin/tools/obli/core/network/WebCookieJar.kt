package tools.obli.core.network

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * The cookie store shared with the WebView (android.webkit.CookieManager on
 * Android, a map in tests). Keyed by URL/host, which is what lets several
 * servers coexist without mixing sessions (design doc §10.4).
 */
interface WebCookies {
    /** The `Cookie` header the WebView would send to [url] ("a=1; b=2"), or null. */
    fun get(url: String): String?

    /** Stores one `Set-Cookie` value for [url]. */
    fun set(url: String, setCookie: String)

    fun flush()
}

/**
 * OkHttp [CookieJar] on top of [WebCookies]: native calls, the Socket.IO
 * handshake and the web view share one session (and one tenant) per origin.
 */
class WebCookieJar(private val cookies: WebCookies) : CookieJar {
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val base = url.origin()
        cookies.forEach { this.cookies.set(base, it.toString()) }
        this.cookies.flush()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val header = cookies.get(url.toString()) ?: return emptyList()
        return header.split(';').mapNotNull { part ->
            val eq = part.indexOf('=')
            if (eq <= 0) return@mapNotNull null
            val name = part.substring(0, eq).trim()
            val value = part.substring(eq + 1).trim()
            if (!TOKEN.matches(name)) return@mapNotNull null
            try {
                Cookie.Builder().name(name).value(value).hostOnlyDomain(url.host).path("/").build()
            } catch (_: IllegalArgumentException) {
                null
            }
        }
    }

    /** Value of the `Cookie` header for [origin] (Socket.IO handshake). */
    fun headerFor(origin: String): String? = cookies.get("$origin/")?.takeIf { it.isNotBlank() }

    /**
     * Expires every cookie the store holds for [origin] (server removed or
     * signed out). Cookies of other origins (other servers, Obligate) are kept.
     */
    fun clearOrigin(origin: String) {
        val header = cookies.get("$origin/") ?: return
        header.split(';').map { it.substringBefore('=').trim() }.filter { it.isNotEmpty() }.forEach { name ->
            cookies.set("$origin/", "$name=; Max-Age=0; Path=/")
        }
        cookies.flush()
    }

    private companion object {
        /** RFC 6265 cookie-name (an HTTP token). */
        val TOKEN = Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")
    }

    private fun HttpUrl.origin(): String {
        val defaultPort = if (scheme == "https") 443 else 80
        return "$scheme://$host" + (if (port == defaultPort) "" else ":$port") + "/"
    }
}
