package tools.obli.obliance.app

import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import tools.obli.core.designsystem.ObliTheme
import tools.obli.obliance.data.LocalObliServices

/** A FragmentActivity so the action host can show BiometricPrompt (T2/T3, design doc §7.6). */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Dark only: light icons on transparent system bars.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        val host = application as ObliServicesHost
        setContent {
            val ready by host.ready.collectAsStateWithLifecycle()
            ObliTheme(variant = rememberActiveServerTheme(host.services)) {
                CompositionLocalProvider(LocalObliServices provides host.services) {
                    ObliNextApp(ready = ready)
                }
            }
        }
    }
}
