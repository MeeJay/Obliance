package tools.obli.obliance.access

import android.webkit.CookieManager
import java.util.UUID
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import tools.obli.core.auth.AuthState
import tools.obli.core.auth.ServerRegistry
import tools.obli.core.designsystem.ObliDetailTopBar
import tools.obli.core.designsystem.ObliServerTile
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.obliance.data.LocalObliServices

/** Whether the process-wide WebView cookie store holds cookies for [url] (an Obligate session). */
internal fun androidHasCookies(url: String): Boolean =
    runCatching { !CookieManager.getInstance().getCookie(url).isNullOrBlank() }.getOrDefault(false)

// ---------------------------------------------------------------------------------------------
// S01 — Connexion (first server)
// ---------------------------------------------------------------------------------------------

/** S01: first sign-in (no server configured yet). [onSignedIn] once the server is added and signed in. */
@Composable
fun SignInScreen(onSignedIn: () -> Unit, modifier: Modifier = Modifier) {
    val services = LocalObliServices.current
    val vm = viewModel(key = "access-sign-in") { SignInViewModel(services, SignInMode.FIRST, hasCookiesFor = ::androidHasCookies) }
    val state = vm.state
    val signedIn by rememberUpdatedState(onSignedIn)
    LaunchedEffect(state.finished) { if (state.finished) signedIn() }
    SignInLayout(state, vm, modifier, rememberClipboardAccess(state.step))
    val probe = state.probe
    if (state.ssoOpen && probe != null) SsoSheet(probe, vm::onSso)
}

/** S01 layout: one scrolling column on phones; brand panel | 440 dp form card from 600 dp. */
@Composable
internal fun SignInLayout(state: SignInUiState, actions: SignInActions, modifier: Modifier = Modifier, clipboard: ClipboardAccess = ClipboardAccess.None) {
    val c = ObliTheme.colors
    BoxWithConstraints(modifier.fillMaxSize().background(c.bg)) {
        val height = maxHeight
        if (maxWidth >= 600.dp) {
            Row(Modifier.fillMaxSize()) {
                BrandPanel(Modifier.weight(1f).fillMaxHeight())
                Column(Modifier.weight(1f).fillMaxHeight().imePadding().verticalScroll(rememberScrollState())) {
                    Column(
                        Modifier.fillMaxWidth().heightIn(min = height).padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().clip(CardShape).background(c.chrome).padding(24.dp)) {
                            SignInTitle(state)
                            Spacer(Modifier.height(16.dp))
                            SignInBody(state, actions, clipboard = clipboard)
                            Spacer(Modifier.height(20.dp))
                            SecureFooter()
                        }
                    }
                }
            }
        } else {
            val brand = c.brand
            Column(
                Modifier
                    .fillMaxSize()
                    .drawBehind {
                        drawRect(Brush.radialGradient(listOf(brand.copy(alpha = 0.12f), Color.Transparent), center = Offset.Zero, radius = size.width * 1.1f))
                    }
                    .imePadding()
                    .verticalScroll(rememberScrollState()),
            ) {
                Column(Modifier.fillMaxWidth().heightIn(min = height).padding(start = 16.dp, end = 16.dp, top = 56.dp, bottom = 20.dp)) {
                    Wordmark()
                    Spacer(Modifier.height(10.dp))
                    Text(stringResource(R.string.access_tagline), style = ObliTypography.body, color = c.text2)
                    Spacer(Modifier.height(40.dp))
                    SignInTitle(state)
                    Spacer(Modifier.height(16.dp))
                    SignInBody(state, actions, clipboard = clipboard)
                    Spacer(Modifier.weight(1f))
                    Spacer(Modifier.height(20.dp))
                    SecureFooter()
                }
            }
        }
    }
}

@Composable
private fun SignInTitle(state: SignInUiState) {
    val c = ObliTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(R.string.access_sign_in_title), style = ObliTypography.screenTitle, color = c.text, modifier = Modifier.semantics { heading() })
        Text(signInSubtitle(state), style = ObliTypography.body, color = c.text2)
    }
}

/** Tablet left half: accent 10 % → surface1 gradient, wordmark, tagline. */
@Composable
private fun BrandPanel(modifier: Modifier) {
    val c = ObliTheme.colors
    val brand = c.brand
    val surface = c.surface1
    Box(
        modifier.drawBehind {
            drawRect(surface)
            drawRect(Brush.linearGradient(listOf(brand.copy(alpha = 0.10f), Color.Transparent), start = Offset.Zero, end = Offset(size.width, size.height)))
        },
        contentAlignment = Alignment.CenterStart,
    ) {
        Column(Modifier.padding(horizontal = 48.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Wordmark(height = 56.dp)
            Text(stringResource(R.string.access_tagline), style = ObliTypography.body.copy(fontSize = 18.sp, lineHeight = 26.sp), color = c.text2)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// S93 — Ajouter un serveur
// ---------------------------------------------------------------------------------------------

/** S93: adds one more server (same flow as S01); ends on "Passer sur …" / "Rester sur …". */
@Composable
fun AddServerScreen(onDone: () -> Unit, onBack: () -> Unit) {
    val services = LocalObliServices.current
    val vm = viewModel(key = "access-add-server") { SignInViewModel(services, SignInMode.ADD, hasCookiesFor = ::androidHasCookies) }
    val state = vm.state
    val done by rememberUpdatedState(onDone)
    LaunchedEffect(state.finished) { if (state.finished) done() }
    AddServerLayout(state, vm, onBack, rememberClipboardAccess(state.step))
    val probe = state.probe
    if (state.ssoOpen && probe != null) SsoSheet(probe, vm::onSso)
}

@Composable
internal fun AddServerLayout(state: SignInUiState, actions: SignInActions, onBack: () -> Unit, clipboard: ClipboardAccess = ClipboardAccess.None) {
    val c = ObliTheme.colors
    Column(Modifier.fillMaxSize().background(c.bg)) {
        ObliDetailTopBar(
            title = stringResource(R.string.access_add_server_title),
            onBack = onBack,
            backLabel = stringResource(R.string.access_back),
            subtitle = stringResource(R.string.access_add_server_subtitle, (state.serverCount + 1).coerceAtMost(ServerRegistry.MAX_SERVERS), ServerRegistry.MAX_SERVERS),
        )
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val height = maxHeight
            Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                Column(Modifier.widthIn(max = 560.dp).fillMaxWidth().heightIn(min = height).padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 20.dp)) {
                    if (state.step == SignInStep.ADDRESS) {
                        Text(stringResource(R.string.access_add_server_intro), style = ObliTypography.body, color = c.text2, modifier = Modifier.padding(bottom = 16.dp))
                    }
                    SignInBody(state, actions, clipboard = clipboard)
                    Spacer(Modifier.weight(1f))
                    Spacer(Modifier.height(20.dp))
                    SecureFooter()
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// S03 — Session expirée
// ---------------------------------------------------------------------------------------------

/** S03: the session of [serverId] expired (or was signed out); sign in again on that server only. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReauthSheet(serverId: ServerId, onDone: () -> Unit) {
    val c = ObliTheme.colors
    ModalBottomSheet(
        onDismissRequest = onDone,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.surface1,
        dragHandle = { BottomSheetDefaults.DragHandle(color = c.textFaint) },
    ) {
        ReauthContent(serverId, onDone)
    }
}

@Composable
internal fun ReauthContent(serverId: ServerId, onDone: () -> Unit) {
    val services = LocalObliServices.current
    val registry by services.registry.state.collectAsStateWithLifecycle()
    val done by rememberUpdatedState(onDone)
    val profile = registry.byId(serverId)
    if (profile == null) {
        LaunchedEffect(Unit) { done() }
        return
    }
    val session = remember(serverId) { services.sessions.session(serverId) }
    val auth = session?.auth?.collectAsStateWithLifecycle()?.value
    // A fresh flow each time the sheet opens (a finished sign-in must not be reused).
    val nonce = rememberSaveable { UUID.randomUUID().toString() }
    val vm = viewModel(key = "access-reauth-${serverId.value}-$nonce") {
        SignInViewModel(services, SignInMode.REAUTH, fixedOrigin = profile.origin, hasCookiesFor = ::androidHasCookies)
    }
    val state = vm.state
    LaunchedEffect(state.finished) { if (state.finished) done() }
    ReauthBody(profile, registry.isMultiServer, auth == AuthState.SignedOut, state, vm, onLater = onDone, clipboard = rememberClipboardAccess(state.step))
    val probe = state.probe
    if (state.ssoOpen && probe != null) SsoSheet(probe, vm::onSso)
}

@Composable
internal fun ReauthBody(
    profile: ServerProfile,
    multiServer: Boolean,
    signedOut: Boolean,
    state: SignInUiState,
    actions: SignInActions,
    onLater: () -> Unit,
    clipboard: ClipboardAccess = ClipboardAccess.None,
) {
    val c = ObliTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.surface1)
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
    ) {
        val title = when {
            signedOut -> stringResource(R.string.access_reauth_signed_out_title, profile.displayName)
            multiServer -> stringResource(R.string.access_reauth_title_server, profile.displayName)
            else -> stringResource(R.string.access_reauth_title)
        }
        Text(title, style = ObliTypography.dialogTitle, color = c.text, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.access_reauth_body), style = ObliTypography.body, color = c.text2)
        Spacer(Modifier.height(16.dp))
        ServerIdentity(profile, showTile = multiServer, checking = state.busy == Busy.CHECKING && state.probe == null)
        Spacer(Modifier.height(16.dp))
        when (state.step) {
            SignInStep.TWO_FACTOR -> TwoFactorSection(state, actions, cardColor = c.bg, clipboard = clipboard)
            else -> {
                state.problemIn(ProblemArea.ADDRESS)?.let {
                    ErrorLine(problemText(it), Modifier.padding(bottom = 12.dp))
                }
                MethodSection(state, actions, cardColor = c.bg)
            }
        }
        Spacer(Modifier.height(8.dp))
        LinkButton(stringResource(R.string.access_reauth_later), onLater, Modifier.align(Alignment.CenterHorizontally), color = c.text2)
    }
}

/** Tile (2+ servers), name and host of the server being signed in again. */
@Composable
private fun ServerIdentity(profile: ServerProfile, showTile: Boolean, checking: Boolean) {
    val c = ObliTheme.colors
    Row(
        Modifier.fillMaxWidth().clip(ButtonShape).background(c.surface2).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showTile) ObliServerTile(profile.color, profile.monogram, profile.displayName, size = 28.dp)
        Column(Modifier.weight(1f)) {
            Text(profile.displayName, style = ObliTypography.rowTitle, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(ServerNames.hostOf(profile.origin), style = ObliTypography.monoCaption, color = c.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (checking) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = c.text2)
    }
}
