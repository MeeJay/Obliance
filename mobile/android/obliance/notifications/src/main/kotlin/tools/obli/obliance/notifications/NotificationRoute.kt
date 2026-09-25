package tools.obli.obliance.notifications

import android.content.Context
import android.content.Intent
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import tools.obli.core.model.ServerId
import tools.obli.shell.nav.Origins

/**
 * Where a tap on a notification (or one of its "Ouvrir" / "Examiner" /
 * "Processus" / "Se reconnecter" actions) leads (design doc §2.9). Every route
 * carries the [serverId] of the server that produced the item: the app
 * resolves it against THAT server, switching to it when needed (§2.10 item 3),
 * never against the active one. Read by the app with [ObliNotifications.routeFrom].
 */
sealed interface NotificationRoute {
    val serverId: ServerId

    /** S30 of [deviceId]; [tab] is a device tab ("processes"…) when the action names one. */
    data class Device(
        override val serverId: ServerId,
        val deviceId: Long,
        val tenantId: Long?,
        val label: String?,
        val tab: String? = null,
    ) : NotificationRoute

    /** Any other same-origin path of that server (S90 or the native screen of §2.9). */
    data class Path(override val serverId: ServerId, val path: String, val tenantId: Long?) : NotificationRoute

    /** S11 of a two-person approval. */
    data class Approval(override val serverId: ServerId, val approvalId: Long, val tenantId: Long?) : NotificationRoute

    /** S12 review of a pending device (À traiter › Enrôlements). */
    data class Enrolment(override val serverId: ServerId, val deviceId: Long, val tenantId: Long?, val label: String?) : NotificationRoute

    /** À traiter › Enrôlements, on that server (« N appareils en attente », the rest of a burst). */
    data class Enrolments(override val serverId: ServerId) : NotificationRoute

    /** À traiter › Approbations, on that server (« N demandes d'approbation en attente »). */
    data class Approvals(override val serverId: ServerId) : NotificationRoute

    /** À traiter, filtered on that server. */
    data class Inbox(override val serverId: ServerId) : NotificationRoute

    /** Sign in again on that server (S03 when it is active, S92 otherwise). */
    data class SignIn(override val serverId: ServerId) : NotificationRoute
}

/**
 * Intent extras of a [NotificationRoute] (all prefixed, so they never clash with
 * the app's). The launcher activity is exported: any installed app may start it
 * with these extras. Only the app's own PendingIntents carry the install's
 * [RouteToken]; [ObliNotifications.routeFrom] drops a route without it.
 */
internal object RouteExtras {
    const val PREFIX = "tools.obli.obliance.notifications.route."
    const val KIND = PREFIX + "kind"
    const val SERVER = PREFIX + "server"
    const val DEVICE = PREFIX + "device"
    const val TENANT = PREFIX + "tenant"
    const val LABEL = PREFIX + "label"
    const val TAB = PREFIX + "tab"
    const val PATH = PREFIX + "path"
    const val APPROVAL = PREFIX + "approval"

    private const val K_DEVICE = "device"
    private const val K_PATH = "path"
    private const val K_APPROVAL = "approval"
    private const val K_ENROLMENT = "enrolment"
    private const val K_ENROLMENTS = "enrolments"
    private const val K_APPROVALS = "approvals"
    private const val K_INBOX = "inbox"
    private const val K_SIGN_IN = "sign_in"

    /** [token]: [RouteToken.get] of this install (the app's own notifications only). */
    fun write(intent: Intent, route: NotificationRoute, token: String) {
        intent.putExtra(RouteToken.EXTRA, token)
        intent.putExtra(SERVER, route.serverId.value)
        when (route) {
            is NotificationRoute.Device -> {
                intent.putExtra(KIND, K_DEVICE).putExtra(DEVICE, route.deviceId)
                route.tenantId?.let { intent.putExtra(TENANT, it) }
                route.label?.let { intent.putExtra(LABEL, it) }
                route.tab?.let { intent.putExtra(TAB, it) }
            }
            is NotificationRoute.Path -> {
                intent.putExtra(KIND, K_PATH).putExtra(PATH, route.path)
                route.tenantId?.let { intent.putExtra(TENANT, it) }
            }
            is NotificationRoute.Approval -> {
                intent.putExtra(KIND, K_APPROVAL).putExtra(APPROVAL, route.approvalId)
                route.tenantId?.let { intent.putExtra(TENANT, it) }
            }
            is NotificationRoute.Enrolment -> {
                intent.putExtra(KIND, K_ENROLMENT).putExtra(DEVICE, route.deviceId)
                route.tenantId?.let { intent.putExtra(TENANT, it) }
                route.label?.let { intent.putExtra(LABEL, it) }
            }
            is NotificationRoute.Enrolments -> intent.putExtra(KIND, K_ENROLMENTS)
            is NotificationRoute.Approvals -> intent.putExtra(KIND, K_APPROVALS)
            is NotificationRoute.Inbox -> intent.putExtra(KIND, K_INBOX)
            is NotificationRoute.SignIn -> intent.putExtra(KIND, K_SIGN_IN)
        }
    }

    fun has(intent: Intent?): Boolean = intent?.extras?.keySet()?.any { it.startsWith(PREFIX) } == true

    /** The route carried by [intent], validated (ids, paths, tab), or null. Checks no token, removes nothing. */
    fun read(intent: Intent): NotificationRoute? {
        val server = intent.getStringExtra(SERVER)?.takeIf { it.isNotBlank() && it.length <= 64 } ?: return null
        val serverId = ServerId(server)
        val tenant = longOrNull(intent, TENANT)
        val label = intent.getStringExtra(LABEL)?.take(MAX_LABEL)
        return when (intent.getStringExtra(KIND)) {
            K_DEVICE -> {
                val device = longOrNull(intent, DEVICE)?.takeIf { it > 0 } ?: return null
                val tab = intent.getStringExtra(TAB)
                if (tab != null && !NotificationRoutes.isTab(tab)) return null
                NotificationRoute.Device(serverId, device, tenant, label, tab)
            }
            K_PATH -> {
                val path = NotificationRoutes.safePath(intent.getStringExtra(PATH)) ?: return null
                NotificationRoutes.deviceIn(serverId, path, tenant, null) ?: NotificationRoute.Path(serverId, path, tenant)
            }
            K_APPROVAL -> NotificationRoute.Approval(serverId, longOrNull(intent, APPROVAL)?.takeIf { it > 0 } ?: return null, tenant)
            K_ENROLMENT -> NotificationRoute.Enrolment(serverId, longOrNull(intent, DEVICE)?.takeIf { it > 0 } ?: return null, tenant, label)
            K_ENROLMENTS -> NotificationRoute.Enrolments(serverId)
            K_APPROVALS -> NotificationRoute.Approvals(serverId)
            K_INBOX -> NotificationRoute.Inbox(serverId)
            K_SIGN_IN -> NotificationRoute.SignIn(serverId)
            else -> null
        }
    }

    fun remove(intent: Intent) {
        intent.extras?.keySet()?.filter { it.startsWith(PREFIX) }?.forEach(intent::removeExtra)
    }

    private fun longOrNull(intent: Intent, key: String): Long? =
        if (intent.hasExtra(key)) intent.getLongExtra(key, Long.MIN_VALUE).takeIf { it != Long.MIN_VALUE } else null

    private const val MAX_LABEL = 120
}

/** Paths and `navigateTo` values → routes (design doc §2.9). Pure JVM. */
internal object NotificationRoutes {
    const val MAX_PATH = 512
    private val devicePath = Regex("^/devices/(\\d{1,15})/?(?:\\?(.*))?$")
    private val tabPattern = Regex("^[A-Za-z][A-Za-z0-9_-]{0,31}$")

    fun isTab(value: String): Boolean = tabPattern.matches(value)

    /**
     * [path] when it is a safe same-origin relative path: starts with one '/',
     * no scheme, no backslash, no control or white-space character, at most
     * [MAX_PATH] characters. Null otherwise.
     */
    fun safePath(path: String?): String? {
        if (path.isNullOrEmpty() || path.length > MAX_PATH) return null
        if (!path.startsWith("/") || path.startsWith("//")) return null
        // Resolving against a placeholder origin applies the platform rules (Origins).
        return path.takeIf { Origins.resolveRelativePath(PROBE_ORIGIN, it) != null }
    }

    /** `/devices/:id` (optionally `?tab=`) → a Device route; null for any other path. */
    fun deviceIn(serverId: ServerId, path: String, tenantId: Long?, label: String?): NotificationRoute.Device? {
        val m = devicePath.matchEntire(path) ?: return null
        val id = m.groupValues[1].toLongOrNull()?.takeIf { it > 0 } ?: return null
        val tab = m.groupValues[2].split('&')
            .firstOrNull { it.startsWith("tab=") }
            ?.removePrefix("tab=")
            ?.takeIf(::isTab)
        return NotificationRoute.Device(serverId, id, tenantId, label, tab)
    }

    /**
     * Route of an alert's `navigateTo`, resolved against ITS server's [origin]:
     * a relative path, or an absolute URL of that same origin (reduced to its
     * path). Anything else (another origin, a scheme, a protocol-relative
     * path, nothing at all) opens À traiter of that server.
     */
    fun fromNavigateTo(serverId: ServerId, origin: String, navigateTo: String?, tenantId: Long?, label: String?): NotificationRoute {
        val raw = navigateTo?.trim().orEmpty()
        if (raw.isEmpty()) return NotificationRoute.Inbox(serverId)
        val path = when {
            raw.startsWith("/") -> raw
            Origins.scheme(raw).let { it == "http" || it == "https" } && Origins.of(raw) == origin -> pathOf(raw)
            else -> null
        }
        val safe = safePath(path) ?: return NotificationRoute.Inbox(serverId)
        return deviceIn(serverId, safe, tenantId, label) ?: NotificationRoute.Path(serverId, safe, tenantId)
    }

    /** Device id named by a `navigateTo` (`/devices/:id`), if any. */
    fun deviceIdOf(navigateTo: String?): Long? {
        val raw = navigateTo?.trim().orEmpty()
        val path = if (raw.startsWith("/")) raw else pathOf(raw) ?: return null
        return devicePath.matchEntire(path)?.groupValues?.get(1)?.toLongOrNull()
    }

    private fun pathOf(url: String): String? = runCatching {
        val uri = URI(url)
        val p = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
        p + (uri.rawQuery?.let { "?$it" } ?: "")
    }.getOrNull()

    private const val PROBE_ORIGIN = "https://route.invalid"
}

/**
 * A random 128-bit secret of this install, in app-private no-backup storage.
 * [RouteExtras.write] puts it in every PendingIntent of the app's notifications;
 * a route whose token does not match (constant-time) is dropped: another app
 * cannot switch the active server or the tenant, open an S90 page of a
 * configured server, or put its own text on S00 through the exported launcher.
 */
internal object RouteToken {
    const val EXTRA = RouteExtras.PREFIX + "token"
    private const val FILE = "obli_notification_route_token"
    private const val HEX = "0123456789abcdef"

    @Volatile private var cached: String? = null

    fun get(context: Context): String = cached ?: synchronized(this) {
        cached ?: load(context.applicationContext).also { cached = it }
    }

    /** Constant-time comparison with this install's token; false for a missing one. */
    fun matches(context: Context, candidate: String?): Boolean {
        if (candidate.isNullOrEmpty()) return false
        return MessageDigest.isEqual(candidate.toByteArray(Charsets.US_ASCII), get(context).toByteArray(Charsets.US_ASCII))
    }

    private fun load(context: Context): String {
        val file = File(context.noBackupFilesDir, FILE)
        runCatching { file.readText().trim() }.getOrNull()
            ?.takeIf { it.length == 32 && it.all { c -> c in HEX } }
            ?.let { return it }
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val token = buildString(32) { bytes.forEach { b -> append(HEX[(b.toInt() shr 4) and 0xF]).append(HEX[b.toInt() and 0xF]) } }
        // Written once; if it cannot be, the token lives for this process only (older notifications then open nothing).
        runCatching {
            val tmp = File(file.parentFile, FILE + ".tmp")
            tmp.writeText(token)
            if (!tmp.renameTo(file)) {
                file.writeText(token)
                tmp.delete()
            }
        }
        return token
    }
}
