package tools.obli.shell.core

import android.webkit.CookieManager
import android.webkit.WebStorage
import tools.obli.shell.Shell
import tools.obli.shell.alerts.AlertScheduler

/** Forgets everything tied to the current server (used when the server changes). */
object SessionReset {
    /**
     * Clears cookies and web storage (localStorage, IndexedDB...), the
     * server-scoped preferences, then calls [onDone] on the main thread.
     */
    fun clearWebData(context: android.content.Context, onDone: () -> Unit) {
        val cookies = CookieManager.getInstance()
        cookies.removeAllCookies {
            cookies.flush()
            WebStorage.getInstance().deleteAllData()
            Shell.prefs.clearServerScoped()
            AlertScheduler.sync(context.applicationContext)
            onDone()
        }
    }
}
