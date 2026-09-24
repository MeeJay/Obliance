package tools.obli.shell.settings

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import android.webkit.WebView
import android.graphics.Color
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import kotlinx.coroutines.launch
import tools.obli.shell.BuildConfig
import tools.obli.shell.MainActivity
import tools.obli.shell.R
import tools.obli.shell.Shell
import tools.obli.shell.alerts.AlertScheduler
import tools.obli.shell.core.SessionReset
import tools.obli.shell.lock.AppLock
import tools.obli.shell.notify.Notifications
import tools.obli.shell.ui.LockScreen
import tools.obli.shell.ui.ObliTheme
import tools.obli.shell.ui.UpdateDialog
import tools.obli.shell.update.UpdateManifest
import tools.obli.shell.update.Updater

/**
 * Native settings (Compose). Reachable from the bridge (openSettings), the
 * error screen, the setup screen and the launcher shortcut.
 */
class SettingsActivity : AppCompatActivity() {
    private val prefs get() = Shell.prefs
    private val state = SettingsState()

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) enableAlerts() else state.message = getString(R.string.settings_alerts_denied)
        refresh()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Always dark UI: light status/navigation icons whatever the system theme.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        refresh()
        setContent {
            ObliTheme {
                SettingsScreen(state = state, actions = actions)
                state.updateOffer?.let { (manifest, required) ->
                    UpdateDialog(
                        manifest = manifest,
                        required = required,
                        onDownload = {
                            state.updateOffer = null
                            state.message = getString(
                                if (Updater.startDownload(this, manifest)) R.string.update_downloading else R.string.update_failed_start,
                            )
                        },
                        onLater = { state.updateOffer = null },
                    )
                }
                if (AppLock.locked) LockScreen(onUnlock = { promptUnlock() })
            }
        }
    }

    override fun onResume() {
        super.onResume()
        applySecureFlag()
        refresh()
        AppLock.autoPromptIfLocked(this) { state.message = getString(R.string.lock_disabled_no_credential); refresh() }
    }

    private fun promptUnlock() {
        AppLock.promptIfLocked(this) { state.message = getString(R.string.lock_disabled_no_credential); refresh() }
    }

    private fun applySecureFlag() {
        if (prefs.blockScreenshots) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    private fun refresh() {
        val pkg = try { WebViewCompat.getCurrentWebViewPackage(this) } catch (_: RuntimeException) { null }
        state.serverUrl = prefs.serverUrl
        state.obligateOrigin = prefs.obligateOrigin
        state.alertsEnabled = prefs.alertsEnabled
        state.notificationsAllowed = Notifications.canPost(this)
        state.lockEnabled = prefs.lockEnabled
        state.lockAvailable = AppLock.canAuthenticate(this)
        state.blockScreenshots = prefs.blockScreenshots
        state.appVersion = "${BuildConfig.PRODUCT_NAME} ${Shell.versionName} (${Shell.versionCode})"
        state.webViewVersion = listOfNotNull(pkg?.packageName, pkg?.versionName).joinToString(" ").ifEmpty { null }
    }

    private fun enableAlerts() {
        prefs.alertsEnabled = true
        // First run after enabling only records the high-water mark.
        prefs.alertsHighWater = null
        prefs.alertsPausedForAuth = false
        AlertScheduler.sync(applicationContext)
        state.message = getString(R.string.settings_alerts_enabled)
    }

    private val actions = object : SettingsActions {
        override fun back() = finish()

        override fun changeServer() {
            if (prefs.serverUrl == null) {
                openMain()
                return
            }
            state.confirmChangeServer = true
        }

        override fun confirmChangeServer() {
            state.confirmChangeServer = false
            SessionReset.clearWebData(this@SettingsActivity) {
                prefs.serverUrl = null
                AlertScheduler.sync(applicationContext)
                openMain()
            }
        }

        override fun dismissChangeServer() {
            state.confirmChangeServer = false
        }

        override fun setAlerts(enabled: Boolean) {
            if (!enabled) {
                prefs.alertsEnabled = false
                AlertScheduler.sync(applicationContext)
                refresh()
                return
            }
            if (prefs.serverUrl == null) {
                state.message = getString(R.string.settings_no_server)
                return
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !Notifications.permissionGranted(this@SettingsActivity)) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
            enableAlerts()
            if (!Notifications.canPost(this@SettingsActivity)) state.message = getString(R.string.settings_alerts_denied)
            refresh()
        }

        override fun openNotificationSettings() {
            val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            try {
                startActivity(intent)
            } catch (_: RuntimeException) {
                state.message = getString(R.string.error_generic)
            }
        }

        override fun setLock(enabled: Boolean) {
            if (!enabled) {
                prefs.lockEnabled = false
                AppLock.onLockEnabledChanged(false)
                refresh()
                return
            }
            if (!AppLock.canAuthenticate(this@SettingsActivity)) {
                state.message = getString(R.string.settings_lock_unavailable)
                return
            }
            AppLock.authenticate(this@SettingsActivity, getString(R.string.settings_lock_confirm)) { ok ->
                if (ok) prefs.lockEnabled = true
                refresh()
            }
        }

        override fun setBlockScreenshots(enabled: Boolean) {
            prefs.blockScreenshots = enabled
            applySecureFlag()
            refresh()
        }

        override fun checkForUpdates() {
            if (state.checkingUpdate) return
            state.checkingUpdate = true
            lifecycleScope.launch {
                val r = Updater.check(this@SettingsActivity, force = true)
                state.checkingUpdate = false
                when (r) {
                    is Updater.Check.Available -> state.updateOffer = r.manifest to r.required
                    is Updater.Check.UpToDate -> state.message = getString(R.string.update_up_to_date, Shell.versionName)
                    is Updater.Check.NotApplicable -> state.message = getString(R.string.update_not_applicable, r.manifest.versionName)
                    is Updater.Check.Failed -> state.message = getString(R.string.update_check_failed)
                    Updater.Check.NotConfigured -> state.message = getString(R.string.settings_no_server)
                    Updater.Check.Skipped -> Unit
                }
            }
        }

        override fun clearCache() {
            val wv = WebView(this@SettingsActivity)
            wv.clearCache(true)
            wv.destroy()
            state.message = getString(R.string.settings_cache_cleared)
        }

        override fun messageShown() {
            state.message = null
        }
    }

    private fun openMain() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }
}

/** Observable state of the settings screen. */
class SettingsState {
    var serverUrl by mutableStateOf<String?>(null)
    var obligateOrigin by mutableStateOf<String?>(null)
    var alertsEnabled by mutableStateOf(false)
    var notificationsAllowed by mutableStateOf(true)
    var lockEnabled by mutableStateOf(false)
    var lockAvailable by mutableStateOf(true)
    var blockScreenshots by mutableStateOf(false)
    var checkingUpdate by mutableStateOf(false)
    var appVersion by mutableStateOf("")
    var webViewVersion by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)
    var confirmChangeServer by mutableStateOf(false)
    var updateOffer by mutableStateOf<Pair<UpdateManifest, Boolean>?>(null)
}

interface SettingsActions {
    fun back()
    fun changeServer()
    fun confirmChangeServer()
    fun dismissChangeServer()
    fun setAlerts(enabled: Boolean)
    fun openNotificationSettings()
    fun setLock(enabled: Boolean)
    fun setBlockScreenshots(enabled: Boolean)
    fun checkForUpdates()
    fun clearCache()
    fun messageShown()
}
