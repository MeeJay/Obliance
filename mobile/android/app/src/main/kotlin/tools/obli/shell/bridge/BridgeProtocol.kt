package tools.obli.shell.bridge

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import tools.obli.shell.core.Jsons

/**
 * Wire format of the web <-> native bridge (docs/obli-mobile.md §3,
 * bridgeVersion 1). Transport: WebViewCompat.addWebMessageListener, object
 * `__obliBridge`.
 *
 *   request  {"id": <number>, "method": "<name>", "params": {...} | [...]}
 *   response {"id": <number>, "ok": true,  "result": <json>}
 *            {"id": <number>, "ok": false, "error": "<message>"}
 *
 * `params` may be an object with named keys (what the injected ObliNative
 * wrapper sends) or an array in the documented positional order.
 */
object BridgeProtocol {
    const val BRIDGE_VERSION = 1
    const val JS_OBJECT_NAME = "__obliBridge"

    /** Largest message accepted (a base64 saveFile payload is the big one). */
    const val MAX_MESSAGE_CHARS = 64 * 1024 * 1024

    /** Method name -> positional parameter names. */
    val METHODS: Map<String, List<String>> = linkedMapOf(
        "saveFile" to listOf("filename", "mime", "base64"),
        "downloadUrl" to listOf("url", "filename"),
        "openExternal" to listOf("url"),
        "copyText" to listOf("text"),
        "readClipboard" to emptyList(),
        "share" to listOf("text", "title"),
        "notify" to listOf("title", "body", "navigateTo"),
        "openSettings" to emptyList(),
        "setSystemBars" to listOf("colorHex", "lightTheme"),
        "requestNotificationPermission" to emptyList(),
        "checkForUpdate" to listOf("prompt"),
        "getInfo" to emptyList(),
    )

    /** Advertised in window.__obli_native.capabilities (contract §2). */
    val CAPABILITIES = listOf(
        "saveFile", "downloadUrl", "openExternal", "clipboard", "share",
        "notify", "settings", "back", "systemBars", "update",
    )

    sealed interface Parsed {
        data class Ok(val request: BridgeRequest) : Parsed
        /** [id] is null when the message is too broken to answer. */
        data class Error(val id: Long?, val message: String) : Parsed
    }

    fun parse(raw: String?): Parsed {
        if (raw == null) return Parsed.Error(null, "empty message")
        if (raw.length > MAX_MESSAGE_CHARS) return Parsed.Error(null, "message too large")
        val obj = Jsons.parseObject(raw) ?: return Parsed.Error(null, "message is not a JSON object")
        val idElement = obj["id"] as? JsonPrimitive
        val id = idElement?.takeIf { !it.isString }?.content?.toLongOrNull()
            ?: return Parsed.Error(null, "missing numeric id")
        val method = (obj["method"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: return Parsed.Error(id, "missing method")
        val names = METHODS[method] ?: return Parsed.Error(id, "unknown method: $method")
        val params = when (val p = obj["params"]) {
            null, is JsonNull -> BridgeParams(JsonObject(emptyMap()))
            is JsonObject -> BridgeParams(p)
            is JsonArray -> {
                if (p.size > names.size) return Parsed.Error(id, "too many params for $method")
                BridgeParams(JsonObject(names.zip(p).toMap()))
            }
            else -> return Parsed.Error(id, "params must be an object or an array")
        }
        return Parsed.Ok(BridgeRequest(id, method, params))
    }

    fun success(id: Long, result: JsonElement): String = buildJsonObject {
        put("id", id)
        put("ok", true)
        put("result", result)
    }.toString()

    fun failure(id: Long, error: String): String = buildJsonObject {
        put("id", id)
        put("ok", false)
        put("error", error)
    }.toString()
}

data class BridgeRequest(val id: Long, val method: String, val params: BridgeParams)

/** Thrown for any invalid parameter; its message is sent back to the page. */
class BridgeParamException(message: String) : IllegalArgumentException(message)

/** Typed, validated access to request parameters. */
class BridgeParams(private val values: JsonObject) {
    private fun primitive(name: String): JsonPrimitive? {
        val e = values[name] ?: return null
        if (e is JsonNull) return null
        return e as? JsonPrimitive ?: throw BridgeParamException("$name must be a primitive")
    }

    fun string(name: String, maxLength: Int, allowEmpty: Boolean = false): String {
        val p = primitive(name) ?: throw BridgeParamException("$name is required")
        if (!p.isString) throw BridgeParamException("$name must be a string")
        val s = p.content
        if (!allowEmpty && s.isEmpty()) throw BridgeParamException("$name must not be empty")
        if (s.length > maxLength) throw BridgeParamException("$name is too long (max $maxLength)")
        return s
    }

    fun optString(name: String, maxLength: Int): String? {
        val p = primitive(name) ?: return null
        if (!p.isString) throw BridgeParamException("$name must be a string")
        if (p.content.length > maxLength) throw BridgeParamException("$name is too long (max $maxLength)")
        return p.content.takeIf { it.isNotEmpty() }
    }

    fun bool(name: String, default: Boolean): Boolean = optBool(name) ?: default

    /** null when absent (or JSON null); a non-boolean is an error. */
    fun optBool(name: String): Boolean? {
        val p = primitive(name) ?: return null
        if (p.isString) throw BridgeParamException("$name must be a boolean")
        return p.booleanOrNull ?: throw BridgeParamException("$name must be a boolean")
    }
}
