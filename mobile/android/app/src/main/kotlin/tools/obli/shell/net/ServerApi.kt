package tools.obli.shell.net

import tools.obli.shell.Shell
import tools.obli.shell.nav.ServerMeta
import tools.obli.shell.nav.SsoConfig

/** The server endpoints the shell itself calls (the web client does the rest). */
object ServerApi {
    sealed interface SetupCheck {
        data class Ok(val sso: SsoConfig) : SetupCheck
        data class Unreachable(val failure: Http.Failure) : SetupCheck
        data class HttpStatus(val code: Int) : SetupCheck
        data object NotObli : SetupCheck
    }

    /** Validates a candidate server: GET /api/auth/sso-config must answer Obli JSON. */
    suspend fun checkServer(serverUrl: String): SetupCheck =
        when (val r = Http.get("$serverUrl/api/auth/sso-config", withCookies = false, timeoutMs = 12_000)) {
            is Http.Result.Error -> SetupCheck.Unreachable(r.failure)
            is Http.Result.Response -> when {
                r.code != 200 -> SetupCheck.HttpStatus(r.code)
                else -> ServerMeta.parseSsoConfig(r.body)?.let { SetupCheck.Ok(it) } ?: SetupCheck.NotObli
            }
        }

    /** Refreshes the cached Obligate origin (silently keeps the old one on failure). */
    suspend fun refreshSsoConfig(serverUrl: String) {
        val check = checkServer(serverUrl)
        if (check is SetupCheck.Ok && Shell.prefs.serverUrl == serverUrl) {
            Shell.prefs.obligateOrigin = check.sso.obligateOrigin
        }
    }

    /**
     * Refreshes the linked Obli apps from /api/oblitools/manifest (needs the
     * web session; a 401 simply leaves the cache as it is).
     */
    suspend fun refreshLinkedApps(serverUrl: String): Boolean {
        val r = Http.get("$serverUrl/api/oblitools/manifest", withCookies = true)
        if (r !is Http.Result.Response || r.code != 200) return false
        val map = ServerMeta.parseLinkedApps(r.body, Shell.knownAppIds) ?: return false
        if (Shell.prefs.serverUrl == serverUrl) Shell.prefs.linkedApps = map
        return true
    }
}
