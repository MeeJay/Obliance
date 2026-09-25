package tools.obli.shell.net

import tools.obli.shell.nav.Origins

/**
 * Normalisation of the server address typed on the setup screen.
 *
 * Rules:
 *  - trimmed; `https://` is added when no scheme is given;
 *  - `http://` (and any other scheme) is refused: the Obli session cookie is
 *    `Secure` in production, so a cleartext server can never sign anyone in;
 *  - Obli apps are served at the root of their host (the web client uses
 *    absolute paths such as `/auth/sso-redirect`), so path, query and fragment
 *    are dropped: the normalised URL IS the origin, without a trailing slash.
 */
object ServerUrl {
    enum class Problem { EMPTY, NOT_HTTPS, MALFORMED, HAS_CREDENTIALS }

    sealed interface Result {
        data class Ok(val url: String) : Result
        data class Invalid(val problem: Problem) : Result
    }

    private val schemePrefix = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:")

    fun normalize(input: String?): Result {
        var s = input?.trim().orEmpty()
        if (s.isEmpty()) return Result.Invalid(Problem.EMPTY)
        if (s.any { it.isWhitespace() }) return Result.Invalid(Problem.MALFORMED)

        val lower = s.lowercase()
        when {
            lower.startsWith("https://") -> Unit
            lower.startsWith("http://") -> return Result.Invalid(Problem.NOT_HTTPS)
            // "host:8443" looks like a scheme to a naive parser: only treat the
            // prefix as a scheme when it is followed by "//" or is not a port.
            schemePrefix.containsMatchIn(lower) && !looksLikeHostPort(lower) ->
                return Result.Invalid(Problem.NOT_HTTPS)
            else -> s = "https://$s"
        }

        val authority = s.substring("https://".length).takeWhile { it != '/' && it != '?' && it != '#' }
        if (authority.isEmpty()) return Result.Invalid(Problem.MALFORMED)
        if (authority.contains('@')) return Result.Invalid(Problem.HAS_CREDENTIALS)
        val origin = Origins.of("https://$authority") ?: return Result.Invalid(Problem.MALFORMED)
        return Result.Ok(origin)
    }

    /** "example.com:8443" or "10.0.0.5:443/path" — host followed by a numeric port. */
    private fun looksLikeHostPort(s: String): Boolean =
        Regex("^[a-z0-9.-]+:\\d{1,5}(?:[/?#].*)?$").matches(s)
}
