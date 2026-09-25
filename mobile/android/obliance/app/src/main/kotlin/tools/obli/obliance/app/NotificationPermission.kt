package tools.obli.obliance.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.obliance.remote.RemoteAccess

/**
 * Android 13+: the foreground-service notification of remote sessions (« 2
 * sessions actives … Tout terminer », design doc §2.6) needs POST_NOTIFICATIONS.
 * Asked ONCE, when the first remote session opens (the moment it matters),
 * after a short rationale; "Plus tard" also counts as asked. The sessions work
 * without it (Android only hides the notification).
 */
@Composable
internal fun NotificationPermissionPrompt() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || LocalInspectionMode.current) return
    val context = LocalContext.current
    val live by RemoteAccess.liveSessions.collectAsStateWithLifecycle()
    var asked by rememberSaveable { mutableStateOf(NotificationPrefs.asked(context)) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    if (asked || granted || live.isEmpty()) return

    fun done(request: Boolean) {
        NotificationPrefs.markAsked(context)
        asked = true
        if (request) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    val c = ObliTheme.colors
    AlertDialog(
        onDismissRequest = { done(request = false) },
        containerColor = c.surface1,
        titleContentColor = c.text,
        textContentColor = c.textMuted,
        title = { Text(stringResource(R.string.app_notifications_title), style = ObliTypography.dialogTitle) },
        text = { Text(stringResource(R.string.app_notifications_body), style = ObliTypography.body) },
        confirmButton = {
            TextButton(onClick = { done(request = true) }, colors = ButtonDefaults.textButtonColors(contentColor = c.accent2)) {
                Text(stringResource(R.string.app_notifications_allow))
            }
        },
        dismissButton = {
            TextButton(onClick = { done(request = false) }, colors = ButtonDefaults.textButtonColors(contentColor = c.textMuted)) {
                Text(stringResource(R.string.app_notifications_later))
            }
        },
    )
}

private object NotificationPrefs {
    private const val FILE = "obli_next_prompts"
    private const val KEY = "notifications_asked"

    fun asked(context: Context): Boolean = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun markAsked(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit { putBoolean(KEY, true) }
}
