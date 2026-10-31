import { useEffect, useRef, useState, useCallback } from 'react'
import { locale, t } from './i18n/index.js'

// Opened on a phone through your own relay (relay/): the app runs inside the relay's page, which
// carries its requests to your computer over an end-to-end encrypted link.
const relayPage = (() => { try { return window.parent !== window ? window.parent.bridgeRelay || null : null } catch { return null } })()
export const viaRelay = !!relayPage
// In a tab of another Bridge AI window (an agent on another of your devices, shown there).
export const embedded = (() => { try { return window.self !== window.top && !relayPage } catch { return true } })()
// In the iPhone or Android app: the computers it's paired with ({ list, open, add, forget }).
export const relayComputers = relayPage?.computers || null
// ...and the app's own screens, from inside a computer's page: its start screen (pair or open a
// computer) and its Cloud agents. The relay page offers them when it can (bridgeRelay.start and
// .openCloud); until then, the same as its own screens do: the pairing screen's list of computers
// (computers.add), and asking the app for Cloud agents (the iPhone app hears the relay page, the
// frame above this one; Android's bridge is in every frame), when the app has them. null in a
// browser, which has neither.
export const phoneApp = (() => {
  if (!relayComputers) return null
  let native = null
  try { native = window.parent.bridgeNative?.post ? window.parent.bridgeNative : null } catch { /* not ours */ }
  const android = typeof window.bridgeAndroid?.openBundled === 'function' ? window.bridgeAndroid : null
  let bundled = []
  try { bundled = native?.bundled || JSON.parse(android?.bundled?.() || '[]') } catch { /* none */ }
  const cloud = typeof relayPage.openCloud === 'function' ? () => relayPage.openCloud()
    : !bundled.includes('cloud') ? null : native ? () => native.post({ type: 'open', name: 'cloud' }) : android ? () => android.openBundled('cloud') : null
  return { start: typeof relayPage.start === 'function' ? () => relayPage.start() : () => relayComputers.add(), cloud }
})()
// ...which shows the agents at work on the phone's lock screen (older relay pages can't).
export const relayActivity = relayPage?.activity || null
// What the phone sent while your computer was offline, and how each is doing ({ list, subscribe, dismiss }).
export const relayOutbox = relayPage?.outbox || null
export function useOutbox(paneId) {
  const [items, setItems] = useState(() => relayOutbox?.list(paneId) || [])
  useEffect(() => relayOutbox?.subscribe(() => setItems(relayOutbox.list(paneId))), [paneId])
  return items
}

// The phone apps' Cloud agents (src/cloud, `vite build --mode cloud`): this UI for cloud agents
// alone, on the phone with no computer, so everything else is left out.
export const cloudOnly = import.meta.env.MODE === 'cloud'
// Where that keeps keys, in its own words.
export const keyStore = /Android/i.test(navigator.userAgent) ? "Android's Keystore" : /iPhone|iPad|Macintosh/i.test(navigator.userAgent) ? "this iPhone's Keychain" : "the phone's secure storage"

// Another of your devices, shown through this one (server/machines.js): its own Bridge AI, at
// /m/<id>/ here, so everything it asks for goes to /m/<id>/api/... and on to that device.
// The demo is a static site, so there it's ?m=<id> instead (src/demo).
const onMachine = /^\/m\/([A-Za-z0-9_-]{1,20})\//.exec(location.pathname) || (import.meta.env.MODE === 'demo' ? /[?&]m=([A-Za-z0-9_-]{1,20})(?:&|$)/.exec(location.search) : null)
export const machineId = onMachine ? onMachine[1] : null
export const BASE = onMachine ? `/m/${onMachine[1]}` : ''
// An address on the device shown: apiUrl('/files?x') is /api/files?x, or /m/<id>/api/files?x.
export const apiUrl = (p) => `${BASE}/api${p}`
// Bridge AI on the computer it runs on (the desktop app, or a browser there), not a phone, and
// not another device shown through this one: Finder, file paths and the mic are this computer's.
export const onThisComputer = () => !machineId && !viaRelay && (!!window.bridgeApp?.desktop || ['127.0.0.1', 'localhost'].includes(location.hostname))

// A WebSocket to this server (the live terminal), through the relay's link when there is one.
export const openSocket = (path) => (relayPage ? new relayPage.WebSocket(`${BASE}${path}`) : new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${BASE}${path}`))

export async function api(path, opts = {}) {
  const res = await fetch(apiUrl(path), {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  // code: set when the app can offer a fix (EPERM, noBrew, calendarAccess...).
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), data.code ? { code: data.code } : {})
  return data
}

// The device this page comes from, whichever one it shows: its list of your devices says where
// each one is (/m/<id>/ here).
export async function hostApi(path, opts = {}) {
  const res = await fetch(`/api${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// Tell every poller that settings changed (location, name, default agent…), so cards that
// depend on them refetch now instead of at their next interval.
export const settingsChanged = () => window.dispatchEvent(new Event('bridge-settings'))
// The same for one endpoint (after an account switch, every view of /quota).
export const refetch = (path) => window.dispatchEvent(new CustomEvent('bridge-refetch', { detail: path }))

// Poll an endpoint while the tab is visible. Returns { data, error, loading, refresh }.
// After an error it retries within a minute, whatever the interval.
// Polled GETs are shared across the app: components asking for the same path at the same time
// share one request, and a view that mounts again starts from the last answer (then refreshes)
// instead of an empty state.
const lastData = new Map() // path -> { data, at }
const inflight = new Map() // path -> Promise
function sharedGet(path, force) {
  const hit = lastData.get(path)
  if (!force && hit && Date.now() - hit.at < 1500) return Promise.resolve(hit.data)
  if (!force && inflight.has(path)) return inflight.get(path)
  const p = api(path).then((data) => { lastData.set(path, { data, at: Date.now() }); return data }).finally(() => { if (inflight.get(path) === p) inflight.delete(path) })
  inflight.set(path, p)
  return p
}

export function usePoll(path, intervalMs, { enabled = true } = {}) {
  const [state, setState] = useState(() => {
    const hit = path && lastData.get(path)
    return hit ? { data: hit.data, error: null, loading: false } : { data: null, error: null, loading: true }
  })
  const pathRef = useRef(path)
  pathRef.current = path

  // Timed and on-mount loads share requests; a refresh you ask for (after a change, or with
  // ?refresh=1) always goes to the server.
  const load = useCallback(async (suffix = '', shared = false) => {
    if (!pathRef.current) return
    try {
      const data = suffix ? await api(pathRef.current + suffix) : await sharedGet(pathRef.current, !shared)
      setState({ data, error: null, errorCode: null, loading: false })
    } catch (error) {
      setState((s) => ({ ...s, error: error.message, errorCode: error.code || null, loading: false }))
    }
  }, [])
  const refresh = useCallback((suffix = '') => load(suffix, false), [load])

  useEffect(() => {
    if (!enabled || !path) return
    setState((s) => ({ ...s, loading: !s.data }))
    load('', true)
    const id = setInterval(() => { if (!document.hidden) load('', true) }, intervalMs)
    const onVis = () => { if (!document.hidden) load('', true) }
    // Settings changed: drop the cached answer, then reload (once, shared by every view using it).
    const onSettings = () => { lastData.delete(path); load('', true) }
    const onRefetch = (e) => { if (e.detail === path) onSettings() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('bridge-settings', onSettings)
    window.addEventListener('bridge-refetch', onRefetch)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('bridge-settings', onSettings); window.removeEventListener('bridge-refetch', onRefetch) }
  }, [path, intervalMs, enabled, load])

  useEffect(() => {
    if (!state.error || !enabled || !path || intervalMs <= 60000) return
    const t = setTimeout(() => load('', true), 60000)
    return () => clearTimeout(t)
  }, [state.error, enabled, path, intervalMs, refresh])

  return { ...state, refresh }
}

// Live fleet over server-sent events, with a polling fallback.
export function useFleet() {
  const [fleet, setFleet] = useState(null)
  const [live, setLive] = useState(false)
  useEffect(() => {
    let es
    let timer
    const connect = () => {
      es = new EventSource(`${BASE}/api/events`)
      es.addEventListener('fleet', (e) => { setFleet(JSON.parse(e.data)); setLive(true) })
      es.onerror = () => { setLive(false); es.close(); timer = setTimeout(connect, 3000) }
    }
    connect()
    api('/fleet').then(setFleet).catch(() => {})
    return () => { es?.close(); clearTimeout(timer) }
  }, [])
  return { fleet, live }
}

export const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) : ''

export function fmtRelative(iso) {
  if (!iso) return ''
  const ms = new Date(iso) - Date.now()
  const abs = Math.abs(ms)
  const h = abs / 3.6e6
  const s = h < 1 ? `${Math.round(abs / 6e4)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`
  return ms >= 0 ? t('in {time}', { time: s }) : t('{time} ago', { time: s })
}

// Like usePoll, but the server pushes updates as they happen (Server-Sent Events at `${path}/live`).
// Falls back to polling every `fallbackMs` if the stream can't be opened.
export function useLive(path, fallbackMs = 2000) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    if (!path) return
    let dead = false
    let es = null
    let poll = null
    setState({ data: null, error: null, loading: true })
    const startPoll = () => {
      if (poll || dead) return
      const tick = () => api(path).then((d) => { if (!dead) setState({ data: d, error: null, loading: false }) }).catch((e) => { if (!dead) setState((s) => ({ ...s, error: e.message, loading: false })) })
      tick()
      poll = setInterval(() => { if (!document.hidden) tick() }, fallbackMs)
    }
    if (typeof EventSource === 'undefined') startPoll()
    else {
      es = new EventSource(`${BASE}/api${path}/live`)
      es.onmessage = (e) => { try { if (!dead) setState({ data: JSON.parse(e.data), error: null, loading: false }) } catch { /* partial frame */ } }
      es.addEventListener('problem', (e) => { try { if (!dead) setState((s) => ({ ...s, error: JSON.parse(e.data).error, loading: false })) } catch { /* ignore */ } })
      es.onerror = () => { if (es.readyState === EventSource.CLOSED) { es.close(); startPoll() } } // otherwise it reconnects by itself
    }
    return () => { dead = true; es?.close(); clearInterval(poll) }
  }, [path, fallbackMs])
  return state
}

// Open a pane (an agent, or a shell tab as "tab:<id>") in your own terminal app via `bridge-ai attach`.
export const openInTerminal = (paneId) => api(`/panes/${encodeURIComponent(paneId)}/terminal`, { method: 'POST' })
