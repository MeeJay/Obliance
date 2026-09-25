# Native Obliance alpha — contract for the screen modules

This is the contract between the **foundation** (shared plumbing and the
application) and the agents that build the screens. It is binding: if something
you need is not here, implement it privately inside your module (see §7) and
report it; do not edit shared files.

Spec: `docs/obliance-mobile-design.md` (§2 navigation, §4 reference data, §5
screens, §7 interaction, §8 visual language, §10 architecture). Mockups:
`docs/mobile/mockup/*.dc.html` + `STYLEKIT.md`.

## 1. Modules and who owns what

| Module | Kind | Owner | Contents |
|---|---|---|---|
| `:core:*` | platform | foundation | models, HTTP (`ObliHttp`), auth (`ServerRegistry`, `ServerSessions`), realtime, security (`ActionRunner`), design system |
| `:core:security-ui` | platform | foundation | `ObliActionHost` (S41–S44 sheets, biometric, tenant switch), `LocalActionRunner`, `LocalActionFeedback`, `ActionMessages` (§12) |
| `:core:webfallback` | platform | foundation | S90 `ObliWebView`, `WebUrlPolicy`, `LocalWebPageOpener` (§13) |
| `:obliance:api` | JVM | foundation | typed server calls + tolerant DTOs (`AuthApi`, `TenantsApi`, `AlertsApi`, `ApprovalsApi`, `DevicesApi`, `ObliEvents`, `ApiJson`) |
| `:obliance:domain` | JVM | foundation | alert classification, multi-server triage aggregation, site outages |
| `:obliance:data` | Android lib | foundation | `ObliServices`, `LocalObliServices`, repositories, `SampleObliServices` |
| `:obliance:access` | screens | access agent | S01 sign-in, S02 SSO, S03 re-auth, S81 scope sheet, S92 servers, S93 add server |
| `:obliance:triage` | screens | triage agent | S10 À traiter (Alertes, Approbations, Enrôlements), S11 approval detail, S12 enrolment review, `TriageRequest` |
| `:obliance:devices` | screens | devices agent | S20 device list, S21 filters, S30/S31 device detail |
| `:obliance:fleet` | screens | fleet agent | S70 Flotte |
| `:obliance:more` | screens | more agent | S80 Plus, S83 app settings, S86 about and updates, S00 lock (`AppLock`, `AppLockGate`), `SecureWindow`, `AppSettings`, theme resolution, in-app updates (`AppUpdates`) |
| `:obliance:remote` | screens | remote agent | S60 terminal, S61 session choice, S62 ObliReach viewer, sessions pill / Activité section, `RemoteSessionService` |
| `:obliance:automations` | screens | automations agent | S50 script picker, S51 run, S52/S53 batch, S55 Activité, S57 schedules, S58 scenarios |
| `:obliance:notifications` | screens + engine | notifications agent | background notifications of EVERY server (WorkManager pass every 15 min, one channel group per server, on-call rules), T0/T1 notification actions, `NotificationRoute`, S04 permission gate, S84, the « Astreinte » Quick Settings tile |
| `:obliance:app` | application | foundation | shell, navigation, top bar, `AppGraph`, notification routing (`planRoute`), release signing |

**A screen agent may only create or modify files under its own
`obliance/<module>/` directory** (sources, resources, tests, and its own
`build.gradle.kts` for dependencies that already exist in
`gradle/libs.versions.toml`). It never edits `settings.gradle.kts`, the root
`build.gradle.kts`, the version catalog, `core/*`, `obliance/api`,
`obliance/domain`, `obliance/data`, `obliance/app` or another screen module.
Need a new library? Ask the lead. Found a bug in shared code? Report it with a
failing case; work around it inside your module meanwhile.

Module graph (checked at configuration time by the root `build.gradle.kts`): a
screen module depends on `:core:*` and `:obliance:api|domain|data` only, never
on another screen module, `:obliance:app` or `:app`. Only `:obliance:app`
depends on the screen modules.

## 2. Entry points (FINAL signatures — do not change them)

```kotlin
// :obliance:access  (package tools.obli.obliance.access)
@Composable fun SignInScreen(onSignedIn: () -> Unit, modifier: Modifier = Modifier)
@Composable fun AddServerScreen(onDone: () -> Unit, onBack: () -> Unit)
@Composable fun ServersScreen(onAddServer: () -> Unit, onBack: () -> Unit)
@Composable fun ScopeSheet(onDismiss: () -> Unit, onManageServers: () -> Unit)
@Composable fun ReauthSheet(serverId: ServerId, onDone: () -> Unit)

// :obliance:triage  (package tools.obli.obliance.triage)
@Composable fun TriageScreen(onOpenDevice: (ServerId, Long) -> Unit, request: TriageRequest? = null, onRequestHandled: () -> Unit = {})
sealed interface TriageRequest {                      // handled once; onRequestHandled is called at once
    data class Alerts(val serverId: ServerId?)        // Alertes segment, that server's chip (2+ servers)
    data class Approval(val serverId: ServerId, val approvalId: Long)   // Approbations, then S11 (waits 10 s for it)
    data class Enrolment(val serverId: ServerId, val deviceId: Long)    // Enrôlements, then S12 (waits 10 s for it; found even when the view filter hides it)
    data class Enrolments(val serverId: ServerId?)    // Enrôlements segment, that server's chip (2+ servers) — « N appareils en attente »
    data class Approvals(val serverId: ServerId?)     // Approbations segment, that server's chip — « N demandes en attente »
}

// :obliance:devices (package tools.obli.obliance.devices)
@Composable fun DeviceListScreen(onOpenDevice: (ServerId, Long) -> Unit, onRunScript: (ServerId, List<Long>) -> Unit = …)
@Composable fun DeviceDetailScreen(serverId: ServerId, deviceId: Long, onBack: () -> Unit,
    onOpenTerminal: (ServerId, Long, protocol: String) -> Unit = …, onOpenReach: (ServerId, Long) -> Unit = …,
    onRunScript: (ServerId, List<Long>) -> Unit = …, onOpenAutomations: (ServerId, Long) -> Unit = …,
    initialTab: String? = null)   // "overview" | "services" | "processes" | "tasks"; anything else opens Aperçu

// :obliance:remote (package tools.obli.obliance.remote)
@Composable fun TerminalScreen(serverId: ServerId, deviceId: Long, protocol: String, onMinimize: () -> Unit, modifier: Modifier = Modifier, wtsSessionId: Int? = null, resumeId: String? = null)
@Composable fun ReachScreen(serverId: ServerId, deviceId: Long, onClose: () -> Unit, modifier: Modifier = Modifier)
@Composable fun SessionChoiceSheet(serverId: ServerId, deviceId: Long, protocol: String, onChoose: (wtsSessionId: Int?) -> Unit, onDismiss: () -> Unit)
@Composable fun SessionsPill(onOpen: (RemoteSessionRef) -> Unit, modifier: Modifier = Modifier)
@Composable fun RemoteSessionsSection(onOpen: (RemoteSessionRef) -> Unit, modifier: Modifier = Modifier)
object RemoteAccess { fun configure(client, userAgent, cookieHeader?); val liveSessions: StateFlow<List<RemoteSessionRef>>; fun session(id: String?): RemoteSessionRef? }
class RemoteSessionService { companion object { const val EXTRA_SESSION_ID } }

// :obliance:automations (package tools.obli.obliance.automations)
@Composable fun ActivityScreen(onRunScript: () -> Unit, onOpenScript: (ServerId, Long) -> Unit, onOpenScripts: () -> Unit,
    onOpenSchedules: () -> Unit, onOpenScenarios: () -> Unit, onOpenBatch: (ServerId, String) -> Unit, sessions: @Composable () -> Unit = {})
@Composable fun ScriptPickerScreen(serverId: ServerId, deviceIds: List<Long>, onBack: () -> Unit, onPicked: (scriptId: Long) -> Unit)
@Composable fun RunScriptScreen(serverId: ServerId, scriptId: Long, deviceIds: List<Long>, onBack: () -> Unit, onStarted: (batchId: String) -> Unit, onChangeScript: () -> Unit = onBack, rerunOf: String? = null)
@Composable fun BatchScreen(serverId: ServerId, batchId: String, onBack: () -> Unit, onRerunFailures: (ServerId, Long, List<Long>, String) -> Unit, onOpenTerminal: ((ServerId, Long) -> Unit)? = null)
@Composable fun SchedulesScreen(onBack: () -> Unit)
@Composable fun ScenariosScreen(onBack: () -> Unit)

// :obliance:fleet   (package tools.obli.obliance.fleet)
@Composable fun FleetScreen(onOpenDevices: () -> Unit)

// :obliance:more    (package tools.obli.obliance.more)
@Composable fun MoreScreen(onOpenServers: () -> Unit, onOpenScope: () -> Unit, onOpenSettings: () -> Unit = {},
    onOpenNotifications: () -> Unit = {}, onOpenAbout: () -> Unit = {}, notificationsSummary: String? = null)
@Composable fun AppSettingsScreen(onBack: () -> Unit, onOpenNotifications: () -> Unit, onOpenServers: () -> Unit,
    onAddServer: () -> Unit, onOpenAbout: () -> Unit, notificationsSummary: String? = null)          // S83
@Composable fun AboutScreen(onBack: () -> Unit, extraDiagnostics: () -> List<String> = { emptyList() }) // S86
object AppSettings { fun store(context): AppSettingsStore }  // prefs: StateFlow<AppPrefs> (lockEnabled?, lockTimeout, blockScreenshots, themeMode, autoNight), loaded
                                                             // lockEnabled null = S04 step 3 not answered: the lock is NOT armed (lockWanted = lockEnabled == true)
object AppLock { fun install(app: Application, store: AppSettingsStore); val locked: StateFlow<Boolean>; val ready: StateFlow<Boolean>
    fun canUseLock(context): Boolean; @VisibleForTesting fun setLockedForTest(locked: Boolean) }   // ready false only before the prefs are read
@Composable fun AppLockGate(reason: String? = null, content: @Composable () -> Unit)   // S00: content NOT composed while locked;
    // its saved state (back stacks, destination, rememberSaveable) is kept by a SaveableStateHolder outside the lock
@Composable fun LockOnboardingDialog()            // S04 step 3 « Verrouiller Obliance », once (lockEnabled null + a screen lock)
@Composable fun SecureWindow(block: Boolean)                                           // FLAG_SECURE, reference-counted
object ThemeResolver { fun resolve(mode, autoNight, serverVariant, now: LocalTime): ObliThemeVariant }
@Composable fun rememberAppTheme(serverVariant: ObliThemeVariant): ObliThemeVariant  // resolve() re-evaluated at 22:00, 07:00 and on foreground
object AppUpdates { val offer: StateFlow<UpdateOffer?>; suspend fun check(context, services, force = false): UpdateCheck; suspend fun checkIfDue(context, services) }

// :obliance:notifications (package tools.obli.obliance.notifications)
object ObliNotifications {
    const val ACTION_OPEN
    fun install(context, services: ObliServices, ready: StateFlow<Boolean>, launchIntent: (Context) -> Intent = …)  // Application.onCreate
    fun sync(context); fun checkNow(context)
    fun routeFrom(intent: Intent?): NotificationRoute?   // reads AND removes the route extras; null for an unknown server,
                                                         // and for any intent without ACTION_OPEN + this install's RouteToken (exported launcher)
    fun diagnostics(context): List<String>               // no origin, host, cookie or alert text
}
sealed interface NotificationRoute { val serverId: ServerId
    Device(serverId, deviceId, tenantId?, label?, tab? = null); Path(serverId, path, tenantId?)
    Approval(serverId, approvalId, tenantId?); Enrolment(serverId, deviceId, tenantId?, label?)
    Enrolments(serverId); Approvals(serverId)       // the « N en attente » of a burst
    Inbox(serverId); SignIn(serverId) }
@Composable fun NotificationSettingsScreen(onBack: () -> Unit, onOpenServers: () -> Unit)   // S84
@Composable fun NotificationPermissionGate(next: @Composable () -> Unit = {})  // S04 steps 1-2, once a server is signed in;
                                                  // next (step 3) only when nothing of steps 1-2 is shown or waiting
@Composable fun rememberOnCallSummary(): String?  // "Astreinte active · 19:00–08:00" / "Astreinte désactivée"; null if not installed
class OnCallTileService : TileService              // long press → MainActivity with ACTION_QS_TILE_PREFERENCES
```

Everything else in a screen module should be `internal` or `private`.

### How the application hosts them (`:obliance:app`, `ObliNextApp.kt`)

- **No server configured** → `SignInScreen` full screen. As soon as
  `auth.completeSignIn` adds the first profile, the app swaps to the shell by
  itself (`onSignedIn` may be a no-op). SSO (S02) is yours to add inside
  `SignInScreen` (see §6 access).
- **Shell**: `NavigationSuiteScaffold` (bottom bar on compact width, rail from
  600 dp) with 5 destinations in this order: À traiter, Appareils, Activité
  (`ActivityScreen` with `RemoteSessionsSection` in its sessions slot), Flotte, Plus. Each
  destination has its own Navigation 3 back stack; re-selecting a destination
  pops it to its root; back on a non-Triage root goes to À traiter.
- **Top bar**: on top-level screens the app draws the FIRST row (56 dp, chrome):
  scope chip (server tile when 2+ servers, tenant, "VUE GLOBALE" tag on the
  master tenant) → opens `ScopeSheet`; avatar with the realtime ring → Plus.
  **Your top-level screen draws the SECOND row itself** as its first element:
  `ObliScreenHeader(title, freshness = …)` from `core:designsystem`.
- **Pushed screens** (`DeviceDetailScreen`, `ServersScreen`, `AddServerScreen`)
  draw their own `ObliDetailTopBar(title, onBack, backLabel, subtitle)`. On
  compact width the app hides its top bar and the bottom bar for them (§2.4).
- **Device detail**: `DeviceKey(serverId, deviceId)` is pushed on the stack it
  was opened from (À traiter or Appareils), replacing a previous device. From
  600 dp the list-detail scene shows list | detail side by side (placeholder
  "Sélectionnez un appareil" when nothing is open). `onBack` pops.
- **Implicit server switch** (§2.10): when `onOpenDevice(serverId, id)` targets
  another server, the app calls `services.openOn(serverId)`, pushes the detail
  and shows "Passé sur <server> pour ouvrir <device>" with **Revenir** for 5 s.
  Screens never switch servers themselves for this.
- **Session expired** on the ACTIVE server (401 anywhere, refused socket
  handshake, or signed out) → the app shows `ReauthSheet(activeId)`; it hides it
  once the session is signed in again, or when `onDone` is called.
- `onManageServers` (ScopeSheet) and `onOpenServers` (More) push
  `ServersScreen` on the Plus stack; `onAddServer` pushes `AddServerScreen`;
  `AddServerScreen.onDone` pops back to the servers list.
- `FleetScreen.onOpenDevices` selects the Appareils destination.
- **0.2.0 routes** (NavKeys in `AppKeys.kt`, `@Serializable`), always pushed on
  the CURRENT destination's stack (device flows on the stack of the device
  detail, usually Appareils; Activité flows on Activité). Phones: full screen,
  top and bottom bars hidden. From 600 dp: detail pane next to the list of
  À traiter / Appareils / Activité (Activité is a list pane too, placeholder
  "Sélectionnez un lot ou une session"); `ReachKey` is always full screen.

  | Key | Screen | Opened by |
  |---|---|---|
  | `TerminalKey(serverId, deviceId, protocol, wtsSessionId?, resumeId?)` | `TerminalScreen` (`onMinimize` pops) | detail `onOpenTerminal`: `ssh` directly; `powershell` / `cmd` after `SessionChoiceSheet` (SYSTEM first); batch "Ouvrir PowerShell" (`powershell`, SYSTEM, no sheet); resume |
  | `ReachKey(serverId, deviceId)` | `ReachScreen` (`onClose` pops) | detail `onOpenReach`; resume of an `oblireach` session |
  | `ScriptPickerKey(serverId, deviceIds)` | `ScriptPickerScreen` | detail / list `onRunScript`; Activité FAB and Scripts "Tout voir" (active server, no targets) |
  | `RunScriptKey(serverId, scriptId, deviceIds, rerunOf?)` | `RunScriptScreen` | picker `onPicked`; Activité script chip; batch `onRerunFailures`. `onChangeScript` returns to the picker (or replaces the run by one) |
  | `BatchKey(serverId, batchId)` | `BatchScreen` | `onStarted` (the picker and the run are REPLACED by the batch); Activité `onOpenBatch` |
  | `SchedulesKey` / `ScenariosKey` | `SchedulesScreen` / `ScenariosScreen` | Activité "Tout voir"; detail `onOpenAutomations` → `ScenariosKey` |

  Resume (`RemoteSessionRef`): `protocol == "oblireach"` → `ReachKey`, else
  `TerminalKey(…, resumeId = ref.id)`. Sources: `SessionsPill` (phone and
  tablet, 8 dp above the navigation bar, only on screens that show the bar and
  not on Activité), `RemoteSessionsSection` (Activité), and the sessions
  notification (`MainActivity` reads `RemoteSessionService.EXTRA_SESSION_ID`
  in `onCreate`/`onNewIntent` and resumes on the current destination).
  Opening a device from a list clears its stack above the root first.
- **Remote transport**: `AppGraph` calls `RemoteAccess.configure(client,
  USER_AGENT, cookieJar::headerFor)` (one OkHttp client, one cookie store).
  Android 13+: POST_NOTIFICATIONS is asked by `NotificationPermissionGate`
  (0.3.0, once a server is signed in, then the battery exemption); the 0.2.0
  prompt at the first remote session is gone.
- **0.3.0 application wiring**:
  - `ObliNextApplication.onCreate`: `AppGraph.start()`, `AppLock.install(this,
    AppSettings.store(this))`, `ObliNotifications.install(this, services, ready,
    launchIntent = MainActivity)`, then once ready `AppUpdates.checkIfDue`.
  - **Socket only in the foreground**: `DefaultObliServices.start(foreground:
    StateFlow<Boolean>, backgroundGraceMs = 30 s)`. `AppGraph.foreground`
    follows `ProcessLifecycleOwner` ON_START / ON_STOP. The active server's
    socket connects only when it is SignedIn AND the app is in the foreground,
    and disconnects 30 s after the app went to the background (a socket
    reconnected meanwhile, by a tenant switch for instance, is closed again).
    The startup probe still runs. A process started by WorkManager, a
    notification action or the tile never opens a socket. `start()` without
    arguments keeps the 0.2.0 behaviour (always in the foreground: tests, previews).
  - `MainActivity` content: `SecureWindow(prefs.blockScreenshots)` (outside the
    lock, so S00 is covered too), `ObliTheme(variant =
    rememberAppTheme(rememberActiveServerTheme(services)))`,
    `LocalObliServices`, `AppLockGate(reason = « Déverrouillez pour ouvrir … »)`,
    then `ObliNextApp(ready, resume…, route, onRouteHandled,
    openNotificationSettings, onNotificationSettingsOpened)`.
  - `ObliServicesHost.routeFrom(intent)` (default: `ObliNotifications.routeFrom`)
    is read in `onCreate` (fresh start only) and `onNewIntent`, once the registry
    is loaded; the route waits behind S00 (the shell is not composed while locked).
  - Manifest: `MainActivity` handles `android.service.quicksettings.action.QS_TILE_PREFERENCES`
    (long press on the tile) → S84. Everything else (POST_NOTIFICATIONS, battery
    exemption, notification receiver, tile service, REQUEST_INSTALL_PACKAGES,
    update FileProvider and DOWNLOAD_COMPLETE receiver, WorkManager initializer)
    comes in by manifest merge.
- **0.3.0 Plus screens** (NavKeys pushed on the Plus stack like `ServersKey`,
  full screen on phones, bars hidden): `AppSettingsKey` → S83,
  `NotificationSettingsKey` → S84, `AboutKey` → S86 (`extraDiagnostics =
  ObliNotifications.diagnostics`). A Plus screen already in the stack is brought
  back instead of pushed twice. Plus carries an 8 dp `#60A5FA` dot while
  `AppUpdates.offer != null`.
- **Top bar with a global-view filter** (`tenants.scope.viewFiltered`): chip
  « ACME · filtre » (« 2 tenants · filtre »), 6 dp `accent2` dot instead of the
  « VUE GLOBALE » tag, content description « Périmètre : Obliance Prod, vue
  globale filtrée sur ACME » (server named with 2+ servers). À traiter applies
  the filter to the ACTIVE server's alerts, escalations and enrolments (other
  servers are never filtered) and says « Filtre de la vue globale : N éléments
  d'autres tenants masqués »; a notification route still finds a hidden item.
- **S00 and S04 step 3**: `AppLockGate` keeps the shell's saved state across
  the lock (ViewModels of the entries are recreated and reload; an open
  S41–S44 prompt is cancelled, never replayed). `NotificationPermissionGate {
  LockOnboardingDialog() }` in the shell: the lock is proposed once, after the
  notification steps; until it is answered the lock is not armed.
- **Notification routes** (`planRoute` in `:obliance:app`, pure and JVM-tested;
  NAVIGATION ONLY, a route never runs an action):

  | Route | What the shell does |
  |---|---|
  | `Device` | À traiter selected, `DeviceKey(serverId, deviceId, tab)` on its stack after the implicit server switch. §2.3 rule 1: platform admin on the master tenant → no tenant switch; otherwise `locate-device` and `tenants.switchTo(itsTenant, serverId)` when it differs. ONE snackbar with **Revenir** (5 s): « Passé sur Obliance Qual › ACME pour ouvrir SRV-QUAL01 », « Passé sur Obliance Qual pour ouvrir … » or « Basculé sur ACME pour ouvrir … ». Revenir restores the tenant, then the server. |
  | `Path` | `openOn(serverId)`, then `webPathToNative(path)` (S30 / Flotte) or `navigator.openWeb(path, server name)`; « Passé sur … · Revenir » when the server changed. |
  | `Approval` / `Enrolment` | À traiter popped to its root + `TriageRequest.Approval` / `.Enrolment`. No server switch (inbox action, §2.10 item 4). |
  | `Enrolments` / `Approvals` | À traiter popped to its root + `TriageRequest.Enrolments` / `.Approvals` (server chip with 2+ servers). |
  | `Inbox` | `TriageRequest.Alerts(serverId)` (server chip only with 2+ servers). |
  | `SignIn` | Active server → S03 again (`reauthRequests++`); another server → `ReauthSheet(thatServer)`, the active server stays; signed in again since → just À traiter. |
  | Removed / unknown server | Just À traiter. |
- **Insets**: the app pads the status bar (chrome colour) and the navigation
  bar. Screens do not add system-bar insets (IME insets are yours).
- Dark theme only: everything is inside `ObliTheme { }`.

## 3. `ObliServices` (`:obliance:data`)

```kotlin
val services = LocalObliServices.current            // in any composable
val vm = viewModel { MyViewModel(services) }        // lifecycle-viewmodel-compose
```

Each Navigation 3 entry has its OWN `ViewModelStore` (cleared when the entry is
popped), so `viewModel { }` in `DeviceDetailScreen` is per device. If one
composable needs several instances of the same ViewModel class, pass `key =`.

| Member | Semantics |
|---|---|
| `registry: ServerRegistry` | `state: StateFlow<ServerRegistryState>` (`profiles` in user order, `activeId`, `active`, `isMultiServer`, `byId`, `byUrl`); `add`, `remove`, `rename`, `recolor`, `setNotify`, `setIncludeInTriage`, `setLastTenant`, `reorder`. 1..8 servers, unique https origins. |
| `sessions: ServerSessions` | `active: StateFlow<ServerSession?>`, `session(id)`, `all()`, `activate(id)`. A `ServerSession` has `http: ObliHttp` (bound to its origin), `auth: StateFlow<AuthState>` (`Unknown`, `SignedIn(probe)`, `Expired`, `Unreachable`, `SignedOut`), `probe()`, `markExpired()`, `realtime: RealtimeClient` (only the active server's socket is connected). |
| `LocalObliNavigator` (composition local, not a member) | `ObliNavigator { openWeb(path, title); openDevice(serverId, deviceId) }` provided by the app: S90 web page of the ACTIVE server pushed on the current destination (full screen on phones, detail pane on tablets); S30 with the implicit switch. Default in tests: `ObliNavigator.None` (does nothing). |
| `suspend fun openOn(serverId): ServerId?` | Implicit switch: activates `serverId` if needed; returns the previously active id when a switch happened, null otherwise (already active or unknown). The app uses it; screens rarely need it (ScopeSheet does). |

### `auth: AuthRepository` (steps take an ORIGIN: a new server has no profile yet)

| Call | Semantics |
|---|---|
| `checkServer(address)` | Normalises (https only, `ServerUrl`), then `GET /health` + `GET /api/auth/sso-config` → `ServerCheck.Ok(origin, health, sso, existing)` / `Invalid(problem)` / `NotObliance` / `Unreachable(outcome)` / `LimitReached`. `sso.offersObligate` tells whether to show the Obligate button. |
| `login(origin, user, password)` | `POST /api/auth/login` → `LoginResult.SignedIn(user)` / `TwoFactorRequired(methods)` / `InvalidCredentials` / `RateLimited` / `Failed(outcome)`. |
| `verifyTwoFactor(origin, method, code)` | `POST /api/profile/2fa/verify {code, method}` → `SignedIn` / `InvalidCode` (retry) / `TwoFactorSessionLost` (restart at password) / … For e-mail OTP the server already sent a code at login. |
| `resendEmailCode(origin)` | `POST /api/profile/2fa/resend-email`. |
| `completeSignIn(origin, displayName?, activate = true)` | After `SignedIn`: adds the profile if new, confirms with `/api/auth/me`, activates it (socket connects) → `SignInResult.Done(profile, probe)` / `Refused` / `NotSignedIn`. Runs in the app scope (not cancelled when your screen leaves). Use `activate = false` to re-authenticate a non-active server. |
| `signOut(serverId)` | `POST /api/auth/logout`, clears that origin's cookies, session → `SignedOut`, socket closed; the profile stays. |

Cookies: native calls, the socket handshake and any `android.webkit.WebView`
share one cookie store (`CookieManager`). An SSO login done in a WebView on the
server origin therefore signs the native session in too: open
`${origin}/auth/sso-redirect`, wait until the WebView comes back to the origin
(not `/login`), then call `completeSignIn(origin)`.

### `tenants: TenantsRepository` (ACTIVE server)

| Member | Semantics |
|---|---|
| `scope: StateFlow<TenantScope>` | `serverId`, `tenants` (master first), `currentTenantId` (session tenant from `/api/auth/me`), `current`, `isGlobalView` (tenant 1 "Default"), `canSwitch` (2+ tenants), `loading`, `error`. Follows server switches; loads the list once the active server is signed in. **Screens reload their data when `scope.serverId` or `scope.currentTenantId` changes.** |
| `refresh()` | `GET /api/tenants`. |
| `switchTo(tenantId, serverId = null)` | `POST /api/tenant/switch` on `serverId` (null = active server), re-probes that server's `/me`, reconnects the socket if it is the active server, remembers it as the profile's last tenant. Runs in the app scope (a dismissed sheet does not cancel it halfway). The tenant list is per account: dropped on sign-out, reloaded for another account, failed loads retried. |
| `setViewFilter(tenantIds, serverId = null): Boolean` | 0.3.0 « Filtrer la vue globale » (§2.3): stored per server in `ServerProfile.viewFilter` (`ServerRegistry.setViewFilter`, ids > 0, at most 64); selecting every tenant stores "no filter". `TenantScope` gains `viewFilter`, `viewFiltered`, `filterTenants`, `listTenantIds` (what lists pass as `DeviceQuery.tenantIds`), `withStoredViewFilter`, `effectiveViewFilter` (empty outside the master tenant). **Lists also reload when `scope.listTenantIds` changes.** |

### `alerts: AlertsRepository` (EVERY server with `includeInTriage`)

| Member | Semantics |
|---|---|
| `snapshot: StateFlow<AlertsSnapshot>` | Hot while collected: refresh every 60 s + `NOTIFICATION_NEW` / `APPROVAL_*` of the active server's socket. `alerts: List<ServerAlert>` (each with its `serverId`), `escalations: List<ServerApproval>` (pending two-person approvals of servers where the user is platform admin), `feeds` (per server: `LOADING`, `OK`, `EXPIRED`, `UNREACHABLE`, `SIGNED_OUT`, `EXCLUDED`; expired/unreachable servers keep their last items), `refreshing`, `updatedAt`, `badgeCount`, `triage(serverFilter, severityFilter)` → domain `TriageList` (unread by priority, read, site outages, unread per server). |
| `refresh()` | Pull to refresh (all servers in parallel). |
| `markRead(alert)` / `delete(alert)` | `PATCH /api/live-alerts/:id/read` / `DELETE /api/live-alerts/:id` on the ALERT'S server; local state updated on success. Never switches server. |
| `markAllRead(serverId)` | `POST /api/live-alerts/read-all` on that server — its SESSION tenant only; then reloads that server. |
| `approve(item, reason?, extra?)` / `deny(…)` | `POST /api/approvals/:id/approve|deny` on the approval's server. `extra` carries step-up fields (`twoFactorCode`, `trustIp`): run it inside `ActionRunner` (T2). 409 (already resolved) and 410 (expired) also remove it from the list. |

### `devices: DevicesRepository` (ACTIVE server unless a `serverId` is given)

| Member | Semantics |
|---|---|
| `page(query = DeviceQuery(), serverId = null)` | `GET /api/devices` with `page`, `pageSize`, `search`, `status` (real or virtual `connected` / `disconnected` / `outdated`), `sortBy` (`DeviceSort`) + `sortOrder`, `groupId`, `includeSubgroups`, `approvalStatus`, `osType`, `tags`, `tenantIds` (master tenant only: the "filter the global view" of §2.3) → `DevicePage(items, total, page, pageSize, hasMore)`. |
| `summary(serverId = null)` | `GET /api/devices/summary` → `FleetSummary` (`total` excludes pending/suspended/uninstalling; `connected`; `deltas`). |
| `detail(serverId, deviceId)` | `GET /api/devices/:id` → `Device` (`label`, `statusKind`, `latestMetrics`, …). |
| `liveMetrics(serverId, deviceId): Flow<LiveSample>` | While collected: arms live mode (`POST /api/devices/:id/live-metrics`, every 30 s), emits each `DEVICE_METRICS_PUSHED` of that device (`live = true`); after 15 s without a push, falls back to `detail()` every 15 s (`live = false`: show "actualisation toutes les 15 s", §2.3 rule 3). |
| `signals(): Flow<DeviceSignal>` | `DEVICE_UPDATED` / `ONLINE` / `OFFLINE` / `DELETED` / `APPROVED` / `MAINTENANCE_CHANGED` of the active server (`deviceId`, optional `status`). |

Every call returns `ApiOutcome<T>` (core:network): `Ok`, `Accepted`,
`PendingApproval`, `StepUpRequired`, `StepUpRejected`, `PrivacyLocked`,
`Unsupported` (409), `Forbidden`, `AgentOffline` (503), `SessionExpired`,
`RateLimited`, `Validation`, `Failure(status, kind)`. A `SessionExpired` has
already marked that server's session expired (the app shows S03 for the active
server): just show a calm state.

### Sample data for previews and tests

`SampleObliServices(serverCount = 3)` is an in-memory `ObliServices` over
`SampleData` = design doc §4 (Obliance Prod / Dev / Qual, tenants Default and
ACME, the alerts of the night of 25 September, devices SRV-AD2, PC-COMPTA-03,
BOB01…). Sessions are signed in; actions mutate memory. **Never invent other
names** (no real organisation names anywhere: code, tests, docs).

## 4. Multi-server and multi-tenant safety

- An item always travels with its `ServerId`; every call about it goes through
  `services.sessions.session(item.serverId)` — never the active session, never a
  hand-built URL. `ObliHttp` refuses any path that would leave its origin.
- Lists (devices, fleet, activity) are the ACTIVE server's; À traiter is every
  server's. Inbox actions (read, delete, approve/deny) never switch server; any
  other action on a device requires it to be on the active server.
- Action routes are bound to the SESSION tenant (§2.3): from the global view an
  action on a child-tenant device needs a tenant switch first
  (`Preflight.NeedsTenantSwitch` of `ActionRunner`).
- Every mutating call goes through `core:security` `ActionRunner` (tiers
  T0–T3, step-up 2FA, pending approval, privacy lock, never replayed after a
  401), taken from `LocalActionRunner` (§12). Do not write your own prompter.

## 5. UI rules (design doc §7–§8)

- Colours only from `ObliTheme.colors` / `ObliTokens`; type from
  `ObliTypography`; components from `core:designsystem`: `ObliScreenHeader`,
  `ObliDetailTopBar`, `ObliIconButton` (48 dp), `ObliCalmState`,
  `ObliServerTile` (only when `registry.isMultiServer`), `ObliStatusPill`,
  `ObliStatusDot`, `ObliIcons` (Lucide set; add module-private icons with
  `ObliIcons.lucide(name, *paths)`). No material-icons dependency.
- Red discipline (§8.3): brand red `#C83232` (`accentFill`) only for filled
  primary buttons and chrome; `#FF6868` (`accent2`) for active nav, tonal
  buttons, snackbar action. In content, red means CRITICAL and nothing else.
  State is never colour alone (icon or label with it).
- Touch targets ≥ 48 dp; text contrast ≥ 4.5:1 (use the token pairs of
  STYLEKIT §2; `Contrast.ratio` exists for unit tests).
- No emoji. French micro-typography in `values-fr` (narrow no-break space
  ` ` before `%`, `:`, `?`, `!`; `« … »`).

## 6. Per-module notes

- **access** — `SignInForm` (internal) already implements address → password →
  2FA with `AuthRepository`; replace freely. `ScopeSheet` / `ReauthSheet` are
  `ModalBottomSheet`s; their contents are `internal` composables
  (`ScopeSheetContent`, `ReauthContent`) so the screenshot tests can capture
  them (Robolectric does not capture dialog windows with `onRoot()`). S02 SSO:
  WebView on `${origin}/auth/sso-redirect` (cookies are shared, see §3).
- **triage** — `onOpenDevice(serverId, deviceId)`: the device id comes from the
  alert's `navigateTo` (`/devices/:id`) resolved against the alert's OWN server.
  Approvals: `alerts.approve/deny` inside `ActionRunner` (T2, the confirmation
  names the server: "… — PC-ATELIER-02 · Obliance Prod › ACME").
- **devices** — reload the list on `tenants.scope` (`serverId`,
  `currentTenantId`) changes; merge `signals()` for live status. The detail's
  `serverId` is the active server when the app opens it.
- **fleet** — `summary()` + any extra fleet call (`/api/devices/group-stats`,
  `/api/devices/disk-saturated`, `/api/devices/fleet-timeseries`…) implemented
  privately (§7); poll every 60 s while visible (§2.3 rule 3).
- **more** — `onOpenServers`, `onOpenScope`; sign-out of the active server via
  `auth.signOut(id)` (the app then shows `ReauthSheet`).

## 7. An API call that is not in `:obliance:api`

Implement it privately in your module, over the session of the right server:

```kotlin
/** GET on THIS server, `{data}` envelope unwrapped, 401 → session expired. */
internal suspend fun <T> ServerSession.getTyped(path: String, serializer: KSerializer<T>): ApiOutcome<T> =
    http.call(ObliHttp.Method.GET, path, decode = ApiJson.unwrapped(serializer))
        .also { if (it == ApiOutcome.SessionExpired) markExpired() }

// usage: services.sessions.session(serverId)?.getTyped("/api/devices/disk-saturated", MyDto.serializer())
// where MyDto is YOUR @Serializable class whose fields are copied from the route's code.
```

Read the server code (`server/src/routes/*.ts`, `shared/src/types.ts`) for the
exact shape; never invent fields. Declare every field with a default (tolerant
decoding: `ApiJson` ignores unknown keys, accepts numbers sent as strings). If
you need `@Serializable`, add `alias(libs.plugins.kotlin.serialization)` to your
module's `plugins { }`. Socket event names: `ObliEvents` (values of shared
`SocketEvents`); the socket only surfaces the names in `ObliEvents.LISTENED`.
(0.2.0 adds `SCENARIO_RUN_UPDATED` and `SCENARIO_NODE_UPDATED`: S58 refreshes on
them, with its 5 s polling kept as the fallback.)

## 8. Strings

- Every visible string (including content descriptions) lives in
  `src/main/res/values/strings.xml` (English) AND `values-fr/strings.xml`
  (French, formal "vous" or neutral phrasing, never "tu").
- Prefix every name with the module: `access_`, `triage_`, `devices_`,
  `fleet_`, `more_` (the app uses `app_`). Resources of all modules merge into
  one APK: an unprefixed name WILL clash.
- `:obliance:app:lintDebug` runs with `checkDependencies = true`: a missing
  translation in your module fails the build.

## 9. Screenshot tests (Roborazzi on Robolectric)

Your module's `build.gradle.kts` already has the setup (copied from
`core:designsystem`): record mode on, images in
`obliance/<module>/build/outputs/roborazzi/`. Template (see
`obliance/<module>/src/test/.../*ScreenshotTest.kt`):

```kotlin
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")   // tablet: "fr-rFR-w1280dp-h800dp-land-mdpi"
class MyScreenshotTest {
    @get:Rule val compose = androidx.compose.ui.test.junit4.v2.createComposeRule()
    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    @Test fun list() {
        compose.setContent {
            ObliTheme { CompositionLocalProvider(LocalObliServices provides SampleObliServices()) { DeviceListScreen(onOpenDevice = { _, _ -> }) } }
        }
        compose.onRoot().captureRoboImage(shot("devices_list.png"))
    }
}
```

Always put `@Config(sdk = [35])` (class or method level): Robolectric has no
offline image for the compile SDK. Prefix image names with your module.

## 10. Verify before you hand over

```
./gradlew --no-daemon :obliance:<module>:testDebugUnitTest :obliance:app:assembleDebug :obliance:app:lintDebug
```

The APK is `obliance/app/build/outputs/apk/debug/app-debug.apk`
(applicationId `tools.obli.obliance.next`, "Obliance Next", installs next to
the WebView app). Report exactly what you compiled and tested.

Release (`:obliance:app:assembleRelease`, 0.3.0): signed with the
`obli.keystore.*` key when all four values are set (`-P`, `local.properties`
or `OBLI_KEYSTORE_FILE`…), unsigned when none is, a build error naming the
missing KEYS when only some are. The certificate SHA-256 must equal
`mobile/android/RELEASE-FINGERPRINT.txt`. A phone with a debug build must
uninstall it before the first release-signed install (different signer).

## 11. Known gaps of the foundation (not yours unless listed in your module)

- Obligate SSO (S02) not wired (access agent).
- Server switch does not restore the last tenant of that server yet, and back
  stacks are not remembered per server (§2.10 item 2).
- No app shortcuts, no search palette (S82). No tablet session dock (§2.6): the
  pill stands in for it; no mini chip in pushed screens' top bars.
- Notifications (0.3.0): each network step of a server pass has its own 20 s
  budget and each part (alerts, escalations, enrolments) is saved as soon as it
  is done (a late failure is `PARTIAL`, S84 « Alertes vérifiées à … ;
  approbations ou enrôlements non vérifiés »). Enrolments and escalations: 3
  per server and per pass, the rest in ONE « N en attente » notification; the
  publisher cancels the oldest non-critical notifications before the app
  reaches 40 (Android drops silently past ~50); the criticals of a pass are
  checked 1.5 s later and posted again if missing. A recovery replaces only the
  newest notification of the kind it answers (`PostedAlert.category`). Before
  Android 12 an enrolment notification offers « Examiner » only, and an action
  from a locked phone sends nothing.
- Notifications (0.3.0): background alerts come from a 15-minute WorkManager
  poll only (Android may defer it under Doze); push (UnifiedPush, server S6) is
  v1.1. « Surveiller » (the watch engine: follow a device until it recovers)
  does not exist yet. S84's per-category matrix is read-only: categories are
  Android channels, changed in the Android settings of each channel.
- Tenant rule §2.3 rule 1 (`locate-device`, automatic switch) applies to
  notification routes only; a tap on an alert card in À traiter keeps the 0.2.0
  behaviour (server switch only).
- FLAG_SECURE: S60 terminal and S62 ObliReach set it only while shown (and,
  since 0.3.0, never clear a flag they did not set); a minimised terminal
  session (pill, Activité) is not covered, and nothing was checked on a real
  window (recents thumbnail, screen recording).
- Action host: S43 has no "Suivre dans Activité"; S44 only
  covers the unlock route (`/privacy/unlock`): the "disable privacy mode with
  the password" variant (`/privacy/disable-with-password`) is the device
  screen's own call; the 2FA sheet has no Obligate-SSO wording variant; the
  trust-window line "Confirmé par empreinte il y a 12 s" is not shown.
- Web view: no file upload (`<input type=file>`), no `ObliNative` bridge.

## 12. Running an action (`:core:security-ui`)

Add `implementation(project(":core:security-ui"))` to your module. The app
places `ObliActionHost` once at the root (under `ObliTheme`); it provides:

```kotlin
val LocalActionRunner: ProvidableCompositionLocal<ActionRunner>   // wired to the host's sheets
val LocalActionFeedback: ProvidableCompositionLocal<ActionFeedback> // fun show(result: ActionResult<*>, done: String)
object ActionMessages { fun describe(resources, result, done: String): ActionMessage? ; fun failure(resources, outcome): String }
```

A screen (or its ViewModel, given the runner) does, for an item of `serverId`:

```kotlin
val runner = LocalActionRunner.current
val feedback = LocalActionFeedback.current
val services = LocalObliServices.current
scope.launch {
    val session = services.sessions.session(device.serverId) ?: return@launch   // the ITEM's server, never another origin
    val spec = ActionSpec(
        key = "device.reboot", tier = Tier.T2,
        title = "Redémarrer", target = device.label,
        scope = "Obliance Prod › ACME",            // server shown when 2+ servers (§7.6)
        consequence = "Le poste redémarrera immédiatement.",
        targetCount = 1,                           // > 1 for bulk; T3 with >= 10 asks to type it
        endpoints = session.actionEndpoints(device.id),   // S43 "Annuler la demande", S44 unlock (obliance:data)
    )
    val result = runner.run(spec, preflight = {
        when {
            !device.online -> Preflight.Blocked("PC-COMPTA-03 est hors ligne")        // shown as is, nothing sent
            needsSwitch -> Preflight.NeedsTenantSwitch("ACME") { services.tenants.switchTo(acmeId, device.serverId) is ApiOutcome.Ok }
            else -> Preflight.Ok
        }
    }) { extra ->
        // SAME body on each attempt + `extra` (twoFactorCode, trustIp) merged in.
        session.http.post("/api/commands", buildJsonObject { put("deviceId", device.id); put("type", "reboot"); extra.forEach { (k, v) -> put(k, v) } })
            .also { if (it == ApiOutcome.SessionExpired) session.markExpired() }
    }
    feedback.show(result, done = "Redémarrage demandé")
}
```

What the host shows (all over the current screen, one prompt at a time):
tenant switch ("Pour agir sur X, Obliance doit passer sur le tenant Y."
[Basculer et continuer]); S41 per tier — T1 compact sheet, T2 sheet then
`BiometricPrompt` (BIOMETRIC_STRONG or device credential, subtitle "target ·
scope"; without a screen lock the sheet alone confirms and says so), T3 hold
1.5 s with haptic ticks (two buttons under TalkBack / switch access) then
biometric, bulk T3 ≥ 10 types the count; S42 (6 boxes, paste, trust IP with
the current IP, error after a wrong code, 3 attempts); S43 (never a success;
"Annuler la demande" when `endpoints` is set); S44 (feature chips + privacy
password → `POST /api/devices/:id/privacy/unlock`, one retry). A 401 session
calls the app's hook (S03 shows again). `ActionResult`s: `Done`,
`AwaitingApproval` (amber, never a tick), `Cancelled` (say nothing),
`Blocked(reason)`, `SessionExpired`, `Failed(outcome)` — `feedback.show` or
`ActionMessages.describe` give the French text (403 capability « Votre équipe
n'a pas le droit « Alimentation » sur cet appareil. », 409 legacy, 503 offline,
network, 429…). Screenshot tests: the host is not needed to render a screen;
to test a flow, wrap in `ObliActionHost(ActionHostState(...)) { }` and drive
`state.prompt`.

## 13. Opening a web page (`:core:webfallback`, S90)

From any screen: `LocalObliNavigator.current.openWeb("/admin/users", "Utilisateurs et équipes")`
(or `LocalWebPageOpener.current.openWeb(path, title)` from a platform module).
`path` is same-origin and starts with `/`; the page opens on the ACTIVE server
with the shared cookie session (same tenant as native calls). Chrome: Fermer,
title + "Vue web", Actualiser, Ouvrir dans le navigateur. Other origins open in
a Custom Tab; `mailto:`/`tel:` go to Android; `javascript:`/`file:`/`intent:`
are refused; downloads go to DownloadManager with the cookie (same origin
only). `/devices/:id` and `/` inside the page come back to S30 / Flotte. On
close the app re-probes `/api/auth/me` (tenant changed in the page → scope
follows, socket reconnects). Direct use: `ObliWebView(origin, path, title, onClose, onInAppPath = { false })`.
