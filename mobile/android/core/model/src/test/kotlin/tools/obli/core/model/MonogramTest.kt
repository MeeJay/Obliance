package tools.obli.core.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class MonogramTest {
    @Test fun twoWords() = assertEquals("CD", Monogram.of("Client Durand"))
    @Test fun camelCase() = assertEquals("BH", Monogram.of("BinaryHearts"))
    @Test fun oneWord() = assertEquals("AT", Monogram.of("Atelier"))
    @Test fun punctuationAndCase() = assertEquals("RV", Monogram.of("  rmm.votre-msp "))
    @Test fun accents() = assertEquals("ÉC", Monogram.of("école centrale"))
    @Test fun nothingUsable() = assertEquals("?", Monogram.of(" -- "))
    @Test fun singleLetter() = assertEquals("X", Monogram.of("x"))

    // Proof for phase 0: the kotlinx.serialization compiler plugin works with
    // AGP 9 built-in Kotlin 2.2.10 (value class + enums + defaults round-trip).
    @Test fun serializationPluginRoundTrip() {
        val p = ServerProfile(
            id = ServerId("7f1c"), origin = "https://atelier.binaryhearts.me", displayName = "Atelier",
            color = ServerColor.TEAL, monogram = "AT", order = 1,
        )
        val json = Json.encodeToString(ServerProfile.serializer(), p)
        assertEquals(p, Json.decodeFromString(ServerProfile.serializer(), json))
        assertEquals(true, json.contains("\"id\":\"7f1c\""))
    }
}
