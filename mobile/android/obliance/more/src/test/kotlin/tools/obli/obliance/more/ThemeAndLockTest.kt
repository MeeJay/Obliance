package tools.obli.obliance.more

import java.time.Duration
import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.designsystem.ObliThemeVariant

class ThemeResolverTest {
    private fun at(h: Int, m: Int) = LocalTime.of(h, m)
    private val noon = at(12, 0)

    @Test fun `follow the server wears the server's theme`() {
        assertEquals(ObliThemeVariant.NEON, ThemeResolver.resolve(ThemeMode.FOLLOW_SERVER, false, ObliThemeVariant.NEON, noon))
        assertEquals(ObliThemeVariant.MODERN, ThemeResolver.resolve(ThemeMode.FOLLOW_SERVER, false, ObliThemeVariant.MODERN, noon))
        assertEquals(ObliThemeVariant.OPERATOR, ThemeResolver.resolve(ThemeMode.FOLLOW_SERVER, false, ObliThemeVariant.OPERATOR, noon))
    }

    @Test fun `Operator and Night ignore the server`() {
        for (server in ObliThemeVariant.entries) {
            assertEquals(ObliThemeVariant.OPERATOR, ThemeResolver.resolve(ThemeMode.OPERATOR, false, server, noon))
            assertEquals(ObliThemeVariant.NIGHT, ThemeResolver.resolve(ThemeMode.NIGHT, false, server, noon))
        }
    }

    @Test fun `automatic night from 22 00 included to 07 00 excluded`() {
        val neon = ObliThemeVariant.NEON
        for (mode in ThemeMode.entries) {
            val day = ThemeResolver.resolve(mode, false, neon, noon)
            assertEquals(day, ThemeResolver.resolve(mode, true, neon, at(21, 59)))
            assertEquals(ObliThemeVariant.NIGHT, ThemeResolver.resolve(mode, true, neon, at(22, 0)))
            assertEquals(ObliThemeVariant.NIGHT, ThemeResolver.resolve(mode, true, neon, at(0, 0)))
            assertEquals(ObliThemeVariant.NIGHT, ThemeResolver.resolve(mode, true, neon, at(6, 59)))
            assertEquals(day, ThemeResolver.resolve(mode, true, neon, at(7, 0)))
        }
        // Without automatic night, 23:00 keeps the mode's variant.
        assertEquals(ObliThemeVariant.NEON, ThemeResolver.resolve(ThemeMode.FOLLOW_SERVER, false, neon, at(23, 0)))
    }

    @Test fun `next boundary`() {
        assertEquals(Duration.ofMinutes(1), ThemeResolver.untilNextBoundary(at(21, 59)))
        assertEquals(Duration.ofHours(9), ThemeResolver.untilNextBoundary(at(22, 0)))
        assertEquals(Duration.ofMinutes(1), ThemeResolver.untilNextBoundary(at(6, 59)))
        assertEquals(Duration.ofHours(15), ThemeResolver.untilNextBoundary(at(7, 0)))
    }
}

class LockPolicyTest {
    @Test fun `never locks when disabled or never backgrounded`() {
        assertFalse(LockPolicy.shouldLockOnForeground(false, 1_000, 10_000_000, 0))
        assertFalse(LockPolicy.shouldLockOnForeground(true, 0, 10_000_000, 0))
    }

    @Test fun `immediate locks after any time in the background`() {
        assertTrue(LockPolicy.shouldLockOnForeground(true, 1_000, 1_001, LockTimeout.IMMEDIATE.millis))
        assertTrue(LockPolicy.shouldLockOnForeground(true, 1_000, 1_000, LockTimeout.IMMEDIATE.millis))
    }

    @Test fun `thresholds are inclusive`() {
        for (t in listOf(LockTimeout.ONE_MIN, LockTimeout.FIVE_MIN, LockTimeout.FIFTEEN_MIN)) {
            assertFalse(t.name, LockPolicy.shouldLockOnForeground(true, 1_000, 1_000 + t.millis - 1, t.millis))
            assertTrue(t.name, LockPolicy.shouldLockOnForeground(true, 1_000, 1_000 + t.millis, t.millis))
        }
    }

    @Test fun `a clock going backwards locks`() {
        assertTrue(LockPolicy.shouldLockOnForeground(true, 10_000, 5_000, LockTimeout.FIFTEEN_MIN.millis))
    }
}

class LockControllerTest {
    private var now = 1_000L
    private var canUse = true

    private fun controller(prefs: AppPrefs = AppPrefs(lockEnabled = true)) = LockController({ now }, { canUse }, prefs)

    @Test fun `locked at cold start only when the lock was turned on`() {
        assertTrue(controller(AppPrefs(lockEnabled = true)).locked.value)
        // S04 step 3 not answered (a phone coming from 0.2.0): never a lock it did not choose.
        assertFalse(controller(AppPrefs(lockEnabled = null)).locked.value)
    }

    @Test fun `before the preferences are read it stays locked, then follows them`() {
        val on = LockController({ now }, { canUse }, AppPrefs(), initialLoaded = false)
        assertTrue(on.locked.value)
        assertFalse(on.ready.value)
        on.onPrefs(AppPrefs(), loaded = false)
        assertTrue("the defaults are not the user's choice", on.locked.value)
        on.onPrefs(AppPrefs(lockEnabled = true), loaded = true)
        assertTrue(on.locked.value)
        assertTrue(on.ready.value)

        val undecided = LockController({ now }, { canUse }, AppPrefs(), initialLoaded = false)
        undecided.onPrefs(AppPrefs(lockEnabled = null), loaded = true)
        assertFalse(undecided.locked.value)
    }

    @Test fun `answering S04 step 3 with Activer never locks at once, then the delay applies`() {
        val c = controller(AppPrefs(lockEnabled = null, lockTimeout = LockTimeout.ONE_MIN))
        assertFalse(c.locked.value)
        c.onPrefs(AppPrefs(lockEnabled = true, lockTimeout = LockTimeout.ONE_MIN))
        assertFalse("the user has just authenticated", c.locked.value)
        c.onBackground()
        now += 60_000
        c.onForeground()
        assertTrue(c.locked.value)
    }

    @Test fun `undecided never locks, even after a long time in the background`() {
        val c = controller(AppPrefs(lockEnabled = null, lockTimeout = LockTimeout.IMMEDIATE))
        c.onBackground()
        now += 3_600_000
        c.onForeground()
        assertFalse(c.locked.value)
    }

    @Test fun `never locked when the lock is off`() {
        val c = controller(AppPrefs(lockEnabled = false))
        assertFalse(c.locked.value)
        c.onBackground()
        now += LockTimeout.FIFTEEN_MIN.millis * 4
        c.onForeground()
        assertFalse(c.locked.value)
    }

    @Test fun `never locked without a screen lock`() {
        canUse = false
        val c = controller()
        assertFalse(c.locked.value)
        c.onBackground()
        now += 3_600_000
        c.onForeground()
        assertFalse(c.locked.value)
    }

    @Test fun `unlock, then the chosen delay in the background locks again`() {
        val c = controller(AppPrefs(lockEnabled = true, lockTimeout = LockTimeout.ONE_MIN))
        c.unlock()
        assertFalse(c.locked.value)
        c.onBackground()
        now += 59_999
        c.onForeground()
        assertFalse(c.locked.value)
        c.onBackground()
        now += 60_000
        c.onForeground()
        assertTrue(c.locked.value)
    }

    @Test fun `immediate locks on any return`() {
        val c = controller(AppPrefs(lockEnabled = true, lockTimeout = LockTimeout.IMMEDIATE))
        c.unlock()
        c.onBackground()
        now += 1
        c.onForeground()
        assertTrue(c.locked.value)
    }

    @Test fun `the credential screen of the prompt is not a trip to the background`() {
        val c = controller(AppPrefs(lockEnabled = true, lockTimeout = LockTimeout.IMMEDIATE))
        c.setPrompting(true)
        c.onBackground()
        now += 5_000
        c.onForeground()
        c.setPrompting(false)
        c.unlock()
        assertFalse(c.locked.value)
    }

    @Test fun `turning the lock off unlocks, turning it on again does not lock at once`() {
        val c = controller()
        assertTrue(c.locked.value)
        c.onPrefs(AppPrefs(lockEnabled = false))
        assertFalse(c.locked.value)
        c.onPrefs(AppPrefs(lockEnabled = true))
        assertFalse(c.locked.value)
    }

    @Test fun `the prompt opens by itself once per foreground`() {
        val c = controller()
        assertTrue(c.claimAutoPrompt())
        assertFalse(c.claimAutoPrompt())
        c.onBackground()
        c.onForeground()
        assertTrue(c.claimAutoPrompt())
        c.unlock()
        c.onBackground()
        c.onForeground()
        // Unlocked (5 min default not reached): nothing to prompt.
        assertFalse(c.claimAutoPrompt())
    }
}
