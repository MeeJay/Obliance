package tools.obli.shell.web

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import tools.obli.shell.BuildConfig
import tools.obli.shell.Shell
import tools.obli.shell.bridge.BridgeProtocol
import tools.obli.shell.bridge.BridgeScript
import tools.obli.shell.bridge.NativeBridge
import tools.obli.shell.bridge.NativeInfo

/**
 * Owns the single WebView: creation with the hardened settings, the bridge
 * registration for the server origin, lifecycle, and re-creation after the
 * renderer died.
 */
class WebHost(
    private val context: Context,
    private val container: FrameLayout,
    private val callbacks: WebCallbacks,
    private val bridge: NativeBridge,
) {
    var webView: WebView? = null
        private set

    private var scriptHandler: ScriptHandler? = null
    private var bridgeOrigin: String? = null

    /** Transient WebViews created for window.open / target=_blank. */
    private val popups = mutableListOf<WebView>()

    fun create(): WebView {
        destroy()
        val wv = WebView(context)
        configure(wv)
        container.addView(wv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        webView = wv
        return wv
    }

    @SuppressLint("SetJavaScriptEnabled") // the whole point: it runs the Obli web client
    private fun configure(wv: WebView) {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false)
            // Pinch zoom stays available (the web client never disables it).
            builtInZoomControls = true
            displayZoomControls = false
            userAgentString = Shell.userAgent
        }
        wv.setBackgroundColor(BACKGROUND)
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, false)
        }
        wv.webViewClient = ShellWebViewClient(callbacks)
        wv.webChromeClient = ShellChromeClient(callbacks, this)
        wv.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            callbacks.onDownloadRequested(url, contentDisposition, mimeType)
        }
    }

    /** Both WebView features the bridge is built on. */
    val bridgeSupported: Boolean
        get() = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    /**
     * (Re-)registers `__obliBridge` and the document-start script for exactly
     * [serverOrigin]. Must run before the page loads to reach the first document.
     */
    fun registerBridge(serverOrigin: String) {
        val wv = webView ?: return
        if (bridgeOrigin == serverOrigin) return
        unregisterBridge()
        val rules = setOf(serverOrigin)
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
            WebViewCompat.addWebMessageListener(wv, BridgeProtocol.JS_OBJECT_NAME, rules, bridge)
            bridgeOrigin = serverOrigin
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
            scriptHandler = WebViewCompat.addDocumentStartJavaScript(
                wv,
                BridgeScript.build(NativeInfo(Shell.appId, Shell.versionName, Shell.versionCode)),
                rules,
            )
        } catch (e: RuntimeException) {
            Log.w(TAG, "bridge registration failed", e)
            unregisterBridge()
        }
    }

    fun unregisterBridge() {
        val wv = webView
        scriptHandler?.remove()
        scriptHandler = null
        if (wv != null && bridgeOrigin != null && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            try {
                WebViewCompat.removeWebMessageListener(wv, BridgeProtocol.JS_OBJECT_NAME)
            } catch (_: RuntimeException) {
                // never registered on this instance
            }
        }
        bridgeOrigin = null
    }

    fun newPopup(): WebView = WebView(context).also { popups += it }

    fun releasePopup(popup: WebView) {
        if (popups.remove(popup)) {
            popup.stopLoading()
            popup.destroy()
        }
    }

    /** Page-visible lifecycle events + WebView timers (contract §3 obli:pause/obli:resume). */
    fun pause(serverOrigin: String?) {
        val wv = webView ?: return
        dispatchEvent(wv, serverOrigin, "obli:pause")
        wv.onPause()
        wv.pauseTimers()
    }

    fun resume(serverOrigin: String?) {
        val wv = webView ?: return
        wv.resumeTimers()
        wv.onResume()
        dispatchEvent(wv, serverOrigin, "obli:resume")
    }

    private fun dispatchEvent(wv: WebView, serverOrigin: String?, name: String) {
        if (serverOrigin == null || tools.obli.shell.nav.Origins.of(wv.url) != serverOrigin) return
        wv.evaluateJavascript("window.dispatchEvent(new CustomEvent('$name'));", null)
    }

    fun destroy() {
        popups.toList().forEach { releasePopup(it) }
        val wv = webView ?: return
        unregisterBridge()
        container.removeView(wv)
        wv.stopLoading()
        wv.webChromeClient = null
        wv.destroy()
        webView = null
    }

    companion object {
        private const val TAG = "ObliWeb"
        const val BACKGROUND = 0xFF0F1220.toInt()
    }
}
