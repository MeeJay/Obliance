package tools.obli.obliance.more

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** S83 "Thème": the active server's web theme (default), or a theme forced on this phone. */
enum class ThemeMode { FOLLOW_SERVER, OPERATOR, NIGHT }

/** S83 "Verrouiller après": time in the background after which the app locks again. */
enum class LockTimeout(val millis: Long) {
    IMMEDIATE(0),
    ONE_MIN(60_000),
    FIVE_MIN(300_000),
    FIFTEEN_MIN(900_000),
}

/**
 * Preferences of THIS phone (design doc S83), not of an account or a server.
 *
 * [lockEnabled] null = never decided: S04 step 3 « Verrouiller Obliance »
 * ([LockOnboardingDialog], [Activer] first, as the design doc's "activé par
 * défaut") has not been answered yet. The lock is NOT armed meanwhile: a phone
 * coming from 0.2.0 (no lock) never meets a lock it did not choose.
 */
data class AppPrefs(
    val lockEnabled: Boolean? = null,
    val lockTimeout: LockTimeout = LockTimeout.FIVE_MIN,
    val blockScreenshots: Boolean = false,
    val themeMode: ThemeMode = ThemeMode.FOLLOW_SERVER,
    val autoNight: Boolean = false,
) {
    /** The lock turned on by the user (S04 step 3 or S83); the device must still have a screen lock. */
    val lockWanted: Boolean get() = lockEnabled == true

    /** S04 step 3 not answered yet. */
    val lockUndecided: Boolean get() = lockEnabled == null
}

/**
 * The app preferences on a Preferences DataStore. [prefs] starts with the
 * defaults and follows the file; [loaded] turns true after the first read.
 * Unreadable or corrupted content reads as the defaults (never a crash).
 */
class AppSettingsStore internal constructor(
    private val dataStore: DataStore<Preferences>,
    scope: CoroutineScope,
) {
    private val _prefs = MutableStateFlow(AppPrefs())
    val prefs: StateFlow<AppPrefs> = _prefs.asStateFlow()

    private val _loaded = MutableStateFlow(false)

    /** True once the file has been read at least once (the lock gate waits for it before prompting). */
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    private val data: Flow<Preferences> = dataStore.data.catch { e -> if (e is IOException) emit(emptyPreferences()) else throw e }

    init {
        scope.launch {
            data.map(::decode).collect {
                _prefs.value = it
                _loaded.value = true
            }
        }
    }

    suspend fun setLockEnabled(enabled: Boolean) = edit { it[LOCK_ENABLED] = enabled }

    suspend fun setLockTimeout(timeout: LockTimeout) = edit { it[LOCK_TIMEOUT] = timeout.name }

    suspend fun setBlockScreenshots(block: Boolean) = edit { it[BLOCK_SCREENSHOTS] = block }

    suspend fun setThemeMode(mode: ThemeMode) = edit { it[THEME_MODE] = mode.name }

    suspend fun setAutoNight(enabled: Boolean) = edit { it[AUTO_NIGHT] = enabled }

    /** Reads the file now (tests, and callers that cannot wait for [prefs]). */
    internal suspend fun read(): AppPrefs = decode(data.first())

    // --- Update bookkeeping (not user preferences) --------------------------------

    internal suspend fun lastUpdateCheckAt(): Long = data.first()[LAST_UPDATE_CHECK] ?: 0L

    internal suspend fun setLastUpdateCheckAt(at: Long) = edit { it[LAST_UPDATE_CHECK] = at }

    internal suspend fun pendingDownload(): PendingDownload? {
        val p = data.first()
        return PendingDownload(
            downloadId = p[PENDING_ID] ?: return null,
            versionCode = p[PENDING_CODE] ?: return null,
            versionName = p[PENDING_NAME] ?: return null,
            sha256 = p[PENDING_SHA] ?: return null,
            signerSha256 = p[PENDING_SIGNER] ?: return null,
            fileName = p[PENDING_FILE] ?: return null,
            serverName = p[PENDING_SERVER].orEmpty(),
        )
    }

    internal suspend fun setPendingDownload(pending: PendingDownload?) = edit {
        if (pending == null) {
            listOf(PENDING_ID, PENDING_CODE, PENDING_NAME, PENDING_SHA, PENDING_SIGNER, PENDING_FILE, PENDING_SERVER).forEach { k -> it.remove(k) }
        } else {
            it[PENDING_ID] = pending.downloadId
            it[PENDING_CODE] = pending.versionCode
            it[PENDING_NAME] = pending.versionName
            it[PENDING_SHA] = pending.sha256
            it[PENDING_SIGNER] = pending.signerSha256
            it[PENDING_FILE] = pending.fileName
            it[PENDING_SERVER] = pending.serverName
        }
    }

    /** Absolute path of an APK that passed the SHA-256 and signer checks, waiting for the installer. */
    internal suspend fun verifiedUpdate(): VerifiedUpdate? {
        val p = data.first()
        val path = p[VERIFIED_FILE] ?: return null
        return VerifiedUpdate(path, p[VERIFIED_NAME].orEmpty(), p[VERIFIED_CODE] ?: 0)
    }

    internal suspend fun setVerifiedUpdate(update: VerifiedUpdate?) = edit {
        if (update == null) {
            it.remove(VERIFIED_FILE)
            it.remove(VERIFIED_NAME)
            it.remove(VERIFIED_CODE)
        } else {
            it[VERIFIED_FILE] = update.path
            it[VERIFIED_NAME] = update.versionName
            it[VERIFIED_CODE] = update.versionCode
        }
    }

    /** A write is never cut halfway by the caller leaving (a screen closed right after a tap). */
    private suspend fun edit(change: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        withContext(NonCancellable) { dataStore.edit { change(it) } }
    }

    internal companion object {
        val LOCK_ENABLED = booleanPreferencesKey("lock_enabled")
        val LOCK_TIMEOUT = stringPreferencesKey("lock_timeout")
        val BLOCK_SCREENSHOTS = booleanPreferencesKey("block_screenshots")
        val THEME_MODE = stringPreferencesKey("theme_mode")
        val AUTO_NIGHT = booleanPreferencesKey("auto_night")
        val LAST_UPDATE_CHECK = longPreferencesKey("update_last_check_at")
        val PENDING_ID = longPreferencesKey("update_pending_id")
        val PENDING_CODE = intPreferencesKey("update_pending_code")
        val PENDING_NAME = stringPreferencesKey("update_pending_name")
        val PENDING_SHA = stringPreferencesKey("update_pending_sha256")
        val PENDING_SIGNER = stringPreferencesKey("update_pending_signer")
        val PENDING_FILE = stringPreferencesKey("update_pending_file")
        val PENDING_SERVER = stringPreferencesKey("update_pending_server")
        val VERIFIED_FILE = stringPreferencesKey("update_verified_file")
        val VERIFIED_NAME = stringPreferencesKey("update_verified_name")
        val VERIFIED_CODE = intPreferencesKey("update_verified_code")

        fun decode(p: Preferences): AppPrefs = AppPrefs(
            lockEnabled = p[LOCK_ENABLED],
            lockTimeout = p[LOCK_TIMEOUT]?.let { v -> LockTimeout.entries.firstOrNull { it.name == v } } ?: LockTimeout.FIVE_MIN,
            blockScreenshots = p[BLOCK_SCREENSHOTS] ?: false,
            themeMode = p[THEME_MODE]?.let { v -> ThemeMode.entries.firstOrNull { it.name == v } } ?: ThemeMode.FOLLOW_SERVER,
            autoNight = p[AUTO_NIGHT] ?: false,
        )

        /** A store over [file] (tests; the app uses [AppSettings.store]). */
        fun create(scope: CoroutineScope, file: () -> java.io.File): AppSettingsStore = AppSettingsStore(
            PreferenceDataStoreFactory.create(
                corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
                scope = scope,
                produceFile = file,
            ),
            scope,
        )
    }
}

/** A download enqueued by [AppUpdates], remembered until DOWNLOAD_COMPLETE (or the catch-up). */
internal data class PendingDownload(
    val downloadId: Long,
    val versionCode: Int,
    val versionName: String,
    val sha256: String,
    val signerSha256: String,
    val fileName: String,
    val serverName: String,
)

internal data class VerifiedUpdate(val path: String, val versionName: String, val versionCode: Int)

/** The process-wide [AppSettingsStore] (DataStore file `obli_app_prefs`). */
object AppSettings {
    const val FILE_NAME = "obli_app_prefs"

    @Volatile private var instance: AppSettingsStore? = null

    fun store(context: Context): AppSettingsStore = instance ?: synchronized(this) {
        instance ?: run {
            val app = context.applicationContext
            AppSettingsStore.create(CoroutineScope(SupervisorJob() + Dispatchers.IO)) { app.preferencesDataStoreFile(FILE_NAME) }
                .also { instance = it }
        }
    }
}
