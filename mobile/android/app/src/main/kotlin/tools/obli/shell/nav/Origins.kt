package tools.obli.shell.nav

/**
 * Web origins (`scheme://host[:port]`) computed without android.net.Uri, so the
 * navigation policy is a plain JVM class. The format matches what
 * WebViewCompat.addWebMessageListener expects as an allowed-origin rule:
 * lowercase scheme and host, no default port, no trailing slash.
 */
object Origins {
    private val head = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):(//([^/?#\\\\]*))?")

    /** Lowercase scheme of [url] ("https", "mailto"...), or null. */
    fun scheme(url: String?): String? {
        if (url.isNullOrEmpty()) return null
        return head.find(url.trim())?.groupValues?.get(1)?.lowercase()
    }

    /** Origin of an http(s) URL, or null for anything else or a malformed URL. */
    fun of(url: String?): String? {
        if (url.isNullOrEmpty()) return null
        val m = head.find(url.trim()) ?: return null
        val scheme = m.groupValues[1].lowercase()
        if (scheme != "http" && scheme != "https") return null
        if (m.groups[2] == null) return null
        val authority = m.groupValues[3].substringAfterLast('@')
        if (authority.isEmpty()) return null

        val host: String
        val portText: String?
        if (authority.startsWith("[")) {
            val end = authority.indexOf(']')
            if (end < 0) return null
            host = authority.substring(0, end + 1).lowercase()
            val rest = authority.substring(end + 1)
            portText = when {
                rest.isEmpty() -> null
                rest.startsWith(":") -> rest.substring(1)
                else -> return null
            }
        } else {
            val colon = authority.lastIndexOf(':')
            if (colon >= 0) {
                host = authority.substring(0, colon).lowercase()
                portText = authority.substring(colon + 1)
            } else {
                host = authority.lowercase()
                portText = null
            }
            if (host.isEmpty() || host.any { !(it.isLetterOrDigit() || it == '.' || it == '-' || it == '_') }) return null
        }

        val port: Int? = when {
            portText.isNullOrEmpty() -> null
            portText.all { it.isDigit() } && portText.length <= 5 -> portText.toInt().takeIf { it in 1..65535 } ?: return null
            else -> return null
        }
        val defaultPort = if (scheme == "https") 443 else 80
        val portPart = if (port == null || port == defaultPort) "" else ":$port"
        return "$scheme://$host$portPart"
    }

    /** Host part of an origin or URL, for display. */
    fun host(url: String?): String? {
        val origin = of(url) ?: return null
        return origin.substringAfter("://").let { h ->
            if (h.startsWith("[")) h.substringBefore(']') + "]" else h.substringBefore(':')
        }
    }

    fun sameOrigin(a: String?, b: String?): Boolean {
        val oa = of(a) ?: return false
        return oa == of(b)
    }

    /**
     * Resolves a same-origin relative path ("/devices/12?tab=x") against
     * [origin]. Protocol-relative ("//evil"), backslashes and control characters
     * are refused. Returns null when [path] is not an acceptable relative path.
     */
    fun resolveRelativePath(origin: String, path: String?): String? {
        if (path.isNullOrEmpty() || path.length > 4096) return null
        if (!path.startsWith("/") || path.startsWith("//")) return null
        if (path.any { it == '\\' || it.isISOControl() || it.isWhitespace() }) return null
        val url = origin + path
        return if (of(url) == origin) url else null
    }
}
