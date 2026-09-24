package tools.obli.shell.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationPolicyTest {
    private val server = "https://obliance.example.com"
    private val obligate = "https://sso.example.com"
    private val linked = mapOf(
        "https://obliview.example.com" to "obliview",
        "https://mystery.example.com" to null,
        "https://obliance-2.example.com" to "obliance",
    )
    private val policy = NavigationPolicy(server, obligate, linked, selfAppId = "obliance")

    @Test fun serverOriginStays() {
        assertEquals(NavDecision.LoadInWebView, policy.decide("$server/devices/12?tab=x"))
        assertEquals(NavDecision.LoadInWebView, policy.decide("https://OBLIANCE.example.com:443/"))
    }

    @Test fun obligateStays() {
        assertEquals(NavDecision.LoadInWebView, policy.decide("$obligate/authorize?client_id=x&state=y"))
    }

    @Test fun ssoRedirectsToTrustedOriginsStay() {
        assertEquals(NavDecision.LoadInWebView, policy.decide("$obligate/authorize", isRedirect = true))
        assertEquals(NavDecision.LoadInWebView, policy.decide("$server/auth/callback?code=1&state=2", isRedirect = true))
    }

    @Test fun redirectToForeignOriginLeavesTheWebView() {
        assertEquals(
            NavDecision.OpenCustomTab("https://evil.example.net/"),
            policy.decide("https://evil.example.net/", isRedirect = true),
        )
    }

    @Test fun cleartextVariantOfServerIsNotTrusted() {
        assertEquals(NavDecision.OpenCustomTab("http://obliance.example.com/"), policy.decide("http://obliance.example.com/"))
    }

    @Test fun otherPortIsAnotherOrigin() {
        assertEquals(
            NavDecision.OpenCustomTab("https://obliance.example.com:8443/"),
            policy.decide("https://obliance.example.com:8443/"),
        )
    }

    @Test fun lookalikeHostIsNotTrusted() {
        val url = "https://obliance.example.com.evil.net/"
        assertEquals(NavDecision.OpenCustomTab(url), policy.decide(url))
        val userinfo = "https://obliance.example.com@evil.net/"
        assertEquals(NavDecision.OpenCustomTab(userinfo), policy.decide(userinfo))
    }

    @Test fun linkedObliAppOpensItsShell() {
        val url = "https://obliview.example.com/auth/sso-redirect?tenant=acme"
        assertEquals(NavDecision.OpenObliApp("obliview", url), policy.decide(url))
    }

    @Test fun unknownOrSameKindLinkedAppOpensCustomTab() {
        assertEquals(NavDecision.OpenCustomTab("https://mystery.example.com/"), policy.decide("https://mystery.example.com/"))
        assertEquals(NavDecision.OpenCustomTab("https://obliance-2.example.com/"), policy.decide("https://obliance-2.example.com/"))
    }

    @Test fun externalWebOpensCustomTab() {
        val url = "https://nvd.nist.gov/vuln/detail/CVE-2024-0001"
        assertEquals(NavDecision.OpenCustomTab(url), policy.decide(url))
    }

    @Test fun appSchemesGoToAndroid() {
        for (url in listOf("mailto:a@b.c", "tel:+33123456789", "otpauth://totp/x?secret=A", "intent://scan/#Intent;scheme=zxing;end")) {
            assertEquals(url, NavDecision.OpenExternalIntent(url), policy.decide(url))
        }
    }

    @Test fun dangerousSchemesAreBlocked() {
        for (url in listOf("javascript:alert(1)", "file:///sdcard/x", "content://x/y", "data:text/html,hi", "blob:https://x/1", "market://details?id=x", "chrome://settings", "")) {
            assertEquals(url, NavDecision.Block, policy.decide(url))
        }
    }

    @Test fun aboutBlankOnlyIsAllowed() {
        assertEquals(NavDecision.LoadInWebView, policy.decide("about:blank"))
        assertEquals(NavDecision.Block, policy.decide("about:srcdoc"))
    }

    @Test fun subFramesMayLoadWebButNothingElse() {
        assertEquals(NavDecision.LoadInWebView, policy.decide("https://anything.example.org/embed", isMainFrame = false))
        assertEquals(NavDecision.Block, policy.decide("mailto:x@y.z", isMainFrame = false))
        assertEquals(NavDecision.Block, policy.decide("javascript:1", isMainFrame = false))
    }

    @Test fun withoutObligateOnlyTheServerIsTrusted() {
        val p = NavigationPolicy(server, null)
        assertTrue(p.isTrusted("$server/x"))
        assertFalse(p.isTrusted("$obligate/x"))
        assertEquals(NavDecision.OpenCustomTab("$obligate/x"), p.decide("$obligate/x"))
        assertEquals(setOf(server), p.trustedOrigins)
    }

    @Test fun isServerMatchesOnlyTheServer() {
        assertTrue(policy.isServer("$server/api/x"))
        assertFalse(policy.isServer("$obligate/"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun invalidServerIsRejected() {
        NavigationPolicy("not a url", null)
    }
}
