package tools.obli.shell.bridge

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Values published to the page as `window.__obli_native` (contract §2). */
data class NativeInfo(
    val app: String,
    val appVersion: String,
    val versionCode: Int,
    val bridgeVersion: Int = BridgeProtocol.BRIDGE_VERSION,
    val capabilities: List<String> = BridgeProtocol.CAPABILITIES,
)

/**
 * The document-start script (WebViewCompat.addDocumentStartJavaScript, allowed
 * only for the configured server origin). It defines:
 *
 *  - `window.__obli_native` — frozen detection object;
 *  - `window.ObliNative` — Promise wrappers over `__obliBridge.postMessage`,
 *    correlating replies by numeric id.
 *
 * The `__obliBridge` object is injected by addWebMessageListener; it is looked
 * up lazily at call time so the wrapper never depends on injection order.
 */
object BridgeScript {
    fun build(info: NativeInfo): String {
        val infoJson = buildJsonObject {
            put("platform", "android")
            put("app", info.app)
            put("appVersion", info.appVersion)
            put("versionCode", info.versionCode)
            put("bridgeVersion", info.bridgeVersion)
            put("capabilities", JsonArray(info.capabilities.map { JsonPrimitive(it) }))
        }.toString()
        val channel = JsonPrimitive(BridgeProtocol.JS_OBJECT_NAME).toString()
        return TEMPLATE
            .replace("__INFO__", infoJson)
            .replace("__CHANNEL__", channel)
    }

    private val TEMPLATE = """
(function () {
  'use strict';
  if (window.__obli_native && window.ObliNative) { return; }
  var INFO = __INFO__;
  var CHANNEL = __CHANNEL__;
  var freeze = Object.freeze || function (o) { return o; };
  INFO.capabilities = freeze(INFO.capabilities.slice());
  var seq = 0;
  var pending = {};
  var channel = null;

  function onReply(ev) {
    var msg;
    try { msg = JSON.parse(ev && ev.data); } catch (e) { return; }
    if (!msg || typeof msg.id !== 'number') { return; }
    var p = pending[msg.id];
    if (!p) { return; }
    delete pending[msg.id];
    if (msg.ok === true) { p.resolve(msg.result); }
    else { p.reject(new Error(typeof msg.error === 'string' ? msg.error : 'native bridge error')); }
  }

  function getChannel() {
    if (channel) { return channel; }
    var c = window[CHANNEL];
    if (!c || typeof c.postMessage !== 'function') { return null; }
    if (typeof c.addEventListener === 'function') { c.addEventListener('message', onReply); }
    else { c.onmessage = onReply; }
    channel = c;
    return c;
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var c = getChannel();
      if (!c) { reject(new Error('native bridge unavailable')); return; }
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      try {
        c.postMessage(JSON.stringify({ id: id, method: method, params: params || {} }));
      } catch (e) {
        delete pending[id];
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  var api = {
    saveFile: function (filename, mime, base64) { return call('saveFile', { filename: filename, mime: mime, base64: base64 }); },
    downloadUrl: function (url, filename) { return call('downloadUrl', { url: url, filename: filename }); },
    openExternal: function (url) { return call('openExternal', { url: url }); },
    copyText: function (text) { return call('copyText', { text: text }); },
    readClipboard: function () { return call('readClipboard', {}); },
    share: function (text, title) { return call('share', { text: text, title: title }); },
    notify: function (title, body, navigateTo) { return call('notify', { title: title, body: body, navigateTo: navigateTo }); },
    openSettings: function () { return call('openSettings', {}); },
    setSystemBars: function (colorHex, lightIcons) { return call('setSystemBars', { colorHex: colorHex, lightIcons: lightIcons }); },
    requestNotificationPermission: function () { return call('requestNotificationPermission', {}); },
    checkForUpdate: function (options) { return call('checkForUpdate', { prompt: !(options && options.prompt === false) }); },
    getInfo: function () { return call('getInfo', {}); }
  };

  function define(name, value) {
    try {
      Object.defineProperty(window, name, { value: value, writable: false, configurable: false, enumerable: false });
    } catch (e) {
      window[name] = value;
    }
  }
  define('__obli_native', freeze(INFO));
  define('ObliNative', freeze(api));
})();
"""
}
