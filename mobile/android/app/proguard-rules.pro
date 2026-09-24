# R8 is ON for release. Everything below is about code that is reached by
# reflection or from native/WebView code, which R8 cannot see.

# --- JS bridge ---------------------------------------------------------------
# The WebView provider calls back into androidx.webkit through "boundary
# interfaces" (java.lang.reflect.Proxy + method names). androidx.webkit ships
# consumer rules for them; these are kept explicitly as a belt-and-braces
# guarantee that the release APK still receives __obliBridge messages.
-keep class org.chromium.support_lib_boundary.** { *; }
-keep class androidx.webkit.internal.** { *; }
-keep interface androidx.webkit.WebViewCompat$WebMessageListener { *; }
-keep class * implements androidx.webkit.WebViewCompat$WebMessageListener {
    public void onPostMessage(...);
}
-keep class androidx.webkit.JavaScriptReplyProxy { *; }
-keep class androidx.webkit.WebMessageCompat { *; }
-keep class androidx.webkit.ScriptHandler { *; }

# No addJavascriptInterface is used, but should one ever be added, its methods
# must survive minification.
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- WebView clients ----------------------------------------------------------
# Overridden framework callbacks are kept by R8 anyway (they override library
# methods); listed for readability of the mapping when debugging.
-keep class tools.obli.shell.web.ShellWebViewClient { *; }
-keep class tools.obli.shell.web.ShellChromeClient { *; }

# --- kotlinx.serialization (JsonElement API only, no generated serializers) --
-dontnote kotlinx.serialization.**
-dontwarn kotlinx.serialization.**

# Keep line numbers for readable crash reports (mapping.txt retraces them).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
