package tools.obli.obliance.more

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import java.time.Duration
import java.time.LocalTime
import kotlinx.coroutines.delay
import tools.obli.core.designsystem.ObliThemeVariant

/**
 * Which theme the app wears (design doc §2.10 "Thème du serveur", S83
 * "Apparence"). Pure: the caller passes the clock.
 *
 * - "Nuit automatique" wins from 22:00 (included) to 07:00 (excluded).
 * - Otherwise FOLLOW_SERVER wears the active server's web theme, OPERATOR and
 *   NIGHT ignore the server.
 */
object ThemeResolver {
    val NIGHT_START: LocalTime = LocalTime.of(22, 0)
    val NIGHT_END: LocalTime = LocalTime.of(7, 0)

    fun resolve(mode: ThemeMode, autoNight: Boolean, serverVariant: ObliThemeVariant, now: LocalTime): ObliThemeVariant {
        if (autoNight && isNight(now)) return ObliThemeVariant.NIGHT
        return when (mode) {
            ThemeMode.FOLLOW_SERVER -> serverVariant
            ThemeMode.OPERATOR -> ObliThemeVariant.OPERATOR
            ThemeMode.NIGHT -> ObliThemeVariant.NIGHT
        }
    }

    /** [22:00, 07:00): the window wraps around midnight. */
    fun isNight(now: LocalTime): Boolean = !now.isBefore(NIGHT_START) || now.isBefore(NIGHT_END)

    /** Time until the next 22:00 or 07:00 boundary (at least one second), to re-resolve then. */
    fun untilNextBoundary(now: LocalTime): Duration {
        fun until(target: LocalTime): Duration {
            val d = Duration.between(now, target)
            return if (d.isNegative || d.isZero) d.plusDays(1) else d
        }
        val next = minOf(until(NIGHT_START), until(NIGHT_END))
        return if (next < Duration.ofSeconds(1)) Duration.ofSeconds(1) else next
    }
}

/**
 * The theme to pass to `ObliTheme(variant = …)`: [serverVariant] (the active
 * server's web theme) resolved with this phone's S83 choice. While "Nuit
 * automatique" is on, it is re-evaluated at 22:00 and 07:00 and each time the
 * app comes back to the foreground (a sleeping phone may miss the timer).
 */
@Composable
fun rememberAppTheme(serverVariant: ObliThemeVariant): ObliThemeVariant {
    val context = LocalContext.current
    val store = remember(context) { AppSettings.store(context) }
    val prefs by store.prefs.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val autoNight = prefs.autoNight
    val now by produceState(LocalTime.now(), autoNight, lifecycle) {
        value = LocalTime.now()
        if (!autoNight) return@produceState
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                value = LocalTime.now()
                delay(ThemeResolver.untilNextBoundary(value).toMillis() + 500)
            }
        }
    }
    return ThemeResolver.resolve(prefs.themeMode, autoNight, serverVariant, now)
}
