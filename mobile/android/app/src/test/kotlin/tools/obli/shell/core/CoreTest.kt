package tools.obli.shell.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.shell.BuildConfig
import tools.obli.shell.lock.LockPolicy

class CoreTest {
    @Test fun userAgentSuffix() {
        assertEquals(
            "Mozilla/5.0 (Linux; Android 15; wv) ObliShell/1.0.0 (obliance; Android)",
            UserAgent.build("Mozilla/5.0 (Linux; Android 15; wv) ", "1.0.0", "obliance"),
        )
        assertEquals("ObliShell/1.0.0 (obliview; Android)", UserAgent.build("", "1.0.0", "obliview"))
    }

    @Test fun appTableReachesBuildConfig() {
        val ids = ObliApps.parseIds(BuildConfig.OBLI_APP_IDS)
        assertEquals(listOf("obliance", "obliview", "obliguard", "oblimap", "obliplan", "oblidesk", "oblihub"), ids)
        assertTrue(BuildConfig.OBLI_APP in ids)
        assertTrue(BuildConfig.DEFAULT_SERVER_URL.isEmpty() || BuildConfig.DEFAULT_SERVER_URL.startsWith("https://"))
    }

    @Test fun siblingPackages() {
        assertEquals(listOf("tools.obli.obliview"), ObliApps.candidatePackages("obliview", "tools.obli.obliance"))
        assertEquals(
            listOf("tools.obli.obliview.debug", "tools.obli.obliview"),
            ObliApps.candidatePackages("obliview", "tools.obli.obliance.debug"),
        )
    }

    @Test fun incomingLinks() {
        assertTrue(IncomingLinks.isAllowedPath("/"))
        assertTrue(IncomingLinks.isAllowedPath("/devices/12?tab=1"))
        assertTrue(IncomingLinks.isAllowedPath("/auth/sso-redirect?tenant=acme"))
        assertFalse(IncomingLinks.isAllowedPath("/api/devices/12/reboot"))
        assertFalse(IncomingLinks.isAllowedPath("/api"))
        assertFalse(IncomingLinks.isAllowedPath("/auth/callback?code=x&state=y"))
    }

    @Test fun lockPolicy() {
        val five = LockPolicy.BACKGROUND_TIMEOUT_MS
        assertFalse(LockPolicy.shouldLockOnForeground(enabled = false, backgroundedAtMs = 1, nowMs = 10 * five))
        assertFalse(LockPolicy.shouldLockOnForeground(enabled = true, backgroundedAtMs = 0, nowMs = 10 * five))
        assertFalse(LockPolicy.shouldLockOnForeground(enabled = true, backgroundedAtMs = 1_000, nowMs = 1_000 + five - 1))
        assertTrue(LockPolicy.shouldLockOnForeground(enabled = true, backgroundedAtMs = 1_000, nowMs = 1_000 + five))
        assertTrue(LockPolicy.shouldLockOnForeground(enabled = true, backgroundedAtMs = 5_000, nowMs = 1_000))
    }
}
