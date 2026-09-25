package tools.obli.obliance.more

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.CookieJar
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.auth.ServerSession
import tools.obli.core.model.ObliUser
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.model.SessionProbe
import tools.obli.core.network.ObliHttp
import tools.obli.shell.nav.Origins

/** Port of the WebView shell's UpdateManifestTest / VersionAndSignerTest, extended to several servers. */
class UpdateManifestTest {
    private val sha = "a".repeat(64)
    private val pkg = "tools.obli.obliance.next"

    /** Exactly what server/src/controllers/mobileApp.controller.ts androidVersion() returns. */
    private fun body(
        versionCode: String = "3",
        available: Boolean = true,
        packageName: String? = pkg,
        sha256: String? = sha,
        signer: String? = "B".repeat(64),
        minSupported: Int = 0,
        downloadUrl: String? = "/api/mobile/android/download",
    ) = """
        {"app":"obliance","packageName":${packageName?.let { "\"$it\"" } ?: "null"},"version":"0.3.1-alpha",
         "versionCode":$versionCode,"minSupportedVersionCode":$minSupported,"minSdk":26,
         "sha256":${sha256?.let { "\"$it\"" } ?: "null"},"sizeBytes":1234567,
         "signerSha256":${signer?.let { "\"$it\"" } ?: "null"},"builtAt":"2026-09-24T10:00:00Z","available":$available,
         "downloadUrl":${downloadUrl?.let { "\"$it\"" } ?: "null"},"releaseNotes":"- Faster\n- Better"}
    """.trimIndent()

    private val prod = ServerId("prod")

    @Test fun parsesTheServerShape() {
        val m = UpdateManifests.parse(body())!!
        assertEquals("obliance", m.app)
        assertEquals(pkg, m.packageName)
        assertEquals("0.3.1-alpha", m.versionName)
        assertEquals(3, m.versionCode)
        assertEquals(sha, m.sha256)
        assertEquals("b".repeat(64), m.signerSha256)
        assertEquals(1234567L, m.sizeBytes)
        assertTrue(m.available)
        assertEquals("/api/mobile/android/download", m.downloadUrl)
        assertEquals("- Faster\n- Better", m.releaseNotes)
    }

    @Test fun acceptsTheWrappedShapeToo() {
        assertEquals(3, UpdateManifests.parse("""{"success":true,"data":${body()}}""")!!.versionCode)
    }

    @Test fun versionCodeMustBeAJsonInteger() {
        assertNull(UpdateManifests.parse(body(versionCode = "\"3\"")))
        assertNull(UpdateManifests.parse(body(versionCode = "3.5")))
        assertNull(UpdateManifests.parse(body(versionCode = "1e5")))
        assertNull(UpdateManifests.parse(body(versionCode = "-1")))
        assertNull(UpdateManifests.parse("""{"version":"1.0.0"}"""))
        assertNull(UpdateManifests.parse("<html>"))
        assertNull(UpdateManifests.parse(null as String?))
    }

    @Test fun digestNormalisation() {
        val hex = "0123456789abcdef".repeat(4)
        assertEquals(hex, Digests.normalize(hex.uppercase()))
        assertEquals(hex, Digests.normalize(hex.chunked(2).joinToString(":")))
        assertNull(Digests.normalize("abc"))
        assertNull(Digests.normalize("z".repeat(64)))
        assertEquals("00ff10", Digests.hex(byteArrayOf(0, -1, 16)))
    }

    @Test fun comparesIntegersNotStrings() {
        val m = UpdateManifests.parse(body(versionCode = "11000"))!!
        assertTrue(UpdateSelection.judge(prod, m, 10900, pkg) is ServerManifest.Candidate)
    }

    @Test fun upToDateWhenNotNewer() {
        val m = UpdateManifests.parse(body(versionCode = "3"))!!
        assertTrue(UpdateSelection.judge(prod, m, 3, pkg) is ServerManifest.UpToDate)
        assertTrue(UpdateSelection.judge(prod, m, 4, pkg) is ServerManifest.UpToDate)
    }

    @Test fun theWebViewShellManifestIsNotApplicable() {
        // Today the servers publish the WebView shell (tools.obli.obliance, 1.0.0 = 10000).
        val shell = UpdateManifests.parse(body(versionCode = "10000", packageName = "tools.obli.obliance"))!!
        val judged = UpdateSelection.judge(prod, shell, 3, pkg)
        assertTrue(judged is ServerManifest.NotApplicable)
        assertEquals("different package", (judged as ServerManifest.NotApplicable).reason)
        // No packageName at all is not "this app" either.
        assertTrue(UpdateSelection.judge(prod, UpdateManifests.parse(body(packageName = null))!!, 2, pkg) is ServerManifest.NotApplicable)
    }

    @Test fun notApplicableCases() {
        fun judge(b: String) = UpdateSelection.judge(prod, UpdateManifests.parse(b)!!, 2, pkg)
        assertTrue(judge(body(available = false)) is ServerManifest.NotApplicable)
        assertTrue(judge(body(sha256 = null)) is ServerManifest.NotApplicable)
        assertTrue(judge(body(sha256 = "xyz")) is ServerManifest.NotApplicable)
        assertTrue(judge(body(signer = null)) is ServerManifest.NotApplicable)
        assertTrue(judge(body(downloadUrl = null)) is ServerManifest.NotApplicable)
        assertTrue(judge(body()) is ServerManifest.Candidate)
    }

    @Test fun checkBudgetIsOncePerDay() {
        val day = 24L * 60 * 60 * 1000
        assertTrue(UpdateManifests.isCheckDue(0, 1_000))
        assertFalse(UpdateManifests.isCheckDue(1_000, 1_000 + day - 1))
        assertTrue(UpdateManifests.isCheckDue(1_000, 1_000 + day))
        assertTrue("clock went backwards", UpdateManifests.isCheckDue(5_000, 1_000))
    }

    @Test fun downloadOnlyFromTheOfferingServer() {
        val origin = "https://obliance-prod.example.org"
        assertEquals("$origin/api/mobile/android/download", UpdateManifests.resolveDownloadUrl(origin, "/api/mobile/android/download"))
        assertEquals("$origin/files/a.apk", UpdateManifests.resolveDownloadUrl(origin, "$origin/files/a.apk"))
        // Cross-origin: another host, another server, http, protocol-relative, userinfo tricks.
        assertNull(UpdateManifests.resolveDownloadUrl(origin, "https://cdn.example.org/a.apk"))
        assertNull(UpdateManifests.resolveDownloadUrl(origin, "https://obliance-dev.example.org/api/mobile/android/download"))
        assertNull(UpdateManifests.resolveDownloadUrl(origin, "http://obliance-prod.example.org/a.apk"))
        assertNull(UpdateManifests.resolveDownloadUrl(origin, "//cdn.example.org/a.apk"))
        assertNull(UpdateManifests.resolveDownloadUrl(origin, "https://obliance-prod.example.org@cdn.example.org/a.apk"))
        assertNull(UpdateManifests.resolveDownloadUrl(origin, "https://evil@obliance-prod.example.org/a.apk"))
        assertNull(UpdateManifests.resolveDownloadUrl(origin, "/a b.apk"))
        assertNull(UpdateManifests.resolveDownloadUrl(origin, "javascript:alert(1)"))
        assertNull(UpdateManifests.resolveDownloadUrl(origin, null))
    }
}

class SignerCheckTest {
    private val a = "a".repeat(64)
    private val b = "b".repeat(64)
    private val c = "c".repeat(64)

    @Test fun signerMatches() {
        assertEquals(SignerVerdict.MATCH, SignerCheck.verify(setOf(a), setOf(a), emptySet(), a))
        assertEquals(SignerVerdict.MATCH, SignerCheck.verify(setOf(a), setOf(a), emptySet(), a.uppercase().chunked(2).joinToString(":")))
    }

    @Test fun rotatedKeyIsAcceptedThroughHistory() {
        // Installed with old key A; the APK is signed with B and its v3 lineage contains A.
        assertEquals(SignerVerdict.MATCH, SignerCheck.verify(setOf(a), setOf(b), setOf(a, b), b))
        // The manifest must name the CURRENT signer, not the old one.
        assertEquals(SignerVerdict.MISMATCH_MANIFEST, SignerCheck.verify(setOf(a), setOf(b), setOf(a, b), a))
    }

    @Test fun foreignSignerIsRejected() {
        assertEquals(SignerVerdict.MISMATCH_INSTALLED, SignerCheck.verify(setOf(a), setOf(c), emptySet(), c))
        // A lineage that does not contain the installed key is no help.
        assertEquals(SignerVerdict.MISMATCH_INSTALLED, SignerCheck.verify(setOf(a), setOf(c), setOf(b, c), c))
    }

    @Test fun manifestSignerMustBeTheApkSigner() {
        assertEquals(SignerVerdict.MISMATCH_MANIFEST, SignerCheck.verify(setOf(a), setOf(a), emptySet(), b))
        assertEquals(SignerVerdict.MISMATCH_MANIFEST, SignerCheck.verify(setOf(a), setOf(a), emptySet(), "garbage"))
    }

    @Test fun missingManifestSignerIsRefused() {
        assertEquals(SignerVerdict.MISSING_MANIFEST_SIGNER, SignerCheck.verify(setOf(a), setOf(a), emptySet(), null))
        assertEquals(SignerVerdict.MISSING_MANIFEST_SIGNER, SignerCheck.verify(setOf(a), setOf(a), emptySet(), " "))
    }

    @Test fun unreadableSignatures() {
        assertEquals(SignerVerdict.UNREADABLE, SignerCheck.verify(emptySet(), setOf(a), emptySet(), a))
        assertEquals(SignerVerdict.UNREADABLE, SignerCheck.verify(setOf(a), emptySet(), emptySet(), a))
    }
}

/** Selection across servers, through real ObliHttp clients against fake servers. */
class UpdateSelectionTest {
    private val pkg = "tools.obli.obliance.next"
    private val servers = mutableListOf<MockWebServer>()
    private val prod = ServerId("prod")
    private val dev = ServerId("dev")
    private val qual = ServerId("qual")
    private val names = mapOf(prod to "Obliance Prod", dev to "Obliance Dev", qual to "Obliance Qual")

    @After fun tearDown() = servers.forEach { it.close() }

    private fun manifest(code: Int, packageName: String = pkg, available: Boolean = true) =
        """{"app":"obliance","packageName":"$packageName","version":"0.3.$code","versionCode":$code,"minSupportedVersionCode":0,
           "sha256":"${"a".repeat(64)}","signerSha256":"${"b".repeat(64)}","available":$available,
           "downloadUrl":"/api/mobile/android/download","releaseNotes":null}"""

    /** A fake Obliance server answering the version route with [code] / [body]. */
    private fun server(id: ServerId, code: Int = 200, body: String? = null, delayMs: Long = 0): UpdateSource {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val b = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json")
                if (body != null) b.body(body)
                if (delayMs > 0) b.headersDelay(delayMs, TimeUnit.MILLISECONDS)
                return if (request.url.encodedPath == AppUpdates.VERSION_PATH) b.build() else MockResponse.Builder().code(404).build()
            }
        }
        s.start()
        servers += s
        val http = ObliHttp(Origins.of(s.url("/").toString())!!, ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA"))
        return UpdateSource(id) { http.get(AppUpdates.VERSION_PATH) }
    }

    private fun evaluate(sources: List<UpdateSource>, installed: Int = 3, active: ServerId = prod) = runBlocking {
        AppUpdates.evaluate(sources, installed, pkg, active, listOf(prod, dev, qual)) { names.getValue(it) }
    }

    @Test fun `the highest versionCode among the servers wins, with its server`() {
        val result = evaluate(listOf(server(prod, body = manifest(4)), server(dev, body = manifest(6)), server(qual, body = manifest(5))))
        val offer = (result as UpdateCheck.Available).offer
        assertEquals(6, offer.versionCode)
        assertEquals(dev, offer.serverId)
        assertEquals("Obliance Dev", offer.serverName)
        assertEquals("0.3.6", offer.versionName)
        assertFalse(offer.required)
    }

    @Test fun `only signed-in servers are asked`() {
        fun session(id: ServerId, body: String): ServerSession {
            val src = MockWebServer()
            src.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build())
            src.start()
            servers += src
            val origin = Origins.of(src.url("/").toString())!!
            val profile = ServerProfile(id, origin, names.getValue(id), monogram = "OB", order = 0)
            val http = ObliHttp(origin, ObliHttp.defaultClient(CookieJar.NO_COOKIES, "UA"))
            return ServerSession(id, { profile }, http, { error("no socket in this test") })
        }
        val p = session(prod, manifest(4)).also { it.markSignedIn(SessionProbe(ObliUser(1, "karim.benali"))) }
        val d = session(dev, manifest(9)).also { it.markSignedOut() }
        val q = session(qual, manifest(5)).also { it.markExpired() }
        val sources = AppUpdates.sources(listOf(p, d, q), pkg)
        assertEquals(listOf(prod), sources.map { it.serverId })
        val offer = (evaluate(sources) as UpdateCheck.Available).offer
        assertEquals(prod, offer.serverId)
        assertEquals(4, offer.versionCode)
        // The app names itself (ignored by today's servers, ready for one manifest per package).
        assertEquals("package=$pkg", servers.first().takeRequest().url.query)
    }

    @Test fun `the package query is only added for a well-formed package name`() {
        assertEquals("/api/mobile/android/version?package=tools.obli.obliance.next", AppUpdates.versionPath("tools.obli.obliance.next"))
        assertEquals("/api/mobile/android/version", AppUpdates.versionPath("x&y=1"))
    }

    @Test fun `a tie goes to the active server, then to the registry order`() {
        val tie = listOf(server(prod, body = manifest(5)), server(dev, body = manifest(5)), server(qual, body = manifest(5)))
        assertEquals(qual, ((evaluate(tie, active = qual)) as UpdateCheck.Available).offer.serverId)
        // Active server not offering: registry order (Prod before Dev).
        val noActive = listOf(server(dev, body = manifest(5)), server(prod, body = manifest(5)))
        assertEquals(prod, ((evaluate(noActive, active = qual)) as UpdateCheck.Available).offer.serverId)
    }

    @Test fun `only manifests of the installed package count`() {
        // The WebView shell's manifest has a far higher versionCode: never offered to this app.
        val result = evaluate(listOf(server(prod, body = manifest(10000, "tools.obli.obliance")), server(dev, body = manifest(4))))
        val offer = (result as UpdateCheck.Available).offer
        assertEquals(dev, offer.serverId)
        assertEquals(4, offer.versionCode)
    }

    @Test fun `nothing published when every server publishes another package or nothing usable`() {
        val result = evaluate(
            listOf(
                server(prod, body = manifest(10000, "tools.obli.obliance")),
                server(dev, code = 503, body = """{"error":"Android app version unavailable"}"""),
                server(qual, body = manifest(9, available = false)),
            ),
        )
        assertEquals(UpdateCheck.NothingPublished, result)
    }

    @Test fun `up to date, failed, and one unreachable server never blocks the others`() {
        assertEquals(UpdateCheck.UpToDate, evaluate(listOf(server(prod, body = manifest(3)), server(dev, code = 500))))
        assertTrue(evaluate(listOf(server(prod, code = 500), server(dev, body = "<html>"))) is UpdateCheck.Failed)
        val offer = evaluate(listOf(server(prod, code = 502), server(dev, body = manifest(7))))
        assertEquals(dev, (offer as UpdateCheck.Available).offer.serverId)
    }

    @Test fun `required below the minimum supported version`() {
        val body = manifest(7).replace("\"minSupportedVersionCode\":0", "\"minSupportedVersionCode\":5")
        assertTrue((evaluate(listOf(server(prod, body = body)), installed = 3) as UpdateCheck.Available).offer.required)
        assertFalse((evaluate(listOf(server(prod, body = body)), installed = 5) as UpdateCheck.Available).offer.required)
    }
}
