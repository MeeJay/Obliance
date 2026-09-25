package tools.obli.obliance.automations

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import tools.obli.core.security.Tier
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus

/**
 * One typed field of the S51 form, built from the script's parameter
 * definitions (shared `ScriptParameter`). Secrets are kept in memory only:
 * never written to the saved state, never logged, never prefilled from a
 * previous run.
 */
internal data class ParamField(
    val def: ScriptParameterDto,
    /** string / number / secret / select. */
    val text: String = "",
    val checked: Boolean = false,
    val selected: Set<String> = emptySet(),
) {
    val kind: ParamType get() = def.kind

    val isEmpty: Boolean
        get() = when (kind) {
            ParamType.BOOLEAN -> false
            ParamType.MULTISELECT -> selected.isEmpty()
            else -> text.isBlank()
        }

    /** Null when valid. */
    val problem: ParamProblem?
        get() = when {
            def.required && isEmpty -> ParamProblem.REQUIRED
            kind == ParamType.NUMBER && text.isNotBlank() && parseNumber(text) == null -> ParamProblem.NOT_A_NUMBER
            kind == ParamType.SELECT && text.isNotBlank() && def.options.isNotEmpty() && text !in def.options -> ParamProblem.NOT_AN_OPTION
            else -> null
        }

    /**
     * Value sent in `parameterValues[name]`. The agent substitutes
     * `{{PARAM_name}}` with Go's `%v` (agent/scripts.go `applyParameters`), so
     * a multi-select is sent as one comma-separated string (an array would
     * print as `[a b]`), a boolean as `true`/`false`, a number as a number.
     * Null = not sent (optional and empty).
     */
    fun wireValue(): JsonElement? = when (kind) {
        ParamType.BOOLEAN -> JsonPrimitive(checked)
        ParamType.NUMBER -> parseNumber(text)?.let { n -> if (n == Math.floor(n) && !n.isInfinite() && kotlin.math.abs(n) < 1e15) JsonPrimitive(n.toLong()) else JsonPrimitive(n) }
        ParamType.MULTISELECT -> selected.takeIf { it.isNotEmpty() }?.let { s -> JsonPrimitive(def.options.filter { it in s }.plus(s - def.options.toSet()).joinToString(",")) }
        else -> text.takeIf { it.isNotEmpty() }?.let { JsonPrimitive(it) }
    }

    /** "Âge minimum (jours) = 7" for the batch and output headers; secrets masked. Null when empty. */
    fun line(): ParamLine? = when (kind) {
        ParamType.BOOLEAN -> ParamLine(def.title, flag = checked)
        ParamType.SECRET -> if (text.isEmpty()) null else ParamLine(def.title, secret = true)
        ParamType.MULTISELECT -> selected.takeIf { it.isNotEmpty() }?.let { ParamLine(def.title, text = it.joinToString(", ")) }
        else -> text.takeIf { it.isNotBlank() }?.let { ParamLine(def.title, text = it) }
    }

    companion object {
        /** A field with the definition's default value (secrets start empty unless a default exists). */
        fun initial(def: ScriptParameterDto): ParamField {
            val d = def.defaultValue.orEmpty()
            return when (def.kind) {
                ParamType.BOOLEAN -> ParamField(def, checked = d.trim().lowercase() in TRUE)
                ParamType.MULTISELECT -> ParamField(def, selected = d.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet())
                else -> ParamField(def, text = d)
            }
        }

        /** Prefill from a previous run's `parameterValues` ("Relancer sur les échecs"); secrets are never copied. */
        fun prefilled(def: ScriptParameterDto, previous: JsonElement?): ParamField {
            val base = initial(def)
            val p = previous as? JsonPrimitive
            if (previous == null || previous is JsonNull || def.kind == ParamType.SECRET) return base
            return when (def.kind) {
                ParamType.BOOLEAN -> base.copy(checked = p?.booleanOrNull ?: (p?.content?.trim()?.lowercase() in TRUE))
                ParamType.MULTISELECT -> base.copy(
                    selected = when (previous) {
                        is JsonArray -> previous.mapNotNull { (it as? JsonPrimitive)?.content }.toSet()
                        else -> p?.content.orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()
                    },
                )
                else -> base.copy(text = p?.content ?: base.text)
            }
        }

        fun parseNumber(s: String): Double? = s.trim().replace(' ', ' ').replace(" ", "").replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() }

        private val TRUE = setOf("true", "1", "yes", "oui", "on")
    }
}

/** One "label = value" of a run's parameters (the UI words booleans and masks secrets). */
internal data class ParamLine(val label: String, val text: String? = null, val flag: Boolean? = null, val secret: Boolean = false)

internal enum class ParamProblem { REQUIRED, NOT_A_NUMBER, NOT_AN_OPTION }

/** `parameterValues` of `POST /api/scripts/:id/execute` (only the fields that have a value). */
internal fun List<ParamField>.toParameterValues(): JsonObject =
    JsonObject(mapNotNull { f -> f.wireValue()?.let { f.def.name to it } }.toMap())

/** Design doc §7.6: 1 device T1, 2 to 9 T2, 10 or more T3 (the host asks to type the count). */
internal fun tierForTargets(count: Int): Tier = when {
    count <= 1 -> Tier.T1
    count < 10 -> Tier.T2
    else -> Tier.T3
}

/** OS family of a device for a script `platform` ('windows' | 'macos' | 'linux' | 'freebsd' | 'all'). */
internal fun platformOf(device: Device): String? = when (device.osType?.lowercase()) {
    "windows" -> "windows"
    "macos", "darwin", "mac" -> "macos"
    "linux" -> "linux"
    "freebsd" -> "freebsd"
    else -> null
}

internal fun scriptRunsOn(scriptPlatform: String, device: Device): Boolean =
    scriptPlatform.isBlank() || scriptPlatform == "all" || platformOf(device)?.let { it == scriptPlatform } ?: true

/** S51 pre-checks, computed locally (design doc §5 S51 item 4). */
internal data class RunChecks(
    /** Devices the call will target (platform mismatch and non-approved devices removed). */
    val runnable: List<Device>,
    /** Removed: the script's platform does not match. */
    val platformSkipped: List<Device>,
    /** Removed: enrolment pending, suspended, uninstalling. */
    val notApproved: List<Device>,
    /** Kept; the execution waits for them and may time out. */
    val offline: List<Device>,
    val legacy: List<Device>,
    val privacy: List<Device>,
    /** Tenants of the runnable devices (id → name). */
    val tenants: Map<Long, String>,
) {
    /** The call is bound to ONE tenant (§7.7): a mixed selection is refused. */
    val mixedTenants: Boolean get() = tenants.size > 1

    /** The tenant the targets live in, when it is not the session tenant (switch first). */
    fun switchTo(sessionTenantId: Long?): Pair<Long, String>? =
        tenants.entries.singleOrNull()?.takeIf { sessionTenantId != null && it.key != sessionTenantId }?.let { it.key to it.value }

    val canRun: Boolean get() = runnable.isNotEmpty() && !mixedTenants

    val hasWarnings: Boolean get() = platformSkipped.isNotEmpty() || notApproved.isNotEmpty() || offline.isNotEmpty() || legacy.isNotEmpty() || privacy.isNotEmpty()

    companion object {
        fun of(scriptPlatform: String?, targets: List<Device>): RunChecks {
            val notApproved = targets.filter { !isApproved(it) }
            val approved = targets - notApproved.toSet()
            val skipped = if (scriptPlatform == null) emptyList() else approved.filter { !scriptRunsOn(scriptPlatform, it) }
            val runnable = approved - skipped.toSet()
            return RunChecks(
                runnable = runnable,
                platformSkipped = skipped,
                notApproved = notApproved,
                offline = runnable.filter { !it.statusKind.isConnected },
                legacy = runnable.filter { it.isLegacyAgent },
                privacy = runnable.filter { it.privacyModeEnabled },
                tenants = runnable.mapNotNull { d -> d.tenantId?.let { it to (d.tenantName ?: "#$it") } }.toMap(),
            )
        }

        private fun isApproved(d: Device): Boolean {
            if (d.approvalStatus != null && d.approvalStatus != "approved") return false
            return when (d.statusKind) {
                DeviceStatus.PENDING, DeviceStatus.SUSPENDED, DeviceStatus.PENDING_UNINSTALL -> false
                else -> true
            }
        }
    }
}
