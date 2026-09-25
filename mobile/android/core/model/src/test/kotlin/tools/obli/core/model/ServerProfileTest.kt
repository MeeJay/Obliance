package tools.obli.core.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class ServerProfileTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; coerceInputValues = true }

    @Test fun profileWithoutViewFilterDecodesWithNoFilter() {
        // As written by the 0.2.0 app.
        val text = """{"id":"p","origin":"https://obliance-prod.example.org","displayName":"Obliance Prod","color":"VIOLET","monogram":"OP","order":0,"notify":"ALL","includeInTriage":true,"lastTenantId":1,"theme":null}"""
        val profile = json.decodeFromString(ServerProfile.serializer(), text)
        assertEquals(emptyList<Long>(), profile.viewFilter)
        assertEquals(1L, profile.lastTenantId)
    }

    @Test fun viewFilterRoundTrips() {
        val profile = ServerProfile(ServerId("p"), "https://obliance-prod.example.org", "Obliance Prod", ServerColor.VIOLET, "OP", 0, viewFilter = listOf(4L))
        val text = json.encodeToString(ServerProfile.serializer(), profile)
        assertEquals(profile, json.decodeFromString(ServerProfile.serializer(), text))
    }
}
