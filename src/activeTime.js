import { api, viaRelay } from './api.js'
import { currentLang } from './i18n/index.js'
import { load } from './appearance.js'

// Usage counts' time in use (server/counts.js, activity()): once a minute, while this window is in
// front and someone typed, clicked, scrolled or touched it in the last two minutes, it tells its
// server. The server counts a minute only while Share anonymous usage counts is on, and once
// however many windows say so. Only this computer's own windows: not a phone through the relay
// (the phone apps send nothing of the kind), and nothing in the demo.
const RECENT = 2 * 60 * 1000
export function countActiveTime() {
  if (import.meta.env.MODE === 'demo' || viaRelay) return
  // Once, as it opens: its language and its look (usage stats' features; ignored while they're off).
  setTimeout(() => { const a = load(); api('/counts/window', { method: 'POST', body: { language: currentLang(), appearance: a.mode, theme: a.theme } }).catch(() => {}) }, 3000)
  let last = 0
  const touched = () => { last = Date.now() }
  for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart']) window.addEventListener(ev, touched, { capture: true, passive: true })
  setInterval(() => {
    if (document.hidden || !document.hasFocus() || Date.now() - last > RECENT) return
    api('/counts/active', { method: 'POST' }).catch(() => {})
  }, 60 * 1000)
}
