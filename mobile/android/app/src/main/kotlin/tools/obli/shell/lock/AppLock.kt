package tools.obli.shell.lock

import android.app.Application
import android.os.Build
import android.os.SystemClock
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import tools.obli.shell.R
import tools.obli.shell.core.ShellPrefs

/**
 * Biometric / device-credential app lock. Locked at cold start and when the app
 * returns after [LockPolicy.BACKGROUND_TIMEOUT_MS] in the background. The state
 * is Compose-observable so every activity can draw its lock overlay.
 */
object AppLock {
    var locked by mutableStateOf(false)
        private set

    /** True while the process is in the foreground (any activity started). */
    var inForeground = false
        private set

    private var backgroundedAt = 0L
    private var prompting = false

    /** One automatic prompt per foreground session; after a cancel the lock screen's button asks again. */
    private var autoPrompted = false
    private lateinit var prefs: ShellPrefs

    fun install(app: Application, prefs: ShellPrefs) {
        this.prefs = prefs
        locked = prefs.lockEnabled
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                inForeground = true
                if (LockPolicy.shouldLockOnForeground(prefs.lockEnabled, backgroundedAt, SystemClock.elapsedRealtime())) {
                    locked = true
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                inForeground = false
                autoPrompted = false
                backgroundedAt = SystemClock.elapsedRealtime()
            }
        })
    }

    /** BIOMETRIC_STRONG or the device PIN/pattern; API 28-29 cannot combine STRONG with a credential. */
    fun authenticators(): Int =
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.P || Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
            BIOMETRIC_WEAK or DEVICE_CREDENTIAL
        } else {
            BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        }

    fun canAuthenticate(activity: FragmentActivity): Boolean =
        BiometricManager.from(activity).canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS

    fun onLockEnabledChanged(enabled: Boolean) {
        if (!enabled) locked = false
    }

    /** Called from onResume: prompts at most once per foreground session. */
    fun autoPromptIfLocked(activity: FragmentActivity, onDisabled: () -> Unit = {}) {
        if (!locked || autoPrompted) return
        autoPrompted = true
        promptIfLocked(activity, onDisabled)
    }

    /**
     * Asks for authentication when locked. If the device no longer has any
     * screen lock or biometric, the lock cannot protect anything: it is turned
     * off instead of locking the user out ([onDisabled] explains why).
     */
    fun promptIfLocked(activity: FragmentActivity, onDisabled: () -> Unit = {}) {
        if (!locked || prompting) return
        if (!prefs.lockEnabled) {
            locked = false
            return
        }
        if (!canAuthenticate(activity)) {
            prefs.lockEnabled = false
            locked = false
            onDisabled()
            return
        }
        authenticate(activity, activity.getString(R.string.lock_prompt_title)) { ok -> if (ok) locked = false }
    }

    /** One authentication (also used to confirm enabling the lock). */
    fun authenticate(activity: FragmentActivity, title: String, onResult: (Boolean) -> Unit) {
        if (prompting) return
        prompting = true
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    prompting = false
                    onResult(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    prompting = false
                    onResult(false)
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(activity.getString(R.string.lock_prompt_subtitle, activity.getString(R.string.app_name)))
            .setAllowedAuthenticators(authenticators())
            .build()
        try {
            prompt.authenticate(info)
        } catch (_: RuntimeException) {
            prompting = false
            onResult(false)
        }
    }
}
