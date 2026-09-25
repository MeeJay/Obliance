package tools.obli.shell

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import tools.obli.shell.alerts.AlertScheduler
import tools.obli.shell.bridge.BridgeHost
import tools.obli.shell.bridge.NativeBridge
import tools.obli.shell.core.IncomingLinks
import tools.obli.shell.core.SessionReset
import tools.obli.shell.lock.AppLock
import tools.obli.shell.nav.NavDecision
import tools.obli.shell.nav.NavigationPolicy
import tools.obli.shell.nav.Origins
import tools.obli.shell.nav.SsoConfig
import tools.obli.shell.net.Http
import tools.obli.shell.net.ServerApi
import tools.obli.shell.net.ServerUrl
import tools.obli.shell.notify.Notifications
import tools.obli.shell.settings.SettingsActivity
import tools.obli.shell.ui.ConfirmDialog
import tools.obli.shell.ui.ErrorScreen
import tools.obli.shell.ui.JsDialog
import tools.obli.shell.ui.LoadError
import tools.obli.shell.ui.LockScreen
import tools.obli.shell.ui.ObliTheme
import tools.obli.shell.ui.SetupScreen
import tools.obli.shell.ui.SetupState
import tools.obli.shell.ui.UpdateDialog
import tools.obli.shell.ui.WebViewWarning
import tools.obli.shell.ui.WebViewWarningScreen
import tools.obli.shell.update.ApkInstaller
import tools.obli.shell.update.UpdateManifest
import tools.obli.shell.update.Updater
import tools.obli.shell.web.Downloads
import tools.obli.shell.web.ExternalLinks
import tools.obli.shell.web.FileChooserResults
import tools.obli.shell.web.FileChooserTypes
import tools.obli.shell.web.JsDialogRequest
import tools.obli.shell.web.SystemBarContrast
import tools.obli.shell.web.WebCallbacks
import tools.obli.shell.web.WebHost
import tools.obli.shell.web.WebViewVersion

/**
 * The shell: one activity, one WebView (never reloaded by rotation or the
 * keyboard, see configChanges in the manifest), native Compose overlays for
 * setup / errors / lock / dialogs drawn above it.
 */
class MainActivity : AppCompatActivity(), WebCallbacks, BridgeHost {

    private val prefs get() = Shell.prefs
    override val activity: AppCompatActivity get() = this

    private lateinit var root: FrameLayout
    private lateinit var webContainer: FrameLayout
    private var web: WebHost? = null
    private val bridge = NativeBridge(this)

    // ---- Compose-observed UI state ---------------------------------------
    private sealed interface Screen {
        data object Blank : Screen
        data object Setup : Screen
        data object Web : Screen
        data class Error(val error: LoadError) : Screen
    }

    private var screen by mutableStateOf<Screen>(Screen.Blank)
    private val setup = SetupState("")
    private var jsDialog by mutableStateOf<JsDialogRequest?>(null)
    private var updateOffer by mutableStateOf<Pair<UpdateManifest, Boolean>?>(null)
    private var pendingServer by mutableStateOf<Pair<String, SsoConfig>?>(null)
    private var webViewWarning by mutableStateOf<WebViewWarning?>(null)

    // ---- Web state -------------------------------------------------------
    private var activeServer: String? = null
    override val serverOrigin: String? get() = activeServer?.let { Origins.of(it) }
    private var policy: NavigationPolicy? = null
    private var pendingMainUrl: String? = null
    private var lastMainUrl: String? = null
    private var linkedAppsAttemptAt = 0L

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    // ---- Activity results ------------------------------------------------
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val cb = fileCallback
        fileCallback = null
        cb?.onReceiveValue(FileChooserResults.uris(r.resultCode, r.data))
    }
    private var notificationWaiter: CompletableDeferred<Boolean>? = null
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notificationWaiter?.complete(granted)
        notificationWaiter = null
    }
    private var storageWaiter: CompletableDeferred<Boolean>? = null
    private val storagePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        storageWaiter?.complete(granted)
        storageWaiter = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
        applySecureFlag()
        buildViews()
        onBackPressedDispatcher.addCallback(this, backCallback)
        checkWebView()

        val restoredUrl = savedInstanceState?.getString(STATE_URL)
        val server = prefs.serverUrl
        if (server == null) {
            showSetup(BuildConfig.DEFAULT_SERVER_URL, cancellable = false)
        } else {
            startWeb(server, restoredUrl?.takeIf { Origins.of(it) == Origins.of(server) })
        }
        if (savedInstanceState == null) handleIntent(intent)

        lifecycleScope.launch {
            snapshotFlow { screen == Screen.Web && !AppLock.locked && webViewWarning == null }
                .collect { visible ->
                    webContainer.visibility = if (visible) View.VISIBLE else View.INVISIBLE
                    // Keyboard focus back to the page (the overlay may have held it).
                    if (visible) web?.webView?.requestFocus()
                }
        }
    }

    private fun buildViews() {
        root = FrameLayout(this).apply { setBackgroundColor(WebHost.BACKGROUND) }
        webContainer = FrameLayout(this).apply { setBackgroundColor(WebHost.BACKGROUND) }
        // System bars + IME as padding: the keyboard resizes the page, content
        // never goes under the bars, the bar area shows the container colour.
        ViewCompat.setOnApplyWindowInsetsListener(webContainer) { v, insets ->
            val i = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime() or WindowInsetsCompat.Type.displayCutout(),
            )
            v.setPadding(i.left, i.top, i.right, i.bottom)
            insets
        }
        val overlay = ComposeView(this).apply {
            setContent { ObliTheme { Overlay() } }
        }
        val match = ViewGroup.LayoutParams.MATCH_PARENT
        root.addView(webContainer, FrameLayout.LayoutParams(match, match))
        root.addView(overlay, FrameLayout.LayoutParams(match, match))
        setContentView(root)
    }

    @androidx.compose.runtime.Composable
    private fun Overlay() {
        when (val s = screen) {
            Screen.Setup -> SetupScreen(
                state = setup,
                onSubmit = ::submitSetup,
                onCancel = { if (activeServer != null) screen = Screen.Web },
                onOpenSettings = ::openSettings,
            )
            is Screen.Error -> ErrorScreen(
                error = s.error,
                onRetry = { screen = Screen.Web; load(s.error.url) },
                onSettings = ::openSettings,
                onLocalLogin = { activeServer?.let { screen = Screen.Web; load("$it/login?local=1") } },
            )
            Screen.Web, Screen.Blank -> Unit
        }
        webViewWarning?.let { w ->
            WebViewWarningScreen(
                warning = w,
                onUpdate = { ExternalLinks.openStorePage(this, w.packageName ?: "com.google.android.webview") },
                onContinue = { webViewWarning = null },
            )
        }
        if (AppLock.locked) LockScreen(onUnlock = { promptUnlock() })
        jsDialog?.let { JsDialog(it) { jsDialog = null } }
        updateOffer?.let { (manifest, required) ->
            UpdateDialog(
                manifest = manifest,
                required = required,
                onDownload = {
                    updateOffer = null
                    val ok = Updater.startDownload(this, manifest)
                    Toast.makeText(this, if (ok) R.string.update_downloading else R.string.update_failed_start, Toast.LENGTH_SHORT).show()
                },
                onLater = { updateOffer = null },
            )
        }
        pendingServer?.let { (url, sso) ->
            ConfirmDialog(
                title = stringResource(R.string.server_replace_title),
                body = stringResource(R.string.server_replace_body, prefs.serverUrl.orEmpty(), url),
                confirmLabel = stringResource(R.string.server_replace_confirm),
                onConfirm = { pendingServer = null; applyServer(url, sso) },
                onDismiss = { pendingServer = null },
            )
        }
    }

    // ---- Lifecycle -------------------------------------------------------

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        reconcileServer()
        web?.resume(serverOrigin)
        if (prefs.alertsPausedForAuth) {
            // Contract §7: polling resumes once the app has been opened.
            prefs.alertsPausedForAuth = false
            Notifications.cancel(this, Notifications.ID_SIGN_IN)
        }
        if (activeServer != null) {
            lifecycleScope.launch {
                val r = Updater.check(this@MainActivity, force = false)
                if (r is Updater.Check.Available && updateOffer == null) updateOffer = r.manifest to r.required
                Updater.resumePending(applicationContext)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        applySecureFlag()
        AppLock.autoPromptIfLocked(this) { lockDisabledNotice() }
        ApkInstaller.resumeIfPermitted(this)
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onStop() {
        CookieManager.getInstance().flush()
        web?.pause(serverOrigin)
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        lastMainUrl?.let { outState.putString(STATE_URL, it) }
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        jsDialog?.let { cancelJsDialog(it) }
        web?.destroy()
        web = null
        super.onDestroy()
    }

    private fun promptUnlock() {
        AppLock.promptIfLocked(this) { lockDisabledNotice() }
    }

    private fun lockDisabledNotice() {
        Toast.makeText(this, R.string.lock_disabled_no_credential, Toast.LENGTH_LONG).show()
    }

    private fun applySecureFlag() {
        if (prefs.blockScreenshots) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    /** Settings may have changed or forgotten the server while we were stopped. */
    private fun reconcileServer() {
        val configured = prefs.serverUrl
        when {
            configured == null && activeServer != null -> {
                teardownWeb()
                showSetup(BuildConfig.DEFAULT_SERVER_URL, cancellable = false)
            }
            configured != null && configured != activeServer && screen != Screen.Setup -> {
                teardownWeb()
                startWeb(configured, null)
            }
            else -> rebuildPolicy()
        }
    }

    private fun checkWebView() {
        val pkg = try { WebViewCompat.getCurrentWebViewPackage(this) } catch (_: RuntimeException) { null }
        val bridgeMissing = !(
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
                WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            )
        if (WebViewVersion.isTooOld(pkg?.versionName) || bridgeMissing) {
            webViewWarning = WebViewWarning(pkg?.packageName, pkg?.versionName, bridgeMissing)
        }
    }

    override fun webViewVersion(): String? =
        try { WebViewCompat.getCurrentWebViewPackage(this)?.versionName } catch (_: RuntimeException) { null }

    // ---- Intents -----------------------------------------------------------

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        when (intent.action) {
            Intent.ACTION_VIEW -> {
                val data = intent.data ?: return
                if (data.scheme == "obli-${Shell.appId}" && data.host == "setup") {
                    val server = data.getQueryParameter("server")?.trim()?.take(2048).orEmpty()
                    showSetup(server, cancellable = activeServer != null)
                }
            }
            ExternalLinks.ACTION_OPEN_URL -> {
                val url = intent.dataString ?: return
                val origin = Origins.of(url) ?: return
                val server = activeServer
                if (server == null) {
                    // Not configured yet: offer that server, the user confirms.
                    showSetup(origin, cancellable = false)
                } else if (origin == serverOrigin) {
                    val path = url.removePrefix(origin).ifEmpty { "/" }
                    if (IncomingLinks.isAllowedPath(path)) navigateTo(path)
                }
            }
            ACTION_OPEN -> intent.getStringExtra(EXTRA_NAVIGATE_TO)?.let { navigateTo(it) }
            ACTION_INSTALL_UPDATE -> ApkInstaller.installVerified(this)
        }
    }

    /** Opens a same-origin path of the server (notification taps, sibling shells). */
    private fun navigateTo(path: String) {
        val origin = serverOrigin ?: return
        val url = Origins.resolveRelativePath(origin, path) ?: return
        if (!IncomingLinks.isAllowedPath(path)) return
        if (screen is Screen.Error) screen = Screen.Web
        if (screen == Screen.Web) load(url)
    }

    // ---- Setup -------------------------------------------------------------

    private fun showSetup(prefill: String, cancellable: Boolean) {
        setup.url = prefill
        setup.error = null
        setup.busy = false
        setup.cancellable = cancellable
        screen = Screen.Setup
    }

    private fun submitSetup() {
        if (setup.busy) return
        val url = when (val r = ServerUrl.normalize(setup.url)) {
            is ServerUrl.Result.Invalid -> {
                setup.error = getString(
                    when (r.problem) {
                        ServerUrl.Problem.EMPTY -> R.string.setup_error_empty
                        ServerUrl.Problem.NOT_HTTPS -> R.string.setup_error_https
                        ServerUrl.Problem.MALFORMED -> R.string.setup_error_malformed
                        ServerUrl.Problem.HAS_CREDENTIALS -> R.string.setup_error_credentials
                    },
                )
                return
            }
            is ServerUrl.Result.Ok -> r.url
        }
        setup.url = url
        setup.busy = true
        lifecycleScope.launch {
            val check = ServerApi.checkServer(url)
            setup.busy = false
            when (check) {
                is ServerApi.SetupCheck.Ok -> {
                    val current = prefs.serverUrl
                    if (current != null && current != url) pendingServer = url to check.sso
                    else applyServer(url, check.sso)
                }
                is ServerApi.SetupCheck.Unreachable -> setup.error = getString(
                    when (check.failure) {
                        Http.Failure.TLS -> R.string.setup_error_tls
                        Http.Failure.TIMEOUT -> R.string.setup_error_timeout
                        else -> R.string.setup_error_unreachable
                    },
                )
                is ServerApi.SetupCheck.HttpStatus -> setup.error = getString(R.string.setup_error_http, check.code)
                ServerApi.SetupCheck.NotObli -> setup.error = getString(R.string.setup_error_not_obli)
            }
        }
    }

    private fun applyServer(url: String, sso: SsoConfig) {
        val previous = prefs.serverUrl
        val commit = {
            prefs.serverUrl = url
            prefs.obligateOrigin = sso.obligateOrigin
            AlertScheduler.sync(applicationContext)
            teardownWeb()
            startWeb(url, null)
        }
        if (previous != null && previous != url) {
            teardownWeb()
            SessionReset.clearWebData(this) { commit() }
        } else {
            commit()
        }
    }

    // ---- WebView -------------------------------------------------------------

    private fun startWeb(server: String, initialUrl: String?) {
        val origin = Origins.of(server) ?: return
        activeServer = server
        rebuildPolicy()
        val host = web ?: WebHost(this, webContainer, this, bridge).also { web = it }
        if (host.webView == null) host.create()
        host.registerBridge(origin)
        screen = Screen.Web
        load(initialUrl ?: "$server/")
        lifecycleScope.launch {
            ServerApi.refreshSsoConfig(server)
            rebuildPolicy()
        }
    }

    private fun teardownWeb() {
        web?.destroy()
        activeServer = null
        policy = null
        lastMainUrl = null
        pendingMainUrl = null
    }

    private fun load(url: String) {
        val wv = web?.webView ?: return
        pendingMainUrl = url
        wv.loadUrl(url)
    }

    private fun rebuildPolicy() {
        val origin = serverOrigin
        policy = origin?.let { NavigationPolicy(it, prefs.obligateOrigin, prefs.linkedApps, Shell.appId) }
    }

    /** Linked Obli apps need the session: refreshed after pages of the server load. */
    private fun maybeRefreshLinkedApps(url: String) {
        val server = activeServer ?: return
        val path = url.removePrefix(serverOrigin.orEmpty())
        if (path.startsWith("/login") || path.startsWith("/auth/")) return
        val now = System.currentTimeMillis()
        val fresh = now - prefs.linkedAppsFetchedAt < LINKED_APPS_TTL_MS && prefs.linkedApps.isNotEmpty()
        if (fresh || now - linkedAppsAttemptAt < LINKED_APPS_RETRY_MS) return
        linkedAppsAttemptAt = now
        lifecycleScope.launch {
            if (ServerApi.refreshLinkedApps(server)) rebuildPolicy()
        }
    }

    // ---- WebCallbacks ----------------------------------------------------------

    override fun decide(url: String, isMainFrame: Boolean, isRedirect: Boolean): NavDecision =
        policy?.decide(url, isMainFrame, isRedirect) ?: NavDecision.Block

    override fun perform(decision: NavDecision, url: String, fromPopup: Boolean) {
        when (decision) {
            NavDecision.LoadInWebView -> if (fromPopup) load(url)
            is NavDecision.OpenObliApp -> ExternalLinks.openObliApp(this, decision.appId, decision.url)
            is NavDecision.OpenCustomTab -> ExternalLinks.openCustomTab(this, decision.url)
            is NavDecision.OpenExternalIntent -> ExternalLinks.openExternalIntent(this, decision.url)
            NavDecision.Block -> if (BuildConfig.DEBUG) Log.d(TAG, "blocked navigation to ${Origins.scheme(url)}:")
        }
    }

    override fun onMainFrameStarted(url: String) {
        pendingMainUrl = url
    }

    override fun onMainFrameFinished(url: String) {
        if (screen is Screen.Error) return
        lastMainUrl = url
        if (Origins.of(url) == serverOrigin) {
            CookieManager.getInstance().flush()
            maybeRefreshLinkedApps(url)
        }
    }

    override fun onMainFrameError(url: String, errorCode: Int, description: String?) {
        if (screen == Screen.Setup) return
        val origin = Origins.of(url)
        screen = Screen.Error(
            LoadError(
                url = url,
                host = Origins.host(url),
                description = description,
                ssl = errorCode == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE,
                ssoHost = origin != null && origin == prefs.obligateOrigin && origin != serverOrigin,
            ),
        )
    }

    override fun onSslError(url: String) {
        val target = pendingMainUrl ?: return
        if (screen == Screen.Setup || Origins.of(url) != Origins.of(target)) return
        val origin = Origins.of(target)
        screen = Screen.Error(
            LoadError(
                url = target,
                host = Origins.host(target),
                description = null,
                ssl = true,
                ssoHost = origin != null && origin == prefs.obligateOrigin && origin != serverOrigin,
            ),
        )
    }

    override fun onRenderProcessGone(view: WebView) {
        val host = web ?: return
        if (view != host.webView) {
            host.releasePopup(view)
            return
        }
        val url = lastMainUrl ?: activeServer?.let { "$it/" }
        root.post {
            host.destroy()
            host.create()
            serverOrigin?.let { host.registerBridge(it) }
            url?.let { load(it) }
        }
    }

    override fun onDownloadRequested(url: String, contentDisposition: String?, mimeType: String?) {
        when (Origins.scheme(url)) {
            // The web client saves generated files through ObliNative.saveFile.
            "blob", "data" -> Log.i(TAG, "ignored a ${Origins.scheme(url)}: download (use the bridge saveFile)")
            "http", "https" -> if (Origins.of(url) == serverOrigin) {
                lifecycleScope.launch { downloadFromServer(url, Downloads.filenameFor(url, contentDisposition, mimeType), mimeType) }
            } else {
                ExternalLinks.openCustomTab(this, url)
            }
            else -> Unit
        }
    }

    override fun showJsDialog(request: JsDialogRequest): Boolean {
        if (jsDialog != null || isFinishing) {
            cancelJsDialog(request)
            return true
        }
        jsDialog = request
        return true
    }

    private fun cancelJsDialog(request: JsDialogRequest) {
        when (request) {
            is JsDialogRequest.Alert -> request.result.confirm()
            is JsDialogRequest.Confirm -> request.result.cancel()
            is JsDialogRequest.Prompt -> request.result.cancel()
            is JsDialogRequest.BeforeUnload -> request.result.confirm()
        }
    }

    override fun showFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        val types = FileChooserTypes.resolve(params.acceptTypes)
        val intent = try {
            params.createIntent()
        } catch (_: RuntimeException) {
            Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE)
        }
        intent.type = types.mimeType
        if (types.extraMimeTypes.isNotEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.extraMimeTypes.toTypedArray())
        else intent.removeExtra(Intent.EXTRA_MIME_TYPES)
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
        return try {
            fileChooser.launch(intent)
            true
        } catch (_: ActivityNotFoundException) {
            fileCallback = null
            Toast.makeText(this, R.string.error_no_file_picker, Toast.LENGTH_SHORT).show()
            false
        }
    }

    override fun showCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (customView != null) {
            callback.onCustomViewHidden()
            return
        }
        customView = view
        customViewCallback = callback
        view.setBackgroundColor(Color.BLACK)
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun hideCustomView() {
        val view = customView ?: return
        customView = null
        root.removeView(view)
        WindowCompat.getInsetsController(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
        val cb = customViewCallback
        customViewCallback = null
        cb?.onCustomViewHidden()
    }

    // ---- BridgeHost ----------------------------------------------------------

    override suspend fun ensureLegacyStoragePermission(): Boolean {
        if (!Downloads.needsLegacyStoragePermission) return true
        val permission = Manifest.permission.WRITE_EXTERNAL_STORAGE
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) return true
        val waiter = CompletableDeferred<Boolean>()
        storageWaiter?.complete(false)
        storageWaiter = waiter
        storagePermission.launch(permission)
        return waiter.await()
    }

    override suspend fun requestNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return NotificationManagerCompat.from(this).areNotificationsEnabled()
        }
        if (Notifications.permissionGranted(this)) return NotificationManagerCompat.from(this).areNotificationsEnabled()
        val waiter = CompletableDeferred<Boolean>()
        notificationWaiter?.complete(false)
        notificationWaiter = waiter
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        return waiter.await()
    }

    override suspend fun downloadFromServer(url: String, filename: String?, mime: String?): Long? {
        if (Downloads.needsLegacyStoragePermission && !ensureLegacyStoragePermission()) {
            Toast.makeText(this, R.string.download_permission_denied, Toast.LENGTH_SHORT).show()
            return null
        }
        val name = filename ?: Downloads.filenameFor(url, null, mime)
        val id = Downloads.enqueue(this, url, name, mime)
        Toast.makeText(this, if (id != null) R.string.download_started else R.string.download_failed, Toast.LENGTH_SHORT).show()
        return id
    }

    override fun applySystemBars(argb: Int, lightTheme: Boolean?) {
        val color = argb or 0xFF000000.toInt()
        val light = SystemBarContrast.lightIcons(color, lightTheme)
        root.setBackgroundColor(color)
        webContainer.setBackgroundColor(color)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !light
            isAppearanceLightNavigationBars = !light
        }
    }

    override fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    override fun offerUpdate(manifest: UpdateManifest, required: Boolean) {
        updateOffer = manifest to required
    }

    // ---- Back ------------------------------------------------------------------

    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            if (customView != null) {
                hideCustomView()
                return
            }
            if (AppLock.locked) {
                finish()
                return
            }
            when (val s = screen) {
                Screen.Setup -> if (setup.cancellable && activeServer != null) screen = Screen.Web else finish()
                is Screen.Error -> {
                    val wv = web?.webView
                    if (wv != null && wv.canGoBack()) {
                        screen = Screen.Web
                        wv.goBack()
                    } else {
                        finish()
                    }
                    if (BuildConfig.DEBUG) Log.d(TAG, "back from error on ${s.error.host}")
                }
                Screen.Web -> webBack()
                Screen.Blank -> finish()
            }
        }
    }

    /** Contract §3: the page may consume Back (drawer, modal, sheet) first. */
    private fun webBack() {
        val wv = web?.webView ?: return finish()
        if (Origins.of(wv.url) == serverOrigin) {
            wv.evaluateJavascript("(window.__obliHandleBack&&window.__obliHandleBack())===true") { result ->
                if (result == "true") return@evaluateJavascript
                if (wv.canGoBack()) wv.goBack() else finish()
            }
        } else if (wv.canGoBack()) {
            wv.goBack()
        } else {
            finish()
        }
    }

    companion object {
        const val ACTION_OPEN = "tools.obli.shell.action.OPEN"
        const val ACTION_INSTALL_UPDATE = "tools.obli.shell.action.INSTALL_UPDATE"
        const val EXTRA_NAVIGATE_TO = "navigateTo"
        private const val STATE_URL = "web_url"
        private const val TAG = "ObliShell"
        private const val LINKED_APPS_TTL_MS = 6L * 60 * 60 * 1000
        private const val LINKED_APPS_RETRY_MS = 10L * 60 * 1000
    }
}
