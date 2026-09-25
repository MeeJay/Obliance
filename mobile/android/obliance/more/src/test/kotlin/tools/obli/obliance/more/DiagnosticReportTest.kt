package tools.obli.obliance.more

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticReportTest {
    private val prod = "https://obliance-prod.example.org"
    private val dev = "https://obliance-dev.example.org"
    private val qual = "https://obliance-qual.example.org:8443"

    private fun input(extra: List<String> = emptyList(), devName: String = "Obliance Dev") = DiagnosticInput(
        appVersionName = "0.3.0-alpha",
        appVersionCode = 3,
        androidRelease = "15",
        sdkInt = 35,
        deviceModel = "Google Pixel 8",
        servers = listOf(
            DiagnosticServer("Obliance Prod", prod, "5.1.110", "signed in", active = true),
            DiagnosticServer(devName, dev, "5.1.108", "session expired", active = false),
            DiagnosticServer("Obliance Qual", qual, null, "unreachable", active = false),
        ),
        socketState = "connected",
        lockState = "on (five_min)",
        extra = extra,
    )

    @Test fun `versions, names and states are there`() {
        val text = DiagnosticReport.build(input())
        assertTrue(text, text.contains("0.3.0-alpha (3)"))
        assertTrue(text, text.contains("Android 15 (API 35)"))
        assertTrue(text, text.contains("Google Pixel 8"))
        assertTrue(text, text.contains("Obliance Prod · Obliance 5.1.110 · signed in · active"))
        assertTrue(text, text.contains("Obliance Dev · Obliance 5.1.108 · session expired"))
        assertTrue(text, text.contains("Obliance Qual · Obliance ? · unreachable"))
        assertTrue(text, text.contains("Realtime (active server): connected"))
        assertTrue(text, text.contains("App lock: on (five_min)"))
    }

    @Test fun `never an origin, a host, a cookie, a token or an alert text`() {
        val alert = "CRITIQUE · PC-COMPTA-03 — Processeur à 98 %"
        val text = DiagnosticReport.build(
            input(
                extra = listOf(
                    "Notifications: last pass ok on $prod/api/live-alerts/all",
                    "Cookie: connect.sid=s%3AabcDEF.123",
                    "tunnel wss://obliance-prod.example.org/api/remote/tunnel/9f8e7d6c",
                    "sessionToken=9f8e7d6c5b4a",
                    "token: eyJhbGciOi",
                    "relay host obliance-dev.example.org answered",
                ),
                // A server that was named after its host when it was added.
                devName = "obliance-dev.example.org",
            ),
        )
        for (leak in listOf(prod, dev, qual, "obliance-prod.example.org", "obliance-dev.example.org", "obliance-qual.example.org", "example.org")) {
            assertFalse("leaks $leak:\n$text", text.contains(leak, ignoreCase = true))
        }
        for (secret in listOf("abcDEF", "s%3A", "9f8e7d6c", "eyJhbGciOi", "/api/remote/tunnel")) {
            assertFalse("leaks $secret:\n$text", text.contains(secret))
        }
        assertFalse(text.contains(alert))
        assertFalse(text.contains("PC-COMPTA-03"))
        // The masked server keeps its place and its version.
        assertTrue(text, text.contains("Server 2: Server 2 · Obliance 5.1.108"))
        assertTrue(text, text.contains(DiagnosticReport.HOST_MASK) || text.contains(DiagnosticReport.URL_MASK))
    }

    @Test fun `version strings are not mistaken for host names`() {
        val text = DiagnosticReport.build(input())
        assertFalse(text.contains(DiagnosticReport.HOST_MASK))
        assertTrue(text.contains("5.1.110"))
    }
}
