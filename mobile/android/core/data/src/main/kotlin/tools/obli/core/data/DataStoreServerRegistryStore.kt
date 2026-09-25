package tools.obli.core.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import tools.obli.core.auth.ServerRegistryCodec
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.auth.ServerRegistryStore

private val Context.obliRegistry: DataStore<Preferences> by preferencesDataStore(name = "obli_servers")

/**
 * Persists the server registry as one JSON document in DataStore (the app has
 * allowBackup=false, so it never leaves the device). Unreadable content is
 * treated as "nothing stored": the registry then migrates the shell server again.
 */
class DataStoreServerRegistryStore(context: Context) : ServerRegistryStore {
    private val store = context.applicationContext.obliRegistry

    override suspend fun load(): ServerRegistryState? =
        ServerRegistryCodec.decode(store.data.first()[KEY])

    override suspend fun save(state: ServerRegistryState) {
        val text = ServerRegistryCodec.encode(state)
        store.edit { it[KEY] = text }
    }

    private companion object {
        val KEY = stringPreferencesKey("registry_v1")
    }
}
