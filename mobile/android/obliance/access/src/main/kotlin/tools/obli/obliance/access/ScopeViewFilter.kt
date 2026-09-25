package tools.obli.obliance.access

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.api.DeviceQuery
import tools.obli.obliance.api.Tenant
import tools.obli.obliance.data.DevicesRepository
import tools.obli.obliance.data.ObliServices

/*
 * S81 section "Filtrer la vue globale" (design doc §0.2, §2.3, §5 S81): on the
 * master tenant, narrows the LISTS of the active server to some tenants
 * (`tenantIds=`) without switching the session tenant nor the socket. Multi-
 * select chips (STYLEKIT chip-filter / chip-filter-selected, never red), each
 * tenant with its mini-ribbon "ACME 248 · 1 crit.". The choice is stored per
 * server by TenantsRepository.setViewFilter.
 */

/** Approved devices of one tenant, and how many are critical (S81 mini-ribbon). */
internal data class TenantCount(val total: Int, val critical: Int)

/** Pure rule of a tap on the filter chips (unit-tested). */
internal object ViewFilterChoice {
    /**
     * The filter after a tap on [tenantId] (null = "Tous les tenants", which
     * clears it). A tenant chip toggles; selecting every tenant of [all] is
     * normalised to "no filter".
     */
    fun next(current: Set<Long>, all: List<Long>, tenantId: Long?): Set<Long> {
        if (tenantId == null) return emptySet()
        val next = if (tenantId in current) current - tenantId else current + tenantId
        return if (all.isNotEmpty() && next.containsAll(all)) emptySet() else next
    }
}

/**
 * Device counts of the filter chips: two `pageSize=1` requests per tenant on
 * the ACTIVE server (`tenantIds=<id>&approvalStatus=approved`, then with
 * `status=critical`), for the first [MAX_TENANTS] tenants. A failure only hides
 * that tenant's counts.
 */
internal class TenantCountsLoader(private val devices: DevicesRepository) {
    suspend fun load(serverId: ServerId, tenantIds: List<Long>): Map<Long, TenantCount> = coroutineScope {
        tenantIds.distinct().take(MAX_TENANTS)
            .map { id -> async { id to count(serverId, id) } }
            .awaitAll()
            .mapNotNull { (id, count) -> count?.let { id to it } }
            .toMap()
    }

    private suspend fun count(serverId: ServerId, tenantId: Long): TenantCount? {
        val query = DeviceQuery(tenantIds = listOf(tenantId), pageSize = 1, approvalStatus = "approved")
        val total = (devices.page(query, serverId) as? ApiOutcome.Ok)?.value?.total ?: return null
        val critical = (devices.page(query.copy(status = "critical"), serverId) as? ApiOutcome.Ok)?.value?.total ?: return null
        return TenantCount(total, critical)
    }

    companion object {
        const val MAX_TENANTS = 12
    }
}

/** Counts of the tenants of [ui], loaded when the section shows (the sheet opens) and again if the list changes. */
@Composable
internal fun rememberTenantCounts(services: ObliServices, ui: ScopeUi): Map<Long, TenantCount> {
    val loader = remember(services) { TenantCountsLoader(services.devices) }
    var counts by remember { mutableStateOf<Map<Long, TenantCount>>(emptyMap()) }
    val ids = ui.tenants.map { it.tenant.id }
    LaunchedEffect(loader, ui.showViewFilter, ui.activeId, ids) {
        counts = emptyMap()
        val serverId = ui.activeId
        if (ui.showViewFilter && serverId != null) counts = loader.load(serverId, ids)
    }
    return counts
}

/** "filtre ACME", "filtre 2 tenants"; null without a filter. */
@Composable
internal fun viewFilterLabel(names: List<String>): String? = when (names.size) {
    0 -> null
    1 -> stringResource(R.string.access_scope_filter_one, names.single())
    else -> pluralStringResource(R.plurals.access_scope_filter_many, names.size, names.size)
}

@Composable
internal fun ViewFilterSection(ui: ScopeUi, counts: Map<Long, TenantCount>, enabled: Boolean, onViewFilter: (Long?) -> Unit) {
    val c = ObliTheme.colors
    Text(
        stringResource(R.string.access_scope_filter_title),
        style = ObliTypography.labelSmall,
        color = c.text2,
        modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 2.dp, bottom = 2.dp),
    )
    val group = stringResource(R.string.access_scope_filter_group)
    FlowRow(
        Modifier.fillMaxWidth().padding(bottom = 6.dp).semantics { contentDescription = group },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val all = ui.viewFilter.isEmpty()
        FilterChipFrame(all, enabled, { onViewFilter(null) }, Modifier.testTag(TAG_ALL)) {
            if (all) Icon(ObliIcons.Check, contentDescription = null, tint = c.text, modifier = Modifier.size(16.dp))
            Text(
                stringResource(R.string.access_scope_filter_all),
                style = ObliTypography.label.copy(fontWeight = if (all) FontWeight.SemiBold else FontWeight.Medium),
                color = if (all) c.text else c.text2,
                maxLines = 1,
            )
        }
        ui.tenants.forEach { row ->
            val t = row.tenant
            TenantFilterChip(t, t.id in ui.viewFilter, counts[t.id], enabled) { onViewFilter(t.id) }
        }
    }
}

@Composable
private fun TenantFilterChip(tenant: Tenant, selected: Boolean, count: TenantCount?, enabled: Boolean, onClick: () -> Unit) {
    val c = ObliTheme.colors
    val a11y = buildString {
        append(tenant.name)
        if (count != null) {
            append(", ").append(pluralStringResource(R.plurals.access_scope_filter_devices, count.total, count.total))
            if (count.critical > 0) append(" ").append(pluralStringResource(R.plurals.access_scope_filter_critical, count.critical, count.critical))
        }
    }
    FilterChipFrame(selected, enabled, onClick, Modifier.testTag(tagOf(tenant.id)).semantics { contentDescription = a11y }) {
        if (selected) Icon(ObliIcons.Check, contentDescription = null, tint = c.text, modifier = Modifier.size(16.dp))
        Column(Modifier.width(IntrinsicSize.Max).clearAndSetSemantics { }, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    tenant.name,
                    style = ObliTypography.label.copy(fontSize = 14.sp, lineHeight = 18.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium),
                    color = if (selected) c.text else c.text2,
                    maxLines = 1,
                )
                if (count != null) {
                    val figures = if (count.critical > 0) {
                        pluralStringResource(R.plurals.access_scope_filter_count_critical, count.critical, count.total, count.critical)
                    } else {
                        count.total.toString()
                    }
                    Text(figures, style = ObliTypography.monoCaption.copy(fontWeight = FontWeight.Medium), color = c.textMuted, maxLines = 1)
                }
            }
            if (count != null && count.total > 0) MiniRibbon(count)
        }
    }
}

/**
 * 3 dp decorative bar under the tenant name: the critical share (status red,
 * at least a sliver) then the rest in a neutral tone. The text carries the
 * meaning ("1 crit."), the bar only reinforces it.
 */
@Composable
private fun MiniRibbon(count: TenantCount) {
    val c = ObliTheme.colors
    val rest = (count.total - count.critical).coerceAtLeast(0)
    Row(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
        if (count.critical > 0) {
            val weight = maxOf(count.critical.toFloat(), count.total * MIN_CRITICAL_SHARE)
            Box(Modifier.weight(weight).height(3.dp).background(ObliTokens.Status.CRITICAL.argb.toColor()))
        }
        if (rest > 0) Box(Modifier.weight(rest.toFloat()).height(3.dp).background(c.textFaint))
    }
}

/** A single critical device among 248 stays visible. */
private const val MIN_CRITICAL_SHARE = 0.05f

/** chip-filter (surface2, text2, 500) / chip-filter-selected (active, text, 600, check): 36 dp in a 48 dp target. */
@Composable
private fun FilterChipFrame(selected: Boolean, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    val c = ObliTheme.colors
    Box(
        modifier.heightIn(min = 48.dp).toggleable(value = selected, enabled = enabled, role = Role.Checkbox, onValueChange = { onClick() }),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).background(if (selected) c.active else c.surface2).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            content = content,
        )
    }
}

internal const val TAG_ALL = "access_view_filter_all"

internal fun tagOf(tenantId: Long) = "access_view_filter_$tenantId"
