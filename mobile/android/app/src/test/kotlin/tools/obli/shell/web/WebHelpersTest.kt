package tools.obli.shell.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WebHelpersTest {
    @Test fun extensionOnlyAcceptMeansAnyFile() {
        assertEquals(ChooserTypes("*/*", emptyList()), FileChooserTypes.resolve(arrayOf(".msi,.exe,.deb,.rpm,.pkg,.dmg")))
        assertEquals(ChooserTypes("*/*", emptyList()), FileChooserTypes.resolve(arrayOf(".json")))
        assertEquals(ChooserTypes("*/*", emptyList()), FileChooserTypes.resolve(arrayOf("application/json", ".json")))
    }

    @Test fun emptyAcceptMeansAnyFile() {
        assertEquals(ChooserTypes("*/*", emptyList()), FileChooserTypes.resolve(null))
        assertEquals(ChooserTypes("*/*", emptyList()), FileChooserTypes.resolve(arrayOf("")))
    }

    @Test fun mimeAccepts() {
        assertEquals(ChooserTypes("image/*", emptyList()), FileChooserTypes.resolve(arrayOf("image/*")))
        assertEquals(ChooserTypes("*/*", listOf("image/png", "image/jpeg")), FileChooserTypes.resolve(arrayOf("image/png, image/jpeg")))
        assertEquals(ChooserTypes("*/*", emptyList()), FileChooserTypes.resolve(arrayOf("*/*", "image/png")))
    }

    @Test fun contentDispositionFilenames() {
        assertEquals("report.csv", ContentDisposition.filename("attachment; filename=\"report.csv\""))
        assertEquals("report.csv", ContentDisposition.filename("attachment; filename=report.csv"))
        assertEquals("Obliance-1.2.0.apk", ContentDisposition.filename("attachment; filename=\"Obliance-1.2.0.apk\""))
        assertEquals("résumé.pdf", ContentDisposition.filename("attachment; filename=\"resume.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"))
        assertEquals("a b+c.txt", ContentDisposition.filename("attachment; filename*=utf-8''a%20b+c.txt"))
        assertEquals("passwd", ContentDisposition.filename("attachment; filename=\"../../etc/passwd\""))
        assertEquals("q\"uote.txt", ContentDisposition.filename("attachment; filename=\"q\\\"uote.txt\""))
        assertNull(ContentDisposition.filename("inline"))
        assertNull(ContentDisposition.filename(null))
    }

    @Test fun webViewVersions() {
        assertEquals(124, WebViewVersion.major("124.0.6367.54"))
        assertNull(WebViewVersion.major("unknown"))
        assertTrue(WebViewVersion.isTooOld("99.0.4844.88"))
        assertFalse(WebViewVersion.isTooOld("100.0.0.0"))
        assertFalse(WebViewVersion.isTooOld("140.0.7339.51"))
        assertTrue(WebViewVersion.isTooOld(null))
    }

    @Test fun systemBarIconsStayReadable() {
        val obliDark = 0xFF0F1220.toInt()
        val white = 0xFFFFFFFF.toInt()
        val mid = 0xFF808080.toInt()
        // Dark background: light icons whatever the page asked.
        assertTrue(SystemBarContrast.lightIcons(obliDark, requestedLightIcons = false))
        assertTrue(SystemBarContrast.lightIcons(obliDark, requestedLightIcons = true))
        // Light background: dark icons whatever the page asked.
        assertFalse(SystemBarContrast.lightIcons(white, requestedLightIcons = true))
        // Mid tones follow the request.
        assertTrue(SystemBarContrast.lightIcons(mid, requestedLightIcons = true))
        assertFalse(SystemBarContrast.lightIcons(mid, requestedLightIcons = false))
    }
}
