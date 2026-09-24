package tools.obli.shell.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import tools.obli.shell.R
import tools.obli.shell.ui.ConfirmDialog

@Composable
fun SettingsScreen(state: SettingsState, actions: SettingsActions) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            actions.messageShown()
        }
    }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize().safeDrawingPadding()) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = actions::back) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
                    }
                    Text(
                        stringResource(R.string.settings_title),
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                }
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Column(Modifier.widthIn(max = 640.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Section(stringResource(R.string.settings_section_server)) {
                            InfoRow(
                                stringResource(R.string.settings_server),
                                state.serverUrl ?: stringResource(R.string.settings_server_none),
                            )
                            TextButton(onClick = actions::changeServer, modifier = Modifier.padding(start = 8.dp)) {
                                Text(stringResource(if (state.serverUrl == null) R.string.settings_server_configure else R.string.settings_server_change))
                            }
                        }
                        Section(stringResource(R.string.settings_section_notifications)) {
                            SwitchRow(
                                title = stringResource(R.string.settings_alerts),
                                summary = stringResource(R.string.settings_alerts_summary),
                                checked = state.alertsEnabled,
                                onChange = actions::setAlerts,
                            )
                            if (state.alertsEnabled && !state.notificationsAllowed) {
                                Text(
                                    stringResource(R.string.settings_alerts_blocked),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                    modifier = Modifier.padding(horizontal = 16.dp),
                                )
                                TextButton(onClick = actions::openNotificationSettings, modifier = Modifier.padding(start = 8.dp)) {
                                    Text(stringResource(R.string.settings_open_notification_settings))
                                }
                            }
                        }
                        Section(stringResource(R.string.settings_section_security)) {
                            SwitchRow(
                                title = stringResource(R.string.settings_lock),
                                summary = stringResource(
                                    if (state.lockAvailable) R.string.settings_lock_summary else R.string.settings_lock_unavailable,
                                ),
                                checked = state.lockEnabled,
                                onChange = actions::setLock,
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            SwitchRow(
                                title = stringResource(R.string.settings_screenshots),
                                summary = stringResource(R.string.settings_screenshots_summary),
                                checked = state.blockScreenshots,
                                onChange = actions::setBlockScreenshots,
                            )
                        }
                        Section(stringResource(R.string.settings_section_maintenance)) {
                            ActionRow(
                                title = stringResource(R.string.settings_check_updates),
                                summary = stringResource(R.string.settings_check_updates_summary),
                                busy = state.checkingUpdate,
                                onClick = actions::checkForUpdates,
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            ActionRow(
                                title = stringResource(R.string.settings_clear_cache),
                                summary = stringResource(R.string.settings_clear_cache_summary),
                                busy = false,
                                onClick = actions::clearCache,
                            )
                        }
                        Section(stringResource(R.string.settings_section_about)) {
                            InfoRow(stringResource(R.string.settings_about_app), state.appVersion)
                            InfoRow(stringResource(R.string.settings_about_webview), state.webViewVersion ?: stringResource(R.string.unknown))
                            InfoRow(stringResource(R.string.settings_server), state.serverUrl ?: stringResource(R.string.settings_server_none))
                            state.obligateOrigin?.let { InfoRow(stringResource(R.string.settings_about_sso), it) }
                        }
                        Spacer(Modifier.size(24.dp))
                    }
                }
            }
            SnackbarHost(snackbar, modifier = Modifier.align(Alignment.BottomCenter))
        }
    }
    if (state.confirmChangeServer) {
        ConfirmDialog(
            title = stringResource(R.string.settings_change_server_title),
            body = stringResource(R.string.settings_change_server_body),
            confirmLabel = stringResource(R.string.settings_server_change),
            onConfirm = actions::confirmChangeServer,
            onDismiss = actions::dismissChangeServer,
        )
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(start = 4.dp),
        )
        Surface(color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.large) {
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) { content() }
        }
    }
}

@Composable
private fun InfoRow(title: String, value: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SwitchRow(title: String, summary: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Switch) { onChange(!checked) }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
            Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.size(12.dp))
        Switch(checked = checked, onCheckedChange = null)
    }
}

@Composable
private fun ActionRow(title: String, summary: String, busy: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = !busy, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
            Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (busy) CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
    }
}
