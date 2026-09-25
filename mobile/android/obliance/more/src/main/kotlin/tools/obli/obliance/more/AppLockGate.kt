package tools.obli.obliance.more

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography

/**
 * S00: while [AppLock.locked], shows the lock screen INSTEAD of [content]
 * (the content is not composed at all, so nothing of the app renders behind
 * it). The system prompt opens by itself once per foreground; after a
 * success [content] composes, so a pending route (a notification action)
 * continues without another tap.
 *
 * @param reason the intent being unlocked, shown under the title and in the
 *   prompt ("Déverrouillez pour ouvrir les processus de PC-COMPTA-03").
 */
@Composable
fun AppLockGate(reason: String? = null, content: @Composable () -> Unit) {
    val locked by AppLock.locked.collectAsState()
    if (!locked) {
        content()
        return
    }
    val context = LocalContext.current
    val activity = remember(context) { context.findFragmentActivity() }
    val store = remember(context) { AppSettings.store(context) }
    val scope = rememberCoroutineScope()
    val title = stringResource(R.string.more_lock_prompt_title)
    val unlock: () -> Unit = {
        if (activity != null) scope.launch { AppLock.unlock(activity, title, reason) }
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner, activity) {
        if (activity == null) return@LaunchedEffect
        // The stored choice first: a lock turned off must not flash a prompt at cold start.
        store.loaded.first { it }
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            if (AppLock.claimAutoPrompt()) AppLock.unlock(activity, title, reason)
        }
    }
    LockScreen(reason, onUnlock = unlock)
}

/** The S00 screen itself: bg, Ance mark 64 dp, title, reason, [Déverrouiller]. */
@Composable
internal fun LockScreen(reason: String?, onUnlock: () -> Unit) {
    val c = ObliTheme.colors
    Box(Modifier.fillMaxSize().background(c.bg).testTag(LOCK_SCREEN_TAG), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 360.dp).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Image(painterResource(R.drawable.more_ic_mark), contentDescription = stringResource(R.string.more_brand_name), modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(24.dp))
            Text(
                stringResource(R.string.more_lock_title),
                style = ObliTypography.dialogTitle,
                color = c.text,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            if (!reason.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(reason, style = ObliTypography.body, color = c.text2, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(32.dp))
            KitButton(stringResource(R.string.more_lock_unlock), onUnlock, icon = MoreIcons.Fingerprint)
        }
    }
}

internal const val LOCK_SCREEN_TAG = "more_lock_screen"

internal tailrec fun Context.findFragmentActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.findFragmentActivity()
    else -> null
}
