// Calls on this computer: which apps are using a microphone (native/callwatch, macOS 14 or later),
// so meeting notes can offer to start when a call does and to stop when it ends, like Granola.
// A call app has to keep the mic for a few seconds to count (a quick device check isn't a call),
// and has to let go of it for a few more to count as ended (a blip isn't the end).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { ROOT, IS_MAC } from './paths.js'

// The apps calls happen in, by bundle ID. A browser's helper processes carry its ID plus more.
const APPS = [
  ['us.zoom.xos', 'Zoom'], ['com.microsoft.teams2', 'Teams'], ['com.microsoft.teams', 'Teams'], ['com.apple.FaceTime', 'FaceTime'],
  ['com.tinyspeck.slackmacgap', 'Slack'], ['com.cisco.webexmeetingsapp', 'Webex'], ['Cisco-Systems.Spark', 'Webex'], ['com.hnc.Discord', 'Discord'],
  ['com.skype.skype', 'Skype'], ['net.whatsapp.WhatsApp', 'WhatsApp'], ['ru.keepcoder.Telegram', 'Telegram'], ['com.amazon.Amazon-Chime', 'Chime'],
  ['co.around.Around', 'Around'], ['com.gather.Gather', 'Gather'], ['com.loom.desktop', 'Loom'],
  ['com.google.Chrome', 'Chrome'], ['com.microsoft.edgemac', 'Edge'], ['com.apple.Safari', 'Safari'], ['com.apple.WebKit', 'Safari'],
  ['org.mozilla.firefox', 'Firefox'], ['company.thebrowser.Browser', 'Arc'], ['com.brave.Browser', 'Brave'], ['com.vivaldi.Vivaldi', 'Vivaldi'],
  ['com.operasoftware.Opera', 'Opera'], ['com.openai.atlas', 'ChatGPT Atlas'],
]
export const BROWSERS = new Set(['Chrome', 'Edge', 'Safari', 'Firefox', 'Arc', 'Brave', 'Vivaldi', 'Opera', 'ChatGPT Atlas'])
const appOf = (bundle) => APPS.find(([id]) => bundle === id || bundle.startsWith(`${id}.`))?.[1] || null
const START_MS = Number(process.env.BRIDGE_CALL_START_MS || 3000)
const END_MS = Number(process.env.BRIDGE_CALL_END_MS || 8000)

export const watchBin = () => {
  const f = process.env.BRIDGE_CALLWATCH || path.join(ROOT, 'native', 'bin', 'callwatch')
  return (IS_MAC || process.env.BRIDGE_CALLWATCH) && fs.existsSync(f) ? f : null
}

// using: app -> since (has the mic now); calls: app -> since (counted as a call); gone: app -> at.
const using = new Map()
const calls = new Map()
const gone = new Map()
const timers = new Map()
const listeners = new Set()
let proc = null
let wanted = false
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const emit = (e) => { for (const fn of listeners) { try { fn(e) } catch { /* a listener's problem */ } } }

function seen(apps) {
  const now = Date.now()
  for (const app of apps) {
    if (!using.has(app)) using.set(app, now)
    gone.delete(app)
    clearTimeout(timers.get(`end:${app}`))
    if (!calls.has(app) && !timers.has(`start:${app}`)) {
      timers.set(`start:${app}`, setTimeout(() => {
        timers.delete(`start:${app}`)
        if (!using.has(app) || calls.has(app)) return
        calls.set(app, using.get(app))
        emit({ type: 'start', app, at: new Date(calls.get(app)).toISOString() })
      }, START_MS))
    }
  }
  for (const app of [...using.keys()]) {
    if (apps.includes(app)) continue
    using.delete(app)
    clearTimeout(timers.get(`start:${app}`)); timers.delete(`start:${app}`)
    if (!calls.has(app)) continue
    gone.set(app, now)
    timers.set(`end:${app}`, setTimeout(() => {
      timers.delete(`end:${app}`)
      if (using.has(app) || !calls.has(app)) return
      calls.delete(app)
      emit({ type: 'end', app, at: new Date(gone.get(app)).toISOString() })
    }, END_MS))
  }
}

export function start() {
  wanted = true
  if (proc) return true
  const bin = watchBin()
  if (!bin) return false
  // Each watcher only speaks for itself: one stopped and replaced (Notice calls off and on again)
  // can't end the new one's calls or clear it when it exits.
  const child = proc = spawn(bin, [], { stdio: ['ignore', 'pipe', 'ignore'] })
  child.unref?.()
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (proc !== child) return
    let d
    try { d = JSON.parse(line) } catch { return }
    seen([...new Set((d.input || []).map((p) => appOf(String(p.bundle || ''))).filter(Boolean))])
  })
  child.on('error', () => { if (proc === child) proc = null })
  child.on('exit', () => {
    if (proc !== child) return
    proc = null
    seen([])
    // Gone by itself: back in a while, as long as it's still wanted.
    if (wanted) setTimeout(() => { if (wanted && !proc) start() }, 15000).unref?.()
  })
  return true
}

export function stop() {
  wanted = false
  const p = proc
  proc = null
  if (p) try { p.kill('SIGTERM') } catch { /* gone */ }
  for (const t of timers.values()) clearTimeout(t)
  timers.clear(); using.clear(); calls.clear(); gone.clear()
}
process.once('exit', () => { if (proc) try { proc.kill('SIGTERM') } catch { /* gone */ } })

// What's going on now: { watching, calls: [{ app, since, browser }] }.
export function now() {
  return { watching: !!proc, calls: [...calls].map(([app, since]) => ({ app, since: new Date(since).toISOString(), browser: BROWSERS.has(app) })) }
}
