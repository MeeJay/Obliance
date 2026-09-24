package tools.obli.shell.bridge

import java.io.File
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class BridgeScriptTest {
    private val info = NativeInfo(app = "obliance", appVersion = "1.0.0", versionCode = 10000)
    private val script = BridgeScript.build(info)

    @Test fun embedsTheContractValues() {
        assertTrue(script.contains("\"platform\":\"android\""))
        assertTrue(script.contains("\"app\":\"obliance\""))
        assertTrue(script.contains("\"appVersion\":\"1.0.0\""))
        assertTrue(script.contains("\"versionCode\":10000"))
        assertTrue(script.contains("\"bridgeVersion\":1"))
        assertTrue(script.contains("\"capabilities\":[\"saveFile\",\"downloadUrl\""))
        assertTrue(script.contains("var CHANNEL = \"__obliBridge\";"))
        assertFalse(script.contains("__INFO__"))
        assertFalse(script.contains("__CHANNEL__"))
    }

    @Test fun neverUsesTheDesktopFlags() {
        assertFalse(script.contains("_is_native_app"))
    }

    @Test fun exposesEveryContractMethod() {
        for (method in BridgeProtocol.METHODS.keys) {
            assertTrue("missing $method", script.contains("$method: function"))
            assertTrue("missing call for $method", script.contains("call('$method'"))
        }
    }

    @Test fun valuesAreJsonEscaped() {
        val s = BridgeScript.build(NativeInfo("x\"</script>", "1.0.0'", 1))
        assertTrue(s.contains("\"app\":\"x\\\"</script>\""))
    }

    /**
     * Runs the generated script in Node (when available) against a fake
     * __obliBridge: request shape, id correlation, resolve and reject paths,
     * frozen globals, and the "bridge unavailable" path.
     */
    @Test fun behavesInAJavaScriptEngine() {
        val node = findNode()
        assumeTrue("node not available", node != null)
        val outDir = File(System.getProperty("obli.test.out") ?: "build/test-out").apply { mkdirs() }
        val scriptFile = File(outDir, "obli-bridge.js").apply { writeText(script) }
        val harness = File(outDir, "obli-bridge-harness.js").apply { writeText(HARNESS) }
        val proc = ProcessBuilder(node, harness.absolutePath, scriptFile.absolutePath)
            .redirectErrorStream(true)
            .start()
        val finished = proc.waitFor(60, TimeUnit.SECONDS)
        val output = proc.inputStream.bufferedReader().readText()
        assertTrue("node timed out", finished)
        assertEquals("node harness failed:\n$output", 0, proc.exitValue())
        assertTrue(output, output.contains("BRIDGE OK"))
    }

    private fun findNode(): String? {
        val candidates = listOf("node", "node.exe", "C:\\Program Files\\nodejs\\node.exe")
        for (c in candidates) {
            try {
                val p = ProcessBuilder(c, "--version").redirectErrorStream(true).start()
                if (p.waitFor(20, TimeUnit.SECONDS) && p.exitValue() == 0) return c
            } catch (_: Exception) {
                // try the next one
            }
        }
        return null
    }

    private companion object {
        val HARNESS = """
            'use strict';
            const fs = require('fs');
            const src = fs.readFileSync(process.argv[2], 'utf8');
            function fail(m) { console.error('FAIL: ' + m); process.exit(1); }
            function assert(c, m) { if (!c) fail(m); }

            // 1. With a bridge channel.
            const sent = [];
            let listener = null;
            const channel = {
              postMessage(m) { assert(typeof m === 'string', 'postMessage takes a string'); sent.push(JSON.parse(m)); },
              addEventListener(type, l) { if (type === 'message') listener = l; },
            };
            const win = { __obliBridge: channel };
            new Function('window', src)(win);
            const n = win.__obli_native;
            assert(n && n.platform === 'android' && n.app === 'obliance', '__obli_native');
            assert(n.appVersion === '1.0.0' && n.versionCode === 10000 && n.bridgeVersion === 1, 'versions');
            assert(Array.isArray(n.capabilities) && n.capabilities.includes('saveFile') && n.capabilities.includes('back'), 'capabilities');
            assert(Object.isFrozen(n) && Object.isFrozen(win.ObliNative), 'frozen');
            try { win.ObliNative = null; } catch (e) { /* strict mode: read-only property */ }
            assert(win.ObliNative && typeof win.ObliNative.getInfo === 'function', 'ObliNative not replaceable');
            // Running the script twice must not redefine anything.
            new Function('window', src)(win);

            (async () => {
              const p1 = win.ObliNative.getInfo();
              assert(sent.length === 1, 'one message sent');
              assert(sent[0].method === 'getInfo' && typeof sent[0].id === 'number', 'request shape');
              const p2 = win.ObliNative.saveFile('a.csv', 'text/csv', 'aGk=');
              assert(sent[1].method === 'saveFile' && sent[1].params.filename === 'a.csv' && sent[1].params.mime === 'text/csv' && sent[1].params.base64 === 'aGk=', 'saveFile params');
              assert(sent[1].id !== sent[0].id, 'distinct ids');
              // Replies out of order, plus noise that must be ignored.
              listener({ data: 'garbage' });
              listener({ data: JSON.stringify({ id: 999, ok: true, result: 1 }) });
              listener({ data: JSON.stringify({ id: sent[1].id, ok: false, error: 'storage permission denied' }) });
              listener({ data: JSON.stringify({ id: sent[0].id, ok: true, result: { app: 'obliance', versionCode: 10000 } }) });
              const info = await p1;
              assert(info.app === 'obliance' && info.versionCode === 10000, 'resolved value');
              let rejected = null;
              try { await p2; } catch (e) { rejected = e; }
              assert(rejected instanceof Error && rejected.message === 'storage permission denied', 'rejected with the native error');
              win.ObliNative.setSystemBars('#0f1220', false);
              assert(sent[2].params.colorHex === '#0f1220' && sent[2].params.lightIcons === false, 'setSystemBars params');
              win.ObliNative.checkForUpdate({ prompt: false });
              assert(sent[3].params.prompt === false, 'checkForUpdate prompt=false');
              win.ObliNative.checkForUpdate();
              assert(sent[4].params.prompt === true, 'checkForUpdate default prompt');

              // 2. Without a bridge channel: calls reject, detection still works.
              const bare = {};
              new Function('window', src)(bare);
              assert(bare.__obli_native.platform === 'android', 'detection without channel');
              let err = null;
              try { await bare.ObliNative.copyText('x'); } catch (e) { err = e; }
              assert(err && /unavailable/.test(err.message), 'rejects when unavailable');
              console.log('BRIDGE OK');
            })().catch((e) => fail(e && e.stack || String(e)));
        """.trimIndent()
    }
}
