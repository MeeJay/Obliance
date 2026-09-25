package tools.obli.obliance.fleet

import java.time.Instant
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DevicePage
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.data.sample.SampleData

/** 03:22 in Paris on the night of 25 September (design doc §4). */
internal val NIGHT_NOW: Long = Instant.parse("2026-09-25T01:22:00Z").toEpochMilli()

/**
 * The fleet of Obliance Prod as design doc §4 describes it (global view):
 * group health, full disks, update counts and the last 24 hours. Other
 * servers answer with their own small fleet. Records every call.
 */
internal class SampleFleetSource(
    var admin: Boolean = true,
    var summaryAnswer: ((ServerId) -> ApiOutcome<FleetSummary>)? = null,
) : FleetSource {
    val calls = mutableListOf<Pair<String, ServerId>>()

    override suspend fun summary(serverId: ServerId): ApiOutcome<FleetSummary> {
        calls += "summary" to serverId
        summaryAnswer?.let { return it(serverId) }
        return ApiOutcome.Ok(if (serverId == SampleData.PROD) SampleData.summary else FleetMapper.summaryOf(devicesOf(serverId)))
    }

    override suspend fun byPriority(serverId: ServerId, pageSize: Int): ApiOutcome<DevicePage> {
        calls += "devices" to serverId
        val list = devicesOf(serverId)
        return ApiOutcome.Ok(DevicePage(list.take(pageSize), list.size, 1, pageSize))
    }

    override suspend fun groupStats(serverId: ServerId): ApiOutcome<List<GroupStat>> {
        calls += "group-stats" to serverId
        return ApiOutcome.Ok(if (serverId == SampleData.PROD) PROD_GROUPS else emptyList())
    }

    override suspend fun diskSaturation(serverId: ServerId): ApiOutcome<DiskSaturation> {
        calls += "disk-saturated" to serverId
        return ApiOutcome.Ok(if (serverId == SampleData.PROD) PROD_DISKS else DiskSaturation())
    }

    override suspend fun updateStats(serverId: ServerId): ApiOutcome<UpdateStats> {
        calls += "updates" to serverId
        return ApiOutcome.Ok(UpdateStats(available = 61, critical = 9, important = 14))
    }

    override suspend fun hourly(serverId: ServerId): ApiOutcome<List<FleetHour>> {
        calls += "hourly" to serverId
        return ApiOutcome.Ok(if (serverId == SampleData.PROD) PROD_HOURS else emptyList())
    }

    override fun isPlatformAdmin(serverId: ServerId): Boolean = admin

    private fun devicesOf(serverId: ServerId): List<Device> =
        if (serverId == SampleData.PROD) SampleData.devices else SampleData.otherDevices[serverId].orEmpty()

    companion object {
        private fun group(
            id: Long, name: String, parent: Long?, tenant: Long, online: Int, offline: Int, warning: Int = 0, critical: Int = 0,
            extra: Int = 0, compliance: Double? = null, order: Int = 0,
        ) = GroupStat(
            groupId = id, groupName = name, parentId = parent, sortOrder = order, tenantId = tenant,
            tenantName = if (tenant == SampleData.ACME_TENANT) "ACME" else "Default",
            online = online, offline = offline, warning = warning, critical = critical,
            total = online + offline + warning + critical + extra, complianceScore = compliance,
        )

        /** ACME 248 devices (230 online, 1 critical, 3 warning, 14 offline) and Default 64 (§4 "Tenants"). */
        val PROD_GROUPS: List<GroupStat> = listOf(
            group(10, "Siège", null, SampleData.ACME_TENANT, 0, 0, compliance = 91.0),
            group(11, "Serveurs", 10, SampleData.ACME_TENANT, 1, 5, order = 0),
            group(12, "Comptabilité", 10, SampleData.ACME_TENANT, 146, 1, warning = 2, critical = 1, order = 1),
            group(13, "Direction", 10, SampleData.ACME_TENANT, 38, 1, warning = 1, order = 2),
            group(14, "Accueil", 10, SampleData.ACME_TENANT, 27, 3, order = 3),
            group(15, "Atelier", 10, SampleData.ACME_TENANT, 18, 4, order = 4),
            group(20, "Infra", null, SampleData.DEFAULT_TENANT, 0, 0),
            group(21, "Linux", 20, SampleData.DEFAULT_TENANT, 28, 1, warning = 1),
            group(22, "Stockage", 20, SampleData.DEFAULT_TENANT, 8, 1, warning = 1),
            group(23, "Virtualisation", 20, SampleData.DEFAULT_TENANT, 23, 0, extra = 1),
            // The "ungrouped" row of the server (group_id NULL → 0).
            GroupStat(groupId = 0, groupName = "Unknown", total = 0),
        )

        val PROD_DISKS = DiskSaturation(
            count = 2, threshold = 0,
            top = listOf(
                SaturatedDisk(15, "BOB01", null, 94, "/", 90),
                SaturatedDisk(30, "SRV-FILES01", null, 91, "E:", 90),
            ),
        )

        /** 24 hourly points up to 03:00 in Paris: busier during the day, 16 offline at night. */
        val PROD_HOURS: List<FleetHour> = (0 until 24).map { i ->
            val at = Instant.parse("2026-09-24T02:00:00Z").plusSeconds(i * 3600L)
            val hourParis = (i + 4) % 24
            val day = hourParis in 8..18
            val online = if (day) 303 - (i % 3) else 296 + ((i + 1) % 2)
            val offline = if (day) 9 + (i % 2) else 16 - ((i + 1) % 2)
            FleetHour(at.toString(), online + offline, online, offline)
        }
    }
}
