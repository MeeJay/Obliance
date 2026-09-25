package tools.obli.obliance.triage

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliStatusPill
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.security.ActionSpec
import tools.obli.obliance.api.DeviceStatus

/** "Obliance Prod › ACME" (server only with 2+ servers), or the tenant alone. */
@Composable
internal fun scopeLabel(serverName: String?, tenantName: String?): String? = when {
    serverName != null && tenantName != null -> stringResource(R.string.triage_scope_server_tenant, serverName, tenantName)
    else -> serverName ?: tenantName
}

@Composable
private fun expiryText(minutes: Int?): String? = when {
    minutes == null -> null
    minutes <= 0 -> stringResource(R.string.triage_approval_expired)
    else -> stringResource(R.string.triage_approval_expires_in, minutes)
}

/**
 * Pinned "ESCALADES DE DROITS · N" section of the Alertes segment (design doc
 * §5 S10): two-person requests of every server, never mixed with machine
 * incidents, never red (blue overline, shield-alert, surface2).
 */
@Composable
internal fun EscalationsSection(items: List<EscalationUi>, time: TriageTime, onOpen: (EscalationUi) -> Unit, onShowAll: () -> Unit) {
    val c = ObliTheme.colors
    val blue = ObliTokens.UNREAD.toColor()
    Column(Modifier.fillMaxWidth().obliCard(color = c.surface2)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onShowAll).padding(start = 16.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(TriageIcons.ShieldAlert, contentDescription = null, tint = blue, modifier = Modifier.size(16.dp))
            Text(
                stringResource(R.string.triage_escalations_title, items.size).uppercase(),
                style = ObliTypography.overline,
                color = blue,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            Text(stringResource(R.string.triage_escalations_all), style = ObliTypography.labelSmall, color = c.text2)
            Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(16.dp))
        }
        items.take(3).forEach { e ->
            val a = e.item.approval
            val minutes = minutesLeft(e.expiresAt, time.now)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button) { onOpen(e) }
                    .padding(start = 16.dp, end = 12.dp, top = 6.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (e.server != null) ObliServerTile(e.server.color, e.server.monogram, e.server.displayName, size = 20.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(a.description.ifBlank { requestTypeLabel(a.requestType) }, style = ObliTypography.label, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val meta = listOfNotNull(a.requestedByName, e.tenantName, e.createdAt?.hhmm(time.zone)).joinToString(" · ")
                    Text(meta, style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    expiryText(minutes)?.let { Text(it, style = ObliTypography.monoCaption, color = expiryColor(minutes), maxLines = 1) }
                }
                Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(16.dp))
            }
        }
    }
}

/** Card of the Approbations segment: never approves from the list (Refuser / Examiner open the review). */
@Composable
internal fun ApprovalCard(e: EscalationUi, time: TriageTime, onDeny: () -> Unit, onReview: () -> Unit) {
    val c = ObliTheme.colors
    val a = e.item.approval
    val minutes = minutesLeft(e.expiresAt, time.now)
    Column(Modifier.fillMaxWidth().obliCard(color = c.surface1).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Overline(
                    server = e.server,
                    look = null,
                    parts = emptyList(),
                    labelOverride = requestTypeLabel(a.requestType),
                    colorOverride = ObliTokens.UNREAD.toColor(),
                    icon = TriageIcons.ShieldAlert,
                )
                Text(a.description.ifBlank { requestTypeLabel(a.requestType) }, style = ObliTypography.rowTitle, color = c.text)
                val by = a.requestedByName?.let { stringResource(R.string.triage_approval_requested_by, it) }
                Text(listOfNotNull(by, e.tenantName, e.createdAt?.hhmm(time.zone)).joinToString(" · "), style = ObliTypography.body, color = c.text2)
            }
            val label = expiryText(minutes)
            ExpiryRing(minutes, 44.dp, minutes?.takeIf { it > 0 }?.toString(), Modifier.semantics { contentDescription = label.orEmpty() })
        }
        expiryText(minutes)?.let { Text(it, style = ObliTypography.monoCaption, color = expiryColor(minutes)) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TonalButton(stringResource(R.string.triage_approval_deny), onDeny, modifier = Modifier.weight(1f), fill = true)
            PrimaryButton(stringResource(R.string.triage_approval_review), onReview, modifier = Modifier.weight(1f))
        }
    }
}

/**
 * Content of the approval review sheet (S11 over À traiter): who asks, what
 * will run, on which server › tenant, the reason, then Refuser (reason
 * required) or Approuver (T2). The ActionRunner prompts are its other steps.
 */
@Composable
internal fun ApprovalReviewContent(
    state: ReviewState,
    time: TriageTime,
    multiServer: Boolean,
    onReason: (String) -> Unit,
    onDecide: (approve: Boolean, spec: ActionSpec) -> Unit,
    onConfirm: (Boolean) -> Unit,
    onCode: (String?) -> Unit,
    onClose: () -> Unit,
) {
    val c = ObliTheme.colors
    val a = state.item.approval
    val ui = state.ui
    val server = ui?.server
    val serverName = if (multiServer) server?.displayName else null
    val scope = scopeLabel(serverName, ui?.tenantName)
    val targetName = state.target?.label
    val approveTitle = stringResource(R.string.triage_review_confirm_approve_title)
    val denyTitle = stringResource(R.string.triage_review_confirm_deny_title)
    val description = a.description.ifBlank { null }
    val targetText = when {
        description == null -> targetName ?: requestTypeLabel(a.requestType)
        targetName == null || description.contains(targetName, ignoreCase = true) -> description
        else -> "$description — $targetName"
    }
    val consequence = when (a.requestType) {
        "device_uninstall" -> stringResource(R.string.triage_review_effect_uninstall)
        "batch_command" -> pluralStringResource(R.plurals.triage_review_effect_batch, a.deviceIds.size, a.deviceIds.size)
        else -> null
    }
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when (val step = state.step) {
            ReviewStep.Details -> {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(6.dp)).background(c.surface2), contentAlignment = Alignment.Center) {
                        Icon(TriageIcons.ShieldAlert, null, tint = ObliTokens.UNREAD.toColor(), modifier = Modifier.size(20.dp))
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(requestTypeLabel(a.requestType), style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
                        ObliStatusPill(ObliTokens.Status.PENDING, stringResource(R.string.triage_review_pending))
                    }
                    val minutes = minutesLeft(parseInstant(a.expiresAt), time.now)
                    ExpiryRing(minutes, 48.dp, minutes?.takeIf { it > 0 }?.toString())
                }
                ExpiryLine(parseInstant(a.expiresAt), time)
                Fact(stringResource(R.string.triage_review_requester), listOfNotNull(a.requestedByName, parseInstant(a.createdAt)?.hhmm(time.zone)).joinToString(" · "))
                Fact(
                    stringResource(R.string.triage_review_target),
                    state.target?.let { d ->
                        listOfNotNull(d.label, d.osName, deviceStatusLabel(d.statusKind), d.ipLocal).joinToString(" · ")
                    } ?: a.deviceIds.firstOrNull()?.let { stringResource(R.string.triage_review_device_id, it) } ?: a.description,
                )
                Fact(stringResource(R.string.triage_review_effect), listOfNotNull(a.description.ifBlank { null }, consequence).joinToString("\n"))
                if (scope != null || server != null) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(stringResource(R.string.triage_review_where).uppercase(), style = ObliTypography.overline, color = c.textMuted)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (multiServer && server != null) ObliServerTile(server.color, server.monogram, server.displayName, size = 20.dp)
                            Text(scope ?: server?.displayName.orEmpty(), style = ObliTypography.body, color = c.text)
                        }
                    }
                }
                ReasonField(state.reason, onReason)
                state.problem?.let { ProblemLine(it) }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val specScope = scopeLabel(server?.displayName, ui?.tenantName).orEmpty()
                    TonalButton(
                        stringResource(R.string.triage_approval_deny),
                        onClick = { onDecide(false, ActionSpec(TriageViewModel.KEY_DENY, TriageViewModel.tierOf(false), denyTitle, targetText, specScope)) },
                        modifier = Modifier.weight(1f),
                        enabled = state.reason.isNotBlank() && !state.busy,
                        fill = true,
                    )
                    PrimaryButton(
                        stringResource(R.string.triage_review_approve),
                        onClick = { onDecide(true, ActionSpec(TriageViewModel.KEY_APPROVE, TriageViewModel.tierOf(true), approveTitle, targetText, specScope)) },
                        modifier = Modifier.weight(1f),
                        enabled = !state.busy,
                    )
                }
                if (state.reason.isBlank()) {
                    Text(stringResource(R.string.triage_review_deny_needs_reason), style = ObliTypography.labelSmall, color = c.textMuted)
                }
            }
            is ReviewStep.Confirm -> {
                Text(step.spec.title, style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
                Text(
                    listOf(step.spec.target, step.spec.scope).filter { it.isNotBlank() }.joinToString(" · "),
                    style = ObliTypography.monoCaption,
                    color = c.text2,
                )
                Text(
                    stringResource(if (step.approve) R.string.triage_review_confirm_approve_body else R.string.triage_review_confirm_deny_body, server?.displayName.orEmpty()),
                    style = ObliTypography.body,
                    color = c.text2,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextAction(stringResource(R.string.triage_action_cancel), { onConfirm(false) }, color = c.text2)
                    if (step.approve) {
                        PrimaryButton(stringResource(R.string.triage_review_approve), { onConfirm(true) }, modifier = Modifier.weight(1f))
                    } else {
                        TonalButton(stringResource(R.string.triage_approval_deny), { onConfirm(true) }, modifier = Modifier.weight(1f), fill = true)
                    }
                }
            }
            is ReviewStep.TenantSwitch -> {
                Text(stringResource(R.string.triage_review_switch_title, step.tenantName), style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (multiServer && server != null) ObliServerTile(server.color, server.monogram, server.displayName, size = 20.dp)
                    Text(scopeLabel(server?.displayName, step.tenantName).orEmpty(), style = ObliTypography.monoCaption, color = c.text2)
                }
                Text(stringResource(R.string.triage_review_switch_body, server?.displayName.orEmpty(), step.tenantName), style = ObliTypography.body, color = c.text2)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextAction(stringResource(R.string.triage_action_cancel), { onConfirm(false) }, color = c.text2)
                    PrimaryButton(stringResource(R.string.triage_review_switch_continue), { onConfirm(true) }, modifier = Modifier.weight(1f))
                }
            }
            is ReviewStep.TwoFactor -> {
                var code by remember { mutableStateOf("") }
                Text(stringResource(R.string.triage_review_code_title), style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
                Text(stringResource(R.string.triage_review_code_body), style = ObliTypography.body, color = c.text2)
                if (step.wrongCode) Text(stringResource(R.string.triage_review_code_wrong), style = ObliTypography.body, color = ObliTokens.Status.WARNING.argb.toColor())
                val codeLabel = stringResource(R.string.triage_review_code_label)
                BasicTextField(
                    value = code,
                    onValueChange = { v -> code = v.filter { it.isDigit() }.take(8) },
                    textStyle = ObliTypography.otp.copy(color = c.text),
                    singleLine = true,
                    cursorBrush = SolidColor(c.accent2),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(6.dp)).background(c.surface2)
                        .padding(horizontal = 16.dp, vertical = 12.dp).semantics { contentDescription = codeLabel },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextAction(stringResource(R.string.triage_action_cancel), { onCode(null) }, color = c.text2)
                    PrimaryButton(stringResource(R.string.triage_review_code_submit), { onCode(code) }, modifier = Modifier.weight(1f), enabled = code.length >= 6)
                }
            }
        }
        if (state.step == ReviewStep.Details) {
            TextAction(stringResource(R.string.triage_action_close), onClose, color = c.text2)
        }
    }
}

@Composable
private fun ExpiryLine(expiresAt: java.time.Instant?, time: TriageTime) {
    val minutes = minutesLeft(expiresAt, time.now) ?: return
    Text(expiryText(minutes).orEmpty(), style = ObliTypography.monoCaption, color = expiryColor(minutes))
}

@Composable
private fun Fact(label: String, value: String) {
    val c = ObliTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label.uppercase(), style = ObliTypography.overline, color = c.textMuted)
        Text(value, style = ObliTypography.body.copy(fontFeatureSettings = null), color = c.text)
    }
}

@Composable
private fun ReasonField(reason: String, onReason: (String) -> Unit) {
    val c = ObliTheme.colors
    val label = stringResource(R.string.triage_review_reason)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label.uppercase(), style = ObliTypography.overline, color = c.textMuted)
        BasicTextField(
            value = reason,
            onValueChange = onReason,
            textStyle = ObliTypography.body.copy(color = c.text),
            cursorBrush = SolidColor(c.accent2),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(6.dp)).background(c.surface2)
                .padding(horizontal = 12.dp, vertical = 14.dp).semantics { contentDescription = label },
        )
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(R.string.triage_review_reason_phone, R.string.triage_review_reason_window, R.string.triage_review_reason_target).forEach { res ->
                val text = stringResource(res)
                Tap48(onClick = { onReason(text) }, visual = Modifier.height(36.dp).background(c.surface2, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp)) {
                    Text(text, style = ObliTypography.label, color = c.text2, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun ProblemLine(problem: ReviewProblem) {
    val c = ObliTheme.colors
    val text = stringResource(
        when (problem) {
            ReviewProblem.ALREADY_RESOLVED -> R.string.triage_review_problem_resolved
            ReviewProblem.EXPIRED -> R.string.triage_review_problem_expired
            ReviewProblem.FORBIDDEN -> R.string.triage_review_problem_forbidden
            ReviewProblem.SESSION_EXPIRED -> R.string.triage_review_problem_session
            ReviewProblem.SWITCH_FAILED -> R.string.triage_review_problem_switch
            ReviewProblem.FAILED -> R.string.triage_review_problem_failed
        },
    )
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.hover).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(ObliIcons.Info, null, tint = c.text2, modifier = Modifier.size(16.dp))
        Text(text, style = ObliTypography.body, color = c.text2)
    }
}

@Composable
private fun deviceStatusLabel(status: DeviceStatus): String? = when (status) {
    DeviceStatus.ONLINE -> stringResource(R.string.triage_live_online)
    DeviceStatus.OFFLINE -> stringResource(R.string.triage_live_offline)
    DeviceStatus.WARNING -> stringResource(R.string.triage_severity_warning)
    DeviceStatus.CRITICAL -> stringResource(R.string.triage_severity_critical)
    DeviceStatus.MAINTENANCE -> stringResource(R.string.triage_live_maintenance)
    DeviceStatus.PENDING_UNINSTALL -> stringResource(R.string.triage_live_uninstalling)
    else -> null
}
