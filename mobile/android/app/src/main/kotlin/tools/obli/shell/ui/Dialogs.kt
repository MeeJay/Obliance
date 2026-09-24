package tools.obli.shell.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import tools.obli.shell.R
import tools.obli.shell.update.UpdateManifest
import tools.obli.shell.web.JsDialogRequest

/** alert / confirm / prompt / beforeunload as Material dialogs. */
@Composable
fun JsDialog(request: JsDialogRequest, onDone: () -> Unit) {
    var input by remember(request) { mutableStateOf((request as? JsDialogRequest.Prompt)?.defaultValue.orEmpty()) }
    val title = when (request) {
        is JsDialogRequest.BeforeUnload -> stringResource(R.string.js_leave_title)
        else -> request.host?.let { stringResource(R.string.js_dialog_title, it) } ?: stringResource(R.string.app_name)
    }
    fun cancel() {
        when (request) {
            is JsDialogRequest.Prompt -> request.result.cancel()
            is JsDialogRequest.Alert -> request.result.confirm()
            is JsDialogRequest.Confirm -> request.result.cancel()
            is JsDialogRequest.BeforeUnload -> request.result.cancel()
        }
        onDone()
    }
    fun confirm() {
        when (request) {
            is JsDialogRequest.Prompt -> request.result.confirm(input)
            is JsDialogRequest.Alert -> request.result.confirm()
            is JsDialogRequest.Confirm -> request.result.confirm()
            is JsDialogRequest.BeforeUnload -> request.result.confirm()
        }
        onDone()
    }
    AlertDialog(
        onDismissRequest = { cancel() },
        title = { Text(title) },
        text = {
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                if (request.message.isNotEmpty()) Text(request.message)
                if (request is JsDialogRequest.Prompt) {
                    OutlinedTextField(
                        value = input,
                        onValueChange = { input = it },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { confirm() }) {
                Text(stringResource(if (request is JsDialogRequest.BeforeUnload) R.string.js_leave else R.string.action_ok))
            }
        },
        dismissButton = if (request is JsDialogRequest.Alert) null else {
            { TextButton(onClick = { cancel() }) { Text(stringResource(if (request is JsDialogRequest.BeforeUnload) R.string.js_stay else R.string.action_cancel)) } }
        },
    )
}

/** Update offer with release notes. A required update cannot be postponed by tapping outside. */
@Composable
fun UpdateDialog(manifest: UpdateManifest, required: Boolean, onDownload: () -> Unit, onLater: () -> Unit) {
    AlertDialog(
        onDismissRequest = { if (!required) onLater() },
        properties = DialogProperties(dismissOnBackPress = !required, dismissOnClickOutside = !required),
        title = { Text(stringResource(R.string.update_available_title)) },
        text = {
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.update_available_body, manifest.versionName))
                if (required) {
                    Text(stringResource(R.string.update_required), color = MaterialTheme.colorScheme.error)
                }
                manifest.releaseNotes?.let {
                    Text(stringResource(R.string.update_release_notes), style = MaterialTheme.typography.titleSmall)
                    Text(it, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = { TextButton(onClick = onDownload) { Text(stringResource(R.string.update_download)) } },
        dismissButton = { TextButton(onClick = onLater) { Text(stringResource(R.string.update_later)) } },
    )
}

@Composable
fun ConfirmDialog(title: String, body: String, confirmLabel: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
