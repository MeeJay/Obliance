package tools.obli.core.designsystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.model.ServerColor

/** Design doc §8.2 / §10.11: every declared text/background pair ≥ 4.5:1. */
class ContrastTest {
    private fun assertAtLeast(min: Double, fg: Long, bg: Long, what: String) {
        val r = Contrast.ratio(fg, bg)
        assertTrue("$what: ${"%.2f".format(r)}:1 < $min:1", r >= min)
    }

    @Test fun referenceValues() {
        assertEquals(21.0, Contrast.ratio(0xFFFFFFFF, 0xFF000000), 0.01)
        assertEquals(1.0, Contrast.ratio(0xFF131728, 0xFF131728), 0.001)
    }

    @Test fun textOnSurfaces() {
        for ((name, t) in listOf("operator" to ObliTokens.operator, "night" to ObliTokens.night)) {
            for ((sName, bg) in listOf("bg" to t.bg, "chrome" to t.chrome, "surface1" to t.surface1, "surface2" to t.surface2)) {
                assertAtLeast(4.5, t.text, bg, "$name text on $sName")
                assertAtLeast(4.5, t.text2, bg, "$name text2 on $sName")
                assertAtLeast(4.5, t.textMuted, bg, "$name textMuted on $sName")
            }
        }
    }

    @Test fun filledButtonsPassAAWithWhite() {
        assertAtLeast(4.5, ObliTokens.ON_FILL, ObliTokens.oblianceOperator.fill, "white on #C83232")
        assertAtLeast(4.5, ObliTokens.ON_FILL, ObliTokens.oblianceNight.fill, "white on night fill")
        // The brand red is NOT a filled-button colour (§0.2): it fails AA with white.
        assertTrue(Contrast.ratio(ObliTokens.ON_FILL, ObliTokens.oblianceOperator.brand) < 4.5)
    }

    @Test fun accent2OnChrome() {
        assertAtLeast(4.5, ObliTokens.oblianceOperator.accent2, ObliTokens.operator.chrome, "accent2 on chrome")
        assertAtLeast(4.5, ObliTokens.oblianceNight.accent2, ObliTokens.night.chrome, "night accent2 on chrome")
    }

    @Test fun statusLabelsOnTheirPill() {
        for (s in ObliTokens.Status.entries) {
            val pill = Contrast.blend(Contrast.withAlpha(s.argb, 0.12), ObliTokens.operator.surface1)
            assertAtLeast(4.5, s.argb, pill, "status ${s.name} on its pill")
        }
    }

    @Test fun serverMonogramsOnTheirTile() {
        // The tile has an opaque chrome base under the 18 % tint, whatever it sits on.
        for ((name, t) in listOf("operator" to ObliTokens.operator, "night" to ObliTokens.night)) {
            for (c in ServerColor.entries) {
                val tile = Contrast.blend(Contrast.withAlpha(c.argb, 0.18), t.chrome)
                assertAtLeast(4.5, c.argb, tile, "$name server ${c.name} monogram on its tile")
                assertAtLeast(6.0, c.argb, t.bg, "$name server ${c.name} on bg")
            }
        }
    }
}
