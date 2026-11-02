import { useEffect, useRef, useState } from 'react'
import { apiUrl, viaRelay, machineId, cloudOnly } from './api.js'
import { getState as dictation } from './dictation/controller.js'

// Keeping up with the computer. A phone keeps Bridge AI's page open for days (the phone app in the
// background, a home-screen app the phone holds in memory, what the phone kept while the computer
// was offline), and the computer can update under it meanwhile: the page would go on as the old
// version, without what came since (3.8's Whiteboards, say), until the app was closed for good.
// So this page asks the computer which UI it hands out now (/api/version's ui: its entry file,
// whose name carries a hash of the build) and compares it with its own. When they differ, it loads
// the new one by itself whenever nobody's in the middle of something: off the screen, or just back
// on it before a tap. Otherwise it says so, with Reload (useFresh). A meeting recording in this page
// or dictation under way is never cut short: they wait for the next time.

// This page's own UI: the built entry file it loaded (none from Vite's dev server, which updates
// the page itself).
export const thisUi = (() => {
  try {
    for (const s of document.querySelectorAll('script[type="module"][src]')) {
      const p = new URL(s.getAttribute('src'), location.href).pathname
      if (/\/assets\/[^/]+\.js$/.test(p)) return p.split('/').pop()
    }
  } catch { /* no document */ }
  return null
})()

// Not in the desktop app's own window, which the app starts again on an update (another device's
// Bridge AI shown in it is kept up to date, like a phone), nor in the builds that bring their own
// UI (the demo, the phone apps' Cloud agents).
const on = !!thisUi && !cloudOnly && import.meta.env.MODE !== 'demo' && (!window.bridgeApp || !!machineId)

// The page's state, for what's "in the middle of something".
let shownAt = Date.now() // opened, or back on the screen
let touchedAt = 0
if (on) {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) shownAt = Date.now() })
  window.addEventListener('pageshow', (e) => { if (e.persisted) shownAt = Date.now() })
  for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'wheel']) window.addEventListener(ev, () => { touchedAt = Date.now() }, { capture: true, passive: true })
}
const typing = () => {
  const el = document.activeElement
  if (!el || el === document.body) return false
  if (el.isContentEditable) return true
  return /^(TEXTAREA|INPUT)$/.test(el.tagName) && !!el.value
}
// Something that would be lost or cut short by a reload: never then.
const held = (hold) => !!hold || dictation().phase !== 'idle'
// No field being typed in and no dialog open, and off the screen or back on it with nothing touched
// since: a reload goes unnoticed (a message's draft is kept anyway: Composer.jsx).
export const quiet = (hold) => !held(hold) && !typing() && !document.querySelector('[role="dialog"], [aria-modal="true"]') && (document.hidden || touchedAt < shownAt)

// Reload into the new UI. Through the relay the phone page may do more: load its own new files too,
// if the computer updated the relay with it (relay/web/shell.js bridgeRelay.reload).
export function reload() {
  try { if (viaRelay && typeof window.parent.bridgeRelay?.reload === 'function') return window.parent.bridgeRelay.reload() } catch { /* not ours */ }
  location.reload()
}

// Which UI the computer hands out now: { ui, version, computer }, or null when that isn't known. Not
// from what the phone kept while the computer is offline (shell.js marks those answers), which may
// be newer than the copy of the page it kept.
async function computerUi() {
  try {
    if (document.documentElement.classList.contains('bridge-saved')) return null
    const r = await fetch(apiUrl('/version'), { cache: 'no-store' })
    if (!r.ok || r.headers.get('x-bridge-saved')) return null
    const v = await r.json()
    return v?.ui ? v : null
  } catch { return null }
}

// A reload that brought the same page back (something on the way kept the old one) isn't tried
// again for a while, so it can never go round in circles: then it only says so.
const TRIED = 'cc-fresh-tried'
const tried = (ui) => { try { const x = JSON.parse(sessionStorage.getItem(TRIED) || 'null'); return x?.ui === ui && Date.now() - x.at < 10 * 60 * 1000 } catch { return false } }
const reloadFor = (ui) => { try { sessionStorage.setItem(TRIED, JSON.stringify({ ui, at: Date.now() })) } catch { /* private mode */ } reload() }

// Asked when the page comes back on the screen or online, when the phone page's link to the
// computer is back (it says so with bridge-settings), and every few minutes while it's shown.
const EVERY = 3 * 60 * 1000
const FIRST = 15 * 1000

// { stale: { ui, version, computer } | null, reload }. hold: a meeting is recording in this page.
export function useFresh({ hold = false } = {}) {
  const [stale, setStale] = useState(null)
  const holdRef = useRef(hold)
  holdRef.current = hold
  const staleRef = useRef(null)
  staleRef.current = stale
  useEffect(() => {
    if (!on) return
    let busy = false
    const check = async () => {
      if (busy) return
      busy = true
      try {
        const v = await computerUi()
        if (!v || v.ui === thisUi) return
        if (quiet(holdRef.current) && !tried(v.ui)) return reloadFor(v.ui)
        setStale({ ui: v.ui, version: v.version || null, computer: v.computer || null })
      } finally { busy = false }
    }
    // Known to be out of date: the next quiet moment loads the new one, without asking again.
    const tick = () => { const s = staleRef.current; if (s && quiet(holdRef.current) && !tried(s.ui)) reloadFor(s.ui); else if (!s) check() }
    const onVis = () => { if (!document.hidden) tick() }
    const first = setTimeout(tick, FIRST)
    const every = setInterval(() => { if (!document.hidden) tick() }, EVERY)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onVis)
    window.addEventListener('online', tick)
    window.addEventListener('bridge-settings', tick)
    // For the phone page: this frame looks after itself (an older UI there doesn't, and the phone
    // page does it for that one).
    window.bridgeFresh = { check: tick, quiet: () => quiet(holdRef.current) }
    return () => {
      clearTimeout(first); clearInterval(every)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onVis)
      window.removeEventListener('online', tick)
      window.removeEventListener('bridge-settings', tick)
      delete window.bridgeFresh
    }
  }, [])
  // Hidden while it waits (a recording ended, say): now's the time.
  useEffect(() => { if (stale && !hold && document.hidden && quiet(false) && !tried(stale.ui)) reloadFor(stale.ui) }, [stale, hold])
  return { stale, reload }
}

// ---------- the phone apps themselves ----------
// The iPhone and Android apps carry a part of their own (the iPhone app even the phone page), so a
// page from a newer computer can need a newer app: Save to Files needs the iPhone app's own saving
// (3.8.0). Raise the version here when this page starts using something only a newer app has.
export const APP_NEEDS = { ios: '3.8.0', android: '3.5.0' }
// The website's page for the Android app (it isn't on Google Play yet).
export const ANDROID_PAGE = 'https://sahil1.github.io/bridge/#android'

const parts = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0)
export const older = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false }

// The phone app this page is in (its user agent says, BridgeAIApp/<version>), when it's older than
// this page needs: { platform: 'ios' | 'android', have, need }. null in a browser, or when it's new enough.
export function oldApp(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  const m = /BridgeAIApp\/(\d+(?:\.\d+){0,2})/.exec(ua)
  if (!m || cloudOnly) return null
  const platform = /Android/i.test(ua) ? 'android' : 'ios'
  return older(m[1], APP_NEEDS[platform]) ? { platform, have: m[1], need: APP_NEEDS[platform] } : null
}
