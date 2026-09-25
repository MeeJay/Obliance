package tools.obli.obliance.notifications

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit
import tools.obli.core.model.ServerId

/**
 * One background pass (periodic every 15 min, or "Vérifier maintenant"). Thin:
 * waits for the app's registry, then runs [NotificationPass].
 */
internal class AlertsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val runtime = ObliNotifications.runtime ?: return Result.success()
        if (!runtime.awaitReady()) return Result.retry()
        runtime.ensureChannels()
        runtime.pass().run()
        return Result.success()
    }
}

/** One reminder of an unread critical alert while on call (5 min, 3 times max). */
internal class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val runtime = ObliNotifications.runtime ?: return Result.success()
        if (!runtime.awaitReady()) return Result.retry()
        val server = inputData.getString(KEY_SERVER)?.takeIf { it.isNotBlank() && it.length <= 64 } ?: return Result.success()
        val alertId = inputData.getLong(KEY_ALERT, -1).takeIf { it > 0 } ?: return Result.success()
        val attempt = inputData.getInt(KEY_ATTEMPT, 1)
        runtime.ensureChannels()
        runtime.reminders().run(ServerId(server), alertId, attempt)
        return Result.success()
    }

    companion object {
        const val KEY_SERVER = "server"
        const val KEY_ALERT = "alert"
        const val KEY_ATTEMPT = "attempt"
    }
}

/** WorkManager behind [WorkScheduler]; every call tolerates a missing WorkManager (tests). */
internal class AndroidWork(private val context: Context) : WorkScheduler {
    private fun wm(): WorkManager? = runCatching { WorkManager.getInstance(context) }.getOrNull()

    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    override fun enqueuePeriodic() {
        val request = PeriodicWorkRequestBuilder<AlertsWorker>(15, TimeUnit.MINUTES)
            .setConstraints(network)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
            .build()
        runCatching { wm()?.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request) }
    }

    override fun cancelPeriodic() {
        runCatching { wm()?.cancelUniqueWork(PERIODIC) }
    }

    override fun checkNow() {
        val request = OneTimeWorkRequestBuilder<AlertsWorker>().setConstraints(network).build()
        // After a pass already running (a server was just added, or a second tap).
        runCatching { wm()?.enqueueUniqueWork(CHECK_NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, request) }
    }

    override fun scheduleReminder(serverId: ServerId, alertId: Long, attempt: Int) {
        val request = OneTimeWorkRequestBuilder<ReminderWorker>()
            .setInitialDelay(ReminderPolicy.DELAY_MINUTES, TimeUnit.MINUTES)
            .setInputData(workDataOf(ReminderWorker.KEY_SERVER to serverId.value, ReminderWorker.KEY_ALERT to alertId, ReminderWorker.KEY_ATTEMPT to attempt))
            .addTag(reminderTag(serverId))
            .build()
        runCatching { wm()?.enqueueUniqueWork(reminderName(serverId, alertId), ExistingWorkPolicy.REPLACE, request) }
    }

    override fun cancelReminder(serverId: ServerId, alertId: Long) {
        runCatching { wm()?.cancelUniqueWork(reminderName(serverId, alertId)) }
    }

    override fun cancelReminders(serverId: ServerId) {
        runCatching { wm()?.cancelAllWorkByTag(reminderTag(serverId)) }
    }

    companion object {
        const val PERIODIC = "obli-next-alerts"
        const val CHECK_NOW = "obli-next-alerts-now"

        fun reminderName(serverId: ServerId, alertId: Long) = "obli-next-reminder-${serverId.value}-$alertId"
        fun reminderTag(serverId: ServerId) = "obli-next-reminder-${serverId.value}"
    }
}
