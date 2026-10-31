import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, machineId, viaRelay, refetch, usePoll } from './api.js'
import { SettingsAt } from './components/settings/where.js'
import { tx } from './i18n/index.js'

// Every permission Bridge AI may ask a computer for, and one way to get each, wherever it comes up
// (PermissionFix.jsx shows it; Settings › General › Permissions lists them all):
//   1. The system's own question first, where there is one: the desktop app asks for the
//      microphone and Accessibility (desktop/permissions.js), the server for Calendars and
//      Automation (server/fixes.js). System Settings, with the tile beside it, only when there's
//      none to ask (Full Disk Access, the folders) or it already said no.
//   2. Noticed by itself: looked at every few seconds while you're allowing it, now and then
//      otherwise, and whenever you come back to the window. What was waiting carries on (onAllowed).
//   3. Stuck: still off a moment after you say it's on (or a while after System Settings opened),
//      Reset and ask again: macOS forgets this app's answer (one kept from a build signed
//      differently, a switch that's on and doesn't take) and asks again. One that only applies after
//      a restart offers Restart to apply, and comes back to where you were.
//   4. Never a button that can't work here. Another device's page shown in this window, or your
//      phone: allow it on that computer, whose desktop app is asked to show its own question when it
//      can be (never this window's). A desktop app older than this page: update it, one click.
//
//   app    the desktop app's own to ask for and see (the rest are the server's, which reads them)
//   reset  macOS files it under a name tccutil can forget (Reset and ask again)
//   restart  what you allow reaches Bridge AI only once it restarts
//   win    Windows asks about it too
export const KINDS = {
  microphone: { label: tx('Microphone'), why: tx('Voice notes, dictation and meeting notes.'), app: true, reset: true, win: true },
  accessibility: { label: tx('Accessibility'), why: tx('Pasting what you dictate where you\'re typing.'), app: true, reset: true },
  calendars: { label: tx('Calendars'), why: tx('Your schedule in Today, and meeting notes named after their event.'), reset: true },
  'full-disk': { label: tx('Full Disk Access'), why: tx('Reading Mail, for your inbox and for meeting notes.'), reset: true, restart: true },
  files: { label: tx('Files & Folders'), why: tx('Agents working in your Desktop, Documents or Downloads folder.'), reset: true, restart: true },
  audio: { label: tx('Screen & System Audio Recording'), why: tx('A call\'s sound, for meeting notes.'), reset: true },
  automation: { label: tx('Automation'), why: tx('Moving files to the Trash through Finder.'), reset: true },
  notifications: { label: tx('Notifications'), why: tx('When an agent needs you or finishes.'), app: true, win: true },
}

export const useFix = () => usePoll('/fix', 10 * 60 * 1000)

// Check on focus, on coming back to the tab, and every `every` ms while the tab is visible.
export function useRecheck(fn, every = 0, enabled = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    const go = () => { if (!document.hidden) ref.current() }
    window.addEventListener('focus', go)
    document.addEventListener('visibilitychange', go)
    const id = every ? setInterval(go, every) : null
    return () => { window.removeEventListener('focus', go); document.removeEventListener('visibilitychange', go); clearInterval(id) }
  }, [every, enabled])
}

// The desktop app around this page, when the page is this computer's own: another device's page
// shown in this window, or a phone, gets none of it (desktop/preload.js).
export const desktopApp = () => (!machineId && !viaRelay && window.bridgeApp?.desktop ? window.bridgeApp : null)
// Its version, from its user agent ("BridgeAI/3.7.1", as Electron writes every app's): every version
// has said it, so an old one can be told it's old.
export const appVersion = () => (desktopApp() ? /\bBridgeAI\/(\d+\.\d+\.\d+)\b/.exec(navigator.userAgent)?.[1] || null : null)
const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0)
export const newer = (a, b) => { const x = parts(a); const y = parts(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i] } return false }

// The desktop app's side of one permission: { status, ask, reset } (reset null where the app can't),
// null where it isn't the app's to ask or there's no app here, or 'update' when the app is too old to.
const MEDIA = { granted: 'ok', denied: 'denied', restricted: 'restricted', 'not-determined': 'ask' }
export function appSide(kind) {
  const a = desktopApp()
  if (!a || !KINDS[kind]?.app) return null
  if (a.permission) return { status: () => a.permission.status(kind), ask: () => a.permission.ask(kind), reset: () => a.permission.reset(kind), canReset: () => a.permission.canReset(kind), open: () => a.permission.open(kind) }
  // Older desktop apps, as far as they go: 3.7 asks macOS for the mic and Accessibility; 3.5 only
  // says whether the mic is allowed (System Settings and its tile still work, through the server).
  if (kind === 'microphone' && a.mediaAccess) {
    return {
      status: async () => MEDIA[await a.mediaAccess('microphone')] ?? null,
      ask: a.askMedia ? async () => (MEDIA[await a.askMedia('microphone')] === 'ok' ? 'ok' : 'denied') : null,
      reset: a.resetMedia ? async () => (MEDIA[await a.resetMedia('microphone')] === 'ok' ? 'ok' : 'denied') : null,
      canReset: async () => !!a.resetMedia,
    }
  }
  if (kind === 'accessibility' && a.pasteAccess && a.pasteAsk) {
    return { status: async () => ((await a.pasteAccess()) === 'ok' ? 'ok' : 'denied'), ask: async () => ((await a.pasteAsk()) === 'ok' ? 'ok' : 'asked'), reset: null, canReset: async () => false }
  }
  if (kind === 'notifications' && a.testNotification) return { status: async () => 'unknown', ask: null, reset: null, canReset: async () => false }
  return 'update'
}

// Restart to apply, and back where you were: the Settings section it was asked from comes back
// after (App.jsx), so you see it's on. RestartChip.jsx keeps it when the restart happens.
export const RETURN = 'cc-perm-return'
export const rememberReturn = (pane, section) => { window.__bridgeReturn = { pane, section: section || null, at: Date.now() } }
export function keepReturn() {
  try { if (window.__bridgeReturn) localStorage.setItem(RETURN, JSON.stringify(window.__bridgeReturn)) } catch { /* no storage: it just doesn't come back */ }
}
export function takeReturn() {
  let r = null
  try { r = JSON.parse(localStorage.getItem(RETURN) || 'null'); localStorage.removeItem(RETURN) } catch { /* none */ }
  return r && Date.now() - r.at < 5 * 60 * 1000 ? r : null
}
const askRestart = () => window.dispatchEvent(new Event('bridge-restart'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// One permission, the same way wherever it's asked for. pane: a key of KINDS. folder: for files,
// which (Desktop, Documents, Downloads). onAllowed: what was waiting for it, carried on once it's on.
// stale: the system says it's on and it doesn't take (the mic turned down anyway): straight to Reset.
// quiet: not looked at until you act, where looking could itself ask (a look into Desktop is what
// makes macOS ask about it); initial: what it is meanwhile (the server's list says).
export function usePermission(pane, { folder = null, onAllowed, stale = false, quiet = false, initial = null } = {}) {
  const { data: fix } = useFix()
  const section = useContext(SettingsAt)
  const k = KINDS[pane] || {}
  const where = machineId ? 'device' : viaRelay ? 'phone' : 'here'
  const side = where === 'here' ? appSide(pane) : null
  const update = side === 'update'
  const app = side && side !== 'update' ? side : null
  // Which system it's asked of: for what the desktop app asks itself, the app's (the computer it runs
  // on, which a page can be shown from another server on); otherwise the server's computer.
  const appOs = side ? window.bridgeApp?.platform || null : null
  const mac = appOs ? appOs === 'darwin' : !!fix?.mac
  const win = appOs ? appOs === 'win32' : !!fix?.win
  const [state, setState] = useState(initial) // ok | ask | denied | restricted | restart | unknown
  const [looking, setLooking] = useState(!quiet)
  useEffect(() => { if (!looking && initial) setState(initial) }, [initial, looking])
  // What's being done: asking (the system's question is up), settings (System Settings is open),
  // tested (a test notification went), checking (you said it's on), stuck (it isn't: Reset), resetting,
  // told (another device was asked to show its question).
  const [step, setStep] = useState(stale ? 'stuck' : null)
  const [since, setSince] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [fast, setFast] = useState(false)
  const [appReset, setAppReset] = useState(false)
  // A stale "allowed" isn't believed until it's been reset.
  const trust = useRef(!stale)
  const done = useRef(false)
  const fns = useRef({})
  fns.current = { onAllowed }

  useEffect(() => {
    let live = true
    if (app?.canReset) Promise.resolve(app.canReset()).then((c) => { if (live) setAppReset(!!c) }, () => {})
    return () => { live = false }
  }, [pane, !!app]) // eslint-disable-line react-hooks/exhaustive-deps
  // The app forgets its own answers; otherwise the server, when it's the app's own (fixes.js).
  const canReset = !!k.reset && where === 'here' && mac && (appReset || !!fix?.canReset)

  const check = useCallback(async () => {
    let s = null
    try {
      s = app ? await app.status() : (await api(`/fix/check?pane=${encodeURIComponent(pane)}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`)).state
    } catch { /* looked at again later */ }
    if (s == null) return null
    if (s === 'ok' && !trust.current) return 'stale'
    setState((was) => { if (s === 'restart' && was !== 'restart') refetch('/fix'); return s })
    if (s === 'ok') {
      if (where === 'here') window.bridgeApp?.closeFixTile?.()
      setStep(null)
      if (!done.current) { done.current = true; fns.current.onAllowed?.() }
    } else done.current = false
    return s
  }, [pane, folder, !!app, where]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!update && looking) check() }, [check, update, looking])
  // Every few seconds while it's being allowed (for ten minutes), now and then otherwise, and when
  // you come back to the window.
  const waiting = state !== 'ok' && state !== 'restart' && !update
  useRecheck(check, fast ? 2500 : 30000, waiting && looking)
  useEffect(() => { if (!fast) return; const t = setTimeout(() => setFast(false), 10 * 60 * 1000); return () => clearTimeout(t) }, [fast])
  useEffect(() => () => { if (where === 'here') window.bridgeApp?.closeFixTile?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const watch = (s) => { setStep(s); setFast(true); setSince(Date.now()); setLooking(true) }

  // System Settings, opened by the server (it's this computer), which asks macOS first where it can
  // (Calendars, Automation); the tile beside it is the desktop app's. 'ok', 'restart' or 'opened'.
  const openSettings = async () => {
    const r = await api('/fix/settings', { method: 'POST', body: { pane, ...(folder ? { folder } : {}) } })
    if (r?.state === 'ok' || r?.state === 'restart') return r.state
    await window.bridgeApp?.fixTile?.(pane)?.catch?.(() => {})
    return 'opened'
  }

  const askThere = async () => {
    setError(null)
    try { await api('/fix/ask-here', { method: 'POST', body: { pane, ...(folder ? { folder } : {}) } }); watch('told') } catch (e) { setError(e.message) }
  }

  const allow = async () => {
    if (where !== 'here') return askThere()
    setError(null)
    setBusy(true)
    try {
      // Notifications: the first one is how macOS asks; a test shows whether they're on.
      if (pane === 'notifications' && window.bridgeApp?.testNotification) { await window.bridgeApp.testNotification(); watch('tested'); return }
      if (app?.ask) {
        const before = await app.status().catch(() => null)
        const r = await app.ask()
        if (r === 'ok') { await check(); return }
        if (r === 'restricted') { setState('restricted'); return }
        if (r === 'asked') { watch('asking'); return }
        if (r === 'opened') { watch('settings'); return }
        // Its question was just turned down: that's the answer, and Allow access again goes to
        // System Settings. One that had said no before (an older app): System Settings, below.
        if (before === 'ask') { setState('denied'); setStep(null); return }
      }
      if (pane === 'calendars') setStep('asking')
      const r = await openSettings()
      if (r === 'ok' || r === 'restart') { await check(); return }
      watch('settings')
    } catch (e) { setError(e.message); setStep(null) } finally { setBusy(false) }
  }

  // "I've turned it on".
  const turnedOn = async () => {
    if (where === 'here') window.bridgeApp?.closeFixTile?.()
    setError(null)
    let s = await check()
    if (s === 'ok') return
    // What reaches Bridge AI only after a restart: your word for it, and the restart applies it.
    if (k.restart || s === 'restart') {
      await api('/fix/claim', { method: 'POST', body: { pane } }).catch(() => {})
      setState('restart')
      setStep(null)
      refetch('/fix')
      return
    }
    // Nothing can tell (Automation before it's been asked, notifications): your word for it.
    if (s === 'unknown') { setState('ok'); setStep(null); if (!done.current) { done.current = true; fns.current.onAllowed?.() } return }
    // A moment for macOS to catch up; still off, and it's stuck.
    setStep('checking')
    setFast(true)
    for (let i = 0; i < 6 && s !== 'ok'; i++) { await sleep(500); s = await check() }
    if (s !== 'ok') setStep('stuck')
  }

  const reset = async () => {
    setError(null)
    setStep('resetting')
    trust.current = true
    try {
      // Asked again straight after: the system's question now (it has no answer to go on), or
      // System Settings. Turned down again: that's the answer.
      const then = async (r) => {
        if (r === 'ok') { await check(); return true }
        if (r === 'asked') { watch('asking'); return true }
        if (r === 'opened') { watch('settings'); return true }
        if (r === 'denied' || r === 'ask') { setState('denied'); setStep(null); return true }
        return false
      }
      if (app?.reset) {
        if (await then(await app.reset())) return
      } else {
        await api('/fix/reset', { method: 'POST', body: { pane, ...(folder ? { folder } : {}) } })
        if (app?.ask && await then(await app.ask())) return
      }
      const r = await openSettings()
      if (r === 'ok' || r === 'restart') { await check(); return }
      watch('settings')
    } catch (e) { setError(e.message); setStep('stuck') }
  }

  const restart = () => { rememberReturn(pane, section); askRestart() }

  return {
    pane, k, where, state, step, since, busy, error, update, canReset, fix, mac, win, known: !!fix || !!appOs,
    device: fix?.device || null,
    // Another device can be asked when its desktop app is listening (server/fixes.js askHere).
    listening: !!fix?.desktop?.listening,
    askedFrom: fix?.asked?.pane === pane ? fix.asked.from || '' : null,
    allow, turnedOn, reset, restart, askThere, check,
  }
}

// The desktop app updated, for one too old for something this page asks of it: the server runs the
// installer, which replaces the app where it is and opens it again (server/updates.js).
export const updateApp = () => api('/updates/install', { method: 'POST', body: { app: true } })
