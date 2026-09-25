package tools.obli.obliance.fleet

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.time.ZoneId
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliFreshness
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliScreenHeader
import tools.obli.core.designsystem.ObliStatusPill
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.obliance.data.LocalObliServices

/**
 * Source of the Fleet figures. Null (the default) = the real server calls;
 * screenshot tests provide an in-memory source (the sample services have no
 * HTTP server behind them).
 */
internal val LocalFleetSource = staticCompositionLocalOf<FleetSource?> { null }

/** S70: fleet indicators of the ACTIVE server, in its session tenant (design doc §5 S70). */
@Composable
fun FleetScreen(onOpenDevices: () -> Unit) {
    FleetRoute(onOpenDevices = onOpenDevices)
}

@Composable
internal fun FleetRoute(
    onOpenDevices: () -> Unit,
    clock: () -> Long = System::currentTimeMillis,
    zone: ZoneId = ZoneId.systemDefault(),
) {
    val services = LocalObliServices.current
    val injected = LocalFleetSource.current
    val source = remember(services, injected) { injected ?: ServicesFleetSource(services) }
    val vm = viewModel { FleetViewModel(services, source, clock) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    FleetContent(ui, FleetTime(clock(), zone), onOpenDevices, vm::refresh)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FleetContent(ui: FleetUi, time: FleetTime, onOpenDevices: () -> Unit, onRefresh: () -> Unit) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        val filter = ui.filter ?: ui.data?.filter
        ObliScreenHeader(
            stringResource(R.string.fleet_title),
            freshness = freshnessOf(ui, time),
            trailing = { if (filter != null) FilterScope(filter) },
        )
        PullToRefreshBox(isRefreshing = ui.refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
            val data = ui.data
            when {
                data != null && data.summary.total == 0 && data.summary.pending == 0 && ui.problem == null -> EmptyFleet(onOpenDevices)
                data != null -> FleetBody(ui, data, time, onOpenDevices, onRefresh)
                ui.loading -> Loading()
                else -> ProblemState(ui.problem, onRefresh)
            }
        }
    }
}

@Composable
private fun freshnessOf(ui: FleetUi, time: FleetTime): ObliFreshness? {
    val at = ui.updatedAt ?: return null
    return if (ui.problem != null && ui.problem != FleetProblem.SESSION_EXPIRED) {
        ObliFreshness.Stale(stringResource(R.string.fleet_stale_at, time.clock(at)))
    } else {
        ObliFreshness.Updated(stringResource(R.string.fleet_updated_at, time.clock(at)))
    }
}

// --- States ------------------------------------------------------------------

@Composable
private fun Loading() {
    val c = ObliTheme.colors
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(120.dp))
        CircularProgressIndicator(color = c.text2, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.fleet_loading), style = ObliTypography.body, color = c.text2)
    }
}

@Composable
private fun ProblemState(problem: FleetProblem?, onRetry: () -> Unit) {
    val (icon, text) = when (problem) {
        FleetProblem.OFFLINE -> FleetIcons.WifiOff to R.string.fleet_error_offline_empty
        FleetProblem.SESSION_EXPIRED -> ObliIcons.Lock to R.string.fleet_session_expired
        FleetProblem.FORBIDDEN -> ObliIcons.Lock to R.string.fleet_error_forbidden
        FleetProblem.SERVER, null -> ObliIcons.Info to R.string.fleet_error_server
    }
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ObliCalmState(
            title = stringResource(text),
            icon = icon,
            modifier = Modifier.heightIn(min = 480.dp),
            action = if (problem == FleetProblem.SESSION_EXPIRED || problem == FleetProblem.FORBIDDEN) null else {
                { TonalButton(stringResource(R.string.fleet_retry), onRetry) }
            },
        )
    }
}

@Composable
private fun EmptyFleet(onOpenDevices: () -> Unit) {
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ObliCalmState(
            title = stringResource(R.string.fleet_empty_title),
            body = stringResource(R.string.fleet_empty_body),
            icon = ObliIcons.LayoutDashboard,
            modifier = Modifier.heightIn(min = 480.dp),
            action = { TonalButton(stringResource(R.string.fleet_open_devices), onOpenDevices) },
        )
    }
}

/** Tonal button (accent 12 % + accent2 label, design doc §8.2): the only "accent" in the content. */
@Composable
private fun TonalButton(label: String, onClick: () -> Unit) {
    val c = ObliTheme.colors
    FilledTonalButton(
        onClick = onClick,
        modifier = Modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.filledTonalButtonColors(containerColor = c.accent2.copy(alpha = 0.12f), contentColor = c.accent2),
    ) { Text(label, style = ObliTypography.label) }
}

/** One-line notice above the figures when the last refresh failed (the previous figures stay). */
@Composable
private fun ProblemBanner(problem: FleetProblem, onRetry: () -> Unit) {
    val c = ObliTheme.colors
    val (icon, text) = when (problem) {
        FleetProblem.OFFLINE -> FleetIcons.WifiOff to R.string.fleet_error_offline
        FleetProblem.SESSION_EXPIRED -> ObliIcons.Lock to R.string.fleet_session_expired
        FleetProblem.FORBIDDEN -> ObliIcons.Lock to R.string.fleet_error_forbidden
        FleetProblem.SERVER -> ObliIcons.Info to R.string.fleet_error_server
    }
    val retry = problem == FleetProblem.OFFLINE || problem == FleetProblem.SERVER
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.surface2)
            .then(if (retry) Modifier.clickable(role = Role.Button, onClick = onRetry) else Modifier)
            .heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(18.dp))
        Text(stringResource(text), style = ObliTypography.body, color = c.text, modifier = Modifier.weight(1f))
        if (retry) Text(stringResource(R.string.fleet_retry), style = ObliTypography.label, color = INFO_BLUE)
    }
}

// --- Global-view filter (§2.3) ---------------------------------------------------

/** Header scope while the global view is filtered: "ACME · filtre" with the 6 dp #FF6868 dot (STYLEKIT tenant-chip-filter). */
@Composable
private fun FilterScope(filter: FleetFilter) {
    val c = ObliTheme.colors
    val single = filter.names.singleOrNull()
    val label = single?.let { stringResource(R.string.fleet_scope_filter_one, it) }
        ?: pluralStringResource(R.plurals.fleet_scope_filter_many, filter.tenantIds.size, filter.tenantIds.size)
    val a11y = single?.let { stringResource(R.string.fleet_scope_filter_a11y_one, it) }
        ?: pluralStringResource(R.plurals.fleet_scope_filter_a11y_many, filter.tenantIds.size, filter.tenantIds.size)
    Row(
        Modifier.widthIn(max = 160.dp).height(32.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2).padding(horizontal = 10.dp)
            .clearAndSetSemantics { contentDescription = a11y },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(ObliIcons.Building2, contentDescription = null, tint = c.text2, modifier = Modifier.size(14.dp))
        Text(label, style = ObliTypography.labelSmall, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Box(Modifier.size(6.dp).clip(RoundedCornerShape(3.dp)).background(c.accent2))
    }
}

/** Under the title of a card the server cannot filter: "Toute la vue globale (filtre non appliqué)". */
@Composable
private fun UnfilteredCaption(modifier: Modifier = Modifier) {
    val c = ObliTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(ObliIcons.Info, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(14.dp))
        Text(stringResource(R.string.fleet_unfiltered), style = ObliTypography.labelSmall, color = c.textMuted)
    }
}

/** "MAJ en attente" of the whole global view while it is filtered (captioned, never mixed with the filtered figures). */
@Composable
private fun UnfilteredUpdates(kpi: Kpi, onOpenDevices: () -> Unit) {
    Column {
        SectionHeader(stringResource(R.string.fleet_updates))
        UnfilteredCaption(Modifier.padding(bottom = 8.dp))
        KpiTile(kpi, onOpenDevices, Modifier.fillMaxWidth())
    }
}

// --- Layout --------------------------------------------------------------------

@Composable
private fun FleetBody(ui: FleetUi, data: FleetData, time: FleetTime, onOpenDevices: () -> Unit, onRefresh: () -> Unit) {
    val featured = remember(data) { FleetMapper.featured(data.summary) }
    val kpis = remember(data) { FleetMapper.kpis(data) }
    val attention = remember(data, time.now) { FleetMapper.attention(data.attention, time.now) }
    val groups = remember(data) { data.groups?.let { FleetMapper.groups(it) }.orEmpty() }
    val hours = remember(data) { data.hourly?.let(FleetMapper::hours).orEmpty() }
    val unfilteredUpdates = remember(data) { FleetMapper.unfilteredUpdates(data) }
    // Global view filtered: the cards below cover every tenant (the server cannot filter them).
    val filtered = data.filter != null
    val banner: @Composable () -> Unit = { ui.problem?.let { ProblemBanner(it, onRefresh) } }
    val featuredCard: @Composable () -> Unit = { FeaturedCard(featured, data.serverAggregates, onOpenDevices) }
    val kpiGrid: @Composable () -> Unit = { KpiGrid(kpis, onOpenDevices) }
    val attentionSection: @Composable () -> Unit = { AttentionSection(attention, data.showTenants, time, onOpenDevices) }
    val updates: @Composable () -> Unit = { unfilteredUpdates?.let { UnfilteredUpdates(it, onOpenDevices) } }
    val activity: @Composable () -> Unit = { if (data.serverAggregates && hours.size >= 2) ActivityCard(hours, time, filtered) }
    val disks: @Composable () -> Unit = { if (data.serverAggregates) data.disks?.let { DisksSection(it, onOpenDevices, filtered) } }
    val groupsSection: @Composable () -> Unit = { if (data.serverAggregates && groups.isNotEmpty()) GroupsSection(groups, data.showTenants, onOpenDevices, filtered) }
    // Sessions, schedules and stale devices describe the whole server: not shown while filtered.
    val context: @Composable () -> Unit = { if (data.serverAggregates && !filtered) ContextSection(data, onOpenDevices) }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val scroll = rememberScrollState()
        if (maxWidth >= 840.dp) {
            // Tablet (design doc §5 S70): featured + attention | indicators + groups | activity, disks, context.
            Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                banner()
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) { featuredCard(); attentionSection() }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) { kpiGrid(); updates(); groupsSection() }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) { activity(); disks(); context() }
                }
            }
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                Column(
                    Modifier.widthIn(max = 640.dp).fillMaxWidth().verticalScroll(scroll).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 32.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    banner(); featuredCard(); kpiGrid(); attentionSection(); updates(); activity(); disks(); groupsSection(); context()
                }
            }
        }
    }
}

// --- Building blocks ---------------------------------------------------------------

internal val INFO_BLUE = Color(0xFF60A5FA)
private val CARD_SHAPE = RoundedCornerShape(12.dp)

@Composable
private fun Card(modifier: Modifier = Modifier, padding: Int = 4, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().clip(CARD_SHAPE).background(ObliTheme.colors.surface1).padding(padding.dp), content = content)
}

@Composable
private fun Overline(text: String, modifier: Modifier = Modifier, color: Color = ObliTheme.colors.textMuted) {
    Text(text.uppercase(), style = ObliTypography.overline, color = color, modifier = modifier, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

/** Section title (mono overline) with an optional "Voir tout" link (48 dp target). */
@Composable
private fun SectionHeader(title: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().heightIn(min = 36.dp), verticalAlignment = Alignment.CenterVertically) {
        Overline(title, Modifier.weight(1f).semantics { heading() })
        if (action != null) {
            Row(
                Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onAction).padding(start = 8.dp, end = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(action, style = ObliTypography.label, color = INFO_BLUE)
                Icon(ObliIcons.ChevronRight, contentDescription = null, tint = INFO_BLUE, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun TenantTag(name: String) {
    val c = ObliTheme.colors
    Text(
        name,
        style = ObliTypography.overline.copy(letterSpacing = ObliTypography.overline.letterSpacing * 0.45f),
        color = c.text2,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.hover).padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

@Composable
private fun DeltaLine(delta: Delta?) {
    val c = ObliTheme.colors
    if (delta == null) {
        Text(stringResource(R.string.fleet_no_delta), style = ObliTypography.monoCaption, color = c.textMuted, modifier = Modifier.heightIn(min = 16.dp))
        return
    }
    val color = when (delta.trend) {
        DeltaTrend.BETTER -> ObliTokens.Status.ONLINE.argb.toColor()
        DeltaTrend.WORSE -> ObliTokens.Status.WARNING.argb.toColor()
        DeltaTrend.NEUTRAL -> c.textMuted
    }
    val icon = when {
        delta.value > 0 -> FleetIcons.ArrowUp
        delta.value < 0 -> FleetIcons.ArrowDown
        else -> FleetIcons.Minus
    }
    val text = when {
        delta.value == 0 && delta.period == DeltaPeriod.YESTERDAY -> stringResource(R.string.fleet_delta_same_yesterday)
        delta.value == 0 -> stringResource(R.string.fleet_delta_same_week)
        delta.period == DeltaPeriod.YESTERDAY -> stringResource(R.string.fleet_delta_yesterday, kotlin.math.abs(delta.value))
        else -> stringResource(R.string.fleet_delta_week, kotlin.math.abs(delta.value))
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
        Text(text, style = ObliTypography.monoCaption, color = color, maxLines = 1)
    }
}

@Composable
private fun deltaA11y(delta: Delta?): String? {
    if (delta == null || delta.value == 0) return null
    val n = kotlin.math.abs(delta.value)
    return when {
        delta.period == DeltaPeriod.YESTERDAY && delta.value > 0 -> stringResource(R.string.fleet_delta_up_yesterday_a11y, n)
        delta.period == DeltaPeriod.YESTERDAY -> stringResource(R.string.fleet_delta_down_yesterday_a11y, n)
        delta.value > 0 -> stringResource(R.string.fleet_delta_up_week_a11y, n)
        else -> stringResource(R.string.fleet_delta_down_week_a11y, n)
    }
}

@Composable
private fun ribbonLabel(kind: RibbonKind): String = stringResource(
    when (kind) {
        RibbonKind.CRITICAL -> R.string.fleet_status_critical
        RibbonKind.WARNING -> R.string.fleet_status_warning
        RibbonKind.UPDATING -> R.string.fleet_status_updating
        RibbonKind.ONLINE -> R.string.fleet_status_online
        RibbonKind.OFFLINE -> R.string.fleet_status_offline
        RibbonKind.PENDING -> R.string.fleet_status_pending
    },
)

// --- 1. Featured card ------------------------------------------------------------------

@Composable
private fun FeaturedCard(f: Featured, serverAggregates: Boolean, onOpenDevices: () -> Unit) {
    val c = ObliTheme.colors
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape)
            .background(c.surface1)
            .background(Brush.linearGradient(0f to c.brand.copy(alpha = 0.10f), 0.55f to Color.Transparent))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Overline(stringResource(if (serverAggregates) R.string.fleet_devices else R.string.fleet_your_devices), Modifier.weight(1f))
            if (f.delta != null) DeltaLine(f.delta)
        }
        val line = stringResource(R.string.fleet_offline_count, f.offline).let { off ->
            pluralStringResource(R.plurals.fleet_connected_count, f.connected, f.connected) + " · " + off
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onOpenDevices).heightIn(min = 48.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(f.total.toString(), style = ObliTypography.kpiFeatured, color = c.text)
            Text(line, style = ObliTypography.body, color = c.text2, modifier = Modifier.padding(bottom = 4.dp), maxLines = 2)
        }
        val labels = f.segments.map { ribbonLabel(it.kind) }
        val summary = f.segments.zip(labels).joinToString(", ") { (seg, label) -> "$label ${seg.count}" }
        val ribbonA11y = stringResource(R.string.fleet_ribbon_a11y, summary)
        HealthRibbon(f.segments, Modifier.clearAndSetSemantics { contentDescription = ribbonA11y })
        LegendChips(f.legend, onOpenDevices)
    }
}

/** Segmented bar, problems on the left, 2 dp gaps, 6 dp minimum per non-empty segment (decorative). */
@Composable
private fun HealthRibbon(segments: List<RibbonSegment>, modifier: Modifier = Modifier, height: Int = 10) {
    BoxWithConstraints(modifier.fillMaxWidth().height(height.dp).clip(RoundedCornerShape((height / 2).dp))) {
        val gap = 2.dp
        val available = maxWidth - gap * (segments.size - 1).coerceAtLeast(0)
        val widths = FleetMapper.ribbonWidths(segments.map { it.count }, available.value, 6f)
        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
            segments.forEachIndexed { i, s ->
                Box(Modifier.width(widths[i].dp).height(height.dp).background(s.kind.status.argb.toColor().copy(alpha = s.kind.alpha)))
            }
        }
    }
}

@Composable
private fun LegendChips(legend: List<RibbonSegment>, onOpenDevices: () -> Unit) {
    val c = ObliTheme.colors
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(top = 0.dp),
    ) {
        legend.forEach { s ->
            val label = ribbonLabel(s.kind)
            val a11y = stringResource(R.string.fleet_legend_a11y, label, s.count)
            Box(
                Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onOpenDevices).clearAndSetSemantics { contentDescription = a11y },
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    Modifier.height(32.dp).clip(RoundedCornerShape(8.dp)).background(c.surface2).padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(6.dp).clip(RoundedCornerShape(3.dp)).background(s.kind.status.argb.toColor().copy(alpha = s.kind.alpha.coerceAtLeast(0.8f))))
                    Text(label, style = ObliTypography.labelSmall, color = c.text2)
                    Text(s.count.toString(), style = ObliTypography.monoCaption.copy(fontWeight = FontWeight.Medium), color = c.text)
                }
            }
        }
    }
}

// --- 2. Indicators ------------------------------------------------------------------

@Composable
private fun KpiGrid(kpis: List<Kpi>, onOpenDevices: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        kpis.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.height(IntrinsicSize.Min)) {
                pair.forEach { KpiTile(it, onOpenDevices, Modifier.weight(1f).fillMaxHeight()) }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun kpiLabel(kind: KpiKind): String = stringResource(
    when (kind) {
        KpiKind.ONLINE -> R.string.fleet_kpi_online
        KpiKind.OFFLINE -> R.string.fleet_kpi_offline
        KpiKind.CRITICAL -> R.string.fleet_kpi_critical
        KpiKind.WARNING -> R.string.fleet_kpi_warning
        KpiKind.PENDING_UPDATES -> R.string.fleet_kpi_pending_updates
        KpiKind.AGENTS_UP_TO_DATE -> R.string.fleet_kpi_agents
    },
)

@Composable
private fun KpiTile(k: Kpi, onOpenDevices: () -> Unit, modifier: Modifier) {
    val c = ObliTheme.colors
    val label = kpiLabel(k.kind)
    val valueColor = k.status?.argb?.toColor() ?: c.text
    val extra = k.criticalUpdates?.let { pluralStringResource(R.plurals.fleet_kpi_critical_updates, it, it) }
    val outOf = k.outOf?.let { stringResource(R.string.fleet_kpi_out_of, it) }
    val a11y = listOfNotNull(stringResource(R.string.fleet_kpi_a11y, label, k.value), outOf, extra, deltaA11y(k.delta)).joinToString(", ")
    Column(
        modifier.clip(CARD_SHAPE).background(c.surface1).clickable(role = Role.Button, onClick = onOpenDevices)
            .clearAndSetSemantics { contentDescription = a11y }
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Overline(label)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(k.value.toString(), style = ObliTypography.kpi, color = valueColor, maxLines = 1)
            if (outOf != null) Text(outOf, style = SEMIBOLD_LABEL, color = c.textMuted, modifier = Modifier.padding(bottom = 6.dp))
            if (extra != null) Text(extra, style = ObliTypography.labelSmall, color = c.text2, modifier = Modifier.padding(bottom = 7.dp), maxLines = 2)
        }
        DeltaLine(k.delta)
        Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.06f))) {
            if (k.fraction > 0f) {
                Box(Modifier.fillMaxWidth(k.fraction.coerceAtLeast(0.01f)).height(4.dp).clip(RoundedCornerShape(2.dp)).background(k.status?.argb?.toColor() ?: c.text))
            }
        }
    }
}

// --- 3. Needs attention ----------------------------------------------------------------

@Composable
private fun AttentionSection(rows: List<AttentionRow>, showTenants: Boolean, time: FleetTime, onOpenDevices: () -> Unit) {
    val c = ObliTheme.colors
    Column {
        SectionHeader(stringResource(R.string.fleet_attention), stringResource(R.string.fleet_see_all), onOpenDevices)
        Card {
            if (rows.isEmpty()) {
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(ObliIcons.CircleCheck, contentDescription = null, tint = ObliTokens.Status.ONLINE.argb.toColor(), modifier = Modifier.size(20.dp))
                    Text(stringResource(R.string.fleet_attention_none), style = ObliTypography.body, color = c.text2)
                }
            }
            rows.forEach { AttentionRowView(it, showTenants, time, onOpenDevices) }
        }
    }
}

@Composable
private fun statusLabel(status: String): String = stringResource(
    when (status) {
        "critical" -> R.string.fleet_status_critical
        "warning" -> R.string.fleet_status_warning
        "update_error" -> R.string.fleet_status_update_error
        "offline" -> R.string.fleet_status_offline
        "updating" -> R.string.fleet_status_updating
        "pending" -> R.string.fleet_status_pending
        else -> R.string.fleet_status_online
    },
)

@Composable
private fun reasonText(reason: AttentionReason, time: FleetTime): String = when (reason) {
    is AttentionReason.Metric -> {
        val main = when (reason.kind) {
            MetricKind.CPU -> stringResource(R.string.fleet_reason_cpu, reason.percent)
            MetricKind.RAM -> stringResource(R.string.fleet_reason_ram, reason.percent)
            MetricKind.DISK -> stringResource(R.string.fleet_reason_disk, reason.mount.orEmpty(), reason.percent).replace("  ", " ")
        }
        val free = reason.freeGb?.let { stringResource(R.string.fleet_reason_disk_free, time.decimal(it)) }
        listOfNotNull(main, free).joinToString(" · ")
    }
    is AttentionReason.OfflineSince ->
        if (reason.days >= 1) {
            pluralStringResource(R.plurals.fleet_reason_offline_days, reason.days, reason.days)
        } else {
            stringResource(R.string.fleet_reason_offline_since, time.clock(reason.since))
        }
    is AttentionReason.Identity -> listOfNotNull(reason.os, reason.ip).joinToString(" · ")
}

@Composable
private fun AttentionRowView(row: AttentionRow, showTenants: Boolean, time: FleetTime, onOpenDevices: () -> Unit) {
    val c = ObliTheme.colors
    val d = row.device
    val statusColor = row.status.argb.toColor()
    val critical = d.status == "critical"
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onOpenDevices)
            .padding(start = 12.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(32.dp)) {
            Box(Modifier.size(32.dp).clip(RoundedCornerShape(6.dp)).background(c.hover), contentAlignment = Alignment.Center) {
                Icon(FleetIcons.forOs(d.osType), contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
            }
            Box(
                Modifier.align(Alignment.BottomEnd).offset(3.dp, 3.dp).size(12.dp).clip(RoundedCornerShape(6.dp)).background(c.surface1),
                contentAlignment = Alignment.Center,
            ) { Box(Modifier.size(8.dp).clip(RoundedCornerShape(4.dp)).background(statusColor)) }
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        d.label, style = SEMIBOLD_LABEL, color = c.text,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                    )
                    if (showTenants) d.tenantName?.let { TenantTag(it) }
                }
                ObliStatusPill(row.status, statusLabel(d.status))
            }
            Text(
                reasonText(row.reason, time),
                style = ObliTypography.monoCaption,
                color = if (critical) statusColor else c.text2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// --- 4. Activity 24 h --------------------------------------------------------------------

@Composable
private fun ActivityCard(points: List<HourPoint>, time: FleetTime, unfiltered: Boolean = false) {
    val c = ObliTheme.colors
    val onMin = points.minOf { it.online }
    val onMax = points.maxOf { it.online }
    val offMin = points.minOf { it.offline }
    val offMax = points.maxOf { it.offline }
    val chart = stringResource(R.string.fleet_chart_a11y, onMin, onMax, offMin, offMax)
    val a11y = if (unfiltered) chart + ". " + stringResource(R.string.fleet_unfiltered) else chart
    Card(padding = 16) {
        Column(Modifier.clearAndSetSemantics { contentDescription = a11y }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Overline(stringResource(R.string.fleet_activity))
            Text(stringResource(R.string.fleet_activity_title), style = ObliTypography.cardTitle, color = c.text)
            if (unfiltered) UnfilteredCaption()
            Spacer(Modifier.height(2.dp))
            SeriesLabel(stringResource(R.string.fleet_chart_connected), points.last().online, CHART_GREEN, dashed = false)
            FleetSparkline(points.map { it.online }, CHART_GREEN, dashed = false, height = 56)
            SeriesLabel(stringResource(R.string.fleet_chart_offline), points.last().offline, c.textMuted, dashed = true)
            FleetSparkline(points.map { it.offline }, c.textMuted, dashed = true, height = 36)
            Row(Modifier.fillMaxWidth()) {
                val mid = points[points.size / 2]
                Text(time.clock(points.first().at), style = AXIS, color = c.textMuted)
                Spacer(Modifier.weight(1f))
                Text(time.clock(mid.at), style = AXIS, color = c.textMuted)
                Spacer(Modifier.weight(1f))
                Text(time.clock(points.last().at), style = AXIS, color = c.textMuted)
            }
        }
    }
}

internal val CHART_GREEN = Color(0xFF1EDD8A)
private val AXIS get() = ObliTypography.monoCaption.copy(fontSize = 11.sp, lineHeight = 14.sp)
private val SEMIBOLD_LABEL get() = ObliTypography.label.copy(fontWeight = FontWeight.SemiBold)

@Composable
private fun SeriesLabel(label: String, value: Int, color: Color, dashed: Boolean) {
    val c = ObliTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        androidx.compose.foundation.Canvas(Modifier.width(16.dp).height(8.dp)) {
            drawLine(
                color, start = androidx.compose.ui.geometry.Offset(0f, size.height / 2), end = androidx.compose.ui.geometry.Offset(size.width, size.height / 2),
                strokeWidth = 2.dp.toPx(),
                pathEffect = if (dashed) androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())) else null,
            )
        }
        Text(label, style = ObliTypography.labelSmall, color = c.text2, modifier = Modifier.weight(1f))
        Text(value.toString(), style = ObliTypography.monoCaption.copy(fontWeight = FontWeight.Medium), color = c.text)
    }
}

// --- 5. Full disks -------------------------------------------------------------------

@Composable
private fun DisksSection(disks: DiskSaturation, onOpenDevices: () -> Unit, unfiltered: Boolean = false) {
    val c = ObliTheme.colors
    Column {
        SectionHeader(stringResource(R.string.fleet_disks, disks.count))
        if (unfiltered) UnfilteredCaption(Modifier.padding(bottom = 8.dp))
        Card {
            if (disks.top.isEmpty()) {
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(ObliIcons.CircleCheck, contentDescription = null, tint = ObliTokens.Status.ONLINE.argb.toColor(), modifier = Modifier.size(20.dp))
                    Text(stringResource(R.string.fleet_disks_none), style = ObliTypography.body, color = c.text2)
                }
            }
            disks.top.forEach { disk -> DiskRow(disk, onOpenDevices) }
        }
    }
}

@Composable
private fun DiskRow(disk: SaturatedDisk, onOpenDevices: () -> Unit) {
    val c = ObliTheme.colors
    val amber = ObliTokens.Status.WARNING.argb.toColor()
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onOpenDevices)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(32.dp).clip(RoundedCornerShape(6.dp)).background(c.hover), contentAlignment = Alignment.Center) {
            Icon(FleetIcons.HardDrive, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(disk.label, style = SEMIBOLD_LABEL, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    Text(disk.mountpoint, style = ObliTypography.monoCaption, color = c.text2, maxLines = 1)
                }
                Icon(ObliIcons.TriangleAlert, contentDescription = null, tint = amber, modifier = Modifier.size(14.dp))
                Text(stringResource(R.string.fleet_disk_pct, disk.pct), style = SEMIBOLD_LABEL, color = amber)
            }
            Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(Color.White.copy(alpha = 0.06f))) {
                Box(Modifier.fillMaxWidth((disk.pct / 100f).coerceIn(0.01f, 1f)).height(6.dp).clip(RoundedCornerShape(3.dp)).background(amber))
            }
            disk.warn?.let { Text(stringResource(R.string.fleet_disk_threshold, it), style = ObliTypography.monoCaption, color = c.textMuted) }
        }
    }
}

// --- 6. Groups -------------------------------------------------------------------------

@Composable
private fun GroupsSection(groups: List<GroupRow>, showTenants: Boolean, onOpenDevices: () -> Unit, unfiltered: Boolean = false) {
    Column {
        SectionHeader(stringResource(R.string.fleet_groups))
        if (unfiltered) UnfilteredCaption(Modifier.padding(bottom = 8.dp))
        Card { groups.forEach { GroupRowView(it, showTenants, onOpenDevices) } }
    }
}

@Composable
private fun GroupRowView(g: GroupRow, showTenants: Boolean, onOpenDevices: () -> Unit) {
    val c = ObliTheme.colors
    val details = buildList {
        add(pluralStringResource(R.plurals.fleet_group_devices, g.total, g.total))
        if (g.critical > 0) add(stringResource(R.string.fleet_group_critical, g.critical))
        if (g.warning > 0) add(stringResource(R.string.fleet_group_warning, g.warning))
        if (g.offline > 0) add(stringResource(R.string.fleet_group_offline, g.offline))
        g.complianceScore?.let { add(stringResource(R.string.fleet_group_compliance, Math.round(it).toInt())) }
    }.joinToString(" · ")
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onOpenDevices).padding(start = 14.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(FleetIcons.FolderTree, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
                Text(g.path.joinToString(" › "), style = SEMIBOLD_LABEL, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (showTenants) g.tenantName?.let { TenantTag(it) }
            }
            Text(stringResource(R.string.fleet_group_online, g.connected, g.total), style = SEMIBOLD_LABEL, color = c.text, maxLines = 1)
        }
        val segments = listOf(
            RibbonSegment(RibbonKind.CRITICAL, g.critical),
            RibbonSegment(RibbonKind.WARNING, g.warning),
            RibbonSegment(RibbonKind.ONLINE, g.online),
            RibbonSegment(RibbonKind.OFFLINE, g.offline),
        ).filter { it.count > 0 }
        if (segments.isNotEmpty()) HealthRibbon(segments, Modifier.clearAndSetSemantics { }, height = 6)
        Text(details, style = ObliTypography.monoCaption, color = c.textMuted, maxLines = 2)
    }
}

// --- 7. Context ------------------------------------------------------------------------

@Composable
private fun ContextSection(data: FleetData, onOpenDevices: () -> Unit) {
    val s = data.summary
    Column {
        SectionHeader(stringResource(R.string.fleet_context))
        Card {
            ContextRow(FleetIcons.ScreenShare, pluralStringResource(R.plurals.fleet_ctx_sessions, s.activeRemoteSessions, s.activeRemoteSessions), null)
            ContextRow(FleetIcons.CalendarClock, pluralStringResource(R.plurals.fleet_ctx_schedules, s.upcomingSchedules, s.upcomingSchedules), null)
            ContextRow(FleetIcons.WifiOff, pluralStringResource(R.plurals.fleet_ctx_stale, s.staleDevices, s.staleDevices), onOpenDevices.takeIf { s.staleDevices > 0 })
        }
    }
}

@Composable
private fun ContextRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, onClick: (() -> Unit)?) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(8.dp))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(start = 14.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(32.dp).clip(RoundedCornerShape(6.dp)).background(c.hover), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = c.text2, modifier = Modifier.size(16.dp))
        }
        Text(text, style = ObliTypography.label, color = c.text, modifier = Modifier.weight(1f))
        if (onClick != null) Icon(ObliIcons.ChevronRight, contentDescription = null, tint = c.textMuted, modifier = Modifier.size(18.dp))
    }
}
