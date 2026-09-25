package tools.obli.obliance.notifications

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerSession
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.model.SessionProbe
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.ObliHttp
import tools.obli.obliance.api.AlertsApi
import tools.obli.obliance.api.AlertsFeed
import tools.obli.obliance.api.ApiJson
import tools.obli.obliance.api.Approval
import tools.obli.obliance.api.ApprovalsApi
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.DevicesApi
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.domain.AlertCategory
import tools.obli.obliance.domain.AlertClassification
import tools.obli.obliance.domain.AlertClassifier
import tools.obli.obliance.domain.DeviceHints
import tools.obli.shell.alerts.AlertSeverity
import tools.obli.shell.alerts.LiveAlert
import tools.obli.shell.alerts.LiveAlerts

/** One process-wide lock: passes, reminders and receiver refreshes never interleave. */
internal object PassLock {
    val mutex = Mutex()
}

/** The background work the engine asks for (WorkManager in the app, recorded in tests). */
internal interface WorkScheduler {
    fun enqueuePeriodic()
    fun cancelPeriodic()
    fun checkNow()
    fun scheduleReminder(serverId: ServerId, alertId: Long, attempt: Int)
    fun cancelReminder(serverId: ServerId, alertId: Long)
    fun cancelReminders(serverId: ServerId)

    object None : WorkScheduler {
        override fun enqueuePeriodic() = Unit
        override fun cancelPeriodic() = Unit
        override fun checkNow() = Unit
        override fun scheduleReminder(serverId: ServerId, alertId: Long, attempt: Int) = Unit
        override fun cancelReminder(serverId: ServerId, alertId: Long) = Unit
        override fun cancelReminders(serverId: ServerId) = Unit
    }
}

internal data class ServerPassReport(val serverId: ServerId, val result: PassResult, val posted: Int = 0)

/**
 * One background pass over EVERY configured server (design doc §10.8), in
 * parallel, [serverTimeoutMs] each: a failing server never blocks or delays
 * the others. Each server is called through ITS OWN session (its cookie, its
 * origin) — never the hot `services.alerts` repository.
 *
 * Per server: skipped with no request at all when its notify scope is NONE
 * or the user signed out of it; `/api/auth/me` (expired → one "Session
 * expirée" notice; unreachable → nothing); live alerts above the high-water
 * mark (baseline first, never flood; the mark ALWAYS advances); escalations
 * for platform admins; enrolments with `agent_config:approval`; one group
 * summary. On-call, notify scope and "app in the foreground" decide what may
 * ring.
 */
internal class NotificationPass(
    private val services: ObliServices,
    private val store: NotificationStore,
    private val publisher: NotificationPublisher,
    private val clock: () -> Long = System::currentTimeMillis,
    private val isForeground: () -> Boolean = { false },
    private val texts: NotificationTexts,
    private val work: WorkScheduler = WorkScheduler.None,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val serverTimeoutMs: Long = SERVER_TIMEOUT_MS,
) {
    private val factory = NotificationFactory(texts)

    suspend fun run(): List<ServerPassReport> = PassLock.mutex.withLock { runLocked() }

    private suspend fun runLocked(): List<ServerPassReport> {
        val registry = services.registry.state.value
        val now = clock()
        if (registry.profiles.isNotEmpty()) {
            // State of a server removed while a pass was running goes too.
            val ids = registry.profiles.map { it.id.value }.toSet()
            store.update { st -> if (st.servers.keys.all { it in ids }) st else st.copy(servers = st.servers.filterKeys { it in ids }) }
        }
        val onCall = store.read().onCall
        val foreground = isForeground()
        return supervisorScope {
            registry.profiles.map { profile ->
                async {
                    try {
                        withTimeoutOrNull(serverTimeoutMs) {
                            ServerPass(profile, registry.isMultiServer, now, onCall, foreground).run()
                        } ?: unreachable(profile.id, now)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        unreachable(profile.id, now)
                    }
                }
            }.awaitAll()
        }
    }

    private suspend fun unreachable(id: ServerId, now: Long): ServerPassReport {
        store.updateServer(id) { it.copy(lastPass = unreachablePass(it.lastPass, now)) }
        return ServerPassReport(id, PassResult.UNREACHABLE)
    }

    private inner class ServerPass(
        private val profile: ServerProfile,
        private val multi: Boolean,
        private val now: Long,
        private val onCall: OnCallSettings,
        private val foreground: Boolean,
    ) {
        private val id = profile.id
        private val at: ZonedDateTime = Instant.ofEpochMilli(now).atZone(zone)
        private var postedCount = 0

        suspend fun run(): ServerPassReport {
            // 1. No request at all for a muted or signed-out server.
            if (profile.notify == NotifyScope.NONE) {
                store.updateServer(id) {
                    it.copy(alertsMark = null, approvalsMark = null, enrolmentsMark = null, lastNotify = NotifyScope.NONE, lastPass = LastPass(now, PassResult.SKIPPED))
                }
                return ServerPassReport(id, PassResult.SKIPPED)
            }
            val session = services.sessions.session(id) ?: return ServerPassReport(id, PassResult.SKIPPED)
            var state = store.read().server(id)
            if (state.signedOutByUser || session.auth.value == AuthState.SignedOut) {
                store.updateServer(id) { it.copy(lastPass = LastPass(now, PassResult.SKIPPED)) }
                return ServerPassReport(id, PassResult.SKIPPED)
            }
            if (state.lastNotify == NotifyScope.NONE) {
                // Back from "Aucune": baseline again, nothing old is notified.
                state = store.updateServer(id) {
                    it.copy(alertsMark = null, approvalsMark = null, enrolmentsMark = null, lastNotify = profile.notify)
                }.server(id)
            }

            // 2. Who is signed in (GET /api/auth/me).
            val probe: SessionProbe = when (val auth = session.probe()) {
                is AuthState.SignedIn -> auth.probe
                AuthState.Expired -> return expired(state)
                else -> return unreachable(id, now)
            }
            if (state.expiredNotified) {
                publisher.cancel(id, NotificationIds.expired(id))
                state = state.copy(expiredNotified = false)
            }

            // 3. Live alerts of every tenant of the user.
            val feed: AlertsFeed = when (val out = AlertsApi(session.http).all()) {
                is ApiOutcome.Ok -> out.value
                ApiOutcome.SessionExpired -> {
                    session.markExpired()
                    return expired(state)
                }
                else -> return unreachable(id, now)
            }
            val alerts = alerts(session, state, feed)
            // 4. Escalations (platform admins) and 5. enrolments.
            val isAdmin = probe.user.isPlatformAdmin
            val approvals = approvals(session, state, isAdmin, alerts.tenants)
            val enrolments = enrolments(session, state, probe, isAdmin, alerts.tenants)

            // 7. Save (only the fields the pass owns: the user may edit the others meanwhile).
            store.updateServer(id) {
                it.copy(
                    alertsMark = alerts.mark,
                    postedAlerts = alerts.posted,
                    knownTenants = alerts.tenants,
                    approvalsMark = approvals.mark,
                    postedApprovals = approvals.posted,
                    enrolmentsMark = enrolments.mark,
                    postedEnrolments = enrolments.posted,
                    expiredNotified = false,
                    lastNotify = profile.notify,
                    lastPass = LastPass(now, PassResult.OK),
                    lastCriticalUnread = alerts.criticalUnread,
                )
            }
            // 6. One group summary per server.
            summary(alerts)
            return ServerPassReport(id, PassResult.OK, postedCount)
        }

        private fun post(n: PlannedNotification): Boolean = publisher.post(n).also { if (it) postedCount++ }

        private suspend fun expired(state: ServerNotifState): ServerPassReport {
            val posted = !state.expiredNotified && post(factory.expired(profile, multi, now))
            store.updateServer(id) {
                it.copy(expiredNotified = it.expiredNotified || posted, lastPass = LastPass(now, PassResult.EXPIRED))
            }
            return ServerPassReport(id, PassResult.EXPIRED, postedCount)
        }

        // --- Alerts ------------------------------------------------------------------

        private suspend fun alerts(session: ServerSession, state: ServerNotifState, feed: AlertsFeed): AlertsPart {
            val tenants = feed.tenants.associate { it.id to it.name }.ifEmpty { state.knownTenants }
            val excluded = state.excludedTenants
            fun visible(a: LiveAlert) = a.tenantId == null || a.tenantId !in excluded
            val byId = feed.alerts.associateBy { it.id }

            // The mark covers every alert (excluded tenants too): un-excluding one later never floods.
            val hw = LiveAlerts.process(feed.alerts, state.alertsMark, Int.MAX_VALUE)
            val fresh = hw.toNotify.filter(::visible)
            val hints = deviceHints(session, fresh)
            val classified = fresh.map { it to AlertClassifier.classify(it, hints[it.id] ?: DeviceHints()) }

            // Alerts read elsewhere, gone or now excluded: their notification goes.
            val posted = state.postedAlerts.toMutableList()
            posted.removeAll { p ->
                val a = byId[p.alertId]
                val gone = a == null || a.readAt != null || !visible(a)
                if (gone) {
                    publisher.cancel(id, NotificationIds.alert(id, p.alertId))
                    work.cancelReminder(id, p.alertId)
                }
                gone
            }

            // New incidents: the 5 most urgent (rank, then newest); the rest is overflow.
            val candidates = classified.mapNotNull { (a, c) -> candidate(a, c, state) }
            val chosen = candidates
                .sortedWith(compareBy<Candidate> { it.c.rank }.thenByDescending { NotificationTexts.parseTime(it.a.createdAt) ?: 0L }.thenByDescending { it.a.id })
                .take(MAX_PER_SERVER)
            val remind = OnCallPolicy.remindersApply(onCall, state.inOnCall, at)
            // Least urgent first: the most urgent is posted last and sits on top.
            for (cand in chosen.asReversed()) {
                val n = factory.alert(profile, multi, cand.a, cand.c, cand.kind, tenants, silent = cand.delivery == Delivery.SILENT)
                if (post(n)) {
                    posted.removeAll { it.alertId == cand.a.id }
                    posted += PostedAlert(cand.a.id, NotificationRoutes.deviceIdOf(cand.a.navigateTo), critical = cand.kind == AlertKind.CRITICAL)
                    if (cand.kind == AlertKind.CRITICAL && cand.delivery == Delivery.NORMAL && remind) {
                        work.scheduleReminder(id, cand.a.id, 1)
                    }
                }
            }

            // Recoveries: update the device's earlier notification in place, else (ALL only) a silent one.
            var newRecoveries = 0
            for ((a, c) in classified.filter { it.second.category == AlertCategory.RECOVERY }.sortedBy { it.first.id }) {
                val device = NotificationRoutes.deviceIdOf(a.navigateTo)
                val target = device?.let { d ->
                    posted.lastOrNull { it.deviceId == d && !it.recovered && publisher.isShown(id, NotificationIds.alert(id, it.alertId)) }
                }
                if (target != null) {
                    if (post(factory.recovery(profile, multi, a, c, tenants, byId[target.alertId], target.alertId))) {
                        posted.replaceAll { if (it.alertId == target.alertId) it.copy(recovered = true) else it }
                        work.cancelReminder(id, target.alertId)
                    }
                } else if (
                    profile.notify == NotifyScope.ALL && !foreground && chosen.size + newRecoveries < MAX_PER_SERVER &&
                    OnCallPolicy.delivery(onCall, state.inOnCall, at, Urgency.NORMAL) != Delivery.DROP
                ) {
                    if (post(factory.recovery(profile, multi, a, c, tenants, original = null, originalId = null))) {
                        posted += PostedAlert(a.id, device, critical = false, recovered = true)
                        newRecoveries++
                    }
                }
            }

            // What is still unread (summary lines, tile subtitle).
            val unread = feed.alerts.filter { visible(it) && it.readAt == null }
                .map { it to AlertClassifier.classify(it, hints[it.id] ?: DeviceHints()) }
                .filter { (_, c) -> c.category != AlertCategory.RECOVERY }
            val criticalUnread = unread.count { (_, c) -> c.rank <= 1 }
            val notifiable = unread.filter { (a, c) ->
                c.rank <= 1 || (profile.notify == NotifyScope.ALL && a.severity == AlertSeverity.WARNING)
            }.map { it.first }
            return AlertsPart(
                mark = hw.newHighWater,
                posted = posted.sortedByDescending { it.alertId }.take(MAX_POSTED),
                tenants = tenants,
                notifiable = notifiable,
                criticalUnread = criticalUnread,
            )
        }

        private fun candidate(a: LiveAlert, c: AlertClassification, state: ServerNotifState): Candidate? {
            if (c.category == AlertCategory.RECOVERY) return null
            val kind = when {
                c.rank <= 1 -> AlertKind.CRITICAL
                a.severity == AlertSeverity.WARNING -> AlertKind.WARNING
                else -> return null // Other info alerts are never notified (design doc §9).
            }
            if (profile.notify == NotifyScope.CRITICAL_ONLY && kind != AlertKind.CRITICAL) return null
            // App in front: it shows the rest itself.
            if (foreground && kind != AlertKind.CRITICAL) return null
            val urgency = if (kind == AlertKind.CRITICAL) Urgency.CRITICAL else Urgency.NORMAL
            val delivery = OnCallPolicy.delivery(onCall, state.inOnCall, at, urgency)
            if (delivery == Delivery.DROP) return null
            return Candidate(a, c, kind, delivery)
        }

        /** "Hors ligne" alerts sent as info: a server (osName "…Server…") ranks as critical (§5 S10). */
        private suspend fun deviceHints(session: ServerSession, fresh: List<LiveAlert>): Map<Long, DeviceHints> {
            val lookups = fresh
                .filter { it.severity == AlertSeverity.INFO && AlertClassifier.category(it.title) == AlertCategory.OFFLINE }
                .mapNotNull { a -> NotificationRoutes.deviceIdOf(a.navigateTo)?.let { a.id to it } }
                .take(MAX_DEVICE_LOOKUPS)
            if (lookups.isEmpty()) return emptyMap()
            val api = DevicesApi(session.http)
            return coroutineScope {
                lookups.map { (alertId, deviceId) ->
                    async {
                        when (val out = api.detail(deviceId)) {
                            is ApiOutcome.Ok -> alertId to DeviceHints(isServer = out.value.osName?.contains("Server", ignoreCase = true) == true)
                            ApiOutcome.SessionExpired -> null.also { session.markExpired() }
                            else -> null
                        }
                    }
                }.awaitAll().filterNotNull().toMap()
            }
        }

        // --- Escalations ----------------------------------------------------------------

        private suspend fun approvals(session: ServerSession, state: ServerNotifState, isAdmin: Boolean, tenants: Map<Long, String>): IdPart {
            val keep = IdPart(state.approvalsMark, state.postedApprovals)
            if (!isAdmin) {
                state.postedApprovals.forEach { publisher.cancel(id, NotificationIds.approval(id, it)) }
                return IdPart(state.approvalsMark, emptyList())
            }
            val list: List<Approval> = when (val out = ApprovalsApi(session.http).list()) {
                is ApiOutcome.Ok -> out.value
                ApiOutcome.SessionExpired -> return keep.also { session.markExpired() }
                else -> return keep
            }
            val live = list.filter { it.isPending && !expired(it) }
            val liveIds = live.map { it.id }.toSet()
            val (mark, fresh) = advance(state.approvalsMark, list.map { it.id }) { m -> live.filter { it.id > m } }
            val posted = state.postedApprovals.toMutableList()
            posted.removeAll { pid -> (pid !in liveIds).also { if (it) publisher.cancel(id, NotificationIds.approval(id, pid)) } }
            val delivery = OnCallPolicy.delivery(onCall, state.inOnCall, at, Urgency.ESCALATION)
            if (delivery != Delivery.DROP) {
                for (approval in fresh.sortedBy { it.id }) {
                    if (post(factory.approval(profile, multi, approval, tenants, silent = delivery == Delivery.SILENT))) posted += approval.id
                }
            }
            return IdPart(mark, posted.distinct())
        }

        private fun expired(approval: Approval): Boolean = NotificationTexts.parseTime(approval.expiresAt)?.let { it <= now } ?: false

        // --- Enrolments -------------------------------------------------------------------

        private suspend fun enrolments(session: ServerSession, state: ServerNotifState, probe: SessionProbe, isAdmin: Boolean, tenants: Map<Long, String>): IdPart {
            val keep = IdPart(state.enrolmentsMark, state.postedEnrolments)
            val allowed = isAdmin || APPROVAL_CAPABILITY in capabilities(session)
            if (!allowed) {
                state.postedEnrolments.forEach { publisher.cancel(id, NotificationIds.enrolment(id, it)) }
                return IdPart(state.enrolmentsMark, emptyList())
            }
            val devices = when (val out = DevicesApi(session.http).list(DeviceQuery(approvalStatus = "pending", pageSize = 50))) {
                is ApiOutcome.Ok -> out.value.items
                ApiOutcome.SessionExpired -> return keep.also { session.markExpired() }
                else -> return keep
            }
            val pending = devices.filter { (it.approvalStatus ?: PENDING) == PENDING }
            val pendingIds = pending.map { it.id }.toSet()
            val (mark, fresh) = advance(state.enrolmentsMark, pending.map { it.id }) { m -> pending.filter { it.id > m } }
            val posted = state.postedEnrolments.toMutableList()
            posted.removeAll { did -> (did !in pendingIds).also { if (it) publisher.cancel(id, NotificationIds.enrolment(id, did)) } }
            val delivery = OnCallPolicy.delivery(onCall, state.inOnCall, at, Urgency.NORMAL)
            if (profile.notify == NotifyScope.ALL && !foreground && delivery != Delivery.DROP) {
                for (device in fresh.sortedBy { it.id }) {
                    val n = factory.enrolment(profile, multi, device, probe.currentTenantId, tenants, silent = delivery == Delivery.SILENT)
                    if (post(n)) posted += device.id
                }
            }
            return IdPart(mark, posted.distinct())
        }

        // --- Summary -----------------------------------------------------------------------

        private fun summary(alerts: AlertsPart) {
            val summaryId = NotificationIds.summary(id)
            val active = publisher.activeIds(id) - summaryId
            if (active.isEmpty()) {
                publisher.cancel(id, summaryId)
                return
            }
            val noTenant = texts.string(R.string.notif_summary_no_tenant)
            val perTenant = alerts.notifiable
                .groupingBy { it.tenantName?.takeIf { n -> n.isNotBlank() } ?: it.tenantId?.let(alerts.tenants::get) ?: noTenant }
                .eachCount()
                .toList()
                .sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first })
            val shownIds = alerts.posted.filter { NotificationIds.alert(id, it.alertId) in active }.map { it.alertId }.toSet()
            val shown = alerts.notifiable.count { it.id in shownIds }
            val overflow = (alerts.notifiable.size - shown).coerceAtLeast(0)
            publisher.post(factory.summary(profile, multi, perTenant, alerts.notifiable.size, overflow))
        }
    }

    private data class Candidate(val a: LiveAlert, val c: AlertClassification, val kind: AlertKind, val delivery: Delivery)

    private data class AlertsPart(
        val mark: Long?,
        val posted: List<PostedAlert>,
        val tenants: Map<Long, String>,
        val notifiable: List<LiveAlert>,
        val criticalUnread: Int,
    )

    private data class IdPart(val mark: Long?, val posted: List<Long>)

    companion object {
        const val SERVER_TIMEOUT_MS = 20_000L
        const val MAX_PER_SERVER = 5
        const val MAX_POSTED = 100
        const val MAX_DEVICE_LOOKUPS = 5
        const val APPROVAL_CAPABILITY = "agent_config:approval"
        private const val PENDING = "pending"

        /**
         * High-water rule for serial ids (approvals, pending devices): null mark =
         * baseline (nothing fresh), else the items above it; the mark never goes back.
         */
        fun <T> advance(mark: Long?, ids: List<Long>, freshAbove: (Long) -> List<T>): Pair<Long, List<T>> {
            val max = ids.maxOrNull()
            if (mark == null) return (max ?: 0L) to emptyList()
            return maxOf(mark, max ?: mark) to freshAbove(mark)
        }

        fun unreachablePass(previous: LastPass?, now: Long): LastPass {
            val since = if (previous?.result == PassResult.UNREACHABLE) previous.since ?: previous.at else now
            return LastPass(now, PassResult.UNREACHABLE, since)
        }
    }
}

/** `GET /api/auth/permissions` → `data` (permission.service.ts getUserPermissions). */
@Serializable
private data class PermissionsDto(val tenantCapabilities: List<String> = emptyList())

/** Capabilities of the user in the SESSION tenant of that server; empty on any failure. */
internal suspend fun capabilities(session: ServerSession): List<String> =
    when (val out = session.http.call(ObliHttp.Method.GET, "/api/auth/permissions", decode = ApiJson.unwrapped(PermissionsDto.serializer()))) {
        is ApiOutcome.Ok -> out.value.tenantCapabilities
        ApiOutcome.SessionExpired -> emptyList<String>().also { session.markExpired() }
        else -> emptyList()
    }

/**
 * "Rappeler une alerte critique non lue toutes les 5 min (3 fois max)": one
 * reminder attempt for one posted critical alert (ReminderWorker).
 */
internal class ReminderRunner(
    private val services: ObliServices,
    private val store: NotificationStore,
    private val publisher: NotificationPublisher,
    private val texts: NotificationTexts,
    private val work: WorkScheduler,
    private val clock: () -> Long = System::currentTimeMillis,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    suspend fun run(serverId: ServerId, alertId: Long, attempt: Int): ReminderPolicy.Decision = PassLock.mutex.withLock {
        val registry = services.registry.state.value
        val profile = registry.byId(serverId) ?: return@withLock ReminderPolicy.Decision.Stop
        val state = store.read()
        val s = state.server(serverId)
        val posted = s.postedAlerts.firstOrNull { it.alertId == alertId }
        if (posted == null || !posted.critical || posted.recovered || profile.notify == NotifyScope.NONE || s.signedOutByUser) {
            return@withLock ReminderPolicy.Decision.Stop
        }
        val at = Instant.ofEpochMilli(clock()).atZone(zone)
        val applies = OnCallPolicy.remindersApply(state.onCall, s.inOnCall, at)
        val shown = publisher.isShown(serverId, NotificationIds.alert(serverId, alertId))
        var alert: LiveAlert? = null
        val unread: Boolean? = if (!applies || !shown) {
            false
        } else {
            val session = services.sessions.session(serverId)
            val out = session?.let { withTimeoutOrNull(NotificationPass.SERVER_TIMEOUT_MS) { AlertsApi(it.http).all() } }
            if (out == ApiOutcome.SessionExpired) session?.markExpired()
            val feed = (out as? ApiOutcome.Ok)?.value
            alert = feed?.alerts?.firstOrNull { it.id == alertId }
            when {
                feed == null -> null
                alert == null -> false
                else -> alert.readAt == null
            }
        }
        val decision = ReminderPolicy.decide(attempt, shown, unread, applies)
        when (decision) {
            is ReminderPolicy.Decision.Repost -> {
                val a = alert
                if (a != null) {
                    val c = AlertClassifier.classify(a)
                    // Same id, WITH sound this time (onlyAlertOnce off).
                    publisher.post(NotificationFactory(texts).alert(profile, registry.isMultiServer, a, c, AlertKind.CRITICAL, s.knownTenants, silent = false, onlyAlertOnce = false))
                }
                decision.next?.let { work.scheduleReminder(serverId, alertId, it) }
            }
            is ReminderPolicy.Decision.Wait -> decision.next?.let { work.scheduleReminder(serverId, alertId, it) }
            ReminderPolicy.Decision.Stop -> Unit
        }
        decision
    }
}
