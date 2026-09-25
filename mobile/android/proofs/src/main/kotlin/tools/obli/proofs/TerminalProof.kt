package tools.obli.proofs

import android.os.Looper
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import org.connectbot.terminal.Terminal
import org.connectbot.terminal.TerminalEmulator
import org.connectbot.terminal.TerminalEmulatorFactory
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.toColor

/** Proof 1: termlib's emulator + Compose renderer, fed by the tunnel bytes. */
fun createOperatorTerminal(onInput: (ByteArray) -> Unit): TerminalEmulator =
    TerminalEmulatorFactory.create(
        looper = Looper.getMainLooper(),
        initialRows = 24,
        initialCols = 80,
        defaultForeground = ObliTokens.operator.text.toColor(),
        defaultBackground = Color(0xFF0B0D1A),
        onKeyboardInput = onInput,
    )

@Composable
fun OperatorTerminal(output: ByteArray, onInput: (ByteArray) -> Unit, modifier: Modifier = Modifier) {
    val emulator = remember { createOperatorTerminal(onInput) }
    remember(output) { emulator.writeInput(output, 0, output.size) }
    Terminal(
        terminalEmulator = emulator,
        modifier = modifier.fillMaxSize(),
        backgroundColor = Color(0xFF0B0D1A),
        foregroundColor = ObliTokens.operator.text.toColor(),
        keyboardEnabled = true,
    )
}
