package tools.obli.obliance.automations

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/*
 * Tolerant DTOs of the automation routes (CONTRACT §7): every field has a
 * default, unknown keys are ignored (ApiJson). Shapes copied from the server:
 * script.service.ts `rowToScript`, execution.routes.ts, schedule.routes.ts
 * `rowToSchedule`, scenario.service.ts `rowToScenario` / `rowToRun`,
 * shared/src/types.ts. Ids of executions, commands and runs are strings (UUID
 * or bigint as text); numbers sent as strings are accepted.
 */

/** shared `ScriptParameterType`. */
internal enum class ParamType(val wire: String) {
    STRING("string"), NUMBER("number"), BOOLEAN("boolean"), SECRET("secret"), SELECT("select"), MULTISELECT("multiselect");

    companion object {
        fun parse(raw: String?): ParamType = entries.firstOrNull { it.wire == raw } ?: STRING
    }
}

/** shared `ScriptParameter` (only on `GET /api/scripts/:id`). */
@Serializable
internal data class ScriptParameterDto(
    val id: Long = 0,
    val name: String = "",
    val label: String = "",
    val description: String? = null,
    val type: String = "string",
    val options: List<String> = emptyList(),
    val defaultValue: String? = null,
    val required: Boolean = false,
    val sortOrder: Int = 0,
) {
    val kind: ParamType get() = ParamType.parse(type)
    val title: String get() = label.ifBlank { name }
}

/** shared `ScriptCategory`. */
@Serializable
internal data class ScriptCategoryDto(
    val id: Long = 0,
    val tenantId: Long? = null,
    val name: String = "",
    val sortOrder: Int = 0,
)

@Serializable
internal data class ScriptUsage(val scenarios: Int = 0, val schedules: Int = 0)

/** shared `Script`: the list carries `content` and `usage`, the detail `parameters`. */
@Serializable
internal data class ScriptDto(
    val id: Long = 0,
    val tenantId: Long? = null,
    val targetTenantIds: List<Long>? = null,
    val categoryId: Long? = null,
    val name: String = "",
    val description: String? = null,
    val tags: List<String> = emptyList(),
    val platform: String = "all",
    val runtime: String = "",
    val content: String = "",
    val timeoutSeconds: Int = 0,
    val expectedExitCode: Int = 0,
    val runAs: String = "system",
    val scriptType: String = "user",
    val isBuiltin: Boolean = false,
    val purpose: String? = null,
    val parameters: List<ScriptParameterDto>? = null,
    val usage: ScriptUsage? = null,
) {
    val isSystem: Boolean get() = scriptType == "system"
}

/** One row of the 202 of `POST /api/scripts/:id/execute`. */
@Serializable
internal data class StartedExecution(
    val id: String = "",
    val deviceId: Long = 0,
    val scriptId: Long = 0,
    val batchId: String? = null,
    val status: String = "pending",
    val triggeredAt: String? = null,
)

/** shared `ExecutionBatch` (`GET /api/executions/batches` → `data.items`). */
@Serializable
internal data class BatchSummary(
    val batchId: String = "",
    val scriptId: Long = 0,
    val scriptName: String = "",
    val scheduleId: Long? = null,
    val scheduleName: String? = null,
    val triggeredBy: String = "",
    val triggeredByUsername: String? = null,
    val triggeredAt: String? = null,
    val totalCount: Int = 0,
    val successCount: Int = 0,
    val failureCount: Int = 0,
    val pendingCount: Int = 0,
    val runningCount: Int = 0,
) {
    val inFlight: Boolean get() = pendingCount + runningCount > 0
    val doneCount: Int get() = (totalCount - pendingCount - runningCount).coerceAtLeast(0)
}

@Serializable
internal data class BatchPage(val items: List<BatchSummary> = emptyList(), val total: Int = 0)

/** One row of `GET /api/executions/batches/:batchId` (execution.routes.ts). */
@Serializable
internal data class BatchExecution(
    val id: String = "",
    val deviceId: Long = 0,
    /** display_name || hostname. */
    val hostname: String? = null,
    val osType: String? = null,
    val status: String = "pending",
    val exitCode: Int? = null,
    val stdout: String? = null,
    val stderr: String? = null,
    val triggeredAt: String? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
)

@Serializable
internal data class ScriptSnapshot(
    val id: Long = 0,
    val name: String = "",
    val platform: String = "",
    val runtime: String = "",
    val content: String = "",
    val timeoutSeconds: Int = 0,
    val runAs: String? = null,
)

/** `GET /api/executions/:id` (execution.routes.ts `rowToExecution`). */
@Serializable
internal data class ExecutionDetail(
    val id: String = "",
    val tenantId: Long? = null,
    val scriptId: Long = 0,
    val deviceId: Long = 0,
    val batchId: String? = null,
    val commandQueueId: String? = null,
    val scriptSnapshot: ScriptSnapshot? = null,
    val parameterValues: JsonObject? = null,
    val status: String = "",
    val triggeredBy: String? = null,
    val triggeredByUserId: Long? = null,
    val triggeredAt: String? = null,
    val sentAt: String? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val exitCode: Int? = null,
    val stdout: String? = null,
    val stderr: String? = null,
)

/** Payload of `EXECUTION_UPDATED` (command.service.ts / schedule.service.ts sweeper). */
@Serializable
internal data class ExecutionEvent(
    val id: String = "",
    val batchId: String? = null,
    val deviceId: Long? = null,
    val status: String = "",
    val exitCode: Int? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
)

/** Payload of `COMMAND_UPDATED` (command.service.ts `rowToCommand`, only what the batch uses). */
@Serializable
internal data class CommandEvent(
    val id: String = "",
    val deviceId: Long? = null,
    val type: String = "",
    val status: String = "",
    val sourceType: String? = null,
    /** The execution id when [sourceType] is `script_execution`. */
    val sourceId: String? = null,
)

/** schedule.routes.ts `rowToSchedule` + `resolvedDeviceCount`. */
@Serializable
internal data class ScheduleDto(
    val id: Long = 0,
    val tenantId: Long? = null,
    val targetTenantIds: List<Long>? = null,
    val scriptId: Long = 0,
    val name: String = "",
    val description: String? = null,
    val targetType: String = "device",
    val targetIds: List<Long> = emptyList(),
    val cronExpression: String? = null,
    val fireOnceAt: String? = null,
    val timezone: String? = null,
    val enabled: Boolean = true,
    val lastRunAt: String? = null,
    val nextRunAt: String? = null,
    val resolvedDeviceCount: Int? = null,
)

/** scenario.service.ts `list` item: `rowToScenario` + counts. */
@Serializable
internal data class ScenarioDto(
    val id: Long = 0,
    val tenantId: Long? = null,
    val targetTenantIds: List<Long>? = null,
    val name: String = "",
    val description: String? = null,
    val triggerType: String? = null,
    val targetType: String? = null,
    val targetIds: List<Long> = emptyList(),
    val status: String = "draft",
    val nodeCount: Int = 0,
    val stepCount: Int = 0,
    val activeRunCount: Int = 0,
    /** Trigger node counts without the `trigger_` prefix (`manual: 1, schedule_cron: 2`). */
    val triggerCounts: Map<String, Int> = emptyMap(),
    val updatedAt: String? = null,
)

@Serializable
internal data class ScenarioPage(val items: List<ScenarioDto> = emptyList(), val total: Int = 0)

@Serializable
internal data class RunDevice(val id: Long = 0, val hostname: String = "", val displayName: String? = null, val osType: String? = null) {
    val label: String get() = displayName?.takeIf { it.isNotBlank() } ?: hostname
}

/** v2 node trace of `GET /api/scenarios/runs/:runId` (`nodeRuns`). */
@Serializable
internal data class NodeRunDto(
    val id: String = "",
    val nodeId: Long = 0,
    val nodeType: String = "",
    val nodeLabel: String? = null,
    val status: String = "",
    val exitCode: Int? = null,
    val stdout: String? = null,
    val stderr: String? = null,
    val errorMessage: String? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
)

/** scenario.service.ts `rowToRun` (+ `nodeRuns` on the detail). */
@Serializable
internal data class ScenarioRunDto(
    val id: String = "",
    val scenarioId: Long = 0,
    val deviceId: Long = 0,
    val triggerType: String? = null,
    val triggerSource: String? = null,
    val status: String = "",
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val errorMessage: String? = null,
    val createdAt: String? = null,
    val device: RunDevice? = null,
    val nodeRuns: List<NodeRunDto> = emptyList(),
) {
    val inFlight: Boolean get() = status == "pending" || status == "running"
}

@Serializable
internal data class ScenarioRunPage(val items: List<ScenarioRunDto> = emptyList(), val total: Int = 0)

/** 202 of `POST /api/scenarios/:id/start-graph-run`. */
@Serializable
internal data class GraphRunStarted(
    val runIds: List<String> = emptyList(),
    val runId: String? = null,
    val batchMarker: String? = null,
    val failures: List<GraphRunFailure>? = null,
)

@Serializable
internal data class GraphRunFailure(val deviceId: Long = 0, val error: String = "")
