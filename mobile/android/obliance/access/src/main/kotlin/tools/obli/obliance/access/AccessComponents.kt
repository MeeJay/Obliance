package tools.obli.obliance.access

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerColor

/** Colours of STYLEKIT §2.5 that are not surface tokens. */
internal object AccessColors {
    /** Links and info text (#60A5FA). */
    val link: Color get() = ObliTokens.UNREAD.toColor()

    /** Toggle "on" track (#4F7BFF). */
    val switchOn: Color = Color(0xFF4F7BFF)

    /** Field error, danger menu text (#F87171). */
    val dangerText: Color get() = ObliTokens.DANGER_TEXT.toColor()

    /** Danger button fill (#DC2626), white text 4.8:1. */
    val danger: Color get() = ObliTokens.DANGER.toColor()
    val success: Color get() = ObliTokens.Status.ONLINE.argb.toColor()
    val warning: Color get() = ObliTokens.Status.WARNING.argb.toColor()
}

/** Lucide icons the design system does not have yet (module-private). */
internal object AccessIcons {
    val LogIn: ImageVector by lazy { ObliIcons.lucide("log-in", "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4", "m10 17 5-5-5-5", "M15 12H3") }
    val User: ImageVector by lazy { ObliIcons.lucide("user", "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0") }
    val Eye: ImageVector by lazy { ObliIcons.lucide("eye", "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0") }
    val EyeOff: ImageVector by lazy {
        ObliIcons.lucide(
            "eye-off",
            "M9.88 9.88a3 3 0 1 0 4.24 4.24",
            "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68",
            "M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61",
            "m2 2 20 20",
        )
    }
    val ClipboardPaste: ImageVector by lazy {
        ObliIcons.lucide(
            "clipboard-paste",
            "M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z",
            "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
            "M16 4h2a2 2 0 0 1 2 2v2",
            "M21 14H11",
            "m15 10-4 4 4 4",
        )
    }
    val Bell: ImageVector by lazy { ObliIcons.lucide("bell", "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0") }
    val Inbox: ImageVector by lazy {
        ObliIcons.lucide(
            "inbox",
            "M22 12h-6l-2 3h-4l-2-3H2",
            "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
        )
    }
    val RotateCcw: ImageVector by lazy { ObliIcons.lucide("rotate-ccw", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5") }
    val ChevronUp: ImageVector by lazy { ObliIcons.lucide("chevron-up", "m18 15-6-6-6 6") }
    val ArrowUp: ImageVector by lazy { ObliIcons.lucide("arrow-up", "m5 12 7-7 7 7", "M12 19V5") }
    val ArrowDown: ImageVector by lazy { ObliIcons.lucide("arrow-down", "M12 5v14", "m19 12-7 7-7-7") }
    val Mail: ImageVector by lazy {
        ObliIcons.lucide("mail", "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7")
    }
    val ShieldCheck: ImageVector by lazy { ObliIcons.lucide("shield-check", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10", "m9 12 2 2 4-4") }
}

internal val FieldShape = RoundedCornerShape(6.dp)
internal val ButtonShape = RoundedCornerShape(8.dp)
internal val CardShape = RoundedCornerShape(12.dp)

/** Obliance wordmark (STYLEKIT `logo-wordmark`: "bli" crimson, "ance" white). */
@Composable
internal fun Wordmark(modifier: Modifier = Modifier, height: Dp = 32.dp) {
    Image(
        painter = painterResource(R.drawable.access_wordmark),
        contentDescription = stringResource(R.string.access_brand_name),
        modifier = modifier.height(height).width(height * (529.75f / 122.88f)),
    )
}

/** Overline section label (JetBrains Mono 11, upper case, #828CAF). */
@Composable
internal fun Overline(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = ObliTypography.overline,
        color = ObliTheme.colors.textMuted,
        modifier = modifier.semantics { heading() },
    )
}

/**
 * Filled field without border (STYLEKIT `text-field`): surface2, radius 6,
 * 56 dp, label 12 sp above the value, helper below; focus = 2 dp #FF6868 ring;
 * error = 2 dp #F87171 bottom bar and a message with `circle-alert`.
 */
@Composable
internal fun AccessField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    helper: String? = null,
    error: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    contentType: ContentType? = null,
    enabled: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = ObliTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val errorColor = AccessColors.dangerText
    Column(modifier.fillMaxWidth()) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            singleLine = true,
            textStyle = ObliTypography.body.copy(fontSize = 16.sp, lineHeight = 24.sp, color = c.text),
            cursorBrush = SolidColor(c.accent2),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            visualTransformation = visualTransformation,
            interactionSource = interaction,
            modifier = Modifier.fillMaxWidth()
                .then(if (contentType != null) Modifier.semantics { this.contentType = contentType } else Modifier)
                // TalkBack reads the error with the field it belongs to.
                .then(if (error != null) Modifier.semantics { this.error(error) } else Modifier),
            decorationBox = { inner ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .then(if (focused) Modifier.border(2.dp, c.accent2, FieldShape) else Modifier)
                        .clip(FieldShape)
                        .background(c.surface2)
                        .then(
                            if (error != null) {
                                Modifier.drawBehind {
                                    val h = 2.dp.toPx()
                                    drawRect(errorColor, topLeft = Offset(0f, size.height - h), size = androidx.compose.ui.geometry.Size(size.width, h))
                                }
                            } else {
                                Modifier
                            },
                        )
                        .padding(start = 12.dp, end = if (trailing != null) 4.dp else 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                        Text(label, style = FieldLabel, color = if (error != null) errorColor else c.textMuted, maxLines = 1)
                        Box {
                            if (value.isEmpty() && placeholder != null) {
                                Text(placeholder, style = ObliTypography.body.copy(fontSize = 16.sp, lineHeight = 24.sp), color = c.textMuted, maxLines = 1)
                            }
                            inner()
                        }
                    }
                    trailing?.invoke()
                }
            },
        )
        when {
            error != null -> ErrorLine(error, Modifier.padding(start = 12.dp, end = 12.dp, top = 6.dp))
            helper != null -> Text(helper, style = FieldLabel, color = c.textMuted, modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 6.dp))
        }
    }
}

internal val FieldLabel get() = ObliTypography.body.copy(fontSize = 12.sp, lineHeight = 16.sp)

/** Inline error with `circle-alert` (#F87171): never colour alone. */
@Composable
internal fun ErrorLine(text: String, modifier: Modifier = Modifier) {
    // A live region: TalkBack announces the error when it appears (sign-in, code, scope switch).
    Row(modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(ObliIcons.CircleAlert, contentDescription = null, tint = AccessColors.dangerText, modifier = Modifier.padding(top = 1.dp).size(14.dp))
        Text(text, style = FieldLabel.copy(fontSize = 13.sp, lineHeight = 18.sp), color = AccessColors.dangerText)
    }
}

/** Calm notice (Obligate unreachable, info lines): icon + text on surface2, never red. */
@Composable
internal fun Notice(text: String, icon: ImageVector, tint: Color, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().clip(ButtonShape).background(c.surface2).padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.padding(top = 1.dp).size(18.dp))
        Text(text, style = ObliTypography.body, color = c.text)
    }
}

/** Filled primary button (#C83232, the only red of the screen). */
@Composable
internal fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    busy: Boolean = false,
    height: Dp = 52.dp,
) {
    val c = ObliTheme.colors
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        shape = ButtonShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = c.accentFill,
            contentColor = c.onAccentFill,
            disabledContainerColor = if (busy) c.accentFill else c.hover,
            disabledContentColor = if (busy) c.onAccentFill else c.textMuted,
        ),
        modifier = modifier.fillMaxWidth().height(height),
    ) {
        ButtonContent(text, icon, busy)
    }
}

/** Neutral filled button (#1D2238): local "Se connecter" when Obligate is the primary way. */
@Composable
internal fun NeutralButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    busy: Boolean = false,
    height: Dp = 48.dp,
    contentColor: Color = ObliTheme.colors.text,
) {
    val c = ObliTheme.colors
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        shape = ButtonShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = c.hover,
            contentColor = contentColor,
            disabledContainerColor = c.hover,
            disabledContentColor = if (busy) contentColor else c.textMuted,
        ),
        modifier = modifier.fillMaxWidth().height(height),
    ) {
        ButtonContent(text, icon, busy)
    }
}

/** Tonal button (#FF6868 at 12 %): chrome actions such as "Ajouter un serveur". */
@Composable
internal fun TonalButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true) {
    val c = ObliTheme.colors
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = ButtonShape,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 10.dp, end = 12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = c.accent2.copy(alpha = 0.12f),
            contentColor = c.accent2,
            disabledContainerColor = c.hover,
            disabledContentColor = c.textMuted,
        ),
        modifier = modifier.heightIn(min = 48.dp),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = ObliTypography.label, maxLines = 1)
    }
}

@Composable
private fun ButtonContent(text: String, icon: ImageVector?, busy: Boolean) {
    if (busy) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = androidx.compose.material3.LocalContentColor.current)
        Spacer(Modifier.width(10.dp))
    } else if (icon != null) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
    }
    Text(text, style = ObliTypography.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

/** Blue text link (#60A5FA), 48 dp tall. */
@Composable
internal fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = AccessColors.link) {
    TextButton(onClick = onClick, enabled = enabled, shape = ButtonShape, modifier = modifier.heightIn(min = 48.dp)) {
        Text(text, style = ObliTypography.label, color = if (enabled) color else ObliTheme.colors.textMuted, textAlign = TextAlign.Center)
    }
}

/** Card (surface1, radius 12). */
@Composable
internal fun AccessCard(modifier: Modifier = Modifier, color: Color = ObliTheme.colors.surface1, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().clip(CardShape).background(color), content = content)
}

/** "obliance-prod.example.org · Changer" (the address folded into a chip once checked). */
@Composable
internal fun AddressChip(host: String, onChange: (() -> Unit)?, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val change = stringResource(R.string.access_change)
    val description = stringResource(R.string.access_address_chip_description, host)
    Box(
        modifier
            .heightIn(min = 48.dp)
            .then(if (onChange != null) Modifier.clip(ButtonShape).clickable(onClickLabel = change, onClick = onChange) else Modifier)
            .semantics(mergeDescendants = true) { contentDescription = description },
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            Modifier.height(36.dp).clip(ButtonShape).background(c.hover).padding(start = 10.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(ObliIcons.Lock, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
            Text(host, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (onChange != null) {
                Text("·", style = ObliTypography.label, color = c.textMuted)
                Text(change, style = ObliTypography.label, color = AccessColors.link, maxLines = 1)
            }
        }
    }
}

/** Probe result card: "Obliance 5.1.110 · Connexion Obligate disponible (id.example.org)". */
@Composable
internal fun ProbeCard(probe: ProbeInfo?, checking: Boolean, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    AccessCard(modifier) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (checking || probe == null) {
                CircularProgressIndicator(Modifier.padding(top = 2.dp).size(20.dp), strokeWidth = 2.dp, color = c.text2)
                Text(stringResource(R.string.access_probe_checking), style = ObliTypography.body, color = c.text2)
                return@Row
            }
            Icon(ObliIcons.CircleCheck, contentDescription = null, tint = AccessColors.success, modifier = Modifier.padding(top = 2.dp).size(20.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    probe.version?.let { stringResource(R.string.access_probe_version, it) } ?: stringResource(R.string.access_probe_server),
                    style = ObliTypography.cardTitle,
                    color = c.text,
                )
                val line = when {
                    probe.offersSso && probe.obligateHost != null -> stringResource(R.string.access_probe_sso_host, probe.obligateHost)
                    probe.offersSso -> stringResource(R.string.access_probe_sso)
                    probe.obligateUnreachable -> stringResource(R.string.access_probe_sso_unreachable)
                    else -> stringResource(R.string.access_probe_local_only)
                }
                Text(line, style = ObliTypography.body, color = c.text2)
            }
        }
    }
}

/** "OU" between Obligate and the local account. */
@Composable
internal fun OrSeparator(modifier: Modifier = Modifier) {
    Text(
        stringResource(R.string.access_or).uppercase(),
        style = ObliTypography.overline,
        color = ObliTheme.colors.textMuted,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth(),
    )
}

/** "Connexion sécurisée par HTTPS". */
@Composable
internal fun SecureFooter(modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Icon(ObliIcons.Lock, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(12.dp))
        Spacer(Modifier.width(6.dp))
        Text(stringResource(R.string.access_secure_footer), style = FieldLabel, color = c.textMuted)
    }
}

/** Segmented control (STYLEKIT `segmented`): selected = #222740 + 600, never red. */
@Composable
internal fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier, track: Color = ObliTheme.colors.surface1) {
    val c = ObliTheme.colors
    Row(
        modifier.fillMaxWidth().height(48.dp).clip(ButtonShape).background(track).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .height(42.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (on) c.active else Color.Transparent)
                    .selectable(selected = on, role = Role.Tab, onClick = { onSelect(i) }),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = ObliTypography.label.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium),
                    color = if (on) c.text else c.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }
}

/**
 * The 6 boxes of a second-factor code (STYLEKIT `otp-field`: 48 × 56, JetBrains
 * Mono 24, focused box ring #FF6868). One text field underneath, so paste,
 * delete and password managers work; the boxes shake when a code is refused.
 */
@Composable
internal fun OtpBoxes(
    code: String,
    onCodeChange: (String) -> Unit,
    rejections: Int,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    focusRequester: androidx.compose.ui.focus.FocusRequester? = null,
) {
    val c = ObliTheme.colors
    val shake = remember { Animatable(0f) }
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(rejections) {
        if (rejections > 0) {
            haptics.performHapticFeedback(HapticFeedbackType.Reject)
            for (x in listOf(12f, -10f, 8f, -6f, 3f, 0f)) shake.animateTo(x, tween(45))
        }
    }
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    BasicTextField(
        value = code,
        onValueChange = { onCodeChange(OtpCodes.sanitize(it)) },
        enabled = enabled,
        singleLine = true,
        interactionSource = interaction,
        cursorBrush = SolidColor(Color.Transparent),
        textStyle = ObliTypography.otp.copy(color = Color.Transparent),
        keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.NumberPassword, imeAction = androidx.compose.ui.text.input.ImeAction.Done),
        modifier = modifier
            .fillMaxWidth()
            .offset { IntOffset(shake.value.dp.roundToPx(), 0) }
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .semantics {
                contentDescription = label
                contentType = ContentType.SmsOtpCode
            },
        decorationBox = { inner ->
            BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                val gap = 8.dp
                val cell = ((maxWidth - gap * (OtpCodes.LENGTH - 1)) / OtpCodes.LENGTH).coerceAtMost(48.dp)
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    repeat(OtpCodes.LENGTH) { i ->
                        val active = focused && (i == code.length || (i == OtpCodes.LENGTH - 1 && code.length == OtpCodes.LENGTH))
                        Box(
                            Modifier
                                .width(cell)
                                .height(56.dp)
                                .then(if (active) Modifier.border(BorderStroke(2.dp, c.accent2), FieldShape) else Modifier)
                                .clip(FieldShape)
                                .background(c.surface2),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(code.getOrNull(i)?.toString() ?: "", style = ObliTypography.otp, color = c.text)
                        }
                    }
                }
                Box(Modifier.size(1.dp).alpha(0f)) { inner() }
            }
        },
    )
}

/** Material switch in the kit colours (on #4F7BFF + white thumb, off #2A3048 + #828CAF thumb). */
@Composable
internal fun AccessSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = ObliTheme.colors
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        enabled = enabled,
        modifier = modifier,
        colors = SwitchDefaults.colors(
            checkedTrackColor = AccessColors.switchOn,
            checkedThumbColor = Color.White,
            checkedIconColor = AccessColors.switchOn,
            checkedBorderColor = Color.Transparent,
            uncheckedTrackColor = c.divider,
            uncheckedThumbColor = c.textMuted,
            uncheckedBorderColor = Color.Transparent,
        ),
        thumbContent = if (checked) {
            { Icon(ObliIcons.Check, contentDescription = null, modifier = Modifier.size(14.dp)) }
        } else {
            null
        },
    )
}

/** Name of a palette colour for TalkBack ("Fuchsia, sélectionné"). */
@Composable
internal fun colorName(color: ServerColor): String = stringResource(
    when (color) {
        ServerColor.VIOLET -> R.string.access_color_violet
        ServerColor.TEAL -> R.string.access_color_teal
        ServerColor.FUCHSIA -> R.string.access_color_fuchsia
        ServerColor.INDIGO -> R.string.access_color_indigo
        ServerColor.CYAN -> R.string.access_color_cyan
        ServerColor.SAND -> R.string.access_color_sand
        ServerColor.LAVENDER -> R.string.access_color_lavender
        ServerColor.MINT -> R.string.access_color_mint
    },
)

/** The closed palette of §8.2 as 48 dp radio swatches, [columns] per row. */
@Composable
internal fun ColorSwatches(selected: ServerColor, onSelect: (ServerColor) -> Unit, modifier: Modifier = Modifier, columns: Int = 4, ringBackground: Color = ObliTheme.colors.surface1) {
    val c = ObliTheme.colors
    val group = stringResource(R.string.access_color_label)
    Column(modifier.semantics { contentDescription = group }) {
        ServerColor.entries.chunked(columns).forEach { row ->
            Row {
                row.forEach { color ->
                    val on = color == selected
                    val swatch = color.argb.toColor()
                    val name = colorName(color)
                    Box(
                        Modifier
                            .size(48.dp)
                            .selectable(selected = on, role = Role.RadioButton, onClick = { onSelect(color) })
                            .semantics { contentDescription = name },
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            Modifier
                                .size(if (on) 34.dp else 26.dp)
                                .then(if (on) Modifier.border(2.dp, swatch, RoundedCornerShape(9.dp)).padding(4.dp) else Modifier)
                                .clip(RoundedCornerShape(if (on) 5.dp else 7.dp))
                                .background(swatch),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (on) Icon(ObliIcons.Check, contentDescription = null, tint = c.bg, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
    }
}

/** Tile preview + "Monogramme OD" (S93, S92). */
@Composable
internal fun MonogramPreview(color: ServerColor, monogram: String, name: String, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Column(
        modifier.clip(ButtonShape).background(c.surface2).padding(horizontal = 8.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ObliServerTile(color, monogram, name, size = 28.dp)
        Text(stringResource(R.string.access_monogram, monogram), style = FieldLabel, color = c.text2, textAlign = TextAlign.Center)
        Text(stringResource(R.string.access_monogram_help), style = FieldLabel, color = c.textMuted, textAlign = TextAlign.Center)
    }
}
