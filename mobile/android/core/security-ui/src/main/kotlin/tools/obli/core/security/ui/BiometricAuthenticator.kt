package tools.obli.core.security.ui

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import tools.obli.core.security.ActionSpec

/**
 * [StrongAuthenticator] on androidx.biometric: BIOMETRIC_STRONG or the device
 * credential (PIN, pattern, password). The prompt's title is the action and
 * its subtitle names the target and the scope ("SRV-AD2 · Obliance Prod ›
 * ACME"), so what is being authorised is visible in the system dialog too.
 */
class BiometricAuthenticator(private val activity: FragmentActivity) : StrongAuthenticator {
    override fun isAvailable(): Boolean =
        BiometricManager.from(activity).canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS

    override suspend fun authenticate(spec: ActionSpec): Boolean = withContext(Dispatchers.Main.immediate) {
        suspendCancellableCoroutine { cont ->
            val prompt = BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (cont.isActive) cont.resume(true)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (cont.isActive) cont.resume(false)
                    }
                    // onAuthenticationFailed (a finger not recognised) is not final: the prompt stays.
                },
            )
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(spec.title)
                .setSubtitle(subtitleOf(spec))
                .setAllowedAuthenticators(authenticators())
                .setConfirmationRequired(true)
                .build()
            cont.invokeOnCancellation { runCatching { prompt.cancelAuthentication() } }
            try {
                prompt.authenticate(info)
            } catch (_: RuntimeException) {
                if (cont.isActive) cont.resume(false)
            }
        }
    }

    companion object {
        /** "SRV-AD2 · Obliance Prod › ACME": target and scope, as on the sheet. */
        fun subtitleOf(spec: ActionSpec): String = listOf(spec.target, spec.scope).filter { it.isNotBlank() }.joinToString(" · ")

        /** API 28–29 cannot combine BIOMETRIC_STRONG with the device credential. */
        fun authenticators(): Int =
            if (Build.VERSION.SDK_INT == Build.VERSION_CODES.P || Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
                BIOMETRIC_WEAK or DEVICE_CREDENTIAL
            } else {
                BIOMETRIC_STRONG or DEVICE_CREDENTIAL
            }
    }
}
