package tools.obli.obliance.api

/**
 * Socket.IO event names of the Obliance server. The values are the string
 * values of `SocketEvents` in shared/src/socketEvents.ts (the server emits the
 * value, not the key), plus two literals emitted by approval.service.ts that
 * are not in SocketEvents. Socket.IO has no catch-all listener: the realtime
 * client only surfaces the names listed in [LISTENED].
 */
object ObliEvents {
    // Device events
    const val DEVICE_UPDATED = "DEVICE_UPDATED"
    const val DEVICE_METRICS_PUSHED = "DEVICE_METRICS_PUSHED"
    const val DEVICE_SERVICES_UPDATED = "DEVICE_SERVICES_UPDATED"
    const val DISK_HEALTH_UPDATED = "DISK_HEALTH_UPDATED"
    const val DEVICE_APPROVED = "DEVICE_APPROVED"
    const val DEVICE_DELETED = "DEVICE_DELETED"
    const val DEVICE_ONLINE = "DEVICE_ONLINE"
    const val DEVICE_OFFLINE = "DEVICE_OFFLINE"

    // Commands and script executions
    const val COMMAND_UPDATED = "COMMAND_UPDATED"
    const val COMMAND_RESULT = "COMMAND_RESULT"
    const val EXECUTION_UPDATED = "EXECUTION_UPDATED"
    const val EXECUTION_OUTPUT = "EXECUTION_OUTPUT"

    // Scenarios (scenario.service.ts, scenarioGraph.service.ts; tenant room)
    const val SCENARIO_RUN_UPDATED = "SCENARIO_RUN_UPDATED"
    const val SCENARIO_NODE_UPDATED = "SCENARIO_NODE_UPDATED"

    // Live alerts (liveAlert.service.ts: payload = one LiveAlertRow with tenantName)
    const val NOTIFICATION_NEW = "NOTIFICATION_NEW"

    /**
     * 0.3.1: live alerts resolved server-side (a recovery, an escalation of the
     * same incident, a muted metric): payload `{ids: number[]}`, emitted to the
     * same rooms as NOTIFICATION_NEW. Resolved rows are hidden from every list.
     */
    const val NOTIFICATION_RESOLVED = "NOTIFICATION_RESOLVED"

    // Maintenance and processes
    const val MAINTENANCE_CHANGED = "MAINTENANCE_CHANGED"
    const val DEVICE_PROCESSES_UPDATED = "DEVICE_PROCESSES_UPDATED"

    // Client -> server
    const val DEVICE_SUBSCRIBE = "DEVICE_SUBSCRIBE"
    const val DEVICE_UNSUBSCRIBE = "DEVICE_UNSUBSCRIBE"
    const val PROCESS_SUBSCRIBE = "PROCESS_SUBSCRIBE"
    const val PROCESS_UNSUBSCRIBE = "PROCESS_UNSUBSCRIBE"

    // Literals of approval.service.ts (not in SocketEvents); payload = PendingApproval.
    const val APPROVAL_CREATED = "APPROVAL_CREATED"
    const val APPROVAL_UPDATED = "APPROVAL_UPDATED"

    /** Server -> client events the app listens to on the active server's socket. */
    val LISTENED: Set<String> = setOf(
        DEVICE_UPDATED, DEVICE_METRICS_PUSHED, DEVICE_SERVICES_UPDATED, DISK_HEALTH_UPDATED,
        DEVICE_APPROVED, DEVICE_DELETED, DEVICE_ONLINE, DEVICE_OFFLINE,
        COMMAND_UPDATED, COMMAND_RESULT, EXECUTION_UPDATED, EXECUTION_OUTPUT,
        SCENARIO_RUN_UPDATED, SCENARIO_NODE_UPDATED,
        NOTIFICATION_NEW, NOTIFICATION_RESOLVED, MAINTENANCE_CHANGED, DEVICE_PROCESSES_UPDATED,
        APPROVAL_CREATED, APPROVAL_UPDATED,
    )
}
