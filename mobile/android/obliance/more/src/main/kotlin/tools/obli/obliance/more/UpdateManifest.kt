package tools.obli.obliance.more

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import tools.obli.core.model.ServerId
import tools.obli.shell.core.Jsons
import tools.obli.shell.core.bool
import tools.obli.shell.core.str
import tools.obli.shell.core.strictLong
import tools.obli.shell.nav.Origins

/**
 * `GET <server>/api/mobile/android/version` (server/src/controllers/mobileApp.controller.ts):
 * {app, packageName, version, versionCode, minSupportedVersionCode, minSdk, sha256,
 *  sizeBytes, signerSha256, builtAt, available, downloadUrl, releaseNotes}.
 * Port of the WebView shell's UpdateManifest.
 */
internal data class UpdateManifest(
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

internal object UpdateManifests {
    const val MAX_RELEASE_NOTES = 4_000

    /** Null when [body] is not a usable manifest. versionCode must be a JSON integer. */
    fun parse(body: String?): UpdateManifest? = parse(Jsons.parseObject(body))

    fun parse(element: JsonElement?): UpdateManifest? {
        val root = element as? JsonObject ?: return null
        val obj = Jsons.unwrapData(root)
        val versionCode = obj.strictLong("versionCode")?.takeIf { it in 0..Int.MAX_VALUE }?.toInt() ?: return null
        val versionName = obj.str("version")?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return UpdateManifest(
            app = obj.str("app"),
            packageName = obj.str("packageName")?.trim()?.takeIf { it.isNotEmpty() },
            versionName = versionName,
            versionCode = versionCode,
            minSupportedVersionCode = obj.strictLong("minSupportedVersionCode")?.takeIf { it in 0..Int.MAX_VALUE }?.toInt() ?: 0,
            sha256 = Digests.normalize(obj.str("sha256")),
            sizeBytes = obj.strictLong("sizeBytes")?.takeIf { it >= 0 },
            signerSha256 = Digests.normalize(obj.str("signerSha256")),
            builtAt = obj.str("builtAt"),
            available = obj.bool("available") ?: false,
            downloadUrl = obj.str("downloadUrl")?.trim()?.takeIf { it.isNotEmpty() },
            releaseNotes = obj.str("releaseNotes")?.trim()?.takeIf { it.isNotEmpty() }?.take(MAX_RELEASE_NOTES),
        )
    }

    /** At most one automatic check per [intervalMs]; a clock that went backwards counts as due. */
    fun isCheckDue(lastCheckMs: Long, nowMs: Long, intervalMs: Long = 24L * 60 * 60 * 1000): Boolean =
        lastCheckMs <= 0 || nowMs < lastCheckMs || nowMs - lastCheckMs >= intervalMs

    /**
     * The download URL on the OFFERING server only: a relative path resolves
     * against [origin]; an absolute URL must be that same origin. Anything else
     * (another host, http, protocol-relative, control characters) is refused.
     */
    fun resolveDownloadUrl(origin: String, downloadUrl: String?): String? {
        val raw = downloadUrl?.trim().orEmpty()
        if (raw.isEmpty() || raw.any { it.isWhitespace() || it.isISOControl() || it == '\\' }) return null
        return when {
            raw.startsWith("/") -> Origins.resolveRelativePath(origin, raw)
            Origins.of(raw) == origin && raw.startsWith("$origin/") -> raw
            else -> null
        }
    }
}

/** What one server answered, judged against the installed build. */
internal sealed interface ServerManifest {
    val serverId: ServerId

    /** Newer, published, for this package, with its hashes: can be offered. */
    data class Candidate(override val serverId: ServerId, val manifest: UpdateManifest) : ServerManifest

    /** This app, not newer than the installed build. */
    data class UpToDate(override val serverId: ServerId, val manifest: UpdateManifest) : ServerManifest

    /** A manifest that cannot be offered (another package, not published, no hash, no signer). */
    data class NotApplicable(override val serverId: ServerId, val manifest: UpdateManifest, val reason: String) : ServerManifest

    /** No usable answer (network, 503 placeholder, not a manifest). */
    data class Failed(override val serverId: ServerId, val reason: String) : ServerManifest
}

internal object UpdateSelection {
    /**
     * Judges one manifest. A candidate needs `available`, EXACTLY this package
     * (the WebView shell `tools.obli.obliance` publishes on the same route), a
     * higher versionCode (integers, never version strings), a SHA-256 and the
     * signer fingerprint.
     */
    fun judge(serverId: ServerId, manifest: UpdateManifest, installedVersionCode: Int, installedPackage: String): ServerManifest = when {
        manifest.packageName != installedPackage -> ServerManifest.NotApplicable(serverId, manifest, "different package")
        manifest.versionCode <= installedVersionCode -> ServerManifest.UpToDate(serverId, manifest)
        !manifest.available -> ServerManifest.NotApplicable(serverId, manifest, "not published")
        manifest.sha256 == null -> ServerManifest.NotApplicable(serverId, manifest, "no sha256")
        manifest.signerSha256 == null -> ServerManifest.NotApplicable(serverId, manifest, "no signer")
        manifest.downloadUrl == null -> ServerManifest.NotApplicable(serverId, manifest, "no download url")
        else -> ServerManifest.Candidate(serverId, manifest)
    }

    /**
     * The offer: the highest versionCode among the candidates; on a tie the
     * active server, then the registry order ([order] = server ids in user order).
     */
    fun pick(results: List<ServerManifest>, activeId: ServerId?, order: List<ServerId>): ServerManifest.Candidate? =
        results.filterIsInstance<ServerManifest.Candidate>().minWithOrNull(
            compareByDescending<ServerManifest.Candidate> { it.manifest.versionCode }
                .thenBy { if (it.serverId == activeId) 0 else 1 }
                .thenBy { order.indexOf(it.serverId).let { i -> if (i < 0) Int.MAX_VALUE else i } },
        )
}

internal object Digests {
    /** SHA-256 in lowercase hex without separators, or null when not a 32-byte digest. */
    fun normalize(raw: String?): String? {
        val hex = raw?.filterNot { it.isWhitespace() || it == ':' }?.lowercase() ?: return null
        return if (hex.length == 64 && hex.all { it in '0'..'9' || it in 'a'..'f' }) hex else null
    }

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}

/** Verdict of comparing an APK's signing certificates with the installed app and the manifest. */
internal enum class SignerVerdict { MATCH, MISMATCH_INSTALLED, MISMATCH_MANIFEST, MISSING_MANIFEST_SIGNER, UNREADABLE }

internal object SignerCheck {
    /**
     * APK signer == installed app signer == manifest `signerSha256` (design doc
     * §2.10, §10.10: a server can never push an APK signed by another key).
     * Every current signer of the installed app must be among the APK's signers
     * or its v3 rotation history, and the manifest must name one of the APK's
     * CURRENT signers; a manifest without a signer is refused.
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
        if (manifestSigner.isNullOrBlank()) return SignerVerdict.MISSING_MANIFEST_SIGNER
        val expected = Digests.normalize(manifestSigner)
        if (expected == null || expected !in current) return SignerVerdict.MISMATCH_MANIFEST
        return SignerVerdict.MATCH
    }
}
