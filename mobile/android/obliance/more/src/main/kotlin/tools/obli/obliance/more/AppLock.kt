package tools.obli.obliance.more

import android.app.Application
import android.content.Context
import android.os.SystemClock
import androidx.biometric.BiometricManager
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.Tier
import tools.obli.core.security.ui.BiometricAuthenticator

/** When the app lock engages (port of the WebView shell's LockPolicy). Pure, unit-tested. */
object LockPolicy {
    /**
     * Locked again when the app comes back after at least [timeoutMs] in the
     * background ([timeoutMs] 0 = any time in the background). [backgroundedAtMs]
     * and [nowMs] come from a monotonic clock (SystemClock.elapsedRealtime); 0
     * means "never went to the background". The thresholds are inclusive.
     */
    fun shouldLockOnForeground(enabled: Boolean, backgroundedAtMs: Long, nowMs: Long, timeoutMs: Long): Boolean {
        if (!enabled || backgroundedAtMs <= 0) return false
        // A monotonic clock never goes back, except across a reboot: lock.
        if (nowMs < backgroundedAtMs) return true
        return nowMs - backgroundedAtMs >= timeoutMs
    }
}

/**
 * State of the S00 lock for one process. Locked at cold start and after the
 * S83 delay in the background; never locked when the user turned the lock off
 * or when the phone has no screen lock (nothing could unlock it).
 */
internal class LockController(
    private val clock: () -> Long,
    private val canUse: () -> Boolean,
    initial: AppPrefs = AppPrefs(),
    /** Where [locked] is published (AppLock's process-wide flow in the app). */
    private val out: MutableStateFlow<Boolean> = MutableStateFlow(false),
) {
    private var prefs = initial
    private var available = canUse()

    /** Cold start: armed until the first unlock. */
    private var armed = true
    private var backgroundedAt = 0L
    private var prompting = false
    private var autoPrompted = false

    val locked: StateFlow<Boolean> = out.asStateFlow()

    init {
        publish()
    }

    @Synchronized
    fun onPrefs(next: AppPrefs) {
        prefs = next
        // Turning the lock off disarms it: turning it on again later must not lock at once.
        if (!next.lockWanted) armed = false
        publish()
    }

    @Synchronized
    fun onForeground() {
        available = canUse()
        if (LockPolicy.shouldLockOnForeground(prefs.lockWanted && available, backgroundedAt, clock(), prefs.lockTimeout.millis)) {
            armed = true
        }
        backgroundedAt = 0
        publish()
    }

    @Synchronized
    fun onBackground() {
        autoPrompted = false
        // The device-credential screen of the prompt is another app's activity:
        // leaving for it is not "going to the background".
        if (!prompting) backgroundedAt = clock()
    }

    @Synchronized
    fun unlock() {
        armed = false
        backgroundedAt = 0
        publish()
    }

    /** True once per foreground: the gate opens the system prompt by itself only then. */
    @Synchronized
    fun claimAutoPrompt(): Boolean {
        if (autoPrompted || !out.value) return false
        autoPrompted = true
        return true
    }

    @Synchronized
    fun setPrompting(value: Boolean) {
        prompting = value
    }

    @Synchronized
    fun refreshAvailability() {
        available = canUse()
        publish()
    }

    private fun compute(): Boolean = armed && prefs.lockWanted && available

    private fun publish() {
        out.value = compute()
    }
}

/**
 * S00 biometric app lock (design doc §5 S00, S04 step 3). [install] once from
 * `Application.onCreate` (main thread); [AppLockGate] then hides the app while
 * [locked]. Effective when the lock is wanted (S83, on by default) AND the
 * phone has a screen lock ([canUseLock]).
 */
object AppLock {
    private val lockedState = MutableStateFlow(false)

    /** True while the app content must stay hidden. False until [install]. */
    val locked: StateFlow<Boolean> = lockedState.asStateFlow()

    @Volatile private var controller: LockController? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun install(app: Application, store: AppSettingsStore) {
        if (controller != null) return
        val c = attach(SystemClock::elapsedRealtime, { canUseLock(app) }, store.prefs.value)
        scope.launch { store.prefs.collect { c.onPrefs(it) } }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = c.onForeground()
            override fun onStop(owner: LifecycleOwner) = c.onBackground()
        })
    }

    /**
     * BIOMETRIC_STRONG or the device credential (WEAK or credential on API
     * 28–29), exactly like the T2/T3 confirmations: without a screen lock the
     * app lock cannot protect anything and is not offered.
     */
    fun canUseLock(context: Context): Boolean = runCatching {
        BiometricManager.from(context).canAuthenticate(BiometricAuthenticator.authenticators()) == BiometricManager.BIOMETRIC_SUCCESS
    }.getOrDefault(false)

    /** A controller that publishes into [locked] (the app via [install]; tests directly). */
    internal fun attach(clock: () -> Long, canUse: () -> Boolean, initial: AppPrefs): LockController =
        LockController(clock, canUse, initial, lockedState).also { controller = it }

    internal fun detachForTest() {
        controller = null
        lockedState.value = false
    }

    internal fun claimAutoPrompt(): Boolean = controller?.claimAutoPrompt() ?: false

    /** Re-reads whether the phone has a screen lock (S83 after a visit to the Android settings). */
    internal fun refreshAvailability() {
        controller?.refreshAvailability()
    }

    /**
     * Shows the system prompt titled [title]; unlocks on success. [reason]
     * ("Déverrouillez pour ouvrir les processus de PC-COMPTA-03") is its subtitle.
     */
    internal suspend fun unlock(activity: FragmentActivity, title: String, reason: String?): Boolean {
        val ok = authenticate(activity, title, reason)
        if (ok) controller?.unlock()
        return ok
    }

    /** One authentication without unlocking anything (S83: confirm turning the lock on). */
    internal suspend fun authenticate(activity: FragmentActivity, title: String, subtitle: String?): Boolean {
        val c = controller
        c?.setPrompting(true)
        return try {
            BiometricAuthenticator(activity).authenticate(
                ActionSpec(key = KEY_UNLOCK, tier = Tier.T2, title = title, target = subtitle.orEmpty(), scope = ""),
            )
        } finally {
            c?.setPrompting(false)
        }
    }

    private const val KEY_UNLOCK = "app.unlock"
}
