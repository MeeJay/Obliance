package tools.obli.obliance.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerSession
import tools.obli.core.network.ApiOutcome
import tools.obli.core.security.ActionEndpoints
import tools.obli.core.security.PrivacyUnlockResult

/**
 * [ActionEndpoints] of THIS server (and [deviceId] for S44), to put in an
 * `ActionSpec(endpoints = …)`: S43 "Annuler la demande"
 * (`POST /api/approvals/:id/cancel`) and S44 unlock
 * (`POST /api/devices/:id/privacy/unlock {password, feature}`).
 */
fun ServerSession.actionEndpoints(deviceId: Long? = null): ActionEndpoints = SessionActionEndpoints(this, deviceId)

private class SessionActionEndpoints(private val session: ServerSession, private val deviceId: Long?) : ActionEndpoints {
    override suspend fun cancelApproval(approvalId: Long): ApiOutcome<Unit> =
        when (val out = session.http.post("/api/approvals/$approvalId/cancel")) {
            is ApiOutcome.Ok, is ApiOutcome.Accepted -> ApiOutcome.Ok(Unit)
            ApiOutcome.SessionExpired -> ApiOutcome.SessionExpired.also { session.markExpired() }
            else -> @Suppress("UNCHECKED_CAST") (out as ApiOutcome<Unit>)
        }

    override suspend fun unlockPrivacy(feature: String, password: String): PrivacyUnlockResult {
        val id = deviceId ?: return PrivacyUnlockResult.Failed(ApiOutcome.Validation("no device", emptyMap()))
        val body: JsonObject = buildJsonObject {
            put("password", JsonPrimitive(password))
            put("feature", JsonPrimitive(feature))
        }
        return when (val out = session.http.post("/api/devices/$id/privacy/unlock", body)) {
            is ApiOutcome.Ok -> PrivacyUnlockResult.Unlocked(
                ((out.value as? JsonObject)?.get("ttlSeconds")?.jsonPrimitive?.intOrNull) ?: DEFAULT_TTL,
            )
            // The route answers 401 "Incorrect password": tell it from a lost session with /me.
            ApiOutcome.SessionExpired -> if (session.probe() is AuthState.SignedIn) {
                PrivacyUnlockResult.WrongPassword
            } else {
                session.markExpired()
                PrivacyUnlockResult.SessionExpired
            }
            is ApiOutcome.Validation -> if (out.message.contains("no privacy password", ignoreCase = true)) {
                PrivacyUnlockResult.NoPasswordSet
            } else {
                PrivacyUnlockResult.Failed(out)
            }
            is ApiOutcome.RateLimited -> PrivacyUnlockResult.TooManyAttempts
            is ApiOutcome.AgentOffline -> PrivacyUnlockResult.DeviceOffline
            is ApiOutcome.Accepted -> PrivacyUnlockResult.Unlocked(DEFAULT_TTL)
            is ApiOutcome.PendingApproval -> PrivacyUnlockResult.Failed(out)
            is ApiOutcome.StepUpRequired -> PrivacyUnlockResult.Failed(out)
            ApiOutcome.StepUpRejected -> PrivacyUnlockResult.WrongPassword
            is ApiOutcome.PrivacyLocked -> PrivacyUnlockResult.Failed(out)
            is ApiOutcome.Unsupported -> PrivacyUnlockResult.Failed(out)
            is ApiOutcome.Forbidden -> PrivacyUnlockResult.Failed(out)
            is ApiOutcome.Failure -> PrivacyUnlockResult.Failed(out)
        }
    }

    companion object {
        /** privacyGate.service.ts UNLOCK_TTL_MS. */
        const val DEFAULT_TTL = 900
    }
}
