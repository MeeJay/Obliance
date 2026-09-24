package tools.obli.shell.web

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import tools.obli.shell.BuildConfig
import tools.obli.shell.nav.NavDecision

/** A JavaScript dialog waiting for the user (alert / confirm / prompt / beforeunload). */
sealed interface JsDialogRequest {
    val host: String?
    val message: String

    data class Alert(override val host: String?, override val message: String, val result: JsResult) : JsDialogRequest
    data class Confirm(override val host: String?, override val message: String, val result: JsResult) : JsDialogRequest
    data class Prompt(override val host: String?, override val message: String, val defaultValue: String, val result: JsPromptResult) : JsDialogRequest
    data class BeforeUnload(override val host: String?, override val message: String, val result: JsResult) : JsDialogRequest
}

/** Everything the WebView layer reports to the activity. */
interface WebCallbacks {
    /** Decision for a navigation (null policy = not configured: block). */
    fun decide(url: String, isMainFrame: Boolean, isRedirect: Boolean): NavDecision
    /** Carries out a non-WebView decision, or loads a popup target in the main WebView. */
    fun perform(decision: NavDecision, url: String, fromPopup: Boolean)
    fun onMainFrameStarted(url: String)
    fun onMainFrameFinished(url: String)
    fun onMainFrameError(url: String, errorCode: Int, description: String?)
    fun onSslError(url: String)
    fun onRenderProcessGone(view: WebView)
    fun onDownloadRequested(url: String, contentDisposition: String?, mimeType: String?)
    fun showJsDialog(request: JsDialogRequest): Boolean
    fun showFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean
    fun showCustomView(view: View, callback: WebChromeClient.CustomViewCallback)
    fun hideCustomView()
}

// Both clients DO implement onRenderProcessGone; androidx.webkit's detector also
// flags the Kotlin super-constructor call `: WebViewClient()` itself.
@SuppressLint("MissingOnRenderProcessGone")
class ShellWebViewClient(private val callbacks: WebCallbacks) : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        val decision = callbacks.decide(url, request.isForMainFrame, request.isRedirect)
        if (decision == NavDecision.LoadInWebView) {
            if (request.isForMainFrame) callbacks.onMainFrameStarted(url)
            return false
        }
        callbacks.perform(decision, url, fromPopup = false)
        return true
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        callbacks.onMainFrameStarted(url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        callbacks.onMainFrameFinished(url)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        val description = error.description?.toString()
        // Navigations turned into downloads or cancelled by us are not failures.
        if (description != null && description.contains("ERR_ABORTED")) return
        callbacks.onMainFrameError(request.url.toString(), error.errorCode, description)
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // Never proceed on a certificate error.
        handler.cancel()
        callbacks.onSslError(error.url)
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        callbacks.onRenderProcessGone(view)
        return true
    }
}

class ShellChromeClient(
    private val callbacks: WebCallbacks,
    private val host: WebHost,
) : WebChromeClient() {

    /**
     * window.open / target=_blank: a transient, never-attached WebView captures
     * the target URL, which then goes through the same navigation policy (a
     * same-origin target, e.g. a report download, is loaded by the main
     * WebView, which turns attachments into downloads).
     */
    @SuppressLint("MissingOnRenderProcessGone") // the popup client implements it (see below)
    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
        val popup = host.newPopup()
        // The popup is never attached to a window, so View.post() would never
        // run: all deferred work goes through the main looper instead.
        val main = Handler(Looper.getMainLooper())
        var handled = false
        fun route(url: String) {
            if (handled || url.isBlank() || url == "about:blank") return
            handled = true
            val decision = callbacks.decide(url, isMainFrame = true, isRedirect = false)
            callbacks.perform(decision, url, fromPopup = true)
            main.post { host.releasePopup(popup) }
        }
        popup.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                route(request.url.toString())
                return true
            }

            override fun onPageStarted(v: WebView, url: String, favicon: Bitmap?) {
                if (url != "about:blank") {
                    v.stopLoading()
                    route(url)
                }
            }

            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                handled = true
                main.post { host.releasePopup(v) }
                return true
            }
        }
        popup.setDownloadListener { url, _, _, _, _ -> route(url) }
        // Nothing ever navigated the popup: release it.
        main.postDelayed({ if (!handled) host.releasePopup(popup) }, POPUP_TIMEOUT_MS)
        transport.webView = popup
        resultMsg.sendToTarget()
        return true
    }

    override fun onCloseWindow(window: WebView) {
        host.releasePopup(window)
    }

    override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean =
        callbacks.showJsDialog(JsDialogRequest.Alert(hostOf(url), message, result))

    override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean =
        callbacks.showJsDialog(JsDialogRequest.Confirm(hostOf(url), message, result))

    override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean =
        callbacks.showJsDialog(JsDialogRequest.Prompt(hostOf(url), message, defaultValue.orEmpty(), result))

    override fun onJsBeforeUnload(view: WebView, url: String, message: String, result: JsResult): Boolean =
        callbacks.showJsDialog(JsDialogRequest.BeforeUnload(hostOf(url), message, result))

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean = callbacks.showFileChooser(filePathCallback, fileChooserParams)

    override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        callbacks.showCustomView(view, callback)
    }

    override fun onHideCustomView() {
        callbacks.hideCustomView()
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        if (BuildConfig.DEBUG) {
            Log.d("ObliConsole", "${consoleMessage.messageLevel()} ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()} ${consoleMessage.message()}")
        }
        // Swallowed in release: nothing from the page reaches logcat.
        return true
    }

    private fun hostOf(url: String?): String? = tools.obli.shell.nav.Origins.host(url)

    private companion object {
        const val POPUP_TIMEOUT_MS = 30_000L
    }
}
