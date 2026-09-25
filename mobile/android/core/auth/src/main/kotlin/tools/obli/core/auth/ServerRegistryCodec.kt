package tools.obli.core.auth

import kotlinx.serialization.json.Json

/** JSON form of the registry for any [ServerRegistryStore] (versioned, tolerant). */
object ServerRegistryCodec {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; coerceInputValues = true }

    fun encode(state: ServerRegistryState): String = json.encodeToString(ServerRegistryState.serializer(), state)

    fun decode(text: String?): ServerRegistryState? {
        if (text.isNullOrBlank()) return null
        return try {
            json.decodeFromString(ServerRegistryState.serializer(), text)
        } catch (_: Exception) {
            null
        }
    }
}
