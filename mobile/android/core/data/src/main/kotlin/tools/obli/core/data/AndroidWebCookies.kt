package tools.obli.core.data

import android.webkit.CookieManager
import tools.obli.core.network.WebCookies

/** [WebCookies] on the process-wide WebView cookie store (shared with WebHost and SSO). */
class AndroidWebCookies(private val manager: CookieManager = CookieManager.getInstance()) : WebCookies {
    override fun get(url: String): String? = manager.getCookie(url)

    override fun set(url: String, setCookie: String) {
        manager.setCookie(url, setCookie)
    }

    override fun flush() = manager.flush()
}
