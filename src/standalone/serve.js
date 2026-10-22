// Bridge AI's UI with no computer behind it: the demo (src/demo), bundled in the phone apps and
// built as a static site. Every /api request and live stream the UI makes is answered in the page
// by a backend object instead of a server. It's installed at the same seam the relay uses (fetch,
// EventSource and WebSocket), before the app loads, so the UI itself doesn't know the difference.
//
// A backend is:
//   request({ method, path, query, body }) -> data (or a promise of it). path has no /api prefix
//     ("/fleet"), query is a URLSearchParams, body is parsed JSON (or the raw Blob for uploads).
//     Throw an Error to answer { error: message }, with its .status (400 if none).
//   stream(path, send) -> stop, for EventSource('/api' + path): send(data) for a message,
//     send(data, 'fleet') for a named event. Return null when there's no such stream.
//   microphone() (optional): stands in for getUserMedia; throw to say why there's none.
const API = '/api/'

const own = (url) => {
  try {
    const u = new URL(url, location.href)
    return u.origin === location.origin && u.pathname.startsWith(API) ? u : null
  } catch { return null }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function serve(backend) {
  const realFetch = window.fetch.bind(window)

  // ---------- fetch ----------
  window.fetch = async (input, init = {}) => {
    const u = own(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    if (!u) return realFetch(input, init)
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    let body = init.body ?? null
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { /* plain text */ } }
    // A moment's wait, as over a network, so loading states look the way they do for real.
    await sleep(25 + Math.random() * 60)
    let status = 200
    let data
    try {
      data = await backend.request({ method, path: u.pathname.slice(API.length - 1), query: u.searchParams, body })
    } catch (e) {
      status = e.status || 400
      data = { error: e.message }
    }
    return new Response(JSON.stringify(data ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
  }

  // ---------- EventSource (live fleet, live transcripts) ----------
  const RealEventSource = window.EventSource
  class LocalEventSource extends EventTarget {
    constructor(url, opts) {
      const u = own(url)
      if (!u && RealEventSource) return new RealEventSource(url, opts)
      super()
      this.url = String(url)
      this.withCredentials = false
      this.readyState = 0
      this.onopen = this.onmessage = this.onerror = null
      setTimeout(() => {
        if (this.readyState === 2) return
        const path = u.pathname.slice(API.length - 1) + u.search
        this.stop = backend.stream(path, (data, event = 'message') => this.fire(event, typeof data === 'string' ? data : JSON.stringify(data)))
        if (!this.stop) { this.readyState = 2; this.fire('error'); return }
        this.readyState = 1
        this.fire('open')
      })
    }

    fire(type, data) {
      if (this.readyState === 2 && type !== 'error') return
      const e = new MessageEvent(type, { data })
      this.dispatchEvent(e)
      if (type === 'open' || type === 'message' || type === 'error') this[`on${type}`]?.(e)
    }

    close() {
      this.readyState = 2
      this.stop?.()
      this.stop = null
    }
  }
  Object.assign(LocalEventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 })
  window.EventSource = LocalEventSource

  // ---------- WebSocket (herdr's live terminal, which needs a computer) ----------
  const RealWebSocket = window.WebSocket
  window.WebSocket = function WebSocket(url, protocols) {
    if (!own(String(url).replace(/^ws/, 'http'))) return new RealWebSocket(url, protocols)
    const ws = Object.assign(new EventTarget(), { url: String(url), readyState: 3, send() {}, close() {} })
    setTimeout(() => { ws.dispatchEvent(new Event('close')); ws.onclose?.(new CloseEvent('close')) })
    return ws
  }
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })

  // ---------- the microphone (voice notes) ----------
  if (backend.microphone) {
    const media = navigator.mediaDevices || {}
    const getUserMedia = async (c) => backend.microphone(c)
    try { media.getUserMedia = getUserMedia } catch { /* read-only */ }
    if (!navigator.mediaDevices || navigator.mediaDevices.getUserMedia !== getUserMedia) {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { ...media, getUserMedia } })
    }
  }
}
