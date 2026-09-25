package tools.obli.obliance.devices

import tools.obli.core.security.Tier
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceStatus

// ---------------------------------------------------------------------------
// Legacy agent (shared/src/types.ts LEGACY_AGENT_COMMANDS / agentSupportsCommand)
// ---------------------------------------------------------------------------

/** Commands the legacy Go 1.20 agent (Server 2008 R2 / 2012) can execute: copy of shared LEGACY_AGENT_COMMANDS. */
internal val LEGACY_AGENT_COMMANDS: Set<String> = setOf(
    "run_script", "cancel_script", "restart_agent", "scan_inventory", "reboot", "shutdown", "sleep",
    "list_processes", "kill_process", "list_services", "restart_service", "start_service", "stop_service",
    "list_directory", "create_directory", "rename_file", "delete_file", "check_compliance", "scan_updates",
    "install_update", "install_updates", "uninstall_agent", "list_wts_sessions", "disable_privacy_mode",
    "enable_airgap", "disable_airgap",
)

/** Port of shared `agentSupportsCommand`: modern (and unknown) agents run everything. */
internal fun agentSupportsCommand(flavor: String?, command: String): Boolean =
    flavor != "legacy" || command in LEGACY_AGENT_COMMANDS

internal fun Device.supports(command: String): Boolean = agentSupportsCommand(agentFlavor, command)

// ---------------------------------------------------------------------------
// S40 items
// ---------------------------------------------------------------------------

/** The groups of S40, in order. */
internal enum class ActGroup { REPAIR, ACCESS, ANALYSE, POWER, SENSITIVE }

/**
 * Every item of the S40 sheet. [commands]: the agent commands it needs (legacy
 * check); [capability]: the team capability the server checks for non-admins
 * (command.routes.ts), used to learn a 403; [privacyFeature]: the privacy gate
 * feature (privacyGate.service.ts) that may ask for an unlock (S44).
 */
internal enum class ActKind(
    val group: ActGroup,
    val commands: List<String> = emptyList(),
    val capability: String? = null,
    val privacyFeature: String? = null,
    val needsAgent: Boolean = true,
) {
    RUN_SCRIPT(ActGroup.REPAIR, listOf("run_script"), "execute", "scripts", needsAgent = false),
    SERVICES(ActGroup.REPAIR, listOf("list_services"), "execute", needsAgent = false),
    PROCESSES(ActGroup.REPAIR, listOf("list_processes"), privacyFeature = "processes"),
    RESTART_AGENT(ActGroup.REPAIR, listOf("restart_agent"), "power"),
    TERMINAL_POWERSHELL(ActGroup.ACCESS, listOf("open_remote_tunnel"), "remote", "remote"),
    TERMINAL_CMD(ActGroup.ACCESS, listOf("open_remote_tunnel"), "remote", "remote"),
    TERMINAL_SSH(ActGroup.ACCESS, listOf("open_remote_tunnel"), "remote", "remote"),
    REACH(ActGroup.ACCESS, listOf("open_remote_tunnel"), "remote", "remote"),
    AUTOMATIONS(ActGroup.ACCESS, needsAgent = false),
    SCAN_ALL(ActGroup.ANALYSE, listOf("scan_inventory", "scan_updates", "check_compliance"), "execute"),
    PUSH_METRICS(ActGroup.ANALYSE),
    REBOOT(ActGroup.POWER, listOf("reboot"), "power"),
    SLEEP(ActGroup.POWER, listOf("sleep"), "power"),
    SHUTDOWN(ActGroup.POWER, listOf("shutdown"), "power"),
    ISOLATE(ActGroup.SENSITIVE, listOf("enable_airgap")),
    RESTORE_NETWORK(ActGroup.SENSITIVE, listOf("disable_airgap")),
}

/** Why an item is shown disabled (S40 "affiché désactivé avec la raison"). */
internal sealed interface Blocker {
    /** Agent not reachable: offline, awaiting enrolment, suspended, uninstalling. */
    data class Unreachable(val status: DeviceStatus) : Blocker

    /** 409 legacy: the legacy agent cannot run it. */
    data object Legacy : Blocker

    /** A 403 capability was learned for this device during this visit. */
    data class Refused(val capability: String) : Blocker
}

internal data class ActItem(
    val kind: ActKind,
    val blocker: Blocker? = null,
    /** Privacy mode: the call may ask to unlock (S44) first. */
    val privacyLocked: Boolean = false,
) {
    val enabled: Boolean get() = blocker == null
}

/** What the role and the platform allow, beyond the device's own state. */
internal data class ActContext(
    /** Platform admin (`role === 'admin'`): network isolation and kill are admin-only in the web client. */
    val admin: Boolean,
    /** Capabilities refused by the server (403) for this device during this visit. */
    val refused: Set<String> = emptySet(),
)

internal object DeviceActions {
    /** isAgentReachable of the web (online, warning, critical) plus the states where the agent still answers. */
    fun reachable(status: DeviceStatus): Boolean = when (status) {
        DeviceStatus.OFFLINE, DeviceStatus.PENDING, DeviceStatus.SUSPENDED, DeviceStatus.PENDING_UNINSTALL -> false
        else -> true
    }

    val DeviceWindows: (Device) -> Boolean = { it.osType.equals("windows", ignoreCase = true) }

    /**
     * The S40 items of [device], in sheet order. Items the role can never do,
     * or that make no sense for the OS, are left out; the others carry their
     * [Blocker] when the state forbids them now.
     */
    fun items(device: Device, ctx: ActContext): List<ActItem> {
        val windows = DeviceWindows(device)
        val status = device.statusKind
        return ActKind.entries.mapNotNull { kind ->
            val visible = when (kind) {
                ActKind.TERMINAL_POWERSHELL, ActKind.TERMINAL_CMD -> windows
                ActKind.TERMINAL_SSH -> !windows
                // client DeviceDetailPage: the airgap toggle is `hidden: !isAdmin()`, and only one of the two shows.
                ActKind.ISOLATE -> ctx.admin && !device.airgapEnabled
                ActKind.RESTORE_NETWORK -> ctx.admin && device.airgapEnabled
                // ProcessesTab: `killable = isAdmin() && …`; the tab itself stays for everyone.
                ActKind.PROCESSES -> ctx.admin
                else -> true
            }
            if (!visible) return@mapNotNull null
            val blocker = when {
                kind.needsAgent && !reachable(status) -> Blocker.Unreachable(status)
                kind.commands.any { !device.supports(it) } -> Blocker.Legacy
                kind.capability != null && kind.capability in ctx.refused -> Blocker.Refused(kind.capability)
                else -> null
            }
            ActItem(kind, blocker, privacyLocked = device.privacyModeEnabled && kind.privacyFeature != null)
        }
    }

    /** Design doc §7.6. */
    fun tier(kind: ActKind): Tier = when (kind) {
        ActKind.RESTART_AGENT -> Tier.T1
        ActKind.REBOOT, ActKind.SLEEP, ActKind.ISOLATE -> Tier.T2
        ActKind.SHUTDOWN, ActKind.RESTORE_NETWORK -> Tier.T3
        else -> Tier.T0
    }

    /** Process names whose kill is T2 with a stability warning (§5 S33). */
    val CRITICAL_PROCESSES = setOf("lsass.exe", "csrss.exe", "wininit.exe", "services.exe", "winlogon.exe", "smss.exe", "systemd", "init", "sshd")

    fun isCritical(process: ProcessInfo): Boolean = process.name.lowercase() in CRITICAL_PROCESSES || process.pid == 1L

    fun killTier(process: ProcessInfo): Tier = if (isCritical(process)) Tier.T2 else Tier.T1

    /** Start / restart T1, stop T2 (§5 S32, §7.6). */
    fun serviceTier(type: String): Tier = if (type == "stop_service") Tier.T2 else Tier.T1
}

/** One bottom bar slot (§5 S30 item 8), "Agir" always last. */
internal enum class BarSlot { TERMINAL, SCRIPT, PROCESSES, SERVICES, TASKS, UNLOCK }

/** Slots 1–3 by state (§5 S30 table); pending enrolment keeps only "Agir" (S12 lives in À traiter). */
internal fun barSlots(device: Device): List<BarSlot> {
    val status = device.statusKind
    return when {
        status == DeviceStatus.PENDING -> emptyList()
        device.privacyModeEnabled && DeviceActions.reachable(status) -> listOf(BarSlot.UNLOCK, BarSlot.SERVICES, BarSlot.TASKS)
        !DeviceActions.reachable(status) -> listOf(BarSlot.SERVICES, BarSlot.TASKS)
        DeviceActions.DeviceWindows(device) -> listOf(BarSlot.TERMINAL, BarSlot.SCRIPT, BarSlot.PROCESSES)
        else -> listOf(BarSlot.TERMINAL, BarSlot.SCRIPT, BarSlot.SERVICES)
    }
}

/** Tabs of the device detail in this increment (§5 S30 item 7). */
internal enum class DeviceTab(val route: String) {
    OVERVIEW("overview"),
    SERVICES("services"),
    PROCESSES("processes"),
    TASKS("tasks"),
    ;

    companion object {
        /** The tab named by a route (DeviceDetailScreen `initialTab`); unknown or null = Aperçu. */
        fun fromRoute(route: String?): DeviceTab = entries.firstOrNull { it.route == route?.trim()?.lowercase() } ?: OVERVIEW
    }
}
