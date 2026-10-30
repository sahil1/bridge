package dev.bridgeai.phone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Debug builds only: run Cloud agents' background check once now, without opening the app (the
// scheduled one waits its 15 minutes). adb shell am broadcast -n dev.bridgeai.phone/.CloudCheckNow
class CloudCheckNow : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = CloudCheck.now(context)
}
