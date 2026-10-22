package dev.bridgeai.phone

import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.net.URL

// Release builds: no stand-in providers. Cloud agents talk only to each provider's own API, over
// https (CloudBridge). Debug builds have a version of this for testing (src/debug).
object TestHosts {
    fun remember(c: Context, intent: Intent?) {}
    fun bases(c: Context, providers: JSONObject) = JSONObject()
    fun allows(c: Context, provider: String, url: URL) = false
}
