package tools.obli.shell.update

import tools.obli.shell.core.Jsons
import tools.obli.shell.core.bool
import tools.obli.shell.core.str
import tools.obli.shell.core.strictLong

/**
 * `GET <server>/api/mobile/android/version` (docs/obli-mobile.md §6):
 * {app, packageName, version, versionCode, minSupportedVersionCode, sha256,
 *  sizeBytes, signerSha256, builtAt, available, downloadUrl, releaseNotes}
 */
data class UpdateManifest(
    val app: String?,
    val packageName: String?,
    val versionName: String,
    val versionCode: Int,
    val minSupportedVersionCode: Int,
    val sha256: String?,
    val sizeBytes: Long?,
    val signerSha256: String?,
    val builtAt: String?,
    val available: Boolean,
    val downloadUrl: String?,
    val releaseNotes: String?,
)

/** Outcome of comparing a manifest with the installed build. */
sealed interface UpdateAvailability {
    data class Available(val manifest: UpdateManifest, val required: Boolean) : UpdateAvailability
    data class UpToDate(val manifest: UpdateManifest) : UpdateAvailability
    /** A newer build exists but cannot be offered (wrong package, no hash...). */
    data class NotApplicable(val manifest: UpdateManifest, val reason: String) : UpdateAvailability
}

object UpdateManifests {
    const val MAX_RELEASE_NOTES = 4_000

    /** Null when [body] is not a usable manifest. versionCode must be a JSON integer. */
    fun parse(body: String?): UpdateManifest? {
        val obj = Jsons.parseObject(body)?.let { Jsons.unwrapData(it) } ?: return null
        val versionCode = obj.strictLong("versionCode")?.takeIf { it in 0..Int.MAX_VALUE }?.toInt() ?: return null
        val versionName = obj.str("version")?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return UpdateManifest(
            app = obj.str("app"),
            packageName = obj.str("packageName")?.trim()?.takeIf { it.isNotEmpty() },
            versionName = versionName,
            versionCode = versionCode,
            minSupportedVersionCode = obj.strictLong("minSupportedVersionCode")
                ?.takeIf { it in 0..Int.MAX_VALUE }?.toInt() ?: 0,
            sha256 = Digests.normalize(obj.str("sha256")),
            sizeBytes = obj.strictLong("sizeBytes")?.takeIf { it >= 0 },
            signerSha256 = Digests.normalize(obj.str("signerSha256")),
            builtAt = obj.str("builtAt"),
            available = obj.bool("available") ?: false,
            downloadUrl = obj.str("downloadUrl")?.trim()?.takeIf { it.isNotEmpty() },
            releaseNotes = obj.str("releaseNotes")?.trim()?.takeIf { it.isNotEmpty() }?.take(MAX_RELEASE_NOTES),
        )
    }

    /** Integer comparison only: "1.10.0" vs "1.9.0" as strings would be wrong. */
    fun evaluate(manifest: UpdateManifest, installedVersionCode: Int, installedPackage: String): UpdateAvailability {
        if (manifest.versionCode <= installedVersionCode) return UpdateAvailability.UpToDate(manifest)
        return when {
            !manifest.available -> UpdateAvailability.NotApplicable(manifest, "not published")
            manifest.packageName != null && manifest.packageName != installedPackage ->
                UpdateAvailability.NotApplicable(manifest, "different package")
            manifest.sha256 == null -> UpdateAvailability.NotApplicable(manifest, "no sha256")
            manifest.downloadUrl == null -> UpdateAvailability.NotApplicable(manifest, "no download url")
            else -> UpdateAvailability.Available(manifest, required = installedVersionCode < manifest.minSupportedVersionCode)
        }
    }

    /** At most one automatic check per [intervalMs]; a clock that went backwards counts as due. */
    fun isCheckDue(lastCheckMs: Long, nowMs: Long, intervalMs: Long = 24L * 60 * 60 * 1000): Boolean =
        lastCheckMs <= 0 || nowMs < lastCheckMs || nowMs - lastCheckMs >= intervalMs
}

object VersionCodes {
    private val SEMVER = Regex("""^(\d+)\.(\d+)\.(\d+)$""")

    /** major*10000 + minor*100 + patch — the same rule as app/build.gradle.kts. */
    fun fromVersionName(name: String): Int {
        val m = SEMVER.matchEntire(name.trim()) ?: throw IllegalArgumentException("not MAJOR.MINOR.PATCH: $name")
        val (major, minor, patch) = m.destructured.toList().map { it.toInt() }
        require(minor <= 99 && patch <= 99) { "minor/patch must be 0..99: $name" }
        require(major in 1..20000) { "major must be 1..20000: $name" }
        return major * 10000 + minor * 100 + patch
    }

    fun toVersionName(code: Int): String = "${code / 10000}.${(code / 100) % 100}.${code % 100}"
}

object Digests {
    /** SHA-256 in lowercase hex without separators, or null when not a 32-byte digest. */
    fun normalize(raw: String?): String? {
        val hex = raw?.filterNot { it.isWhitespace() || it == ':' }?.lowercase() ?: return null
        return if (hex.length == 64 && hex.all { it in '0'..'9' || it in 'a'..'f' }) hex else null
    }

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}

/** Verdict of comparing an APK's signing certificates with the installed app's. */
enum class SignerVerdict { MATCH, MISMATCH_INSTALLED, MISMATCH_MANIFEST, UNREADABLE }

object SignerCheck {
    /**
     * The downloaded APK must be signed by the key the installed app is signed
     * with (Android would refuse the update otherwise, but only after the user
     * went through the installer): every current signer of the installed app
     * must be among the APK's signers or its v3 rotation history. When the
     * manifest names a signer, it must be one of the APK's current signers.
     */
    fun verify(
        installedSigners: Set<String>,
        apkSigners: Set<String>,
        apkHistory: Set<String>,
        manifestSigner: String?,
    ): SignerVerdict {
        val installed = installedSigners.mapNotNull { Digests.normalize(it) }.toSet()
        val current = apkSigners.mapNotNull { Digests.normalize(it) }.toSet()
        val history = apkHistory.mapNotNull { Digests.normalize(it) }.toSet() + current
        if (installed.isEmpty() || current.isEmpty()) return SignerVerdict.UNREADABLE
        if (!history.containsAll(installed)) return SignerVerdict.MISMATCH_INSTALLED
        val expected = Digests.normalize(manifestSigner)
        if (manifestSigner != null && (expected == null || expected !in current)) return SignerVerdict.MISMATCH_MANIFEST
        return SignerVerdict.MATCH
    }
}
