import { useEffect, useRef, useState, useCallback } from 'react'

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
export function usePoll(path, intervalMs, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const pathRef = useRef(path)
  pathRef.current = path

  const refresh = useCallback(async (suffix = '') => {
    if (!pathRef.current) return
    try {
      const data = await api(pathRef.current + suffix)
      setState({ data, error: null, loading: false })
    } catch (error) {
      setState((s) => ({ ...s, error: error.message, loading: false }))
    }
  }, [])

  useEffect(() => {
    if (!enabled || !path) return
    setState((s) => ({ ...s, loading: !s.data }))
    refresh()
    const id = setInterval(() => { if (!document.hidden) refresh() }, intervalMs)
    const onVis = () => { if (!document.hidden) refresh() }
    const onSettings = () => refresh()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('bridge-settings', onSettings)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('bridge-settings', onSettings) }
  }, [path, intervalMs, enabled, refresh])

  useEffect(() => {
    if (!state.error || !enabled || !path || intervalMs <= 60000) return
    const t = setTimeout(() => refresh(), 60000)
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
