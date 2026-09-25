package tools.obli.obliance.more

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography

/**
 * S04 step 3 « Verrouiller Obliance » (design doc §5 S04), asked ONCE: while
 * the lock was never decided ([AppPrefs.lockUndecided]) and the phone has a
 * screen lock. The app places it after S04 steps 1-2, once a server is signed
 * in. [Activer] (first, as the design doc's "activé par défaut") proves once
 * that this phone can unlock it (the system prompt) and stores true;
 * [Pas maintenant] (or back) stores false. S83 changes it later. Until the
 * answer the lock is not armed (a 0.2.0 phone upgrading keeps working as before).
 */
@Composable
fun LockOnboardingDialog() {
    if (LocalInspectionMode.current) return
    val context = LocalContext.current
    val app = context.applicationContext
    val store = remember(app) { AppSettings.store(app) }
    val loaded by store.loaded.collectAsStateWithLifecycle()
    val prefs by store.prefs.collectAsStateWithLifecycle()
    var available by remember { mutableStateOf(AppLock.canUseLock(app)) }
    // A screen lock set in the Android settings meanwhile makes the step possible.
    LifecycleResumeEffect(app) {
        available = AppLock.canUseLock(app)
        onPauseOrDispose { }
    }
    if (!loaded || !prefs.lockUndecided || !available) return
    val activity = remember(context) { context.findFragmentActivity() }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val confirmTitle = stringResource(R.string.more_settings_lock_confirm_title)
    val notNow: () -> Unit = { if (!busy) scope.launch { store.setLockEnabled(false) } }
    Dialog(onDismissRequest = notNow, properties = DialogProperties(dismissOnClickOutside = false)) {
        LockOnboardingContent(
            timeout = prefs.lockTimeout,
            busy = busy,
            onEnable = {
                if (!busy) {
                    scope.launch {
                        busy = true
                        try {
                            // Without an activity there is no prompt to show: the choice alone is stored.
                            val ok = activity == null || AppLock.authenticate(activity, confirmTitle, null)
                            if (ok) store.setLockEnabled(true)
                        } finally {
                            busy = false
                        }
                    }
                }
            },
            onLater = notNow,
        )
    }
}

/** The card of S04 step 3 (same layout as steps 1-2: icon tile, title, body, [Pas maintenant] [Activer]). */
@Composable
internal fun LockOnboardingContent(timeout: LockTimeout, busy: Boolean, onEnable: () -> Unit, onLater: () -> Unit) {
    val c = ObliTheme.colors
    val body = if (timeout == LockTimeout.IMMEDIATE) {
        stringResource(R.string.more_lock_onboarding_body_immediate)
    } else {
        stringResource(R.string.more_lock_onboarding_body, timeoutLabel(timeout))
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.surface1)
            .padding(start = 24.dp, end = 16.dp, top = 24.dp, bottom = 12.dp)
            .testTag(LOCK_ONBOARDING_TAG),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(c.hover), contentAlignment = Alignment.Center) {
            Icon(MoreIcons.Fingerprint, contentDescription = null, tint = c.text2, modifier = Modifier.size(20.dp))
        }
        Text(
            stringResource(R.string.more_lock_onboarding_title),
            style = ObliTypography.dialogTitle,
            color = c.text,
            modifier = Modifier.padding(end = 8.dp).semantics { heading() },
        )
        Text(body, style = ObliTypography.body, color = c.text2, modifier = Modifier.padding(end = 8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            KitButton(stringResource(R.string.more_lock_onboarding_later), onLater, primary = false, enabled = !busy)
            KitButton(stringResource(R.string.more_lock_onboarding_enable), onEnable, enabled = !busy)
        }
    }
}

@Composable
private fun timeoutLabel(timeout: LockTimeout): String = stringResource(
    when (timeout) {
        LockTimeout.IMMEDIATE -> R.string.more_lock_timeout_immediate
        LockTimeout.ONE_MIN -> R.string.more_lock_timeout_1
        LockTimeout.FIVE_MIN -> R.string.more_lock_timeout_5
        LockTimeout.FIFTEEN_MIN -> R.string.more_lock_timeout_15
    },
)

internal const val LOCK_ONBOARDING_TAG = "more_lock_onboarding"
