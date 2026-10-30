package dev.bridgeai.phone

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Cloud agents' background check, while the app isn't open: at most every 15 minutes (the
// shortest WorkManager allows, and Android may space it out more), only while a key is saved on
// the phone and notifications are allowed. It opens the Cloud agents page with no window
// (?check=1), which looks once at the agents started from this phone, in the same code as when
// the app is open, and asks for a notification for each that finished, failed or needs you.
// Agents on your computer are its business: this only follows keys saved on the phone.
class CloudCheck(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val app = applicationContext
        // The page is open and looking itself, or there's nothing to look at.
        if (MainActivity.cloudShowing || !CloudVault(app).any() || !CloudBridge.available(app)) return Result.success()
        val finished = CountDownLatch(1)
        var web: WebView? = null
        main.post {
            runCatching {
                web = WebView(app).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    val loader = CloudBridge.loader(app)
                    CloudBridge.attach(this, CloudBridge(app, check = object : CloudBridge.Check {
                        override fun notify(pane: String, title: String, body: String) = Companion.notify(app, pane, title, body)
                        override fun done() = finished.countDown()
                    }))
                    webViewClient = object : WebViewClient() {
                        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                            if (request.url.host == CloudBridge.HOST) CloudBridge.serve(loader, request.url) else null
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = request.url.host != CloudBridge.HOST
                    }
                    loadUrl("${CloudBridge.PAGE}?check=1")
                }
            }.onFailure { finished.countDown() }
        }
        finished.await(90, TimeUnit.SECONDS)
        main.post { web?.destroy() }
        return Result.success()
    }

    companion object {
        private const val WORK = "cloud-check"
        private const val CHANNEL = "cloud-agents"
        private val main = Handler(Looper.getMainLooper())

        fun allowed(context: Context) = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        // On while a key is saved and notifications are allowed; off otherwise.
        fun schedule(context: Context) {
            val wm = WorkManager.getInstance(context)
            if (!CloudVault(context).any() || !allowed(context) || !CloudBridge.available(context)) { wm.cancelUniqueWork(WORK); return }
            val req = PeriodicWorkRequestBuilder<CloudCheck>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        // One check now (debug builds' CloudCheckNow, for testing).
        fun now(context: Context) {
            WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<CloudCheck>().build())
        }

        fun notify(context: Context, pane: String, title: String, body: String) {
            if (!allowed(context)) return
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Cloud agents", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "A cloud agent you started on this phone finished, failed or needs you"
            })
            val open = Intent(context, MainActivity::class.java).putExtra(MainActivity.CLOUD_AGENT, pane).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val tap = PendingIntent.getActivity(context, pane.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val note = Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_agents)
                .setColor(Color.parseColor("#61A6FF"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .addExtras(Bundle().apply { putString(EXTRA_PANE, pane) })
                .build()
            runCatching { nm.notify(TAG, pane.hashCode(), note) }
        }

        // A key removed: its agents' notifications go too.
        fun forget(context: Context, provider: String) {
            val nm = context.getSystemService(NotificationManager::class.java)
            for (n in nm.activeNotifications) {
                if (n.tag == TAG && n.notification.extras.getString(EXTRA_PANE)?.startsWith("cloud:$provider:") == true) nm.cancel(TAG, n.id)
            }
            schedule(context)
        }

        private const val TAG = "cloud"
        private const val EXTRA_PANE = "pane"
    }
}
