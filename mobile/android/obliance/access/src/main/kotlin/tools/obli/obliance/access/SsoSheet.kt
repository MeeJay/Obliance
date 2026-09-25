package tools.obli.obliance.access

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.shell.nav.Origins

/*
 * S02 "Connexion Obligate": a full-screen WebView sheet (tablet: 720 × 640
 * dialog) on `<origin>/auth/sso-redirect`. The whole OAuth round trip stays in
 * this WebView (the `state` lives in the server session, a Custom Tab would not
 * share the cookies). When the main frame comes back to the server outside
 * `/auth` and `/login`, the sheet closes without ever showing the web app: the
 * session cookie is already in the process-wide CookieManager, which the
 * native HTTP client (WebCookieJar) reads.
 */

/** The Obligate sign-in sheet for [probe]'s server. [onOutcome] is called exactly once. */
@Composable
internal fun SsoSheet(probe: ProbeInfo, onOutcome: (SsoOutcome) -> Unit) {
    var finished by remember { mutableStateOf(false) }
    val finish: (SsoOutcome) -> Unit = { outcome ->
        if (!finished) {
            finished = true
            onOutcome(outcome)
        }
    }
    Dialog(onDismissRequest = { finish(SsoOutcome.Cancelled) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            val wide = maxWidth >= 720.dp && maxHeight >= 640.dp
            var progress by remember { mutableIntStateOf(0) }
            var host by remember { mutableStateOf(probe.obligateHost ?: probe.host) }
            var webView by remember { mutableStateOf<WebView?>(null) }
            BackHandler {
                val view = webView
                if (view != null && view.canGoBack()) view.goBack() else finish(SsoOutcome.Cancelled)
            }
            SsoFrame(
                host = host,
                progress = progress,
                onCancel = { finish(SsoOutcome.Cancelled) },
                modifier = if (wide) Modifier.size(720.dp, 640.dp).clip(CardShape) else Modifier.fillMaxSize(),
            ) {
                SsoWebView(
                    origin = probe.origin,
                    onProgress = { progress = it },
                    onHost = { host = it },
                    onOutcome = finish,
                    onCreated = { webView = it },
                )
            }
        }
    }
}

/** Native chrome of the sheet: Annuler, "Obligate", the host of the page shown, a progress line. */
@Composable
internal fun SsoFrame(host: String, progress: Int, onCancel: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = ObliTheme.colors
    Column(modifier.background(c.bg)) {
        Row(
            Modifier.fillMaxWidth().height(64.dp).background(c.chrome).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ObliIconButton(ObliIcons.X, stringResource(R.string.access_sso_cancel), onCancel, tint = c.text)
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.access_sso_title), style = ObliTypography.cardTitle, color = c.text, modifier = Modifier.semantics { heading() })
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    androidx.compose.material3.Icon(ObliIcons.Lock, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(12.dp))
                    Text(host, style = ObliTypography.monoCaption, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(2.dp)) {
            if (progress in 0..99) {
                LinearProgressIndicator(
                    progress = { progress / 100f },
                    modifier = Modifier.fillMaxWidth().height(2.dp),
                    color = AccessColors.link,
                    trackColor = Color.Transparent,
                    drawStopIndicator = {},
                )
            }
        }
        Box(Modifier.fillMaxWidth().weight(1f)) { content() }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SsoWebView(
    origin: String,
    onProgress: (Int) -> Unit,
    onHost: (String) -> Unit,
    onOutcome: (SsoOutcome) -> Unit,
    onCreated: (WebView) -> Unit,
) {
    val outcome by rememberUpdatedState(onOutcome)
    val progress by rememberUpdatedState(onProgress)
    val hostChanged by rememberUpdatedState(onHost)
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                // Obligate's sign-in page is a JavaScript application; nothing else is loaded here.
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.setSupportMultipleWindows(false)
                CookieManager.getInstance().setAcceptCookie(true)
                webChromeClient = object : WebChromeClient() {
                    override fun onProgressChanged(view: WebView?, newProgress: Int) = progress(newProgress)
                }
                webViewClient = SsoClient(origin, { outcome(it) }, { hostChanged(it) })
                onCreated(this)
                loadUrl(SsoNavigation.startUrl(origin))
            }
        },
        onRelease = { view ->
            view.stopLoading()
            view.destroy()
        },
    )
}

/** Applies [SsoNavigation] to every main-frame navigation of the sheet's WebView. */
private class SsoClient(
    private val origin: String,
    private val onOutcome: (SsoOutcome) -> Unit,
    private val onHost: (String) -> Unit,
) : WebViewClient() {
    private var done = false

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return false
        return intercept(request.url.toString())
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        if (intercept(url)) {
            view.stopLoading()
            return
        }
        Origins.host(url)?.let(onHost)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) finish(SsoOutcome.Failed(SsoFailure.PAGE_ERROR))
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // Never proceed on a bad certificate.
        handler.cancel()
        finish(SsoOutcome.Failed(SsoFailure.TLS))
    }

    /** True when the navigation must not load (the flow ended, or a refused scheme). */
    private fun intercept(url: String?): Boolean = when (val step = SsoNavigation.classify(origin, url)) {
        SsoStep.Continue -> false
        SsoStep.Blocked -> true
        SsoStep.SignedIn -> {
            // The session cookie is in the shared store; persist it before the native probe.
            runCatching { CookieManager.getInstance().flush() }
            finish(SsoOutcome.SignedIn)
            true
        }
        is SsoStep.Failed -> {
            finish(SsoOutcome.Failed(step.reason))
            true
        }
    }

    private fun finish(outcome: SsoOutcome) {
        if (done) return
        done = true
        onOutcome(outcome)
    }
}
