package tools.obli.obliance.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Web view paths the app shows natively (design doc §2.8). */
class WebRoutesTest {
    @Test fun devicesAndRootAreNative() {
        assertEquals(NativeTarget.Device(233), webPathToNative("/devices/233"))
        assertEquals(NativeTarget.Device(233), webPathToNative("/devices/233/?tab=scripts#x"))
        assertEquals(NativeTarget.Fleet, webPathToNative("/"))
        assertEquals(NativeTarget.Fleet, webPathToNative("/?from=login"))
    }

    @Test fun everythingElseStaysInTheWebView() {
        assertNull(webPathToNative("/devices"))
        assertNull(webPathToNative("/devices/abc"))
        assertNull(webPathToNative("/devices/12/terminal"))
        assertNull(webPathToNative("/admin/users"))
    }
}
