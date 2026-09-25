package tools.obli.obliance.data.sample

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import tools.obli.core.model.ObliUser
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.model.SessionProbe
import tools.obli.obliance.api.Approval
import tools.obli.obliance.api.CpuMetrics
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DiskMetrics
import tools.obli.obliance.api.FleetDeltas
import tools.obli.obliance.api.FleetSummary
import tools.obli.obliance.api.MemoryMetrics
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.data.ServerApproval
import tools.obli.obliance.domain.ServerAlert
import tools.obli.shell.alerts.AlertSeverity
import tools.obli.shell.alerts.LiveAlert

/**
 * The reference data set of design doc §4 (servers Obliance Prod / Dev / Qual,
 * tenants Default and ACME, the night of 25 September 2026). Times are UTC
 * (03:12 in Paris = 01:12Z). The ONLY data allowed in previews, screenshot
 * tests and docs: never invent other names.
 */
object SampleData {
    val PROD = ServerId("sample-obliance-prod")
    val DEV = ServerId("sample-obliance-dev")
    val QUAL = ServerId("sample-obliance-qual")

    val profiles: List<ServerProfile> = listOf(
        ServerProfile(PROD, "https://obliance-prod.example.org", "Obliance Prod", ServerColor.VIOLET, "OP", 0),
        ServerProfile(DEV, "https://obliance-dev.example.org", "Obliance Dev", ServerColor.TEAL, "OD", 1),
        ServerProfile(QUAL, "https://obliance-qual.example.org", "Obliance Qual", ServerColor.FUCHSIA, "OQ", 2),
    )

    val karimSso = ObliUser(
        id = 3, username = "og_karim.benali", displayName = "Karim Benali", role = "admin",
        preferredLanguage = "fr", foreignSource = "obligate",
    )
    val karimLocal = ObliUser(
        id = 7, username = "karim.benali", displayName = "Karim Benali", role = "user",
        preferredLanguage = "fr", totpEnabled = true,
    )

    fun probe(server: ServerId): SessionProbe =
        SessionProbe(user = if (server == QUAL) karimLocal else karimSso, currentTenantId = DEFAULT_TENANT)

    const val DEFAULT_TENANT = 1L
    const val ACME_TENANT = 4L

    val tenants: List<Tenant> = listOf(
        Tenant(DEFAULT_TENANT, "Default", "default"),
        Tenant(ACME_TENANT, "ACME", "acme", twoStepApproval = true),
    )

    private fun alert(id: Long, tenant: Long, severity: AlertSeverity, title: String, message: String, device: Long, at: String, readAt: String? = null) =
        LiveAlert(
            id = id,
            tenantId = tenant,
            tenantName = if (tenant == ACME_TENANT) "ACME" else "Default",
            severity = severity,
            title = title,
            message = message,
            navigateTo = "/devices/$device",
            readAt = readAt,
            createdAt = at,
        )

    val alerts: List<ServerAlert> = listOf(
        ServerAlert(PROD, alert(9812, ACME_TENANT, AlertSeverity.CRITICAL, "SRV-AD2: Hors ligne", "Aucun push reçu depuis 4 min.", 211, "2026-09-25T01:12:04Z")),
        ServerAlert(PROD, alert(9807, ACME_TENANT, AlertSeverity.CRITICAL, "PC-COMPTA-03: Critique", "CPU 98 % (seuil 90 %)", 187, "2026-09-25T01:05:31Z")),
        ServerAlert(QUAL, alert(512, DEFAULT_TENANT, AlertSeverity.CRITICAL, "SRV-QUAL01: Hors ligne", "Aucun push reçu depuis 5 min.", 5, "2026-09-25T00:58:00Z")),
        ServerAlert(PROD, alert(9790, DEFAULT_TENANT, AlertSeverity.WARNING, "BOB01: Alerte", "Disque / 94 % (seuil 90 %)", 15, "2026-09-25T00:47:10Z")),
        ServerAlert(DEV, alert(301, DEFAULT_TENANT, AlertSeverity.WARNING, "NAS-DEV01: Alerte", "Disque /volume1 91 % (seuil 90 %)", 20, "2026-09-24T23:50:00Z")),
        ServerAlert(PROD, alert(9760, DEFAULT_TENANT, AlertSeverity.WARNING, "SRV-FILES01: santé disque à surveiller", "Disque 1 : 5 secteurs réalloués", 30, "2026-09-24T23:30:00Z")),
        ServerAlert(PROD, alert(9741, DEFAULT_TENANT, AlertSeverity.INFO, "140: De retour en ligne", "", 140, "2026-09-24T22:58:40Z")),
    )

    val escalations: List<ServerApproval> = listOf(
        ServerApproval(
            PROD,
            Approval(
                id = 17, tenantId = ACME_TENANT, requestedBy = 12, requestedByName = "og_julien.moreau",
                requestType = "device_uninstall", description = "Désinstaller l'agent de PC-ATELIER-02",
                payload = buildJsonObject { put("deviceId", JsonPrimitive(233)) },
                status = "pending", createdAt = "2026-09-25T01:21:08Z", expiresAt = "2026-09-25T01:51:08Z",
            ),
        ),
    )

    private fun metrics(cpu: Double, ram: Double, mount: String, disk: Double, totalGb: Double) = DeviceMetrics(
        cpu = CpuMetrics(percent = cpu),
        memory = MemoryMetrics(percent = ram),
        disks = listOf(DiskMetrics(mount = mount, percent = disk, totalGb = totalGb, usedGb = totalGb * disk / 100)),
        updatedAt = "2026-09-25T01:06:00Z",
    )

    private fun device(
        id: Long, name: String, tenant: Long, group: String, osType: String, os: String, ip: String, status: String,
        metrics: DeviceMetrics? = null, lastSeen: String = "2026-09-25T01:10:00Z", agent: String = "4.5.79",
    ) = Device(
        id = id, tenantId = tenant, tenantName = if (tenant == ACME_TENANT) "ACME" else "Default", groupName = group,
        hostname = name, ipLocal = ip, osType = osType, osName = os, agentVersion = agent, status = status,
        approvalStatus = if (status == "pending") "pending" else "approved", lastSeenAt = lastSeen, latestMetrics = metrics,
    )

    /** Obliance Prod devices (§4 "Appareils"). */
    val devices: List<Device> = listOf(
        device(211, "SRV-AD2", ACME_TENANT, "Serveurs", "windows", "Windows Server 2022 Standard", "10.0.0.12", "offline", lastSeen = "2026-09-25T01:08:00Z"),
        device(187, "PC-COMPTA-03", ACME_TENANT, "Comptabilité", "windows", "Windows 11 Pro", "10.0.12.43", "critical", metrics(98.0, 71.7, "C:", 42.3, 476.3))
            .copy(rebootPending = true, lastLoggedInUser = "SIEGE\\m.durand"),
        device(185, "PC-COMPTA-01", ACME_TENANT, "Comptabilité", "windows", "Windows 11 Pro", "10.0.12.41", "online", metrics(12.0, 48.0, "C:", 38.0, 476.3)),
        device(186, "PC-COMPTA-02", ACME_TENANT, "Comptabilité", "windows", "Windows 11 Pro", "10.0.12.42", "online", metrics(9.0, 44.0, "C:", 35.0, 476.3)),
        device(240, "KIOSK-ACCUEIL-02", ACME_TENANT, "Accueil", "windows", "Windows 11 IoT Enterprise", "10.0.3.41", "pending"),
        device(233, "PC-ATELIER-02", ACME_TENANT, "Atelier", "windows", "Windows 10 Pro", "10.0.14.22", "offline", lastSeen = "2026-09-22T07:40:00Z"),
        device(205, "SRV-LEGACY", ACME_TENANT, "Serveurs", "windows", "Windows Server 2008 R2", "10.0.0.30", "online", agent = "1.4.0")
            .copy(agentFlavor = "legacy"),
        device(198, "MAC-DIRECTION", ACME_TENANT, "Direction", "macos", "macOS 14.6 Sonoma", "10.0.12.20", "online", metrics(7.0, 52.0, "/", 61.0, 512.0))
            .copy(privacyModeEnabled = true, privacyPasswordSet = true),
        device(140, "140", DEFAULT_TENANT, "Linux", "linux", "Debian 12", "10.20.0.140", "online", metrics(4.0, 23.0, "/", 31.0, 100.0)),
        device(15, "BOB01", DEFAULT_TENANT, "Linux", "linux", "Ubuntu 22.04.4 LTS", "10.20.0.15", "warning", metrics(18.0, 40.0, "/", 94.0, 200.0), agent = "4.5.61"),
        device(30, "SRV-FILES01", DEFAULT_TENANT, "Stockage", "windows", "Windows Server 2019", "10.20.0.30", "warning", metrics(6.0, 37.0, "D:", 72.0, 4000.0)),
        device(10, "HV-01", DEFAULT_TENANT, "Virtualisation", "windows", "Windows Server 2022 Datacenter", "10.20.0.10", "online", metrics(22.0, 64.0, "C:", 48.0, 960.0)),
    )

    /** Devices of the other servers (§4). */
    val otherDevices: Map<ServerId, List<Device>> = mapOf(
        DEV to listOf(device(20, "NAS-DEV01", DEFAULT_TENANT, "", "linux", "Debian 12", "10.40.0.20", "warning", metrics(3.0, 18.0, "/volume1", 91.0, 8000.0)).copy(groupName = null)),
        QUAL to listOf(device(5, "SRV-QUAL01", DEFAULT_TENANT, "Serveurs", "windows", "Windows Server 2019", "192.168.10.5", "offline", lastSeen = "2026-09-25T00:53:00Z")),
    )

    /** Fleet totals of the global view (§4). */
    val summary = FleetSummary(
        total = 312, online = 289, offline = 16, warning = 5, critical = 1, updating = 1, pending = 3,
        pendingUpdates = 47, agentUpToDate = 293, agentOutdated = 19, latestAgentVersion = "4.5.79",
        activeRemoteSessions = 2, upcomingSchedules = 14, staleDevices = 5,
        deltas = FleetDeltas(totalVsYesterday = 3, offlineVsYesterday = 5, pendingUpdatesVsWeek = -12),
    )
}
