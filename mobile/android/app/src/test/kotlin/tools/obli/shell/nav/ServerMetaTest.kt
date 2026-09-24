package tools.obli.shell.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerMetaTest {
    private val ids = listOf("obliance", "obliview", "obliguard", "oblimap", "obliplan", "oblidesk", "oblihub")

    @Test fun parsesWrappedSsoConfig() {
        val body = """{"success":true,"data":{"obligateUrl":"https://SSO.example.com/","obligateReachable":true,"obligateEnabled":true}}"""
        val c = ServerMeta.parseSsoConfig(body)!!
        assertEquals("https://sso.example.com", c.obligateOrigin)
        assertTrue(c.enabled)
        assertTrue(c.reachable)
    }

    @Test fun ssoConfigWithoutObligate() {
        val c = ServerMeta.parseSsoConfig("""{"success":true,"data":{"obligateUrl":null,"obligateReachable":false,"obligateEnabled":false}}""")!!
        assertNull(c.obligateOrigin)
        assertFalse(c.enabled)
    }

    @Test fun nonObliAnswersAreRejected() {
        assertNull(ServerMeta.parseSsoConfig("<html>nginx</html>"))
        assertNull(ServerMeta.parseSsoConfig("""{"hello":"world"}"""))
        assertNull(ServerMeta.parseSsoConfig("[1,2]"))
        assertNull(ServerMeta.parseSsoConfig(""))
    }

    @Test fun parsesLinkedAppsFromManifest() {
        val body = """{"success":true,"data":{"name":"Obliance","color":"#8b5cf6","ssoPath":"/auth/sso-redirect",
            "linkedApps":[
              {"name":"Obliview","url":"https://view.example.com/","color":"#2bc4bd"},
              {"name":"Monitoring","url":"https://obliguard.example.com","color":"#f5a623"},
              {"name":"Custom","url":"https://custom.example.com","color":"#000"},
              {"name":"Hub","url":"https://hub.example.com","appType":"oblihub"},
              {"name":"broken","url":"not a url"}
            ]}}"""
        val map = ServerMeta.parseLinkedApps(body, ids)!!
        assertEquals("obliview", map["https://view.example.com"])
        assertEquals("obliguard", map["https://obliguard.example.com"])
        assertTrue(map.containsKey("https://custom.example.com"))
        assertNull(map["https://custom.example.com"])
        assertEquals("oblihub", map["https://hub.example.com"])
        assertEquals(4, map.size)
    }

    @Test fun linkedAppsMissingIsNull() {
        assertNull(ServerMeta.parseLinkedApps("""{"success":false,"error":"Authentication required"}""", ids))
    }

    @Test fun linkedAppsRoundTrip() {
        val map = mapOf("https://a.example.com" to "obliview", "https://b.example.com:8443" to null)
        assertEquals(map, ServerMeta.decodeLinkedApps(ServerMeta.encodeLinkedApps(map)))
        assertEquals(emptyMap<String, String?>(), ServerMeta.decodeLinkedApps(null))
    }
}
