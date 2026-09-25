package tools.obli.shell.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OriginsTest {
    @Test fun normalisesCaseAndDefaultPorts() {
        assertEquals("https://example.com", Origins.of("HTTPS://Example.COM:443/path?q#f"))
        assertEquals("http://example.com", Origins.of("http://example.com:80"))
        assertEquals("https://example.com:8443", Origins.of("https://example.com:8443/"))
    }

    @Test fun ipv6Hosts() {
        assertEquals("https://[::1]:8443", Origins.of("https://[::1]:8443/x"))
        assertEquals("https://[fe80::1]", Origins.of("https://[FE80::1]/"))
    }

    @Test fun userinfoIsNotPartOfTheOrigin() {
        assertEquals("https://evil.net", Origins.of("https://good.com@evil.net/"))
    }

    @Test fun rejectsNonWebAndMalformed() {
        assertNull(Origins.of("mailto:a@b.c"))
        assertNull(Origins.of("https://"))
        assertNull(Origins.of("https://host:99999/"))
        assertNull(Origins.of("https://host:12ab/"))
        assertNull(Origins.of("https://ho st/"))
        assertNull(Origins.of("example.com"))
        assertNull(Origins.of(null))
    }

    @Test fun schemeAndHost() {
        assertEquals("otpauth", Origins.scheme("otpauth://totp/x"))
        assertEquals("intent", Origins.scheme("INTENT://x#Intent;end"))
        assertEquals("example.com", Origins.host("https://example.com:8443/a"))
        assertTrue(Origins.sameOrigin("https://a.com/x", "https://A.com:443/y"))
        assertFalse(Origins.sameOrigin("https://a.com", "http://a.com"))
    }

    @Test fun relativePathResolution() {
        val o = "https://obliance.example.com"
        assertEquals("$o/devices/1?x=2", Origins.resolveRelativePath(o, "/devices/1?x=2"))
        assertNull(Origins.resolveRelativePath(o, "//evil.net/x"))
        assertNull(Origins.resolveRelativePath(o, "/\\evil.net"))
        assertNull(Origins.resolveRelativePath(o, "https://evil.net/"))
        assertNull(Origins.resolveRelativePath(o, "devices"))
        assertNull(Origins.resolveRelativePath(o, "/a\nb"))
        assertNull(Origins.resolveRelativePath(o, "/a b"))
        assertNull(Origins.resolveRelativePath(o, ""))
    }
}
