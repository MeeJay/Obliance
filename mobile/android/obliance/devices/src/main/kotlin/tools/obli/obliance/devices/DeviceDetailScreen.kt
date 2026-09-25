package tools.obli.obliance.devices

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.ZoneId
import java.util.Locale
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.obliance.api.Device
import tools.obli.obliance.api.DeviceMetrics
import tools.obli.obliance.api.DeviceStatus
import tools.obli.obliance.data.LocalObliServices

/**
 * S30/S31, read-only alpha: header, live metrics card and identity card of one
 * device of [serverId] (the application made it the active server before
 * opening, CONTRACT §2). Actions come later: "Agir" is shown disabled.
 */
@Composable
fun DeviceDetailScreen(serverId: ServerId, deviceId: Long, onBack: () -> Unit) {
    val services = LocalObliServices.current
    val clock = LocalDevicesClock.current
    val remote = LocalDeviceRemote.current ?: remember(services) { HttpDeviceRemote(services.sessions) }
    val vm = viewModel(key = "device-detail-${serverId.value}-$deviceId") {
        DeviceDetailViewModel(services, remote, clock, serverId, deviceId)
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Live metrics only while this screen is visible: leaving it or going to
    // background cancels the subscription and stops re-arming the agent (§7.4).
    LaunchedEffect(vm, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.followLive() } }
    val registry by services.registry.state.collectAsStateWithLifecycle()
    val scope by services.tenants.scope.collectAsStateWithLifecycle()
    val now = rememberNow(clock)

    val device = state.device
    val tenantName = device?.let { d ->
        d.tenantName?.takeIf { it.isNotBlank() }
            ?: scope.takeIf { it.serverId == serverId }?.tenants?.firstOrNull { it.id == d.tenantId }?.name
    }
    DeviceDetailContent(
        state = state,
        place = DevicePlace(registry.byId(serverId), registry.isMultiServer, tenantName),
        deviceId = deviceId,
        now = now,
        zone = clock.zone,
        onBack = onBack,
        onRefresh = vm::refresh,
        onRetry = vm::retry,
    )
}

/** Where the device lives: server (tile when 2+ servers), tenant. */
internal data class DevicePlace(val server: ServerProfile?, val multiServer: Boolean, val tenantName: String?)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DeviceDetailContent(
    state: DeviceDetailState,
    place: DevicePlace,
    deviceId: Long,
    now: Long,
    zone: ZoneId,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
) {
    val c = ObliTheme.colors
    val device = state.device
    val server = place.server?.takeIf { place.multiServer }
    // "Obliance Prod › ACME › Siège › Comptabilité" (the server only when 2+ servers).
    val subtitle = listOfNotNull(server?.displayName, place.tenantName)
        .plus(state.groupPath ?: listOfNotNull(device?.groupName?.takeIf { it.isNotBlank() }))
        .joinToString(" › ")
        .takeIf { it.isNotEmpty() && device != null }
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliDetailTopBar(
            title = device?.label ?: stringResource(R.string.devices_device_fallback, deviceId),
            onBack = onBack,
            backLabel = stringResource(R.string.devices_back),
            subtitle = subtitle,
            leading = server?.let { s -> { ObliServerTile(s.color, s.monogram, s.displayName) } },
        )
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxWidth().weight(1f),
        ) {
            when {
                state.problem?.kind == ProblemKind.NOT_FOUND ->
                    ObliCalmState(stringResource(R.string.devices_not_found), icon = ObliIcons.Monitor)
                device == null && state.problem != null -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                    ProblemCard(state.problem, onRetry = onRetry.takeIf { state.problem.kind != ProblemKind.SESSION_EXPIRED })
                }
                device == null -> DetailSkeleton()
                else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                    if (maxWidth >= TWO_COLUMNS) {
                        // Tablet detail pane (§5 S30 "Tablette"): header and identity | metrics.
                        Row(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
                            horizontalArrangement = Arrangement.spacedBy(24.dp),
                        ) {
                            Column(Modifier.width(380.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Header(state, device, now)
                                IdentityCard(device, state, now, zone)
                            }
                            Column(Modifier.weight(1f).widthIn(max = 640.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                MetricsCard(state, device, zone)
                            }
                        }
                    } else {
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Header(state, device, now)
                            MetricsCard(state, device, zone)
                            IdentityCard(device, state, now, zone)
                        }
                    }
                }
            }
        }
        // Nothing to act on without a device (loading, error, not found).
        if (device != null && state.problem?.kind != ProblemKind.NOT_FOUND) ActionBar()
    }
}

private val TWO_COLUMNS = 720.dp

/** Status pill, last-contact pill, OS line, "IP · agent", last user, mode banners (§5 S30 item 5). */
@Composable
private fun Header(state: DeviceDetailState, device: Device, now: Long) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DeviceStatusPill(device.statusKind)
            LastSeenPill(state.lastSeenAt, now)
        }
        Spacer(Modifier.height(2.dp))
        device.osName?.takeIf { it.isNotBlank() }?.let { os ->
            Text(os, style = ObliTypography.body.copy(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium), color = c.text)
        }
        val agent = device.agentVersion?.takeIf { it.isNotBlank() }?.let {
            stringResource(if (device.isLegacyAgent) R.string.devices_agent_legacy else R.string.devices_agent_version, it)
        }
        val line = listOfNotNull(device.ipLocal?.takeIf { it.isNotBlank() }, agent).joinToString(" · ")
        if (line.isNotEmpty()) Text(line, style = ObliTypography.monoCaption, color = c.text2)
        device.lastLoggedInUser?.takeIf { it.isNotBlank() }?.let { user ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(DeviceIcons.User, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(14.dp))
                Text(stringResource(R.string.devices_last_user, user), style = ObliTypography.labelSmall.copy(fontWeight = FontWeight.Normal), color = c.text2)
            }
        }
        if (device.privacyModeEnabled) ModeBanner(DeviceIcons.Shield, stringResource(R.string.devices_privacy_banner), PRIVACY)
        if (device.isLegacyAgent) ModeBanner(ObliIcons.Info, stringResource(R.string.devices_legacy_banner), c.text2)
    }
}

@Composable
private fun ModeBanner(icon: ImageVector, text: String, tint: Color) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(top = 6.dp).clip(RoundedCornerShape(8.dp)).background(c.surface1).padding(12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.padding(top = 2.dp).size(16.dp))
        Text(text, style = ObliTypography.body, color = c.text2)
    }
}

/**
 * Last-contact pill (§5 S30 item 5): < 5 min green, < 60 min yellow,
 * < 24 h orange, beyond red; always with the clock icon and the words.
 */
@Composable
private fun LastSeenPill(lastSeenAt: Long?, now: Long) {
    val c = ObliTheme.colors
    val (color, label) = if (lastSeenAt == null) {
        c.textMuted to stringResource(R.string.devices_seen_never)
    } else {
        val ms = (now - lastSeenAt).coerceAtLeast(0)
        val color = when {
            ms < 5 * 60_000 -> ObliTokens.Status.ONLINE
            ms < 60 * 60_000 -> ObliTokens.Status.WARNING
            ms < 24 * 3_600_000L -> ObliTokens.Status.PENDING_UNINSTALL
            else -> ObliTokens.Status.CRITICAL
        }.argb.toColor()
        val age = Age.between(now, lastSeenAt)
        color to if (age == Age.JustNow) stringResource(R.string.devices_seen_now) else stringResource(R.string.devices_seen_ago, ageText(age))
    }
    Row(
        Modifier.heightIn(min = 20.dp).clip(CircleShape).background(color.copy(alpha = 0.12f)).padding(start = 6.dp, end = 8.dp, top = 1.dp, bottom = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(ObliIcons.Clock, contentDescription = null, tint = color, modifier = Modifier.size(12.dp))
        Text(label, style = ObliTypography.labelSmall, color = color, maxLines = 1)
    }
}

/**
 * LIVE METRICS card: CPU, memory, every disk and the network, coloured by
 * the resolved thresholds; greyed with "Valeurs au …" on an offline device.
 */
@Composable
private fun MetricsCard(state: DeviceDetailState, device: Device, zone: ZoneId) {
    val c = ObliTheme.colors
    val locale = currentLocale()
    val metrics = state.metrics
    val greyed = device.statusKind == DeviceStatus.OFFLINE
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                stringResource(if (state.feed == MetricsFeed.LIVE && !greyed) R.string.devices_metrics_live else R.string.devices_metrics).uppercase(),
                style = ObliTypography.overline,
                color = c.textMuted,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            if (metrics != null && !greyed) {
                val label = when (state.feed) {
                    MetricsFeed.LIVE -> stringResource(R.string.devices_live)
                    MetricsFeed.POLLING -> stringResource(R.string.devices_polling)
                    MetricsFeed.SNAPSHOT -> state.metricsAt()?.let { stringResource(R.string.devices_updated_at, DeviceFormat.hhmm(it, zone)) }
                }
                if (label != null) FreshnessStamp(label, state.feed)
            }
        }
        if (metrics == null) {
            val pending = device.statusKind == DeviceStatus.PENDING || device.approvalStatus == "pending"
            Text(
                stringResource(if (pending) R.string.devices_pending_approval else R.string.devices_no_metrics_yet),
                style = ObliTypography.body,
                color = c.text2,
            )
        } else {
            MetricRows(metrics, device, state.thresholds, greyed, locale)
            if (greyed) {
                state.metricsAt()?.let {
                    Text(stringResource(R.string.devices_values_at, DeviceFormat.dateTime(it, zone)), style = ObliTypography.monoCaption, color = c.textMuted)
                }
            }
        }
        if (state.pushRequested) {
            Text(stringResource(R.string.devices_push_requested), style = ObliTypography.monoCaption, color = c.textMuted)
        }
    }
}

@Composable
private fun MetricRows(m: DeviceMetrics, device: Device, t: Thresholds, greyed: Boolean, locale: Locale) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        m.cpu?.let { cpu ->
            val cores = cpu.cores.size.takeIf { it > 0 } ?: device.cpuCores
            val info = listOfNotNull(
                cores?.let { pluralStringResource(R.plurals.devices_cores, it, it) },
                (cpu.model ?: device.cpuModel)?.takeIf { it.isNotBlank() },
            ).joinToString(" · ")
            MetricRow(DeviceIcons.Cpu, stringResource(R.string.devices_cpu), cpu.percent, t.cpu, greyed, detail = null, caption = info.ifEmpty { null })
        }
        m.memory?.let { mem ->
            val total = mem.totalMb?.div(1024.0) ?: device.ramTotalGb
            val used = mem.usedMb?.div(1024.0) ?: if (total != null && mem.percent != null) total * mem.percent!! / 100 else null
            val detail = if (used != null && total != null) {
                stringResource(R.string.devices_size_gb, DeviceFormat.gigabytes(used, locale), DeviceFormat.gigabytes(total, locale))
            } else {
                null
            }
            MetricRow(DeviceIcons.MemoryStick, stringResource(R.string.devices_ram), mem.percent, t.ram, greyed, detail = detail)
        }
        m.disks.forEach { disk ->
            val detail = if (disk.usedGb != null && disk.totalGb != null) {
                stringResource(R.string.devices_size_gb, DeviceFormat.gigabytes(disk.usedGb!!, locale), DeviceFormat.gigabytes(disk.totalGb!!, locale))
            } else {
                null
            }
            MetricRow(DeviceIcons.HardDrive, stringResource(R.string.devices_disk, disk.mount), disk.percent, t.forDisk(disk.mount), greyed, detail = detail)
        }
        m.network?.let { net ->
            if (net.inBytesPerSec != null || net.outBytesPerSec != null) NetworkRow(net.inBytesPerSec ?: 0.0, net.outBytesPerSec ?: 0.0, locale)
        }
    }
}

/** One metric: icon, label, used / total, value; 6 dp bar; threshold hint when crossed. */
@Composable
private fun MetricRow(icon: ImageVector, label: String, percent: Double?, threshold: Threshold, greyed: Boolean, detail: String?, caption: String? = null) {
    val c = ObliTheme.colors
    val level = threshold.levelOf(percent)
    val valueColor = when {
        greyed -> c.textMuted
        level == MetricLevel.NORMAL -> c.text
        else -> level.color
    }
    val crossed = threshold.crossed(level)?.takeIf { !greyed }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
            Text(label, style = ObliTypography.label, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (detail != null) Text(detail, style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 1)
            if (level == MetricLevel.CRITICAL && !greyed) {
                Icon(ObliIcons.CircleAlert, contentDescription = null, tint = level.color, modifier = Modifier.size(14.dp))
            } else if (level == MetricLevel.WARNING && !greyed) {
                Icon(ObliIcons.TriangleAlert, contentDescription = null, tint = level.color, modifier = Modifier.size(14.dp))
            }
            Text(
                percent?.let { percentText(it) } ?: stringResource(R.string.devices_no_value),
                style = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold),
                color = valueColor,
                maxLines = 1,
            )
        }
        MetricBar(percent, level, greyed)
        val hint = listOfNotNull(crossed?.let { stringResource(R.string.devices_threshold, it.toInt()) }, caption).joinToString(" · ")
        if (hint.isNotEmpty()) Text(hint, style = ObliTypography.monoCaption, color = c.textMuted)
    }
}

@Composable
private fun NetworkRow(inBps: Double, outBps: Double, locale: Locale) {
    val c = ObliTheme.colors
    val down = rateText(inBps, locale)
    val up = rateText(outBps, locale)
    val a11y = stringResource(R.string.devices_network_a11y, down, up)
    Row(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = a11y },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(DeviceIcons.Network, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
        Text(stringResource(R.string.devices_network), style = ObliTypography.label, color = c.text, modifier = Modifier.weight(1f))
        Icon(DeviceIcons.ArrowDown, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(14.dp))
        Text(down, style = ObliTypography.monoCaption, color = c.text2)
        Icon(DeviceIcons.ArrowUp, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(14.dp))
        Text(up, style = ObliTypography.monoCaption, color = c.text2)
    }
}

@Composable
private fun rateText(bps: Double, locale: Locale): String {
    val (value, unit) = DeviceFormat.rate(bps, locale)
    return stringResource(if (unit == DeviceFormat.RateUnit.KB) R.string.devices_rate_kb else R.string.devices_rate_mb, value)
}

/** Identity (§5 S31 card 4, network card 5 folded in): only the fields the server sent. */
@Composable
private fun IdentityCard(device: Device, state: DeviceDetailState, now: Long, zone: ZoneId) {
    val c = ObliTheme.colors
    val lastSeen = state.lastSeenAt?.let { at ->
        val age = Age.between(now, at)
        val rel = if (age == Age.JustNow) stringResource(R.string.devices_age_now) else stringResource(R.string.devices_ago, ageText(age))
        DeviceFormat.dateTime(at, zone) + " · " + rel
    }
    val agent = device.agentVersion?.takeIf { it.isNotBlank() }?.let { v ->
        when {
            device.isLegacyAgent -> stringResource(R.string.devices_agent_legacy, v)
            device.updateAvailable -> stringResource(R.string.devices_agent_with_state, v, stringResource(R.string.devices_agent_update))
            else -> stringResource(R.string.devices_agent_with_state, v, stringResource(R.string.devices_agent_up_to_date))
        }
    }
    val version = listOfNotNull(
        device.osVersion?.takeIf { it.isNotBlank() },
        device.osBuild?.takeIf { it.isNotBlank() }?.let { stringResource(R.string.devices_build, it) },
    ).joinToString(" · ").ifEmpty { null }
    val rows = listOfNotNull(
        IdRow(R.string.devices_id_hostname, device.hostname.takeIf { it.isNotBlank() && it != device.label }, mono = true),
        IdRow(R.string.devices_id_os, device.osName?.takeIf { it.isNotBlank() }),
        IdRow(R.string.devices_id_version, version, mono = true),
        IdRow(R.string.devices_id_arch, device.osArch?.takeIf { it.isNotBlank() }, mono = true),
        IdRow(R.string.devices_id_ip_local, device.ipLocal?.takeIf { it.isNotBlank() }, mono = true),
        IdRow(R.string.devices_id_ip_public, device.ipPublic?.takeIf { it.isNotBlank() }, mono = true),
        IdRow(R.string.devices_id_mac, device.macAddress?.takeIf { it.isNotBlank() }, mono = true),
        IdRow(R.string.devices_id_agent, agent, mono = true),
        IdRow(R.string.devices_id_last_seen, lastSeen, mono = true),
        IdRow(R.string.devices_id_reboot, if (device.rebootPending) stringResource(R.string.devices_reboot_pending) else null),
        IdRow(R.string.devices_id_timezone, device.timezone?.takeIf { it.isNotBlank() }, mono = true),
    ).filter { it.value != null }
    Card {
        Text(stringResource(R.string.devices_identity).uppercase(), style = ObliTypography.overline, color = c.textMuted, modifier = Modifier.semantics { heading() })
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            rows.forEach { row ->
                Row(Modifier.fillMaxWidth().heightIn(min = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(row.label), style = ObliTypography.body, color = c.text2, modifier = Modifier.weight(0.36f))
                    Text(
                        row.value!!,
                        style = if (row.mono) ObliTypography.monoCaption.copy(lineHeight = 20.sp) else ObliTypography.body,
                        color = c.text,
                        modifier = Modifier.weight(0.64f),
                    )
                }
            }
        }
    }
}

private class IdRow(val label: Int, val value: String?, val mono: Boolean = false)

/**
 * Bottom action bar (§5 S30 item 8), the only divider line. Actions are not
 * in this alpha: "Agir" is visible but disabled, with its reason.
 */
@Composable
private fun ActionBar() {
    val c = ObliTheme.colors
    val divider = c.divider
    val a11y = stringResource(R.string.devices_act_a11y)
    Row(
        Modifier.fillMaxWidth().height(64.dp).background(c.chrome)
            .drawBehind { drawLine(divider, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.devices_actions), style = ObliTypography.label, color = c.text2)
            Text(stringResource(R.string.devices_soon), style = ObliTypography.monoCaption, color = c.textMuted)
        }
        Row(
            Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2)
                .semantics(mergeDescendants = true) {
                    contentDescription = a11y
                    disabled()
                }
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(DeviceIcons.Zap, contentDescription = null, tint = c.textFaint, modifier = Modifier.size(18.dp))
            Text(stringResource(R.string.devices_act), style = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold), color = c.textFaint)
        }
    }
}

@Composable
private fun DetailSkeleton() {
    val c = ObliTheme.colors
    val label = stringResource(R.string.devices_loading_device)
    val t = rememberInfiniteTransition(label = "skeleton")
    val a by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(600, easing = LinearEasing), RepeatMode.Reverse), label = "skeleton-alpha")
    Column(
        Modifier.fillMaxSize().padding(16.dp).alpha(a).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.width(80.dp).height(20.dp).clip(CircleShape).background(c.surface2))
            Box(Modifier.width(110.dp).height(20.dp).clip(CircleShape).background(c.surface2))
        }
        Box(Modifier.width(220.dp).height(18.dp).clip(RoundedCornerShape(4.dp)).background(c.surface2))
        Box(Modifier.width(180.dp).height(12.dp).clip(RoundedCornerShape(4.dp)).background(c.surface2))
        Box(Modifier.fillMaxWidth().height(220.dp).clip(RoundedCornerShape(12.dp)).background(c.surface1))
        Box(Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(12.dp)).background(c.surface1))
    }
}
