package tools.obli.obliance.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import tools.obli.core.auth.AuthState
import tools.obli.core.designsystem.ObliThemeVariant
import tools.obli.obliance.data.ObliServices

/**
 * The app wears the theme the user picked on the ACTIVE server's web client
 * (design doc §2.10, §8.2): prod in Obli Operator, dev in Neon UI… The theme
 * comes from `preferences.preferredTheme` of GET /api/auth/me and is remembered
 * in the server profile, so a cold start shows the right colours at once.
 */
@Composable
fun rememberActiveServerTheme(services: ObliServices): ObliThemeVariant {
    val registry by services.registry.state.collectAsStateWithLifecycle()
    val active by services.sessions.active.collectAsStateWithLifecycle()
    LaunchedEffect(active) {
        val session = active ?: return@LaunchedEffect
        session.auth.collect { state ->
            if (state is AuthState.SignedIn) {
                val theme = state.probe.user.preferredTheme
                if (services.registry.state.value.byId(session.id)?.theme != theme) {
                    services.registry.setTheme(session.id, theme)
                }
            }
        }
    }
    return ObliThemeVariant.fromServerTheme(registry.active?.theme)
}
