package tools.obli.shell.net

import org.junit.Assert.assertEquals
import org.junit.Test
import tools.obli.shell.net.ServerUrl.Problem
import tools.obli.shell.net.ServerUrl.Result

class ServerUrlTest {
    private fun ok(input: String) = (ServerUrl.normalize(input) as Result.Ok).url
    private fun problem(input: String?) = (ServerUrl.normalize(input) as Result.Invalid).problem

    @Test fun trimsAndStripsTrailingSlash() {
        assertEquals("https://obliance.example.com", ok("  https://obliance.example.com/  "))
        assertEquals("https://obliance.example.com", ok("https://obliance.example.com///"))
    }

    @Test fun addsHttpsWhenMissing() {
        assertEquals("https://obliance.example.com", ok("obliance.example.com"))
        assertEquals("https://obliance.example.com:8443", ok("obliance.example.com:8443"))
        assertEquals("https://10.0.0.5", ok("10.0.0.5/"))
    }

    @Test fun lowercasesAndDropsDefaultPort() {
        assertEquals("https://obliance.example.com", ok("HTTPS://Obliance.Example.com:443"))
    }

    @Test fun keepsOnlyTheOrigin() {
        assertEquals("https://obliance.example.com", ok("https://obliance.example.com/devices/12?tab=1#x"))
        assertEquals("https://obliance.example.com", ok("obliance.example.com/login?local=1"))
    }

    @Test fun refusesHttpAndOtherSchemes() {
        assertEquals(Problem.NOT_HTTPS, problem("http://obliance.example.com"))
        assertEquals(Problem.NOT_HTTPS, problem("HTTP://obliance.example.com"))
        assertEquals(Problem.NOT_HTTPS, problem("ftp://obliance.example.com"))
    }

    @Test fun refusesEmptyMalformedAndCredentials() {
        assertEquals(Problem.EMPTY, problem("   "))
        assertEquals(Problem.EMPTY, problem(null))
        assertEquals(Problem.MALFORMED, problem("https://"))
        assertEquals(Problem.MALFORMED, problem("https://exa mple.com"))
        assertEquals(Problem.MALFORMED, problem("https://host:99999"))
        assertEquals(Problem.HAS_CREDENTIALS, problem("https://user:pass@obliance.example.com"))
    }
}
