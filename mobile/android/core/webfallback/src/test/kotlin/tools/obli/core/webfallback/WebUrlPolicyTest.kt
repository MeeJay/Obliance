package tools.obli.core.webfallback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WebUrlPolicyTest {
    private val origin = "https://obliance.example.org"

    @Test fun startUrlStaysOnTheServer() {
        assertEquals("https://obliance.example.org/admin/users", WebUrlPolicy.startUrl(origin, "/admin/users"))
        assertNull(WebUrlPolicy.startUrl(origin, "//evil.example.net/x"))
        assertNull(WebUrlPolicy.startUrl(origin, "https://evil.example.net/"))
        assertNull(WebUrlPolicy.startUrl(origin, "admin"))
        assertNull(WebUrlPolicy.startUrl(origin, "/\\evil"))
    }

    @Test fun sameOriginLoadsInside() {
        assertEquals(WebNav.Stay, WebUrlPolicy.classify(origin, "https://obliance.example.org/settings?tab=api"))
        assertEquals(WebNav.Stay, WebUrlPolicy.classify(origin, "https://OBLIANCE.example.org:443/"))
    }

    @Test fun otherOriginsOpenOutside() {
        assertEquals(WebNav.External("https://id.example.org/login"), WebUrlPolicy.classify(origin, "https://id.example.org/login"))
        assertEquals(WebNav.External("http://obliance.example.org/"), WebUrlPolicy.classify(origin, "http://obliance.example.org/"))
        assertEquals(WebNav.External("https://obliance.example.org:8443/"), WebUrlPolicy.classify(origin, "https://obliance.example.org:8443/"))
        assertEquals(WebNav.External("https://obliance.example.org.evil.example.net/"), WebUrlPolicy.classify(origin, "https://obliance.example.org.evil.example.net/"))
    }

    @Test fun dangerousSchemesAreBlocked() {
        listOf("javascript:alert(1)", "file:///sdcard/x", "content://x/y", "data:text/html,hi", "intent://x#Intent;end", "about:blank", "", null).forEach {
            assertEquals(it.toString(), WebNav.Blocked, WebUrlPolicy.classify(origin, it))
        }
        assertEquals(WebNav.System("mailto:support@example.org"), WebUrlPolicy.classify(origin, "mailto:support@example.org"))
        assertEquals(WebNav.System("tel:+33100000000"), WebUrlPolicy.classify(origin, "tel:+33100000000"))
    }

    @Test fun nativeScreensTakeTheirPaths() {
        val inApp: (String) -> Boolean = { it.startsWith("/devices/") }
        assertEquals(WebNav.InApp("/devices/12?tab=scripts"), WebUrlPolicy.classify(origin, "https://obliance.example.org/devices/12?tab=scripts", inApp))
        assertEquals(WebNav.Stay, WebUrlPolicy.classify(origin, "https://obliance.example.org/admin", inApp))
        // Another origin's /devices/ path is never taken for ours.
        assertEquals(WebNav.External("https://other.example.org/devices/12"), WebUrlPolicy.classify(origin, "https://other.example.org/devices/12", inApp))
    }

    @Test fun pathOf() {
        assertEquals("/", WebUrlPolicy.pathOf(origin, "https://obliance.example.org"))
        assertEquals("/?x=1", WebUrlPolicy.pathOf(origin, "https://obliance.example.org?x=1"))
        assertEquals("/a/b#c", WebUrlPolicy.pathOf(origin, "https://obliance.example.org/a/b#c"))
        assertNull(WebUrlPolicy.pathOf(origin, "https://other.example.org/a"))
    }

    @Test fun downloadsOnlyCarryTheCookieToTheServer() {
        assertTrue(WebUrlPolicy.isSameOrigin(origin, "https://obliance.example.org/api/reports/1.pdf"))
        assertFalse(WebUrlPolicy.isSameOrigin(origin, "https://cdn.example.net/file.zip"))
    }
}
