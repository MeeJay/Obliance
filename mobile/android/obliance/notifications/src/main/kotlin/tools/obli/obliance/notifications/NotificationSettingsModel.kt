package tools.obli.obliance.notifications

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.obliance.data.ObliServices

/** How a channel behaves today (S84 "Catégories"), read from Android. */
internal enum class ChannelLevel { SOUND, VIBRATE, SILENT, OFF }

internal enum class ServerStatus { CHECKED, EXPIRED, UNREACHABLE, DISABLED, SIGNED_OUT, PENDING }

internal data class TenantChipUi(val id: Long, val name: String, val included: Boolean)

internal data class ServerRowUi(
    val id: ServerId,
    val name: String,
    val color: ServerColor,
    val monogram: String,
    val notify: NotifyScope,
    val status: ServerStatus,
    /** "03:20" of "Vérifié à 03:20" / "Injoignable depuis 03:02". */
    val statusTime: String?,
    val tenants: List<TenantChipUi>,
    val inOnCall: Boolean,
    /** canBypassDnd() of its critical channel; null when the channel does not exist yet. */
    val criticalBypassesDnd: Boolean?,
)

internal data class ChannelLevelUi(val channel: NotifChannel, val level: ChannelLevel?)

internal data class SettingsUi(
    val multi: Boolean = false,
    val notificationsAllowed: Boolean = true,
    val batteryIgnored: Boolean = true,
    val onCall: OnCallSettings = OnCallSettings(),
    val servers: List<ServerRowUi> = emptyList(),
    val activeServerId: ServerId? = null,
    /** The active server's six channels. */
    val categories: List<ChannelLevelUi> = emptyList(),
) {
    val activeServer: ServerRowUi? get() = servers.firstOrNull { it.id == activeServerId }
}

/** What Android says about the app's notifications (permission, battery, channels). */
internal data class EnvSnapshot(
    val permissionGranted: Boolean = true,
    val notificationsEnabled: Boolean = true,
    val batteryIgnored: Boolean = true,
    /** Channel id → info. */
    val channels: Map<String, ChannelInfo> = emptyMap(),
)

internal fun interface NotificationEnvironment {
    fun snapshot(serverIds: List<ServerId>): EnvSnapshot
}

internal class AndroidEnvironment(private val context: Context) : NotificationEnvironment {
    override fun snapshot(serverIds: List<ServerId>): EnvSnapshot = EnvSnapshot(
        permissionGranted = AndroidNotificationPublisher.permissionGranted(context),
        notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled(),
        batteryIgnored = ObliNotifications.ignoringBatteryOptimizations(context),
        channels = serverIds.flatMap { id ->
            NotifChannel.entries.mapNotNull { c -> NotificationChannels.info(context, id, c)?.let { c.id(id) to it } }
        }.toMap(),
    )
}

/** S84 view state from the registry, the sessions, the engine state and Android (pure). */
internal object SettingsMapper {
    private val HHMM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    fun map(registry: ServerRegistryState, auth: Map<ServerId, AuthState>, state: NotificationState, env: EnvSnapshot, zone: ZoneId): SettingsUi {
        fun time(ms: Long) = HHMM.format(Instant.ofEpochMilli(ms).atZone(zone))
        val servers = registry.profiles.map { p ->
            val s = state.server(p.id)
            val a = auth[p.id]
            val last = s.lastPass
            val (status, at) = when {
                p.notify == NotifyScope.NONE -> ServerStatus.DISABLED to null
                s.signedOutByUser || a == AuthState.SignedOut -> ServerStatus.SIGNED_OUT to null
                a == AuthState.Expired || (a !is AuthState.SignedIn && last?.result == PassResult.EXPIRED) -> ServerStatus.EXPIRED to null
                last?.result == PassResult.UNREACHABLE -> ServerStatus.UNREACHABLE to time(last.since ?: last.at)
                last?.result == PassResult.OK -> ServerStatus.CHECKED to time(last.at)
                else -> ServerStatus.PENDING to null
            }
            ServerRowUi(
                id = p.id,
                name = p.displayName,
                color = p.color,
                monogram = p.monogram,
                notify = p.notify,
                status = status,
                statusTime = at,
                tenants = s.knownTenants.entries.sortedBy { it.key }.map { (id, name) -> TenantChipUi(id, name, id !in s.excludedTenants) },
                inOnCall = s.inOnCall,
                criticalBypassesDnd = env.channels[NotifChannel.CRITICAL.id(p.id)]?.bypassDnd,
            )
        }
        val active = registry.activeId ?: registry.profiles.firstOrNull()?.id
        return SettingsUi(
            multi = registry.isMultiServer,
            notificationsAllowed = env.permissionGranted && env.notificationsEnabled,
            batteryIgnored = env.batteryIgnored,
            onCall = state.onCall,
            servers = servers,
            activeServerId = active,
            categories = active?.let { id -> NotifChannel.entries.map { ChannelLevelUi(it, level(env.channels[it.id(id)])) } }.orEmpty(),
        )
    }

    /** Importance and sound/vibration → what the user hears. */
    fun level(info: ChannelInfo?): ChannelLevel? = when {
        info == null -> null
        info.importance == NotificationManager.IMPORTANCE_NONE -> ChannelLevel.OFF
        info.importance < NotificationManager.IMPORTANCE_DEFAULT -> ChannelLevel.SILENT
        info.sound -> ChannelLevel.SOUND
        info.vibrate -> ChannelLevel.VIBRATE
        else -> ChannelLevel.SILENT
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
internal class NotificationSettingsViewModel(
    private val services: ObliServices,
    private val store: NotificationStore,
    private val env: NotificationEnvironment,
    private val effects: SettingsEffects,
    private val zone: ZoneId = ZoneId.systemDefault(),
) : ViewModel() {
    private val envState = MutableStateFlow(env.snapshot(ids()))

    private fun ids(): List<ServerId> = services.registry.state.value.profiles.map { it.id }

    private val authFlow: Flow<Map<ServerId, AuthState>> = services.registry.state.flatMapLatest { st ->
        val flows = st.profiles.mapNotNull { p -> services.sessions.session(p.id)?.auth?.map { p.id to it } }
        if (flows.isEmpty()) flowOf(emptyMap()) else combine(flows) { it.toMap() }
    }

    val ui: StateFlow<SettingsUi> = combine(services.registry.state, authFlow, store.state, envState) { registry, auth, state, envSnap ->
        SettingsMapper.map(registry, auth, state, envSnap, zone)
    }.stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        SettingsMapper.map(services.registry.state.value, emptyMap(), NotificationState(), envState.value, zone),
    )

    /** Back from Android settings (permission, battery, channels). */
    fun refreshEnvironment() {
        envState.value = env.snapshot(ids())
    }

    private fun updateOnCall(change: (OnCallSettings) -> OnCallSettings) {
        viewModelScope.launch {
            store.update { it.copy(onCall = change(it.onCall)) }
            effects.onCallChanged()
        }
    }

    fun setOnCallEnabled(enabled: Boolean) = updateOnCall { it.copy(enabled = enabled) }

    fun toggleDay(day: Int) = updateOnCall { oc ->
        val days = if (day in oc.days) oc.days - day else oc.days + day
        // At least one day: an empty schedule would silently disable on-call.
        if (days.isEmpty()) oc else oc.copy(days = days)
    }

    fun setStart(minute: Int) = updateOnCall { it.copy(startMinute = minute.coerceIn(0, 24 * 60 - 1)) }
    fun setEnd(minute: Int) = updateOnCall { it.copy(endMinute = minute.coerceIn(0, 24 * 60 - 1)) }
    fun setOutside(rule: OutsideRule) = updateOnCall { it.copy(outside = rule) }
    fun setRemind(remind: Boolean) = updateOnCall { it.copy(remindCritical = remind) }

    /** Same value as S92 "Recevoir les notifications". */
    fun setNotify(id: ServerId, scope: NotifyScope) {
        viewModelScope.launch { services.registry.setNotify(id, scope) }
    }

    fun toggleTenant(id: ServerId, tenantId: Long) {
        viewModelScope.launch {
            store.updateServer(id) { s ->
                s.copy(excludedTenants = if (tenantId in s.excludedTenants) s.excludedTenants - tenantId else s.excludedTenants + tenantId)
            }
        }
    }

    fun setInOnCall(id: ServerId, include: Boolean) {
        viewModelScope.launch { store.updateServer(id) { it.copy(inOnCall = include) } }
    }

    fun sendTest() {
        val registry = services.registry.state.value
        val profile = registry.active ?: registry.profiles.firstOrNull() ?: return
        effects.sendTest(profile, registry.isMultiServer)
    }

    fun checkNow() = effects.checkNow()
}

/** Side effects of S84 that need Android (tests record them). */
internal interface SettingsEffects {
    fun onCallChanged()
    fun checkNow()
    fun sendTest(profile: tools.obli.core.model.ServerProfile, multi: Boolean)
}

internal class AndroidSettingsEffects(private val context: Context) : SettingsEffects {
    override fun onCallChanged() {
        ObliNotifications.sync(context)
        OnCallTileService.requestRefresh(context)
    }

    override fun checkNow() = ObliNotifications.checkNow(context)

    override fun sendTest(profile: tools.obli.core.model.ServerProfile, multi: Boolean) {
        val rt = ObliNotifications.runtime
        NotificationChannels.ensure(context, listOf(profile))
        val publisher = rt?.publisher ?: AndroidNotificationPublisher(context) { ctx ->
            ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(Intent.ACTION_MAIN).setPackage(ctx.packageName)
        }
        val texts = rt?.texts() ?: NotificationTexts(context.resources)
        publisher.post(NotificationFactory(texts).test(profile, multi, System.currentTimeMillis()))
    }
}

/** Android settings screens opened from S84 and the permission gate. */
internal object SystemSettings {
    fun channel(context: Context, channelId: String) = start(
        context,
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, channelId),
    ) || appNotifications(context)

    fun appNotifications(context: Context) = start(
        context,
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
    )

    /** S04 step 2: the system dialog, else the battery optimisation list. */
    @SuppressLint("BatteryLife") // Distributed outside Google Play; the poll is the only alert path (design doc §5 S04).
    fun ignoreBatteryOptimizations(context: Context) =
        start(context, Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, ("package:" + context.packageName).toUri())) ||
            start(context, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))

    private fun start(context: Context, intent: Intent): Boolean = runCatching {
        if (context !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }.isSuccess
}
