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

    private fun intentOf(route: NotificationRoute) = Intent(ObliNotifications.ACTION_OPEN).also { RouteExtras.write(it, route) }.putExtra("app.other", "kept")

    @Test fun everyRouteSurvivesTheIntentRoundTripAndIsConsumed() {
        val routes = listOf(
            NotificationRoute.Device(prod, 187, SampleData.ACME_TENANT, "PC-COMPTA-03", "processes"),
            NotificationRoute.Device(SampleData.QUAL, 5, null, null),
            NotificationRoute.Path(prod, "/admin/security?approval=17", SampleData.ACME_TENANT),
            NotificationRoute.Approval(prod, 17, SampleData.ACME_TENANT),
            NotificationRoute.Enrolment(prod, 240, SampleData.ACME_TENANT, "KIOSK-ACCUEIL-02"),
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
            val intent = Intent().putExtra(RouteExtras.KIND, "path").putExtra(RouteExtras.SERVER, prod.value).putExtra(RouteExtras.PATH, path)
            assertNull(path, ObliNotifications.routeFrom(intent))
        }
    }

    @Test fun aDevicePathBecomesADeviceRoute() {
        val intent = Intent().putExtra(RouteExtras.KIND, "path").putExtra(RouteExtras.SERVER, prod.value).putExtra(RouteExtras.PATH, "/devices/12?tab=processes")
        assertEquals(NotificationRoute.Device(prod, 12, null, null, "processes"), ObliNotifications.routeFrom(intent))
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
