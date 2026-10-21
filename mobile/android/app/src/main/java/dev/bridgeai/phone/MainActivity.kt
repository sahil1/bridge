package dev.bridgeai.phone

import android.Manifest
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
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.google.zxing.integration.android.IntentIntegrator
import org.json.JSONArray
import org.json.JSONObject

// The Android app: your relay's phone page (relay/web) in a WebView. Android's WebView runs the
// page's service worker, so it works as it does in Chrome: pairing, the end-to-end encrypted link
// to your computer, and Bridge AI from it. Before the first pairing it asks for the QR code, which
// says which relay to open.
//
// It can be paired with several computers, each with its own relay. Each relay is its own site in
// the WebView, so each keeps its own pairing; the app keeps the list and which one is showing.
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
        // For testing on an emulator, which can't scan: adb shell am start -n dev.bridgeai.phone/.MainActivity --es pair <link>
        val testLink = if (BuildConfig.DEBUG) intent.getStringExtra("pair") else null
        if (testLink != null) return usePairingLink(testLink)
        pendingAgent = intent.getStringExtra(AgentsService.AGENT)
        val r = relay
        if (r == null) showStart(null) else openPage(r)
    }

    // A tap on the agents notification while the app is open.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val id = intent.getStringExtra(AgentsService.AGENT) ?: return
        val w = web ?: return
        w.evaluateJavascript("window.bridgeOpenAgent && window.bridgeOpenAgent(${JSONObject.quote(id)})", null)
    }

    // ...or that opened it: shown once the page is there.
    private var pendingAgent: String? = null

    // ---------- before the first pairing ----------
    private fun showStart(error: String?) {
        web?.destroy()
        web = null
        val dp = resources.displayMetrics.density
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL or Gravity.CENTER_VERTICAL
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
            setBackgroundColor(Color.parseColor("#0B0D11"))
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
            text = "Bridge AI runs on your computer. On it, open Settings › Phone & notifications, click Pair a phone, and scan the code. Or paste the link from Copy link."
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
        setContentView(box)
    }

    private fun startScan() {
        IntentIntegrator(this).apply {
            setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            setPrompt("Point at the code on your computer")
            setBeepEnabled(false)
            setOrientationLocked(false)
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
            settings.mediaPlaybackRequiresUserGesture = false
            // The page tells the app from Chrome by this, and Bridge AI names the phone "Android (app)".
            settings.userAgentString = "${settings.userAgentString} BridgeAIApp/${BuildConfig.VERSION_NAME}"
            addJavascriptInterface(Bridge(), "bridgeAndroid")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    val id = pendingAgent ?: return
                    pendingAgent = null
                    view.evaluateJavascript("window.bridgeOpenAgent && window.bridgeOpenAgent(${JSONObject.quote(id)})", null)
                }

                // Pages other than your relay (links in messages, a server's page) open in the browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    val host = Uri.parse(relay ?: "").host
                    if (request.url.host == host) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
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
    }

    @Deprecated("Back goes back in the page first")
    override fun onBackPressed() {
        val w = web
        if (w != null && w.canGoBack()) w.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        web?.destroy()
        super.onDestroy()
    }

    companion object {
        private const val FILES = 1
        private const val MIC = 2
        private const val NOTIFY = 3
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
