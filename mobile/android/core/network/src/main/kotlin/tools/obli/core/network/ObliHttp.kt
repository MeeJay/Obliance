package tools.obli.core.network

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import tools.obli.shell.nav.Origins

/**
 * The HTTP client of ONE server (design doc §10.4). Every call is resolved
 * against [origin] and refused otherwise: a path from an alert or a link can
 * never send the session cookie to another host. Never retries a POST.
 */
class ObliHttp(
    val origin: String,
    private val client: OkHttpClient,
) {
    init {
        require(Origins.of(origin) == origin) { "not a normalised origin: $origin" }
    }

    enum class Method { GET, POST, PUT, PATCH, DELETE }

    suspend fun <T> call(
        method: Method,
        path: String,
        body: JsonObject? = null,
        decode: (JsonElement?) -> T?,
    ): ApiOutcome<T> {
        val url = urlFor(path) ?: return ApiOutcome.Failure(null, FailureKind.CLIENT, "refused path")
        val requestBody = when {
            body != null -> body.toString().toRequestBody(JSON)
            method == Method.GET || method == Method.DELETE -> null
            else -> "{}".toRequestBody(JSON)
        }
        val request = Request.Builder()
            .url(url)
            .method(method.name, requestBody)
            .header("Accept", "application/json")
            .build()
        return try {
            client.newCall(request).await().use { r ->
                ApiResponses.classify(r.code, r.header("Content-Type"), r.body.string(), r.header("Retry-After"), decode)
            }
        } catch (e: IOException) {
            ApiResponses.network(e.javaClass.simpleName)
        }
    }

    suspend fun get(path: String): ApiOutcome<JsonElement?> = call(Method.GET, path) { ApiResponses.unwrap(it) ?: kotlinx.serialization.json.JsonNull }

    suspend fun post(path: String, body: JsonObject? = null): ApiOutcome<JsonElement?> =
        call(Method.POST, path, body) { ApiResponses.unwrap(it) ?: kotlinx.serialization.json.JsonNull }

    /** Absolute URL of a same-origin relative path, or null (protocol-relative, other host, control chars…). */
    fun urlFor(path: String): HttpUrl? = Origins.resolveRelativePath(origin, path)?.toHttpUrlOrNull()

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        /**
         * The single OkHttp client of the app: 10 s connect / 20 s read, the
         * app's User-Agent, the shared cookie jar (WebView CookieManager on Android).
         */
        fun defaultClient(cookieJar: CookieJar, userAgent: String): OkHttpClient =
            OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .callTimeout(60, TimeUnit.SECONDS)
                .retryOnConnectionFailure(false)
                .followRedirects(false)
                .cookieJar(cookieJar)
                .addNetworkInterceptor { chain ->
                    chain.proceed(chain.request().newBuilder().header("User-Agent", userAgent).build())
                }
                .build()
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWith(Result.failure(e))
        }

        override fun onResponse(call: Call, response: Response) {
            cont.resume(response)
        }
    })
}
