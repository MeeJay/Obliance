package tools.obli.obliance.triage

import tools.obli.core.model.ServerId

/**
 * What À traiter should show when it is opened from outside (a notification
 * tap, a shortcut): handled once by [TriageScreen], which then calls its
 * `onRequestHandled`. Every item is addressed on ITS server; nothing switches
 * the active server (design doc §2.9, §2.10 item 4).
 */
sealed interface TriageRequest {
    /** The Alertes segment; with two servers or more, [serverId] selects that server chip (null = all servers). */
    data class Alerts(val serverId: ServerId?) : TriageRequest

    /**
     * The Approbations segment, then the review sheet (S11) of [approvalId] as
     * soon as the feed of [serverId] contains it (10 s at most); otherwise
     * « Cette demande n'est plus en attente. ».
     */
    data class Approval(val serverId: ServerId, val approvalId: Long) : TriageRequest

    /**
     * The Enrôlements segment, then S12 for [deviceId] of [serverId] once it is
     * loaded (10 s at most); otherwise « Cet appareil n'est plus en attente d'enrôlement. ».
     */
    data class Enrolment(val serverId: ServerId, val deviceId: Long) : TriageRequest

    /** The Enrôlements segment; with two servers or more, [serverId] selects that server chip (null = all servers). */
    data class Enrolments(val serverId: ServerId?) : TriageRequest

    /** The Approbations segment; with two servers or more, [serverId] selects that server chip (null = all servers). */
    data class Approvals(val serverId: ServerId?) : TriageRequest
}
