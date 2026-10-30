package dev.bridgeai.phone

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.webkit.WebViewAssetLoader
import com.google.zxing.integration.android.IntentIntegrator
import com.journeyapps.barcodescanner.CaptureActivity
import org.json.JSONArray
import org.json.JSONObject

// The Android app: your relay's phone page (relay/web) in a WebView. Android's WebView runs the
// page's service worker, so it works as it does in Chrome: pairing, the end-to-end encrypted link
// to your computer, and Bridge AI from it. Before the first pairing it asks for the QR code, which
// says which relay to open.
//
// It can be paired with several computers, each with its own relay. Each relay is its own site in
// the WebView, so each keeps its own pairing; the app keeps the list and which one is showing.
//
// It also runs Cloud agents with no computer at all: Bridge AI's UI for them, bundled in the app,
// with your keys kept by the app (CloudBridge) and a background check (CloudCheck). From the start
// screen, the app's long-press shortcut, or the phone page when it offers it, paired or not.
class MainActivity : Activity() {
    private var web: PageView? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null

    private val prefs by lazy { getSharedPreferences("bridge", MODE_PRIVATE) }
    // The computer showing now, by its relay.
    private var relay: String?
        get() = prefs.getString("relay", null)
        set(v) { prefs.edit().putString("relay", v).apply() }

    // The computers: [{ relay, name }], in the order they were added.
    private var computers: JSONArray
        get() = runCatching { JSONArray(prefs.getString("computers", "[]")) }.getOrDefault(JSONArray())
        set(v) { prefs.edit().putString("computers", v.toString()).apply() }

    private fun without(url: String): JSONArray {
        val list = computers
        return JSONArray().also { out -> for (i in 0 until list.length()) if (list.getJSONObject(i).optString("relay") != url) out.put(list.getJSONObject(i)) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        fitKeyboard()
        // For testing on an emulator, which can't scan: adb shell am start -n dev.bridgeai.phone/.MainActivity --es pair <link>
        val testLink = if (BuildConfig.DEBUG) intent.getStringExtra("pair") else null
        if (testLink != null) return usePairingLink(testLink)
        // ...and --es cloudMock 127.0.0.1 points Cloud agents at stand-in providers (TestHosts).
        if (BuildConfig.DEBUG) TestHosts.remember(this, intent)
        CloudCheck.schedule(this)
        // A cloud agent's notification, or the Cloud agents shortcut.
        if (intent.hasExtra(CLOUD_AGENT) || intent.action == CLOUD_ACTION) return openCloud(intent.getStringExtra(CLOUD_AGENT))
        // ...and --es open demo goes straight to a bundled UI.
        val testOpen = if (BuildConfig.DEBUG) intent.getStringExtra("open") else null
        if (testOpen == CLOUD) return openCloud(null)
        if (testOpen != null && hasBundled(testOpen)) return openBundled(testOpen)
        pendingAgent = intent.getStringExtra(AgentsService.AGENT)
        val r = relay
        if (r == null) showStart(null) else openPage(r)
    }

    // A tap on the agents notification while the app is open.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasExtra(CLOUD_AGENT) || intent.action == CLOUD_ACTION) return openCloud(intent.getStringExtra(CLOUD_AGENT))
        val id = intent.getStringExtra(AgentsService.AGENT) ?: return
        val w = web ?: return
        w.evaluateJavascript("window.bridgeOpenAgent && window.bridgeOpenAgent(${JSONObject.quote(id)})", null)
    }

    // ...or that opened it: shown once the page is there.
    private var pendingAgent: String? = null

    // From Android 15 the app draws under the bars and the keyboard (edge-to-edge), and adjustResize
    // no longer makes room for the keyboard. So the screen ends where the keyboard begins, for the
    // page and the start screen alike: the message box, a dialog or the field you're typing in stays
    // just above it. The bars are still drawn under (the page keeps clear of them with its safe-area
    // insets), less what's now below the screen, so the page doesn't make room a second time.
    // Before Android 15 the system does this.
    private fun fitKeyboard() {
        if (Build.VERSION.SDK_INT < 35) return
        findViewById<View>(android.R.id.content).setOnApplyWindowInsetsListener { v, insets ->
            val keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom
            v.setPadding(0, 0, 0, keyboard)
            insets.inset(0, 0, 0, keyboard)
        }
    }

    // ---------- before the first pairing ----------
    private fun showStart(error: String?) {
        web?.destroy()
        web = null
        showingBundled = false
        updateBack()
        val dp = resources.displayMetrics.density
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL or Gravity.CENTER_VERTICAL
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
            setBackgroundColor(Color.parseColor("#0B0D11"))
        }
        // Centred, and it scrolls when the keyboard (or a small screen) leaves too little room.
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(box)
        }
        // From Android 15 the app draws under the bars (edge-to-edge): keep the form clear of them.
        // (The page does it itself; fitKeyboard keeps both clear of the keyboard.)
        if (Build.VERSION.SDK_INT >= 35) scroll.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsets.CONSUMED
        }
        val icon = ImageView(this).apply { setImageResource(R.mipmap.ic_launcher) }
        box.addView(icon, LinearLayout.LayoutParams((64 * dp).toInt(), (64 * dp).toInt()))
        box.addView(TextView(this).apply {
            text = "Pair with your computer"
            textSize = 20f
            setTextColor(Color.parseColor("#E6E8EC"))
            gravity = Gravity.CENTER
            setPadding(0, (14 * dp).toInt(), 0, (6 * dp).toInt())
        })
        box.addView(TextView(this).apply {
            text = "Bridge AI runs on your computer. On it, open Settings › Devices, click Pair a device, and scan the code. Or paste the link from Copy link."
            textSize = 15f
            setTextColor(Color.parseColor("#9AA1AD"))
            gravity = Gravity.CENTER
        })
        val wide = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = (14 * dp).toInt() }
        box.addView(Button(this).apply { text = "Scan the QR code"; setOnClickListener { startScan() } }, wide)
        val field = EditText(this).apply {
            hint = "https://…/#pair=…"
            setSingleLine()
            setTextColor(Color.parseColor("#E6E8EC"))
            setHintTextColor(Color.parseColor("#5D6470"))
        }
        box.addView(field, wide)
        box.addView(Button(this).apply { text = "Pair"; setOnClickListener { usePairingLink(field.text.toString().trim()) } }, wide)
        if (error != null) box.addView(TextView(this).apply { text = error; setTextColor(Color.parseColor("#F87171")); gravity = Gravity.CENTER }, wide)
        // No computer yet: look around Bridge AI on made-up agents first.
        if (hasBundled("demo")) {
            box.addView(TextView(this).apply {
                text = "No computer to pair yet?"
                textSize = 14f
                setTextColor(Color.parseColor("#9AA1AD"))
                gravity = Gravity.CENTER
                setPadding(0, (22 * dp).toInt(), 0, 0)
            })
            box.addView(Button(this).apply { text = "Try the demo"; setOnClickListener { openBundled("demo") } }, wide)
        }
        // Or no computer at all: coding agents in the cloud, with your own key.
        if (CloudBridge.available(this)) {
            box.addView(TextView(this).apply {
                text = "Or run agents on Cursor, Copilot, Jules or Claude from this phone, with your own key:"
                textSize = 14f
                setTextColor(Color.parseColor("#9AA1AD"))
                gravity = Gravity.CENTER
                setPadding(0, (18 * dp).toInt(), 0, 0)
            })
            box.addView(Button(this).apply { text = "Cloud agents"; setOnClickListener { openCloud(null) } }, wide)
        }
        setContentView(scroll)
    }

    // ---------- Bridge AI's UI bundled in the app ----------
    // Built into the app's assets (app/build.gradle.kts) and served from an https address of the
    // app's own, so the page works as it does on the web. It runs with no computer behind it.
    private val bundled by lazy { WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build() }
    private var showingBundled = false

    private fun hasBundled(name: String) = runCatching { assets.list(name)?.contains("index.html") == true }.getOrDefault(false)

    private fun openBundled(name: String) {
        leavePage()
        showingBundled = true
        val w = web ?: makeWebView().also { web = it; setContentView(it) }
        w.loadUrl("https://$BUNDLED_HOST/assets/$name/index.html")
    }

    // Cloud agents (CloudBridge), at an address of its own; agent: open that one (a notification).
    private val cloudPages by lazy { CloudBridge.loader(this) }
    private fun openCloud(agent: String?) {
        if (!CloudBridge.available(this)) return
        val w = web
        if (w != null && Uri.parse(w.url ?: "").host == CloudBridge.HOST) {
            if (agent != null) w.evaluateJavascript("window.bridgeOpenAgent && window.bridgeOpenAgent(${JSONObject.quote(agent)})", null)
            return
        }
        leavePage()
        showingBundled = true
        val page = web ?: makeWebView().also { web = it; setContentView(it) }
        page.loadUrl(if (agent != null) "${CloudBridge.PAGE}?agent=${Uri.encode(agent)}" else CloudBridge.PAGE)
    }

    // Away from your computer's page: its link closes, so its agents leave the lock screen until
    // you're back on it.
    private fun leavePage() {
        if (showingBundled || web == null) return
        web?.keepRunning = false
        AgentsService.stop(this)
    }

    // Back from a bundled UI: to your computer's page, or the start screen.
    private fun leaveBundled() {
        val r = relay
        if (r != null) openPage(r) else showStart(null)
    }

    // A key was saved or removed on the Cloud agents page: the background check goes on or off,
    // after asking to notify (Android 13 and later) the first time there's a key.
    private fun onCloudKeys() {
        if (CloudVault(this).any() && !CloudCheck.allowed(this) && Build.VERSION.SDK_INT >= 33 && !prefs.getBoolean("askedCloudNotify", false)) {
            prefs.edit().putBoolean("askedCloudNotify", true).apply()
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), CLOUD_NOTIFY)
        }
        CloudCheck.schedule(this)
    }

    private fun startScan() {
        IntentIntegrator(this).apply {
            setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            setPrompt("Point at the code on your computer")
            setBeepEnabled(false)
            setOrientationLocked(false)
            setCaptureActivity(ScanActivity::class.java)
        }.initiateScan()
    }

    // A pairing link: https://<your relay>/#pair=<code>. The relay is remembered; the page pairs.
    private fun usePairingLink(text: String) {
        val uri = Uri.parse(text)
        // Debug builds also take a relay running on the computer (wrangler dev, via adb reverse), for testing.
        val test = BuildConfig.DEBUG && uri.scheme == "http" && uri.host == "127.0.0.1"
        val ok = (uri.scheme == "https" || test) && uri.host != null && (uri.fragment ?: "").contains("pair=")
        if (!ok) {
            if (web == null) showStart("That isn't a Bridge AI pairing link.")
            else AlertDialog.Builder(this).setMessage("That isn't a Bridge AI pairing code.").setPositiveButton("OK", null).show()
            return
        }
        relay = "${uri.scheme}://${uri.host}${if (uri.port > 0) ":${uri.port}" else ""}"
        openPage(text)
    }

    // ---------- the page ----------
    private fun openPage(url: String) {
        showingBundled = false
        val w = web ?: makeWebView().also { web = it; setContentView(it) }
        w.loadUrl(url)
    }

    private fun makeWebView(): PageView {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        return PageView(this).apply {
            setBackgroundColor(Color.parseColor("#0B0D11"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            // The page tells the app from Chrome by this, and Bridge AI names the phone "Android (app)".
            settings.userAgentString = "${settings.userAgentString} BridgeAIApp/${BuildConfig.VERSION_NAME}"
            addJavascriptInterface(Bridge(), "bridgeAndroid")
            // Cloud agents' keys and requests, for the Cloud agents page's address only.
            CloudBridge.attach(this, CloudBridge(this@MainActivity, onKeys = { onCloudKeys() }))
            webViewClient = object : WebViewClient() {
                override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                    // Back can lead from a bundled UI to your computer's page, and the other way.
                    val host = Uri.parse(url ?: "").host
                    showingBundled = host == BUNDLED_HOST || host == CloudBridge.HOST
                    updateCloudShowing()
                    updateBack()
                }

                override fun onPageFinished(view: WebView, url: String) {
                    val id = pendingAgent ?: return
                    pendingAgent = null
                    view.evaluateJavascript("window.bridgeOpenAgent && window.bridgeOpenAgent(${JSONObject.quote(id)})", null)
                }

                // The bundled UIs' files, from the app.
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = when (request.url.host) {
                    BUNDLED_HOST -> bundled.shouldInterceptRequest(request.url)
                    CloudBridge.HOST -> CloudBridge.serve(cloudPages, request.url)
                    else -> null
                }

                // Pages other than your relay (links in messages, a server's page) open in the browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    // Your computer's page and the UIs bundled in the app stay here.
                    if (request.url.host in setOf(BUNDLED_HOST, CloudBridge.HOST, Uri.parse(relay ?: "").host)) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                // The page's alerts and questions as the app's own dialogs, without the page's
                // address as a title (Android's default), as on iPhone.
                override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                    AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton("OK") { _, _ -> result.confirm() }
                        .setOnCancelListener { result.confirm() }.show()
                    return true
                }

                override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                    AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton("OK") { _, _ -> result.confirm() }
                        .setNegativeButton("Cancel") { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show()
                    return true
                }

                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return runCatching { startActivityForResult(params.createIntent(), FILES) }.isSuccess.also { if (!it) fileCallback = null }
                }

                // The microphone, for dictating messages.
                override fun onPermissionRequest(request: PermissionRequest) {
                    if (Uri.parse(relay ?: "").host != request.origin.host) return request.deny()
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) return request.grant(request.resources)
                    pendingPermission = request
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MIC)
                }
            }
        }
    }

    // What the page can ask of the app.
    inner class Bridge {
        @JavascriptInterface
        fun scan() = runOnUiThread { startScan() }

        @JavascriptInterface
        fun computers(): String = computers.toString()

        // The page showing now is connected to its computer (paired): it's on the list.
        @JavascriptInterface
        fun paired() = runOnUiThread { remember(null) }

        // ...and says what that computer is called.
        @JavascriptInterface
        fun name(name: String) = runOnUiThread { remember(name.take(60)) }

        @JavascriptInterface
        fun open(url: String) = runOnUiThread { if (isKnown(url)) { relay = url; openPage(url) } }

        @JavascriptInterface
        fun pair(link: String) = runOnUiThread { usePairingLink(link) }

        // The agents at work, for the lock screen (AgentsService).
        @JavascriptInterface
        fun activity(state: String) = runOnUiThread {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !askedNotifications) {
                askedNotifications = true
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFY)
            }
            lastActivity = state
            AgentsService.show(applicationContext, state)
            // While agents are on the lock screen, the page keeps running so it stays current.
            web?.keepRunning = !runCatching { JSONObject(state).optBoolean("ended") }.getOrDefault(true)
        }

        // A meeting recording: the screen stays on, since Android stops the mic of an app that isn't in front.
        @JavascriptInterface
        fun recording(on: Boolean) = runOnUiThread {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        // Forget a computer: off the list, and its relay's pairing off this phone.
        @JavascriptInterface
        fun forget(url: String) = runOnUiThread {
            computers = without(url)
            WebStorage.getInstance().deleteOrigin(url)
            if (url != relay) return@runOnUiThread
            val next = computers.optJSONObject(0)?.optString("relay")
            relay = next
            if (next != null) openPage(next) else showStart(null)
        }

        // Back to the start screen (or your computer's page), from a bundled UI: the demo's
        // "Pair a computer", Cloud agents' computer button.
        @JavascriptInterface
        fun home() = runOnUiThread { if (showingBundled) leaveBundled() }

        // The UIs bundled in the app that the phone page can open (Cloud agents; the demo is on
        // the app's own start screen), and opening one.
        @JavascriptInterface
        fun bundled(): String = JSONArray().apply { if (CloudBridge.available(this@MainActivity)) put(CLOUD) }.toString()

        @JavascriptInterface
        fun openBundled(name: String) = runOnUiThread { if (name == CLOUD) openCloud(null) }
    }

    private var askedNotifications = false
    private var lastActivity: String? = null

    private fun remember(name: String?) {
        val url = relay ?: return
        val list = computers
        val known = (0 until list.length()).map { list.getJSONObject(it) }.find { it.optString("relay") == url }
        val c = known ?: JSONObject().put("relay", url).also { list.put(it) }
        if (name != null) c.put("name", name)
        computers = list
    }

    private fun isKnown(url: String) = (0 until computers.length()).any { computers.getJSONObject(it).optString("relay") == url }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILES) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        val scanned = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (scanned != null) {
            scanned.contents?.let { usePairingLink(it) }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        if (requestCode == MIC) {
            val p = pendingPermission
            pendingPermission = null
            if (results.firstOrNull() == PackageManager.PERMISSION_GRANTED) p?.grant(p.resources) else p?.deny()
        }
        // Allowed: the notification Android held back until now.
        if (requestCode == NOTIFY && results.firstOrNull() == PackageManager.PERMISSION_GRANTED) lastActivity?.let { AgentsService.show(applicationContext, it) }
        if (requestCode == CLOUD_NOTIFY) CloudCheck.schedule(this)
    }

    // Back goes back in the page first. From Android 13 the system asks ahead whether the app
    // takes Back (predictive back, the only way from Android 16), so the app takes it only while
    // the page has somewhere to go back to; otherwise it's Android's own. A bundled UI goes back
    // to the start screen last.
    private fun back() {
        val w = web
        if (w != null && w.canGoBack()) w.goBack() else if (showingBundled) leaveBundled()
    }
    private val pageBack: Any? = if (Build.VERSION.SDK_INT >= 33) OnBackInvokedCallback { back() } else null
    private var backTaken = false

    private fun updateBack() {
        if (Build.VERSION.SDK_INT < 33) return
        val take = web?.canGoBack() == true || showingBundled
        if (take == backTaken) return
        backTaken = take
        val cb = pageBack as OnBackInvokedCallback
        if (take) onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
        else onBackInvokedDispatcher.unregisterOnBackInvokedCallback(cb)
    }

    // ...and Android 12 and older, which call this instead.
    @Deprecated("Android 12 and older")
    @SuppressLint("GestureBackNavigation")
    override fun onBackPressed() {
        if (web?.canGoBack() == true || showingBundled) back() else super.onBackPressed()
    }

    // Cloud agents in front: the background check leaves it to the page.
    private var resumed = false
    private fun updateCloudShowing() { cloudShowing = resumed && Uri.parse(web?.url ?: "").host == CloudBridge.HOST }

    override fun onResume() {
        super.onResume()
        resumed = true
        updateCloudShowing()
    }

    override fun onPause() {
        resumed = false
        updateCloudShowing()
        super.onPause()
    }

    override fun onDestroy() {
        web?.destroy()
        super.onDestroy()
    }

    companion object {
        const val CLOUD_AGENT = "cloudAgent"
        private const val CLOUD_ACTION = "dev.bridgeai.phone.CLOUD"
        private const val CLOUD = "cloud"
        @Volatile var cloudShowing = false
        private const val FILES = 1
        private const val MIC = 2
        private const val NOTIFY = 3
        private const val CLOUD_NOTIFY = 4
        // The app's own address for what it serves itself (WebViewAssetLoader's default).
        private const val BUNDLED_HOST = "appassets.androidplatform.net"
    }
}

// The page's WebView. Once it can't be seen (the app in the background, the phone locked), its
// page is frozen within a minute or so; while keepRunning, it goes on as if it could be seen, so
// the link to your computer and the agents notification stay current.
class PageView(context: Context) : WebView(context) {
    var keepRunning = false
        set(v) {
            field = v
            setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, !v)
            if (!v) super.onWindowVisibilityChanged(windowVisibility)
        }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(if (keepRunning) View.VISIBLE else visibility)
    }
}

// The QR scanner. From Android 15 it draws under the navigation bar (edge-to-edge), which would
// hide its prompt at the bottom; this keeps it clear.
class ScanActivity : CaptureActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 35) findViewById<View>(android.R.id.content).setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            v.setPadding(bars.left, 0, bars.right, bars.bottom)
            insets
        }
    }
}
