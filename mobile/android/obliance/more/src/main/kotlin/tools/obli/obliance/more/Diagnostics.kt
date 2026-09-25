package tools.obli.obliance.more

import tools.obli.shell.nav.Origins

/** One server line of the diagnostic: never its address. */
internal data class DiagnosticServer(
    val displayName: String,
    /** Its origin, used ONLY to mask it (and its host) wherever it would appear. */
    val origin: String,
    val oblianceVersion: String?,
    val auth: String,
    val active: Boolean,
)

internal data class DiagnosticInput(
    val appVersionName: String,
    val appVersionCode: Int,
    val androidRelease: String,
    val sdkInt: Int,
    val deviceModel: String,
    val servers: List<DiagnosticServer>,
    val socketState: String?,
    val lockState: String?,
    val extra: List<String>,
)

/**
 * S86 "Copier le diagnostic" (design doc §10.10): versions and states only.
 * Never cookies, tokens, tunnel URLs, origins or host names, nor alert texts:
 * the input carries none of them, and every line goes through [sanitize]
 * (a server named after its host, or an extra line from the app, is masked).
 */
internal object DiagnosticReport {
    const val HOST_MASK = "[host]"
    const val URL_MASK = "[url]"
    const val SECRET_MASK = "[redacted]"

    fun build(input: DiagnosticInput): String {
        val hosts = input.servers.flatMap { s -> listOfNotNull(s.origin, Origins.host(s.origin)) }.filter { it.isNotBlank() }.toSet()
        val lines = buildList {
            add("Obliance for Android ${input.appVersionName} (${input.appVersionCode})")
            add("Android ${input.androidRelease} (API ${input.sdkInt}) · ${input.deviceModel}")
            input.servers.forEachIndexed { i, s ->
                val name = safeName(s.displayName, hosts, i)
                val version = s.oblianceVersion?.let { "Obliance $it" } ?: "Obliance ?"
                add("Server ${i + 1}: $name · $version · ${s.auth}${if (s.active) " · active" else ""}")
            }
            input.socketState?.let { add("Realtime (active server): $it") }
            input.lockState?.let { add("App lock: $it") }
            input.extra.forEach { add(it) }
        }
        return lines.joinToString("\n") { sanitize(it, hosts) }
    }

    /** A display name that IS (or contains) an address becomes "Server N". */
    private fun safeName(name: String, hosts: Set<String>, index: Int): String {
        val trimmed = name.trim()
        val leaks = trimmed.isEmpty() || hosts.any { trimmed.contains(it, ignoreCase = true) } || HOST_LIKE.containsMatchIn(trimmed)
        return if (leaks) "Server ${index + 1}" else trimmed
    }

    /** Masks URLs, the servers' origins and hosts, host-like tokens and `key=value` secrets. */
    fun sanitize(line: String, hosts: Set<String>): String {
        var out = URL.replace(line, URL_MASK)
        hosts.sortedByDescending { it.length }.forEach { out = out.replace(it, HOST_MASK, ignoreCase = true) }
        out = SECRET.replace(out) { m -> "${m.groupValues[1]}=$SECRET_MASK" }
        out = HOST_LIKE.replace(out, HOST_MASK)
        return out
    }

    private val URL = Regex("""(?i)\b(?:https?|wss?)://\S+""")
    private val SECRET = Regex("""(?i)\b(connect\.sid|cookie|set-cookie|token|sessiontoken|session|auth|authorization|password|secret|key)\s*[=:]\s*\S+""")

    /** "obliance-prod.example.org", "10.0.0.152": a dotted name with a letter TLD, or an IPv4 address. */
    private val HOST_LIKE = Regex("""(?i)\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b""")
}
