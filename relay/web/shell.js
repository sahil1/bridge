// The page your phone opens on your relay. It pairs with your computer once, then keeps an
// end-to-end encrypted link to it through the relay and shows Bridge AI, from your computer, in a
// frame. The service worker (sw.js) hands every request the app makes to this page, which sends it
// over the link; the app's live terminal uses bridgeRelay.WebSocket below.
//
// In the iPhone app (mobile/ios) there's no service worker: the app serves this page itself and
// hands each request the frame makes to bridgeTunnel() below (window.bridgeNative is the app). The
// Android app (mobile/android) opens the relay page as it is, adding window.bridgeAndroid.
//
// The apps can be paired with several computers, each with its own relay: they keep the list, and
// this page shows it (on the waiting screens, and to Bridge AI's Settings as bridgeRelay.computers).
//
// With your computer offline, it shows Bridge AI from what the phone kept (offline.js) under a
// banner saying so, and messages you send wait for the computer (in the relay, sealed for it).
import { phoneHello, phoneFinish, newKey, splitCode, normCode, formatCode, plainFrame, readPlain, K, pack, unpack, json, text, utf8, CHUNK } from './link.js'
import * as offline from './offline.js'

const $ = (id) => document.getElementById(id)
const show = (id) => { for (const s of ['pair', 'wait', 'home']) $(s).hidden = s !== id; if (id) $('app').hidden = true; if (id) { listOthers(); offerDemo() } }
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
// The iPhone app; the Android app opens this page as it is, and says so in its user agent.
const native = window.bridgeNative || null
const inApp = !!native || /BridgeAIApp\//.test(navigator.userAgent)
const standalone = inApp || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
// The relay: this page's own address, or in the iPhone app the one it was paired through.
let relay = native ? native.relay : location.origin

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

// The pairing. The iPhone app can't keep a key in IndexedDB, so it keeps the pairing in the
// iPhone's Keychain, on this phone only (bridgeNative.pairing at start, { type: 'keep' } to change it).
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }
const pairing = native
  ? {
      get: async () => {
        const p = native.pairing
        if (!p?.device) return null
        const device = { privateKey: await crypto.subtle.importKey('jwk', p.device.priv, ECDH, true, ['deriveBits']), publicKey: await crypto.subtle.importKey('jwk', p.device.pub, ECDH, true, []) }
        return { ...p, device }
      },
      set: async (p) => {
        const device = { priv: await crypto.subtle.exportKey('jwk', p.device.privateKey), pub: await crypto.subtle.exportKey('jwk', p.device.publicKey) }
        native.pairing = { ...p, device }
        native.post({ type: 'keep', pairing: native.pairing })
      },
      del: async () => { native.pairing = null; native.post({ type: 'keep', pairing: null }) },
    }
  : { get: () => store.get('pairing'), set: (p) => store.set('pairing', p), del: () => store.del('pairing') }

function deviceName() {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || isIOS ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device'
  return standalone ? `${os} (app)` : `${os}, browser`
}

// ---------- several computers (the apps) ----------
// Each computer has its own relay and its own pairing. The iPhone app keeps both; on Android each
// relay is its own site with its own pairing, and the app keeps the list.
const android = typeof window.bridgeAndroid?.computers === 'function' ? window.bridgeAndroid : null
const apps = native
  ? {
      list: () => native.computers || [],
      open: (r) => native.post({ type: 'switch', url: r }),
      forget: (r) => native.post({ type: 'forget', url: r }),
      name: (n) => native.post({ type: 'name', name: n }),
      paired: () => {}, // the app saves it with the pairing
      other: () => false, // a link to another relay pairs right here (setRelay)
      activity: (state) => native.post({ type: 'activity', state }),
    }
  : android
    ? {
        list: () => { try { return JSON.parse(android.computers()) } catch { return [] } },
        open: (r) => android.open(r),
        forget: (r) => android.forget(r),
        name: (n) => android.name(n),
        paired: () => android.paired(),
        other: (link) => { if (link.origin === relay) return false; android.pair(link.href); return true }, // another relay is another page
        activity: (state) => android.activity?.(JSON.stringify(state)),
      }
    : null
let adding = false // pairing another computer: the link to this one rests meanwhile
const computerName = (c) => c.name || new URL(c.relay).hostname.split('.')[0]
// With several computers, say which one.
const thisComputer = () => { const list = apps ? apps.list() : []; const c = list.length > 1 && list.find((x) => x.relay === relay); return c ? computerName(c) : 'Your computer' }

function listOthers() {
  for (const box of document.querySelectorAll('.others')) {
    const list = apps ? apps.list().filter((c) => adding || c.relay !== relay) : []
    box.hidden = !list.length
    box.replaceChildren(...(list.length ? [Object.assign(document.createElement('p'), { className: 'small', textContent: adding ? 'Or go back to:' : 'Your other computers:' })] : []), ...list.map((c) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: computerName(c) })
      b.onclick = () => (c.relay === relay ? location.reload() : apps.open(c.relay))
      return b
    }))
  }
}

// The iPhone app's demo, bundled in it: Bridge AI on made-up agents, for before the first pairing.
function offerDemo() {
  $('demo').hidden = !native?.bundled?.includes('demo') || adding || !!apps?.list().length
  offerCloud()
}
$('demo-open').onclick = () => native.post({ type: 'open', name: 'demo' })

// Cloud agents, bundled in the apps: agents in the cloud with keys kept on this phone, paired or
// not, so on the pairing and waiting screens alike (the Android app says what it has).
const bundledUis = native?.bundled || (() => { try { return JSON.parse(window.bridgeAndroid?.bundled?.() || '[]') } catch { return [] } })()
function offerCloud() {
  for (const el of document.querySelectorAll('.cloud-try')) el.hidden = !bundledUis.includes('cloud') || adding
}
for (const b of document.querySelectorAll('.cloud-open')) b.onclick = () => (native ? native.post({ type: 'open', name: 'cloud' }) : window.bridgeAndroid.openBundled('cloud'))

// Pair another computer: the pairing screen, for a link (a code alone doesn't say which relay).
function addComputer() {
  adding = true
  clearTimeout(retryTimer)
  abandon()
  awayBanner(false)
  appShown = false
  $('app').src = 'about:blank'
  linkOnly()
  $('pair').querySelector('h1').textContent = 'Add a computer'
  $('pair-err').hidden = true
  $('code').value = ''
  show('pair')
}
function linkOnly() {
  $('pair-how').textContent = 'Or paste the link from Copy link:'
  $('code').placeholder = 'https://…/#pair=…'
  $('code').style.textTransform = 'none'
}

// ---------- agents at work, on the lock screen (the apps) ----------
// Bridge AI tells this page about its agents (bridgeRelay.activity). While any are working or
// waiting on you, the apps show them on the lock screen: a Live Activity on iPhone, a notification
// on Android. The ones that ran meanwhile stay on it as finished, until all are done.
const lock = { agents: new Map(), sent: '', session: undefined }
function activity(agents, view) {
  if (!apps?.activity || !Array.isArray(agents) || away) return // what it last sent isn't news
  const now = Date.now()
  // Another herdr session in view (view.session): the last one's agents are out of view, not
  // finished. They keep their place on the card as last seen, filed under their session (the same
  // pane ids name other agents now), and pick up again when that session is back in view.
  const session = view?.session ?? null
  if (lock.session !== undefined && session !== lock.session) {
    const next = new Map()
    for (const a of lock.agents.values()) {
      const from = a.away || lock.session
      const bare = a.away ? a.id.slice(a.away.length + 1) : a.id
      if (from === session) next.set(bare, { ...a, id: bare, away: null })
      else next.set(`${from}/${bare}`, { ...a, id: `${from}/${bare}`, away: from })
    }
    lock.agents = next
  }
  lock.session = session
  const busy = (st) => st === 'working' || st === 'blocked'
  for (const a of agents) {
    const was = lock.agents.get(a.id)
    if (busy(a.status)) lock.agents.set(a.id, { id: a.id, name: String(a.name || 'Agent').slice(0, 60), status: a.status, since: was?.status === a.status ? was.since : now })
    else if (was && was.status !== 'done') lock.agents.set(a.id, { ...was, status: 'done', since: now })
  }
  // Closed meanwhile.
  for (const [id, a] of lock.agents) if (!a.away && a.status !== 'done' && !agents.some((x) => x.id === id)) lock.agents.set(id, { ...a, status: 'done', since: now })
  const list = [...lock.agents.values()].map(({ away: _, ...a }) => a)
  if (!list.length) return
  const count = (st) => list.filter((a) => a.status === st).length
  const order = { blocked: 0, working: 1, done: 2 }
  const c = apps.list().find((x) => x.relay === relay)
  const state = {
    computer: c ? computerName(c) : 'Your computer',
    working: count('working'), blocked: count('blocked'), finished: count('done'),
    agents: list.sort((a, b) => order[a.status] - order[b.status] || a.since - b.since).slice(0, 4),
    ended: !count('working') && !count('blocked'),
  }
  const key = JSON.stringify(state)
  if (key !== lock.sent) { lock.sent = key; apps.activity(state) }
  if (state.ended) lock.agents.clear() // the next one starts a new card
}

// The lock screen card was tapped: show that agent.
let openOnLoad = null
window.bridgeOpenAgent = (paneId) => {
  const w = appShown && $('app').contentWindow
  if (w?.document?.readyState === 'complete') w.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } }))
  else openOnLoad = paneId
}

// ---------- the link ----------
let ws = null
let session = null
let paired = null // { device, hostKey, deviceId }
let code = null // a pairing code from the QR code or typed in
let waiting = null // a handshake in progress: { state, pair, resolve }
// After the link drops: again at once, then less and less often (the network coming back, or Bridge
// AI back on the screen, tries again straight away: check() below).
const FIRST_TRY = 250
const LAST_TRY = 10000
let backoff = FIRST_TRY
let retryTimer = null
let started = false // start() has read the pairing
let readyWaiters = []
let appShown = false
let relayKeeps = false // this relay keeps notes for the computer (offline.js)
let away = false // showing what the computer last sent: it's offline, or the relay can't be reached
const streams = new Map() // id -> { onHead, onChunk, onEnd, onError }
let nextId = 1
let inbox = Promise.resolve()

// Wait for the link, unless the relay already said the computer is away (or it can't be reached).
const ready = (ms = away ? 0 : 15000) => (session ? Promise.resolve() : ws?.readyState === 1 && !hostOnline ? Promise.reject(new Error(offlineText())) : new Promise((ok, no) => {
  const w = { ok, no }
  readyWaiters.push(w)
  setTimeout(() => { readyWaiters = readyWaiters.filter((x) => x !== w); no(new Error(offlineText())) }, ms)
}))
let hostSeen = null
let hostOnline = false
const offlineText = () => (hostOnline ? 'Reconnecting to your computer…' : hostSeen ? `Your computer is offline (since ${new Date(hostSeen).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}).` : 'Your computer isn\'t connected to the relay right now.')

// Bridge AI's hosted relay turned this phone away for now: its daily limit for your computer, too
// much at once, or it's switched off. Until then, no trying again.
let limited = { until: 0 }
function onLimit(m) {
  const until = Math.min(Math.max(Number(m.until) || 0, Date.now() + 3000), Date.now() + 26 * 3600000)
  const text = m.why === 'day'
    ? `The hosted relay's daily limit for this computer is used up. It resets at ${when(until)}. For no limits, put the relay on your own Cloudflare account (Settings › Phone & notifications, on the computer).`
    : String(m.text || 'Bridge AI\'s relay can\'t take this right now.').slice(0, 300)
  limited = { why: m.why, text, until }
  if (appShown) bar(text, true)
  else waitScreen(m.why === 'day' ? 'Daily limit reached' : m.why === 'off' ? 'Bridge AI\'s relay is off' : 'One moment…', text, false)
}

function bar(msg, off) {
  clearTimeout(barTimer)
  $('bar').hidden = !msg
  $('bar').classList.toggle('off', !!off)
  $('bar').classList.remove('ok', 'brief')
  $('bar-text').textContent = msg || ''
}
// A moment's news (what became of a message), unless something lasting is showing.
let barTimer = null
function notice(msg, ok) {
  if (!$('bar').hidden && !$('bar').classList.contains('brief')) return
  bar(msg, !ok)
  $('bar').classList.add('brief')
  $('bar').classList.toggle('ok', !!ok)
  barTimer = setTimeout(() => bar(null), ok ? 6000 : 12000)
}

// ---------- while your computer is offline ----------
const when = (t) => new Date(t).toLocaleString([], new Date(t).toDateString() === new Date().toDateString() ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
function awayBanner(on = true) {
  away = on
  document.body.classList.toggle('away', on)
  $('away').hidden = !on
  try { $('app').contentDocument.documentElement.classList.toggle('bridge-saved', on) } catch { /* not loaded */ }
  if (!on) return
  bar(null)
  const relayDown = ws?.readyState !== 1
  $('away-title').textContent = relayDown ? 'Can\'t reach your relay right now.' : `${thisComputer()} is offline${hostSeen ? ` since ${when(hostSeen)}` : ''}.`
  $('away-text').textContent = `Showing what it last sent. Messages you send ${relayKeeps && !relayDown ? 'go out when it\'s back' : 'wait on this phone until it\'s back'}.`
  document.body.style.setProperty('--away', `${$('away').offsetHeight}px`)
}
// Open Bridge AI from what this phone kept, if it kept it.
async function openSaved() {
  if (!paired?.hostKey || adding || !(await offline.hasCopy())) return false
  awayBanner()
  showApp()
  return true
}
// Back: the app asks for everything again (its polls listen for this), and what waited goes out.
function backOnline() {
  if (away) {
    awayBanner(false)
    try { $('app').contentWindow.dispatchEvent(new Event('bridge-settings')) } catch { /* not loaded */ }
  }
  offline.online().catch(() => {})
}
const clip = (s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s)
offline.use({
  relay: () => relay,
  pairing: () => paired,
  send: (obj) => { if (!relayKeeps || ws?.readyState !== 1) return false; ws.send(JSON.stringify(obj)); return true },
  call,
})
offline.subscribe((done) => {
  if (!appShown || !done.length) return
  const failed = done.filter((it) => it.state === 'failed')
  if (failed.length) notice(`"${clip(failed[0].text)}" wasn't delivered: ${failed[0].whyText}.`)
  else notice(done.length === 1 ? 'Your message was delivered.' : `${done.length} messages were delivered.`, true)
})

let heard = 0 // when the connection last brought anything
let since = 0 // when it was opened
let pongs = false // the relay answers a ping (one from before that doesn't can't be checked)
let probe = null // a check of the connection under way
function connect() {
  clearTimeout(retryTimer)
  if (adding) return
  if (ws && ws.readyState <= 1) return
  const sock = new WebSocket(`${relay.replace(/^http/, 'ws')}/_relay/link`)
  ws = sock
  sock.binaryType = 'arraybuffer'
  relayKeeps = false
  heard = since = Date.now()
  sock.onopen = () => { heard = Date.now(); try { sock.send('ping') } catch { /* closing */ } }
  // One message at a time, in order: a response's pieces must reach the app in sequence.
  sock.onmessage = (e) => {
    heard = Date.now()
    if (e.data === 'pong') { pongs = true; return } // the relay's answer to a ping
    inbox = inbox.then(() => (ws !== sock ? null : typeof e.data === 'string' ? onText(JSON.parse(e.data)) : onData(e.data))).catch(fail)
  }
  sock.onclose = (e) => { if (ws === sock) lost(e.code) }
}

function lost(code) {
  // Bridge AI's hosted relay said to wait (a limit, or it's switched off): until then.
  if (limited.until > Date.now()) {
    dropSession(limited.text)
    retryTimer = setTimeout(connect, limited.until - Date.now() + Math.random() * 3000)
    return
  }
  dropSession(offlineText())
  retryTimer = setTimeout(connect, code === 4001 ? 300 : backoff)
  backoff = Math.min(backoff * 2, LAST_TRY)
  // The relay can't be reached (no signal?): what this phone kept, after a few tries.
  if (backoff >= 4000 && code !== 4001) { if (away) awayBanner(); else if (!appShown && paired?.hostKey) openSaved() }
}

// Done with this connection, without waiting to hear that it closed: one that died can take minutes
// to say so.
function abandon(msg) {
  const sock = ws
  ws = null
  clearTimeout(probe)
  probe = null
  if (sock) {
    sock.onopen = sock.onmessage = sock.onclose = null
    try { sock.close() } catch { /* closed */ }
  }
  dropSession(msg)
}
function reconnect() {
  abandon(offlineText())
  backoff = FIRST_TRY
  connect()
}

// Is the link still there? A connection can die without a word (the phone slept, or moved to another
// network) and the browser may take minutes to notice, while every request waits on it. So when
// Bridge AI is back on the screen or the network changes, every so often while it's open, and when an
// answer is slow, this pings the relay, which answers at once. No answer: a new connection, now.
// Back on the screen or on the network (`now`) with no connection: one straight away, not at the next try.
const PROBE_MS = 5000
function check(now) {
  if (!started || adding || !relay || limited.until > Date.now()) return
  if (!ws || ws.readyState >= 2) { if (now === true) { backoff = FIRST_TRY; connect() } return }
  if (ws.readyState === 0) { if (Date.now() - since > PROBE_MS) reconnect(); return }
  if (!pongs || probe) return
  const sock = ws
  const at = Date.now()
  try { sock.send('ping') } catch { reconnect(); return }
  probe = setTimeout(() => { probe = null; if (ws === sock && heard < at) reconnect() }, PROBE_MS)
}
addEventListener('online', () => check(true))
addEventListener('pageshow', (e) => { if (e.persisted) check(true) })
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(true) })
setInterval(() => { if (document.visibilityState === 'visible') check() }, 20000)

// The relay's own messages: whether your computer is there, or about the notes it keeps.
function onText(m) {
  if (m.t === 'limit') return onLimit(m)
  if (m.t) return offline.fromRelay(m)
  if (m.q === 1 && !relayKeeps) { relayKeeps = true; offline.relayReady().catch(() => {}) }
  return onStatus(m)
}

async function onStatus(st) {
  hostOnline = !!st.host
  hostSeen = st.seen || hostSeen
  if (!st.host) {
    dropSession(offlineText()) // with Bridge AI showing, the banner
    if (!appShown && !(await openSaved())) waitScreen(`${thisComputer()} is offline`, `${offlineText()} Bridge AI connects as soon as it's back on and Bridge AI is running.`, true)
    return
  }
  await handshake()
}

async function handshake() {
  if (!paired && !code) return show('pair')
  if (!paired) paired = { device: await newKey(!!native) } // the app has to be able to write it to the Keychain
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
    backoff = FIRST_TRY
    if (!paired.hostKey) {
      paired = { device: paired.device, hostKey: done.hostKey, code, pairedAt: Date.now() }
      await pairing.set(paired)
      code = null
      if (location.hash) history.replaceState(null, '', location.pathname + location.search)
      if (isIOS && !standalone) { show('home'); return }
    }
    apps?.paired()
    for (const w of readyWaiters.splice(0)) w.ok()
    bar(null)
    showApp()
    backOnline()
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
  awayBanner(false)
  bar(null)
  // Removed on the computer: what this phone kept for it goes too.
  if (paired?.hostKey) { await pairing.del(); await offline.clear(); paired = null }
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
  for (const [, s] of [...streams]) {
    if (s.onLost) s.onLost(msg || 'Connection lost')
    else { s.onError?.(msg || 'Connection lost'); s.onClose?.({ c: 1006, r: 'connection lost' }) }
  }
  streams.clear()
  if (msg && appShown) { if (!hostOnline && paired?.hostKey) awayBanner(); else bar(msg, !hostOnline) }
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

// ---------- requests from the service worker (or the iPhone app) ----------
const gzip = typeof DecompressionStream === 'function' // can unpack what comes compressed
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'fetch') tunnel(e.data, e.ports[0]) })
navigator.serviceWorker?.startMessages?.()

// The iPhone app's side: it calls this for each request, and gets the answer back in pieces.
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const cancels = new Map() // the app's request id -> cancel
window.bridgeTunnel = (rid, { m, u, h, body }) => {
  const port = {
    postMessage: (x) => native.post({ type: 'res', id: rid, ...(x.chunk ? { chunk: b64(new Uint8Array(x.chunk)) } : x) }),
    set onmessage(fn) { cancels.set(rid, () => fn({ data: { cancel: true } })) },
  }
  tunnel({ m, u, h, body: body ? unb64(body).buffer : null }, port)
}
window.bridgeCancel = (rid) => { cancels.get(rid)?.(); cancels.delete(rid) }

async function tunnel({ m, u, h, body }, port) {
  let id = 0
  let cancelled = false
  port.onmessage = (x) => { if (x.data?.cancel) { cancelled = true; streams.delete(id); send(K.CANCEL, id).catch(() => {}) } }
  // A read the link dropped before its answer began goes again, once, on the next link: the app
  // waits a moment longer rather than see it fail.
  for (let tries = m === 'GET' ? 2 : 1; tries > 0; tries--) {
    try { await ready() } catch (err) { whileAway({ m, u, body }, port, err.message).catch((e) => port.postMessage({ error: e.message })); return }
    if (cancelled) return
    id = nextId++
    if (!(await relayed(id, { m, u, h, body }, port, tries > 1, () => cancelled))) return
  }
}

// One go at a request over the link. True when the link dropped before any of the answer came and
// `again` says it may go again.
function relayed(id, { m, u, h, body }, port, again, cancelled) {
  return new Promise((resolve) => {
    let keep = null // what this phone keeps of the answer, for when the computer is offline
    let packed = null // the answer comes compressed: unpacked here, as it comes
    let headed = false
    let over = false
    const out = {
      chunk: (c) => { keep?.chunk(c); if (!cancelled()) port.postMessage({ chunk: c.buffer }, [c.buffer]) },
      end: () => { keep?.end(); port.postMessage({ end: true }) },
    }
    const failed = (msg, lost) => {
      if (over) return
      over = true
      clearTimeout(slow)
      streams.delete(id)
      if (lost && again && !headed) return resolve(true)
      packed?.stop()
      port.postMessage({ error: msg })
      resolve(false)
    }
    // No answer yet after a while: make sure the link is still there.
    const slow = setTimeout(() => check(), 5000)
    streams.set(id, {
      onHead: (head) => {
        headed = true
        clearTimeout(slow)
        resolve(false)
        if (m === 'GET') keep = offline.tap(u, head, { assets: !!native })
        port.postMessage({ head: { s: head.s, h: head.h } })
        if (head.z === 'gzip') packed = unzip(out, (msg) => port.postMessage({ error: msg }))
      },
      onChunk: (c) => (packed ? packed.chunk(c) : out.chunk(c)),
      onEnd: () => { over = true; if (packed) packed.end(); else out.end() },
      onError: (msg) => failed(msg),
      onLost: (msg) => failed(msg, true),
    })
    ;(async () => {
      const b = body ? new Uint8Array(body) : null
      // The app's own files (the same for everyone who has this version, nothing of yours) come
      // compressed, if this browser can unpack them: a third of the size. Nothing else is.
      const z = gzip && m === 'GET' && u.startsWith('/assets/') ? { z: 'gzip' } : {}
      await send(K.REQ, id, { m, u, h, body: !!b, ...z })
      if (b) {
        for (let o = 0; o < b.byteLength; o += CHUNK) await send(K.BODY, id, b.subarray(o, o + CHUNK))
        await send(K.END, id)
      }
    })().catch((err) => failed(err.message, !session))
  })
}

// An answer that comes compressed (gzip), passed on unpacked and in order.
function unzip(to, onError) {
  const ds = new DecompressionStream('gzip')
  const w = ds.writable.getWriter()
  const r = ds.readable.getReader()
  const whole = (c) => (c.byteOffset === 0 && c.byteLength === c.buffer.byteLength ? c : c.slice())
  const read = (async () => { for (let x = await r.read(); !x.done; x = await r.read()) to.chunk(whole(x.value)) })()
  read.catch(() => {})
  return {
    chunk: (c) => { w.write(c).catch(() => {}) },
    end: () => { w.close().catch(() => {}); read.then(() => to.end(), () => onError('The answer couldn\'t be unpacked')) },
    stop: () => { w.abort().catch(() => {}) },
  }
}

// Your computer is offline: answer from what this phone kept, leave a message for the computer,
// or say it needs the computer. Nothing kept answers calmly, and the app shows it as empty.
async function whileAway({ m, u, body }, port, why) {
  const answer = (s, obj) => {
    const b = utf8(JSON.stringify(obj))
    port.postMessage({ head: { s, h: [['content-type', 'application/json'], ['cache-control', 'no-store']] } })
    port.postMessage({ chunk: b.buffer }, [b.buffer])
    port.postMessage({ end: true })
  }
  if (!paired?.hostKey) return port.postMessage({ error: why })
  if (m === 'GET' || m === 'HEAD') {
    const hit = await offline.saved(u)
    if (hit) {
      port.postMessage({ head: { s: hit.s, h: [...hit.h, ['x-bridge-saved', String(hit.at)]] } })
      if (m === 'GET') port.postMessage({ chunk: hit.body.buffer }, [hit.body.buffer])
      return port.postMessage({ end: true })
    }
    if (!u.startsWith('/api/')) return port.postMessage({ error: why }) // a page or a file
    return answer(503, { error: 'Not saved on this phone. It shows when your computer is back.', offline: true })
  }
  const q = offline.queueable(m, u, body)
  if (q?.error) return answer(503, { error: q.error, offline: true })
  if (q) return answer(202, { ok: true, offline: true, id: (await offline.add(q)).id })
  answer(503, { error: 'That needs your computer, and it\'s offline right now.', offline: true })
}

// A request of this page's own over the link (the outbox's): { status, json }.
function call(m, u, body) {
  return new Promise((resolve, reject) => {
    if (!session) return reject(new Error(offlineText()))
    const id = nextId++
    let head = null
    const parts = []
    streams.set(id, {
      onHead: (x) => { head = x },
      onChunk: (c) => parts.push(c),
      onEnd: () => {
        let j = null
        try { j = JSON.parse(parts.map((c) => text(c)).join('')) } catch { /* not JSON */ }
        resolve({ status: head?.s || 0, json: j })
      },
      onError: (msg) => reject(new Error(msg)),
    })
    const b = body ? utf8(JSON.stringify(body)) : null
    ;(async () => {
      await send(K.REQ, id, { m, u, h: [['content-type', 'application/json']], body: !!b })
      if (!b) return
      for (let o = 0; o < b.byteLength; o += CHUNK) await send(K.BODY, id, b.subarray(o, o + CHUNK))
      await send(K.END, id)
    })().catch((e) => { streams.delete(id); reject(e) })
  })
}

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
window.bridgeRelay = {
  WebSocket: RelaySocket,
  activity,
  unpair: async () => { await pairing.del(); await offline.clear(); location.reload() },
  // What this phone sent while the computer was offline, and how each is doing (offline.js).
  outbox: { list: offline.list, subscribe: offline.subscribe, dismiss: offline.dismiss },
  // The computers this app is paired with ({ relay, name, current }), for Bridge AI's Settings.
  computers: apps && {
    list: () => apps.list().map((c) => ({ ...c, name: computerName(c), current: c.relay === relay })),
    open: (r) => apps.open(r),
    add: () => addComputer(),
    // Forget a computer on this phone. This one is told too, so it stops listing this phone.
    forget: async (r) => {
      if (r === relay && session) {
        const w = $('app').contentWindow
        await w.fetch('/api/relay').then((x) => x.json()).then((j) => j.here && w.fetch('/api/relay/devices/' + encodeURIComponent(j.here), { method: 'DELETE' })).catch(() => {})
      }
      if (r === relay) { await pairing.del(); await offline.clear() }
      apps.forget(r)
    },
  },
}

// ---------- the app ----------
function showApp() {
  show(null)
  const f = $('app')
  f.hidden = false
  if (appShown) return
  appShown = true
  f.src = openOnLoad ? `/?agent=${encodeURIComponent(openOnLoad)}` : `/${location.search}`
  openOnLoad = null
  // Match the app's background and bar colour around it (the notch and the Home indicator area).
  f.onload = () => {
    try {
      const d = f.contentDocument
      d.documentElement.classList.toggle('bridge-saved', away)
      const bg = getComputedStyle(d.body).backgroundColor
      if (bg) document.body.style.background = bg
      const tc = [...d.querySelectorAll('meta[name="theme-color"]')].find((m) => !m.media || matchMedia(m.media).matches)?.content
      if (tc) document.querySelector('meta[name="theme-color"]').content = tc
      document.title = d.title || 'Bridge AI'
      // The apps list this computer by the name it goes by.
      if (apps) f.contentWindow.fetch('/api/relay').then((r) => r.json()).then((j) => j.computer && apps.name(j.computer)).catch(() => {})
      // Some browsers (Safari, the iPhone app) give the page inside the notch's space too, and it
      // keeps clear of the notch itself; then the frame fills the screen instead of doubling the gap.
      const t = d.createElement('div')
      t.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top)'
      d.body.appendChild(t)
      document.body.classList.toggle('insets-inside', parseFloat(getComputedStyle(t).paddingTop) > 0)
      t.remove()
    } catch { /* not loaded */ }
  }
}

function waitScreen(title, msg, retry) {
  show('wait')
  $('wait-title').textContent = title
  $('wait-text').textContent = msg || ''
  $('retry').hidden = !retry
}

$('retry').onclick = () => reconnect()
$('skip').onclick = () => { for (const w of readyWaiters.splice(0)) w.ok(); showApp() }
$('pair-form').onsubmit = async (e) => {
  e.preventDefault()
  // A whole pairing link (from Copy link on the computer) also says which relay to use.
  const typed = $('code').value.trim()
  let link = null
  try { link = /^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/i.test(typed) ? new URL(typed) : null } catch { /* a code */ } // (or a test relay on this computer)
  if (adding && !link) { $('pair-err').hidden = false; $('pair-err').textContent = 'Scan the QR code, or paste the link from Copy link on the other computer.'; return }
  if (link && apps?.other(link)) return
  if (link && native) setRelay(link.origin)
  adding = false
  const c = normCode(link ? new URLSearchParams(link.hash.slice(1)).get('pair') : typed)
  if (!relay) { $('pair-err').hidden = false; $('pair-err').textContent = 'Scan the QR code, or paste the link from Copy link on the computer.'; return }
  if (c.length < 20) { $('pair-err').hidden = false; $('pair-err').textContent = 'The code has 20 letters and digits.'; return }
  $('pair-err').hidden = true
  code = c
  paired = null
  started = true
  waitScreen('Pairing…', '')
  if (ws?.readyState === 1 && hostOnline) handshake().catch(fail)
  else if (ws?.readyState === 1) waitScreen('Your computer is offline', `${offlineText()} Pairing finishes as soon as it's back.`, true)
  else connect()
}
$('code').oninput = (e) => { if (/[:/.]/.test(e.target.value)) return; const v = normCode(e.target.value).slice(0, 20); e.target.value = formatCode(v) }
$('scan').onclick = () => (native ? native.post({ type: 'scan' }) : window.bridgeAndroid.scan())

// The iPhone app: a relay from a pairing link. A different relay is a different computer.
function setRelay(origin) {
  if (origin === relay) return
  relay = origin
  hostOnline = false
  pongs = false
  native.post({ type: 'relay', url: origin })
  abandon()
}

async function start() {
  if (native || window.bridgeAndroid) $('scan').hidden = false // the apps scan the QR code themselves
  if (!native) {
    if (!('serviceWorker' in navigator)) { waitScreen('This browser can\'t run Bridge AI', 'Use Safari on iPhone or Chrome on Android.'); return }
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
  }
  paired = (await pairing.get()) || null
  offline.tidy().catch(() => {})
  // A code you just scanned pairs this phone afresh, even if it was paired before (a new
  // computer, or after it was removed).
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('pair')
  if (fromLink && normCode(fromLink) !== paired?.code) { code = normCode(fromLink); paired = null }
  if (!relay) { // the iPhone app before its first pairing: the link says which relay, a code alone doesn't
    linkOnly()
    show('pair')
    return
  }
  started = true
  if (!paired && !code) { show('pair'); connect(); return }
  waitScreen(paired ? 'Connecting to your computer…' : 'Pairing…', '')
  connect()
}
start().catch((e) => waitScreen('Something went wrong', e.message, true))
// A pairing link opened while this page is already open: start over with its code.
addEventListener('hashchange', () => { if (/[#&]pair=/.test(location.hash)) location.reload() })
