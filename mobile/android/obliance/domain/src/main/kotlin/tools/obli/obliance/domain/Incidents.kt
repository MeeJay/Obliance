package tools.obli.obliance.domain

import tools.obli.shell.alerts.LiveAlert

/**
 * An incident is one device + one alert kind that has a recovery counterpart
 * on the server (0.3.1 server contract S2): metric thresholds (« Alerte » /
 * « Critique »), offline (« Hors ligne »), disk health (« santé disque … ») and
 * duplicate agent id (« ID agent dupliqué », resolved when the flag clears).
 * Every alert of an incident has the same [key], whatever its severity: a
 * warning that turns critical, or a new occurrence after a recovery, REPLACES
 * the previous alert of the incident (on the server, since 0.3.1, the previous
 * row is resolved; on the phone, the previous notification goes).
 *
 * Key: `device:<id>:<kind>`, with kind `metric`, `offline`, `diskhealth` or
 * `duplicate_agent_id` (liveAlert.service.ts INCIDENT_KEY_SUFFIXES).
 * Read from the row's stable key (`device:211:metric:warning` and
 * `device:211:metric:critical` are the SAME incident); for a row without one,
 * from its device (`navigateTo` = `/devices/:id`) and its title category.
 * Anything else (« retour à la normale » rows of an older server, alerts
 * without a device) has no incident key and is never replaced.
 */
object Incidents {
    const val METRIC = "metric"
    const val OFFLINE = "offline"
    const val DISK_HEALTH = "diskhealth"
    const val DUPLICATE_AGENT_ID = "duplicate_agent_id"

    private val stable = Regex("^device:(\\d{1,15}):(metric|offline|diskhealth|duplicate_agent_id)(?::[A-Za-z0-9_-]{1,32})?$")
    private val devicePath = Regex("^/devices/(\\d{1,15})/?(?:[?#].*)?$")

    /** The incident of [alert], or null when it has none. */
    fun key(alert: LiveAlert): String? {
        alert.stableKey?.trim()?.let { raw ->
            stable.matchEntire(raw)?.let { m -> return of(m.groupValues[1].toLong(), m.groupValues[2]) }
        }
        return key(deviceIdOf(alert.navigateTo), AlertClassifier.category(alert.title))
    }

    /** The incident of a device alert of [category] (a stored notification), or null. */
    fun key(deviceId: Long?, category: AlertCategory?): String? {
        if (deviceId == null) return null
        val kind = when (category) {
            AlertCategory.METRIC -> METRIC
            AlertCategory.OFFLINE -> OFFLINE
            AlertCategory.DISK_HEALTH -> DISK_HEALTH
            AlertCategory.IDENTITY -> DUPLICATE_AGENT_ID
            else -> return null
        }
        return of(deviceId, kind)
    }

    /** [key] from a stored [AlertCategory] name (unknown or null name: no incident). */
    fun key(deviceId: Long?, categoryName: String?): String? =
        key(deviceId, AlertCategory.entries.firstOrNull { it.name == categoryName })

    private fun of(deviceId: Long, kind: String) = "device:$deviceId:$kind"

    /** `/devices/:id` (relative path, as the server writes `navigateTo`) → the id. */
    internal fun deviceIdOf(navigateTo: String?): Long? =
        navigateTo?.trim()?.let(devicePath::matchEntire)?.groupValues?.get(1)?.toLongOrNull()
}
