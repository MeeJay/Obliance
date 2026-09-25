package tools.obli.obliance.more

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import java.util.WeakHashMap

/**
 * Blocks screenshots and screen recording of the host activity's window
 * (`FLAG_SECURE`) while [block] is true (S83 "Bloquer les captures d'écran
 * partout", design doc §10.10). Several holders may be active at once: the
 * flag is set by the first one and cleared by the last one, and a flag that
 * was already on before the first holder (another screen set it) is never
 * cleared from here.
 */
@Composable
fun SecureWindow(block: Boolean) {
    val window = LocalContext.current.findActivity()?.window
    DisposableEffect(window, block) {
        if (!block || window == null) return@DisposableEffect onDispose { }
        SecureFlags.acquire(window)
        onDispose { SecureFlags.release(window) }
    }
}

/** Per-window holders of FLAG_SECURE set from this module. */
internal object SecureFlags {
    private class Hold(var count: Int, val wasSetBefore: Boolean)

    private val holds = WeakHashMap<Window, Hold>()

    @Synchronized
    fun acquire(window: Window) {
        val hold = holds[window]
        if (hold != null) {
            hold.count++
            return
        }
        val already = window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
        holds[window] = Hold(1, already)
        if (!already) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    @Synchronized
    fun release(window: Window) {
        val hold = holds[window] ?: return
        hold.count--
        if (hold.count > 0) return
        holds.remove(window)
        if (!hold.wasSetBefore) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}

internal tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
