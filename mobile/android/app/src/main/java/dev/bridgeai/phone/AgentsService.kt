package dev.bridgeai.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.os.Build
import android.os.IBinder
import org.json.JSONObject

// Agents at work, on the lock screen: while any are working or waiting on you, an ongoing
// notification says which, and one that starts waiting on you also gets its own alert. It runs as
// a foreground service, which also keeps the app (and the page's link to your computer) going
// while the phone is locked, so the notification stays current. When all are done it says so for
// a while, then goes.
class AgentsService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val state = intent?.getStringExtra(STATE)?.let { runCatching { JSONObject(it) }.getOrNull() }
        val note = state?.let { card(this, it, ended = false) }
        if (note == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (Build.VERSION.SDK_INT >= 34) startForeground(ONGOING, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ONGOING, note)
        return START_NOT_STICKY
    }

    // The app was swiped away: its page (and the link to your computer) went with it.
    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
    }

    companion object {
        const val AGENT = "agent"
        private const val STATE = "state"
        private const val CHANNEL = "agents-at-work"
        private const val ALERTS = "needs-you"
        private const val ONGOING = 1
        private const val ENDED = 2
        private const val NEEDS_YOU = 3
        private const val NEEDS_YOU_COLOR = "#FFA833"
        private const val WORKING_COLOR = "#61A6FF"
        private const val DONE_COLOR = "#4DD180"
        private var lastBlocked = 0

        // From the page: the agents now ({ computer, working, blocked, finished, agents, ended }).
        fun show(context: Context, state: String) {
            val s = runCatching { JSONObject(state) }.getOrNull() ?: return
            val nm = context.getSystemService(NotificationManager::class.java)
            channels(nm)
            alertIfNew(context, nm, s)
            if (s.optBoolean("ended")) {
                stop(context)
                runCatching { nm.notify(ENDED, card(context, s, ended = true)) }
                return
            }
            nm.cancel(ENDED)
            // Android won't start one from the background; it starts while the app is open, and
            // once it runs, updates are fine.
            runCatching { context.startForegroundService(Intent(context, AgentsService::class.java).putExtra(STATE, state)) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AgentsService::class.java))
        }

        private fun channels(nm: NotificationManager) {
            // Default importance but no sound: Android hides "silent" (low importance) ones from
            // the lock screen unless you change its settings. A channel's importance can't be
            // raised once made, so this is a new one in place of the first, silent "agents".
            nm.deleteNotificationChannel("agents")
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Agents at work", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Which agents are working, on the lock screen"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            })
            nm.createNotificationChannel(NotificationChannel(ALERTS, "Agent needs you", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "When an agent starts waiting on you"
            })
        }

        private fun agents(s: JSONObject): List<JSONObject> {
            val list = s.optJSONArray("agents") ?: return emptyList()
            return (0 until list.length()).map { list.getJSONObject(it) }
        }

        private fun card(context: Context, s: JSONObject, ended: Boolean): Notification {
            val list = agents(s)
            val rows = list.map { a ->
                val name = a.optString("name", "Agent")
                when (a.optString("status")) {
                    "blocked" -> "$name: needs you"
                    "done" -> "$name: finished"
                    else -> "$name: working"
                }
            }
            val blocked = s.optInt("blocked")
            val working = s.optInt("working")
            val finished = s.optInt("finished")
            val computer = s.optString("computer")
            val title = if (ended) (if (finished == 1) "Finished" else "All $finished finished")
            else listOfNotNull(if (working > 0) "$working working" else null, if (blocked > 0) "$blocked need${if (blocked == 1) "s" else ""} you" else null).joinToString(" · ")
            val waiting = list.firstOrNull { it.optString("status") == "blocked" }?.optString("id")
            return Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_agents)
                .setColor(Color.parseColor(if (ended) DONE_COLOR else if (blocked > 0) NEEDS_YOU_COLOR else WORKING_COLOR))
                .setContentTitle(title)
                .setContentText(rows.firstOrNull() ?: computer)
                .setSubText(computer)
                .setStyle(Notification.InboxStyle().also { st -> rows.forEach { st.addLine(it) } })
                .setContentIntent(open(context, waiting))
                .setOngoing(!ended)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_PROGRESS)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .apply { if (ended) setAutoCancel(true).setTimeoutAfter(15 * 60 * 1000L) }
                .build()
        }

        // Something new needs you: its own notification, which can make a sound. It goes once
        // nothing does.
        private fun alertIfNew(context: Context, nm: NotificationManager, s: JSONObject) {
            val blocked = s.optInt("blocked")
            val before = lastBlocked
            lastBlocked = blocked
            if (blocked == 0) nm.cancel(NEEDS_YOU) // answered
            if (blocked <= before) return
            val a = agents(s).firstOrNull { it.optString("status") == "blocked" } ?: return
            val note = Notification.Builder(context, ALERTS)
                .setSmallIcon(R.drawable.ic_agents)
                .setColor(Color.parseColor(NEEDS_YOU_COLOR))
                .setContentTitle("${a.optString("name", "An agent")} needs you")
                .setContentText(s.optString("computer"))
                .setContentIntent(open(context, a.optString("id")))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .build()
            runCatching { nm.notify(NEEDS_YOU, note) }
        }

        // Tapping one opens the app, at the agent waiting on you if there is one.
        private fun open(context: Context, id: String?): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).apply { if (id != null) putExtra(AGENT, id) }
            return PendingIntent.getActivity(context, id?.hashCode() ?: 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}
