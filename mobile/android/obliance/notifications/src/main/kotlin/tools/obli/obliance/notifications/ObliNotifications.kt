package tools.obli.obliance.notifications

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import tools.obli.core.auth.AuthState
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.obliance.data.ObliServices

/**
 * Background notifications of every configured server (design doc §9,
 * §10.8). The application calls [install] once from `Application.onCreate`,
 * then reads the route of a tapped notification with [routeFrom] in
 * `onCreate` / `onNewIntent` of its activity.
 */
object ObliNotifications {
    /** Action of the activity intents of the notifications (content tap, "Ouvrir", "Examiner"…). */
    const val ACTION_OPEN = "tools.obli.obliance.notifications.action.OPEN"

    // Holds the APPLICATION context only (install() takes applicationContext).
    @SuppressLint("StaticFieldLeak")
    @Volatile internal var runtime: NotificationRuntime? = null

    /**
     * Keeps [services], creates or refreshes the channel group of every server
     * once [ready] (registry loaded), follows the registry (renames, removals,
     * notify scope, new servers) and each server's session (sign-out, sign-in),
     * and schedules the 15-minute pass. [launchIntent] must be EXPLICIT (the
     * app's activity): ACTION_OPEN and the route extras are added to it.
     */
    fun install(
        context: Context,
        services: ObliServices,
        ready: StateFlow<Boolean>,
        launchIntent: (Context) -> Intent = ::defaultLaunchIntent,
    ) {
        val app = context.applicationContext
        install(
            context = app,
            services = services,
            ready = ready,
            launchIntent = launchIntent,
            store = NotificationStores.dataStore(app),
            work = AndroidWork(app),
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
        )
    }

    internal fun install(
        context: Context,
        services: ObliServices,
        ready: StateFlow<Boolean>,
        launchIntent: (Context) -> Intent,
        store: NotificationStore,
        work: WorkScheduler,
        scope: CoroutineScope,
        publisher: NotificationPublisher = AndroidNotificationPublisher(context, launchIntent),
        clock: () -> Long = System::currentTimeMillis,
        zone: ZoneId = ZoneId.systemDefault(),
    ): NotificationRuntime {
        runtime?.scope?.cancel()
        val rt = NotificationRuntime(context, services, ready, launchIntent, store, work, scope, publisher, clock, zone)
        runtime = rt
        rt.start()
        return rt
    }

    /** Enqueues the periodic pass when at least one server may notify, cancels it otherwise. */
    fun sync(context: Context) {
        val rt = runtime ?: return
        rt.scope.launch { rt.syncNow(force = true) }
    }

    /** One pass as soon as the network allows ("Vérifier maintenant", a server was added). */
    fun checkNow(context: Context) {
        (runtime?.work ?: AndroidWork(context.applicationContext)).checkNow()
    }

    /**
     * The route of a tapped notification, or null. Reads AND removes the route
     * extras (a recreation does not replay it). Null as well when the server
     * is no longer configured, the route is not valid (unsafe path…), or the
     * intent does not come from one of the app's own notifications
     * ([ACTION_OPEN] and this install's [RouteToken]: the launcher activity is
     * exported, any app could send it route extras). A refused route is
     * stripped from the intent too.
     */
    fun routeFrom(intent: Intent?): NotificationRoute? {
        if (intent == null || !RouteExtras.has(intent)) return null
        val rt = runtime
        val authentic = rt != null && intent.action == ACTION_OPEN && RouteToken.matches(rt.context, intent.getStringExtra(RouteToken.EXTRA))
        val route = if (authentic) RouteExtras.read(intent) else null
        RouteExtras.remove(intent)
        val registry = rt?.services?.registry?.state?.value ?: return null
        return route?.takeIf { registry.byId(it.serverId) != null }
    }

    /**
     * Redacted state of the engine for S86 "Copier le diagnostic": no origin,
     * no host, no cookie, no alert content — servers are named by position and
     * monogram.
     */
    fun diagnostics(context: Context): List<String> {
        val lines = mutableListOf<String>()
        val app = context.applicationContext
        lines += "notifications.permission=" + if (AndroidNotificationPublisher.permissionGranted(app)) "granted" else "denied"
        lines += "notifications.enabled=" + NotificationManagerCompat.from(app).areNotificationsEnabled()
        lines += "battery.ignoringOptimizations=" + ignoringBatteryOptimizations(app)
        val rt = runtime
        if (rt == null) {
            lines += "notifications.engine=not installed"
            return lines
        }
        val state = rt.lastState ?: NotificationState()
        val zone = rt.zone
        val oc = state.onCall
        lines += "oncall=" + if (oc.enabled) {
            "on ${minutes(oc.startMinute)}-${minutes(oc.endMinute)} days=${oc.days.sorted().joinToString("")} outside=${oc.outside} remind=${oc.remindCritical}"
        } else {
            "off"
        }
        rt.services.registry.state.value.profiles.forEachIndexed { i, p ->
            val s = state.server(p.id)
            val last = s.lastPass?.let { "${it.result}@${HHMM.format(Instant.ofEpochMilli(it.at).atZone(zone))}" } ?: "NONE"
            lines += "server[${i + 1}] ${p.monogram}: notify=${p.notify} last=$last " +
                "marks=a:${s.alertsMark ?: "-"},p:${s.approvalsMark ?: "-"},e:${s.enrolmentsMark ?: "-"} " +
                "posted=${s.postedAlerts.size}/${s.postedApprovals.size}/${s.postedEnrolments.size} " +
                "inOnCall=${s.inOnCall} excludedTenants=${s.excludedTenants.size} signedOut=${s.signedOutByUser} expiredNotified=${s.expiredNotified}"
        }
        return lines
    }

    private val HHMM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    internal fun minutes(m: Int): String = "%02d:%02d".format(m / 60, m % 60)

    internal fun ignoringBatteryOptimizations(context: Context): Boolean =
        runCatching { context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true }.getOrDefault(false)

    /** The package's launcher activity (explicit), or an intent limited to the package. */
    private fun defaultLaunchIntent(context: Context): Intent =
        context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName)
}

/** Everything [ObliNotifications.install] set up (one per process). */
internal class NotificationRuntime(
    val context: Context,
    val services: ObliServices,
    val ready: StateFlow<Boolean>,
    val launchIntent: (Context) -> Intent,
    val store: NotificationStore,
    val work: WorkScheduler,
    val scope: CoroutineScope,
    val publisher: NotificationPublisher,
    val clock: () -> Long,
    val zone: ZoneId,
) {
    /** ProcessLifecycleOwner is at least STARTED: the app shows the rest, only criticals are posted. */
    val foreground = AtomicBoolean(false)

    /** Last state read (diagnostics are synchronous). */
    @Volatile var lastState: NotificationState? = null

    fun texts() = NotificationTexts(context.resources, zone)

    /** Before posting from a worker: a cold start may run the pass before [follow] created them. */
    fun ensureChannels() = NotificationChannels.ensure(context, services.registry.state.value.profiles)

    fun pass(): NotificationPass = NotificationPass(services, store, publisher, clock, { foreground.get() }, texts(), work, zone)

    fun reminders(): ReminderRunner = ReminderRunner(services, store, publisher, texts(), work, clock, zone)

    suspend fun awaitReady(timeoutMs: Long = READY_TIMEOUT_MS): Boolean =
        ready.value || withTimeoutOrNull(timeoutMs) { ready.first { it } } != null

    fun start() {
        if (Looper.myLooper() == Looper.getMainLooper()) observeForeground() else Handler(Looper.getMainLooper()).post { observeForeground() }
        services.registry.addRemovalListener { profile -> if (ObliNotifications.runtime === this) onServerRemoved(profile) }
        scope.launch { store.state.collect { lastState = it } }
        scope.launch { follow() }
    }

    private fun observeForeground() {
        runCatching {
            val lifecycle = ProcessLifecycleOwner.get().lifecycle
            foreground.set(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
            lifecycle.addObserver(LifecycleEventObserver { _, _ -> foreground.set(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) })
        }
    }

    private suspend fun follow() {
        ready.first { it }
        val initial = services.registry.state.value.profiles
        NotificationChannels.ensure(context, initial)
        NotificationChannels.deleteOrphans(context, initial.map { it.id }.toSet())
        coroutineScope {
            launch { followRegistry() }
            launch { followAuth() }
        }
    }

    /** Renames (group name), notify scope transitions (re-baseline), new servers (a pass now). */
    private suspend fun followRegistry() {
        var previous: Map<ServerId, ServerProfile>? = null
        services.registry.state.collect { st ->
            val profiles = st.profiles
            NotificationChannels.ensure(context, profiles)
            val before = previous
            for (p in profiles) {
                val old = before?.get(p.id) ?: continue
                val wasNone = old.notify == NotifyScope.NONE
                val isNone = p.notify == NotifyScope.NONE
                if (wasNone == isNone) continue
                // Entering or leaving "Aucune": the next pass baselines, nothing old is ever notified.
                store.updateServer(p.id) {
                    it.copy(
                        alertsMark = null, approvalsMark = null, enrolmentsMark = null, lastNotify = p.notify,
                        postedAlerts = if (isNone) emptyList() else it.postedAlerts,
                        postedApprovals = if (isNone) emptyList() else it.postedApprovals,
                        postedEnrolments = if (isNone) emptyList() else it.postedEnrolments,
                    )
                }
                if (isNone) {
                    publisher.cancelAll(p.id)
                    work.cancelReminders(p.id)
                }
            }
            val stored = store.read()
            val added = if (before == null) {
                profiles.filter { stored.server(it.id).lastPass == null }
            } else {
                profiles.filter { it.id !in before }
            }
            previous = profiles.associateBy { it.id }
            syncNow()
            if (added.isNotEmpty()) work.checkNow()
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private suspend fun followAuth() {
        services.registry.state
            .map { st -> st.profiles.map { it.id } }
            .distinctUntilChanged()
            .flatMapLatest { ids -> merge(*ids.mapNotNull { id -> services.sessions.session(id)?.auth?.map { id to it } }.toTypedArray()) }
            .collect { (id, auth) -> onAuth(id, auth) }
    }

    internal suspend fun onAuth(id: ServerId, auth: AuthState) {
        when (auth) {
            AuthState.SignedOut -> {
                // "Se déconnecter de ce serveur": its notifications stop, and no request is sent any more.
                store.updateServer(id) {
                    it.copy(signedOutByUser = true, expiredNotified = false, postedAlerts = emptyList(), postedApprovals = emptyList(), postedEnrolments = emptyList())
                }
                publisher.cancelAll(id)
                work.cancelReminders(id)
                syncNow()
            }
            is AuthState.SignedIn -> {
                val s = store.read().server(id)
                if (!s.signedOutByUser && !s.expiredNotified) return
                store.updateServer(id) {
                    if (s.signedOutByUser) {
                        // Back after a sign-out (maybe another account): baseline again.
                        it.copy(signedOutByUser = false, expiredNotified = false, alertsMark = null, approvalsMark = null, enrolmentsMark = null)
                    } else {
                        it.copy(expiredNotified = false)
                    }
                }
                publisher.cancel(id, NotificationIds.expired(id))
                syncNow()
            }
            else -> Unit
        }
    }

    /** A removed server leaves nothing: notifications, group and channels, reminders, state. */
    internal suspend fun onServerRemoved(profile: ServerProfile) {
        publisher.cancelAll(profile.id)
        work.cancelReminders(profile.id)
        NotificationChannels.delete(context, profile.id)
        store.update { it.without(profile.id) }
        syncNow()
    }

    /** What the last [syncNow] asked WorkManager for (registry changes often: theme, last tenant…). */
    @Volatile private var periodicWanted: Boolean? = null

    suspend fun syncNow(force: Boolean = false) {
        val state = store.read()
        val any = services.registry.state.value.profiles.any { it.notify != NotifyScope.NONE && !state.server(it.id).signedOutByUser }
        if (!force && any == periodicWanted) return
        periodicWanted = any
        if (any) work.enqueuePeriodic() else work.cancelPeriodic()
    }

    companion object {
        const val READY_TIMEOUT_MS = 10_000L
    }
}
