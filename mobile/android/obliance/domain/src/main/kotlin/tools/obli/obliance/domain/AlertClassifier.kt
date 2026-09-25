package tools.obli.obliance.domain

import tools.obli.shell.alerts.AlertSeverity
import tools.obli.shell.alerts.LiveAlert

/** Category of a live alert, deduced from the server title until the server sends
 *  a `category` field (design doc §5 S10, server change S1). */
enum class AlertCategory { OFFLINE, METRIC, DISK_HEALTH, RECOVERY, IDENTITY, OTHER }

/** Quick action offered on an incident card (one per card, 48 dp). */
enum class QuickAction { WATCH, PROCESSES, SCRIPTS, DISKS }

/** What the app knows about the device an alert is about, when it knows it. */
data class DeviceHints(
    /** OS name contains "Server" (Windows Server) or the device is a known server. */
    val isServer: Boolean = false,
    /** The user asked to be told when this device changes ("Surveiller"). */
    val isWatched: Boolean = false,
    /** Metric named by the alert message, when it is CPU or RAM. */
    val cpuOrRam: Boolean = false,
)

data class AlertClassification(
    val category: AlertCategory,
    /** Lower is more urgent: 0 critical, 1 offline server/watched, 2 warning, 3 rest. */
    val rank: Int,
    /** Device name as written by the server (text before the category suffix). */
    val deviceName: String?,
    val quickAction: QuickAction?,
    /** Whether the alert may ring at night (the server sends workstation "offline" as info). */
    val wakesUp: Boolean,
)

/**
 * Rules of design doc §5 S10 "Priorité calculée":
 * server critical > offline of a server (or of a watched device), even when the
 * server sent it as `info` > warning > the rest. An `info` offline of a
 * workstation stays at the bottom and never wakes anyone.
 */
object AlertClassifier {
    private val suffixes = listOf(
        ": santé disque revenue à la normale" to AlertCategory.RECOVERY,
        ": santé disque" to AlertCategory.DISK_HEALTH,
        ": De retour en ligne" to AlertCategory.RECOVERY,
        ": retour à la normale" to AlertCategory.RECOVERY,
        ": Hors ligne" to AlertCategory.OFFLINE,
        ": Critique" to AlertCategory.METRIC,
        ": Alerte" to AlertCategory.METRIC,
        ": ID agent dupliqué" to AlertCategory.IDENTITY,
    )

    fun category(title: String): AlertCategory = split(title).second

    fun classify(alert: LiveAlert, hints: DeviceHints = DeviceHints()): AlertClassification {
        val (device, category) = split(alert.title)
        val rank = when {
            category == AlertCategory.RECOVERY -> 3
            alert.severity == AlertSeverity.CRITICAL -> 0
            category == AlertCategory.OFFLINE && (hints.isServer || hints.isWatched) -> 1
            alert.severity == AlertSeverity.WARNING -> 2
            else -> 3
        }
        val quick = when (category) {
            AlertCategory.OFFLINE -> QuickAction.WATCH
            AlertCategory.METRIC -> if (hints.cpuOrRam || mentionsCpuOrRam(alert.message)) QuickAction.PROCESSES else QuickAction.SCRIPTS
            AlertCategory.DISK_HEALTH -> QuickAction.DISKS
            else -> null
        }
        return AlertClassification(category, rank, device, quick, wakesUp = rank <= 1)
    }

    private fun split(title: String): Pair<String?, AlertCategory> {
        for ((suffix, category) in suffixes) {
            val at = title.indexOf(suffix, ignoreCase = true)
            if (at > 0) return title.substring(0, at).trim() to category
        }
        return null to AlertCategory.OTHER
    }

    private fun mentionsCpuOrRam(message: String): Boolean =
        Regex("\\b(CPU|RAM|mémoire|memory)\\b", RegexOption.IGNORE_CASE).containsMatchIn(message)
}
