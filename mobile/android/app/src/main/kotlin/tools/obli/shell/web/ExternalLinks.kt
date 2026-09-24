package tools.obli.shell.web

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast
import androidx.core.net.toUri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import java.net.URISyntaxException
import tools.obli.shell.BuildConfig
import tools.obli.shell.R
import tools.obli.shell.core.ObliApps
import tools.obli.shell.nav.Origins

/** Everything that leaves the WebView: Custom Tabs, other Obli shells, intents. */
object ExternalLinks {
    private const val TAG = "ObliLinks"

    /** Action understood by every Obli shell: open this URL of its own server. */
    const val ACTION_OPEN_URL = "tools.obli.action.OPEN_URL"

    private const val TOOLBAR = 0xFF0F1220.toInt()

    fun openCustomTab(context: Context, url: String) {
        if (Origins.of(url) == null) return
        val colors = CustomTabColorSchemeParams.Builder()
            .setToolbarColor(TOOLBAR)
            .setNavigationBarColor(TOOLBAR)
            .build()
        val intent = CustomTabsIntent.Builder()
            .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
            .setDefaultColorSchemeParams(colors)
            .setShowTitle(true)
            .build()
        try {
            intent.launchUrl(context, url.toUri())
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, R.string.error_no_browser, Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Opens [url] in the Android shell of [appId] when installed (it loads the
     * URL only if it belongs to its own configured server), else a Custom Tab.
     */
    fun openObliApp(context: Context, appId: String, url: String) {
        for (pkg in ObliApps.candidatePackages(appId, context.packageName)) {
            val intent = Intent(ACTION_OPEN_URL, url.toUri())
                .setPackage(pkg)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return
            } catch (_: ActivityNotFoundException) {
                // not installed: try the next candidate
            } catch (_: SecurityException) {
                // not exported for us
            }
        }
        openCustomTab(context, url)
    }

    /** mailto:, tel:, otpauth: and intent: URIs, handed to Android. */
    fun openExternalIntent(context: Context, url: String) {
        val scheme = Origins.scheme(url)
        val intent: Intent = if (scheme == "intent") {
            val parsed = try {
                Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
            } catch (_: URISyntaxException) {
                return
            }
            // Never let a web page target a specific (possibly private) component.
            parsed.component = null
            parsed.selector = null
            parsed.addCategory(Intent.CATEGORY_BROWSABLE)
            val fallback = parsed.getStringExtra("browser_fallback_url")
            try {
                context.startActivity(parsed.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: ActivityNotFoundException) {
                if (fallback != null && Origins.of(fallback) != null) openCustomTab(context, fallback)
                else Toast.makeText(context, R.string.error_no_app_for_link, Toast.LENGTH_SHORT).show()
            } catch (e: SecurityException) {
                if (BuildConfig.DEBUG) Log.d(TAG, "intent refused", e)
            }
            return
        } else {
            Intent(Intent.ACTION_VIEW, url.toUri())
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, R.string.error_no_app_for_link, Toast.LENGTH_SHORT).show()
        }
    }

    /** Opens the Play Store page of [packageName] (WebView update), browser fallback. */
    fun openStorePage(context: Context, packageName: String) {
        val market = Intent(Intent.ACTION_VIEW, "market://details?id=$packageName".toUri())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(market)
        } catch (_: ActivityNotFoundException) {
            openCustomTab(context, "https://play.google.com/store/apps/details?id=$packageName")
        }
    }
}
