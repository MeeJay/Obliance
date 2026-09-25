package tools.obli.obliance.access

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import java.util.TimeZone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tools.obli.core.designsystem.ObliTheme
import tools.obli.core.model.ServerId
import tools.obli.core.realtime.ConnectionState
import tools.obli.obliance.data.LocalObliServices
import tools.obli.obliance.data.ObliServices
import tools.obli.obliance.data.TenantsRepository
import tools.obli.obliance.data.sample.SampleData
import tools.obli.obliance.data.sample.SampleObliServices

/** Sample tenants that record every stored global-view filter. */
private class RecordingTenants(private val base: TenantsRepository) : TenantsRepository by base {
    val filters = mutableListOf<Pair<Set<Long>, ServerId?>>()

    override suspend fun setViewFilter(tenantIds: Set<Long>, serverId: ServerId?): Boolean {
        filters += tenantIds to serverId
        return base.setViewFilter(tenantIds, serverId)
    }
}

private class FilterServices(val base: SampleObliServices = SampleObliServices()) : ObliServices by base {
    val recording = RecordingTenants(base.tenants)
    override val tenants: TenantsRepository get() = recording
}

/**
 * S81 "Filtrer la vue globale" driven like a user (taps on the chips of the
 * real sheet content over the §4 sample), plus the screenshots of the
 * section. French, phone 390 dp.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w390dp-h844dp-xxhdpi")
class ScopeViewFilterUiTest {
    @get:Rule val compose = createComposeRule()

    @Before fun setUp() {
        TimeZone.setDefault(TimeZone.getTimeZone("Europe/Paris"))
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After fun tearDown() = Dispatchers.resetMain()

    private fun shot(name: String) = (System.getProperty("roborazzi.output.dir") ?: "build/outputs/roborazzi") + "/" + name

    private fun show(services: ObliServices) {
        compose.setContent {
            ObliTheme { CompositionLocalProvider(LocalObliServices provides services) { ScopeSheetContent(onDone = {}, onManageServers = {}) } }
        }
        compose.waitForIdle()
    }

    @Test fun tappingAcmeStoresItAndTousLesTenantsClearsIt() {
        val services = FilterServices()
        show(services)
        compose.onNodeWithTag(TAG_ALL).assertIsOn()
        compose.onNodeWithTag(tagOf(SampleData.ACME_TENANT)).assertIsOff()

        compose.onNodeWithTag(tagOf(SampleData.ACME_TENANT)).performClick()
        compose.waitForIdle()
        assertEquals(listOf(setOf(SampleData.ACME_TENANT) to null), services.recording.filters)
        // Applied at once, the sheet stays open with the new state.
        assertEquals(listOf(SampleData.ACME_TENANT), services.tenants.scope.value.listTenantIds)
        compose.onNodeWithTag(tagOf(SampleData.ACME_TENANT)).assertIsOn()
        compose.onNodeWithTag(TAG_ALL).assertIsOff()

        compose.onNodeWithTag(TAG_ALL).performClick()
        compose.waitForIdle()
        assertEquals(emptySet<Long>(), services.recording.filters.last().first)
        assertEquals(emptyList<Long>(), services.tenants.scope.value.listTenantIds)
        compose.onNodeWithTag(TAG_ALL).assertIsOn()
    }

    @Test fun selectingEveryTenantIsNoFilter() {
        val services = FilterServices()
        show(services)
        compose.onNodeWithTag(tagOf(SampleData.ACME_TENANT)).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(tagOf(SampleData.DEFAULT_TENANT)).performClick()
        compose.waitForIdle()
        assertEquals(listOf(setOf(SampleData.ACME_TENANT), emptySet()), services.recording.filters.map { it.first })
        compose.onNodeWithTag(TAG_ALL).assertIsOn()
    }

    @Test fun noSectionOutsideTheGlobalView() {
        val services = FilterServices()
        runBlocking { services.tenants.switchTo(SampleData.ACME_TENANT) }
        show(services)
        compose.onNodeWithTag(TAG_ALL).assertDoesNotExist()
    }

    @Test fun screenshotAcmeSelected() {
        // Figures of the mockup (TenantSwitch.dc.html): ACME 248 devices, 1 critical; Default 64.
        val services = SampleObliServices()
        runBlocking { services.tenants.setViewFilter(setOf(SampleData.ACME_TENANT)) }
        val registry = services.registry.state.value
        val auth = registry.profiles.associate { it.id to services.sessions.session(it.id)!!.auth.value }
        val ui = ScopeUi.build(registry, auth, ConnectionState.CONNECTED, services.alerts.snapshot.value, services.tenants.scope.value)
        compose.setContent {
            ObliTheme {
                CompositionLocalProvider(LocalObliServices provides services) {
                    ScopeSheetBody(
                        ui, switchingTo = null, problem = null, onServer = {}, onTenant = {}, onRetryTenants = {}, onManageServers = {},
                        counts = mapOf(SampleData.ACME_TENANT to TenantCount(248, 1), SampleData.DEFAULT_TENANT to TenantCount(64, 0)),
                    )
                }
            }
        }
        compose.waitForIdle()
        compose.onRoot().captureRoboImage(shot("access_scope_sheet_view_filter.png"))
    }

    @Test fun screenshotLiveCounts() {
        // The real loader over the sample devices: ACME 7 · 1 crit., Default 4.
        val services = SampleObliServices()
        show(services)
        compose.onRoot().captureRoboImage(shot("access_scope_sheet_view_filter_all.png"))
    }

    @Test @Config(qualifiers = "en-rUS-w390dp-h844dp-xxhdpi")
    fun screenshotEnglish() {
        val services = SampleObliServices()
        runBlocking { services.tenants.setViewFilter(setOf(SampleData.ACME_TENANT)) }
        show(services)
        compose.onRoot().captureRoboImage(shot("access_scope_sheet_view_filter_en.png"))
    }
}
