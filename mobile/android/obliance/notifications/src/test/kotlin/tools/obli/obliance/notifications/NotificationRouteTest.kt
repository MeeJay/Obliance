package tools.obli.obliance.notifications

import android.app.Application
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tools.obli.core.model.ServerId
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** The routing contract read by the app (design doc §2.9). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NotificationRouteTest {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val prod = SampleData.PROD
    private val origin = "https://obliance-prod.example.org"

    @Before fun install() {
        ObliNotifications.install(
            context = app,
            services = SampleObliServices(),
            ready = MutableStateFlow(true),
            launchIntent = { Intent() },
            store = InMemoryNotificationStore(),
            work = WorkScheduler.None,
            scope = scope,
        )
    }

    @After fun tearDown() {
        scope.cancel()
        ObliNotifications.runtime = null
    }

    private val token: String get() = RouteToken.get(app)

    private fun intentOf(route: NotificationRoute) = Intent(ObliNotifications.ACTION_OPEN).also { RouteExtras.write(it, route, token) }.putExtra("app.other", "kept")

    /** Hand-built extras, as the app's own PendingIntents carry them (action + token). */
    private fun rawPath(path: String) = Intent(ObliNotifications.ACTION_OPEN)
        .putExtra(RouteToken.EXTRA, token).putExtra(RouteExtras.KIND, "path").putExtra(RouteExtras.SERVER, prod.value).putExtra(RouteExtras.PATH, path)

    @Test fun everyRouteSurvivesTheIntentRoundTripAndIsConsumed() {
        val routes = listOf(
            NotificationRoute.Device(prod, 187, SampleData.ACME_TENANT, "PC-COMPTA-03", "processes"),
            NotificationRoute.Device(SampleData.QUAL, 5, null, null),
            NotificationRoute.Path(prod, "/admin/security?approval=17", SampleData.ACME_TENANT),
            NotificationRoute.Approval(prod, 17, SampleData.ACME_TENANT),
            NotificationRoute.Enrolment(prod, 240, SampleData.ACME_TENANT, "KIOSK-ACCUEIL-02"),
            NotificationRoute.Enrolments(prod),
            NotificationRoute.Approvals(SampleData.DEV),
            NotificationRoute.Inbox(SampleData.DEV),
            NotificationRoute.SignIn(SampleData.QUAL),
        )
        for (route in routes) {
            val intent = intentOf(route)
            assertEquals(route, ObliNotifications.routeFrom(intent))
            assertFalse(RouteExtras.has(intent))
            assertEquals("kept", intent.getStringExtra("app.other"))
            assertNull("read once only", ObliNotifications.routeFrom(intent))
        }
    }

    @Test fun anUnknownServerIsRejected() {
        val intent = intentOf(NotificationRoute.Device(ServerId("removed-server"), 12, null, null))
        assertNull(ObliNotifications.routeFrom(intent))
        assertFalse(RouteExtras.has(intent))
    }

    @Test fun unsafePathsAreRejected() {
        for (path in listOf("//evil.example", "https://other.example/x", "javascript:alert(1)", "/a\\b", "/with space", "/" + "x".repeat(600))) {
            assertNull(path, ObliNotifications.routeFrom(rawPath(path)))
        }
    }

    @Test fun aDevicePathBecomesADeviceRoute() {
        assertEquals(NotificationRoute.Device(prod, 12, null, null, "processes"), ObliNotifications.routeFrom(rawPath("/devices/12?tab=processes")))
    }

    /**
     * The launcher is exported: another app can start it with route extras.
     * Without this install's token (or with a wrong one, or without
     * ACTION_OPEN) the route is dropped AND stripped, nothing is switched.
     */
    @Test fun aRouteFromAnotherAppIsIgnoredAndStripped() {
        val route = NotificationRoute.Device(SampleData.QUAL, 5, SampleData.ACME_TENANT, "Tapez votre code ici")
        val forged = listOf(
            // A launcher intent carrying the extras, no token.
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).also { RouteExtras.write(it, route, token); it.removeExtra(RouteToken.EXTRA) },
            Intent(ObliNotifications.ACTION_OPEN).also { RouteExtras.write(it, route, "0".repeat(32)) },
            Intent(ObliNotifications.ACTION_OPEN).also { RouteExtras.write(it, route, token.dropLast(1)) },
            Intent(Intent.ACTION_MAIN).also { RouteExtras.write(it, route, token) },
        )
        for (intent in forged) {
            assertNull(ObliNotifications.routeFrom(intent))
            assertFalse("stripped", RouteExtras.has(intent))
        }
    }

    @Test fun theTokenIsStableAndRandom() {
        val t = token
        assertEquals(32, t.length)
        assertEquals(t, RouteToken.get(app))
        assertTrue(RouteToken.matches(app, t))
        assertFalse(RouteToken.matches(app, null))
        assertFalse(RouteToken.matches(app, ""))
    }

    /** What the publisher puts in a notification is accepted (the production path). */
    @Test fun thePublishersOwnIntentIsAccepted() {
        val publisher = AndroidNotificationPublisher(app) { Intent().setClassName(app.packageName, "tools.obli.obliance.app.MainActivity") }
        val route = NotificationRoute.Enrolment(prod, 240, SampleData.ACME_TENANT, "KIOSK-ACCUEIL-02")
        val n = publisher.build(
            PlannedNotification(prod, 7, NotifChannel.ENROLMENTS, "t", "x", null, "p", content = route),
        )
        val intent = org.robolectric.Shadows.shadowOf(n.contentIntent).savedIntent
        assertEquals(route, ObliNotifications.routeFrom(intent))
    }

    @Test fun navigateToIsResolvedAgainstItsOwnServer() {
        fun route(navigateTo: String?) = NotificationRoutes.fromNavigateTo(prod, origin, navigateTo, 4, "PC-COMPTA-03")
        assertEquals(NotificationRoute.Device(prod, 12, 4, "PC-COMPTA-03", "processes"), route("/devices/12?tab=processes"))
        assertEquals(NotificationRoute.Device(prod, 187, 4, "PC-COMPTA-03"), route("/devices/187"))
        assertEquals(NotificationRoute.Device(prod, 187, 4, "PC-COMPTA-03"), route("https://obliance-prod.example.org/devices/187"))
        assertEquals(NotificationRoute.Path(prod, "/schedules?id=3", 4), route("https://obliance-prod.example.org:443/schedules?id=3"))
        assertEquals(NotificationRoute.Path(prod, "/admin/security", 4), route("/admin/security"))
        assertEquals(NotificationRoute.Inbox(prod), route("https://obliance-dev.example.org/devices/5"))
        assertEquals(NotificationRoute.Inbox(prod), route("https://other.example/x"))
        assertEquals(NotificationRoute.Inbox(prod), route("//evil.example"))
        assertEquals(NotificationRoute.Inbox(prod), route("javascript:alert(1)"))
        assertEquals(NotificationRoute.Inbox(prod), route(null))
        assertEquals(NotificationRoute.Inbox(prod), route(""))
        // An invalid tab is dropped, not trusted.
        assertEquals(NotificationRoute.Device(prod, 12, 4, "PC-COMPTA-03"), route("/devices/12?tab=<script>"))
    }

    @Test fun deviceIdsAreReadFromNavigateTo() {
        assertEquals(211L, NotificationRoutes.deviceIdOf("/devices/211"))
        assertEquals(12L, NotificationRoutes.deviceIdOf("/devices/12?tab=processes"))
        assertNull(NotificationRoutes.deviceIdOf("/admin/security"))
        assertNull(NotificationRoutes.deviceIdOf(null))
    }

    @Test fun withoutTheEngineNothingIsRouted() {
        ObliNotifications.runtime = null
        assertNull(ObliNotifications.routeFrom(intentOf(NotificationRoute.Inbox(prod))))
        assertNull(ObliNotifications.routeFrom(null))
        assertNull(ObliNotifications.routeFrom(Intent()))
    }
}
