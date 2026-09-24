package tools.obli.shell.bridge

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeValidatorsTest {
    private val server = "https://obliance.example.com"

    @Test fun filenamesAreSanitised() {
        assertEquals("report.csv", BridgeValidators.filename("report.csv"))
        assertEquals("_.._etc_passwd", BridgeValidators.filename("../../etc/passwd"))
        assertEquals("a_b_c.txt", BridgeValidators.filename("a/b\\c.txt"))
        assertEquals("x_y.json", BridgeValidators.filename("x\u0000y.json"))
        assertEquals("hidden", BridgeValidators.filename(".hidden"))
        assertEquals("Rapport été.pdf", BridgeValidators.filename("Rapport été.pdf"))
    }

    @Test fun longFilenamesKeepTheirExtension() {
        val name = BridgeValidators.filename("a".repeat(400) + ".xlsx")
        assertEquals(BridgeValidators.MAX_FILENAME, name.length)
        assertTrue(name.endsWith(".xlsx"))
    }

    @Test fun unusableFilenamesAreRefused() {
        for (bad in listOf("", "   ", "...", "///", null)) {
            assertThrows { BridgeValidators.filename(bad) }
        }
    }

    @Test fun mimeTypes() {
        assertEquals("text/csv", BridgeValidators.mime("text/csv; charset=utf-8"))
        assertEquals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", BridgeValidators.mime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        assertEquals("image/png", BridgeValidators.mime("IMAGE/PNG"))
        assertEquals(BridgeValidators.DEFAULT_MIME, BridgeValidators.mime("../../x"))
        assertEquals(BridgeValidators.DEFAULT_MIME, BridgeValidators.mime(null))
        assertEquals(BridgeValidators.DEFAULT_MIME, BridgeValidators.mime("text"))
    }

    @Test fun base64Payloads() {
        assertArrayEquals("hi".toByteArray(), BridgeValidators.base64Payload("aGk="))
        assertArrayEquals("hi".toByteArray(), BridgeValidators.base64Payload("data:text/plain;base64,aGk="))
        assertArrayEquals("hello".toByteArray(), BridgeValidators.base64Payload("aGVs\nbG8="))
        assertThrows { BridgeValidators.base64Payload("not base64 !!") }
        assertThrows { BridgeValidators.base64Payload("data:text/plain,hi") }
        assertThrows { BridgeValidators.base64Payload("") }
    }

    @Test fun colors() {
        assertEquals(0xFF0F1220.toInt(), BridgeValidators.color("#0f1220"))
        assertEquals(0xFFFFFFFF.toInt(), BridgeValidators.color("#fff"))
        assertEquals(0x800F1220.toInt(), BridgeValidators.color("#800f1220"))
        for (bad in listOf("0f1220", "#12", "#gggggg", "red", "", null)) assertThrows { BridgeValidators.color(bad) }
    }

    @Test fun externalUrls() {
        assertEquals("https://nvd.nist.gov/x", BridgeValidators.externalUrl("https://nvd.nist.gov/x"))
        assertEquals("mailto:a@b.c", BridgeValidators.externalUrl("mailto:a@b.c"))
        assertEquals("tel:+331", BridgeValidators.externalUrl("tel:+331"))
        assertEquals("otpauth://totp/x", BridgeValidators.externalUrl("otpauth://totp/x"))
        for (bad in listOf("javascript:alert(1)", "file:///etc/hosts", "intent://x#Intent;end", "content://a/b", "https://", "")) {
            assertThrows { BridgeValidators.externalUrl(bad) }
        }
    }

    @Test fun downloadUrlMustBeSameOrigin() {
        assertEquals("$server/api/reports/outputs/3/download", BridgeValidators.sameOriginUrl("/api/reports/outputs/3/download", server))
        assertEquals("$server/api/x", BridgeValidators.sameOriginUrl("https://OBLIANCE.example.com/api/x", server).let { it.replace("OBLIANCE", "obliance") })
        for (bad in listOf("//evil.net/x", "https://evil.net/x", "http://obliance.example.com/x", "https://obliance.example.com:8443/x", "javascript:1", "/a\\b", "")) {
            assertThrows { BridgeValidators.sameOriginUrl(bad, server) }
        }
    }

    @Test fun navigateToOnlyRelativeSameOrigin() {
        assertEquals("$server/devices/4", BridgeValidators.navigateTo("/devices/4", server))
        assertNull(BridgeValidators.navigateTo("https://evil.net/", server))
        assertNull(BridgeValidators.navigateTo("//evil.net/", server))
        assertNull(BridgeValidators.navigateTo("devices", server))
        assertNull(BridgeValidators.navigateTo(null, server))
    }

    private fun assertThrows(block: () -> Unit) {
        try {
            block()
        } catch (_: BridgeParamException) {
            return
        }
        throw AssertionError("expected BridgeParamException")
    }
}
