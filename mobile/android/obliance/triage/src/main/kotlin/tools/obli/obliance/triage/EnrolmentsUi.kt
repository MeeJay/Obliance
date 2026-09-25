package tools.obli.obliance.triage

import android.content.res.Resources
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.currentComposer
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliIconButton
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliStatusPill
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.security.ActionRunner
import tools.obli.core.security.ui.ActionMessages
import tools.obli.core.security.ui.LocalActionRunner

/*
 * « Enrôlements » segment of S10 and S12 « Examen d'enrôlement » (design doc
 * §5 S10, S12; STYLEKIT device-row-pending, status-pill-pending,
 * section-header-action, btn-tonal, btn-primary, bottom-sheet, empty-state).
 */

/**
 * The app's [ActionRunner] (ObliActionHost at the root, CONTRACT §12), or null
 * when the screen is drawn without the host (previews, screenshot tests): the
 * lookup does not throw, the buttons then do nothing.
 */
@Composable
internal fun actionRunnerOrNull(): ActionRunner? {
    val locals = currentComposer.currentCompositionLocalMap
    return remember(locals) { runCatching { locals[LocalActionRunner] }.getOrNull() }
}

/** « il y a 25 min », « à l'instant ». */
@Composable
internal fun enrolmentAge(at: Instant?, now: Long): String? {
    at ?: return null
    if (now - at.toEpochMilli() < 60_000L) return stringResource(R.string.triage_enrol_age_now)
    return relativeAge(at, now)?.let { stringResource(R.string.triage_enrol_age, it) }
}

/** « 25 sept. 02:59 » in the app's language. */
@Composable
internal fun dayTime(at: Instant, time: TriageTime): String {
    // The configuration's locale (observable): the month follows the app's language.
    val locale: Locale = LocalConfiguration.current.locales[0] ?: Locale.ROOT
    return at.atZone(time.zone).format(DateTimeFormatter.ofPattern("d MMM HH:mm", locale))
}

/** The segment: notices, then one « Serveur › Tenant » section per group of pending devices. */
@Composable
internal fun EnrolmentsList(ui: TriageUi, time: TriageTime, actions: TriageActions) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 88.dp)) {
        items(ui.enrolmentNotices, key = { "enotice-${it.server.id.value}" }) { n ->
            when (n) {
                is FeedNotice.Unreachable -> NoticeLine(
                    TriageIcons.WifiOff,
                    n.lastOkAt?.let { stringResource(R.string.triage_enrol_notice_unreachable_since, n.server.displayName, it.hhmm(time.zone)) }
                        ?: stringResource(R.string.triage_notice_unreachable, n.server.displayName),
                )
                is FeedNotice.Expired -> NoticeLine(
                    ObliIcons.Lock,
                    stringResource(R.string.triage_notice_expired, n.server.displayName),
                    action = stringResource(R.string.triage_notice_reconnect),
                    onAction = { actions.onReconnect(n.server.id) },
                )
            }
        }
        when (ui.enrolmentState) {
            ListState.LOADING -> items(2, key = { "eskeleton-$it" }) {
                Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp)) { SkeletonCard() }
            }
            ListState.ERROR -> item("eerror") { ErrorCard(actions.onRefresh) }
            ListState.EMPTY -> item("eempty") {
                Box(Modifier.fillParentMaxWidth().heightIn(min = 320.dp)) {
                    ObliCalmState(
                        title = stringResource(R.string.triage_enrol_empty),
                        body = stringResource(R.string.triage_enrol_empty_body),
                        icon = ObliIcons.Monitor,
                    )
                }
            }
            ListState.CONTENT -> ui.enrolmentGroups.forEach { group ->
                item("egroup-${group.serverId.value}-${group.tenantId}") {
                    EnrolmentGroupHeader(group, onApproveAll = { actions.onEnrolApproveAll(group) })
                }
                items(group.items, key = { "e-${it.key.serverId.value}-${it.key.deviceId}" }) { item ->
                    EnrolmentCard(
                        item,
                        time,
                        onOpen = { actions.onEnrolOpen(item) },
                        onApprove = { actions.onEnrolApprove(item) },
                        onRefuse = { actions.onEnrolRefuse(item) },
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp),
                    )
                }
            }
        }
    }
}

/** STYLEKIT section-header-action: « [OP] OBLIANCE PROD › ACME · 2 » + « Tout approuver (2) » (T1). */
@Composable
internal fun EnrolmentGroupHeader(group: EnrolmentGroupUi, onApproveAll: () -> Unit) {
    val c = ObliTheme.colors
    val scope = scopeLabel(group.serverName, group.tenantName ?: unknownTenant(group.tenantId)).orEmpty()
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 16.dp, end = 4.dp, top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        group.server?.let { ObliServerTile(it.color, it.monogram, it.displayName, size = 20.dp) }
        Text(
            stringResource(R.string.triage_enrol_group_header, scope, group.items.size).uppercase(),
            style = ObliTypography.overline,
            color = c.textMuted,
            // Wraps next to « Tout approuver (n) » rather than cutting the tenant or the count.
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (group.canBulk) {
            val n = group.bulk.size
            val description = pluralStringResource(R.plurals.triage_enrol_approve_all_cd, n, n, scope)
            TextAction(
                stringResource(R.string.triage_enrol_approve_all, n),
                onApproveAll,
                modifier = Modifier.semantics { contentDescription = description },
                color = ObliTokens.UNREAD.toColor(),
            )
        }
    }
}

@Composable
private fun unknownTenant(tenantId: Long?): String =
    if (tenantId != null) stringResource(R.string.triage_enrol_tenant_unknown, tenantId) else stringResource(R.string.triage_enrol_tenant_none)

/** Mono tenant tag of a device row (STYLEKIT device-row). */
@Composable
private fun TenantTag(name: String) {
    val c = ObliTheme.colors
    Text(
        name.uppercase(),
        style = ObliTypography.overline.copy(letterSpacing = ObliTypography.overline.letterSpacing * 0.45f),
        color = c.text2,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.surface2).padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

/**
 * One pending device (STYLEKIT device-row-pending as a card): name + tenant tag
 * + « En attente » pill (dot and label, never colour alone), the mono line
 * « OS · clé « … » · IP · il y a 12 min », then Refuser (tonal) and Approuver
 * (filled). Tapping the card opens S12. Greyed with the reason when its server
 * expired or does not answer.
 */
@Composable
internal fun EnrolmentCard(
    item: EnrolmentItemUi,
    time: TriageTime,
    onOpen: () -> Unit,
    onApprove: () -> Unit,
    onRefuse: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ObliTheme.colors
    val openLabel = stringResource(R.string.triage_enrol_open)
    val keyText = item.keyName?.let { stringResource(R.string.triage_enrol_key, it) }
    val line = listOfNotNull(item.device.osName?.takeIf { it.isNotBlank() }, keyText, item.device.ipLocal?.takeIf { it.isNotBlank() }, enrolmentAge(item.createdAt, time.now))
        .joinToString(" · ")
    Column(
        modifier.fillMaxWidth().obliCard(color = c.surface1).clickable(onClickLabel = openLabel, onClick = onOpen).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.alpha(if (item.stale != null) 0.55f else 1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(item.label, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    item.tenantName?.let { TenantTag(it) }
                    if (item.device.duplicateAgentIdSuspected) {
                        Icon(
                            ObliIcons.TriangleAlert,
                            contentDescription = stringResource(R.string.triage_enrol_duplicate_cd),
                            tint = ObliTokens.Status.WARNING.argb.toColor(),
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
                ObliStatusPill(ObliTokens.Status.PENDING, stringResource(R.string.triage_enrol_pending))
            }
            if (line.isNotEmpty()) Text(line, style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        StaleLine(item.stale, time)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val refuseCd = stringResource(R.string.triage_enrol_refuse_cd, item.label)
            val approveCd = stringResource(R.string.triage_enrol_approve_cd, item.label)
            TonalButton(
                stringResource(R.string.triage_enrol_refuse),
                onRefuse,
                modifier = Modifier.weight(1f).semantics { contentDescription = refuseCd },
                enabled = item.actionable,
                fill = true,
            )
            PrimaryButton(
                stringResource(R.string.triage_enrol_approve),
                onApprove,
                modifier = Modifier.weight(1f).semantics { contentDescription = approveCd },
                enabled = item.actionable,
            )
        }
    }
}

/** « Session expirée · Se reconnecter » / « Injoignable depuis 03:02 » under a greyed card. */
@Composable
private fun StaleLine(stale: EnrolmentStale?, time: TriageTime) {
    val c = ObliTheme.colors
    val (icon, text) = when (stale) {
        null -> return
        EnrolmentStale.Expired -> ObliIcons.Lock to stringResource(R.string.triage_enrol_stale_expired)
        is EnrolmentStale.Unreachable -> TriageIcons.WifiOff to (
            stale.since?.let { stringResource(R.string.triage_enrol_stale_unreachable, it.hhmm(time.zone)) }
                ?: stringResource(R.string.triage_enrol_stale_unreachable_unknown)
            )
    }
    Row(Modifier.heightIn(min = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(14.dp))
        Text(text, style = ObliTypography.labelSmall, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * S12 « Examen d'enrôlement »: enough context not to approve an unknown
 * machine (host, OS, IPs with geolocation, key → default group, first seen,
 * scope, duplicate-agent warning, the « Agent approuvé » note), then Approuver
 * (T1), Approuver et déplacer vers… (group picker, then T1 naming the group),
 * Refuser (T1). Internal so screenshots capture it outside the sheet window.
 */
@Composable
internal fun EnrolmentReviewContent(
    state: EnrolmentReviewState,
    time: TriageTime,
    multiServer: Boolean,
    onApprove: () -> Unit,
    onRefuse: () -> Unit,
    onPickGroup: () -> Unit,
    onMove: (GroupChoice) -> Unit,
    onBack: () -> Unit,
    onClose: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when (state.step) {
            EnrolmentStep.DETAILS -> ReviewDetails(state, time, multiServer, onApprove, onRefuse, onPickGroup, onClose)
            EnrolmentStep.PICK_GROUP -> GroupPicker(state, onMove, onBack)
        }
    }
}

@Composable
private fun ReviewDetails(
    state: EnrolmentReviewState,
    time: TriageTime,
    multiServer: Boolean,
    onApprove: () -> Unit,
    onRefuse: () -> Unit,
    onPickGroup: () -> Unit,
    onClose: () -> Unit,
) {
    val c = ObliTheme.colors
    val item = state.item
    val d = item.device
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(6.dp)).background(c.surface2), contentAlignment = Alignment.Center) {
            Icon(ObliIcons.Monitor, null, tint = c.text2, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.triage_enrol_review_overline).uppercase(), style = ObliTypography.overline, color = c.textMuted)
            Text(item.label, style = ObliTypography.dialogTitle, color = c.text, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
        }
        ObliStatusPill(ObliTokens.Status.PENDING, stringResource(R.string.triage_enrol_pending))
    }
    // Where it runs: « Obliance Prod › ACME » (server from two servers).
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (multiServer && item.server != null) ObliServerTile(item.server.color, item.server.monogram, item.server.displayName, size = 20.dp)
        Text(
            scopeLabel(if (multiServer) item.serverName else null, item.tenantName ?: unknownTenant(d.tenantId)).orEmpty(),
            style = ObliTypography.monoCaption,
            color = c.text2,
        )
    }
    if (d.duplicateAgentIdSuspected) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(ObliTokens.Status.WARNING.argb.toColor().copy(alpha = 0.10f)).padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(ObliIcons.TriangleAlert, null, tint = ObliTokens.Status.WARNING.argb.toColor(), modifier = Modifier.size(18.dp))
            Text(stringResource(R.string.triage_enrol_duplicate_banner), style = ObliTypography.body, color = c.text)
        }
    }
    Fact(stringResource(R.string.triage_enrol_fact_hostname), d.hostname.ifBlank { item.label })
    val os = listOfNotNull(
        listOfNotNull(d.osName, d.osVersion).filter { it.isNotBlank() }.joinToString(" ").takeIf { it.isNotBlank() },
        d.osArch?.takeIf { it.isNotBlank() },
    ).joinToString(" · ")
    if (os.isNotBlank()) Fact(stringResource(R.string.triage_enrol_fact_os), os)
    d.ipLocal?.takeIf { it.isNotBlank() }?.let { Fact(stringResource(R.string.triage_enrol_fact_ip_local), it) }
    val geo = listOfNotNull(d.geoCity, d.geoCountry).filter { it.isNotBlank() }.joinToString(", ")
    val publicIp = listOfNotNull(d.ipPublic?.takeIf { it.isNotBlank() }, geo.takeIf { it.isNotBlank() }).joinToString(" · ")
    if (publicIp.isNotBlank()) Fact(stringResource(R.string.triage_enrol_fact_ip_public), publicIp)
    val keyLine = when {
        item.keyName == null -> stringResource(R.string.triage_enrol_key_unknown)
        state.keyGroupPath != null -> stringResource(R.string.triage_enrol_key_group, item.keyName, state.keyGroupPath!!)
        else -> stringResource(R.string.triage_enrol_key_no_group, item.keyName)
    }
    Fact(stringResource(R.string.triage_enrol_fact_key), keyLine)
    item.createdAt?.let { at ->
        val relative = enrolmentAge(at, time.now)
        Fact(
            stringResource(R.string.triage_enrol_fact_first_seen),
            relative?.let { stringResource(R.string.triage_enrol_first_seen_value, dayTime(at, time), it) } ?: dayTime(at, time),
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(ObliIcons.Info, null, tint = c.text2, modifier = Modifier.size(16.dp))
        Text(stringResource(R.string.triage_enrol_note_scenarios), style = ObliTypography.body, color = c.text2)
    }
    StaleLine(item.stale, time)
    state.problem?.let { EnrolmentProblem(it) }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val refuseCd = stringResource(R.string.triage_enrol_refuse_cd, item.label)
        val approveCd = stringResource(R.string.triage_enrol_approve_cd, item.label)
        TonalButton(
            stringResource(R.string.triage_enrol_refuse),
            onRefuse,
            modifier = Modifier.weight(1f).semantics { contentDescription = refuseCd },
            enabled = item.actionable,
            fill = true,
        )
        PrimaryButton(
            stringResource(R.string.triage_enrol_approve),
            onApprove,
            modifier = Modifier.weight(1f).semantics { contentDescription = approveCd },
            enabled = item.actionable,
        )
    }
    TonalButton(
        stringResource(R.string.triage_enrol_approve_move),
        onPickGroup,
        icon = ObliIcons.ChevronRight,
        trailingIcon = true,
        enabled = item.actionable,
        fill = true,
    )
    TextAction(stringResource(R.string.triage_action_close), onClose, color = c.text2)
}

/** The failure of an action sent from the sheet (the screen snackbar is behind it). */
@Composable
private fun EnrolmentProblem(outcome: EnrolmentOutcome) {
    val c = ObliTheme.colors
    val res = androidx.compose.ui.platform.LocalResources.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.hover).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(ObliIcons.Info, null, tint = c.text2, modifier = Modifier.size(16.dp))
        Text(enrolmentMessage(res, outcome), style = ObliTypography.body, color = c.text2)
    }
}

/** « Approuver et déplacer vers… »: the groups of the device's tenant, the key's default group flagged. */
@Composable
private fun GroupPicker(state: EnrolmentReviewState, onMove: (GroupChoice) -> Unit, onBack: () -> Unit) {
    val c = ObliTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        ObliIconButton(ObliIcons.ArrowLeft, stringResource(R.string.triage_back), onBack)
        Text(stringResource(R.string.triage_enrol_pick_title), style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
    }
    val tenant = state.item.tenantName ?: unknownTenant(state.item.device.tenantId)
    Text(stringResource(R.string.triage_enrol_pick_body, state.item.label, tenant), style = ObliTypography.body, color = c.text2)
    when (state.groups) {
        GroupsLoad.Loading -> Text(stringResource(R.string.triage_enrol_pick_loading), style = ObliTypography.body, color = c.textMuted)
        GroupsLoad.Failed -> Text(stringResource(R.string.triage_enrol_pick_failed), style = ObliTypography.body, color = c.text2)
        is GroupsLoad.Loaded -> {
            val choices = state.choices
            if (choices.isEmpty()) Text(stringResource(R.string.triage_enrol_pick_empty), style = ObliTypography.body, color = c.text2)
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface2)) {
                choices.forEach { g ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, enabled = state.item.actionable) { onMove(g) }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(g.path, style = ObliTypography.label, color = c.text, modifier = Modifier.weight(1f))
                        if (g.isKeyDefault) {
                            Text(stringResource(R.string.triage_enrol_pick_key_default), style = ObliTypography.labelSmall, color = ObliTokens.UNREAD.toColor())
                        }
                        Icon(ObliIcons.ChevronRight, null, tint = c.textMuted, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

/** The text of an enrolment outcome (snackbar or the sheet's problem line); failures are worded by ActionMessages (§12). */
internal fun enrolmentMessage(res: Resources, outcome: EnrolmentOutcome): String = when (outcome) {
    is EnrolmentOutcome.Approved -> res.getString(R.string.triage_enrol_done_approved, outcome.label)
    is EnrolmentOutcome.Refused -> res.getString(R.string.triage_enrol_done_refused, outcome.label)
    is EnrolmentOutcome.ApprovedMany -> res.getQuantityString(R.plurals.triage_enrol_done_bulk, outcome.count, outcome.count)
    is EnrolmentOutcome.ApprovedAndMoved -> res.getString(R.string.triage_enrol_done_moved, outcome.label, outcome.groupPath)
    is EnrolmentOutcome.ApprovedNotMoved -> res.getString(
        R.string.triage_enrol_not_moved,
        outcome.label,
        outcome.result?.let { ActionMessages.describe(res, it, "")?.text }?.takeIf { it.isNotBlank() } ?: res.getString(R.string.triage_enrol_not_applied),
    )
    EnrolmentOutcome.NotApplied -> res.getString(R.string.triage_enrol_not_applied)
    is EnrolmentOutcome.Failed -> ActionMessages.describe(res, outcome.result, "")?.text?.takeIf { it.isNotBlank() }
        ?: res.getString(R.string.triage_error_server)
}
