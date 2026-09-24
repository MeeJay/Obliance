package tools.obli.shell.update

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import tools.obli.shell.Shell

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
        if (id < 0 || Shell.prefs.pendingUpdate?.downloadId != id) return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try {
                Updater.onDownloadComplete(context.applicationContext, id)
            } finally {
                pending.finish()
            }
        }
    }
}
