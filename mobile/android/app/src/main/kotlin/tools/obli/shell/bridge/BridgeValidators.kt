package tools.obli.shell.bridge

import tools.obli.shell.nav.Origins

/**
 * Validation and sanitising of everything the page sends to native code.
 * Pure Kotlin (unit-tested); every failure is a [BridgeParamException].
 */
object BridgeValidators {
    const val MAX_FILENAME = 150
    const val MAX_TEXT_COPY = 1_000_000
    const val MAX_TEXT_SHARE = 100_000
    const val MAX_TITLE = 200
    const val MAX_BODY = 2_000
    const val MAX_URL = 8_192

    /** Largest base64 payload of saveFile, in characters (~36 MB decoded). */
    const val MAX_BASE64_CHARS = 48 * 1024 * 1024

    const val DEFAULT_MIME = "application/octet-stream"

    private val FORBIDDEN_FILENAME_CHARS = setOf('/', '\\', ':', '*', '?', '"', '<', '>', '|')
    private val MIME = Regex("^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$")
    private val HEX_COLOR = Regex("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")

    /**
     * A display name safe for MediaStore / the Downloads folder: no path
     * separators, no reserved or control characters, no leading dots, at most
     * [MAX_FILENAME] characters (the extension is kept when shortening).
     */
    fun filename(raw: String?): String {
        val cleaned = raw.orEmpty()
            .map { c -> if (c.isISOControl() || c in FORBIDDEN_FILENAME_CHARS) '_' else c }
            .joinToString("")
            .trim()
            .trimStart('.', ' ')
            .trimEnd('.', ' ')
        if (cleaned.isEmpty() || cleaned.all { it == '_' }) throw BridgeParamException("filename is not usable")
        if (cleaned.length <= MAX_FILENAME) return cleaned
        val dot = cleaned.lastIndexOf('.')
        val ext = if (dot > 0 && cleaned.length - dot <= 16) cleaned.substring(dot) else ""
        return cleaned.substring(0, MAX_FILENAME - ext.length).trimEnd('.', ' ') + ext
    }

    /** A plain `type/subtype` (parameters dropped, lowercased), or the default. */
    fun mime(raw: String?): String {
        val base = raw.orEmpty().substringBefore(';').trim().lowercase()
        return if (MIME.matches(base)) base else DEFAULT_MIME
    }

    /**
     * Decodes a saveFile payload. A `data:<mime>;base64,` prefix and
     * whitespace are tolerated; anything else that is not base64 is refused.
     */
    fun base64Payload(raw: String?): ByteArray {
        if (raw.isNullOrEmpty()) throw BridgeParamException("base64 is required")
        if (raw.length > MAX_BASE64_CHARS) throw BridgeParamException("file is too large")
        var s = raw
        if (s.startsWith("data:")) {
            val comma = s.indexOf(',')
            if (comma < 0 || !s.substring(0, comma).endsWith(";base64")) throw BridgeParamException("base64 is not valid")
            s = s.substring(comma + 1)
        }
        s = s.filterNot { it.isWhitespace() }
        return try {
            java.util.Base64.getDecoder().decode(s)
        } catch (_: IllegalArgumentException) {
            throw BridgeParamException("base64 is not valid")
        }
    }

    /** #rgb, #rrggbb or #aarrggbb -> opaque-by-default ARGB int. */
    fun color(raw: String?): Int {
        val s = raw?.trim().orEmpty()
        if (!HEX_COLOR.matches(s)) throw BridgeParamException("colorHex must be #rgb, #rrggbb or #aarrggbb")
        val hex = s.substring(1)
        val argb = when (hex.length) {
            3 -> "ff" + hex.map { "$it$it" }.joinToString("")
            6 -> "ff$hex"
            else -> hex
        }
        return argb.toLong(16).toInt()
    }

    /** openExternal: http(s), mailto:, tel:, otpauth: only. */
    fun externalUrl(raw: String?): String {
        val url = raw?.trim().orEmpty()
        if (url.isEmpty() || url.length > MAX_URL) throw BridgeParamException("url is required")
        return when (Origins.scheme(url)) {
            "http", "https" -> if (Origins.of(url) != null) url else throw BridgeParamException("url is not valid")
            "mailto", "tel", "otpauth" -> url
            else -> throw BridgeParamException("url scheme not allowed")
        }
    }

    /**
     * downloadUrl: a relative path ("/api/...") or an absolute URL whose origin
     * is exactly [serverOrigin]. Returns the absolute URL.
     */
    fun sameOriginUrl(raw: String?, serverOrigin: String): String {
        val url = raw?.trim().orEmpty()
        if (url.isEmpty() || url.length > MAX_URL) throw BridgeParamException("url is required")
        if (url.startsWith("/")) {
            return Origins.resolveRelativePath(serverOrigin, url)
                ?: throw BridgeParamException("url must be a same-origin path")
        }
        if (url.any { it.isWhitespace() || it.isISOControl() }) throw BridgeParamException("url is not valid")
        if (Origins.of(url) != serverOrigin) throw BridgeParamException("url must be same-origin")
        return url
    }

    /** notify / alert taps: only same-origin relative paths; anything else is dropped. */
    fun navigateTo(raw: String?, serverOrigin: String): String? =
        raw?.trim()?.let { Origins.resolveRelativePath(serverOrigin, it) }
}
