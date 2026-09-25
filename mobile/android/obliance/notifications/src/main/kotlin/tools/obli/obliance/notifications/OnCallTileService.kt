package tools.obli.obliance.notifications

import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Quick Settings tile « Astreinte » (design doc §9 #3): active = on-call
 * enabled; subtitle "1 critique" (unread critical alerts of every server at
 * the last pass, Android 10+); a tap toggles on-call. A long press opens the
 * app's activity declared for `QS_TILE_PREFERENCES` (S84).
 */
class OnCallTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private fun store(): NotificationStore = ObliNotifications.runtime?.store ?: NotificationStores.dataStore(applicationContext)

    override fun onStartListening() {
        super.onStartListening()
        refresh()
    }

    override fun onClick() {
        super.onClick()
        scope.launch {
            withContext(Dispatchers.Default) {
                store().update { it.copy(onCall = it.onCall.copy(enabled = !it.onCall.enabled)) }
            }
            ObliNotifications.sync(applicationContext)
            refresh()
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun refresh() {
        scope.launch {
            val state = withContext(Dispatchers.Default) { store().read() }
            val tile = qsTile ?: return@launch
            val critical = state.servers.values.sumOf { it.lastCriticalUnread }
            tile.label = getString(R.string.notif_tile_label)
            tile.state = if (state.onCall.enabled) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = if (critical > 0) resources.getQuantityString(R.plurals.notif_tile_critical, critical, critical) else null
            }
            tile.updateTile()
        }
    }

    companion object {
        /** Asks the system to refresh the tile (on-call changed in S84). */
        internal fun requestRefresh(context: Context) {
            runCatching { requestListeningState(context, ComponentName(context, OnCallTileService::class.java)) }
        }
    }
}
