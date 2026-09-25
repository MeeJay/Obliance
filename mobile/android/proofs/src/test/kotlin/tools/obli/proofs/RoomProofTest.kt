package tools.obli.proofs

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Runs the KSP-generated Room code for real (Robolectric SQLite). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RoomProofTest {
    @Test fun generatedDaoWorksAndPurgesPerServer() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), ProofDatabase::class.java)
            .allowMainThreadQueries().build()
        val dao = db.devices()
        dao.upsert(listOf(
            DeviceSnapshot("bh", 12, "SRV-AD2", "offline", 1),
            DeviceSnapshot("bh", 43, "PC-COMPTA-03", "critical", 1),
            DeviceSnapshot("cd", 5, "SRV-DURAND01", "offline", 1),
        ))
        assertEquals(listOf("PC-COMPTA-03", "SRV-AD2"), dao.forServer("bh").map { it.name })
        dao.purgeServer("bh")
        assertEquals(emptyList<DeviceSnapshot>(), dao.forServer("bh"))
        assertEquals(1, dao.forServer("cd").size)
        db.close()
    }
}
