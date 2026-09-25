package tools.obli.obliance.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import tools.obli.core.network.ApiResponses

/**
 * The one JSON configuration of the Obliance DTOs. Tolerant on purpose: the
 * server evolves faster than the app (unknown keys are ignored), PostgreSQL
 * `numeric` / `bigint` columns may reach the client as strings ("15.9"), a
 * `null` where a default exists falls back to that default, and an unknown enum
 * value never breaks a whole list (statuses are kept as strings).
 */
object ApiJson {
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
        isLenient = true
    }

    /** Decodes [element] with [serializer], or null when absent or not the expected shape. */
    fun <T> decode(serializer: KSerializer<T>, element: JsonElement?): T? {
        if (element == null || element is JsonNull) return null
        return try {
            json.decodeFromJsonElement(serializer, element)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /** `{success, data}` / `{data}` envelope → payload decoded with [serializer]. */
    fun <T> unwrapped(serializer: KSerializer<T>): (JsonElement?) -> T? = { decode(serializer, ApiResponses.unwrap(it)) }

    /** For answers whose body does not matter (`{ok:true}`, `{success, message}`, 204). */
    val ignoreBody: (JsonElement?) -> Unit? = { Unit }

    /** Request body builder that drops null values. */
    fun body(vararg pairs: Pair<String, Any?>, extra: JsonObject? = null): JsonObject {
        val map = LinkedHashMap<String, JsonElement>()
        for ((k, v) in pairs) {
            when (v) {
                null -> Unit
                is JsonElement -> map[k] = v
                is String -> map[k] = JsonPrimitive(v)
                is Number -> map[k] = JsonPrimitive(v)
                is Boolean -> map[k] = JsonPrimitive(v)
                else -> map[k] = JsonPrimitive(v.toString())
            }
        }
        extra?.forEach { (k, v) -> map[k] = v }
        return JsonObject(map)
    }
}
