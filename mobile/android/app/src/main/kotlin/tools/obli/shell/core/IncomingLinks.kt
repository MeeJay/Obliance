package tools.obli.shell.core

/** Which link targets another app (or a notification) may open inside the shell. */
object IncomingLinks {
    /**
     * Pages of the web client, plus the SSO entry point another Obli app's
     * pill navigates to. API routes and the other /auth/ endpoints are refused:
     * an external intent must not be able to trigger server calls.
     */
    fun isAllowedPath(pathAndQuery: String): Boolean {
        val path = pathAndQuery.substringBefore('?').substringBefore('#')
        if (path == "/auth/sso-redirect") return true
        return !(path == "/api" || path.startsWith("/api/") || path == "/auth" || path.startsWith("/auth/"))
    }
}
