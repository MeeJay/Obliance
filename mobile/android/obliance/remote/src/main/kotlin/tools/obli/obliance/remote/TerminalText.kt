package tools.obli.obliance.remote

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CharsetDecoder
import java.nio.charset.CodingErrorAction

/**
 * Incremental UTF-8 decoder: the relay forwards the agent's frames as they
 * come (up to 4 096 bytes) and a multi-byte character may be split across two
 * frames. Incomplete trailing bytes are kept for the next [decode]; invalid
 * sequences become U+FFFD instead of breaking the stream.
 */
internal class Utf8Stream {
    private val decoder: CharsetDecoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPLACE)
        .onUnmappableCharacter(CodingErrorAction.REPLACE)
    private var pending = ByteArray(0)

    @Synchronized
    fun decode(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): String {
        val input = ByteBuffer.allocate(pending.size + length)
        input.put(pending).put(bytes, offset, length).flip()
        val out = CharBuffer.allocate(input.remaining() + 2)
        decoder.decode(input, out, false)
        pending = ByteArray(input.remaining()).also { input.get(it) }
        out.flip()
        return out.toString()
    }
}

/**
 * Plain-text view of what the shell printed (ANSI/VT sequences removed, `\r`
 * and backspace applied to the current line), bounded to [maxLines]. Used for
 * the last-line preview of the sessions list and as the fallback renderer when
 * the native emulator is unavailable (JVM tests, unsupported ABI).
 */
internal class Transcript(private val maxLines: Int = 2_000) {
    private val utf8 = Utf8Stream()
    private val lines = ArrayDeque<String>()
    private val current = StringBuilder()
    private var column = 0
    private var state = State.TEXT

    private enum class State { TEXT, ESC, CSI, OSC, OSC_ESC, CHARSET }

    @Synchronized
    fun feed(bytes: ByteArray) = feedText(utf8.decode(bytes))

    @Synchronized
    fun feedText(text: String) {
        for (ch in text) {
            when (state) {
                State.TEXT -> when (ch) {
                    '\u001B' -> state = State.ESC
                    '\n' -> newLine()
                    '\r' -> column = 0
                    '\b' -> if (column > 0) column--
                    '\t' -> repeat(8 - column % 8) { put(' ') }
                    '\u0007' -> Unit
                    else -> if (ch >= ' ' || ch == ' ') put(ch)
                }
                State.ESC -> state = when (ch) {
                    '[' -> State.CSI
                    ']' -> State.OSC
                    '(', ')', '*', '+' -> State.CHARSET
                    else -> State.TEXT
                }
                State.CSI -> {
                    if (ch in '@'..'~') {
                        // Erase in line (EL 0/2) is the only sequence worth honouring in plain text.
                        if (ch == 'K') current.setLength(column.coerceAtMost(current.length))
                        state = State.TEXT
                    }
                }
                State.OSC -> when (ch) {
                    '\u0007' -> state = State.TEXT
                    '\u001B' -> state = State.OSC_ESC
                }
                State.OSC_ESC -> state = if (ch == '\\') State.TEXT else State.OSC
                State.CHARSET -> state = State.TEXT
            }
        }
    }

    private fun put(ch: Char) {
        if (column < current.length) current.setCharAt(column, ch) else {
            while (current.length < column) current.append(' ')
            current.append(ch)
        }
        column++
    }

    private fun newLine() {
        lines.addLast(current.toString().trimEnd())
        if (lines.size > maxLines) lines.removeFirst()
        current.setLength(0)
        column = 0
    }

    /** Every line, the one being typed last. */
    @Synchronized
    fun lines(): List<String> = lines.toList() + current.toString().trimEnd()

    /** Last non-blank line (prompt or output), for the dock preview. */
    @Synchronized
    fun lastLine(): String = (sequenceOf(current.toString()) + lines.reversed().asSequence()).map { it.trim() }.firstOrNull { it.isNotEmpty() }.orEmpty()

    @Synchronized
    fun text(): String = lines().joinToString("\n").trimEnd()
}

/** Keys of the key bar (design doc §5 S60), with the codes the emulator understands. */
internal enum class TermKey {
    ESCAPE, TAB, ENTER, BACKSPACE,
    UP, DOWN, LEFT, RIGHT,
    HOME, END, PAGE_UP, PAGE_DOWN, INSERT, DELETE,
    F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
}

/** Latched modifiers of the key bar. */
internal data class Mods(val ctrl: Boolean = false, val alt: Boolean = false, val shift: Boolean = false) {
    /** libvterm mask: shift 1, alt 2, ctrl 4. */
    val mask: Int get() = (if (shift) 1 else 0) or (if (alt) 2 else 0) or (if (ctrl) 4 else 0)
    val any: Boolean get() = ctrl || alt || shift
}

/**
 * xterm sequences of the web's key bar (`client/src/components/remote/remoteKeys.ts`
 * `terminalSequence` / `applyTerminalModifiers`), used by the fallback engine.
 * The native emulator encodes keys itself (and follows DECCKM).
 */
internal object KeySequences {
    fun of(key: TermKey, mods: Mods, applicationCursor: Boolean?): String {
        val m = 1 + (if (mods.shift) 1 else 0) + (if (mods.alt) 2 else 0) + (if (mods.ctrl) 4 else 0)
        when (key) {
            TermKey.ESCAPE -> return if (mods.alt) "\u001B\u001B" else "\u001B"
            TermKey.TAB -> return if (mods.shift) "\u001B[Z" else if (mods.alt) "\u001B\t" else "\t"
            TermKey.ENTER -> return if (mods.alt) "\u001B\r" else "\r"
            TermKey.BACKSPACE -> return if (mods.ctrl) "\b" else if (mods.alt) "\u001B\u007F" else "\u007F"
            else -> Unit
        }
        CSI_FINAL[key]?.let { final ->
            if (m > 1) return "\u001B[1;$m$final"
            val arrow = key == TermKey.UP || key == TermKey.DOWN || key == TermKey.LEFT || key == TermKey.RIGHT
            if (arrow) return if (applicationCursor == true) "\u001BO$final" else "\u001B[$final"
            return if (applicationCursor == false) "\u001B[$final" else "\u001BO$final"
        }
        SS3_F[key]?.let { return if (m > 1) "\u001B[1;$m$it" else "\u001BO$it" }
        TILDE[key]?.let { return if (m > 1) "\u001B[$it;$m~" else "\u001B[$it~" }
        return ""
    }

    /** Ctrl turns a letter into its control character, Alt prefixes ESC (web `applyTerminalModifiers`). */
    fun text(text: String, mods: Mods): String {
        if (text.isEmpty()) return text
        val first = text.codePointAt(0)
        val firstLen = Character.charCount(first)
        var out = String(Character.toChars(first))
        if (mods.ctrl) ctrlChar(first)?.let { out = it.toString() }
        if (mods.alt) out = "\u001B$out"
        return out + text.substring(firstLen)
    }

    /** a–z / @[\]^_ → 0x00–0x1F, space → NUL, ? → DEL. */
    fun ctrlChar(codePoint: Int): Char? {
        val c = Character.toUpperCase(codePoint)
        return when {
            c in '@'.code..'_'.code -> (c - '@'.code).toChar()
            c == ' '.code -> '\u0000'
            c == '?'.code -> '\u007F'
            else -> null
        }
    }

    private val CSI_FINAL = mapOf(TermKey.UP to 'A', TermKey.DOWN to 'B', TermKey.RIGHT to 'C', TermKey.LEFT to 'D', TermKey.HOME to 'H', TermKey.END to 'F')
    private val SS3_F = mapOf(TermKey.F1 to 'P', TermKey.F2 to 'Q', TermKey.F3 to 'R', TermKey.F4 to 'S')
    private val TILDE = mapOf(
        TermKey.INSERT to 2, TermKey.DELETE to 3, TermKey.PAGE_UP to 5, TermKey.PAGE_DOWN to 6,
        TermKey.F5 to 15, TermKey.F6 to 17, TermKey.F7 to 18, TermKey.F8 to 19, TermKey.F9 to 20,
        TermKey.F10 to 21, TermKey.F11 to 23, TermKey.F12 to 24,
    )
}
