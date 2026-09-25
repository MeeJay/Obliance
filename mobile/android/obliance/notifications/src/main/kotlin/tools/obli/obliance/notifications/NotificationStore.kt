package tools.obli.obliance.notifications

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import tools.obli.core.model.NotifyScope
import tools.obli.core.model.ServerId

/** Outcome of the last background pass of one server (S84 "Acheminement", S81, diagnostics). */
@Serializable
internal enum class PassResult { OK, EXPIRED, UNREACHABLE, SKIPPED }

@Serializable
internal data class LastPass(
    val at: Long,
    val result: PassResult,
    /** First pass of the current UNREACHABLE streak ("Injoignable depuis 03:02"). */
    val since: Long? = null,
)

/** One alert notification on screen: [deviceId] lets a recovery update it (§9 #1). */
@Serializable
internal data class PostedAlert(
    val alertId: Long,
    val deviceId: Long? = null,
    /** Posted on the critical channel (reminders re-post it there). */
    val critical: Boolean = false,
    /** Replaced by "Rétabli à HH:mm": no reminder, no second merge. */
    val recovered: Boolean = false,
)

/** What the notification engine keeps for ONE server. */
@Serializable
internal data class ServerNotifState(
    /** High-water mark of live alert ids (null = baseline at the next pass, never flood). */
    val alertsMark: Long? = null,
    val approvalsMark: Long? = null,
    val enrolmentsMark: Long? = null,
    /** The single "Session expirée sur …" notification is out (design doc §2.10 item 5). */
    val expiredNotified: Boolean = false,
    /** "Se déconnecter de ce serveur": no request at all until the user signs in again. */
    val signedOutByUser: Boolean = false,
    val postedAlerts: List<PostedAlert> = emptyList(),
    val postedApprovals: List<Long> = emptyList(),
    val postedEnrolments: List<Long> = emptyList(),
    /** Tenants of the user on that server (`tenants` of /api/live-alerts/all), id → name. */
    val knownTenants: Map<Long, String> = emptyMap(),
    /** Tenants whose alerts never reach the phone (S84 "Tenants couverts"). */
    val excludedTenants: Set<Long> = emptySet(),
    /** "Inclus dans l'astreinte": false = always the outside rule. */
    val inOnCall: Boolean = true,
    val lastPass: LastPass? = null,
    /** Unread critical-class alerts at the last pass (tile subtitle "1 critique"). */
    val lastCriticalUnread: Int = 0,
    /** Notify scope seen at the last pass: leaving NONE re-baselines the marks. */
    val lastNotify: NotifyScope? = null,
)

/** What happens outside the on-call window (S84 "Hors astreinte"). */
@Serializable
internal enum class OutsideRule { CRITICAL_ONLY, SILENT, NONE }

/** The on-call schedule, common to every server (S84 "Astreinte"). */
@Serializable
internal data class OnCallSettings(
    val enabled: Boolean = false,
    /** ISO days (1 = Monday … 7 = Sunday) on which a window STARTS. */
    val days: Set<Int> = ALL_DAYS,
    /** Minutes after midnight, local time. The window may cross midnight. */
    val startMinute: Int = 19 * 60,
    val endMinute: Int = 8 * 60,
    val outside: OutsideRule = OutsideRule.CRITICAL_ONLY,
    val remindCritical: Boolean = true,
) {
    companion object {
        val ALL_DAYS: Set<Int> = (1..7).toSet()
    }
}

@Serializable
internal data class NotificationState(
    val servers: Map<String, ServerNotifState> = emptyMap(),
    val onCall: OnCallSettings = OnCallSettings(),
    /** POST_NOTIFICATIONS rationale shown (this module's own key, S04 step 1). */
    val permissionAsked: Boolean = false,
    /** Battery exemption dialog shown once (S04 step 2). */
    val batteryAsked: Boolean = false,
) {
    fun server(id: ServerId): ServerNotifState = servers[id.value] ?: ServerNotifState()

    fun withServer(id: ServerId, change: (ServerNotifState) -> ServerNotifState): NotificationState =
        copy(servers = servers + (id.value to change(server(id))))

    fun without(id: ServerId): NotificationState = copy(servers = servers - id.value)
}

/** Persistent state of the notification engine (DataStore "obli_notifications", JSON). */
internal interface NotificationStore {
    val state: Flow<NotificationState>

    suspend fun read(): NotificationState = state.first()

    /** Atomic read-modify-write; returns the new state. */
    suspend fun update(change: (NotificationState) -> NotificationState): NotificationState
}

internal suspend fun NotificationStore.updateServer(id: ServerId, change: (ServerNotifState) -> ServerNotifState): NotificationState =
    update { it.withServer(id, change) }

/** For tests and previews. */
internal class InMemoryNotificationStore(initial: NotificationState = NotificationState()) : NotificationStore {
    private val mutex = Mutex()
    private val flow = MutableStateFlow(initial)
    override val state: Flow<NotificationState> = flow.asStateFlow()
    val current: NotificationState get() = flow.value

    override suspend fun read(): NotificationState = flow.value

    override suspend fun update(change: (NotificationState) -> NotificationState): NotificationState = mutex.withLock {
        change(flow.value).also { flow.value = it }
    }
}

internal class DataStoreNotificationStore(private val dataStore: DataStore<Preferences>) : NotificationStore {
    override val state: Flow<NotificationState> = dataStore.data.map { decode(it[KEY]) }

    override suspend fun update(change: (NotificationState) -> NotificationState): NotificationState {
        var out = NotificationState()
        dataStore.edit { prefs ->
            out = change(decode(prefs[KEY]))
            prefs[KEY] = JSON.encodeToString(NotificationState.serializer(), out)
        }
        return out
    }

    companion object {
        private val KEY = stringPreferencesKey("state")
        private val JSON = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

        /** A corrupted or older blob never breaks the app: it starts over (marks baseline again). */
        fun decode(raw: String?): NotificationState = raw?.let {
            runCatching { JSON.decodeFromString(NotificationState.serializer(), it) }.getOrNull()
        } ?: NotificationState()

        fun encode(state: NotificationState): String = JSON.encodeToString(NotificationState.serializer(), state)
    }
}

/** ONE DataStore per process for the file (DataStore refuses two instances on the same file). */
internal object NotificationStores {
    private const val FILE = "obli_notifications"

    @Volatile private var instance: NotificationStore? = null

    fun dataStore(context: Context): NotificationStore = instance ?: synchronized(this) {
        instance ?: DataStoreNotificationStore(
            PreferenceDataStoreFactory.create(
                corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
                produceFile = { context.applicationContext.preferencesDataStoreFile(FILE) },
            ),
        ).also { instance = it }
    }
}
