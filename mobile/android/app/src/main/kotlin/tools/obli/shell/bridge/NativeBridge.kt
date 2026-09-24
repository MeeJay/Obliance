package tools.obli.shell.bridge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import tools.obli.shell.BuildConfig
import tools.obli.shell.R
import tools.obli.shell.Shell
import tools.obli.shell.nav.Origins
import tools.obli.shell.notify.Notifications
import tools.obli.shell.update.Updater
import tools.obli.shell.update.UpdateManifest
import tools.obli.shell.web.Downloads
import tools.obli.shell.web.ExternalLinks

/** What the bridge needs from the hosting activity. */
interface BridgeHost {
    val activity: AppCompatActivity
    /** Origin of the configured server (the only origin allowed to call). */
    val serverOrigin: String?
    suspend fun ensureLegacyStoragePermission(): Boolean
    suspend fun requestNotificationPermission(): Boolean
    /** Same-origin DownloadManager download (handles legacy permission). */
    suspend fun downloadFromServer(url: String, filename: String?, mime: String?): Long?
    fun applySystemBars(argb: Int, lightIcons: Boolean)
    fun openSettings()
    fun offerUpdate(manifest: UpdateManifest, required: Boolean)
    fun webViewVersion(): String?
}

/**
 * Native side of `window.ObliNative` (docs/obli-mobile.md §3). Receives
 * `{id, method, params}` through addWebMessageListener (origin-restricted to the
 * server), validates every parameter, answers `{id, ok, result|error}`.
 */
class NativeBridge(private val host: BridgeHost) : WebViewCompat.WebMessageListener {

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        val server = host.serverOrigin ?: return
        // allowedOriginRules already restrict this; checked again on purpose.
        if (Origins.of(sourceOrigin.toString()) != server) return
        val parsed = BridgeProtocol.parse(message.data)
        val request = when (parsed) {
            is BridgeProtocol.Parsed.Error -> {
                parsed.id?.let { reply(replyProxy, BridgeProtocol.failure(it, parsed.message)) }
                return
            }
            is BridgeProtocol.Parsed.Ok -> parsed.request
        }
        if (!isMainFrame) {
            reply(replyProxy, BridgeProtocol.failure(request.id, "bridge is only available to the main frame"))
            return
        }
        host.activity.lifecycleScope.launch {
            val answer = try {
                BridgeProtocol.success(request.id, handle(request, server))
            } catch (e: CancellationException) {
                throw e
            } catch (e: BridgeParamException) {
                BridgeProtocol.failure(request.id, e.message ?: "invalid params")
            } catch (e: Exception) {
                if (BuildConfig.DEBUG) Log.w(TAG, "bridge ${request.method} failed", e)
                BridgeProtocol.failure(request.id, "${request.method} failed")
            }
            reply(replyProxy, answer)
        }
    }

    private fun reply(proxy: JavaScriptReplyProxy, json: String) {
        // Always true here: this listener only exists when the feature does.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        try {
            proxy.postMessage(json)
        } catch (e: RuntimeException) {
            // The page navigated away: nobody is listening any more.
            if (BuildConfig.DEBUG) Log.d(TAG, "reply dropped", e)
        }
    }

    private suspend fun handle(req: BridgeRequest, server: String): JsonElement {
        val ctx: Context = host.activity
        val p = req.params
        return when (req.method) {
            "saveFile" -> {
                val filename = BridgeValidators.filename(p.string("filename", 1_000))
                val mime = BridgeValidators.mime(p.optString("mime", 255))
                val bytes = BridgeValidators.base64Payload(p.string("base64", BridgeValidators.MAX_BASE64_CHARS))
                if (Downloads.needsLegacyStoragePermission && !host.ensureLegacyStoragePermission()) {
                    throw BridgeParamException("storage permission denied")
                }
                val uri = Downloads.saveToDownloads(ctx, filename, mime, bytes)
                Downloads.notifySaved(ctx, uri, filename, mime)
                buildJsonObject { put("uri", uri.toString()) }
            }
            "downloadUrl" -> {
                val url = BridgeValidators.sameOriginUrl(p.string("url", BridgeValidators.MAX_URL), server)
                val filename = p.optString("filename", 1_000)?.let { BridgeValidators.filename(it) }
                val id = host.downloadFromServer(url, filename, null) ?: throw BridgeParamException("download could not start")
                buildJsonObject { put("id", id) }
            }
            "openExternal" -> {
                val url = BridgeValidators.externalUrl(p.string("url", BridgeValidators.MAX_URL))
                when (Origins.scheme(url)) {
                    "http", "https" -> ExternalLinks.openCustomTab(ctx, url)
                    else -> ExternalLinks.openExternalIntent(ctx, url)
                }
                JsonPrimitive(true)
            }
            "copyText" -> {
                val text = p.string("text", BridgeValidators.MAX_TEXT_COPY, allowEmpty = true)
                val cm = ctx.getSystemService(ClipboardManager::class.java) ?: throw IllegalStateException("no clipboard")
                cm.setPrimaryClip(ClipData.newPlainText(ctx.getString(R.string.app_name), text))
                JsonPrimitive(true)
            }
            "readClipboard" -> {
                val cm = ctx.getSystemService(ClipboardManager::class.java)
                val clip = cm?.primaryClip
                val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(ctx)?.toString() else null
                JsonPrimitive(text.orEmpty().take(BridgeValidators.MAX_TEXT_COPY))
            }
            "share" -> {
                val text = p.string("text", BridgeValidators.MAX_TEXT_SHARE)
                val title = p.optString("title", BridgeValidators.MAX_TITLE)
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                if (title != null) send.putExtra(Intent.EXTRA_SUBJECT, title)
                host.activity.startActivity(Intent.createChooser(send, title))
                JsonPrimitive(true)
            }
            "notify" -> {
                val title = p.string("title", BridgeValidators.MAX_TITLE)
                val body = p.optString("body", BridgeValidators.MAX_BODY).orEmpty()
                val navigateTo = BridgeValidators.navigateTo(p.optString("navigateTo", 4_096), server)?.removePrefix(server)
                val n = Notifications.builder(ctx, Notifications.CH_ALERTS)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                    .setContentIntent(Notifications.openAppIntent(ctx, nextNotifyId, navigateTo))
                    .build()
                JsonPrimitive(Notifications.post(ctx, nextNotifyId++, n))
            }
            "openSettings" -> {
                host.openSettings()
                JsonPrimitive(true)
            }
            "setSystemBars" -> {
                val color = BridgeValidators.color(p.string("colorHex", 16))
                host.applySystemBars(color, p.bool("lightIcons", default = true))
                JsonPrimitive(true)
            }
            "requestNotificationPermission" ->
                JsonPrimitive(if (host.requestNotificationPermission()) "granted" else "denied")
            "checkForUpdate" -> {
                val prompt = p.bool("prompt", default = true)
                when (val r = Updater.check(ctx, force = true)) {
                    is Updater.Check.Available -> {
                        if (prompt) host.offerUpdate(r.manifest, r.required)
                        updateJson(true, r.manifest.versionName, r.manifest.versionCode)
                    }
                    is Updater.Check.UpToDate -> updateJson(false, r.manifest.versionName, r.manifest.versionCode)
                    is Updater.Check.NotApplicable -> updateJson(false, r.manifest.versionName, r.manifest.versionCode)
                    is Updater.Check.Failed -> throw IllegalStateException("update check failed: ${r.reason}")
                    Updater.Check.NotConfigured, Updater.Check.Skipped -> updateJson(false, Shell.versionName, Shell.versionCode)
                }
            }
            "getInfo" -> buildJsonObject {
                put("app", Shell.appId)
                put("appVersion", Shell.versionName)
                put("versionCode", Shell.versionCode)
                val wv = host.webViewVersion()
                if (wv != null) put("webViewVersion", wv) else put("webViewVersion", JsonNull)
                put("serverUrl", Shell.prefs.serverUrl)
            }
            else -> throw BridgeParamException("unknown method: ${req.method}")
        }
    }

    private fun updateJson(available: Boolean, versionName: String, versionCode: Int) = buildJsonObject {
        put("available", available)
        put("versionName", versionName)
        put("versionCode", versionCode)
    }

    private var nextNotifyId = 3_000

    private companion object {
        const val TAG = "ObliBridge"
    }
}
