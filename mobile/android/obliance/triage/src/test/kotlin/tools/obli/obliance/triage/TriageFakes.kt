package tools.obli.obliance.triage

import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.obliance.api.Approval
import tools.obli.obliance.data.AlertsRepository
import tools.obli.obliance.data.AlertsSnapshot
import tools.obli.obliance.data.FeedStatus
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.ServerApproval
import tools.obli.obliance.data.ServerFeed
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices
import tools.obli.obliance.domain.ServerAlert
import tools.obli.shell.alerts.AlertSeverity
import tools.obli.shell.alerts.LiveAlert

/** 03:24 in Paris on the night of 25 September (design doc §4): the approval expires in 27 min. */
internal val NIGHT_NOW: Long = Instant.parse("2026-09-25T01:24:00Z").toEpochMilli()

/** Alerts repository with a settable snapshot that records every call (per server). */
internal class RecordingAlerts(initial: AlertsSnapshot) : AlertsRepository {
    val state = MutableStateFlow(initial)
    override val snapshot: StateFlow<AlertsSnapshot> = state
    val markedRead = mutableListOf<ServerAlert>()
    val deleted = mutableListOf<ServerAlert>()
    val markedAll = mutableListOf<ServerId>()
    val approved = mutableListOf<Pair<ServerApproval, JsonObject?>>()
    val denied = mutableListOf<Pair<ServerApproval, String?>>()
    var refreshes = 0

    /** Next answers of approve (consumed in order; then Ok). */
    val approveAnswers = ArrayDeque<ApiOutcome<Approval>>()

    override suspend fun refresh() {
        refreshes++
    }

    override suspend fun markRead(alert: ServerAlert): ApiOutcome<Unit> {
        markedRead += alert
        state.update { s -> s.copy(alerts = s.alerts.map { if (it == alert) it.copy(alert = it.alert.copy(readAt = "2026-09-25T01:20:00Z")) else it }) }
        return ApiOutcome.Ok(Unit)
    }

    override suspend fun delete(alert: ServerAlert): ApiOutcome<Unit> {
        deleted += alert
        state.update { s -> s.copy(alerts = s.alerts - alert) }
        return ApiOutcome.Ok(Unit)
    }

    override suspend fun markAllRead(serverId: ServerId): ApiOutcome<Unit> {
        markedAll += serverId
        return ApiOutcome.Ok(Unit)
    }

    override suspend fun approve(item: ServerApproval, reason: String?, extra: JsonObject?): ApiOutcome<Approval> {
        approved += item to extra
        val answer = approveAnswers.removeFirstOrNull() ?: ApiOutcome.Ok(item.approval.copy(status = "approved"))
        if (answer is ApiOutcome.Ok) state.update { s -> s.copy(escalations = s.escalations - item) }
        return answer
    }

    override suspend fun deny(item: ServerApproval, reason: String?, extra: JsonObject?): ApiOutcome<Approval> {
        denied += item to reason
        state.update { s -> s.copy(escalations = s.escalations - item) }
        return ApiOutcome.Ok(item.approval.copy(status = "denied"))
    }
}

/** The §4 sample services with a controllable alerts repository. */
internal class TestServices(
    val base: SampleObliServices = SampleObliServices(),
    snapshot: AlertsSnapshot = sampleSnapshot(base),
) : ObliServices by base {
    val recording = RecordingAlerts(snapshot)
    override val alerts: AlertsRepository get() = recording
}

internal fun sampleSnapshot(services: ObliServices): AlertsSnapshot = services.alerts.snapshot.value

internal fun feeds(vararg pairs: Pair<ServerId, FeedStatus>, updatedAt: Long? = NIGHT_NOW - 60_000) =
    pairs.map { (id, status) -> ServerFeed(id, status, if (status == FeedStatus.OK || status == FeedStatus.UNREACHABLE || status == FeedStatus.EXPIRED) updatedAt else null) }

/** An offline alert of a §4 device (used to build the site outage of 03:07–03:09). */
internal fun offlineAlert(id: Long, device: String, deviceId: Long, at: String, server: ServerId = SampleData.PROD, tenant: Long = SampleData.ACME_TENANT) =
    ServerAlert(
        server,
        LiveAlert(
            id = id, tenantId = tenant, tenantName = if (tenant == SampleData.ACME_TENANT) "ACME" else "Default",
            severity = AlertSeverity.WARNING, title = "$device: Hors ligne", message = "Aucun push reçu depuis 2 min.",
            navigateTo = "/devices/$deviceId", readAt = null, createdAt = at,
        ),
    )

internal val FAILURE: ApiOutcome<Nothing> = ApiOutcome.Failure(null, FailureKind.NETWORK)
