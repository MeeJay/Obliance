package tools.obli.obliance.more

import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The app preferences on a real Preferences DataStore file (Robolectric). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppSettingsStoreTest {
    private lateinit var file: File

    @Before fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        file = File(context.filesDir, "datastore/test_app_prefs_${System.nanoTime()}.preferences_pb")
    }

    @After fun tearDown() {
        file.delete()
    }

    /** Opens a store on [file], runs [block], then closes it (the DataStore releases the file). */
    private fun <T> withStore(block: suspend (AppSettingsStore) -> T): T = runBlocking {
        val job = SupervisorJob()
        val store = AppSettingsStore.create(CoroutineScope(job + Dispatchers.IO)) { file }
        try {
            block(store)
        } finally {
            job.cancelAndJoin()
        }
    }

    @Test fun `defaults are follow the server, no auto night, 5 min, screenshots allowed, lock undecided`() {
        val prefs = withStore { it.read() }
        assertEquals(ThemeMode.FOLLOW_SERVER, prefs.themeMode)
        assertEquals(false, prefs.autoNight)
        assertEquals(LockTimeout.FIVE_MIN, prefs.lockTimeout)
        assertEquals(false, prefs.blockScreenshots)
        assertNull(prefs.lockEnabled)
        // Undecided: not armed until S04 step 3 is answered.
        assertTrue(prefs.lockUndecided)
        assertFalse(prefs.lockWanted)
        assertEquals(AppPrefs(), prefs)
    }

    @Test fun `every setter persists across a new store instance`() {
        withStore { s ->
            s.setLockEnabled(false)
            s.setLockTimeout(LockTimeout.FIFTEEN_MIN)
            s.setBlockScreenshots(true)
            s.setThemeMode(ThemeMode.NIGHT)
            s.setAutoNight(true)
        }
        val reopened = withStore { s ->
            // The StateFlow follows the file too.
            s.loaded.first { it }
            s.prefs.first { it.themeMode == ThemeMode.NIGHT }
        }
        assertEquals(
            AppPrefs(lockEnabled = false, lockTimeout = LockTimeout.FIFTEEN_MIN, blockScreenshots = true, themeMode = ThemeMode.NIGHT, autoNight = true),
            reopened,
        )
        withStore { s ->
            s.setLockEnabled(true)
            s.setLockTimeout(LockTimeout.IMMEDIATE)
            s.setThemeMode(ThemeMode.OPERATOR)
        }
        val again = withStore { it.read() }
        assertEquals(true, again.lockEnabled)
        assertEquals(LockTimeout.IMMEDIATE, again.lockTimeout)
        assertEquals(ThemeMode.OPERATOR, again.themeMode)
        assertEquals(true, again.blockScreenshots)
    }

    @Test fun `update bookkeeping persists and clears`() {
        val pending = PendingDownload(42L, 301, "0.3.1-alpha", "a".repeat(64), "b".repeat(64), "obliance-update-301.apk", "Obliance Prod")
        withStore { s ->
            s.setLastUpdateCheckAt(1_790_298_840_000L)
            s.setPendingDownload(pending)
            s.setVerifiedUpdate(VerifiedUpdate("/x/obliance-update-301.apk", "0.3.1-alpha", 301))
        }
        withStore { s ->
            assertEquals(1_790_298_840_000L, s.lastUpdateCheckAt())
            assertEquals(pending, s.pendingDownload())
            assertEquals(VerifiedUpdate("/x/obliance-update-301.apk", "0.3.1-alpha", 301), s.verifiedUpdate())
            s.setPendingDownload(null)
            s.setVerifiedUpdate(null)
        }
        withStore { s ->
            assertNull(s.pendingDownload())
            assertNull(s.verifiedUpdate())
            // User preferences are untouched by the bookkeeping.
            assertEquals(AppPrefs(), s.read())
        }
    }

    @Test fun `an unknown stored value falls back to the default`() {
        withStore { s -> s.setThemeMode(ThemeMode.NIGHT) }
        // A newer app wrote a value this build does not know.
        runBlocking {
            val job = SupervisorJob()
            val ds = androidx.datastore.preferences.core.PreferenceDataStoreFactory.create(scope = CoroutineScope(job + Dispatchers.IO)) { file }
            ds.edit { it[AppSettingsStore.THEME_MODE] = "SEPIA"; it[AppSettingsStore.LOCK_TIMEOUT] = "ONE_HOUR" }
            job.cancelAndJoin()
        }
        val prefs = withStore { it.read() }
        assertEquals(ThemeMode.FOLLOW_SERVER, prefs.themeMode)
        assertEquals(LockTimeout.FIVE_MIN, prefs.lockTimeout)
    }
}
