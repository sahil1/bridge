// The page your phone opens on your relay. It pairs with your computer once, then keeps an
// end-to-end encrypted link to it through the relay and shows Bridge AI, from your computer, in a
// frame. The service worker (sw.js) hands every request the app makes to this page, which sends it
// over the link; the app's live terminal uses bridgeRelay.WebSocket below.
import { phoneHello, phoneFinish, newKey, splitCode, normCode, formatCode, plainFrame, readPlain, K, pack, unpack, json, text, utf8, CHUNK } from './link.js'

const $ = (id) => document.getElementById(id)
const show = (id) => { for (const s of ['pair', 'wait', 'home']) $(s).hidden = s !== id; if (id) $('app').hidden = true }
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

// ---------- what this phone keeps (IndexedDB: its key can be stored without being readable) ----------
const store = (() => {
  let dbp
  const db = () => (dbp ||= new Promise((ok, no) => {
    const r = indexedDB.open('bridge-relay', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error)
  }))
  const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction('kv', mode); const r = fn(t.objectStore('kv')); t.oncomplete = () => ok(r?.result); t.onerror = () => no(t.error) }) }
  return { get: (k) => tx('readonly', (s) => s.get(k)), set: (k, v) => tx('readwrite', (s) => s.put(v, k)), del: (k) => tx('readwrite', (s) => s.delete(k)) }
})()

function deviceName() {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || isIOS ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device'
  return standalone ? `${os} (app)` : `${os}, browser`
}

// ---------- the link ----------
let ws = null
let session = null
let paired = null // { device, hostKey, deviceId }
let code = null // a pairing code from the QR code or typed in
let waiting = null // a handshake in progress: { state, pair, resolve }
let backoff = 1000
let retryTimer = null
let readyWaiters = []
let appShown = false
const streams = new Map() // id -> { onHead, onChunk, onEnd, onError }
let nextId = 1
let inbox = Promise.resolve()

// Wait for the link, unless the relay already said the computer is away.
const ready = (ms = 15000) => (session ? Promise.resolve() : ws?.readyState === 1 && !hostOnline ? Promise.reject(new Error(offlineText())) : new Promise((ok, no) => {
  const w = { ok, no }
  readyWaiters.push(w)
  setTimeout(() => { readyWaiters = readyWaiters.filter((x) => x !== w); no(new Error(offlineText())) }, ms)
}))
let hostSeen = null
let hostOnline = false
const offlineText = () => (hostOnline ? 'Reconnecting to your computer…' : hostSeen ? `Your computer is offline (since ${new Date(hostSeen).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}).` : 'Your computer isn\'t connected to the relay right now.')

function bar(msg, off) {
  $('bar').hidden = !msg
  $('bar').classList.toggle('off', !!off)
  $('bar-text').textContent = msg || ''
}

function connect() {
  clearTimeout(retryTimer)
  if (ws && ws.readyState <= 1) return
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/_relay/link`)
  ws.binaryType = 'arraybuffer'
  // One message at a time, in order: a response's pieces must reach the app in sequence.
  ws.onmessage = (e) => { inbox = inbox.then(() => (typeof e.data === 'string' ? onStatus(JSON.parse(e.data)) : onData(e.data))).catch(fail) }
  ws.onclose = (e) => {
    dropSession(offlineText())
    retryTimer = setTimeout(connect, e.code === 4001 ? 300 : backoff)
    backoff = Math.min(backoff * 2, 30000)
  }
}

async function onStatus(st) {
  hostOnline = !!st.host
  hostSeen = st.seen || hostSeen
  if (!st.host) {
    dropSession(offlineText())
    if (!appShown) waitScreen('Your computer is offline', `${offlineText()} Bridge AI connects as soon as it's back on and Bridge AI is running.`, true)
    else bar(offlineText(), true)
    return
  }
  await handshake()
}

async function handshake() {
  if (!paired && !code) return show('pair')
  if (!paired) paired = { device: await newKey(false) }
  const pair = paired.hostKey ? null : splitCode(code)
  const state = await phoneHello(paired.device, pair, deviceName())
  waiting = { state, pair }
  ws.send(plainFrame(state.hello))
}

async function onData(buf) {
  if (waiting) {
    const msg = readPlain(buf)
    const { state, pair } = waiting
    waiting = null
    if (msg?.t === 'refuse') return refused(msg.why)
    let done
    try { done = await phoneFinish(state, paired.device, msg, { hostKey: paired.hostKey, pair }) } catch (e) { return refused(e.message) }
    session = done.session
    backoff = 1000
    if (!paired.hostKey) {
      paired = { device: paired.device, hostKey: done.hostKey, code, pairedAt: Date.now() }
      await store.set('pairing', paired)
      code = null
      if (location.hash) history.replaceState(null, '', location.pathname + location.search)
      if (isIOS && !standalone) { show('home'); return }
    }
    for (const w of readyWaiters.splice(0)) w.ok()
    bar(null)
    showApp()
    return
  }
  if (!session) return
  let plain
  try { plain = await session.open(buf) } catch { ws.close(4002, 'bad record'); return }
  const { kind, id, body } = unpack(plain)
  if (kind === K.PING) return send(K.PONG, 0)
  const s = streams.get(id)
  if (!s) return
  if (kind === K.HEAD) s.onHead?.(json(body))
  else if (kind === K.BODY) s.onChunk?.(body.slice())
  else if (kind === K.END) { streams.delete(id); s.onEnd?.() }
  else if (kind === K.ERR) { streams.delete(id); s.onError?.(text(body)) }
  else if (kind === K.WS_OPENED) s.onOpen?.()
  else if (kind === K.WS_MSG) s.onMessage?.(body[0] === 1 ? text(body.subarray(1)) : body.slice(1).buffer)
  else if (kind === K.WS_CLOSE) { streams.delete(id); s.onClose?.(json(body)) }
}

const WHY = {
  'not-paired': 'This phone isn\'t paired with the computer (or was removed). Pair it again.',
  'code-expired': 'That code has expired or was used up. Make a new one on the computer.',
  'wrong-code': 'That code isn\'t right. Check it and try again.',
  unsupported: 'Update Bridge AI on your computer, then try again.',
}
async function refused(why) {
  dropSession()
  if (paired?.hostKey) { await store.del('pairing'); paired = null }
  else paired = null
  code = null
  appShown = false
  $('app').src = 'about:blank' // stop the app asking for things it can no longer get
  show('pair')
  $('pair-err').hidden = false
  $('pair-err').textContent = WHY[why] || why
}

function dropSession(msg) {
  session = null
  waiting = null
  for (const [, s] of streams) { s.onError?.(msg || 'Connection lost'); s.onClose?.({ c: 1006, r: 'connection lost' }) }
  streams.clear()
  if (msg && appShown) bar(msg, !hostOnline)
}

function fail(e) { console.error(e); try { ws?.close(4002, 'error') } catch { /* closed */ } }

// Sealed records go out in the order they were sealed.
let outbox = Promise.resolve()
function send(kind, id, body) {
  const s = session
  if (!s) return Promise.reject(new Error(offlineText()))
  const p = outbox.then(async () => { const rec = await s.seal(pack(kind, id, body)); if (session === s) ws.send(rec) })
  outbox = p.catch(() => {})
  return p
}

// ---------- requests from the service worker ----------
navigator.serviceWorker?.addEventListener('message', async (e) => {
  if (e.data?.type !== 'fetch') return
  const port = e.ports[0]
  const { m, u, h, body } = e.data
  const id = nextId++
  let cancelled = false
  port.onmessage = (x) => { if (x.data?.cancel) { cancelled = true; streams.delete(id); send(K.CANCEL, id).catch(() => {}) } }
  try { await ready() } catch (err) { port.postMessage({ error: err.message }); return }
  streams.set(id, {
    onHead: (head) => port.postMessage({ head }),
    onChunk: (c) => { if (!cancelled) port.postMessage({ chunk: c.buffer }, [c.buffer]) },
    onEnd: () => port.postMessage({ end: true }),
    onError: (msg) => port.postMessage({ error: msg }),
  })
  try {
    const b = body ? new Uint8Array(body) : null
    await send(K.REQ, id, { m, u, h, body: !!b })
    if (b) {
      for (let o = 0; o < b.byteLength; o += CHUNK) await send(K.BODY, id, b.subarray(o, o + CHUNK))
      await send(K.END, id)
    }
  } catch (err) {
    streams.delete(id)
    port.postMessage({ error: err.message })
  }
})
navigator.serviceWorker?.startMessages?.()

// ---------- WebSockets for the app (the live terminal), through the link ----------
class RelaySocket extends EventTarget {
  constructor(url) {
    super()
    const u = new URL(url, location.href)
    this.url = u.href
    this.readyState = 0
    this.binaryType = 'blob'
    this.id = nextId++
    streams.set(this.id, {
      onOpen: () => { this.readyState = 1; this.emit('open', new Event('open')) },
      onMessage: (data) => this.emit('message', new MessageEvent('message', { data: typeof data === 'string' || this.binaryType === 'arraybuffer' ? data : new Blob([data]) })),
      onClose: (c) => this.closed(c?.c || 1006, c?.r || ''),
    })
    ready().then(() => send(K.WS_OPEN, this.id, { u: u.pathname + u.search })).catch(() => this.closed(1006, 'offline'))
  }
  emit(type, ev) { this[`on${type}`]?.(ev); this.dispatchEvent(ev) }
  send(data) {
    if (this.readyState !== 1) return
    const body = typeof data === 'string' ? new Uint8Array([1, ...utf8(data)]) : new Uint8Array([0, ...new Uint8Array(data.buffer || data)])
    send(K.WS_MSG, this.id, body).catch(() => {})
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return
    this.readyState = 2
    send(K.WS_CLOSE, this.id, { c: code, r: reason }).catch(() => {})
    this.closed(code, reason)
  }
  closed(code, reason) {
    if (this.readyState === 3) return
    this.readyState = 3
    streams.delete(this.id)
    this.emit('close', new CloseEvent('close', { code, reason, wasClean: code === 1000 }))
  }
}
RelaySocket.CONNECTING = 0; RelaySocket.OPEN = 1; RelaySocket.CLOSING = 2; RelaySocket.CLOSED = 3
window.bridgeRelay = { WebSocket: RelaySocket, unpair: async () => { await store.del('pairing'); location.reload() } }

// ---------- the app ----------
function showApp() {
  show(null)
  const f = $('app')
  f.hidden = false
  if (appShown) return
  appShown = true
  f.src = `/${location.search}`
  // Match the app's background and bar colour around it (the notch and the Home indicator area).
  f.onload = () => {
    try {
      const d = f.contentDocument
      const bg = getComputedStyle(d.body).backgroundColor
      if (bg) document.body.style.background = bg
      const tc = [...d.querySelectorAll('meta[name="theme-color"]')].find((m) => !m.media || matchMedia(m.media).matches)?.content
      if (tc) document.querySelector('meta[name="theme-color"]').content = tc
      document.title = d.title || 'Bridge AI'
    } catch { /* not loaded */ }
  }
}

function waitScreen(title, msg, retry) {
  show('wait')
  $('wait-title').textContent = title
  $('wait-text').textContent = msg || ''
  $('retry').hidden = !retry
}

$('retry').onclick = () => { backoff = 1000; try { ws?.close() } catch { /* closed */ } connect() }
$('skip').onclick = () => { for (const w of readyWaiters.splice(0)) w.ok(); showApp() }
$('pair-form').onsubmit = async (e) => {
  e.preventDefault()
  const c = normCode($('code').value)
  if (c.length < 20) { $('pair-err').hidden = false; $('pair-err').textContent = 'The code has 20 letters and digits.'; return }
  $('pair-err').hidden = true
  code = c
  paired = null
  waitScreen('Pairing…', '')
  if (ws?.readyState === 1 && hostOnline) handshake().catch(fail)
  else if (ws?.readyState === 1) waitScreen('Your computer is offline', `${offlineText()} Pairing finishes as soon as it's back.`, true)
  else connect()
}
$('code').oninput = (e) => { const v = normCode(e.target.value).slice(0, 20); e.target.value = formatCode(v) }

async function start() {
  if (!('serviceWorker' in navigator)) { waitScreen('This browser can\'t run Bridge AI', 'Use Safari on iPhone or Chrome on Android.'); return }
  await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  paired = (await store.get('pairing')) || null
  // A code you just scanned pairs this phone afresh, even if it was paired before (a new
  // computer, or after it was removed).
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('pair')
  if (fromLink && normCode(fromLink) !== paired?.code) { code = normCode(fromLink); paired = null }
  if (!paired && !code) { show('pair'); connect(); return }
  waitScreen(paired ? 'Connecting to your computer…' : 'Pairing…', '')
  connect()
}
start().catch((e) => waitScreen('Something went wrong', e.message, true))
// A pairing link opened while this page is already open: start over with its code.
addEventListener('hashchange', () => { if (/[#&]pair=/.test(location.hash)) location.reload() })
