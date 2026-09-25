package tools.obli.core.auth

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.model.ServerColor
import tools.obli.core.model.ServerId
import tools.obli.core.model.ServerProfile
import tools.obli.shell.net.ServerUrl

class ServerRegistryTest {
    private class MemoryStore(var saved: ServerRegistryState? = null) : ServerRegistryStore {
        var saves = 0
        override suspend fun load() = saved
        override suspend fun save(state: ServerRegistryState) { saved = state; saves++ }
    }

    private fun registry(store: MemoryStore = MemoryStore()): ServerRegistry {
        var n = 0
        return ServerRegistry(store) { "id-${++n}" }
    }

    private fun ServerRegistry.addOk(address: String, name: String? = null): ServerProfile = runBlocking {
        (add(address, name) as AddServerResult.Added).profile
    }

    @Test fun firstServerBecomesActive() = runBlocking {
        val r = registry()
        val bh = r.addOk("obliance.binaryhearts.me", "BinaryHearts")
        val at = r.addOk("https://atelier.binaryhearts.me/", "Atelier")
        assertEquals(bh.id, r.state.value.activeId)
        assertEquals("https://atelier.binaryhearts.me", at.origin)
        assertEquals(listOf("BH", "AT"), r.state.value.profiles.map { it.monogram })
        assertEquals(listOf(ServerColor.VIOLET, ServerColor.TEAL), r.state.value.profiles.map { it.color })
        assertTrue(r.state.value.isMultiServer)
    }

    @Test fun sameOriginIsRefused() = runBlocking {
        val r = registry()
        val bh = r.addOk("obliance.binaryhearts.me", "BinaryHearts")
        val again = r.add("HTTPS://Obliance.BinaryHearts.me:443/devices/12")
        assertEquals(AddServerResult.AlreadyConfigured(bh), again)
        assertEquals(1, r.state.value.profiles.size)
    }

    @Test fun invalidAddressIsRefused() = runBlocking {
        val r = registry()
        assertEquals(AddServerResult.Invalid(ServerUrl.Problem.NOT_HTTPS), r.add("http://rmm.durand-associes.fr"))
        assertEquals(AddServerResult.Invalid(ServerUrl.Problem.EMPTY), r.add("  "))
    }

    @Test fun limitOfEight() = runBlocking {
        val r = registry()
        repeat(8) { r.addOk("s$it.example.org") }
        assertEquals(AddServerResult.LimitReached, r.add("s9.example.org"))
        assertEquals(ServerColor.entries.toSet(), r.state.value.profiles.map { it.color }.toSet())
    }

    @Test fun removingActiveActivatesNextAndNotifiesListeners() = runBlocking {
        val r = registry()
        val bh = r.addOk("obliance.binaryhearts.me", "BinaryHearts")
        val at = r.addOk("atelier.binaryhearts.me", "Atelier")
        val purged = mutableListOf<ServerId>()
        r.addRemovalListener { purged += it.id }
        val result = r.remove(bh.id)
        assertEquals(RemoveServerResult.Removed(r.state.value.active), result)
        assertEquals(at.id, r.state.value.activeId)
        assertEquals(0, r.state.value.active!!.order)
        assertEquals(listOf(bh.id), purged)
    }

    @Test fun lastServerCannotBeRemoved() = runBlocking {
        val r = registry()
        val bh = r.addOk("obliance.binaryhearts.me")
        assertEquals(RemoveServerResult.LastServer, r.remove(bh.id))
        assertEquals(RemoveServerResult.NotFound, r.remove(ServerId("nope")))
    }

    @Test fun freedColourIsReused() = runBlocking {
        val r = registry()
        r.addOk("a.example.org"); val b = r.addOk("b.example.org"); r.addOk("c.example.org")
        r.remove(b.id)
        assertEquals(ServerColor.TEAL, r.addOk("d.example.org").color)
    }

    @Test fun renameRecomputesMonogramAndDefaultNameIsHost() = runBlocking {
        val r = registry()
        val cd = r.addOk("rmm.durand-associes.fr")
        assertEquals("rmm.durand-associes.fr", cd.displayName)
        assertTrue(r.rename(cd.id, "  Client   Durand "))
        assertEquals("Client Durand", r.state.value.byId(cd.id)!!.displayName)
        assertEquals("CD", r.state.value.byId(cd.id)!!.monogram)
        assertFalse(r.rename(cd.id, "   "))
    }

    @Test fun reorderNeedsAPermutation() = runBlocking {
        val r = registry()
        val a = r.addOk("a.example.org"); val b = r.addOk("b.example.org")
        assertFalse(r.reorder(listOf(a.id)))
        assertTrue(r.reorder(listOf(b.id, a.id)))
        assertEquals(listOf(b.id to 0, a.id to 1), r.state.value.profiles.map { it.id to it.order })
    }

    @Test fun legacyShellServerIsMigratedOnce() = runBlocking {
        val store = MemoryStore()
        val r = registry(store)
        val state = r.load(legacyServerUrl = "https://obliance.binaryhearts.me/")
        assertEquals("https://obliance.binaryhearts.me", state.active!!.origin)
        assertEquals("obliance.binaryhearts.me", state.active!!.displayName)
        assertEquals(1, store.saves)
        // Next start: the stored registry wins, the legacy URL is ignored.
        val again = registry(store).load(legacyServerUrl = "https://other.example.org")
        assertEquals(state, again)
    }

    @Test fun invalidLegacyUrlGivesEmptyRegistry() = runBlocking {
        val state = registry().load(legacyServerUrl = "http://insecure.example.org")
        assertTrue(state.profiles.isEmpty())
        assertNull(state.activeId)
    }

    @Test fun corruptedStoreIsSanitised() = runBlocking {
        fun p(id: String, origin: String, order: Int) =
            ServerProfile(ServerId(id), origin, id, ServerColor.VIOLET, "XX", order)
        val store = MemoryStore(
            ServerRegistryState(
                profiles = listOf(
                    p("b", "https://b.example.org", 1),
                    p("a", "https://a.example.org", 0),
                    p("dup-origin", "https://a.example.org", 2),
                    p("a", "https://c.example.org", 3),
                    p("bad", "http://d.example.org", 4),
                ),
                activeId = ServerId("gone"),
            ),
        )
        val state = registry(store).load()
        assertEquals(listOf("a", "b"), state.profiles.map { it.id.value })
        assertEquals(ServerId("a"), state.activeId)
    }

    @Test fun byUrlMatchesOrigin() = runBlocking {
        val r = registry()
        val at = r.addOk("atelier.binaryhearts.me")
        assertEquals(at, r.state.value.byUrl("https://atelier.binaryhearts.me/devices/12?tab=processes"))
        assertNull(r.state.value.byUrl("https://evil.example.org/devices/12"))
    }

    @Test fun stateSurvivesJsonRoundTrip() = runBlocking {
        val r = registry()
        r.addOk("obliance.binaryhearts.me", "BinaryHearts"); r.addOk("atelier.binaryhearts.me", "Atelier")
        val json = Json { encodeDefaults = true }
        val text = json.encodeToString(ServerRegistryState.serializer(), r.state.value)
        assertEquals(r.state.value, json.decodeFromString(ServerRegistryState.serializer(), text))
    }
}
