package tools.obli.obliance.remote

import android.graphics.Typeface
import android.os.Looper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.res.ResourcesCompat
import org.connectbot.terminal.ModifierManager
import org.connectbot.terminal.Terminal
import org.connectbot.terminal.TerminalEmulator
import org.connectbot.terminal.TerminalEmulatorFactory
import org.connectbot.terminal.VTermKey
import tools.obli.core.designsystem.ObliTypography

/** Terminal theme « Obli Operator » (design doc §8.8). */
internal object TermColors {
    val background = Color(0xFF080A14)
    val foreground = Color(0xFFD6DCEB)
    val cursor = Color(0xFFFF6868)

    /** ANSI 0–15: black, red, green, yellow, blue, magenta, cyan, white, then the bright ones. */
    val ansi: IntArray = longArrayOf(
        0xFF5A6285, 0xFFF87171, 0xFF4ADE80, 0xFFFACC15, 0xFF60A5FA, 0xFFC084FC, 0xFF22D3EE, 0xFFB4BCD7,
        0xFF7C86A8, 0xFFFF8A8A, 0xFF86EFAC, 0xFFFDE68A, 0xFF93C5FD, 0xFFD8B4FE, 0xFF67E8F9, 0xFFF0F4FC,
    ).map { it.toInt() }.toIntArray()
}

/**
 * Sticky Ctrl / Alt of the key bar (design doc §5 S60): one tap = next key,
 * long press = locked until tapped again. It is also the emulator's
 * [ModifierManager], so the soft keyboard's next letter gets the modifier.
 */
internal class StickyModifiers : ModifierManager {
    enum class Latch { OFF, ONCE, LOCKED }

    var ctrl by mutableStateOf(Latch.OFF)
    var alt by mutableStateOf(Latch.OFF)

    fun tap(current: Latch): Latch = if (current == Latch.OFF) Latch.ONCE else Latch.OFF

    val mods: Mods get() = Mods(ctrl = ctrl != Latch.OFF, alt = alt != Latch.OFF)

    override fun isCtrlActive(): Boolean = ctrl != Latch.OFF
    override fun isAltActive(): Boolean = alt != Latch.OFF
    override fun isShiftActive(): Boolean = false

    override fun clearTransients() {
        if (ctrl == Latch.ONCE) ctrl = Latch.OFF
        if (alt == Latch.ONCE) alt = Latch.OFF
    }
}

/**
 * What a terminal screen needs from an emulator (design doc §10.9 SPI):
 * bytes in, keystrokes out through [onInput], size changes through [onResize].
 */
internal interface TerminalEngine {
    /** Output of the shell (any thread). */
    fun feed(bytes: ByteArray)

    /** A key of the key bar, with the latched modifiers (the emulator encodes it, DECCKM included). */
    fun key(key: TermKey, mods: Mods)

    /** Characters of the key bar (`|`, `~`, `^C`…) with the latched modifiers applied to the first one. */
    fun text(text: String, mods: Mods)

    /** Clipboard text (bracketed paste when the shell asked for it). */
    fun paste(text: String)

    @Composable
    fun Render(modifier: Modifier, modifiers: StickyModifiers, showSoftKeyboard: Boolean, description: String)

    val isNative: Boolean
}

/** The native emulator: org.connectbot:termlib 0.2.1 (libvterm + Compose renderer, phase 0 proof P3). */
internal class TermlibEngine(
    onInput: (ByteArray) -> Unit,
    onResize: (cols: Int, rows: Int) -> Unit,
) : TerminalEngine {
    private val emulator: TerminalEmulator = TerminalEmulatorFactory.create(
        looper = Looper.getMainLooper(),
        initialRows = 24,
        initialCols = 80,
        defaultForeground = TermColors.foreground,
        defaultBackground = TermColors.background,
        onKeyboardInput = onInput,
        onResize = { d -> onResize(d.columns, d.rows) },
    ).also { it.setAnsiPalette(TermColors.ansi) }

    override val isNative = true

    override fun feed(bytes: ByteArray) = emulator.writeInput(bytes, 0, bytes.size)

    override fun key(key: TermKey, mods: Mods) = emulator.dispatchKey(mods.mask, vterm(key))

    override fun text(text: String, mods: Mods) {
        var first = true
        text.codePoints().forEach { cp ->
            emulator.dispatchCharacter(if (first) mods.mask else 0, cp)
            first = false
        }
    }

    override fun paste(text: String) = emulator.pasteText(text)

    @Composable
    override fun Render(modifier: Modifier, modifiers: StickyModifiers, showSoftKeyboard: Boolean, description: String) {
        val context = LocalContext.current
        val typeface = remember {
            runCatching { ResourcesCompat.getFont(context, tools.obli.core.designsystem.R.font.jetbrainsmono_regular) }.getOrNull() ?: Typeface.MONOSPACE
        }
        Terminal(
            terminalEmulator = emulator,
            modifier = modifier.semantics { contentDescription = description },
            typeface = typeface,
            initialFontSize = 13.sp,
            minFontSize = 10.sp,
            maxFontSize = 20.sp,
            backgroundColor = TermColors.background,
            foregroundColor = TermColors.foreground,
            selectionBackgroundColor = TermColors.cursor.copy(alpha = 0.30f),
            selectionForegroundColor = TermColors.foreground,
            keyboardEnabled = true,
            showSoftKeyboard = showSoftKeyboard,
            modifierManager = modifiers,
        )
    }

    private fun vterm(key: TermKey): Int = when (key) {
        TermKey.ESCAPE -> VTermKey.ESCAPE
        TermKey.TAB -> VTermKey.TAB
        TermKey.ENTER -> VTermKey.ENTER
        TermKey.BACKSPACE -> VTermKey.BACKSPACE
        TermKey.UP -> VTermKey.UP
        TermKey.DOWN -> VTermKey.DOWN
        TermKey.LEFT -> VTermKey.LEFT
        TermKey.RIGHT -> VTermKey.RIGHT
        TermKey.HOME -> VTermKey.HOME
        TermKey.END -> VTermKey.END
        TermKey.PAGE_UP -> VTermKey.PAGEUP
        TermKey.PAGE_DOWN -> VTermKey.PAGEDOWN
        TermKey.INSERT -> VTermKey.INS
        TermKey.DELETE -> VTermKey.DEL
        else -> VTermKey.FUNCTION_0 + (key.ordinal - TermKey.F1.ordinal + 1)
    }
}

/**
 * Plain-text engine: the transcript of the shell and a line editor. Used when
 * the native library cannot load (JVM tests and screenshots, unsupported
 * ABI); keys are encoded like the web's key bar.
 */
internal class TranscriptEngine(
    private val transcript: Transcript,
    private val onInput: (ByteArray) -> Unit,
) : TerminalEngine {
    override val isNative = false
    private var revision by mutableIntStateOf(0)

    override fun feed(bytes: ByteArray) {
        // The session already feeds the transcript; only refresh the view.
        revision++
    }

    fun refresh() {
        revision++
    }

    override fun key(key: TermKey, mods: Mods) = send(KeySequences.of(key, mods, applicationCursor = null))

    override fun text(text: String, mods: Mods) = send(KeySequences.text(text, mods))

    override fun paste(text: String) = send(text)

    private fun send(s: String) {
        if (s.isNotEmpty()) onInput(s.toByteArray(Charsets.UTF_8))
    }

    @Composable
    override fun Render(modifier: Modifier, modifiers: StickyModifiers, showSoftKeyboard: Boolean, description: String) {
        val lines = remember(revision) { transcript.lines() }
        TranscriptView(lines, modifier.semantics { contentDescription = description }) { typed ->
            val mods = modifiers.mods
            text(typed, mods)
            modifiers.clearTransients()
        }
    }
}

/** Monospace view of terminal lines (bottom-anchored), with an input line for the fallback engine. */
@Composable
internal fun TranscriptView(lines: List<String>, modifier: Modifier = Modifier, onType: ((String) -> Unit)? = null) {
    val listState = rememberLazyListState()
    LaunchedEffect(lines.size) { if (lines.isNotEmpty()) listState.scrollToItem(lines.lastIndex) }
    Column(modifier.fillMaxSize().background(TermColors.background)) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp), state = listState) {
            item { Box(Modifier.height(10.dp)) }
            items(lines) { line ->
                Text(
                    line,
                    style = ObliTypography.terminal,
                    color = TermColors.foreground,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Clip,
                )
            }
        }
        if (onType != null) {
            var value by remember { mutableStateOf("") }
            BasicTextField(
                value = value,
                onValueChange = { next ->
                    // Forward only what was added; the shell echoes it.
                    if (next.length > value.length && next.startsWith(value)) onType(next.substring(value.length))
                    value = next.takeLast(64)
                },
                textStyle = ObliTypography.terminal.copy(color = Color.Transparent),
                cursorBrush = SolidColor(Color.Transparent),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Send,
                ),
                keyboardActions = KeyboardActions(onSend = { onType("\r"); value = "" }),
                modifier = Modifier.fillMaxWidth().height(1.dp),
            )
        }
    }
}
