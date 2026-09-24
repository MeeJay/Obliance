package tools.obli.shell.nav

import kotlinx.serialization.json.JsonObject
import tools.obli.shell.core.Jsons
import tools.obli.shell.core.arr
import tools.obli.shell.core.bool
import tools.obli.shell.core.str

/** What `GET /api/auth/sso-config` tells about Obligate. */
data class SsoConfig(val obligateOrigin: String?, val enabled: Boolean, val reachable: Boolean)

/**
 * Parsers of the two server answers the navigation policy depends on. Shapes
 * (server/src/routes/obligateCallback.routes.ts, oblitools.routes.ts):
 *
 *   /api/auth/sso-config   {success, data:{obligateUrl, obligateReachable, obligateEnabled}}
 *   /api/oblitools/manifest {success, data:{name, color, ssoPath, linkedApps:[{name,url,color}]}}
 */
object ServerMeta {
    /**
     * Returns null when [body] is not a JSON object that looks like an Obli
     * sso-config answer (used by the setup screen to validate a server).
     */
    fun parseSsoConfig(body: String?): SsoConfig? {
        val root = Jsons.parseObject(body) ?: return null
        val looksLikeObli = root.containsKey("success") || root.containsKey("data") || root.containsKey("obligateUrl")
        if (!looksLikeObli) return null
        val data: JsonObject = Jsons.unwrapData(root)
        val url = data.str("obligateUrl")?.trim()?.trimEnd('/')
        return SsoConfig(
            obligateOrigin = Origins.of(url),
            enabled = data.bool("obligateEnabled") ?: (url != null),
            reachable = data.bool("obligateReachable") ?: false,
        )
    }

    /**
     * Maps each linked app origin to its Obli app id (or null when unknown).
     * The id comes from `appType` when present, else from the app name
     * ("Obliview" -> obliview), else from the host name.
     */
    fun parseLinkedApps(body: String?, knownIds: List<String>): Map<String, String?>? {
        val root = Jsons.parseObject(body) ?: return null
        val data = Jsons.unwrapData(root)
        val list = data.arr("linkedApps") ?: return null
        val out = LinkedHashMap<String, String?>()
        for (item in list) {
            val app = item as? JsonObject ?: continue
            val url = app.str("url") ?: app.str("baseUrl") ?: continue
            val origin = Origins.of(url) ?: continue
            out[origin] = identify(app.str("appType"), app.str("name"), origin, knownIds)
        }
        return out
    }

    fun identify(appType: String?, name: String?, origin: String, knownIds: List<String>): String? {
        appType?.lowercase()?.trim()?.let { if (it in knownIds) return it }
        val n = name?.lowercase().orEmpty()
        knownIds.firstOrNull { n.contains(it) }?.let { return it }
        val host = Origins.host(origin).orEmpty()
        return knownIds.firstOrNull { host.contains(it) }
    }

    /** Compact persistence of the linked-app map: one "origin\tid" line each. */
    fun encodeLinkedApps(map: Map<String, String?>): String =
        map.entries.joinToString("\n") { (o, id) -> "$o\t${id.orEmpty()}" }

    fun decodeLinkedApps(raw: String?): Map<String, String?> {
        if (raw.isNullOrBlank()) return emptyMap()
        val out = LinkedHashMap<String, String?>()
        raw.lineSequence().forEach { line ->
            val origin = Origins.of(line.substringBefore('\t')) ?: return@forEach
            out[origin] = line.substringAfter('\t', "").takeIf { it.isNotBlank() }
        }
        return out
    }
}
