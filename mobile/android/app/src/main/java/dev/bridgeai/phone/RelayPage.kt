package dev.bridgeai.phone

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import org.json.JSONArray
import java.io.ByteArrayInputStream

// The phone page (relay/web) from the app's own copy, never the relay's. Everything past the
// handshake is encrypted by the page's code, so a relay that served a changed page could read it
// all; the app carries the page of its own version instead, as the iPhone app does, built into its
// assets by `node relay/build.js --page` (app/build.gradle.kts).
//
// It's still served at your relay's address, so it works exactly as it does in Chrome: each relay
// is its own site with its own pairing, saved copy and service worker, and the WebSocket goes to
// the relay. Only the relay's own addresses (/_relay/…: the link, its health) reach the relay; the
// service worker carries Bridge AI's requests over the encrypted link, as in a browser; anything
// else that reaches here is a 404, so nothing the relay answers ever runs in the app.
object RelayPage {
    // The page's files, by the address the relay serves them at (relay/build.js).
    private val OWN = mapOf(
        "/" to "index.html",
        "/index.html" to "index.html",
        "/shell.js" to "shell.js",
        "/link.js" to "link.js",
        "/offline.js" to "offline.js",
        "/sw.js" to "sw.js",
        "/link-sw.js" to "link-sw.js",
        "/manifest.webmanifest" to "manifest.webmanifest",
        "/icon-512.png" to "icon-512.png",
        "/apple-touch-icon.png" to "apple-touch-icon.png",
        "/mark.svg" to "mark.svg",
    )
    private val TYPES = mapOf(
        "html" to "text/html",
        "js" to "text/javascript",
        "webmanifest" to "application/manifest+json",
        "png" to "image/png",
        "svg" to "image/svg+xml",
    )

    // The page's Content-Security-Policy, the same as the relay sends with it (relay/worker.js).
    const val CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'"

    // The relay's own addresses the page asks over plain https (/_relay/link is a WebSocket, which
    // never comes here): whether it's up, and which version (shell.js).
    private val RELAYS_OWN = setOf("/_relay/health")

    // A request to one of your relays' addresses: its answer, or null to let it go to the relay.
    fun serve(context: Context, url: Uri, method: String?): WebResourceResponse? {
        val path = url.path.takeUnless { it.isNullOrEmpty() } ?: "/"
        if (path in RELAYS_OWN) return null
        val name = OWN[path]
        if (name == null || (method != null && method != "GET")) return missing()
        val bytes = runCatching { context.assets.open("relay/$name").use { it.readBytes() } }.getOrNull() ?: return missing()
        val type = TYPES[name.substringAfterLast('.')] ?: "application/octet-stream"
        val headers = mutableMapOf("Cache-Control" to "no-cache", "X-Content-Type-Options" to "nosniff", "Referrer-Policy" to "no-referrer")
        if (name == "index.html") headers["Content-Security-Policy"] = CSP
        val text = type.startsWith("text/") || type.endsWith("json")
        return WebResourceResponse(type, if (text) "utf-8" else null, 200, "OK", headers, ByteArrayInputStream(bytes))
    }

    private fun missing() = WebResourceResponse("text/plain", "utf-8", 404, "Not found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    // Your relays' addresses: the one showing and the ones on the list (MainActivity keeps both).
    // Only there does the app serve the page.
    fun isRelay(context: Context, url: Uri): Boolean {
        val origin = originOf(url) ?: return false
        val prefs = context.getSharedPreferences("bridge", Context.MODE_PRIVATE)
        if (origin == prefs.getString("relay", null)) return true
        val list = runCatching { JSONArray(prefs.getString("computers", "[]")) }.getOrDefault(JSONArray())
        return (0 until list.length()).any { list.optJSONObject(it)?.optString("relay") == origin }
    }

    // A relay's origin, as the page and the app name it: scheme://host, and the port if it isn't the
    // scheme's own.
    fun originOf(uri: Uri): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        val port = uri.port.takeIf { it > 0 && !(scheme == "https" && it == 443) && !(scheme == "http" && it == 80) }
        return "$scheme://$host${port?.let { ":$it" } ?: ""}"
    }
}
