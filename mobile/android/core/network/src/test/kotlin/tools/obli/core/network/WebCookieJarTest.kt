package tools.obli.core.network

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WebCookieJarTest {
    /** Behaves like CookieManager for what matters here: per host, Max-Age=0 deletes. */
    private class FakeWebCookies : WebCookies {
        val byHost = linkedMapOf<String, LinkedHashMap<String, String>>()
        var flushes = 0
        override fun get(url: String): String? =
            byHost[url.toHttpUrl().host]?.entries?.joinToString("; ") { "${it.key}=${it.value}" }?.takeIf { it.isNotEmpty() }
        override fun set(url: String, setCookie: String) {
            val host = url.toHttpUrl().host
            val pair = setCookie.substringBefore(';')
            val name = pair.substringBefore('='); val value = pair.substringAfter('=', "")
            val map = byHost.getOrPut(host) { linkedMapOf() }
            if (setCookie.contains("Max-Age=0", ignoreCase = true)) map.remove(name) else map[name] = value
        }
        override fun flush() { flushes++ }
    }

    @Test fun cookiesStayWithTheirServer() {
        val store = FakeWebCookies()
        val jar = WebCookieJar(store)
        val bh = "https://obliance.binaryhearts.me/api/auth/login".toHttpUrl()
        val at = "https://atelier.binaryhearts.me/api/auth/me".toHttpUrl()
        jar.saveFromResponse(bh, listOf(Cookie.parse(bh, "connect.sid=s%3Abh; Path=/; HttpOnly; Secure")!!))
        jar.saveFromResponse(at, listOf(Cookie.parse(at, "connect.sid=s%3Aat; Path=/; HttpOnly; Secure")!!))
        assertEquals(listOf("connect.sid" to "s%3Abh"), jar.loadForRequest(bh).map { it.name to it.value })
        assertEquals("connect.sid=s%3Aat", jar.headerFor("https://atelier.binaryhearts.me"))
        assertEquals(2, store.flushes)
    }

    @Test fun clearOriginOnlyTouchesThatServer() {
        val store = FakeWebCookies()
        val jar = WebCookieJar(store)
        store.set("https://obliance.binaryhearts.me/", "connect.sid=s%3Abh")
        store.set("https://obliance.binaryhearts.me/", "lang=fr")
        store.set("https://id.binaryhearts.me/", "obligate.sid=keep")
        jar.clearOrigin("https://obliance.binaryhearts.me")
        assertNull(jar.headerFor("https://obliance.binaryhearts.me"))
        assertEquals("obligate.sid=keep", jar.headerFor("https://id.binaryhearts.me"))
    }

    @Test fun malformedPairsAreSkipped() {
        val store = FakeWebCookies()
        store.byHost["obliance.binaryhearts.me"] = linkedMapOf("ok" to "1", "" to "x", "bad name" to "2")
        val jar = WebCookieJar(store)
        assertEquals(listOf("ok"), jar.loadForRequest("https://obliance.binaryhearts.me/".toHttpUrl()).map { it.name })
    }
}
