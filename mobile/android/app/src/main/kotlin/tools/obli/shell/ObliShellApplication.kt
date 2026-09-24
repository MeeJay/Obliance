package tools.obli.shell

import android.app.Application
import android.content.Context
import android.webkit.WebSettings
import tools.obli.shell.alerts.AlertScheduler
import tools.obli.shell.core.ObliApps
import tools.obli.shell.core.ShellPrefs
import tools.obli.shell.core.UserAgent
import tools.obli.shell.lock.AppLock
import tools.obli.shell.notify.Notifications

class ObliShellApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Shell.init(this)
        Notifications.ensureChannels(this)
        AppLock.install(this, Shell.prefs)
        AlertScheduler.sync(this)
    }
}

/** Process-wide singletons and build identity. */
object Shell {
    lateinit var prefs: ShellPrefs
        private set
    private lateinit var appContext: Context

    val appId: String get() = BuildConfig.OBLI_APP
    val versionName: String get() = BuildConfig.VERSION_NAME
    val versionCode: Int get() = BuildConfig.VERSION_CODE
    val knownAppIds: List<String> by lazy { ObliApps.parseIds(BuildConfig.OBLI_APP_IDS) }

    fun init(context: Context) {
        appContext = context.applicationContext
        prefs = ShellPrefs(appContext)
    }

    /**
     * The WebView user agent (default + " ObliShell/<ver> (<id>; Android)"),
     * also sent by native HTTP calls so the server sees one client.
     */
    val userAgent: String by lazy {
        val default = try {
            WebSettings.getDefaultUserAgent(appContext)
        } catch (_: Exception) {
            "Mozilla/5.0 (Linux; Android)"
        }
        UserAgent.build(default, versionName, appId)
    }
}
