package tools.obli.shell.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeProtocolTest {
    private fun ok(raw: String) = (BridgeProtocol.parse(raw) as BridgeProtocol.Parsed.Ok).request
    private fun err(raw: String?) = BridgeProtocol.parse(raw) as BridgeProtocol.Parsed.Error

    @Test fun parsesNamedParams() {
        val r = ok("""{"id":7,"method":"saveFile","params":{"filename":"a.csv","mime":"text/csv","base64":"aGk="}}""")
        assertEquals(7L, r.id)
        assertEquals("saveFile", r.method)
        assertEquals("a.csv", r.params.string("filename", 100))
        assertEquals("text/csv", r.params.optString("mime", 100))
    }

    @Test fun parsesPositionalParams() {
        val r = ok("""{"id":1,"method":"setSystemBars","params":["#0f1220",false]}""")
        assertEquals("#0f1220", r.params.string("colorHex", 16))
        assertFalse(r.params.bool("lightTheme", default = true))
        assertEquals(false, r.params.optBool("lightTheme"))
        val light = ok("""{"id":1,"method":"setSystemBars","params":["#ffffff",true]}""")
        assertEquals(true, light.params.optBool("lightTheme"))
        val bare = ok("""{"id":1,"method":"setSystemBars","params":["#ffffff"]}""")
        assertNull(bare.params.optBool("lightTheme"))
    }

    @Test fun missingParamsAreEmpty() {
        val r = ok("""{"id":2,"method":"getInfo"}""")
        assertNull(r.params.optString("anything", 10))
    }

    @Test fun rejectsUnknownMethodWithItsId() {
        val e = err("""{"id":3,"method":"rm -rf","params":{}}""")
        assertEquals(3L, e.id)
        assertTrue(e.message.contains("unknown method"))
    }

    @Test fun rejectsBrokenMessagesWithoutId() {
        assertNull(err(null).id)
        assertNull(err("not json").id)
        assertNull(err("""{"method":"getInfo"}""").id)
        assertNull(err("""{"id":"7","method":"getInfo"}""").id)
        assertEquals(4L, err("""{"id":4}""").id)
        assertEquals(5L, err("""{"id":5,"method":"getInfo","params":"x"}""").id)
        assertEquals(6L, err("""{"id":6,"method":"openExternal","params":["a","b"]}""").id)
    }

    @Test fun paramTypesAreEnforced() {
        val r = ok("""{"id":1,"method":"notify","params":{"title":5,"body":"x","navigateTo":{"a":1}}}""")
        assertThrows { r.params.string("title", 10) }
        assertThrows { r.params.optString("navigateTo", 10) }
        val s = ok("""{"id":1,"method":"setSystemBars","params":{"colorHex":"#000","lightTheme":"true"}}""")
        assertThrows { s.params.bool("lightTheme", default = false) }
        assertThrows { s.params.optBool("lightTheme") }
        val t = ok("""{"id":1,"method":"copyText","params":{"text":""}}""")
        assertThrows { t.params.string("text", 10) }
        assertEquals("", t.params.string("text", 10, allowEmpty = true))
        val u = ok("""{"id":1,"method":"copyText","params":{"text":"0123456789X"}}""")
        assertThrows { u.params.string("text", 10) }
    }

    @Test fun responsesAreWellFormed() {
        val okJson = Json.parseToJsonElement(BridgeProtocol.success(9, JsonPrimitive("granted"))).jsonObject
        assertEquals(9L, okJson["id"]!!.jsonPrimitive.long)
        assertTrue(okJson["ok"]!!.jsonPrimitive.boolean)
        assertEquals("granted", okJson["result"]!!.jsonPrimitive.content)
        val errJson = Json.parseToJsonElement(BridgeProtocol.failure(10, "bad \"quote\"")).jsonObject
        assertFalse(errJson["ok"]!!.jsonPrimitive.boolean)
        assertEquals("bad \"quote\"", errJson["error"]!!.jsonPrimitive.content)
    }

    @Test fun contractMethodsAndCapabilities() {
        assertEquals(
            setOf(
                "saveFile", "downloadUrl", "openExternal", "copyText", "readClipboard", "share", "notify",
                "openSettings", "setSystemBars", "requestNotificationPermission", "checkForUpdate", "getInfo",
            ),
            BridgeProtocol.METHODS.keys,
        )
        assertEquals(
            listOf("saveFile", "downloadUrl", "openExternal", "clipboard", "share", "notify", "settings", "back", "systemBars", "update"),
            BridgeProtocol.CAPABILITIES,
        )
    }

    private fun assertThrows(block: () -> Unit) {
        try {
            block()
        } catch (_: BridgeParamException) {
            return
        }
        throw AssertionError("expected BridgeParamException")
    }
}
