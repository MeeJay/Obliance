package tools.obli.shell.lock

/** When the biometric app lock engages. Pure, unit-tested. */
object LockPolicy {
    const val BACKGROUND_TIMEOUT_MS = 5L * 60 * 1000

    /**
     * Locked again when the app comes back after at least [timeoutMs] in the
     * background. [backgroundedAtMs] and [nowMs] come from a monotonic clock
     * (SystemClock.elapsedRealtime); 0 means "never went to background".
     */
    fun shouldLockOnForeground(
        enabled: Boolean,
        backgroundedAtMs: Long,
        nowMs: Long,
        timeoutMs: Long = BACKGROUND_TIMEOUT_MS,
    ): Boolean {
        if (!enabled || backgroundedAtMs <= 0) return false
        // A monotonic clock never goes back, except across a reboot (process gone
        // anyway): treat it as "long enough".
        if (nowMs < backgroundedAtMs) return true
        return nowMs - backgroundedAtMs >= timeoutMs
    }
}
