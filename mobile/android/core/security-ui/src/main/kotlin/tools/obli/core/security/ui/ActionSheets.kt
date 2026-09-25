package tools.obli.core.security.ui

import android.content.ClipDescription
import android.content.ClipboardManager
import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.security.PrivacyUnlockResult
import tools.obli.core.security.Tier

/*
 * Contents of the prompt sheets (design doc §5 S41–S44, §7.6). They are
 * plain composables (no dialog window) so the screenshot tests capture them;
 * ObliActionHost puts them in a ModalBottomSheet.
 */

internal object SecIcons {
    val Shield: ImageVector by lazy {
        ObliIcons.lucide(
            "shield-check",
            "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
            "m9 12 2 2 4-4",
        )
    }
    val Clipboard: ImageVector by lazy {
        ObliIcons.lucide(
            "clipboard-paste",
            "M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z",
            "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
            "M16 4h2a2 2 0 0 1 2 2v4",
            "M21 14H11",
            "m15 10-4 4 4 4",
        )
    }
    val ArrowLeftRight: ImageVector by lazy { ObliIcons.lucide("arrow-left-right", "M8 3 4 7l4 4", "M4 7h16", "m16 21 4-4-4-4", "M20 17H4") }
    val Fingerprint: ImageVector by lazy {
        ObliIcons.lucide(
            "fingerprint",
            "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4",
            "M14 13.12c0 2.38 0 6.38-1 8.88",
            "M17.29 21.02c.12-.6.43-2.3.5-3.02",
            "M2 12a10 10 0 0 1 18-6",
            "M2 16h.01",
            "M21.8 16c.2-2 .131-5.354 0-6",
            "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2",
            "M8.65 22c.21-.66.45-1.32.57-2",
            "M9 6.8a6 6 0 0 1 9 5.2v2",
        )
    }
}

private val DANGER = ObliTokens.DANGER.toColor()
private val WARNING = ObliTokens.Status.WARNING.argb.toColor()
private val PENDING = ObliTokens.Status.PENDING.argb.toColor()

// --- Building blocks -----------------------------------------------------------

@Composable
internal fun SheetColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        content = content,
    )
}

@Composable
private fun SheetHeader(icon: ImageVector, tint: Color, title: String, context: String?) {
    val c = ObliTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
            if (!context.isNullOrBlank()) Text(context, style = ObliTypography.monoCaption, color = c.text2)
        }
    }
}

@Composable
private fun Body(text: String) {
    Text(text, style = ObliTypography.body.copy(fontFeatureSettings = null), color = ObliTheme.colors.text2)
}

/** Icon + text note (not colour alone): warnings, errors, the "no screen lock" fallback. */
@Composable
private fun Note(text: String, icon: ImageVector, tint: Color, live: Boolean = false) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.hover).padding(12.dp)
            .let { if (live) it.semantics { liveRegion = LiveRegionMode.Polite } else it },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        Text(text, style = ObliTypography.body.copy(fontFeatureSettings = null), color = c.text)
    }
}

@Composable
private fun ButtonRow(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically, content = content)
}

/** 48 dp tall pressable with its own visual (the touch target is never smaller than 48 dp). */
@Composable
private fun Pressable(onClick: () -> Unit, modifier: Modifier, enabled: Boolean, background: Color, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).background(background)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
private fun CancelButton(onClick: () -> Unit, label: String = stringResource(R.string.secui_cancel)) {
    val c = ObliTheme.colors
    Pressable(onClick, Modifier, enabled = true, background = Color.Transparent) {
        Text(label, style = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold), color = c.text2, maxLines = 1)
    }
}

/** Filled primary (#C83232, the only red fill allowed in content). */
@Composable
private fun RowScope.PrimaryButton(text: String, onClick: () -> Unit, enabled: Boolean = true) {
    val c = ObliTheme.colors
    Pressable(onClick, Modifier.weight(1f), enabled, if (enabled) c.accentFill else c.surface2) {
        Text(text, style = ObliTypography.label, color = if (enabled) c.onAccentFill else c.textFaint, maxLines = 1, textAlign = TextAlign.Center)
    }
}

/** Danger button of S41: #DC2626, white text, triangle-alert; never focused by default. */
@Composable
private fun RowScope.DangerButton(text: String, onClick: () -> Unit, enabled: Boolean = true, busy: Boolean = false) {
    val c = ObliTheme.colors
    Pressable(onClick, Modifier.weight(1f), enabled && !busy, if (enabled) DANGER else c.surface2) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
        } else {
            Icon(ObliIcons.TriangleAlert, contentDescription = null, tint = if (enabled) Color.White else c.textFaint, modifier = Modifier.size(16.dp))
        }
        Text(text, style = ObliTypography.label, color = if (enabled) Color.White else c.textFaint, maxLines = 1)
    }
}

@Composable
private fun RowScope.TonalButton(text: String, onClick: () -> Unit, enabled: Boolean = true) {
    val c = ObliTheme.colors
    Pressable(onClick, Modifier.weight(1f), enabled, if (enabled) c.accent2.copy(alpha = 0.12f) else c.surface2) {
        Text(text, style = ObliTypography.label, color = if (enabled) c.accent2 else c.textFaint, maxLines = 1)
    }
}

private fun contextLine(target: String, scope: String): String = listOf(target, scope).filter { it.isNotBlank() }.joinToString(" · ")

// --- Tenant switch -------------------------------------------------------------

@Composable
internal fun TenantSwitchContent(p: ActionPrompt.TenantSwitch, onSwitch: () -> Unit, onCancel: () -> Unit) {
    val c = ObliTheme.colors
    SheetColumn {
        SheetHeader(SecIcons.ArrowLeftRight, c.text2, stringResource(R.string.secui_switch_title, p.tenantName), p.spec.scope)
        Body(stringResource(R.string.secui_switch_body, p.spec.target, p.tenantName))
        ButtonRow {
            CancelButton(onCancel)
            PrimaryButton(stringResource(R.string.secui_switch_continue), onSwitch)
        }
    }
}

// --- S41 confirmation ----------------------------------------------------------

@Composable
internal fun ConfirmContent(p: ActionPrompt.Confirm, onAccept: () -> Unit, onCancel: () -> Unit) {
    val c = ObliTheme.colors
    val spec = p.spec
    SheetColumn {
        SheetHeader(
            if (spec.tier == Tier.T1) ObliIcons.Info else ObliIcons.TriangleAlert,
            if (spec.tier == Tier.T1) c.text2 else WARNING,
            stringResource(R.string.secui_confirm_question, spec.title, spec.target),
            contextLine(spec.target, spec.scope),
        )
        spec.consequence?.let { Body(it) }
        if (p.needsCount) CountField(p)
        if (p.strong) {
            when {
                !p.strongAuthAvailable -> Note(stringResource(R.string.secui_confirm_no_lock), ObliIcons.Info, c.text2)
                p.authFailed -> Note(stringResource(R.string.secui_confirm_auth_failed), ObliIcons.CircleAlert, WARNING, live = true)
                else -> Note(stringResource(R.string.secui_confirm_biometric_next), SecIcons.Fingerprint, c.text2)
            }
        }
        when {
            p.usesHold -> {
                HoldToConfirm(
                    label = stringResource(R.string.secui_confirm_hold),
                    a11yLabel = stringResource(R.string.secui_confirm_hold_a11y, spec.title),
                    enabled = p.countOk && !p.authenticating,
                    onDone = onAccept,
                )
                ButtonRow { CancelButton(onCancel) }
            }
            spec.tier == Tier.T3 && !p.armed -> ButtonRow {
                CancelButton(onCancel)
                DangerButton(stringResource(R.string.secui_confirm_button), onAccept, enabled = p.countOk)
            }
            spec.tier == Tier.T3 -> {
                Note(stringResource(R.string.secui_confirm_final_note), ObliIcons.TriangleAlert, WARNING, live = true)
                ButtonRow {
                    CancelButton(onCancel)
                    DangerButton(stringResource(R.string.secui_confirm_final), onAccept, enabled = p.countOk, busy = p.authenticating)
                }
            }
            spec.tier == Tier.T1 -> ButtonRow {
                CancelButton(onCancel)
                PrimaryButton(spec.title, onAccept)
            }
            else -> ButtonRow {
                CancelButton(onCancel)
                DangerButton(spec.title, onAccept, busy = p.authenticating)
            }
        }
    }
}

@Composable
private fun CountField(p: ActionPrompt.Confirm) {
    val c = ObliTheme.colors
    val label = stringResource(R.string.secui_confirm_type_count, p.spec.targetCount)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = ObliTypography.label, color = c.text)
        BasicTextField(
            value = p.typedCount,
            onValueChange = { v -> p.typedCount = v.filter { it.isDigit() }.take(6) },
            textStyle = ObliTypography.otp.copy(color = c.text),
            singleLine = true,
            cursorBrush = SolidColor(c.accent2),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(6.dp)).background(c.surface2)
                .border(1.dp, if (p.countOk) ObliTokens.Status.ONLINE.argb.toColor().copy(alpha = 0.6f) else c.divider, RoundedCornerShape(6.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp).semantics { contentDescription = label },
        )
    }
}

/**
 * T3: hold 1.5 s (fill + haptic ticks at 25 / 50 / 75 %). Releasing early
 * resets. Accessibility services activate it with a click action, which
 * leads to the two-button path instead (no timed gesture).
 */
@Composable
internal fun HoldToConfirm(label: String, a11yLabel: String, enabled: Boolean, onDone: () -> Unit, initialProgress: Float = 0f) {
    val c = ObliTheme.colors
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val progress = remember { Animatable(initialProgress) }
    var job by remember { mutableStateOf<Job?>(null) }
    LaunchedEffect(Unit) {
        var step = (progress.value * 4).toInt()
        snapshotFlow { progress.value }.collect { v ->
            val now = (v * 4).toInt().coerceAtMost(3)
            if (now > step && now in 1..3) view.performHapticFeedback(tickConstant())
            step = now
        }
    }
    Box(
        Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(8.dp)).background(if (enabled) c.surface2 else c.surface1)
            .border(1.dp, if (enabled) DANGER else c.divider, RoundedCornerShape(8.dp))
            .drawBehind { drawRect(DANGER, size = Size(size.width * progress.value, size.height)) }
            .semantics {
                role = Role.Button
                contentDescription = a11yLabel
                stateDescription = "${(progress.value * 100).toInt()} %"
                onClick(label) {
                    if (enabled) onDone()
                    enabled
                }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    awaitFirstDown()
                    job?.cancel()
                    job = scope.launch {
                        val remaining = ((1f - progress.value) * HOLD_MS).toInt().coerceAtLeast(1)
                        progress.animateTo(1f, tween(remaining, easing = LinearEasing))
                        view.performHapticFeedback(confirmConstant())
                        onDone()
                        progress.snapTo(0f)
                    }
                    waitForUpOrCancellation()
                    if (progress.value < 1f) {
                        job?.cancel()
                        scope.launch { progress.animateTo(0f, tween(150)) }
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(ObliIcons.TriangleAlert, contentDescription = null, tint = if (enabled) Color.White else c.textFaint, modifier = Modifier.size(16.dp))
            Text(label, style = ObliTypography.label, color = if (enabled) Color.White else c.textFaint, maxLines = 1)
        }
    }
}

private const val HOLD_MS = 1_500

private fun tickConstant(): Int =
    if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_FREQUENT_TICK else HapticFeedbackConstants.CLOCK_TICK

private fun confirmConstant(): Int =
    if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS

// --- S42 2FA -------------------------------------------------------------------

@Composable
internal fun TwoFactorContent(p: ActionPrompt.TwoFactor, onSubmit: () -> Unit, onCancel: () -> Unit) {
    val c = ObliTheme.colors
    val context = LocalContext.current
    var pasteMissed by remember { mutableStateOf(false) }
    // Auto-submit on the 6th digit (S42).
    LaunchedEffect(p.code) { if (p.code.length == ActionHostState.CODE_LENGTH) onSubmit() }
    SheetColumn {
        SheetHeader(SecIcons.Shield, PENDING, stringResource(R.string.secui_2fa_title), contextLine(p.spec.target, p.spec.scope))
        Body(stringResource(R.string.secui_2fa_body))
        if (p.previousWasWrong) Note(stringResource(R.string.secui_2fa_wrong), ObliIcons.CircleAlert, WARNING, live = true)
        CodeBoxes(p.code, onChange = { p.code = it })
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val clipboard = remember { context.getSystemService(ClipboardManager::class.java) }
            // Only the description is read here (no "pasted" toast); the text is read on tap.
            val hasText = remember { clipboard?.primaryClipDescription?.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) == true }
            Chip(stringResource(R.string.secui_2fa_paste), SecIcons.Clipboard, enabled = hasText) {
                val text = clipboard?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
                val code = SIX_DIGITS.find(text.replace(" ", ""))?.value
                if (code != null) p.code = code else pasteMissed = true
            }
        }
        if (pasteMissed) Text(stringResource(R.string.secui_2fa_paste_missed), style = ObliTypography.labelSmall, color = c.textMuted)
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Checkbox) { p.trustIp = !p.trustIp },
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Checkbox(
                checked = p.trustIp,
                onCheckedChange = null,
                modifier = Modifier.padding(12.dp).size(24.dp),
                colors = CheckboxDefaults.colors(checkedColor = c.accent2, uncheckedColor = c.textMuted, checkmarkColor = c.bg),
            )
            Column(Modifier.weight(1f).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.secui_2fa_trust_ip), style = ObliTypography.label, color = c.text)
                if (p.currentIp != null) {
                    Text(stringResource(R.string.secui_2fa_current_ip, p.currentIp), style = ObliTypography.monoCaption, color = c.textMuted)
                }
            }
        }
        ButtonRow {
            CancelButton(onCancel)
            PrimaryButton(stringResource(R.string.secui_2fa_submit), onSubmit, enabled = p.code.length == ActionHostState.CODE_LENGTH)
        }
    }
}

private val SIX_DIGITS = Regex("(?<!\\d)\\d{6}(?!\\d)")

/** Six boxes over one numeric field (one-time-code autofill, paste, TalkBack reads one field). */
@Composable
private fun CodeBoxes(code: String, onChange: (String) -> Unit) {
    val c = ObliTheme.colors
    val label = stringResource(R.string.secui_2fa_code_label)
    BasicTextField(
        value = TextFieldValue(code, selection = TextRange(code.length)),
        onValueChange = { v -> onChange(v.text.filter { it.isDigit() }.take(ActionHostState.CODE_LENGTH)) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        cursorBrush = SolidColor(Color.Transparent),
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        decorationBox = { inner ->
            Box {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(ActionHostState.CODE_LENGTH) { i ->
                        val ch = code.getOrNull(i)
                        val focused = i == code.length
                        Box(
                            Modifier.weight(1f).height(56.dp).clip(RoundedCornerShape(6.dp)).background(c.surface2)
                                .border(if (focused) 2.dp else 1.dp, if (focused) c.accent2 else c.divider, RoundedCornerShape(6.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(ch?.toString() ?: "", style = ObliTypography.otp, color = c.text)
                        }
                    }
                }
                // The real field stays invisible on top: it receives focus, IME and autofill.
                Box(Modifier.matchParentSize().alpha(0f)) { inner() }
            }
        },
    )
}

@Composable
private fun Chip(text: String, icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
    val c = ObliTheme.colors
    Row(
        Modifier.heightIn(min = 48.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.height(36.dp).clip(RoundedCornerShape(18.dp)).background(c.surface2).padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = if (enabled) c.text2 else c.textFaint, modifier = Modifier.size(16.dp))
            Text(text, style = ObliTypography.label, color = if (enabled) c.text2 else c.textFaint, maxLines = 1)
        }
    }
}

// --- S43 approval sent -----------------------------------------------------------

@Composable
internal fun ApprovalSentContent(p: ActionPrompt.ApprovalSent, onOk: () -> Unit, onCancelRequest: () -> Unit) {
    val c = ObliTheme.colors
    SheetColumn {
        SheetHeader(ObliIcons.Clock, WARNING, stringResource(R.string.secui_approval_title), contextLine(p.spec.target, p.spec.scope))
        Body(stringResource(R.string.secui_approval_body, p.spec.title, p.spec.target, p.spec.scope))
        StatusLine(
            when (p.cancel) {
                ActionPrompt.CancelState.CANCELLED -> stringResource(R.string.secui_approval_cancelled)
                else -> stringResource(R.string.secui_approval_waiting, p.approvalId)
            },
            if (p.cancel == ActionPrompt.CancelState.CANCELLED) ObliIcons.X else ObliIcons.Clock,
            if (p.cancel == ActionPrompt.CancelState.CANCELLED) c.text2 else WARNING,
        )
        if (p.cancel == ActionPrompt.CancelState.FAILED) Note(stringResource(R.string.secui_approval_cancel_failed), ObliIcons.CircleAlert, WARNING, live = true)
        ButtonRow {
            val canCancel = p.spec.endpoints != null && p.cancel != ActionPrompt.CancelState.CANCELLED
            if (canCancel) TonalButton(stringResource(R.string.secui_approval_cancel), onCancelRequest, enabled = p.cancel != ActionPrompt.CancelState.CANCELLING)
            PrimaryButton(stringResource(if (p.cancel == ActionPrompt.CancelState.CANCELLED) R.string.secui_close else R.string.secui_approval_ok), onOk)
        }
    }
}

@Composable
private fun StatusLine(text: String, icon: ImageVector, tint: Color) {
    Row(
        Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
        Text(text, style = ObliTypography.label, color = tint)
    }
}

// --- S44 privacy unlock ----------------------------------------------------------

@Composable
internal fun PrivacyUnlockContent(p: ActionPrompt.PrivacyUnlock, onUnlock: () -> Unit, onCancel: () -> Unit) {
    val c = ObliTheme.colors
    val res = LocalResources.current
    SheetColumn {
        SheetHeader(ObliIcons.Lock, c.text2, stringResource(R.string.secui_privacy_title, p.spec.target), p.spec.scope)
        if (!p.canUnlock) {
            Body(
                stringResource(
                    when {
                        p.error == PrivacyUnlockResult.NoPasswordSet || !p.passwordSet && p.feature != null -> R.string.secui_privacy_admin_only
                        p.passwordSet -> R.string.secui_privacy_password_route
                        else -> R.string.secui_privacy_admin_only
                    },
                ),
            )
            ButtonRow { PrimaryButton(stringResource(R.string.secui_close), onCancel) }
            return@SheetColumn
        }
        Body(stringResource(R.string.secui_privacy_body, ActionMessages.featureLabel(res, p.selectedFeature)))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionPrompt.PRIVACY_FEATURES.forEach { f ->
                val selected = f == p.selectedFeature
                val label = ActionMessages.featureLabel(res, f)
                Row(
                    Modifier.heightIn(min = 48.dp).clickable(role = Role.RadioButton) { p.selectedFeature = f }
                        .semantics { stateDescription = if (selected) res.getString(R.string.secui_selected) else "" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        Modifier.height(36.dp).clip(RoundedCornerShape(18.dp))
                            .background(if (selected) c.accent2.copy(alpha = 0.14f) else c.surface2)
                            .border(1.dp, if (selected) c.accent2 else Color.Transparent, RoundedCornerShape(18.dp))
                            .padding(horizontal = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (selected) Icon(ObliIcons.Check, contentDescription = null, tint = c.accent2, modifier = Modifier.size(14.dp))
                        Text(label, style = ObliTypography.label, color = if (selected) c.accent2 else c.text2, maxLines = 1)
                    }
                }
            }
        }
        val passwordLabel = stringResource(R.string.secui_privacy_password)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(passwordLabel.uppercase(), style = ObliTypography.overline, color = c.textMuted)
            BasicTextField(
                value = p.password,
                onValueChange = { p.password = it },
                textStyle = ObliTypography.body.copy(color = c.text),
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                cursorBrush = SolidColor(c.accent2),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(6.dp)).background(c.surface2)
                    .padding(horizontal = 12.dp, vertical = 14.dp).semantics { contentDescription = passwordLabel },
            )
        }
        p.error?.let { e ->
            val text = when (e) {
                PrivacyUnlockResult.WrongPassword -> stringResource(R.string.secui_privacy_wrong)
                PrivacyUnlockResult.TooManyAttempts -> stringResource(R.string.secui_privacy_rate)
                PrivacyUnlockResult.DeviceOffline -> stringResource(R.string.secui_privacy_offline)
                PrivacyUnlockResult.SessionExpired -> stringResource(R.string.secui_result_session)
                PrivacyUnlockResult.NoPasswordSet -> stringResource(R.string.secui_privacy_admin_only)
                is PrivacyUnlockResult.Failed -> stringResource(R.string.secui_privacy_failed)
                is PrivacyUnlockResult.Unlocked -> null
            }
            if (text != null) Note(text, ObliIcons.CircleAlert, WARNING, live = true)
        }
        ButtonRow {
            CancelButton(onCancel)
            PrimaryButton(stringResource(if (p.busy) R.string.secui_privacy_unlocking else R.string.secui_privacy_unlock), onUnlock, enabled = p.password.isNotEmpty() && !p.busy)
        }
    }
}
