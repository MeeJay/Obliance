package tools.obli.core.model

import kotlinx.serialization.Serializable

/** Local, stable identifier of a server profile (a UUID). Never the host: a
 *  profile keeps its id when its display name or colour changes. */
@Serializable
@JvmInline
value class ServerId(val value: String) {
    init {
        require(value.isNotBlank() && value.length <= 64) { "invalid server id" }
    }

    override fun toString(): String = value
}

/**
 * Identity colours of a server (design doc §8.2). A closed palette: none is close
 * to the brand red, to a status colour or to the info blue, so a server tile can
 * never be read as a state. Values are opaque ARGB.
 */
@Serializable
enum class ServerColor(val argb: Long) {
    VIOLET(0xFFA78BFA),
    TEAL(0xFF2DD4BF),
    FUCHSIA(0xFFE879F9),
    INDIGO(0xFF818CF8),
    CYAN(0xFF67E8F9),
    SAND(0xFFD6B98C),
    LAVENDER(0xFFC4B5FD),
    MINT(0xFF5EEAD4),
}

/** Which notifications of a server reach the phone. */
@Serializable
enum class NotifyScope { ALL, CRITICAL_ONLY, NONE }

/**
 * One configured Obli server (design doc §2.10, §10.3). [origin] is the
 * normalised `https://host[:port]` origin; two profiles never share one (the
 * cookie jar is keyed by host).
 */
@Serializable
data class ServerProfile(
    val id: ServerId,
    val origin: String,
    val displayName: String,
    val color: ServerColor,
    val monogram: String,
    val order: Int,
    val notify: NotifyScope = NotifyScope.ALL,
    val includeInTriage: Boolean = true,
    val lastTenantId: Long? = null,
)
