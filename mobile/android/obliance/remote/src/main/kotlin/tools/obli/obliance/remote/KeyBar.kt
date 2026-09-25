package tools.obli.obliance.remote

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import tools.obli.core.designsystem.ObliIcons
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTypography

internal object RemoteIcons {
    val Keyboard: ImageVector by lazy {
        ObliIcons.lucide(
            "keyboard",
            "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
            "M10 8h.01", "M12 12h.01", "M14 8h.01", "M16 12h.01", "M18 8h.01", "M6 8h.01", "M7 16h10", "M8 12h.01",
        )
    }
    val Terminal: ImageVector by lazy {
        ObliIcons.lucide("square-terminal", "m7 11 2-2-2-2", "M11 13h4", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z")
    }
    val Screen: ImageVector get() = ObliIcons.Monitor
}

private sealed interface BarKey {
    data class Key(val key: TermKey, val label: Int, val description: Int) : BarKey
    data class Chars(val text: String, val description: Int) : BarKey
    data class Ctrl(val letter: String) : BarKey
    data object CtrlLatch : BarKey
    data object AltLatch : BarKey
    data object Paste : BarKey
}

private val PAGES: List<List<BarKey>> = listOf(
    listOf(
        BarKey.Key(TermKey.ESCAPE, R.string.remote_key_esc, R.string.remote_key_esc_a11y),
        BarKey.Key(TermKey.TAB, R.string.remote_key_tab, R.string.remote_key_tab_a11y),
        BarKey.CtrlLatch,
        BarKey.AltLatch,
        BarKey.Key(TermKey.UP, R.string.remote_key_up, R.string.remote_key_up_a11y),
        BarKey.Key(TermKey.DOWN, R.string.remote_key_down, R.string.remote_key_down_a11y),
        BarKey.Key(TermKey.LEFT, R.string.remote_key_left, R.string.remote_key_left_a11y),
        BarKey.Key(TermKey.RIGHT, R.string.remote_key_right, R.string.remote_key_right_a11y),
        BarKey.Chars("|", R.string.remote_key_pipe_a11y),
        BarKey.Chars("~", R.string.remote_key_tilde_a11y),
        BarKey.Chars("/", R.string.remote_key_slash_a11y),
        BarKey.Chars("-", R.string.remote_key_dash_a11y),
    ),
    listOf(
        BarKey.Key(TermKey.HOME, R.string.remote_key_home, R.string.remote_key_home),
        BarKey.Key(TermKey.END, R.string.remote_key_end, R.string.remote_key_end),
        BarKey.Key(TermKey.PAGE_UP, R.string.remote_key_pgup, R.string.remote_key_pgup_a11y),
        BarKey.Key(TermKey.PAGE_DOWN, R.string.remote_key_pgdn, R.string.remote_key_pgdn_a11y),
        BarKey.Key(TermKey.INSERT, R.string.remote_key_ins, R.string.remote_key_ins_a11y),
        BarKey.Key(TermKey.DELETE, R.string.remote_key_del, R.string.remote_key_del_a11y),
    ),
    (TermKey.F1.ordinal..TermKey.F12.ordinal).map { TermKey.entries[it] }.map { BarKey.Key(it, 0, 0) },
    listOf(BarKey.Ctrl("c"), BarKey.Ctrl("d"), BarKey.Ctrl("z"), BarKey.Ctrl("l"), BarKey.Ctrl("r"), BarKey.Paste),
)

/**
 * Key bar above the soft keyboard (design doc §5 S60): four swipeable pages,
 * sticky Ctrl / Alt (tap = next key, long press = locked), 48 dp keys.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun KeyBar(
    modifiers: StickyModifiers,
    onKey: (TermKey) -> Unit,
    onText: (String) -> Unit,
    onCtrl: (String) -> Unit,
    onPaste: () -> Unit,
    modifier: Modifier = Modifier,
    initialPage: Int = 0,
) {
    val c = ObliTheme.colors
    val pager = rememberPagerState(initialPage = initialPage) { PAGES.size }
    Column(modifier.fillMaxWidth().background(c.chrome).padding(top = 6.dp, bottom = 2.dp)) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxWidth()) { page ->
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                PAGES[page].forEach { key -> KeyChip(key, modifiers, onKey, onText, onCtrl, onPaste) }
            }
        }
        // Page indicator (decorative for touch: swipe; TalkBack scrolls the pager and reads the page).
        val pageLabel = stringResource(R.string.remote_key_page, pager.currentPage + 1, PAGES.size)
        Row(
            Modifier.fillMaxWidth().height(14.dp).semantics { contentDescription = pageLabel },
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(PAGES.size) { i ->
                Box(Modifier.size(6.dp).clip(CircleShape).background(if (pager.currentPage == i) c.text2 else c.textFaint))
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun KeyChip(
    key: BarKey,
    modifiers: StickyModifiers,
    onKey: (TermKey) -> Unit,
    onText: (String) -> Unit,
    onCtrl: (String) -> Unit,
    onPaste: () -> Unit,
) {
    val c = ObliTheme.colors
    val latch = when (key) {
        BarKey.CtrlLatch -> modifiers.ctrl
        BarKey.AltLatch -> modifiers.alt
        else -> StickyModifiers.Latch.OFF
    }
    val label = when (key) {
        is BarKey.Key -> if (key.label != 0) stringResource(key.label) else key.key.name
        is BarKey.Chars -> key.text
        is BarKey.Ctrl -> "^" + key.letter.uppercase()
        BarKey.CtrlLatch -> stringResource(R.string.remote_key_ctrl)
        BarKey.AltLatch -> stringResource(R.string.remote_key_alt)
        BarKey.Paste -> stringResource(R.string.remote_paste)
    }
    val description = when (key) {
        is BarKey.Key -> if (key.description != 0) stringResource(key.description) else label
        is BarKey.Chars -> stringResource(key.description)
        is BarKey.Ctrl -> stringResource(R.string.remote_key_ctrl_combo, key.letter.uppercase())
        BarKey.CtrlLatch -> stringResource(R.string.remote_key_ctrl)
        BarKey.AltLatch -> stringResource(R.string.remote_key_alt)
        BarKey.Paste -> stringResource(R.string.remote_paste)
    }
    val state = when (latch) {
        StickyModifiers.Latch.OFF -> null
        StickyModifiers.Latch.ONCE -> stringResource(R.string.remote_key_latched_once)
        StickyModifiers.Latch.LOCKED -> stringResource(R.string.remote_key_latched_locked)
    }
    val (bg, fg) = when (latch) {
        StickyModifiers.Latch.LOCKED -> c.accent2 to TermColors.background
        StickyModifiers.Latch.ONCE -> c.accent2.copy(alpha = 0.18f) to c.accent2
        StickyModifiers.Latch.OFF -> Color(0xFF181C30) to TermColors.foreground
    }
    val onClick: () -> Unit = {
        when (key) {
            is BarKey.Key -> onKey(key.key)
            is BarKey.Chars -> onText(key.text)
            is BarKey.Ctrl -> onCtrl(key.letter)
            BarKey.CtrlLatch -> modifiers.ctrl = modifiers.tap(modifiers.ctrl)
            BarKey.AltLatch -> modifiers.alt = modifiers.tap(modifiers.alt)
            BarKey.Paste -> onPaste()
        }
    }
    val onLong: (() -> Unit)? = when (key) {
        BarKey.CtrlLatch -> { { modifiers.ctrl = StickyModifiers.Latch.LOCKED } }
        BarKey.AltLatch -> { { modifiers.alt = StickyModifiers.Latch.LOCKED } }
        else -> null
    }
    Box(
        Modifier
            .widthIn(min = 48.dp)
            .height(48.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .combinedClickable(role = Role.Button, onLongClick = onLong, onClick = onClick)
            .semantics {
                contentDescription = description
                if (state != null) stateDescription = state
            }
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = ObliTypography.terminal, color = fg, maxLines = 1)
    }
}
