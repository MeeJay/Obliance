package tools.obli.obliance.more

import android.app.DownloadManager
import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.net.toUri
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerSession
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.data.ObliServices

/**
 * An app update offered by one of the signed-in servers (design doc §2.10
 * "Mise à jour de l'application"): the highest versionCode wins, and the APK
 * is downloaded from THAT server only.
 */
data class UpdateOffer(
    val serverId: ServerId,
    val serverName: String,
    val versionName: String,
    val versionCode: Int,
    val releaseNotes: String?,
    /** The installed build is below the server's minSupportedVersionCode. */
    val required: Boolean,
    val sha256: String,
    val signerSha256: String,
    /** As the manifest gives it; resolved same-origin against the offering server at download time. */
    val downloadUrl: String,
)

/** Result of [AppUpdates.check]. */
sealed interface UpdateCheck {
    data class Available(val offer: UpdateOffer) : UpdateCheck

    /** A server publishes this app, not newer than the installed build. */
    data object UpToDate : UpdateCheck

    /** No signed-in server publishes a build of THIS app ("Aucune mise à jour … publiée"). */
    data object NothingPublished : UpdateCheck

    /** No server answered with a manifest. */
    data class Failed(val reason: String) : UpdateCheck

    /** No signed-in server to ask. */
    data object NoServer : UpdateCheck

    /** Automatic check skipped: the last one is less than 24 h old. */
    data object Skipped : UpdateCheck
}

/** Download and verification of the offered APK, as S86 shows it. */
internal sealed interface DownloadState {
    data object Idle : DownloadState
    data class Downloading(val versionName: String) : DownloadState
    data class Verifying(val versionName: String) : DownloadState
    data class Ready(val versionName: String) : DownloadState
    data class Failed(val problem: DownloadProblem) : DownloadState
}

internal enum class DownloadProblem { REFUSED_URL, NOT_STARTED, DOWNLOAD_FAILED, INTEGRITY, NOT_NEWER }

/** One server to ask: its id and the GET of the version route on its own session. */
internal class UpdateSource(val serverId: ServerId, val fetch: suspend () -> ApiOutcome<JsonElement?>)

/**
 * App updates from the signed-in servers (port of the WebView shell's
 * Updater, extended to several servers): check → DownloadManager (offering
 * server only) → SHA-256 + signer verification → system installer.
 */
object AppUpdates {
    private const val TAG = "ObliUpdate"
    internal const val APK_MIME = "application/vnd.android.package-archive"
    internal const val UPDATES_DIR = "updates"
    private const val FILE_PREFIX = "obliance-update-"
    private const val FETCH_TIMEOUT_MS = 20_000L

    private val _offer = MutableStateFlow<UpdateOffer?>(null)

    /** The current offer, or null (S80 "Mise à jour disponible", S86, the Plus badge). */
    val offer: StateFlow<UpdateOffer?> = _offer.asStateFlow()

    private val _lastCheck = MutableStateFlow<UpdateCheck?>(null)
    internal val lastCheck: StateFlow<UpdateCheck?> = _lastCheck.asStateFlow()

    private val _checking = MutableStateFlow(false)
    internal val checking: StateFlow<Boolean> = _checking.asStateFlow()

    private val _download = MutableStateFlow<DownloadState>(DownloadState.Idle)
    internal val download: StateFlow<DownloadState> = _download.asStateFlow()

    @Volatile internal var lastCheckAtMs: Long = 0
        private set

    private val mutex = Mutex()

    /** Asks every signed-in server now (or skips when [force] is false and a check ran in the last 24 h). */
    suspend fun check(context: Context, services: ObliServices, force: Boolean = false): UpdateCheck = mutex.withLock {
        val app = context.applicationContext
        val store = AppSettings.store(app)
        val now = System.currentTimeMillis()
        if (!force && !UpdateManifests.isCheckDue(store.lastUpdateCheckAt(), now)) return UpdateCheck.Skipped
        val registry = services.registry.state.value
        val sources = sources(services.sessions.all(), app.packageName)
        if (sources.isEmpty()) return UpdateCheck.NoServer
        _checking.value = true
        val result = try {
            evaluate(sources, installedVersionCode(app), app.packageName, registry.activeId, registry.profiles.map { it.id }) { id ->
                registry.byId(id)?.displayName.orEmpty()
            }
        } finally {
            _checking.value = false
        }
        store.setLastUpdateCheckAt(now)
        lastCheckAtMs = now
        publish(result)
        result
    }

    /** The automatic check: at most once per 24 h, once a server is signed in (waits up to 30 s for one). */
    suspend fun checkIfDue(context: Context, services: ObliServices) {
        val store = AppSettings.store(context.applicationContext)
        resumePending(context)
        if (!UpdateManifests.isCheckDue(store.lastUpdateCheckAt(), System.currentTimeMillis())) return
        val sessions = services.sessions.all()
        if (sessions.isEmpty()) return
        withTimeoutOrNull(30_000) {
            combine(sessions.map { it.auth }) { states -> states.any { it is AuthState.SignedIn } }.first { it }
        } ?: return
        runCatching { check(context, services, force = false) }
    }

    /**
     * The servers to ask: every SIGNED-IN session, each on its own origin.
     * `?package=` names this app: today's servers ignore it and publish one
     * manifest (the WebView shell's), a later server can publish one per package.
     */
    internal fun sources(sessions: List<ServerSession>, packageName: String): List<UpdateSource> {
        val path = versionPath(packageName)
        return sessions.filter { it.auth.value is AuthState.SignedIn }.map { s -> UpdateSource(s.id) { s.http.get(path) } }
    }

    internal fun versionPath(packageName: String): String =
        if (PACKAGE_NAME.matches(packageName)) "$VERSION_PATH?package=$packageName" else VERSION_PATH

    private val PACKAGE_NAME = Regex("""^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$""")

    /**
     * Pure heart of [check]: asks every source in parallel (20 s each; one
     * unreachable server never blocks the others), judges each manifest and
     * picks the offer.
     */
    internal suspend fun evaluate(
        sources: List<UpdateSource>,
        installedVersionCode: Int,
        installedPackage: String,
        activeId: ServerId?,
        order: List<ServerId>,
        nameOf: (ServerId) -> String,
    ): UpdateCheck {
        val results = coroutineScope {
            sources.map { src ->
                async {
                    val out = withTimeoutOrNull(FETCH_TIMEOUT_MS) { src.fetch() }
                    when (out) {
                        null -> ServerManifest.Failed(src.serverId, "timeout")
                        is ApiOutcome.Ok -> UpdateManifests.parse(out.value)
                            ?.let { UpdateSelection.judge(src.serverId, it, installedVersionCode, installedPackage) }
                            ?: ServerManifest.Failed(src.serverId, "invalid manifest")
                        else -> ServerManifest.Failed(src.serverId, out::class.simpleName ?: "failure")
                    }
                }
            }.awaitAll()
        }
        return decide(results, installedVersionCode, activeId, order, nameOf)
    }

    internal fun decide(
        results: List<ServerManifest>,
        installedVersionCode: Int,
        activeId: ServerId?,
        order: List<ServerId>,
        nameOf: (ServerId) -> String,
    ): UpdateCheck {
        UpdateSelection.pick(results, activeId, order)?.let { c ->
            val m = c.manifest
            return UpdateCheck.Available(
                UpdateOffer(
                    serverId = c.serverId,
                    serverName = nameOf(c.serverId),
                    versionName = m.versionName,
                    versionCode = m.versionCode,
                    releaseNotes = m.releaseNotes,
                    required = installedVersionCode < m.minSupportedVersionCode,
                    sha256 = m.sha256!!,
                    signerSha256 = m.signerSha256!!,
                    downloadUrl = m.downloadUrl!!,
                ),
            )
        }
        return when {
            results.any { it is ServerManifest.UpToDate } -> UpdateCheck.UpToDate
            results.isNotEmpty() && results.all { it is ServerManifest.Failed } ->
                UpdateCheck.Failed((results.first() as ServerManifest.Failed).reason)
            else -> UpdateCheck.NothingPublished
        }
    }

    private fun publish(result: UpdateCheck) {
        _lastCheck.value = result
        when (result) {
            is UpdateCheck.Available -> _offer.value = result.offer
            UpdateCheck.UpToDate, UpdateCheck.NothingPublished -> _offer.value = null
            else -> Unit // a failed check keeps what was known
        }
    }

    // --- Download ------------------------------------------------------------------

    /**
     * Enqueues the APK of [offer] with DownloadManager, from the OFFERING server
     * only (same origin), into getExternalFilesDir("updates"). False when refused
     * or not started ([download] then says why).
     */
    internal suspend fun startDownload(context: Context, services: ObliServices, offer: UpdateOffer): Boolean {
        val app = context.applicationContext
        val origin = services.registry.state.value.byId(offer.serverId)?.origin
        val url = origin?.let { UpdateManifests.resolveDownloadUrl(it, offer.downloadUrl) }
        if (url == null) {
            _download.value = DownloadState.Failed(DownloadProblem.REFUSED_URL)
            return false
        }
        val dir = updatesDir(app) ?: return fail(DownloadProblem.NOT_STARTED)
        dir.listFiles()?.filter { it.name.startsWith(FILE_PREFIX) }?.forEach { it.delete() }
        val store = AppSettings.store(app)
        store.setVerifiedUpdate(null)
        val dm = app.getSystemService(DownloadManager::class.java) ?: return fail(DownloadProblem.NOT_STARTED)
        store.pendingDownload()?.let { runCatching { dm.remove(it.downloadId) } }
        val fileName = "$FILE_PREFIX${offer.versionCode}.apk"
        val request = DownloadManager.Request(url.toUri())
            .setTitle(app.getString(R.string.more_update_download_title, offer.versionName))
            .setMimeType(APK_MIME)
            .addRequestHeader("User-Agent", userAgent(app))
            // No "completed" notification: a tap on it would open the APK without our checks.
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedOverRoaming(false)
            .setDestinationInExternalFilesDir(app, UPDATES_DIR, fileName)
        val id = try {
            dm.enqueue(request)
        } catch (e: RuntimeException) {
            Log.w(TAG, "enqueue failed", e)
            return fail(DownloadProblem.NOT_STARTED)
        }
        store.setPendingDownload(
            PendingDownload(id, offer.versionCode, offer.versionName, offer.sha256, offer.signerSha256, fileName, offer.serverName),
        )
        _download.value = DownloadState.Downloading(offer.versionName)
        return true
    }

    private fun fail(problem: DownloadProblem): Boolean {
        _download.value = DownloadState.Failed(problem)
        return false
    }

    /**
     * DownloadManager reported [downloadId] complete (receiver, or the catch-up):
     * status, SHA-256, package, version and signer are all checked before the
     * install is offered. Other ids are ignored.
     */
    internal suspend fun onDownloadComplete(context: Context, downloadId: Long): Unit = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        val store = AppSettings.store(app)
        val pending = store.pendingDownload() ?: return@withContext
        if (pending.downloadId != downloadId) return@withContext
        val dm = app.getSystemService(DownloadManager::class.java) ?: return@withContext
        val status = runCatching {
            dm.query(DownloadManager.Query().setFilterById(downloadId))?.use { c ->
                if (c.moveToFirst()) c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) else null
            }
        }.getOrNull()
        when (status) {
            DownloadManager.STATUS_SUCCESSFUL -> Unit
            DownloadManager.STATUS_FAILED, null -> {
                store.setPendingDownload(null)
                _download.value = DownloadState.Failed(DownloadProblem.DOWNLOAD_FAILED)
                return@withContext
            }
            else -> {
                _download.value = DownloadState.Downloading(pending.versionName)
                return@withContext
            }
        }
        store.setPendingDownload(null)
        _download.value = DownloadState.Verifying(pending.versionName)
        val dir = updatesDir(app) ?: run {
            _download.value = DownloadState.Failed(DownloadProblem.DOWNLOAD_FAILED)
            return@withContext
        }
        val file = File(dir, pending.fileName)
        val problem = verify(app, file, pending)
        if (problem != null) {
            file.delete()
            _download.value = DownloadState.Failed(problem)
            return@withContext
        }
        store.setVerifiedUpdate(VerifiedUpdate(file.absolutePath, pending.versionName, pending.versionCode))
        _download.value = DownloadState.Ready(pending.versionName)
    }

    /** Catch-up at start and when S86 opens: a DOWNLOAD_COMPLETE that never arrived, or a verified APK waiting. */
    internal suspend fun resumePending(context: Context) {
        val app = context.applicationContext
        val store = AppSettings.store(app)
        store.pendingDownload()?.let { onDownloadComplete(app, it.downloadId) }
        if (_download.value is DownloadState.Idle) {
            val verified = store.verifiedUpdate() ?: return
            if (File(verified.path).isFile && verified.versionCode > installedVersionCode(app)) {
                _download.value = DownloadState.Ready(verified.versionName)
            } else {
                runCatching { File(verified.path).delete() }
                store.setVerifiedUpdate(null)
            }
        }
    }

    internal fun resetDownloadState() {
        if (_download.value is DownloadState.Failed) _download.value = DownloadState.Idle
    }

    private fun verify(context: Context, file: File, pending: PendingDownload): DownloadProblem? {
        if (!file.isFile || file.length() == 0L) return DownloadProblem.DOWNLOAD_FAILED
        val sha = try { sha256(file) } catch (_: Exception) { return DownloadProblem.DOWNLOAD_FAILED }
        if (sha != Digests.normalize(pending.sha256)) {
            Log.w(TAG, "SHA-256 mismatch")
            return DownloadProblem.INTEGRITY
        }
        val pm = context.packageManager
        val archive = archiveInfo(pm, file) ?: return DownloadProblem.INTEGRITY
        if (archive.packageName != context.packageName) return DownloadProblem.INTEGRITY
        if (versionCodeOf(archive) <= installedVersionCode(context)) return DownloadProblem.NOT_NEWER
        val installed = try { installedInfo(pm, context.packageName) } catch (_: PackageManager.NameNotFoundException) { return DownloadProblem.INTEGRITY }
        val (apkCurrent, apkHistory) = signers(archive)
        val (installedCurrent, _) = signers(installed)
        val verdict = SignerCheck.verify(installedCurrent, apkCurrent, apkHistory, pending.signerSha256)
        if (verdict != SignerVerdict.MATCH) {
            Log.w(TAG, "signer check: $verdict")
            return DownloadProblem.INTEGRITY
        }
        return null
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return Digests.hex(md.digest())
    }

    internal fun updatesDir(context: Context): File? = context.getExternalFilesDir(UPDATES_DIR)?.also { it.mkdirs() }

    /** The installed build's versionCode (the app module's `versionCode`). */
    internal fun installedVersionCode(context: Context): Int = runCatching {
        versionCodeOf(installedInfo(context.packageManager, context.packageName, signatures = false)).toInt()
    }.getOrDefault(0)

    private fun userAgent(context: Context): String =
        "Mozilla/5.0 (Linux; Android ${Build.VERSION.RELEASE}) ObliApp/${appVersion(context)} (obliance; Android)"

    @Suppress("DEPRECATION")
    private fun archiveInfo(pm: PackageManager, file: File): PackageInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
        } else {
            pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
        }

    @Suppress("DEPRECATION")
    private fun installedInfo(pm: PackageManager, pkg: String, signatures: Boolean = true): PackageInfo {
        val flags = when {
            !signatures -> 0
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P -> PackageManager.GET_SIGNING_CERTIFICATES
            else -> PackageManager.GET_SIGNATURES
        }
        return if (Build.VERSION.SDK_INT >= 33) {
            pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("PackageManagerGetSignatures") // compared as a whole set, see SignerCheck
            pm.getPackageInfo(pkg, flags)
        }
    }

    @Suppress("DEPRECATION")
    private fun versionCodeOf(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    /** (current signers, rotation history) as SHA-256 hex digests. */
    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Pair<Set<String>, Set<String>> {
        fun digest(bytes: ByteArray) = Digests.hex(MessageDigest.getInstance("SHA-256").digest(bytes))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val si = info.signingInfo ?: return emptySet<String>() to emptySet()
            return if (si.hasMultipleSigners()) {
                si.apkContentsSigners.map { digest(it.toByteArray()) }.toSet() to emptySet()
            } else {
                val history = si.signingCertificateHistory.orEmpty().map { digest(it.toByteArray()) }
                // The current signer is the last entry of the history.
                setOfNotNull(history.lastOrNull()) to history.toSet()
            }
        }
        return info.signatures.orEmpty().map { digest(it.toByteArray()) }.toSet() to emptySet()
    }

    internal const val VERSION_PATH = "/api/mobile/android/version"
}
