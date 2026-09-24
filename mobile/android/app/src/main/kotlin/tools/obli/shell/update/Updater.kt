package tools.obli.shell.update

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.util.Log
import androidx.core.net.toUri
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import tools.obli.shell.BuildConfig
import tools.obli.shell.MainActivity
import tools.obli.shell.R
import tools.obli.shell.Shell
import tools.obli.shell.core.ShellPrefs
import tools.obli.shell.net.Http
import tools.obli.shell.notify.Notifications

/**
 * In-app updates against the configured server (contract §6):
 * check -> DownloadManager -> SHA-256 + signing certificate verification ->
 * system installer through a FileProvider.
 */
object Updater {
    private const val TAG = "ObliUpdate"
    const val APK_MIME = "application/vnd.android.package-archive"
    private const val FILE_PREFIX = "obli-update-"

    sealed interface Check {
        data class Available(val manifest: UpdateManifest, val required: Boolean) : Check
        data class UpToDate(val manifest: UpdateManifest) : Check
        data class NotApplicable(val manifest: UpdateManifest, val reason: String) : Check
        data class Failed(val reason: String) : Check
        data object NotConfigured : Check
        /** Automatic check skipped: the last one is less than 24 h old. */
        data object Skipped : Check
    }

    suspend fun check(context: Context, force: Boolean): Check {
        val prefs = Shell.prefs
        val server = prefs.serverUrl ?: return Check.NotConfigured
        val now = System.currentTimeMillis()
        if (!force && !UpdateManifests.isCheckDue(prefs.lastUpdateCheckAt, now)) return Check.Skipped
        val r = Http.get("$server/api/mobile/android/version", withCookies = false)
        prefs.lastUpdateCheckAt = now
        val body = when (r) {
            is Http.Result.Error -> return Check.Failed(r.failure.name)
            is Http.Result.Response -> if (r.code == 200) r.body else return Check.Failed("HTTP ${r.code}")
        }
        val manifest = UpdateManifests.parse(body) ?: return Check.Failed("invalid manifest")
        return when (val a = UpdateManifests.evaluate(manifest, Shell.versionCode, context.packageName)) {
            is UpdateAvailability.Available -> Check.Available(a.manifest, a.required)
            is UpdateAvailability.UpToDate -> Check.UpToDate(a.manifest)
            is UpdateAvailability.NotApplicable -> Check.NotApplicable(a.manifest, a.reason)
        }
    }

    /** Enqueues the APK download. Returns false when it could not start. */
    fun startDownload(context: Context, manifest: UpdateManifest): Boolean {
        val server = Shell.prefs.serverUrl ?: return false
        val sha = manifest.sha256 ?: return false
        val url = resolveDownloadUrl(server, manifest.downloadUrl) ?: return false
        val dir = updatesDir(context) ?: return false
        dir.listFiles()?.filter { it.name.startsWith(FILE_PREFIX) }?.forEach { it.delete() }

        val fileName = "$FILE_PREFIX${manifest.versionCode}.apk"
        val dm = context.getSystemService(DownloadManager::class.java) ?: return false
        Shell.prefs.pendingUpdate?.let { dm.remove(it.downloadId) }
        val request = DownloadManager.Request(url.toUri())
            .setTitle(context.getString(R.string.update_download_title, context.getString(R.string.app_name), manifest.versionName))
            .setMimeType(APK_MIME)
            .addRequestHeader("User-Agent", Shell.userAgent)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedOverRoaming(false)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName)
        val id = try {
            dm.enqueue(request)
        } catch (e: RuntimeException) {
            Log.w(TAG, "enqueue failed", e)
            return false
        }
        Shell.prefs.pendingUpdate = ShellPrefs.PendingUpdate(
            downloadId = id,
            versionCode = manifest.versionCode,
            versionName = manifest.versionName,
            sha256 = sha,
            signerSha256 = manifest.signerSha256,
            fileName = fileName,
        )
        return true
    }

    /** Absolute https URL of the APK; relative paths resolve against the server. */
    fun resolveDownloadUrl(server: String, downloadUrl: String?): String? {
        val raw = downloadUrl?.trim().orEmpty()
        val url = when {
            raw.startsWith("/") && !raw.startsWith("//") -> server + raw
            raw.startsWith("https://") -> raw
            else -> return null
        }
        return url.takeIf { u -> u.none { it.isWhitespace() } }
    }

    private fun updatesDir(context: Context): File? =
        context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.also { it.mkdirs() }

    enum class Outcome { READY, NOT_OURS, NOT_FINISHED, FAILED, CHECKSUM_MISMATCH, SIGNER_MISMATCH, NOT_NEWER }

    /**
     * Called when DownloadManager reports [downloadId] complete (receiver, or
     * the catch-up at app start). Verifies everything before offering install.
     */
    suspend fun onDownloadComplete(context: Context, downloadId: Long): Outcome = withContext(Dispatchers.IO) {
        val pending = Shell.prefs.pendingUpdate ?: return@withContext Outcome.NOT_OURS
        if (pending.downloadId != downloadId) return@withContext Outcome.NOT_OURS
        val dm = context.getSystemService(DownloadManager::class.java) ?: return@withContext Outcome.FAILED
        val status = dm.query(DownloadManager.Query().setFilterById(downloadId))?.use { c ->
            if (c.moveToFirst()) c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) else null
        }
        when (status) {
            DownloadManager.STATUS_SUCCESSFUL -> Unit
            DownloadManager.STATUS_FAILED, null -> {
                Shell.prefs.pendingUpdate = null
                notifyFailure(context, R.string.update_failed_download)
                return@withContext Outcome.FAILED
            }
            else -> return@withContext Outcome.NOT_FINISHED
        }
        Shell.prefs.pendingUpdate = null
        val file = File(updatesDir(context) ?: return@withContext Outcome.FAILED, pending.fileName)
        val outcome = verify(context, file, pending)
        if (outcome != Outcome.READY) {
            file.delete()
            notifyFailure(context, if (outcome == Outcome.CHECKSUM_MISMATCH || outcome == Outcome.SIGNER_MISMATCH) R.string.update_failed_integrity else R.string.update_failed_download)
            return@withContext outcome
        }
        Shell.prefs.verifiedUpdateFile = file.absolutePath
        withContext(Dispatchers.Main) { offerInstall(context, pending.versionName) }
        Outcome.READY
    }

    /** Catch-up for a DOWNLOAD_COMPLETE broadcast that never arrived. */
    suspend fun resumePending(context: Context) {
        val pending = Shell.prefs.pendingUpdate ?: return
        onDownloadComplete(context, pending.downloadId)
    }

    private fun verify(context: Context, file: File, pending: ShellPrefs.PendingUpdate): Outcome {
        if (!file.isFile || file.length() == 0L) return Outcome.FAILED
        val sha = try { sha256(file) } catch (_: Exception) { return Outcome.FAILED }
        if (sha != Digests.normalize(pending.sha256)) {
            Log.w(TAG, "SHA-256 mismatch")
            return Outcome.CHECKSUM_MISMATCH
        }
        val pm = context.packageManager
        val archive = archiveInfo(pm, file) ?: return Outcome.FAILED
        if (archive.packageName != context.packageName) return Outcome.SIGNER_MISMATCH
        if (archiveVersionCode(archive) <= Shell.versionCode) return Outcome.NOT_NEWER
        val installed = try {
            installedInfo(pm, context.packageName)
        } catch (_: PackageManager.NameNotFoundException) {
            return Outcome.FAILED
        }
        val (apkCurrent, apkHistory) = signers(archive)
        val (installedCurrent, _) = signers(installed)
        val verdict = SignerCheck.verify(installedCurrent, apkCurrent, apkHistory, pending.signerSha256)
        if (verdict != SignerVerdict.MATCH) {
            Log.w(TAG, "signer check: $verdict")
            return Outcome.SIGNER_MISMATCH
        }
        return Outcome.READY
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

    @Suppress("DEPRECATION")
    private fun archiveInfo(pm: PackageManager, file: File): PackageInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
        } else {
            pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
        }

    @Suppress("DEPRECATION")
    private fun installedInfo(pm: PackageManager, pkg: String): PackageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
        } else {
            @Suppress("PackageManagerGetSignatures") // compared as a whole set, see SignerCheck
            pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES)
        }

    @Suppress("DEPRECATION")
    private fun archiveVersionCode(info: PackageInfo): Long =
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

    /** Brings the app forward to install, or leaves a notification when in background. */
    private fun offerInstall(context: Context, versionName: String) {
        val n = Notifications.builder(context, Notifications.CH_UPDATES)
            .setContentTitle(context.getString(R.string.update_ready_title))
            .setContentText(context.getString(R.string.update_ready_text, versionName))
            .setContentIntent(
                android.app.PendingIntent.getActivity(
                    context, Notifications.ID_UPDATE, installIntent(context),
                    android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            .build()
        Notifications.post(context, Notifications.ID_UPDATE, n)
        if (tools.obli.shell.lock.AppLock.inForeground) {
            try {
                context.startActivity(installIntent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: RuntimeException) {
                if (BuildConfig.DEBUG) Log.d(TAG, "could not bring the installer forward", e)
            }
        }
    }

    fun installIntent(context: Context): Intent =
        Intent(context, MainActivity::class.java)
            .setAction(MainActivity.ACTION_INSTALL_UPDATE)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    private suspend fun notifyFailure(context: Context, text: Int) = withContext(Dispatchers.Main) {
        val n = Notifications.builder(context, Notifications.CH_UPDATES)
            .setContentTitle(context.getString(R.string.update_failed_title))
            .setContentText(context.getString(text))
            .build()
        Notifications.post(context, Notifications.ID_UPDATE, n)
    }
}
