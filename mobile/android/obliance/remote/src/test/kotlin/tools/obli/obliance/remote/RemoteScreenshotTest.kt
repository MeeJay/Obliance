package tools.obli.obliance.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RobolectricTestRunner
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.designsystem.ObliTokens
import tools.obli.core.designsystem.ObliTypography
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/**
 * S60 / S61 / S62 and the sessions surfaces over the design doc §4 data
 * (PowerShell on PC-COMPTA-03 · ACME, SSH on 140), French. The native
 * emulator (JNI) does not load on the JVM: the terminal is drawn by the
 * transcript renderer, with the same theme and font.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class RemoteScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun capture(name: String, content: @Composable () -> Unit) {
        compose.setContent {
            ObliTheme { CompositionLocalProvider(LocalObliServices provides SampleObliServices()) { content() } }
        }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot(name))
    }

    private val powershell = listOf(
        "Windows PowerShell",
        "Copyright (C) Microsoft Corporation. Tous droits réservés.",
        "",
        "Installez la dernière version de PowerShell pour de nouvelles",
        "fonctionnalités et améliorations ! https://aka.ms/PSWindows",
        "",
        "PS C:\\Windows\\system32> Get-Process |",
        ">> Sort-Object CPU -Descending |",
        ">> Select-Object -First 3 Name,Id,CPU",
        "",
        "Name            Id     CPU",
        "----            --     ---",
        "EBP.Compta    7312  4312,7",
        "TiWorker      5120  1140,2",
        "MsMpEng       3308   251,9",
        "",
        "PS C:\\Windows\\system32> ",
    )

    private val header = TerminalHeader("PC-COMPTA-03", "ACME", "powershell", "SYSTÈME", "00:04:12", ObliTokens.Status.ONLINE)

    @Composable
    private fun Terminal(
        body: TerminalBody,
        header: TerminalHeader = this.header,
        lines: List<String> = powershell,
        keyBar: Boolean = true,
        modifiers: StickyModifiers = StickyModifiers(),
    ) = TerminalContent(
        header = header, body = body, keyBarVisible = keyBar, modifiers = modifiers,
        onMinimize = {}, onToggleKeyBar = {}, onPaste = {}, onEnd = {}, onReopen = {}, onRetry = {},
        onKey = {}, onText = {}, onCtrl = {},
    ) { TranscriptView(lines) }

    @Test fun terminal_connected() = capture("remote_terminal_connected.png") { Terminal(TerminalBody.Live) }

    @Test fun terminal_ctrl_locked() = capture("remote_terminal_ctrl_locked.png") {
        Terminal(TerminalBody.Live, modifiers = StickyModifiers().apply { ctrl = StickyModifiers.Latch.LOCKED; alt = StickyModifiers.Latch.ONCE })
    }

    @Test fun terminal_ssh_linux() = capture("remote_terminal_ssh.png") {
        Terminal(
            TerminalBody.Live,
            header = TerminalHeader("140", "Default", "ssh", null, "00:01:37", ObliTokens.Status.ONLINE),
            lines = listOf(
                "root@140:~# systemctl --failed",
                "  UNIT          LOAD   ACTIVE SUB    DESCRIPTION",
                "● nginx.service loaded failed failed A high performance web server",
                "",
                "1 loaded units listed.",
                "root@140:~# df -h /",
                "Filesystem      Size  Used Avail Use% Mounted on",
                "/dev/sda1        98G   30G   64G  31% /",
                "root@140:~# ",
            ),
        )
    }

    @Test fun terminal_connecting() = capture("remote_terminal_connecting.png") {
        Terminal(TerminalBody.Connecting, header = header.copy(status = "connexion", dot = ObliTokens.Status.PENDING), keyBar = false)
    }

    @Test fun terminal_waiting() = capture("remote_terminal_waiting.png") {
        Terminal(TerminalBody.Waiting, header = header.copy(status = "en attente de l'appareil", dot = ObliTokens.Status.PENDING), keyBar = false)
    }

    @Test fun terminal_connection_lost() = capture("remote_terminal_lost.png") {
        Terminal(TerminalBody.Ended(EndReason.CONNECTION_LOST), header = header.copy(status = "connexion perdue", dot = ObliTokens.Status.WARNING), keyBar = false)
    }

    @Test fun terminal_shell_closed() = capture("remote_terminal_shell_closed.png") {
        Terminal(
            TerminalBody.Ended(EndReason.SHELL_CLOSED),
            header = header.copy(status = "terminée", dot = ObliTokens.Status.OFFLINE),
            lines = powershell + listOf("exit"),
            keyBar = false,
        )
    }

    @Test fun terminal_forbidden() = capture("remote_terminal_forbidden.png") {
        Terminal(
            TerminalBody.StartFailed("Votre équipe n'a pas le droit « Accès distant » sur cet appareil."),
            header = header.copy(status = "non ouverte", dot = ObliTokens.Status.OFFLINE),
            keyBar = false,
        )
    }

    @Test fun session_choice_loaded() = capture("remote_session_choice.png") {
        SheetBackdrop {
            SessionChoiceContent(
                "powershell",
                WtsState.Loaded(
                    listOf(
                        WtsSession(1, "Console", "m.durand", "ACME", "active"),
                        WtsSession(3, "RDP-Tcp#3", "a.lefebvre", "ACME", "disconnected"),
                    ),
                ),
            ) {}
        }
    }

    @Test fun session_choice_loading() = capture("remote_session_choice_loading.png") {
        SheetBackdrop { SessionChoiceContent("cmd", WtsState.Loading) {} }
    }

    @Test fun sessions_pill_and_section() = capture("remote_sessions.png") {
        val now = System.currentTimeMillis()
        Column(Modifier.fillMaxSize().background(ObliTheme.colors.bg)) {
            RemoteSessionsContent(
                rows = listOf(
                    SessionRow(RemoteSessionRef("s1", SampleData.PROD, 187, "powershell", "PC-COMPTA-03"), "ACME", SessionPhase.Connected(now - 252_000), "PS C:\\Windows\\system32>"),
                    SessionRow(RemoteSessionRef("s2", SampleData.PROD, 140, "ssh", "140"), "Default", SessionPhase.Waiting, ""),
                    SessionRow(RemoteSessionRef("s3", SampleData.PROD, 185, "oblireach", "PC-COMPTA-01"), "ACME", SessionPhase.Connected(now), ""),
                    SessionRow(RemoteSessionRef("s4", SampleData.PROD, 15, "ssh", "BOB01"), "Default", SessionPhase.Ended(EndReason.CONNECTION_LOST), "root@BOB01:~# apt upgrade"),
                ),
                onOpen = {},
                onEnd = {},
            )
            Box(Modifier.weight(1f).fillMaxSize().padding(bottom = 8.dp), contentAlignment = Alignment.BottomCenter) {
                SessionsPillContent(2, "powershell", "PC-COMPTA-03", onClick = {})
            }
        }
    }

    @Test fun reach_web_viewer() = capture("remote_reach.png") {
        ReachFrame("PC-COMPTA-03", showHint = true, onDismissHint = {}, onMinimize = {}, onEnd = {}) {
            // The page itself is a WebView (not drawn by Robolectric).
            Box(Modifier.fillMaxSize().background(ObliTheme.colors.bg), contentAlignment = Alignment.Center) {
                Text("/devices/187", style = ObliTypography.monoCaption, color = ObliTheme.colors.textMuted)
            }
        }
    }

    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-mdpi")
    @Test fun terminal_tablet() = capture("remote_terminal_tablet.png") { Terminal(TerminalBody.Live) }

    @Composable
    private fun SheetBackdrop(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(ObliTheme.colors.bg), contentAlignment = Alignment.BottomCenter) {
            Column(Modifier.background(ObliTheme.colors.surface1).padding(top = 16.dp), verticalArrangement = Arrangement.Top) { content() }
        }
    }
}
