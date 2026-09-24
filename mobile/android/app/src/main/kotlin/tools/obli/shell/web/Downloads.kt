package tools.obli.shell.web

import android.app.DownloadManager
import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.webkit.CookieManager
import android.webkit.URLUtil
import androidx.core.net.toUri
import androidx.annotation.RequiresApi
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import tools.obli.shell.BuildConfig
import tools.obli.shell.R
import tools.obli.shell.Shell
import tools.obli.shell.bridge.BridgeValidators
import tools.obli.shell.notify.Notifications

/** Authenticated server downloads (DownloadManager) and bridge saveFile (MediaStore). */
object Downloads {
    private const val TAG = "ObliDownloads"

    /** True when writing to the public Downloads folder needs WRITE_EXTERNAL_STORAGE (API < 29). */
    val needsLegacyStoragePermission: Boolean get() = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

    /** File name for a download: Content-Disposition first, then URLUtil's guess. */
    fun filenameFor(url: String, contentDisposition: String?, mime: String?): String {
        val fromHeader = ContentDisposition.filename(contentDisposition)
        val raw = fromHeader ?: URLUtil.guessFileName(url, contentDisposition, mime)
        return try {
            BridgeValidators.filename(raw)
        } catch (_: IllegalArgumentException) {
            "download"
        }
    }

    /**
     * Same-origin server download through DownloadManager, carrying the WebView
     * session cookie and user agent (the routes are session-protected).
     */
    fun enqueue(context: Context, url: String, filename: String, mime: String?): Long? {
        val dm = context.getSystemService(DownloadManager::class.java) ?: return null
        val request = DownloadManager.Request(url.toUri())
            .setTitle(filename)
            .setDescription(context.getString(R.string.app_name))
            .addRequestHeader("User-Agent", Shell.userAgent)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
        CookieManager.getInstance().getCookie(url)?.takeIf { it.isNotBlank() }?.let { request.addRequestHeader("Cookie", it) }
        val cleanMime = mime?.let { BridgeValidators.mime(it) }
        if (cleanMime != null && cleanMime != BridgeValidators.DEFAULT_MIME) request.setMimeType(cleanMime)
        return try {
            dm.enqueue(request)
        } catch (e: RuntimeException) {
            Log.w(TAG, "download refused", e)
            null
        }
    }

    /**
     * Writes bytes to the public Downloads folder and returns a content URI the
     * app owns (MediaStore on API 29+, FileProvider over the legacy folder
     * below). Never returns a file path.
     */
    suspend fun saveToDownloads(context: Context, filename: String, mime: String, bytes: ByteArray): Uri =
        withContext(Dispatchers.IO) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) saveMediaStore(context, filename, mime, bytes)
            else saveLegacy(context, filename, bytes)
        }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun saveMediaStore(context: Context, filename: String, mime: String, bytes: ByteArray): Uri {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("MediaStore insert failed")
        try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("cannot open output")
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return uri
    }

    @Suppress("DEPRECATION") // the public Downloads directory API is the only one below API 29
    private fun saveLegacy(context: Context, filename: String, bytes: ByteArray): Uri {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!dir.exists() && !dir.mkdirs()) throw IOException("no Downloads directory")
        val target = uniqueFile(dir, filename)
        target.writeBytes(bytes)
        android.media.MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), null, null)
        return FileProvider.getUriForFile(context, "${context.packageName}.updates", target)
    }

    private fun uniqueFile(dir: File, name: String): File {
        var f = File(dir, name)
        if (!f.exists()) return f
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var i = 1
        while (f.exists() && i < 1000) {
            f = File(dir, "$base ($i)$ext")
            i++
        }
        return f
    }

    /** "Download complete" notification that opens the saved file. */
    fun notifySaved(context: Context, uri: Uri, filename: String, mime: String) {
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        view.clipData = ClipData.newRawUri(filename, uri)
        val chooser = Intent.createChooser(view, context.getString(R.string.open_with))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val pi = android.app.PendingIntent.getActivity(
            context, uri.hashCode(), chooser,
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = Notifications.builder(context, Notifications.CH_DOWNLOADS)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(context.getString(R.string.download_complete))
            .setContentText(filename)
            .setContentIntent(pi)
            .build()
        val posted = Notifications.post(context, 2_000 + (uri.hashCode() and 0xffff), n)
        if (!posted && BuildConfig.DEBUG) Log.d(TAG, "saved without notification (permission)")
    }
}
