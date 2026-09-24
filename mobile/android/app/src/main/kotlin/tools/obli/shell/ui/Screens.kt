package tools.obli.shell.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import tools.obli.shell.R

/** State of the setup screen (owned by the activity, survives recomposition). */
class SetupState(initialUrl: String) {
    var url by mutableStateOf(initialUrl)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    /** True when a server is already configured (the screen can be cancelled). */
    var cancellable by mutableStateOf(false)
}

@Composable
private fun FullScreen(content: @Composable () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) { content() }
        }
    }
}

@Composable
private fun Brand(subtitle: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            painter = painterResource(R.drawable.ic_brand_mark),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(40.dp),
        )
        Spacer(Modifier.size(12.dp))
        Column {
            Text(
                stringResource(R.string.app_name),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun SetupScreen(state: SetupState, onSubmit: () -> Unit, onCancel: () -> Unit, onOpenSettings: () -> Unit) {
    FullScreen {
        Brand(stringResource(R.string.setup_subtitle))
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.setup_title), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
        OutlinedTextField(
            value = state.url,
            onValueChange = { state.url = it; state.error = null },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.setup_url_label)) },
            placeholder = { Text(stringResource(R.string.setup_url_placeholder)) },
            singleLine = true,
            enabled = !state.busy,
            isError = state.error != null,
            supportingText = state.error?.let { err -> { Text(err) } },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onGo = { if (!state.busy) onSubmit() }),
        )
        Surface(color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.medium) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(stringResource(R.string.setup_https_title), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                Text(stringResource(R.string.setup_https_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = onSubmit, enabled = !state.busy) {
                if (state.busy) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.size(8.dp))
                    Text(stringResource(R.string.setup_checking))
                } else {
                    Text(stringResource(R.string.setup_connect))
                }
            }
            if (state.cancellable) {
                OutlinedButton(onClick = onCancel, enabled = !state.busy) { Text(stringResource(R.string.action_cancel)) }
            }
        }
        TextButton(onClick = onOpenSettings) { Text(stringResource(R.string.settings_title)) }
    }
}

/** A main-frame load failure. */
data class LoadError(
    val url: String,
    val host: String?,
    val description: String?,
    val ssl: Boolean,
    /** The failing host is the SSO server: offer the local login form. */
    val ssoHost: Boolean,
)

@Composable
fun ErrorScreen(error: LoadError, onRetry: () -> Unit, onSettings: () -> Unit, onLocalLogin: () -> Unit) {
    FullScreen {
        Brand(stringResource(R.string.error_subtitle))
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(if (error.ssl) R.string.error_ssl_title else R.string.error_title),
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            stringResource(if (error.ssl) R.string.error_ssl_body else R.string.error_body, error.host ?: error.url),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        error.description?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
        if (error.ssoHost) {
            Surface(color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.medium) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.error_sso_title), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                    Text(stringResource(R.string.error_sso_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = onLocalLogin) { Text(stringResource(R.string.error_sso_local_login)) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onRetry) { Text(stringResource(R.string.action_retry)) }
            OutlinedButton(onClick = onSettings) { Text(stringResource(R.string.settings_title)) }
        }
    }
}

/** Why the WebView warning is shown. */
data class WebViewWarning(val packageName: String?, val versionName: String?, val bridgeMissing: Boolean)

@Composable
fun WebViewWarningScreen(warning: WebViewWarning, onUpdate: () -> Unit, onContinue: () -> Unit) {
    FullScreen {
        Brand(stringResource(R.string.webview_subtitle))
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.webview_title), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
        Text(
            stringResource(
                if (warning.bridgeMissing) R.string.webview_body_features else R.string.webview_body_old,
                warning.versionName ?: stringResource(R.string.unknown),
            ),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onUpdate) { Text(stringResource(R.string.webview_update)) }
            OutlinedButton(onClick = onContinue) { Text(stringResource(R.string.webview_continue)) }
        }
    }
}

@Composable
fun LockScreen(onUnlock: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_lock),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(56.dp),
            )
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.lock_title, stringResource(R.string.app_name)),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            Button(onClick = onUnlock) { Text(stringResource(R.string.lock_unlock)) }
        }
    }
}
