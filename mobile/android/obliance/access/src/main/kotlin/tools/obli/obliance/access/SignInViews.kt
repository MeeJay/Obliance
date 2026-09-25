package tools.obli.obliance.access

import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.model.Monogram
import tools.obli.obliance.api.TwoFactorMethod

/*
 * The sections of the progressive sign-in (design doc S01, S93, S03), stateless:
 * they draw a [SignInUiState] and call [SignInActions].
 */

/** Text of a sign-in problem (design doc S01 "Erreurs", S93). */
@Composable
internal fun problemText(problem: SignInProblem): String = when (problem.kind) {
    ProblemKind.ADDRESS_EMPTY -> stringResource(R.string.access_problem_address_empty)
    ProblemKind.ADDRESS_NOT_HTTPS -> stringResource(R.string.access_problem_not_https)
    ProblemKind.ADDRESS_MALFORMED -> stringResource(R.string.access_problem_address_malformed)
    ProblemKind.ADDRESS_CREDENTIALS -> stringResource(R.string.access_problem_address_credentials)
    ProblemKind.NOT_OBLIANCE -> stringResource(R.string.access_problem_not_obliance)
    ProblemKind.TLS -> stringResource(R.string.access_problem_tls)
    ProblemKind.HOST_NOT_FOUND -> stringResource(R.string.access_problem_host_not_found)
    ProblemKind.UNREACHABLE -> stringResource(R.string.access_problem_unreachable)
    ProblemKind.ALREADY_CONFIGURED -> stringResource(R.string.access_problem_already_configured, problem.arg.orEmpty())
    ProblemKind.LIMIT -> stringResource(R.string.access_problem_limit)
    ProblemKind.SSO_FAILED -> stringResource(R.string.access_problem_sso_failed)
    ProblemKind.SSO_MISCONFIGURED -> stringResource(R.string.access_problem_sso_misconfigured)
    ProblemKind.SSO_NOT_CONFIGURED -> stringResource(R.string.access_problem_sso_not_configured)
    ProblemKind.SSO_PAGE -> stringResource(R.string.access_problem_sso_page)
    ProblemKind.SSO_TLS -> stringResource(R.string.access_problem_sso_tls)
    ProblemKind.SESSION_NOT_CONFIRMED -> stringResource(R.string.access_problem_session)
    ProblemKind.CREDENTIALS -> stringResource(R.string.access_problem_credentials)
    ProblemKind.CREDENTIALS_MISSING -> stringResource(R.string.access_problem_credentials_missing)
    ProblemKind.RATE_LIMITED, ProblemKind.CODE_RATE_LIMITED -> stringResource(R.string.access_problem_rate_limited)
    ProblemKind.SIGN_IN_UNREACHABLE -> stringResource(R.string.access_problem_sign_in_unreachable)
    ProblemKind.SIGN_IN_FAILED -> problem.arg?.let { stringResource(R.string.access_problem_sign_in_failed_status, it) }
        ?: stringResource(R.string.access_problem_sign_in_failed)
    ProblemKind.CODE_EXPIRED -> stringResource(R.string.access_problem_code_expired)
    ProblemKind.CODE -> stringResource(R.string.access_problem_code)
    ProblemKind.CODE_INCOMPLETE -> stringResource(R.string.access_problem_code_incomplete)
    ProblemKind.CODE_FAILED -> stringResource(R.string.access_problem_code_failed)
    ProblemKind.RESEND_FAILED -> stringResource(R.string.access_problem_resend_failed)
}

/** Step 1: "Adresse du serveur" + "Continuer". */
@Composable
internal fun AddressSection(state: SignInUiState, actions: SignInActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        AccessField(
            value = state.address,
            onValueChange = actions::setAddress,
            label = stringResource(R.string.access_field_address),
            placeholder = stringResource(R.string.access_field_address_hint),
            helper = stringResource(R.string.access_field_address_help),
            error = state.problemIn(ProblemArea.ADDRESS)?.let { problemText(it) },
            enabled = state.busy == null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onGo = { actions.check() }),
        )
        PrimaryButton(
            text = stringResource(if (state.busy == Busy.CHECKING) R.string.access_checking else R.string.access_action_continue),
            onClick = actions::check,
            enabled = state.address.isNotBlank(),
            busy = state.busy == Busy.CHECKING,
        )
    }
}

/** The address chip and the probe card of a checked server. */
@Composable
internal fun ProbeSection(state: SignInUiState, actions: SignInActions, modifier: Modifier = Modifier, showChip: Boolean = true) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (showChip) {
            AddressChip(
                host = state.probe?.host ?: state.address,
                onChange = if (state.mode != SignInMode.REAUTH && state.busy == null) actions::changeServer else null,
            )
        }
        ProbeCard(state.probe, checking = state.probe == null)
    }
}

/** Step 2: "Se connecter avec Obligate", "ou", then the local account (collapsible). */
@Composable
internal fun MethodSection(state: SignInUiState, actions: SignInActions, modifier: Modifier = Modifier, cardColor: Color = ObliTheme.colors.surface1) {
    val probe = state.probe ?: return
    val c = ObliTheme.colors
    Column(modifier.fillMaxWidth()) {
        val ssoProblem = state.problemIn(ProblemArea.SSO)
        if (probe.offersSso) {
            if (ssoProblem != null) ErrorLine(problemText(ssoProblem), Modifier.padding(bottom = 10.dp))
            PrimaryButton(
                text = stringResource(if (state.busy == Busy.COMPLETING) R.string.access_sso_completing else R.string.access_action_sso),
                onClick = actions::startSso,
                icon = AccessIcons.LogIn,
                busy = state.busy == Busy.COMPLETING,
                enabled = state.busy == null,
            )
            Text(
                if (probe.obligateSessionKnown) {
                    stringResource(R.string.access_sso_reused)
                } else {
                    stringResource(R.string.access_sso_via, probe.obligateHost ?: probe.host)
                },
                style = FieldLabel,
                color = c.textMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            OrSeparator(Modifier.padding(top = 18.dp, bottom = 14.dp))
        } else {
            if (probe.obligateUnreachable) {
                Notice(stringResource(R.string.access_sso_unreachable_banner), ObliIcons.TriangleAlert, AccessColors.warning, Modifier.padding(bottom = 12.dp))
            }
            if (ssoProblem != null) ErrorLine(problemText(ssoProblem), Modifier.padding(bottom = 10.dp))
        }
        LocalSection(state, actions, collapsible = probe.offersSso, cardColor = cardColor)
    }
}

@Composable
private fun LocalSection(state: SignInUiState, actions: SignInActions, collapsible: Boolean, cardColor: Color) {
    val c = ObliTheme.colors
    val expanded = state.localExpanded || !collapsible
    val origin = state.probe?.origin
    val uri = LocalUriHandler.current
    AccessCard(color = cardColor) {
        val expandedLabel = stringResource(if (expanded) R.string.access_expanded else R.string.access_collapsed)
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 64.dp)
                .then(
                    if (collapsible) {
                        Modifier.clickable(role = Role.Button, onClick = actions::toggleLocal).semantics { stateDescription = expandedLabel }
                    } else {
                        Modifier
                    },
                )
                .padding(start = 16.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(36.dp).clip(FieldShape).background(c.hover), contentAlignment = Alignment.Center) {
                Icon(AccessIcons.User, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.access_local_title), style = ItemLabel, color = c.text)
                Text(
                    stringResource(if (state.mode == SignInMode.FIRST) R.string.access_local_subtitle else R.string.access_local_subtitle_server),
                    style = ObliTypography.body,
                    color = c.textMuted,
                )
            }
            if (collapsible) {
                Icon(ObliIcons.ChevronDown, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(20.dp).rotate(if (expanded) 180f else 0f))
            }
        }
        if (expanded) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val enabled = state.busy == null
                AccessField(
                    value = state.username,
                    onValueChange = actions::setUsername,
                    label = stringResource(R.string.access_field_username),
                    enabled = enabled,
                    contentType = ContentType.Username,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                )
                AccessField(
                    value = state.password,
                    onValueChange = actions::setPassword,
                    label = stringResource(R.string.access_field_password),
                    enabled = enabled,
                    error = state.problemIn(ProblemArea.LOCAL)?.let { problemText(it) },
                    contentType = ContentType.Password,
                    visualTransformation = if (state.passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onDone = { actions.signInLocal() }),
                    trailing = {
                        ObliIconButton(
                            icon = if (state.passwordVisible) AccessIcons.EyeOff else AccessIcons.Eye,
                            contentDescription = stringResource(if (state.passwordVisible) R.string.access_password_hide else R.string.access_password_show),
                            onClick = actions::togglePasswordVisible,
                        )
                    },
                )
                val label = stringResource(if (state.busy == Busy.SIGNING_IN) R.string.access_signing_in else R.string.access_action_sign_in)
                if (collapsible) {
                    NeutralButton(label, actions::signInLocal, busy = state.busy == Busy.SIGNING_IN, enabled = enabled)
                } else {
                    PrimaryButton(label, actions::signInLocal, busy = state.busy == Busy.SIGNING_IN || state.busy == Busy.COMPLETING, enabled = enabled, height = 48.dp)
                }
                if (origin != null) {
                    LinkButton(
                        stringResource(R.string.access_forgot_password),
                        onClick = { runCatching { uri.openUri("$origin/forgot-password") } },
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    )
                }
            }
        }
    }
}

/** List item label (Inter 500 16/22). */
internal val ItemLabel get() = ObliTypography.label.copy(fontSize = 16.sp, lineHeight = 22.sp)

/** Clipboard access for the paste chip: [hasText] never reads the content (no Android 12+ toast). */
internal class ClipboardAccess(val hasText: Boolean, val read: () -> CharSequence?) {
    companion object {
        val None = ClipboardAccess(false) { null }
    }
}

@Composable
internal fun rememberClipboardAccess(refreshKey: Any?): ClipboardAccess {
    val context = LocalContext.current
    return remember(refreshKey) {
        val manager = runCatching { context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager }.getOrNull()
        val hasText = runCatching {
            manager?.hasPrimaryClip() == true && manager.primaryClipDescription?.let {
                it.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) || it.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML)
            } == true
        }.getOrDefault(false)
        ClipboardAccess(hasText) {
            runCatching { manager?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context) }.getOrNull()
        }
    }
}

/** Step 3: the second factor (segmented method, 6 boxes, paste, resend, "Valider"). */
@Composable
internal fun TwoFactorSection(
    state: SignInUiState,
    actions: SignInActions,
    modifier: Modifier = Modifier,
    cardColor: Color = ObliTheme.colors.surface1,
    clipboard: ClipboardAccess = ClipboardAccess.None,
    now: () -> Long = System::currentTimeMillis,
) {
    val tf = state.twoFactor ?: return
    val c = ObliTheme.colors
    var pasteMissed by remember(tf.code) { mutableStateOf(false) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AccessCard(color = cardColor) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(AccessIcons.ShieldCheck, contentDescription = null, tint = c.text2, modifier = Modifier.size(20.dp))
                    Text(stringResource(R.string.access_2fa_title), style = ObliTypography.cardTitle, color = c.text)
                }
                if (tf.offersChoice) {
                    Segmented(
                        options = listOf(stringResource(R.string.access_2fa_method_app), stringResource(R.string.access_2fa_method_email)),
                        selected = if (tf.method == TwoFactorMethod.TOTP) 0 else 1,
                        onSelect = { actions.selectMethod(if (it == 0) TwoFactorMethod.TOTP else TwoFactorMethod.EMAIL) },
                        track = if (cardColor == c.surface1) c.chrome else c.surface1,
                    )
                }
                Text(
                    stringResource(if (tf.method == TwoFactorMethod.TOTP) R.string.access_2fa_totp else R.string.access_2fa_email),
                    style = ObliTypography.body,
                    color = c.text2,
                )
                OtpBoxes(
                    code = tf.code,
                    onCodeChange = actions::setCode,
                    rejections = tf.rejections,
                    label = stringResource(R.string.access_2fa_code_label),
                    enabled = state.busy == null,
                )
                state.problemIn(ProblemArea.CODE)?.let { ErrorLine(problemText(it)) }
                if (pasteMissed) Text(stringResource(R.string.access_2fa_paste_missed), style = FieldLabel, color = c.textMuted)
                if (tf.resent) Text(stringResource(R.string.access_2fa_resent), style = FieldLabel, color = c.text2)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (clipboard.hasText && tf.code.isEmpty()) {
                        PasteChip {
                            val code = OtpCodes.fromText(clipboard.read())
                            if (code != null) actions.setCode(code) else pasteMissed = true
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    if (tf.method == TwoFactorMethod.EMAIL) ResendButton(tf.resendAvailableAt, now, enabled = state.busy == null, onClick = actions::resend)
                }
                PrimaryButton(
                    text = stringResource(if (state.busy == Busy.VERIFYING || state.busy == Busy.COMPLETING) R.string.access_verifying else R.string.access_action_verify),
                    onClick = actions::verify,
                    enabled = tf.code.length == OtpCodes.LENGTH,
                    busy = state.busy == Busy.VERIFYING || state.busy == Busy.COMPLETING,
                    height = 48.dp,
                )
            }
        }
        LinkButton(stringResource(R.string.access_2fa_other_account), actions::leaveTwoFactor, Modifier.align(Alignment.CenterHorizontally), enabled = state.busy == null)
    }
}

@Composable
private fun PasteChip(onClick: () -> Unit) {
    val c = ObliTheme.colors
    val label = stringResource(R.string.access_2fa_paste)
    Box(Modifier.heightIn(min = 48.dp).clip(ButtonShape).clickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        Row(
            Modifier.height(36.dp).clip(ButtonShape).background(c.surface2).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(AccessIcons.ClipboardPaste, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
            Text(label, style = ObliTypography.label, color = c.text2)
        }
    }
}

@Composable
private fun ResendButton(availableAt: Long, now: () -> Long, enabled: Boolean, onClick: () -> Unit) {
    var current by remember { mutableLongStateOf(now()) }
    LaunchedEffect(availableAt) {
        current = now()
        while (current < availableAt) {
            delay(1_000)
            current = now()
        }
    }
    val left = ((availableAt - current + 999) / 1_000).coerceAtLeast(0)
    LinkButton(
        text = if (left > 0) stringResource(R.string.access_2fa_resend_in, left.toInt()) else stringResource(R.string.access_2fa_resend),
        onClick = onClick,
        enabled = enabled && left == 0L,
    )
}

/** S93: "Affichage dans l'application": display name, colour, monogram preview. */
@Composable
internal fun DisplaySection(state: SignInUiState, actions: SignInActions, modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    val name = state.monogramName
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Overline(stringResource(R.string.access_display_section), Modifier.padding(start = 4.dp, top = 12.dp))
        AccessField(
            value = state.displayName,
            onValueChange = actions::setDisplayName,
            label = stringResource(R.string.access_field_display_name),
            helper = stringResource(R.string.access_field_display_name_help),
            enabled = state.busy == null,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        )
        Text(stringResource(R.string.access_color_label), style = FieldLabel, color = c.textMuted, modifier = Modifier.padding(start = 4.dp, top = 6.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ColorSwatches(state.color, actions::setColor, columns = 4, ringBackground = c.bg)
            MonogramPreview(state.color, Monogram.of(name), name, Modifier.weight(1f))
        }
    }
}

/** S93 end: "Obliance Dev est ajouté." [Passer sur Obliance Dev] [Rester sur Obliance Prod]. */
@Composable
internal fun AddedSection(state: SignInUiState, actions: SignInActions, modifier: Modifier = Modifier) {
    val added = state.added ?: return
    val c = ObliTheme.colors
    val profile = added.profile
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AccessCard {
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(ObliIcons.CircleCheck, contentDescription = null, tint = AccessColors.success, modifier = Modifier.padding(top = 2.dp).size(20.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.access_added_title, profile.displayName), style = ObliTypography.cardTitle, color = c.text)
                    Text(stringResource(R.string.access_added_body), style = ObliTypography.body, color = c.text2)
                    Row(
                        Modifier.padding(top = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        ObliServerTile(profile.color, profile.monogram, profile.displayName, size = 28.dp)
                        Column {
                            Text(profile.displayName, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(ServerNames.hostOf(profile.origin), style = ObliTypography.monoCaption, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
        PrimaryButton(stringResource(R.string.access_added_switch, profile.displayName), actions::switchToAdded, busy = state.busy == Busy.COMPLETING)
        if (added.activeName != null) {
            NeutralButton(stringResource(R.string.access_added_stay, added.activeName), actions::stay, enabled = state.busy == null, height = 52.dp)
        } else {
            NeutralButton(stringResource(R.string.access_added_done), actions::stay, enabled = state.busy == null, height = 52.dp)
        }
    }
}

/** Everything below the title for the current step (S01 and S93 share it). */
@Composable
internal fun SignInBody(
    state: SignInUiState,
    actions: SignInActions,
    modifier: Modifier = Modifier,
    cardColor: Color = ObliTheme.colors.surface1,
    clipboard: ClipboardAccess = ClipboardAccess.None,
    showChip: Boolean = true,
) {
    Column(modifier.fillMaxWidth()) {
        when (state.step) {
            SignInStep.ADDRESS -> AddressSection(state, actions)
            SignInStep.METHOD -> {
                ProbeSection(state, actions, showChip = showChip)
                if (state.mode == SignInMode.ADD && state.probe != null) DisplaySection(state, actions)
                Spacer(Modifier.height(20.dp))
                MethodSection(state, actions, cardColor = cardColor)
            }
            SignInStep.TWO_FACTOR -> {
                if (showChip) {
                    AddressChip(state.probe?.host ?: state.address, onChange = if (state.mode != SignInMode.REAUTH && state.busy == null) actions::changeServer else null)
                    Spacer(Modifier.height(8.dp))
                }
                TwoFactorSection(state, actions, cardColor = cardColor, clipboard = clipboard)
            }
            SignInStep.ADDED -> AddedSection(state, actions)
        }
    }
}

/** Title line under the wordmark (S01) for the current step. */
@Composable
internal fun signInSubtitle(state: SignInUiState): String = stringResource(
    when (state.step) {
        SignInStep.ADDRESS -> R.string.access_sign_in_subtitle_address
        SignInStep.METHOD -> R.string.access_sign_in_subtitle_method
        SignInStep.TWO_FACTOR -> R.string.access_sign_in_subtitle_2fa
        SignInStep.ADDED -> R.string.access_sign_in_subtitle_method
    },
)
