package tools.obli.shell.update

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import tools.obli.shell.BuildConfig

class VersionAndSignerTest {
    @Test fun versionCodeDerivation() {
        assertEquals(10000, VersionCodes.fromVersionName("1.0.0"))
        assertEquals(10203, VersionCodes.fromVersionName("1.2.3"))
        assertEquals(11000, VersionCodes.fromVersionName("1.10.0"))
        assertEquals(10900, VersionCodes.fromVersionName("1.9.0"))
        assertEquals(29999, VersionCodes.fromVersionName("2.99.99"))
        assertEquals("1.2.3", VersionCodes.toVersionName(10203))
    }

    @Test(expected = IllegalArgumentException::class)
    fun minorAbove99IsRefused() {
        VersionCodes.fromVersionName("1.100.0")
    }

    @Test(expected = IllegalArgumentException::class)
    fun nonSemverIsRefused() {
        VersionCodes.fromVersionName("1.0")
    }

    /** The Gradle build and the Kotlin helper must agree, from the VERSION file on. */
    @Test fun buildConfigMatchesTheVersionFile() {
        assertEquals(VersionCodes.fromVersionName(BuildConfig.VERSION_NAME), BuildConfig.VERSION_CODE)
        val versionFile = listOf(File("VERSION"), File("../VERSION")).firstOrNull { it.isFile }
        if (versionFile != null) assertEquals(versionFile.readText().trim(), BuildConfig.VERSION_NAME)
    }

    @Test fun digestNormalisation() {
        val hex = "0123456789abcdef".repeat(4)
        assertEquals(hex, Digests.normalize(hex.uppercase()))
        assertEquals(hex, Digests.normalize(hex.chunked(2).joinToString(":")))
        assertNull(Digests.normalize("abc"))
        assertNull(Digests.normalize("z".repeat(64)))
        assertEquals("00ff10", Digests.hex(byteArrayOf(0, -1, 16)))
    }

    private val a = "a".repeat(64)
    private val b = "b".repeat(64)
    private val c = "c".repeat(64)

    @Test fun signerMatches() {
        assertEquals(SignerVerdict.MATCH, SignerCheck.verify(setOf(a), setOf(a), emptySet(), null))
        assertEquals(SignerVerdict.MATCH, SignerCheck.verify(setOf(a), setOf(a), emptySet(), a.uppercase()))
    }

    @Test fun rotatedKeyIsAcceptedThroughHistory() {
        // Installed with old key A; the APK is signed with B and its v3 lineage contains A.
        assertEquals(SignerVerdict.MATCH, SignerCheck.verify(setOf(a), setOf(b), setOf(a, b), b))
    }

    @Test fun foreignSignerIsRejected() {
        assertEquals(SignerVerdict.MISMATCH_INSTALLED, SignerCheck.verify(setOf(a), setOf(c), emptySet(), c))
    }

    @Test fun manifestSignerMustBeTheApkSigner() {
        assertEquals(SignerVerdict.MISMATCH_MANIFEST, SignerCheck.verify(setOf(a), setOf(a), emptySet(), b))
        assertEquals(SignerVerdict.MISMATCH_MANIFEST, SignerCheck.verify(setOf(a), setOf(a), emptySet(), "garbage"))
    }

    @Test fun unreadableSignatures() {
        assertEquals(SignerVerdict.UNREADABLE, SignerCheck.verify(emptySet(), setOf(a), emptySet(), null))
        assertEquals(SignerVerdict.UNREADABLE, SignerCheck.verify(setOf(a), emptySet(), emptySet(), null))
    }
}
