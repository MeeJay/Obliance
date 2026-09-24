package tools.obli.shell.core

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import tools.obli.shell.nav.ServerMeta

/**
 * All persisted settings, in one SharedPreferences file. Values tied to a server
 * (Obligate origin, linked apps, alert mark, pending update) are wiped by
 * [clearServerScoped] whenever the server changes.
 */
class ShellPrefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("obli_shell", Context.MODE_PRIVATE)

    var serverUrl: String?
        get() = sp.getString(K_SERVER, null)?.takeIf { it.isNotBlank() }
        set(v) = sp.edit { putString(K_SERVER, v) }

    var obligateOrigin: String?
        get() = sp.getString(K_OBLIGATE, null)?.takeIf { it.isNotBlank() }
        set(v) = sp.edit { putString(K_OBLIGATE, v) }

    @Volatile private var linkedCache: Pair<String?, Map<String, String?>>? = null

    var linkedApps: Map<String, String?>
        get() {
            val raw = sp.getString(K_LINKED, null)
            linkedCache?.let { if (it.first == raw) return it.second }
            return ServerMeta.decodeLinkedApps(raw).also { linkedCache = raw to it }
        }
        set(v) {
            val raw = ServerMeta.encodeLinkedApps(v)
            sp.edit { putString(K_LINKED, raw); putLong(K_LINKED_AT, System.currentTimeMillis()) }
            linkedCache = raw to v
        }

    val linkedAppsFetchedAt: Long get() = sp.getLong(K_LINKED_AT, 0L)

    var alertsEnabled: Boolean
        get() = sp.getBoolean(K_ALERTS, false)
        set(v) = sp.edit { putBoolean(K_ALERTS, v) }

    /** Highest live-alert id already seen; null = not recorded yet. */
    var alertsHighWater: Long?
        get() = sp.getLong(K_ALERTS_MARK, -1L).takeIf { it >= 0 }
        set(v) = sp.edit { putLong(K_ALERTS_MARK, v ?: -1L) }

    /** Set on 401: background polling pauses until the app is opened again. */
    var alertsPausedForAuth: Boolean
        get() = sp.getBoolean(K_ALERTS_AUTH, false)
        set(v) = sp.edit { putBoolean(K_ALERTS_AUTH, v) }

    var lockEnabled: Boolean
        get() = sp.getBoolean(K_LOCK, false)
        set(v) = sp.edit { putBoolean(K_LOCK, v) }

    var blockScreenshots: Boolean
        get() = sp.getBoolean(K_SECURE, false)
        set(v) = sp.edit { putBoolean(K_SECURE, v) }

    var lastUpdateCheckAt: Long
        get() = sp.getLong(K_UPDATE_AT, 0L)
        set(v) = sp.edit { putLong(K_UPDATE_AT, v) }

    /** The update download in flight (DownloadManager id), with what it must match. */
    var pendingUpdate: PendingUpdate?
        get() {
            val id = sp.getLong(K_PU_ID, -1L)
            if (id < 0) return null
            return PendingUpdate(
                downloadId = id,
                versionCode = sp.getInt(K_PU_VC, 0),
                versionName = sp.getString(K_PU_VN, null).orEmpty(),
                sha256 = sp.getString(K_PU_SHA, null).orEmpty(),
                signerSha256 = sp.getString(K_PU_SIGNER, null),
                fileName = sp.getString(K_PU_FILE, null).orEmpty(),
            )
        }
        set(v) = sp.edit {
            if (v == null) {
                remove(K_PU_ID); remove(K_PU_VC); remove(K_PU_VN); remove(K_PU_SHA); remove(K_PU_SIGNER); remove(K_PU_FILE)
            } else {
                putLong(K_PU_ID, v.downloadId); putInt(K_PU_VC, v.versionCode); putString(K_PU_VN, v.versionName)
                putString(K_PU_SHA, v.sha256); putString(K_PU_SIGNER, v.signerSha256); putString(K_PU_FILE, v.fileName)
            }
        }

    /** A verified APK waiting for the "install unknown apps" permission. */
    var verifiedUpdateFile: String?
        get() = sp.getString(K_VERIFIED, null)
        set(v) = sp.edit { putString(K_VERIFIED, v) }

    var installAfterPermission: Boolean
        get() = sp.getBoolean(K_INSTALL_AFTER, false)
        set(v) = sp.edit { putBoolean(K_INSTALL_AFTER, v) }

    fun clearServerScoped() = sp.edit {
        remove(K_OBLIGATE); remove(K_LINKED); remove(K_LINKED_AT)
        remove(K_ALERTS_MARK); remove(K_ALERTS_AUTH); remove(K_UPDATE_AT)
        remove(K_PU_ID); remove(K_PU_VC); remove(K_PU_VN); remove(K_PU_SHA); remove(K_PU_SIGNER); remove(K_PU_FILE)
        remove(K_VERIFIED); remove(K_INSTALL_AFTER)
    }.also { linkedCache = null }

    data class PendingUpdate(
        val downloadId: Long,
        val versionCode: Int,
        val versionName: String,
        val sha256: String,
        val signerSha256: String?,
        val fileName: String,
    )

    private companion object {
        const val K_SERVER = "server_url"
        const val K_OBLIGATE = "obligate_origin"
        const val K_LINKED = "linked_apps"
        const val K_LINKED_AT = "linked_apps_at"
        const val K_ALERTS = "alerts_enabled"
        const val K_ALERTS_MARK = "alerts_high_water"
        const val K_ALERTS_AUTH = "alerts_paused_auth"
        const val K_LOCK = "lock_enabled"
        const val K_SECURE = "block_screenshots"
        const val K_UPDATE_AT = "update_checked_at"
        const val K_PU_ID = "pu_download_id"
        const val K_PU_VC = "pu_version_code"
        const val K_PU_VN = "pu_version_name"
        const val K_PU_SHA = "pu_sha256"
        const val K_PU_SIGNER = "pu_signer"
        const val K_PU_FILE = "pu_file"
        const val K_VERIFIED = "update_verified_file"
        const val K_INSTALL_AFTER = "update_install_after_permission"
    }
}
