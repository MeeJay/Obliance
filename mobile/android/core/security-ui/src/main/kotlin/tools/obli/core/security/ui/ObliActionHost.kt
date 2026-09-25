package tools.obli.core.security.ui

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.ContextWrapper
import android.content.res.Resources
import android.util.Log
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarVisuals
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.toColor
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.Tier

/**
 * The [ActionRunner] of the app, wired to the root [ObliActionHost]. Every
 * mutating call of a screen goes through it (see obliance/CONTRACT.md).
 */
val LocalActionRunner = staticCompositionLocalOf<ActionRunner> {
    error("LocalActionRunner is not provided: the screen must be inside ObliActionHost { }")
}

/** Shows the outcome of an action as a snackbar of the root host. */
fun interface ActionFeedback {
    /** [done] is the success text ("Redémarrage demandé"); a cancelled action shows nothing. */
    fun show(result: ActionResult<*>, done: String)
}

val LocalActionFeedback = staticCompositionLocalOf { ActionFeedback { _, _ -> } }

/** Host state for [ObliActionHost]: the Android biometric (when the activity can host it) and TalkBack/switch detection. */
@Composable
fun rememberActionHostState(onSessionExpired: () -> Unit): ActionHostState {
    val context = LocalContext.current
    val expired by rememberUpdatedState(onSessionExpired)
    return remember(context) {
        val activity = context.findFragmentActivity()
        if (activity == null) Log.w("ObliActionHost", "no FragmentActivity: T2/T3 confirm with the sheet only")
        ActionHostState(
            authenticator = activity?.let(::BiometricAuthenticator) ?: StrongAuthenticator.None,
            accessibilityMode = { context.usesAccessibilityService() },
            onSessionExpired = { expired() },
        )
    }
}

/**
 * Root host of the action prompts (design doc §7.6, §10.4), placed ONCE at the
 * root under ObliTheme: provides [LocalActionRunner] and [LocalActionFeedback]
 * to [content] and shows, over the current screen, the sheet of the prompt the
 * runner is waiting on (S41 per tier, S42, S43, S44, tenant switch). S03 is
 * the app's: [onSessionExpired] is called when an action met an expired session.
 */
@Composable
fun ObliActionHost(
    onSessionExpired: () -> Unit,
    modifier: Modifier = Modifier,
    feedbackBottomPadding: Dp = 88.dp,
    content: @Composable () -> Unit,
) {
    ObliActionHost(rememberActionHostState(onSessionExpired), modifier, feedbackBottomPadding, content)
}

@Composable
fun ObliActionHost(
    state: ActionHostState,
    modifier: Modifier = Modifier,
    feedbackBottomPadding: Dp = 88.dp,
    content: @Composable () -> Unit,
) {
    val runner = remember(state) { ActionRunner(state) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val resources = LocalResources.current
    val feedback = remember(snackbar, resources) { SnackbarFeedback(snackbar, resources, scope) }
    CompositionLocalProvider(LocalActionRunner provides runner, LocalActionFeedback provides feedback) {
        Box(modifier.fillMaxSize()) {
            content()
            SnackbarHost(
                snackbar,
                Modifier.align(Alignment.BottomCenter).padding(start = 16.dp, end = 16.dp, bottom = feedbackBottomPadding),
            ) { data -> ActionSnackbar(data.visuals) }
        }
    }
    val prompt by state.prompt.collectAsState()
    prompt?.let { p -> key(p) { PromptSheet(state, p) } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PromptSheet(state: ActionHostState, p: ActionPrompt) {
    val c = ObliTheme.colors
    val scope = rememberCoroutineScope()
    // 2FA and T3 are never dismissed by a tap outside (S42); back always cancels.
    val strict = p is ActionPrompt.TwoFactor || (p is ActionPrompt.Confirm && p.spec.tier == Tier.T3)
    ModalBottomSheet(
        onDismissRequest = state::cancel,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        sheetMaxWidth = 480.dp,
        sheetGesturesEnabled = !strict,
        containerColor = c.surface1,
        dragHandle = { BottomSheetDefaults.DragHandle(color = c.textFaint) },
        properties = ModalBottomSheetProperties(shouldDismissOnBackPress = true, shouldDismissOnClickOutside = !strict),
    ) {
        PromptContent(state, p, scope)
    }
}

/** The content of [p]'s sheet, wired to [state]. */
@Composable
internal fun PromptContent(state: ActionHostState, p: ActionPrompt, scope: CoroutineScope = rememberCoroutineScope()) {
    when (p) {
        is ActionPrompt.TenantSwitch -> TenantSwitchContent(p, onSwitch = { state.switchTenant(p) }, onCancel = state::cancel)
        is ActionPrompt.Confirm -> ConfirmContent(p, onAccept = { scope.launch { state.accept(p) } }, onCancel = state::cancel)
        is ActionPrompt.TwoFactor -> TwoFactorContent(p, onSubmit = { state.submitCode(p) }, onCancel = state::cancel)
        is ActionPrompt.ApprovalSent -> ApprovalSentContent(p, onOk = { state.acknowledge(p) }, onCancelRequest = { scope.launch { state.cancelApproval(p) } })
        is ActionPrompt.PrivacyUnlock -> PrivacyUnlockContent(p, onUnlock = { scope.launch { state.unlock(p) } }, onCancel = state::cancel)
    }
}

internal class ActionSnackbarVisuals(val message2: ActionMessage) : SnackbarVisuals {
    override val message: String get() = message2.text
    override val actionLabel: String? get() = null
    override val withDismissAction: Boolean get() = false
    override val duration: SnackbarDuration get() = if (message2.kind == ActionMessage.Kind.FAILED) SnackbarDuration.Long else SnackbarDuration.Short
}

private class SnackbarFeedback(
    private val snackbar: SnackbarHostState,
    private val resources: Resources,
    private val scope: CoroutineScope,
) : ActionFeedback {
    override fun show(result: ActionResult<*>, done: String) {
        val message = ActionMessages.describe(resources, result, done) ?: return
        scope.launch {
            snackbar.currentSnackbarData?.dismiss()
            snackbar.showSnackbar(ActionSnackbarVisuals(message))
        }
    }
}

/** Result snackbar: icon + text (state never by colour alone); done green, pending amber, failed amber alert. */
@Composable
internal fun ActionSnackbar(visuals: SnackbarVisuals) {
    val c = ObliTheme.colors
    val kind = (visuals as? ActionSnackbarVisuals)?.message2?.kind
    val (icon: ImageVector?, tint) = when (kind) {
        ActionMessage.Kind.DONE -> ObliIcons.CircleCheck to ObliTokens.Status.ONLINE.argb.toColor()
        ActionMessage.Kind.PENDING -> ObliIcons.Clock to ObliTokens.Status.WARNING.argb.toColor()
        ActionMessage.Kind.FAILED -> ObliIcons.CircleAlert to ObliTokens.Status.WARNING.argb.toColor()
        null -> null to c.text
    }
    Snackbar(containerColor = c.active, contentColor = c.text) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (icon != null) Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
            Text(visuals.message)
        }
    }
}

private fun Context.findFragmentActivity(): FragmentActivity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is FragmentActivity) return c
        c = c.baseContext
    }
    return null
}

/** TalkBack (touch exploration) or a switch-access-like service: timed gestures get a button alternative. */
private fun Context.usesAccessibilityService(): Boolean {
    val am = getSystemService(AccessibilityManager::class.java) ?: return false
    if (!am.isEnabled) return false
    if (am.isTouchExplorationEnabled) return true
    return am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_GENERIC or AccessibilityServiceInfo.FEEDBACK_SPOKEN).isNotEmpty()
}
