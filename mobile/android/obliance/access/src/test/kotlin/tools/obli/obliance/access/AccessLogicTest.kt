package tools.obli.obliance.access

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.auth.AuthState
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.ServerFeed
import tools.obli.obliance.data.sample.SampleData

class AccessLogicTest {
    private val origin = "https://obliance-prod.example.org"

    @Test fun `suggested names come from the first DNS label`() {
        assertEquals("Obliance Dev", ServerNames.suggest("https://obliance-dev.example.org"))
        assertEquals("Obliance Qual", ServerNames.suggest("https://obliance_qual.example.org:8443"))
        assertEquals("10.0.0.12", ServerNames.suggest("https://10.0.0.12"))
        assertEquals("Obliance", ServerNames.suggest("https://obliance"))
        assertEquals("obliance-dev.example.org:8443", ServerNames.hostOf("https://obliance-dev.example.org:8443"))
    }

    @Test fun `a 6-digit code is found in a pasted text`() {
        assertEquals("482913", OtpCodes.fromText("482913"))
        assertEquals("482913", OtpCodes.fromText(" 482 913 "))
        assertEquals("482913", OtpCodes.fromText("Code: 482-913"))
        assertNull(OtpCodes.fromText("48291"))
        assertNull(OtpCodes.fromText("4829134"))
        assertNull(OtpCodes.fromText(null))
        assertEquals("123456", OtpCodes.sanitize("12a34 5678"))
        assertEquals("482 913", OtpCodes.grouped("482913"))
    }

    @Test fun `the Obligate flow continues on its own pages`() {
        assertEquals("$origin/auth/sso-redirect", SsoNavigation.startUrl(origin))
        assertEquals(SsoStep.Continue, SsoNavigation.classify(origin, "$origin/auth/sso-redirect"))
        assertEquals(SsoStep.Continue, SsoNavigation.classify(origin, "https://id.example.org/authorize?client_id=x&state=y"))
        assertEquals(SsoStep.Continue, SsoNavigation.classify(origin, "$origin/auth/callback?code=abc&state=def"))
        assertEquals(SsoStep.Continue, SsoNavigation.classify(origin, "about:blank"))
    }

    @Test fun `the Obligate flow ends back on the server`() {
        assertEquals(SsoStep.SignedIn, SsoNavigation.classify(origin, "$origin/"))
        assertEquals(SsoStep.SignedIn, SsoNavigation.classify(origin, origin))
        assertEquals(SsoStep.SignedIn, SsoNavigation.classify(origin, "HTTPS://Obliance-Prod.example.org/dashboard"))
        assertEquals(SsoStep.SignedIn, SsoNavigation.classify(origin, "https://obliance-prod.example.org:443/devices?x=1"))
    }

    @Test fun `failures of the Obligate flow are recognised`() {
        assertEquals(SsoStep.Failed(SsoFailure.FAILED), SsoNavigation.classify(origin, "$origin/login?error=sso_failed"))
        assertEquals(SsoStep.Failed(SsoFailure.MISCONFIGURED), SsoNavigation.classify(origin, "$origin/login?error=sso_misconfigured"))
        assertEquals(SsoStep.Failed(SsoFailure.NOT_CONFIGURED), SsoNavigation.classify(origin, "$origin/login"))
        // Obligate came back without a code (the user cancelled or was refused).
        assertEquals(SsoStep.Failed(SsoFailure.FAILED), SsoNavigation.classify(origin, "$origin/auth/callback?error=access_denied"))
    }

    @Test fun `other origins and schemes never end the flow on the server`() {
        // Another server of the registry, or a look-alike host, is just a page of the flow.
        assertEquals(SsoStep.Continue, SsoNavigation.classify(origin, "https://obliance-dev.example.org/"))
        assertEquals(SsoStep.Continue, SsoNavigation.classify(origin, "https://obliance-prod.example.org.evil.example/"))
        assertEquals(SsoStep.Blocked, SsoNavigation.classify(origin, "http://obliance-prod.example.org/"))
        assertEquals(SsoStep.Blocked, SsoNavigation.classify(origin, "intent://scan/#Intent;end"))
        assertEquals(SsoStep.Blocked, SsoNavigation.classify(origin, "javascript:alert(1)"))
    }

    @Test fun `server state lines follow auth, socket and feed`() {
        val signedIn = AuthState.SignedIn(SampleData.probe(SampleData.PROD))
        val feed = ServerFeed(SampleData.DEV, FeedStatus.OK, 1_000L)
        assertEquals(ServerStatus.Live, ServerStatus.of(true, signedIn, ConnectionState.CONNECTED, null))
        assertEquals(ServerStatus.Connecting, ServerStatus.of(true, signedIn, ConnectionState.RECONNECTING, null))
        assertEquals(ServerStatus.Checked(1_000L), ServerStatus.of(false, signedIn, null, feed))
        assertEquals(ServerStatus.SignedIn, ServerStatus.of(false, signedIn, null, null))
        assertEquals(ServerStatus.Expired, ServerStatus.of(false, AuthState.Expired, null, feed))
        assertEquals(ServerStatus.Expired, ServerStatus.of(false, signedIn, null, feed.copy(status = FeedStatus.EXPIRED)))
        assertEquals(ServerStatus.Unreachable(5L), ServerStatus.of(false, AuthState.Unreachable(5L), null, feed))
        assertEquals(ServerStatus.Unreachable(null), ServerStatus.of(false, signedIn, null, feed.copy(status = FeedStatus.UNREACHABLE)))
        assertEquals(ServerStatus.SignedOut, ServerStatus.of(true, AuthState.SignedOut, ConnectionState.DISCONNECTED, null))
        assertEquals(ServerStatus.Checking, ServerStatus.of(false, AuthState.Unknown, null, null))
        assertTrue(ServerStatus.Expired.needsSignIn && ServerStatus.SignedOut.needsSignIn && !ServerStatus.Live.needsSignIn)
    }

    @Test fun `times are 24 h in the given zone`() {
        // 2026-09-25T01:14:00Z = 03:14 in Paris.
        assertEquals("03:14", Clock24.format(1_790_298_840_000L, ZoneId.of("Europe/Paris")))
    }
}
