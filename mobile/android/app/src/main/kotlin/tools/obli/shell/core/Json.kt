package tools.obli.shell.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Tiny helpers over the kotlinx JsonElement tree. Pure Kotlin on purpose: every
 * parser of this app (server answers, bridge messages) runs in JVM unit tests.
 */
object Jsons {
    private val lenient = Json { ignoreUnknownKeys = true }

    /** Parses [raw] into a JSON object, or null when it is not one. */
    fun parseObject(raw: String?): JsonObject? {
        if (raw.isNullOrBlank()) return null
        return try {
            lenient.parseToJsonElement(raw) as? JsonObject
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Obli servers answer either `{ success, data: {...} }` or the bare object.
     * Returns the payload object in both cases.
     */
    fun unwrapData(obj: JsonObject): JsonObject {
        val data = obj["data"]
        return if (data is JsonObject) data else obj
    }
}

/** String value of a JSON primitive (not of a JSON string "null"), else null. */
fun JsonObject.str(key: String): String? {
    val e = this[key] ?: return null
    if (e is JsonNull || e !is JsonPrimitive || !e.isString) return null
    return e.content
}

/** Integer value, accepting ONLY JSON integer numbers (no strings, no fractions). */
fun JsonObject.strictLong(key: String): Long? {
    val e = this[key] ?: return null
    if (e is JsonNull || e !is JsonPrimitive || e.isString) return null
    if (e.content.contains('.') || e.content.contains('e') || e.content.contains('E')) return null
    return e.longOrNull
}

fun JsonObject.bool(key: String): Boolean? {
    val e = this[key] ?: return null
    if (e is JsonNull || e !is JsonPrimitive || e.isString) return null
    return e.booleanOrNull
}

fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray

fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

/** Quotes and escapes [value] as a JSON string literal (also valid JavaScript). */
fun jsonString(value: String): String = JsonPrimitive(value).toString()

fun JsonElement?.isNullish(): Boolean = this == null || this is JsonNull
