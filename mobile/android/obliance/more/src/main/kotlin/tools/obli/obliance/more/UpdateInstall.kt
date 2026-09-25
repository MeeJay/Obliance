package tools.obli.obliance.more

import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * DOWNLOAD_COMPLETE comes from the system download provider (another uid), so
 * the receiver has to be exported. It is harmless: it only acts on the download
 * id this app enqueued, re-reads the status from DownloadManager itself, and the
 * file is then checked (SHA-256 + signing certificate) before anything happens.
 */
class UpdateDownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
        if (id < 0) return
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try {
                // onDownloadComplete ignores any id that is not our pending download.
                AppUpdates.onDownloadComplete(app, id)
            } finally {
                pending.finish()
            }
        }
    }
}

/**
 * content:// URIs of the verified APK for the system installer (authority
 * `${applicationId}.obliupdates`). A subclass, so its manifest entry never
 * clashes with another module's FileProvider.
 */
class UpdateFileProvider : FileProvider()

/** Hands a verified APK to the system installer (FileProvider + ACTION_VIEW). */
internal object UpdateInstaller {
    /** Set when the user was sent to "install unknown apps": the install resumes on return. */
    @Volatile private var installAfterPermission = false

    enum class Result { STARTED, NEEDS_PERMISSION, NOTHING_TO_INSTALL, FAILED }

    fun authority(context: Context): String = "${context.packageName}.obliupdates"

    /**
     * Installs the verified update, if any. When "install unknown apps" is not
     * granted, opens that settings page and resumes on [resumeIfPermitted].
     */
    suspend fun installVerified(activity: Activity): Result {
        val store = AppSettings.store(activity)
        val verified = store.verifiedUpdate() ?: return Result.NOTHING_TO_INSTALL
        val file = File(verified.path)
        if (!file.isFile) {
            store.setVerifiedUpdate(null)
            return Result.NOTHING_TO_INSTALL
        }
        if (!activity.packageManager.canRequestPackageInstalls()) {
            installAfterPermission = true
            val pkg = "package:${activity.packageName}".toUri()
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, pkg))
            } catch (_: ActivityNotFoundException) {
                // Some OEM builds ignore the package URI: open the generic list.
                try {
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))
                } catch (_: ActivityNotFoundException) {
                    installAfterPermission = false
                    return Result.FAILED
                }
            }
            return Result.NEEDS_PERMISSION
        }
        installAfterPermission = false
        val uri = try {
            FileProvider.getUriForFile(activity, authority(activity), file)
        } catch (_: IllegalArgumentException) {
            return Result.FAILED
        }
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, AppUpdates.APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            activity.startActivity(intent)
            Result.STARTED
        } catch (_: ActivityNotFoundException) {
            Result.FAILED
        }
    }

    /** Called on resume: continues an install that was waiting for the permission. */
    suspend fun resumeIfPermitted(activity: Activity): Result? {
        if (!installAfterPermission) return null
        if (!activity.packageManager.canRequestPackageInstalls()) return null
        return installVerified(activity)
    }
}
