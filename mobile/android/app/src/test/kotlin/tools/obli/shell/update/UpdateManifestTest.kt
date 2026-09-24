package tools.obli.shell.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateManifestTest {
    private val sha = "a".repeat(64)
    private val pkg = "tools.obli.obliance"

    /** Exactly what server/src/controllers/mobileApp.controller.ts androidVersion() returns. */
    private fun body(
        versionCode: String = "10100",
        available: Boolean = true,
        packageName: String? = pkg,
        sha256: String? = sha,
        minSupported: Int = 0,
    ) = """
        {"app":"obliance","packageName":${packageName?.let { "\"$it\"" } ?: "null"},"version":"1.1.0",
         "versionCode":$versionCode,"minSupportedVersionCode":$minSupported,"minSdk":26,
         "sha256":${sha256?.let { "\"$it\"" } ?: "null"},"sizeBytes":1234567,
         "signerSha256":"${"B".repeat(64)}","builtAt":"2026-09-24T10:00:00Z","available":$available,
         "downloadUrl":"/api/mobile/android/download","releaseNotes":"- Faster\n- Better"}
    """.trimIndent()

    @Test fun parsesTheServerShape() {
        val m = UpdateManifests.parse(body())!!
        assertEquals("obliance", m.app)
        assertEquals(pkg, m.packageName)
        assertEquals("1.1.0", m.versionName)
        assertEquals(10100, m.versionCode)
        assertEquals(sha, m.sha256)
        assertEquals("b".repeat(64), m.signerSha256)
        assertEquals(1234567L, m.sizeBytes)
        assertTrue(m.available)
        assertEquals("/api/mobile/android/download", m.downloadUrl)
        assertEquals("- Faster\n- Better", m.releaseNotes)
    }

    @Test fun acceptsTheWrappedShapeToo() {
        val m = UpdateManifests.parse("""{"success":true,"data":${body()}}""")!!
        assertEquals(10100, m.versionCode)
    }

    @Test fun versionCodeMustBeAJsonInteger() {
        assertNull(UpdateManifests.parse(body(versionCode = "\"10100\"")))
        assertNull(UpdateManifests.parse(body(versionCode = "10100.5")))
        assertNull(UpdateManifests.parse(body(versionCode = "1e5")))
        assertNull(UpdateManifests.parse(body(versionCode = "-1")))
        assertNull(UpdateManifests.parse("""{"version":"1.0.0"}"""))
        assertNull(UpdateManifests.parse("<html>"))
    }

    @Test fun comparesIntegersNotStrings() {
        // "1.10.0" < "1.9.0" as strings; 11000 > 10900 as integers.
        val m = UpdateManifests.parse(body(versionCode = "11000"))!!
        assertTrue(UpdateManifests.evaluate(m, 10900, pkg) is UpdateAvailability.Available)
    }

    @Test fun upToDateWhenNotNewer() {
        val m = UpdateManifests.parse(body(versionCode = "10000"))!!
        assertTrue(UpdateManifests.evaluate(m, 10000, pkg) is UpdateAvailability.UpToDate)
        assertTrue(UpdateManifests.evaluate(m, 10001, pkg) is UpdateAvailability.UpToDate)
    }

    @Test fun notApplicableCases() {
        assertTrue(UpdateManifests.evaluate(UpdateManifests.parse(body(available = false))!!, 10000, pkg) is UpdateAvailability.NotApplicable)
        assertTrue(UpdateManifests.evaluate(UpdateManifests.parse(body(sha256 = null))!!, 10000, pkg) is UpdateAvailability.NotApplicable)
        assertTrue(UpdateManifests.evaluate(UpdateManifests.parse(body(sha256 = "xyz"))!!, 10000, pkg) is UpdateAvailability.NotApplicable)
        // A debug build (package suffix .debug) is never offered the release APK.
        assertTrue(UpdateManifests.evaluate(UpdateManifests.parse(body())!!, 10000, "$pkg.debug") is UpdateAvailability.NotApplicable)
    }

    @Test fun missingPackageNameIsAccepted() {
        val m = UpdateManifests.parse(body(packageName = null))!!
        assertTrue(UpdateManifests.evaluate(m, 10000, pkg) is UpdateAvailability.Available)
    }

    @Test fun requiredWhenBelowMinimumSupported() {
        val m = UpdateManifests.parse(body(minSupported = 10050))!!
        val a = UpdateManifests.evaluate(m, 10000, pkg) as UpdateAvailability.Available
        assertTrue(a.required)
        val b = UpdateManifests.evaluate(m, 10050, pkg) as UpdateAvailability.Available
        assertFalse(b.required)
    }

    @Test fun checkBudgetIsOncePerDay() {
        val day = 24L * 60 * 60 * 1000
        assertTrue(UpdateManifests.isCheckDue(0, 1_000))
        assertFalse(UpdateManifests.isCheckDue(1_000, 1_000 + day - 1))
        assertTrue(UpdateManifests.isCheckDue(1_000, 1_000 + day))
        assertTrue("clock went backwards", UpdateManifests.isCheckDue(5_000, 1_000))
    }

    @Test fun downloadUrlResolution() {
        val server = "https://obliance.example.com"
        assertEquals("$server/api/mobile/android/download", Updater.resolveDownloadUrl(server, "/api/mobile/android/download"))
        assertEquals("https://cdn.example.com/a.apk", Updater.resolveDownloadUrl(server, "https://cdn.example.com/a.apk"))
        assertNull(Updater.resolveDownloadUrl(server, "http://cdn.example.com/a.apk"))
        assertNull(Updater.resolveDownloadUrl(server, "//cdn.example.com/a.apk"))
        assertNull(Updater.resolveDownloadUrl(server, null))
    }
}
