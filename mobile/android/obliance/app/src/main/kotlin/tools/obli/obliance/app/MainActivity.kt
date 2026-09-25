package tools.obli.obliance.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.MutableStateFlow
import tools.obli.core.designsystem.ObliTheme
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.remote.RemoteSessionService

/** A FragmentActivity so the action host can show BiometricPrompt (T2/T3, design doc §7.6). */
class MainActivity : FragmentActivity() {
    /** Remote session to resume, from a tap on the sessions notification (design doc §2.6). */
    private val resumeSession = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Dark only: light icons on transparent system bars.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        val host = application as ObliServicesHost
        // A recreation (rotation) keeps the original intent: only a fresh start resumes from it.
        if (savedInstanceState == null) takeResume(intent)
        setContent {
            val ready by host.ready.collectAsStateWithLifecycle()
            val resume by resumeSession.collectAsStateWithLifecycle()
            ObliTheme(variant = rememberActiveServerTheme(host.services)) {
                CompositionLocalProvider(LocalObliServices provides host.services) {
                    ObliNextApp(ready = ready, resumeSessionId = resume, onResumeHandled = { resumeSession.value = null })
                }
            }
        }
    }

    // singleTask: a tap on the notification while the app runs arrives here.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        takeResume(intent)
    }

    /** Takes the session id out of the intent, so a recreation does not resume it again. */
    private fun takeResume(intent: Intent?) {
        val id = intent?.getStringExtra(RemoteSessionService.EXTRA_SESSION_ID) ?: return
        intent.removeExtra(RemoteSessionService.EXTRA_SESSION_ID)
        resumeSession.value = id
    }
}
