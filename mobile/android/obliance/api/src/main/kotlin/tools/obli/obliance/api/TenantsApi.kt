package tools.obli.obliance.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp

/** The master tenant (shared MASTER_TENANT_ID): "Default · Vue globale". */
const val MASTER_TENANT_ID: Long = 1L

/**
 * One tenant (shared/src/types.ts `Tenant` / `TenantWithRole`). Platform admins
 * get every tenant without [role]; other users get theirs with 'admin' | 'member'.
 */
@Serializable
data class Tenant(
    val id: Long,
    val name: String = "",
    val slug: String = "",
    val twoStepApproval: Boolean = false,
    val role: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
) {
    val isMaster: Boolean get() = id == MASTER_TENANT_ID
}

/** `POST /api/tenant/switch` → `data`. */
@Serializable
data class TenantSwitched(val currentTenantId: Long? = null)

/** `GET /api/tenants/locate-device/:id` → `data` (404 when missing OR not accessible). */
@Serializable
data class DeviceLocation(
    val deviceId: Long,
    val hostname: String = "",
    val displayName: String? = null,
    val tenantId: Long? = null,
    val tenantName: String? = null,
    val tenantSlug: String? = null,
    val currentTenantId: Long? = null,
) {
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: hostname
}

/** Tenant calls of ONE server (server/src/routes/tenant.routes.ts). */
class TenantsApi(private val http: ObliHttp) {
    /** `GET /api/tenants`: admin → all tenants, others → their tenants with their role. */
    suspend fun list(): ApiOutcome<List<Tenant>> =
        http.call(ObliHttp.Method.GET, "/api/tenants", decode = ApiJson.unwrapped(ListSerializer(Tenant.serializer())))

    /**
     * `POST /api/tenant/switch {tenantId}`: changes the SESSION tenant (native
     * calls, web view and socket share it). The socket joined its rooms at
     * connection time: the caller must reconnect it afterwards.
     */
    suspend fun switchTo(tenantId: Long): ApiOutcome<TenantSwitched> =
        http.call(
            ObliHttp.Method.POST,
            "/api/tenant/switch",
            ApiJson.body("tenantId" to tenantId),
            decode = ApiJson.unwrapped(TenantSwitched.serializer()),
        )

    suspend fun locateDevice(deviceId: Long): ApiOutcome<DeviceLocation> =
        http.call(ObliHttp.Method.GET, "/api/tenants/locate-device/$deviceId", decode = ApiJson.unwrapped(DeviceLocation.serializer()))
}
