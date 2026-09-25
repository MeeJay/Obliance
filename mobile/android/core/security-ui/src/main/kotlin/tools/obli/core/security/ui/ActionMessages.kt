package tools.obli.core.security.ui

import android.content.res.Resources
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ForbiddenReason
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner

/** What an [ActionResult] tells the user, and how it looks (never a success tick for a 202). */
data class ActionMessage(val text: String, val kind: Kind) {
    enum class Kind { DONE, PENDING, FAILED }
}

/**
 * Clear messages for every [ActionResult] (design doc §7.6 "messages
 * clairs"): 403 capability, 409 legacy, 503 agent offline, network… A
 * cancelled action says nothing.
 */
object ActionMessages {
    /** [done] is the screen's own success text ("Redémarrage demandé"). Null for [ActionResult.Cancelled]. */
    fun describe(resources: Resources, result: ActionResult<*>, done: String): ActionMessage? = when (result) {
        is ActionResult.Done -> ActionMessage(done, ActionMessage.Kind.DONE)
        is ActionResult.AwaitingApproval -> ActionMessage(resources.getString(R.string.secui_result_pending), ActionMessage.Kind.PENDING)
        ActionResult.Cancelled -> null
        is ActionResult.Blocked -> ActionMessage(
            if (result.reason == ActionRunner.TENANT_SWITCH_FAILED) resources.getString(R.string.secui_result_switch_failed) else result.reason,
            ActionMessage.Kind.FAILED,
        )
        ActionResult.SessionExpired -> ActionMessage(resources.getString(R.string.secui_result_session), ActionMessage.Kind.FAILED)
        is ActionResult.Failed -> ActionMessage(failure(resources, result.outcome), ActionMessage.Kind.FAILED)
    }

    fun failure(resources: Resources, outcome: ApiOutcome<*>): String = when (outcome) {
        is ApiOutcome.Forbidden -> when (outcome.reason) {
            ForbiddenReason.CAPABILITY -> resources.getString(R.string.secui_result_capability, capabilityLabel(resources, outcome.capability))
            ForbiddenReason.NO_TOTP -> resources.getString(R.string.secui_result_no_totp)
            ForbiddenReason.NO_APPROVAL_PATH -> resources.getString(R.string.secui_result_no_approval_path)
            ForbiddenReason.OTHER -> resources.getString(R.string.secui_result_forbidden)
        }
        is ApiOutcome.Unsupported -> resources.getString(R.string.secui_result_unsupported)
        is ApiOutcome.AgentOffline -> resources.getString(R.string.secui_result_offline)
        is ApiOutcome.RateLimited -> outcome.retryAfterSec?.let { resources.getQuantityString(R.plurals.secui_result_rate_limited_in, it, it) }
            ?: resources.getString(R.string.secui_result_rate_limited)
        is ApiOutcome.Validation -> resources.getString(R.string.secui_result_validation)
        ApiOutcome.StepUpRejected -> resources.getString(R.string.secui_result_code_rejected)
        is ApiOutcome.StepUpRequired -> resources.getString(R.string.secui_result_code_rejected)
        is ApiOutcome.PrivacyLocked -> resources.getString(R.string.secui_result_privacy)
        ApiOutcome.SessionExpired -> resources.getString(R.string.secui_result_session)
        is ApiOutcome.Failure -> when (outcome.kind) {
            FailureKind.NETWORK -> resources.getString(R.string.secui_result_network)
            FailureKind.NOT_FOUND -> resources.getString(R.string.secui_result_not_found)
            FailureKind.SERVER -> resources.getString(R.string.secui_result_server, outcome.status ?: 500)
            FailureKind.NOT_JSON, FailureKind.CLIENT -> resources.getString(R.string.secui_result_unexpected)
        }
        is ApiOutcome.PendingApproval -> resources.getString(R.string.secui_result_pending)
        is ApiOutcome.Ok, is ApiOutcome.Accepted -> ""
    }

    /** Server capability id → its name in the permission sets ("power" → « Alimentation »); unknown ids as is. */
    fun capabilityLabel(resources: Resources, capability: String?): String = when (capability) {
        "power" -> resources.getString(R.string.secui_cap_power)
        "execute" -> resources.getString(R.string.secui_cap_execute)
        "remote" -> resources.getString(R.string.secui_cap_remote)
        "files" -> resources.getString(R.string.secui_cap_files)
        null, "" -> resources.getString(R.string.secui_cap_unknown)
        else -> capability
    }

    /** Privacy gate feature id → label of the S44 chips. */
    fun featureLabel(resources: Resources, feature: String): String = when (feature) {
        "scripts" -> resources.getString(R.string.secui_feature_scripts)
        "remote" -> resources.getString(R.string.secui_feature_remote)
        "processes" -> resources.getString(R.string.secui_feature_processes)
        "files" -> resources.getString(R.string.secui_feature_files)
        else -> feature
    }
}
