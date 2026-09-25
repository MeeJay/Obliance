package tools.obli.obliance.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalTextTest {
    @Test fun utf8_characters_split_across_frames_are_kept() {
        val bytes = "Tous droits réservés — €".toByteArray(Charsets.UTF_8)
        val d = Utf8Stream()
        val out = StringBuilder()
        // Every possible split point, one byte at a time.
        bytes.forEach { b -> out.append(d.decode(byteArrayOf(b))) }
        assertEquals("Tous droits réservés — €", out.toString())

        val d2 = Utf8Stream()
        val cut = bytes.indexOfFirst { it == 0xC3.toByte() } + 1 // inside « é »
        assertEquals("Tous droits r", d2.decode(bytes.copyOfRange(0, cut)))
        assertEquals("éservés — €", d2.decode(bytes.copyOfRange(cut, bytes.size)))
    }

    @Test fun invalid_bytes_become_replacement_characters() {
        assertEquals("a\uFFFDb", Utf8Stream().decode(byteArrayOf('a'.code.toByte(), 0xFF.toByte(), 'b'.code.toByte())))
    }

    @Test fun transcript_strips_sequences_and_applies_carriage_returns() {
        val t = Transcript()
        t.feed("\u001B]0;Administrator: PowerShell\u0007\u001B[?25l\u001B[32mPS\u001B[0m C:\\> dir\r\n".toByteArray())
        t.feed("progress 10%\rprogress 100%\r\n".toByteArray())
        t.feed("abc\b\bX\u001B[K\r\n".toByteArray())
        t.feed("PS C:\\> ".toByteArray())
        assertEquals(listOf("PS C:\\> dir", "progress 100%", "aX", "PS C:\\>"), t.lines())
        assertEquals("PS C:\\>", t.lastLine())
    }

    @Test fun transcript_is_bounded() {
        val t = Transcript(maxLines = 3)
        repeat(10) { t.feedText("line $it\n") }
        assertEquals(listOf("line 7", "line 8", "line 9", ""), t.lines())
        assertEquals("line 9", t.lastLine())
    }

    /** Same values as the web's `terminalSequence` (client/src/components/remote/remoteKeys.ts). */
    @Test fun key_sequences_match_the_web() {
        val none = Mods()
        assertEquals("\u001B", KeySequences.of(TermKey.ESCAPE, none, null))
        assertEquals("\t", KeySequences.of(TermKey.TAB, none, null))
        assertEquals("\u001B[Z", KeySequences.of(TermKey.TAB, Mods(shift = true), null))
        assertEquals("\u001B[A", KeySequences.of(TermKey.UP, none, null))
        assertEquals("\u001BOA", KeySequences.of(TermKey.UP, none, true))
        assertEquals("\u001B[1;5C", KeySequences.of(TermKey.RIGHT, Mods(ctrl = true), null))
        assertEquals("\u001BOH", KeySequences.of(TermKey.HOME, none, null))
        assertEquals("\u001B[H", KeySequences.of(TermKey.HOME, none, false))
        assertEquals("\u001B[5~", KeySequences.of(TermKey.PAGE_UP, none, null))
        assertEquals("\u001B[3~", KeySequences.of(TermKey.DELETE, none, null))
        assertEquals("\u001BOP", KeySequences.of(TermKey.F1, none, null))
        assertEquals("\u001B[24~", KeySequences.of(TermKey.F12, none, null))
        assertEquals("\u001B[15;3~", KeySequences.of(TermKey.F5, Mods(alt = true), null))
        assertEquals("\u007F", KeySequences.of(TermKey.BACKSPACE, none, null))
        assertEquals("\r", KeySequences.of(TermKey.ENTER, none, null))
    }

    @Test fun ctrl_and_alt_apply_to_the_first_character() {
        assertEquals("\u0003", KeySequences.text("c", Mods(ctrl = true)))
        assertEquals("\u0003", KeySequences.text("C", Mods(ctrl = true)))
        assertEquals("\u001Bb", KeySequences.text("b", Mods(alt = true)))
        assertEquals("\u001B\u0012x", KeySequences.text("rx", Mods(ctrl = true, alt = true)))
        assertEquals("|", KeySequences.text("|", Mods()))
        assertEquals(7, Mods(ctrl = true, alt = true, shift = true).mask)
    }

    @Test fun durations_are_formatted_like_the_mockup() {
        assertEquals("00:04:12", formatDuration(252_000))
        assertEquals("01:00:00", formatDuration(3_600_000))
        assertEquals("00:00:00", formatDuration(-5))
    }
}
