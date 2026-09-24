package tools.obli.shell.update

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings
import android.widget.Toast
import androidx.core.net.toUri
import androidx.core.content.FileProvider
import java.io.File
import tools.obli.shell.R
import tools.obli.shell.Shell

/** Hands a verified APK to the system installer (FileProvider + ACTION_VIEW). */
object ApkInstaller {
    /**
     * Installs the verified update if any. When "install unknown apps" is not
     * granted, opens that settings page and resumes on the next [resumeIfPermitted].
     */
    fun installVerified(activity: Activity) {
        val path = Shell.prefs.verifiedUpdateFile ?: return
        val file = File(path)
        if (!file.isFile) {
            Shell.prefs.verifiedUpdateFile = null
            return
        }
        if (!activity.packageManager.canRequestPackageInstalls()) {
            Shell.prefs.installAfterPermission = true
            Toast.makeText(activity, R.string.update_allow_install_sources, Toast.LENGTH_LONG).show()
            val pkg = "package:${activity.packageName}".toUri()
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, pkg))
            } catch (_: ActivityNotFoundException) {
                // Some OEM builds ignore the package URI: open the generic list.
                try {
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))
                } catch (_: ActivityNotFoundException) {
                    Toast.makeText(activity, R.string.update_install_failed, Toast.LENGTH_LONG).show()
                }
            }
            return
        }
        Shell.prefs.installAfterPermission = false
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, Updater.APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(activity, R.string.update_install_failed, Toast.LENGTH_LONG).show()
        }
    }

    /** Called on resume: continues an install that was waiting for the permission. */
    fun resumeIfPermitted(activity: Activity) {
        if (Shell.prefs.installAfterPermission && activity.packageManager.canRequestPackageInstalls()) {
            installVerified(activity)
        }
    }
}
