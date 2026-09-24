package tools.obli.shell.core

/** The WebView user agent: the platform default plus a stable, parseable suffix. */
object UserAgent {
    fun suffix(versionName: String, appId: String): String = "ObliShell/$versionName ($appId; Android)"

    fun build(defaultUserAgent: String, versionName: String, appId: String): String {
        val base = defaultUserAgent.trim()
        val tail = suffix(versionName, appId)
        return if (base.isEmpty()) tail else "$base $tail"
    }
}
