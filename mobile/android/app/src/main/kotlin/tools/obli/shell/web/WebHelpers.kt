package tools.obli.shell.web

/**
 * Pure helpers for the WebView layer (file chooser types, Content-Disposition,
 * WebView version, system bar icon contrast). Unit-tested.
 */

/** What the file chooser intent should ask for. */
data class ChooserTypes(val mimeType: String, val extraMimeTypes: List<String>)

object FileChooserTypes {
    /**
     * `accept` values from `<input type=file accept=...>`. Extension-only
     * entries (".msi", ".json") have no reliable MIME type on Android, and a
     * MIME filter would grey those files out: any extension (or an empty
     * accept) therefore means "* / *" with no filter at all.
     */
    fun resolve(acceptTypes: Array<String>?): ChooserTypes {
        val tokens = acceptTypes.orEmpty()
            .flatMap { it.split(',') }
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
        if (tokens.isEmpty() || tokens.any { !it.contains('/') }) return ChooserTypes("*/*", emptyList())
        val mimes = tokens.distinct()
        if (mimes.contains("*/*")) return ChooserTypes("*/*", emptyList())
        return if (mimes.size == 1) ChooserTypes(mimes[0], emptyList()) else ChooserTypes("*/*", mimes)
    }
}

object ContentDisposition {
    private val FILENAME_STAR = Regex("""filename\*\s*=\s*([^']*)'[^']*'([^;]+)""", RegexOption.IGNORE_CASE)
    private val FILENAME_QUOTED = Regex("""filename\s*=\s*"((?:\\.|[^"\\])*)"""", RegexOption.IGNORE_CASE)
    private val FILENAME_TOKEN = Regex("""filename\s*=\s*([^;"\s]+)""", RegexOption.IGNORE_CASE)

    /**
     * File name from a Content-Disposition header: RFC 5987 `filename*` first
     * (UTF-8 percent-encoded), then `filename="..."`, then a bare token. Only
     * the last path segment is kept. Null when absent.
     */
    fun filename(header: String?): String? {
        if (header.isNullOrBlank()) return null
        val star = FILENAME_STAR.find(header)
        val name = if (star != null) {
            val charset = star.groupValues[1].trim().ifEmpty { "UTF-8" }
            percentDecode(star.groupValues[2].trim(), charset)
        } else {
            FILENAME_QUOTED.find(header)?.groupValues?.get(1)?.replace(Regex("""\\(.)"""), "$1")
                ?: FILENAME_TOKEN.find(header)?.groupValues?.get(1)
        }
        return name?.substringAfterLast('/')?.substringAfterLast('\\')?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun percentDecode(s: String, charset: String): String? = try {
        java.net.URLDecoder.decode(s.replace("+", "%2B"), charset)
    } catch (_: Exception) {
        null
    }
}

object WebViewVersion {
    /** Chromium WebView must be at least this major version. */
    const val MIN_MAJOR = 100

    /** "124.0.6367.54" -> 124; null when unparsable. */
    fun major(versionName: String?): Int? =
        versionName?.trim()?.takeWhile { it.isDigit() }?.takeIf { it.isNotEmpty() && it.length <= 6 }?.toInt()

    fun isTooOld(versionName: String?): Boolean {
        val major = major(versionName) ?: return true
        return major < MIN_MAJOR
    }
}

object SystemBarContrast {
    /**
     * Whether the system bar icons should be light (white) over [argb].
     *
     * The page states a preference ([requestedLightIcons]); it is honoured for
     * mid-tone colours only. Over a clearly dark background icons are always
     * light, over a clearly light one always dark, so a caller that got the
     * boolean backwards can never make the status bar unreadable.
     */
    fun lightIcons(argb: Int, requestedLightIcons: Boolean): Boolean {
        val l = relativeLuminance(argb)
        return when {
            l < 0.18 -> true
            l > 0.55 -> false
            else -> requestedLightIcons
        }
    }

    fun relativeLuminance(argb: Int): Double {
        fun channel(c: Int): Double {
            val s = c / 255.0
            return if (s <= 0.03928) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4)
        }
        val r = channel((argb shr 16) and 0xff)
        val g = channel((argb shr 8) and 0xff)
        val b = channel(argb and 0xff)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
}
