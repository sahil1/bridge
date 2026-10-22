package dev.bridgeai.phone

import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.net.URL

// Debug builds only (this file is in src/debug; release builds get src/release's, which allows
// nothing): stand-in providers for testing Cloud agents, on the computer the emulator runs on.
//   adb reverse tcp:7701 tcp:7701 (and 7702, 7703, 7704), then
//   adb shell am start -n dev.bridgeai.phone/.MainActivity --es open cloud --es cloudMock 127.0.0.1
// points Cursor at http://127.0.0.1:7701, GitHub at :7702, Jules at :7703 and Claude at :7704
// (--es cloudMock "" goes back to the real ones). Plain http to 127.0.0.1 is allowed in debug
// builds only (src/debug/res/xml/test_relay.xml).
object TestHosts {
    private val PORTS = mapOf("cursor" to 7701, "copilot" to 7702, "jules" to 7703, "claude" to 7704, "claude.github" to 7702)
    private val HOSTS = setOf("127.0.0.1")
    private fun host(c: Context) = c.getSharedPreferences("cloud-test", Context.MODE_PRIVATE).getString("mock", null)

    fun remember(c: Context, intent: Intent?) {
        val h = intent?.getStringExtra("cloudMock") ?: return
        c.getSharedPreferences("cloud-test", Context.MODE_PRIVATE).edit().putString("mock", h.takeIf { it in HOSTS }).apply()
    }

    // The addresses the page uses instead of the real ones.
    fun bases(c: Context, providers: JSONObject): JSONObject {
        val h = host(c) ?: return JSONObject()
        return JSONObject().also { out -> for (p in CloudVault.PROVIDERS) if (providers.has(p)) out.put(p, "http://$h:${PORTS[p]}") }
    }

    fun allows(c: Context, provider: String, url: URL): Boolean {
        val h = host(c) ?: return false
        return url.protocol == "http" && url.host == h && url.port == PORTS[provider]
    }
}
