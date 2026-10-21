import { useEffect, useRef, useState, useCallback } from 'react'

// Opened on a phone through your own relay (relay/): the app runs inside the relay's page, which
// carries its requests to your computer over an end-to-end encrypted link.
const relayPage = (() => { try { return window.parent !== window ? window.parent.bridgeRelay || null : null } catch { return null } })()
export const viaRelay = !!relayPage
// In the iPhone or Android app: the computers it's paired with ({ list, open, add, forget }).
export const relayComputers = relayPage?.computers || null
// ...which shows the agents at work on the phone's lock screen (older relay pages can't).
export const relayActivity = relayPage?.activity || null

// A WebSocket to this server (the live terminal), through the relay's link when there is one.
export const openSocket = (path) => (relayPage ? new relayPage.WebSocket(path) : new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`))

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// Tell every poller that settings changed (location, name, default agent…), so cards that
// depend on them refetch now instead of at their next interval.
export const settingsChanged = () => window.dispatchEvent(new Event('bridge-settings'))

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
      setState({ data, error: null, loading: false })
    } catch (error) {
      setState((s) => ({ ...s, error: error.message, loading: false }))
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
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('bridge-settings', onSettings)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('bridge-settings', onSettings) }
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
      es = new EventSource('/api/events')
      es.addEventListener('fleet', (e) => { setFleet(JSON.parse(e.data)); setLive(true) })
      es.onerror = () => { setLive(false); es.close(); timer = setTimeout(connect, 3000) }
    }
    connect()
    api('/fleet').then(setFleet).catch(() => {})
    return () => { es?.close(); clearTimeout(timer) }
  }, [])
  return { fleet, live }
}

export const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''

export function fmtRelative(iso) {
  if (!iso) return ''
  const ms = new Date(iso) - Date.now()
  const abs = Math.abs(ms)
  const h = abs / 3.6e6
  const s = h < 1 ? `${Math.round(abs / 6e4)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`
  return ms >= 0 ? `in ${s}` : `${s} ago`
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
      es = new EventSource(`/api${path}/live`)
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
