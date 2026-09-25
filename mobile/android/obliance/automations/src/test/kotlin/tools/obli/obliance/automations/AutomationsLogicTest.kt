package tools.obli.obliance.automations

import java.util.Locale
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tools.obli.core.security.Tier
import tools.obli.obliance.data.sample.SampleData

class AutomationsLogicTest {
    private fun dev(name: String) = SampleData.devices.first { it.hostname == name }

    // Parameters ---------------------------------------------------------------

    @Test fun defaultsComeFromTheDefinitions() {
        val fields = AutoSample.cleanParams.map { ParamField.initial(it) }
        assertEquals("7", fields[0].text)
        assertFalse(fields[1].checked)
        assertEquals(buildJsonObject { put("min_age_days", JsonPrimitive(7)); put("include_browsers", JsonPrimitive(false)) }, fields.toParameterValues())
    }

    @Test fun typedWireValues() {
        fun def(type: String, options: List<String> = emptyList(), required: Boolean = false) = ScriptParameterDto(name = "p", label = "P", type = type, options = options, required = required)
        assertEquals(JsonPrimitive(7), ParamField(def("number"), text = "7").wireValue())
        assertEquals(JsonPrimitive(2.5), ParamField(def("number"), text = "2,5").wireValue())
        assertEquals(JsonPrimitive(true), ParamField(def("boolean"), checked = true).wireValue())
        assertEquals(JsonPrimitive("s3cr3t"), ParamField(def("secret"), text = "s3cr3t").wireValue())
        // Go %v substitution: a comma list, in the definition's order.
        assertEquals(JsonPrimitive("C:,D:"), ParamField(def("multiselect", listOf("C:", "D:", "E:")), selected = setOf("D:", "C:")).wireValue())
        assertNull(ParamField(def("string"), text = "").wireValue())
        assertEquals(ParamProblem.REQUIRED, ParamField(def("string", required = true)).problem)
        assertEquals(ParamProblem.NOT_A_NUMBER, ParamField(def("number"), text = "sept").problem)
        assertEquals(ParamProblem.NOT_AN_OPTION, ParamField(def("select", listOf("a", "b")), text = "c").problem)
        assertNull(ParamField(def("select", listOf("a", "b")), text = "a").problem)
    }

    @Test fun rerunPrefillsButNeverASecret() {
        val prev = buildJsonObject { put("min_age_days", JsonPrimitive(14)); put("pwd", JsonPrimitive("hunter2")); put("disks", JsonArray(listOf(JsonPrimitive("C:")))) }
        assertEquals("14", ParamField.prefilled(AutoSample.cleanParams[0], prev["min_age_days"]).text)
        assertEquals("", ParamField.prefilled(ScriptParameterDto(name = "pwd", type = "secret"), prev["pwd"]).text)
        assertEquals(setOf("C:"), ParamField.prefilled(ScriptParameterDto(name = "disks", type = "multiselect", options = listOf("C:", "D:")), prev["disks"]).selected)
    }

    @Test fun secretLinesAreMasked() {
        val line = ParamField(ScriptParameterDto(name = "pwd", label = "Mot de passe", type = "secret"), text = "hunter2").line()!!
        assertTrue(line.secret)
        assertNull(line.text)
    }

    // Tiers and pre-checks ------------------------------------------------------

    @Test fun tiersFollowTheTargetCount() {
        assertEquals(Tier.T1, tierForTargets(1))
        assertEquals(Tier.T2, tierForTargets(2))
        assertEquals(Tier.T2, tierForTargets(9))
        assertEquals(Tier.T3, tierForTargets(10))
    }

    @Test fun platformMismatchIsSkippedAndOfflineKept() {
        val c = RunChecks.of("windows", listOf(dev("PC-COMPTA-03"), dev("BOB01"), dev("SRV-AD2")))
        assertEquals(listOf("PC-COMPTA-03", "SRV-AD2"), c.runnable.map { it.hostname })
        assertEquals(listOf("BOB01"), c.platformSkipped.map { it.hostname })
        assertEquals(listOf("SRV-AD2"), c.offline.map { it.hostname })
        assertTrue(c.mixedTenants.not())
        assertEquals(SampleData.ACME_TENANT to "ACME", c.switchTo(SampleData.DEFAULT_TENANT))
        assertNull(c.switchTo(SampleData.ACME_TENANT))
    }

    @Test fun mixedTenantsAreRefusedAndPendingDevicesDropped() {
        val c = RunChecks.of("all", listOf(dev("PC-COMPTA-01"), dev("HV-01"), dev("KIOSK-ACCUEIL-02")))
        assertTrue(c.mixedTenants)
        assertFalse(c.canRun)
        assertEquals(listOf("KIOSK-ACCUEIL-02"), c.notApproved.map { it.hostname })
    }

    @Test fun legacyAndPrivacyAreFlagged() {
        val c = RunChecks.of("windows", listOf(dev("SRV-LEGACY")))
        assertEquals(1, c.legacy.size)
        val m = RunChecks.of("macos", listOf(dev("MAC-DIRECTION")))
        assertEquals(1, m.privacy.size)
    }

    // Batch merge ---------------------------------------------------------------

    private val live = BatchMerge.fromServer(emptyList(), AutoSample.batchRows(finished = false))

    @Test fun socketStepsMoveForwardOnly() {
        var rows = BatchMerge.command(live, CommandEvent("c3", 187, "run_script", "sent", "script_execution", "9003"))
        assertEquals(ExecStep.SENT, rows.first { it.executionId == "9003" }.step)
        rows = BatchMerge.command(rows, CommandEvent("c3", 187, "run_script", "ack_running", "script_execution", "9003"))
        assertEquals(ExecStep.RUNNING, rows.first { it.executionId == "9003" }.step)
        // A late "sent" never moves it back; an unrelated command changes nothing.
        rows = BatchMerge.command(rows, CommandEvent("c3", 187, "run_script", "sent", "script_execution", "9003"))
        assertEquals(ExecStep.RUNNING, rows.first { it.executionId == "9003" }.step)
        assertEquals(rows, BatchMerge.command(rows, CommandEvent("x", 187, "reboot", "sent", null, null)))
        // The server GET still says pending (script_executions only changes at the end): the row stays running.
        rows = BatchMerge.fromServer(rows, AutoSample.batchRows(finished = false))
        assertEquals(ExecStep.RUNNING, rows.first { it.executionId == "9003" }.step)
    }

    @Test fun executionEventIsFinalAndTheGetBringsTheOutput() {
        var rows = BatchMerge.execution(live, ExecutionEvent("9003", BATCH, 187, "failure", 1, "2026-09-25T08:42:03.200Z", "2026-09-25T08:42:08Z"))
        val r = rows.first { it.executionId == "9003" }
        assertEquals(ExecStep.FAILURE, r.step)
        assertEquals(4_800L, r.durationMs)
        rows = BatchMerge.fromServer(rows, AutoSample.batchRows(finished = true))
        assertEquals(DENIED, rows.first { it.executionId == "9003" }.stderr)
    }

    @Test fun reportText() {
        val s = BatchUiState(SampleData.PROD, BATCH, scriptName = "Nettoyer les fichiers temporaires", rows = BatchMerge.fromServer(emptyList(), AutoSample.batchRows()))
        val texts = ReportTexts({ ok, total -> "$ok/$total réussis" }, { if (it == ExecStep.FAILURE) "échec" else it.name }, { "code $it" })
        assertEquals(
            "Nettoyer les fichiers temporaires — 10:42 — 2/3 réussis\nPC-COMPTA-03 : échec (code 1) — $DENIED",
            BatchMerge.report(s, "10:42", texts),
        )
    }

    // Formatting ----------------------------------------------------------------

    @Test fun durations() {
        assertEquals("4,8 s", Fmt.duration(4_800, Locale.FRANCE))
        assertEquals("14 s", Fmt.duration(14_000, Locale.FRANCE))
        assertEquals("2 min 05 s", Fmt.duration(125_000, Locale.FRANCE))
        assertEquals("10:42", Fmt.time("2026-09-25T08:42:02Z", PARIS))
    }

    @Test fun cronInWords() {
        assertEquals(CronDesc.Daily(2, 0), CronDesc.of("0 2 * * *", null))
        assertEquals(CronDesc.Weekly(0, 3, 0), CronDesc.of("0 3 * * 0", null))
        assertEquals(CronDesc.EveryMinutes(15), CronDesc.of("*/15 * * * *", null))
        assertEquals(CronDesc.Weekdays(8, 30), CronDesc.of("30 8 * * 1-5", null))
        assertEquals(CronDesc.Monthly(1, 6, 0), CronDesc.of("0 6 1 * *", null))
        assertEquals(CronDesc.Raw("0 2 * 1 *"), CronDesc.of("0 2 * 1 *", null))
        assertEquals(CronDesc.Once("2026-10-01T06:00:00Z"), CronDesc.of(null, "2026-10-01T06:00:00Z"))
    }

    @Test fun scriptsPathOnlyCarriesWhatIsSet() {
        assertEquals("/api/scripts", AutomationsRequests.scriptsPath(null, " ", null))
        assertEquals("/api/scripts", AutomationsRequests.scriptsPath("all", null, null))
        assertEquals("/api/scripts?platform=windows&search=cache%20DNS&categoryId=3", AutomationsRequests.scriptsPath("windows", "cache DNS", 3))
    }

    @Test fun serverIdsNeverLeaveTheirPathSegment() {
        assertEquals(BATCH, HttpAutomationsRemote.seg(BATCH))
        assertEquals("invalid", HttpAutomationsRemote.seg("../devices"))
    }
}
