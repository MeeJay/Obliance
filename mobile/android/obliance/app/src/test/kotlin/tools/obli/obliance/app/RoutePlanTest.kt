package tools.obli.obliance.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import tools.obli.core.auth.ServerRegistryState
import tools.obli.core.model.ServerId
import tools.obli.core.model.SessionProbe
import tools.obli.obliance.api.DeviceLocation
import tools.obli.obliance.data.TenantScope
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleData.ACME_TENANT
import tools.obli.obliance.data.sample.SampleData.DEFAULT_TENANT
import tools.obli.obliance.data.sample.SampleData.DEV
import tools.obli.obliance.data.sample.SampleData.PROD
import tools.obli.obliance.data.sample.SampleData.QUAL
import tools.obli.obliance.notifications.NotificationRoute
import tools.obli.obliance.triage.TriageRequest

/**
 * The notification router (design doc §2.9, §2.10 items 3-5, §2.3 rule 1):
 * every route type, the master-admin versus member tenant rule, unknown
 * servers. Pure JVM: what the shell then does is covered by MainActivityShellTest.
 */
class RoutePlanTest {
    private val three = ServerRegistryState(SampleData.profiles, PROD)
    private val one = ServerRegistryState(SampleData.profiles.take(1), PROD)

    /** The active server (Prod) in the global view. */
    private val prodScope = TenantScope(PROD, SampleData.tenants, DEFAULT_TENANT)

    /** Platform admin on the master tenant (Karim on Prod). */
    private val masterAdmin = SampleData.probe(PROD)

    /** A member (not a platform admin) of Default (Karim on Qual). */
    private val member = SampleData.probe(QUAL)

    private fun plan(route: NotificationRoute, registry: ServerRegistryState = three, scope: TenantScope = prodScope, probe: SessionProbe? = masterAdmin) =
        planRoute(route, registry, scope, probe)

    // --- Device ------------------------------------------------------------------------------

    @Test fun deviceOfTheActiveServerAsMasterAdminStaysInTheGlobalView() {
        val p = plan(NotificationRoute.Device(PROD, 187, ACME_TENANT, "PC-COMPTA-03", tab = "processes"))
        assertEquals(RoutePlan.OpenDevice(PROD, 187, "processes", "PC-COMPTA-03", switchServer = false, tenant = TenantRule.Stay), p)
    }

    @Test fun deviceOfAnotherServerSwitchesServerAndLocatesForAMember() {
        val p = plan(NotificationRoute.Device(QUAL, 5, tenantId = null, label = "SRV-QUAL01"), probe = member)
        assertEquals(RoutePlan.OpenDevice(QUAL, 5, null, "SRV-QUAL01", switchServer = true, tenant = TenantRule.Locate(DEFAULT_TENANT)), p)
    }

    @Test fun memberWhoseSessionIsAlreadyOnTheDevicesTenantDoesNotLocate() {
        val p = plan(NotificationRoute.Device(QUAL, 5, tenantId = DEFAULT_TENANT, label = null), probe = member) as RoutePlan.OpenDevice
        assertEquals(TenantRule.Stay, p.tenant)
    }

    @Test fun platformAdminWorkingInsideATenantLocates() {
        // Karim switched Prod to ACME: an alert of Default must switch back (only the master tenant sees everything).
        val inAcme = prodScope.copy(currentTenantId = ACME_TENANT)
        val p = plan(NotificationRoute.Device(PROD, 15, DEFAULT_TENANT, "BOB01"), scope = inAcme, probe = masterAdmin.copy(currentTenantId = ACME_TENANT)) as RoutePlan.OpenDevice
        assertEquals(TenantRule.Locate(ACME_TENANT), p.tenant)
    }

    @Test fun theActiveScopeIsFresherThanTheProbe() {
        // The probe still says Default, the scope already switched to ACME (same server, active).
        val inAcme = prodScope.copy(currentTenantId = ACME_TENANT)
        val p = plan(NotificationRoute.Device(PROD, 187, ACME_TENANT, null), scope = inAcme, probe = masterAdmin) as RoutePlan.OpenDevice
        assertEquals(TenantRule.Stay, p.tenant)
    }

    @Test fun noSignedInSessionStaysAndLetsTheDetailSayWhy() {
        val p = plan(NotificationRoute.Device(DEV, 20, null, "NAS-DEV01"), probe = null) as RoutePlan.OpenDevice
        assertEquals(TenantRule.Stay, p.tenant)
        assertEquals(true, p.switchServer)
    }

    @Test fun locateDecidesTheSwitch() {
        val rule = TenantRule.Locate(DEFAULT_TENANT)
        assertEquals(ACME_TENANT, tenantToSwitch(rule, DeviceLocation(5, "SRV-QUAL01", tenantId = ACME_TENANT)))
        assertNull(tenantToSwitch(rule, DeviceLocation(5, "SRV-QUAL01", tenantId = DEFAULT_TENANT)))
        // 404 (missing or not accessible) or a failure: stay.
        assertNull(tenantToSwitch(rule, null))
        assertNull(tenantToSwitch(rule, DeviceLocation(5, "SRV-QUAL01", tenantId = null)))
        assertNull(tenantToSwitch(TenantRule.Stay, DeviceLocation(5, "SRV-QUAL01", tenantId = ACME_TENANT)))
    }

    @Test fun oneSnackbarNamesWhatChanged() {
        assertEquals("Obliance Qual › Default" to true, switchTarget("Obliance Qual", "Default"))
        assertEquals("Obliance Qual" to true, switchTarget("Obliance Qual", null))
        assertEquals("ACME" to false, switchTarget(null, "ACME"))
        assertNull(switchTarget(null, null))
    }

    // --- Path --------------------------------------------------------------------------------

    @Test fun pathOpensOnItsOwnServer() {
        assertEquals(RoutePlan.OpenPath(DEV, "/admin/supervision", switchServer = true), plan(NotificationRoute.Path(DEV, "/admin/supervision", null)))
        assertEquals(RoutePlan.OpenPath(PROD, "/", switchServer = false), plan(NotificationRoute.Path(PROD, "/", null)))
    }

    // --- Inbox items: never a server switch ----------------------------------------------------

    @Test fun approvalAndEnrolmentGoToTriageWithoutSwitching() {
        assertEquals(RoutePlan.Triage(TriageRequest.Approval(QUAL, 17)), plan(NotificationRoute.Approval(QUAL, 17, ACME_TENANT)))
        assertEquals(RoutePlan.Triage(TriageRequest.Enrolment(DEV, 240)), plan(NotificationRoute.Enrolment(DEV, 240, ACME_TENANT, "KIOSK-ACCUEIL-02")))
    }

    /** « N appareils / demandes en attente » of a burst: the segment, on that server's chip (2+ servers), no switch. */
    @Test fun burstSummariesOpenTheirSegment() {
        assertEquals(RoutePlan.Triage(TriageRequest.Enrolments(DEV)), plan(NotificationRoute.Enrolments(DEV)))
        assertEquals(RoutePlan.Triage(TriageRequest.Approvals(QUAL)), plan(NotificationRoute.Approvals(QUAL)))
        assertEquals(RoutePlan.Triage(TriageRequest.Enrolments(null)), plan(NotificationRoute.Enrolments(PROD), registry = one))
    }

    @Test fun inboxFiltersOnItsServerOnlyWithTwoServersOrMore() {
        assertEquals(RoutePlan.Triage(TriageRequest.Alerts(QUAL)), plan(NotificationRoute.Inbox(QUAL)))
        assertEquals(RoutePlan.Triage(TriageRequest.Alerts(null)), plan(NotificationRoute.Inbox(PROD), registry = one))
    }

    // --- Sign in -----------------------------------------------------------------------------

    @Test fun signInOfTheActiveServerShowsItsSheet() {
        assertEquals(RoutePlan.ReauthActive, plan(NotificationRoute.SignIn(PROD), probe = null))
    }

    @Test fun signInOfAnotherServerKeepsTheActiveOne() {
        assertEquals(RoutePlan.ReauthOther(QUAL), plan(NotificationRoute.SignIn(QUAL), probe = null))
    }

    @Test fun signInOfAServerSignedInAgainJustOpensTriage() {
        assertEquals(RoutePlan.Triage(TriageRequest.Alerts(QUAL)), plan(NotificationRoute.SignIn(QUAL), probe = member))
    }

    // --- Removed or unknown server -------------------------------------------------------------

    @Test fun unknownServerOpensTriageOnly() {
        val gone = ServerId("removed-server")
        listOf(
            NotificationRoute.Device(gone, 1, null, null),
            NotificationRoute.Path(gone, "/", null),
            NotificationRoute.Approval(gone, 1, null),
            NotificationRoute.Enrolment(gone, 1, null, null),
            NotificationRoute.Inbox(gone),
            NotificationRoute.SignIn(gone),
        ).forEach { assertEquals(RoutePlan.Triage(null), plan(it)) }
        // A server of the sample that this phone does not have (one server configured).
        assertEquals(RoutePlan.Triage(null), plan(NotificationRoute.Device(QUAL, 5, null, null), registry = one))
    }
}
