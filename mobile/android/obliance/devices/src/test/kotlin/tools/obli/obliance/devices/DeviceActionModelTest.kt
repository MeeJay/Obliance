package tools.obli.obliance.devices

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.security.Tier
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.sample.SampleData

class DeviceActionModelTest {
    private fun device(id: Long) = SampleData.devices.first { it.id == id }
    private val admin = ActContext(admin = true)
    private val member = ActContext(admin = false)

    @Test fun agentSupportsCommandMirrorsShared() {
        assertTrue(agentSupportsCommand("modern", "open_remote_tunnel"))
        assertTrue(agentSupportsCommand(null, "install_oblireach"))
        assertTrue(agentSupportsCommand("legacy", "reboot"))
        assertTrue(agentSupportsCommand("legacy", "enable_airgap"))
        assertFalse(agentSupportsCommand("legacy", "open_remote_tunnel"))
        assertFalse(agentSupportsCommand("legacy", "update_agent"))
    }

    @Test fun windowsOnlineAdminSeesEverythingEnabled() {
        val items = DeviceActions.items(device(187), admin)
        val kinds = items.map { it.kind }
        assertTrue(ActKind.TERMINAL_POWERSHELL in kinds && ActKind.TERMINAL_CMD in kinds)
        assertFalse(ActKind.TERMINAL_SSH in kinds)
        assertTrue(ActKind.ISOLATE in kinds)
        assertFalse(ActKind.RESTORE_NETWORK in kinds)
        assertTrue(items.all { it.enabled })
        assertEquals(ActGroup.entries.toList(), items.map { it.kind.group }.distinct())
    }

    @Test fun nonAdminNeverSeesIsolationNorKill() {
        val kinds = DeviceActions.items(device(187), member).map { it.kind }
        assertFalse(ActKind.ISOLATE in kinds)
        assertFalse(ActKind.RESTORE_NETWORK in kinds)
        assertFalse(ActKind.PROCESSES in kinds)
        assertTrue(ActKind.REBOOT in kinds)
    }

    @Test fun linuxGetsSsh() {
        val kinds = DeviceActions.items(device(15), admin).map { it.kind }
        assertTrue(ActKind.TERMINAL_SSH in kinds)
        assertFalse(ActKind.TERMINAL_POWERSHELL in kinds)
    }

    @Test fun offlineDisablesAgentActionsWithTheReason() {
        val items = DeviceActions.items(device(211), admin).associateBy { it.kind }
        assertEquals(Blocker.Unreachable(DeviceStatus.OFFLINE), items.getValue(ActKind.REBOOT).blocker)
        assertEquals(Blocker.Unreachable(DeviceStatus.OFFLINE), items.getValue(ActKind.TERMINAL_POWERSHELL).blocker)
        // Scripts queue for an offline device; the Services tab shows the last list.
        assertNull(items.getValue(ActKind.RUN_SCRIPT).blocker)
        assertNull(items.getValue(ActKind.SERVICES).blocker)
    }

    @Test fun legacyAgentDisablesRemoteButNotPower() {
        val items = DeviceActions.items(device(205), admin).associateBy { it.kind }
        assertEquals(Blocker.Legacy, items.getValue(ActKind.TERMINAL_POWERSHELL).blocker)
        assertEquals(Blocker.Legacy, items.getValue(ActKind.REACH).blocker)
        assertNull(items.getValue(ActKind.REBOOT).blocker)
        assertNull(items.getValue(ActKind.SCAN_ALL).blocker)
        assertNull(items.getValue(ActKind.ISOLATE).blocker)
    }

    @Test fun privacyMarksGatedItems() {
        val items = DeviceActions.items(device(198), admin).associateBy { it.kind }
        assertTrue(items.getValue(ActKind.RUN_SCRIPT).privacyLocked)
        assertTrue(items.getValue(ActKind.TERMINAL_SSH).privacyLocked)
        assertFalse(items.getValue(ActKind.REBOOT).privacyLocked)
    }

    @Test fun tiersFollowTheSafetyScale() {
        assertEquals(Tier.T0, DeviceActions.tier(ActKind.SCAN_ALL))
        assertEquals(Tier.T0, DeviceActions.tier(ActKind.PUSH_METRICS))
        assertEquals(Tier.T1, DeviceActions.tier(ActKind.RESTART_AGENT))
        assertEquals(Tier.T2, DeviceActions.tier(ActKind.REBOOT))
        assertEquals(Tier.T2, DeviceActions.tier(ActKind.SLEEP))
        assertEquals(Tier.T2, DeviceActions.tier(ActKind.ISOLATE))
        assertEquals(Tier.T3, DeviceActions.tier(ActKind.SHUTDOWN))
        assertEquals(Tier.T3, DeviceActions.tier(ActKind.RESTORE_NETWORK))
        assertEquals(Tier.T1, DeviceActions.serviceTier("restart_service"))
        assertEquals(Tier.T2, DeviceActions.serviceTier("stop_service"))
    }

    @Test fun barSlotsByState() {
        assertEquals(listOf(BarSlot.TERMINAL, BarSlot.SCRIPT, BarSlot.PROCESSES), barSlots(device(187)))
        assertEquals(listOf(BarSlot.TERMINAL, BarSlot.SCRIPT, BarSlot.SERVICES), barSlots(device(15)))
        assertEquals(listOf(BarSlot.SERVICES, BarSlot.TASKS), barSlots(device(211)))
        assertEquals(listOf(BarSlot.UNLOCK, BarSlot.SERVICES, BarSlot.TASKS), barSlots(device(198)))
        assertEquals(emptyList<BarSlot>(), barSlots(device(240)))
    }

    @Test fun serviceFilterPutsStoppedAutomaticFirst() {
        val auto = filterServices(SAMPLE_SERVICES, ServiceFilter.AUTO_STOPPED, "")
        assertEquals(listOf("Spooler"), auto.map { it.name })
        assertEquals("Spooler", filterServices(SAMPLE_SERVICES, ServiceFilter.ALL, "").first().name)
        assertEquals(listOf("Dnscache"), filterServices(SAMPLE_SERVICES, ServiceFilter.ALL, "dns").map { it.name })
    }

    @Test fun processSorts() {
        assertEquals("EBP.Compta.exe", sortProcesses(SAMPLE_PROCESSES, ProcessSort.CPU, "").first().name)
        assertEquals("chrome.exe", sortProcesses(SAMPLE_PROCESSES, ProcessSort.NAME, "").first().name)
        assertEquals(listOf(688L), sortProcesses(SAMPLE_PROCESSES, ProcessSort.CPU, "lsass").map { it.pid })
        assertTrue(DeviceActions.isCritical(SAMPLE_PROCESSES.first { it.pid == 688L }))
    }

    @Test fun taskFilters() {
        assertEquals(listOf("c-3"), filterTasks(SAMPLE_TASKS, TaskFilter.ACTIVE).map { it.id })
        assertEquals(listOf("c-1"), filterTasks(SAMPLE_TASKS, TaskFilter.FAILED).map { it.id })
    }
}
