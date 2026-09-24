package tools.obli.shell.net

import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import tools.obli.shell.Shell

/** Minimal HTTPS GET for the few native calls (no extra HTTP stack). */
object Http {
    enum class Failure { UNREACHABLE, TIMEOUT, TLS, NOT_HTTPS, IO }

    sealed interface Result {
        data class Response(val code: Int, val body: String, val contentType: String?) : Result
        data class Error(val failure: Failure, val detail: String?) : Result
    }

    private const val MAX_BODY = 4 * 1024 * 1024

    /**
     * GET [url] (https only, no redirect following). [withCookies] attaches the
     * WebView's cookies for that URL, i.e. the web session.
     */
    suspend fun get(url: String, withCookies: Boolean, timeoutMs: Int = 15_000): Result {
        if (!url.startsWith("https://")) return Result.Error(Failure.NOT_HTTPS, null)
        val cookie = if (withCookies) webViewCookie(url) else null
        // First computation of the WebView user agent happens on the main thread.
        val userAgent = withContext(Dispatchers.Main) { Shell.userAgent }
        return withContext(Dispatchers.IO) { fetch(url, cookie, userAgent, timeoutMs) }
    }

    /** The WebView session cookie header for [url] (main thread for CookieManager). */
    suspend fun webViewCookie(url: String): String? = withContext(Dispatchers.Main) {
        try {
            CookieManager.getInstance().getCookie(url)?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    private fun fetch(url: String, cookie: String?, userAgent: String, timeoutMs: Int): Result {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                instanceFollowRedirects = false
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                useCaches = false
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-cache")
                setRequestProperty("User-Agent", userAgent)
                if (cookie != null) setRequestProperty("Cookie", cookie)
            }
            val code = conn.responseCode
            val stream = if (code >= 400) conn.errorStream else conn.inputStream
            val body = stream?.use { input ->
                val out = ByteArrayOutputStream()
                val buf = ByteArray(8192)
                var total = 0
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    total += n
                    if (total > MAX_BODY) throw IOException("response too large")
                    out.write(buf, 0, n)
                }
                out.toString(Charsets.UTF_8.name())
            }.orEmpty()
            Result.Response(code, body, conn.contentType)
        } catch (e: UnknownHostException) {
            Result.Error(Failure.UNREACHABLE, e.message)
        } catch (e: SocketTimeoutException) {
            Result.Error(Failure.TIMEOUT, e.message)
        } catch (e: SSLException) {
            Result.Error(Failure.TLS, e.message)
        } catch (e: java.net.ConnectException) {
            Result.Error(Failure.UNREACHABLE, e.message)
        } catch (e: IOException) {
            Result.Error(Failure.IO, e.message)
        } catch (e: RuntimeException) {
            Result.Error(Failure.IO, e.message)
        } finally {
            conn?.disconnect()
        }
    }
}
