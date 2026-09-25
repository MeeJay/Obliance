package tools.obli.obliance.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Badge
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.TextButton
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import androidx.window.core.layout.WindowSizeClass
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import tools.obli.core.auth.AuthState
import tools.obli.core.designsystem.ObliCalmState
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliScreenHeader
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.toColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.core.network.ApiOutcome
import tools.obli.obliance.access.AddServerScreen
import tools.obli.obliance.access.ReauthSheet
import tools.obli.obliance.access.ScopeSheet
import tools.obli.obliance.access.ServersScreen
import tools.obli.obliance.access.SignInScreen
import tools.obli.obliance.data.LocalObliNavigator
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliNavigator
import tools.obli.obliance.data.ObliServices
import tools.obli.core.security.ui.ObliActionHost
import tools.obli.core.webfallback.LocalWebPageOpener
import tools.obli.core.webfallback.ObliWebView
import tools.obli.core.webfallback.WebPageOpener
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableIntStateOf
import tools.obli.obliance.devices.DeviceDetailScreen
import tools.obli.obliance.devices.DeviceListScreen
import tools.obli.obliance.fleet.FleetScreen
import tools.obli.obliance.more.MoreScreen
import tools.obli.obliance.triage.TriageScreen

/** Root of the app: nothing until the registry is loaded, S01 without a server, else the shell. */
@Composable
fun ObliNextApp(ready: Boolean) {
    val services = LocalObliServices.current
    val registry by services.registry.state.collectAsStateWithLifecycle()
    /** Bumped when an action met an expired session: S03 shows again even if it was dismissed. */
    var reauthRequests by remember { mutableIntStateOf(0) }
    // The action host (S41–S44, biometric, result snackbars) sits over everything (design doc §10.4).
    ObliActionHost(onSessionExpired = { reauthRequests++ }) {
        Box(Modifier.fillMaxSize().background(ObliTheme.colors.bg)) {
            when {
                !ready -> Unit
                registry.profiles.isEmpty() -> SignInScreen(onSignedIn = {})
                else -> Shell(reauthRequests)
            }
        }
    }
}

/**
 * The shell of design doc §2: NavigationSuiteScaffold (bottom bar on phones,
 * rail from medium width), one Navigation 3 back stack per destination, the
 * list-detail scene for devices on wide windows, the scope chip, the implicit
 * server switch with "Revenir" (§2.10) and the session-expired sheet (S03).
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
internal fun Shell(reauthRequests: Int = 0) {
    val services = LocalObliServices.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    /** Server the "Passé sur …" snackbar names: its tile leads the message (mockup Main.dc.html). */
    var snackServer by remember { mutableStateOf<ServerProfile?>(null) }
    val c = ObliTheme.colors

    var current by rememberSaveable { mutableStateOf(Destination.TRIAGE) }
    val stacks: Map<Destination, NavBackStack<NavKey>> = Destination.entries.associateWith { rememberNavBackStack(it.root) }
    val stack = stacks.getValue(current)
    var scopeSheet by rememberSaveable { mutableStateOf(false) }

    val adaptive = currentWindowAdaptiveInfoV2()
    val compact = !adaptive.windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND)
    val top = stack.lastOrNull()
    val pushed = stack.size > 1
    // Phones hide the bar on pushed screens (§2.4); wide windows keep it (list | detail).
    val showNav = !(compact && pushed)
    val showTopBar = !pushed || (!compact && top is DeviceKey)
    val layoutType = if (showNav) NavigationSuiteScaffoldDefaults.calculateFromAdaptiveInfo(adaptive) else NavigationSuiteType.None

    fun select(destination: Destination) {
        if (destination == current) {
            // Re-selecting a destination returns to its root.
            val s = stacks.getValue(destination)
            while (s.size > 1) s.removeAt(s.lastIndex)
        }
        current = destination
    }

    fun pop() {
        if (stack.size > 1) {
            val closed = stack.removeAt(stack.lastIndex)
            if (closed is WebKey) scope.launch { afterWebView(services, ServerId(closed.serverId)) }
        }
    }

    fun openDevice(from: Destination, serverId: ServerId, deviceId: Long) {
        scope.launch {
            val previous = services.openOn(serverId)
            val target = stacks.getValue(from)
            target.removeAll { it is DeviceKey }
            target.add(DeviceKey(serverId.value, deviceId))
            if (previous == null) return@launch
            // Implicit switch (§2.10): say it, and offer "Revenir" for 5 s.
            val serverName = services.registry.state.value.byId(serverId)?.displayName.orEmpty()
            val deviceName = withTimeoutOrNull(3_000) { (services.devices.detail(serverId, deviceId) as? ApiOutcome.Ok)?.value?.label }
                ?: resources.getString(R.string.app_device_fallback, deviceId)
            snackServer = services.registry.state.value.byId(serverId)?.takeIf { services.registry.state.value.isMultiServer }
            val result = withTimeoutOrNull(5_000) {
                snackbar.showSnackbar(
                    message = resources.getString(R.string.app_switched_to, serverName, deviceName),
                    actionLabel = resources.getString(R.string.app_switch_back),
                    duration = SnackbarDuration.Indefinite,
                )
            }
            if (result == SnackbarResult.ActionPerformed) {
                services.openOn(previous)
                target.removeAll { it is DeviceKey && it.serverId == serverId.value }
            }
        }
    }

    val navigator = remember(stacks) {
        object : ObliNavigator {
            override fun openWeb(path: String, title: String) {
                val active = services.registry.state.value.activeId ?: return
                val target = stacks.getValue(current)
                target.removeAll { it is WebKey }
                target.add(WebKey(active.value, path, title))
            }

            override fun openDevice(serverId: ServerId, deviceId: Long) {
                openDevice(if (current == Destination.TRIAGE) Destination.TRIAGE else Destination.DEVICES, serverId, deviceId)
                current = if (current == Destination.TRIAGE) Destination.TRIAGE else Destination.DEVICES
            }
        }
    }
    val webOpener = remember(navigator) { WebPageOpener(navigator::openWeb) }

    // Back on the root of another destination goes to "À traiter" first.
    BackHandler(enabled = !pushed && current != Destination.TRIAGE) { current = Destination.TRIAGE }

    val registryState by services.registry.state.collectAsStateWithLifecycle()
    val alerts by services.alerts.snapshot.collectAsStateWithLifecycle()
    val badge = alerts.badgeCount
    val barColors = NavigationBarItemDefaults.colors(
        selectedIconColor = c.accent2,
        selectedTextColor = c.accent2,
        indicatorColor = c.accent2.copy(alpha = 0.12f),
        unselectedIconColor = c.textMuted,
        unselectedTextColor = c.textMuted,
    )
    val railColors = NavigationRailItemDefaults.colors(
        selectedIconColor = c.accent2,
        selectedTextColor = c.accent2,
        indicatorColor = c.accent2.copy(alpha = 0.12f),
        unselectedIconColor = c.textMuted,
        unselectedTextColor = c.textMuted,
    )

    // navigationSuiteItems is not composable: resolve texts and colours here.
    val labels = Destination.entries.associateWith { stringResource(it.label) }
    val triageA11y = stringResource(R.string.app_nav_triage_badge, badge)
    val itemColors = NavigationSuiteDefaults.itemColors(navigationBarItemColors = barColors, navigationRailItemColors = railColors)

    CompositionLocalProvider(LocalObliNavigator provides navigator, LocalWebPageOpener provides webOpener) {
    NavigationSuiteScaffold(
        layoutType = layoutType,
        navigationSuiteColors = NavigationSuiteDefaults.colors(
            navigationBarContainerColor = c.chrome,
            navigationRailContainerColor = c.chrome,
            navigationDrawerContainerColor = c.chrome,
        ),
        containerColor = c.bg,
        navigationSuiteItems = {
            Destination.entries.forEach { d ->
                val label = labels.getValue(d)
                val a11y = if (d == Destination.TRIAGE && badge > 0) triageA11y else label
                item(
                    selected = d == current,
                    onClick = { select(d) },
                    icon = {
                        if (d == Destination.TRIAGE && badge > 0) {
                            BadgedBox(badge = { Badge(containerColor = ObliTokens.DANGER.toColor(), contentColor = c.onAccentFill) { Text(badge.coerceAtMost(99).toString()) } }) {
                                Icon(d.icon, contentDescription = null)
                            }
                        } else {
                            Icon(d.icon, contentDescription = null)
                        }
                    },
                    label = { Text(label) },
                    modifier = Modifier.semantics { contentDescription = a11y },
                    colors = itemColors,
                )
            }
        },
    ) {
        val listDetail = rememberListDetailSceneStrategy<NavKey>()
        Box(Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize()
                    .background(c.chrome)
                    .statusBarsPadding()
                    .let { if (layoutType == NavigationSuiteType.NavigationBar) it else it.windowInsetsPadding(WindowInsets.navigationBars) }
                    .background(c.bg),
            ) {
                if (showTopBar) AppTopBar(onScope = { scopeSheet = true }, onAccount = { select(Destination.MORE) })
                NavDisplay(
                    backStack = stack,
                    onBack = ::pop,
                    entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
                    sceneStrategies = listOf(listDetail),
                    entryProvider = entryProvider {
                        entry<TriageKey>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { DetailPlaceholder() })) {
                            TriageScreen(onOpenDevice = { serverId, id -> openDevice(Destination.TRIAGE, serverId, id) })
                        }
                        entry<DevicesKey>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { DetailPlaceholder() })) {
                            DeviceListScreen(onOpenDevice = { serverId, id -> openDevice(Destination.DEVICES, serverId, id) })
                        }
                        entry<ActivityKey> { ActivityPlaceholder() }
                        entry<FleetKey> { FleetScreen(onOpenDevices = { select(Destination.DEVICES) }) }
                        entry<MoreKey> {
                            MoreScreen(onOpenServers = { stacks.getValue(Destination.MORE).add(ServersKey) }, onOpenScope = { scopeSheet = true })
                        }
                        entry<DeviceKey>(metadata = ListDetailSceneStrategy.detailPane()) { key ->
                            DeviceDetailScreen(ServerId(key.serverId), key.deviceId, onBack = ::pop)
                        }
                        entry<WebKey>(metadata = ListDetailSceneStrategy.detailPane()) { key ->
                            val origin = registryState.byId(ServerId(key.serverId))?.origin
                            if (origin == null) {
                                DetailPlaceholder()
                            } else {
                                ObliWebView(
                                    origin = origin,
                                    path = key.path,
                                    title = key.title,
                                    onClose = ::pop,
                                    onInAppPath = { path -> webPathToNative(path)?.let { native ->
                                        pop()
                                        when (native) {
                                            is NativeTarget.Device -> navigator.openDevice(ServerId(key.serverId), native.id)
                                            NativeTarget.Fleet -> select(Destination.FLEET)
                                        }
                                        true
                                    } ?: false },
                                )
                            }
                        }
                        entry<ServersKey> {
                            ServersScreen(onAddServer = { stacks.getValue(Destination.MORE).add(AddServerKey) }, onBack = ::pop)
                        }
                        entry<AddServerKey> {
                            AddServerScreen(
                                onDone = { stacks.getValue(Destination.MORE).removeAll { it == AddServerKey } },
                                onBack = ::pop,
                            )
                        }
                    },
                )
            }
            // STYLEKIT snackbar: above the nav bar, or 80 dp up over a pushed screen's
            // 64 dp action bar (device detail, on phones and in the tablet detail pane).
            val snackBottom = if (top is DeviceKey) 80.dp else 16.dp
            SnackbarHost(
                snackbar,
                Modifier.align(Alignment.BottomCenter)
                    .let { if (layoutType == NavigationSuiteType.NavigationBar) it else it.windowInsetsPadding(WindowInsets.navigationBars) }
                    .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = snackBottom),
            ) { data ->
                val tile = snackServer
                Snackbar(
                    action = data.visuals.actionLabel?.let { label ->
                        {
                            TextButton(onClick = { data.performAction() }, colors = ButtonDefaults.textButtonColors(contentColor = c.accent2)) { Text(label) }
                        }
                    },
                    containerColor = c.active,
                    contentColor = c.text,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (tile != null) ObliServerTile(tile.color, tile.monogram, tile.displayName, size = 24.dp)
                        Text(data.visuals.message)
                    }
                }
            }
        }
    }

    }

    if (scopeSheet) {
        ScopeSheet(
            onDismiss = { scopeSheet = false },
            onManageServers = {
                scopeSheet = false
                val more = stacks.getValue(Destination.MORE)
                if (more.lastOrNull() != ServersKey) more.add(ServersKey)
                current = Destination.MORE
            },
        )
    }

    SessionExpiredSheet(reauthRequests)
}

/** Same-origin web paths the app shows natively (design doc §2.8): `/devices/:id` → S30, `/` → Flotte. */
internal sealed interface NativeTarget {
    data class Device(val id: Long) : NativeTarget
    data object Fleet : NativeTarget
}

internal fun webPathToNative(path: String): NativeTarget? {
    val clean = path.substringBefore('#').substringBefore('?')
    Regex("^/devices/(\\d+)/?$").find(clean)?.let { m -> return m.groupValues[1].toLongOrNull()?.let(NativeTarget::Device) }
    return if (clean == "/") NativeTarget.Fleet else null
}

/**
 * After the web view closes (§2.8): re-probe `/api/auth/me` of its server; if
 * the page switched the session tenant, the tenants scope follows the probe
 * (screens reload) and the socket of the active server reconnects.
 */
private suspend fun afterWebView(services: ObliServices, serverId: ServerId) {
    val session = services.sessions.session(serverId) ?: return
    val before = (session.auth.value as? AuthState.SignedIn)?.probe?.currentTenantId
    val after = (session.probe() as? AuthState.SignedIn)?.probe?.currentTenantId
    if (before != after && services.registry.state.value.activeId == serverId) session.realtime.reconnect()
}

/** S03 over the current screen when the ACTIVE server's session expired or was signed out (§2.10 item 5). */
@Composable
private fun SessionExpiredSheet(reauthRequests: Int) {
    val services = LocalObliServices.current
    val active by services.sessions.active.collectAsStateWithLifecycle()
    val session = active ?: return
    val auth by session.auth.collectAsStateWithLifecycle()
    var dismissedFor by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(auth) { if (auth is AuthState.SignedIn) dismissedFor = null }
    // An action met an expired session: show S03 again even if it was dismissed.
    LaunchedEffect(reauthRequests) { if (reauthRequests > 0) dismissedFor = null }
    val lost = auth == AuthState.Expired || auth == AuthState.SignedOut
    if (lost && dismissedFor != session.id.value) {
        ReauthSheet(session.id, onDone = { dismissedFor = session.id.value })
    }
}

@Composable
private fun DetailPlaceholder() {
    ObliCalmState(stringResource(R.string.app_select_device), icon = ObliIcons.Monitor, modifier = Modifier.background(ObliTheme.colors.bg))
}

/** Activité (S55) is not in the alpha: a calm placeholder. */
@Composable
internal fun ActivityPlaceholder() {
    Column(Modifier.fillMaxSize().background(ObliTheme.colors.bg)) {
        ObliScreenHeader(stringResource(R.string.app_activity_title))
        ObliCalmState(
            stringResource(R.string.app_activity_soon),
            body = stringResource(R.string.app_activity_soon_body),
            icon = ObliIcons.Activity,
        )
    }
}
