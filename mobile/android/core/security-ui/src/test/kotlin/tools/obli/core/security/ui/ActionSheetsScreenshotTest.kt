package tools.obli.core.security.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind
import tools.obli.core.network.ForbiddenReason
import tools.obli.core.security.ActionEndpoints
import tools.obli.core.security.ActionResult
import tools.obli.core.security.ActionSpec
import tools.obli.core.security.PrivacyUnlockResult
import tools.obli.core.security.Tier

/** Every prompt sheet of the host (S41 per tier, S42, S43, S44, tenant switch) and the result snackbars, phone, French. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class ActionSheetsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private val endpoints = object : ActionEndpoints {
        override suspend fun cancelApproval(approvalId: Long): ApiOutcome<Unit> = ApiOutcome.Ok(Unit)
        override suspend fun unlockPrivacy(feature: String, password: String): PrivacyUnlockResult = PrivacyUnlockResult.Unlocked(900)
    }

    private val service = ActionSpec("device.restart_service", Tier.T1, "Redémarrer le service", "« Spouleur d'impression » sur PC-COMPTA-03", "Obliance Prod › ACME", "Les impressions en cours seront interrompues.")
    private val reboot = ActionSpec("device.reboot", Tier.T2, "Redémarrer", "PC-COMPTA-03", "Obliance Prod › ACME", "Le poste redémarrera immédiatement. 1 utilisateur est connecté (m.durand).")
    private val shutdown = ActionSpec("device.shutdown", Tier.T3, "Éteindre", "SRV-AD2", "Obliance Prod › ACME", "Obliance ne pourra pas le rallumer à distance.")
    private val bulk = ActionSpec("script.run", Tier.T3, "Exécuter « Vider le cache DNS » sur", "12 appareils", "Obliance Prod › ACME", "2 appareils sont hors ligne et resteront en attente.", targetCount = 12)
    private val uninstall = ActionSpec("device.uninstall_agent", Tier.T3, "Désinstaller l'agent", "PC-ATELIER-02", "Obliance Prod › ACME", endpoints = endpoints)
    private val remote = ActionSpec("device.remote", Tier.T1, "Ouvrir un terminal", "MAC-DIRECTION", "Obliance Prod › ACME", endpoints = endpoints)

    /** The sheet as it appears over a screen: scrim, rounded surface1 container, drag handle. */
    @Composable
    private fun Sheet(content: @Composable () -> Unit) = ObliTheme {
        val c = ObliTheme.colors
        Box(Modifier.fillMaxSize().background(c.bg)) {
            Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.32f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(c.surface1),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.padding(vertical = 16.dp).width(32.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.textFaint))
                content()
            }
        }
    }

    private fun capture(name: String, content: @Composable () -> Unit) {
        compose.setContent { Sheet(content) }
        compose.onRoot().captureRoboImage(shot(name))
    }

    private val host = ActionHostState()

    @Test fun t1() = capture("secui_confirm_t1.png") {
        PromptContent(host, ActionPrompt.Confirm(service, strongAuthAvailable = true, accessible = false))
    }

    @Test fun t2() = capture("secui_confirm_t2.png") {
        PromptContent(host, ActionPrompt.Confirm(reboot, strongAuthAvailable = true, accessible = false))
    }

    @Test fun t2NoScreenLock() = capture("secui_confirm_t2_no_lock.png") {
        PromptContent(host, ActionPrompt.Confirm(reboot, strongAuthAvailable = false, accessible = false))
    }

    @Test fun t2BiometricCancelled() = capture("secui_confirm_t2_auth_failed.png") {
        PromptContent(host, ActionPrompt.Confirm(reboot, strongAuthAvailable = true, accessible = false).apply { authFailed = true })
    }

    @Test fun t3Hold() = capture("secui_confirm_t3_hold.png") {
        PromptContent(host, ActionPrompt.Confirm(shutdown, strongAuthAvailable = true, accessible = false))
    }

    @Test fun t3HoldHalfway() = capture("secui_confirm_t3_hold_progress.png") {
        Column(Modifier.padding(20.dp)) { HoldToConfirm("Maintenir 1,5\u00a0s pour confirmer", "Éteindre", enabled = true, onDone = {}, initialProgress = 0.5f) }
    }

    @Test fun t3BulkCount() = capture("secui_confirm_t3_bulk.png") {
        PromptContent(host, ActionPrompt.Confirm(bulk, strongAuthAvailable = true, accessible = false).apply { typedCount = "12" })
    }

    @Test fun t3Accessible() = capture("secui_confirm_t3_accessible.png") {
        PromptContent(host, ActionPrompt.Confirm(uninstall, strongAuthAvailable = true, accessible = true))
    }

    @Test fun t3AccessibleArmed() = capture("secui_confirm_t3_accessible_armed.png") {
        PromptContent(host, ActionPrompt.Confirm(uninstall, strongAuthAvailable = true, accessible = true).apply { armed = true })
    }

    @Test fun twoFactor() = capture("secui_2fa.png") {
        PromptContent(host, ActionPrompt.TwoFactor(reboot, "92.184.107.21", previousWasWrong = false).apply { code = "4829" })
    }

    @Test fun twoFactorWrongCode() = capture("secui_2fa_wrong.png") {
        PromptContent(host, ActionPrompt.TwoFactor(reboot, "92.184.107.21", previousWasWrong = true).apply { trustIp = true })
    }

    @Test fun approvalSent() = capture("secui_approval_sent.png") {
        PromptContent(host, ActionPrompt.ApprovalSent(uninstall, 41))
    }

    @Test fun approvalCancelled() = capture("secui_approval_cancelled.png") {
        PromptContent(host, ActionPrompt.ApprovalSent(uninstall, 41).apply { cancel = ActionPrompt.CancelState.CANCELLED })
    }

    @Test fun privacyUnlock() = capture("secui_privacy.png") {
        PromptContent(host, ActionPrompt.PrivacyUnlock(remote, "remote", passwordSet = false))
    }

    @Test fun privacyWrongPassword() = capture("secui_privacy_wrong.png") {
        PromptContent(host, ActionPrompt.PrivacyUnlock(remote, "remote", passwordSet = false).apply { error = PrivacyUnlockResult.WrongPassword })
    }

    @Test fun privacyAdminOnly() = capture("secui_privacy_admin_only.png") {
        PromptContent(host, ActionPrompt.PrivacyUnlock(remote, "scripts", passwordSet = false).apply { error = PrivacyUnlockResult.NoPasswordSet })
    }

    @Test fun tenantSwitch() = capture("secui_tenant_switch.png") {
        PromptContent(host, ActionPrompt.TenantSwitch(reboot.copy(scope = "Obliance Prod › Default"), "ACME"))
    }

    @Test fun resultSnackbars() {
        val res = ApplicationProvider.getApplicationContext<android.content.Context>().resources
        val results = listOf(
            ActionMessages.describe(res, ActionResult.Done(Unit), "Redémarrage demandé pour SRV-AD2")!!,
            ActionMessages.describe(res, ActionResult.AwaitingApproval(41), "")!!,
            ActionMessages.describe(res, ActionResult.Failed(ApiOutcome.Forbidden(ForbiddenReason.CAPABILITY, "Capability 'power' not permitted for your team", "power")), "")!!,
            ActionMessages.describe(res, ActionResult.Failed(ApiOutcome.Unsupported("legacy")), "")!!,
            ActionMessages.describe(res, ActionResult.Failed(ApiOutcome.AgentOffline("Agent is offline")), "")!!,
            ActionMessages.describe(res, ActionResult.Failed(ApiOutcome.Failure(null, FailureKind.NETWORK)), "")!!,
        )
        assertEquals("Votre équipe n'a pas le droit « Alimentation » sur cet appareil.", results[2].text)
        compose.setContent {
            ObliTheme {
                Column(Modifier.fillMaxSize().background(ObliTheme.colors.bg).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Résultats d'action", style = ObliTypography.cardTitle, color = ObliTheme.colors.text)
                    results.forEach { ActionSnackbar(ActionSnackbarVisuals(it)) }
                }
            }
        }
        compose.onRoot().captureRoboImage(shot("secui_results.png"))
    }
}
