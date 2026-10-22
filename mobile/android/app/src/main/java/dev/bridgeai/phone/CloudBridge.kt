package dev.bridgeai.phone

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Cloud agents on the phone alone (src/cloud, bundled as the "cloud" UI): your own keys for
// Cursor, GitHub Copilot, Jules and Claude, kept here and never handed to the page. The page asks
// the app to make each request to a provider (CloudBridge.fetch below); the app checks the address
// is that provider's own API, adds the key itself, and passes back the answer with the key taken
// out. The page can set, test or remove a key and learn whether one is set and its last 4
// characters, nothing more.

// Keys, encrypted with an AES key that stays in Android's Keystore (in the phone's secure hardware
// where it has one, and never exported), in the app's no-backup folder: no backup, transfer to a
// new phone or adb backup takes them (allowBackup false and res/xml/no_backup.xml besides). With
// them, what's kept for the agents you started: one JSON text per provider, gone with the key.
class CloudVault(context: Context) {
    private val keysFile = File(context.noBackupFilesDir, "cloud-keys.json")
    private val stateFile = File(context.noBackupFilesDir, "cloud-state.json")

    // slot -> the key, sealed (base64 of the GCM nonce and the ciphertext).
    private fun sealed(): JSONObject = runCatching { JSONObject(keysFile.readText()) }.getOrDefault(JSONObject())
    private fun write(file: File, text: String) {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(text)
        tmp.renameTo(file)
    }

    private fun secret(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        return gen.generateKey()
    }

    @Synchronized fun set(slot: String, key: String) {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secret()) }
        val box = c.iv + c.doFinal(key.toByteArray(Charsets.UTF_8))
        write(keysFile, sealed().put(slot, Base64.encodeToString(box, Base64.NO_WRAP)).toString())
    }

    @Synchronized fun get(slot: String): String? {
        val box = sealed().optString(slot).takeIf { it.isNotEmpty() }?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null
        return runCatching {
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, box, 0, 12)) }
            String(c.doFinal(box, 12, box.size - 12), Charsets.UTF_8)
        }.getOrNull()
    }

    @Synchronized fun remove(slot: String) { write(keysFile, sealed().apply { remove(slot) }.toString()) }

    @Synchronized fun slots(): Set<String> = sealed().keys().asSequence().toSet()

    fun any() = slots().any { it in PROVIDERS }

    // What the page may know: which slots have a key, and the last 4 characters of a long one.
    fun view(): JSONObject = JSONObject().also { out ->
        for (slot in slots()) {
            val k = get(slot) ?: continue
            out.put(slot, JSONObject().put("set", true).put("last4", if (k.length >= 16) k.takeLast(4) else ""))
        }
    }

    // ---------- What's kept for the agents ----------
    @Synchronized fun state(): JSONObject = runCatching { JSONObject(stateFile.readText()) }.getOrDefault(JSONObject())

    @Synchronized fun save(provider: String, value: String?): Int {
        val s = state()
        val agents = s.optJSONObject("agents") ?: JSONObject()
        if (value == null) agents.remove(provider) else agents.put(provider, value)
        val rev = s.optInt("rev") + 1
        write(stateFile, JSONObject().put("agents", agents).put("rev", rev).toString())
        return rev
    }

    companion object {
        private const val ALIAS = "bridge-cloud-keys"
        val PROVIDERS = listOf("cursor", "copilot", "jules", "claude")
    }
}

// What the page can ask (src/cloud/native.js), on a channel offered to the Cloud agents page's
// address alone (a WebMessageListener: no other page, frame or address gets window.bridgeCloud).
// check: set for the background check (CloudCheck), which notifies and finishes.
class CloudBridge(
    private val context: Context,
    private val onKeys: () -> Unit = {},
    private val check: Check? = null,
) : WebViewCompat.WebMessageListener {
    interface Check {
        fun notify(pane: String, title: String, body: String)
        fun done()
    }

    private val vault = CloudVault(context)

    override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, reply: JavaScriptReplyProxy) {
        if (!isMainFrame || sourceOrigin.toString() != ORIGIN) return
        val m = runCatching { JSONObject(message.data ?: return) }.getOrNull() ?: return
        val id = m.optInt("id")
        work.execute {
            val out = JSONObject().put("id", id)
            try { out.put("result", answer(m.optString("op"), m) ?: JSONObject.NULL) } catch (e: Exception) { out.put("error", e.message ?: "Something went wrong") }
            main.post { runCatching { reply.postMessage(out.toString()) } }
        }
    }

    private fun answer(op: String, m: JSONObject): Any? = when (op) {
        "config" -> JSONObject().put("keys", vault.view()).put("state", vault.state().optJSONObject("agents") ?: JSONObject())
            .put("rev", vault.state().optInt("rev")).put("bases", TestHosts.bases(context, providers(context)))
        "load" -> JSONObject().put("state", vault.state().optJSONObject("agents") ?: JSONObject()).put("rev", vault.state().optInt("rev"))
        "setKey" -> {
            val slot = slot(m.optString("slot"))
            val key = m.optString("key").trim()
            require(key.isNotEmpty()) { "Paste a key first" }
            require(key.length <= 4096 && key.none { it.isWhitespace() || it == '\u0000' }) { "That doesn't look like a key" }
            vault.set(slot, key)
            main.post { onKeys() }
            JSONObject().put("keys", vault.view())
        }
        "copyKey" -> {
            val key = vault.get(slot(m.optString("from"))) ?: throw IllegalArgumentException("There's no key to copy")
            vault.set(slot(m.optString("to")), key)
            JSONObject().put("keys", vault.view())
        }
        // A provider's key goes with its GitHub token and everything kept for its agents.
        "removeKey" -> {
            val slot = slot(m.optString("slot"))
            vault.remove(slot)
            if (slot in CloudVault.PROVIDERS) {
                vault.remove("$slot.github")
                vault.save(slot, null)
                CloudCheck.forget(context, slot)
            }
            main.post { onKeys() }
            JSONObject().put("keys", vault.view())
        }
        "save" -> JSONObject().put("rev", vault.save(slot(m.optString("provider")).also { require(it in CloudVault.PROVIDERS) }, m.optString("state")))
        "fetch" -> fetch(m)
        "notify" -> { check?.notify(m.optString("pane"), m.optString("title").take(120), m.optString("body").take(300)); null }
        "done" -> { check?.done(); null }
        else -> throw IllegalArgumentException("Unknown request")
    }

    private fun slot(s: String): String {
        require(providers(context).has(s)) { "Unknown provider" }
        return s
    }

    // ---------- A request to a provider ----------
    private fun fetch(m: JSONObject): JSONObject {
        val provider = slot(m.optString("provider"))
        val p = providers(context).getJSONObject(provider)
        val key = vault.get(provider) ?: throw IllegalStateException("No key saved for that provider")
        val url = URL(m.optString("url"))
        // Its own API only: https on its host (debug builds may also name a stand-in for testing).
        val api = URL(p.getString("base"))
        val own = url.protocol == "https" && url.host.equals(api.host, ignoreCase = true) && (url.port == -1 || url.port == 443)
        if (!own && !TestHosts.allows(context, provider, url)) throw SecurityException("That address isn't ${api.host}")
        val method = m.optString("method", "GET").uppercase()
        require(method in setOf("GET", "POST", "PUT", "PATCH", "DELETE")) { "Unsupported request" }
        var body = m.optString("body").takeIf { m.has("body") && !m.isNull("body") && it.isNotEmpty() }
        // Claude can take your GitHub token for the repo: the page names it, the app puts it in,
        // only in the request that starts a session, to Anthropic.
        if (body != null && body.contains(STAND_IN_GITHUB)) {
            require(provider == "claude" && method == "POST" && url.path == "/v1/sessions") { "Unsupported request" }
            body = body.replace(STAND_IN_GITHUB, JSONObject.quote(vault.get("claude.github") ?: ""))
        }
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            // A redirect could carry the key elsewhere: none are followed.
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            val headers = m.optJSONObject("headers") ?: JSONObject()
            for (name in headers.keys()) if (name.lowercase() in PASSED) conn.setRequestProperty(name, headers.optString(name))
            conn.setRequestProperty("User-Agent", "BridgeAI/${BuildConfig.VERSION_NAME} (Android)")
            val scheme = p.optString("scheme")
            conn.setRequestProperty(p.getString("header"), if (scheme.isEmpty()) key else "$scheme $key")
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream = (if (status >= 400) conn.errorStream else conn.inputStream)
            val text = stream?.use { s -> s.readBytes().toString(Charsets.UTF_8) } ?: ""
            val out = JSONObject()
            for (name in KEPT) conn.getHeaderField(name)?.let { out.put(name, it) }
            // Never a key back to the page, even if a provider repeats one.
            var clean = text
            for (s in vault.slots()) vault.get(s)?.takeIf { it.length > 6 }?.let { clean = clean.replace(it, "***") }
            return JSONObject().put("status", status).put("headers", out).put("body", clean)
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        // The Cloud agents page, served from the app's assets at an address of its own (apart from
        // the demo's, so each keeps its own storage).
        const val HOST = "cloud.appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        const val PAGE = "$ORIGIN/assets/cloud/index.html"
        private const val STAND_IN_GITHUB = "\"bridge-app-key:claude.github\""
        private val PASSED = setOf("accept", "content-type", "if-none-match", "x-github-api-version", "anthropic-version", "anthropic-beta")
        private val KEPT = listOf("content-type", "etag", "retry-after", "x-ratelimit-remaining", "x-ratelimit-reset")
        private val main = Handler(Looper.getMainLooper())
        private val work = Executors.newFixedThreadPool(4)
        private var known: JSONObject? = null

        // Each provider's API address and the header its key goes in: providers.json, written into
        // the bundled page from the adapters (vite.config.js), read from the app's own assets.
        @Synchronized fun providers(context: Context): JSONObject = known ?: runCatching {
            JSONObject(context.assets.open("cloud/providers.json").bufferedReader().readText())
        }.getOrDefault(JSONObject()).also { known = it }

        fun available(context: Context) = runCatching { context.assets.list("cloud")?.contains("index.html") == true }.getOrDefault(false) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)

        // The page's files, from the app. Never the network: a file that isn't there is a 404.
        fun loader(context: Context): WebViewAssetLoader = WebViewAssetLoader.Builder().setDomain(HOST).addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()

        fun serve(loader: WebViewAssetLoader, url: Uri): WebResourceResponse =
            loader.shouldInterceptRequest(url) ?: WebResourceResponse("text/plain", "utf-8", 404, "Not found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

        // Offer the channel to a WebView, for the Cloud agents page's address only.
        fun attach(web: WebView, bridge: CloudBridge) {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(web, "bridgeCloud", setOf(ORIGIN), bridge)
        }
    }
}
