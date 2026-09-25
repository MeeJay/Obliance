package tools.obli.obliance.data

import tools.obli.core.auth.ServerSession
import tools.obli.core.network.ApiOutcome
import tools.obli.core.network.FailureKind

/**
 * Every repository call goes through this: a `401 Authentication required`
 * marks the server's session expired (S03 for the active server, a greyed
 * mention elsewhere, design doc §2.10). The outcome itself is returned as is.
 */
internal fun <T> ApiOutcome<T>.watchedBy(session: ServerSession): ApiOutcome<T> {
    if (this == ApiOutcome.SessionExpired) session.markExpired()
    return this
}

/** No server to send the call to (unknown id, or no active server yet). */
internal val noServer: ApiOutcome<Nothing> = ApiOutcome.Failure(null, FailureKind.CLIENT, "no such server")

/** Ok or Accepted → the value; anything else → null. */
internal val <T> ApiOutcome<T>.valueOrNull: T?
    get() = when (this) {
        is ApiOutcome.Ok -> value
        is ApiOutcome.Accepted -> value
        else -> null
    }

/** Re-types a non-success outcome (they all are ApiOutcome<Nothing>). */
@Suppress("UNCHECKED_CAST")
internal fun <T> ApiOutcome<*>.failureAs(): ApiOutcome<T> = this as ApiOutcome<T>
