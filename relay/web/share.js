// The page someone opens from a Share Link (server/shares.js): a file, a folder (a site), a Studio
// document or an agent's app, shared by the owner of a computer running Bridge AI. It's served by
// the owner's relay at an address of its own, never the phone page's (relay/worker.js), so what's
// shown can't reach anything a paired phone keeps there.
//
// The link's secret is in its fragment (#s=…), which the browser never sends anywhere. This page
// reads it, takes it out of the address at once, and keeps it only in memory; nothing it keeps is
// stored (a reload asks for the link again). It opens an end-to-end encrypted link to the computer
// through the relay with it (link.js, share links), so the relay passes on bytes it can't read. Then
// the computer asks for the share's password, or for a code sent to the viewer's email, if it has
// one, inside that link, and shows what's shared in a frame. Everything the frame asks for (a site's
// pictures and scripts, an app's requests) goes to a service worker (share-sw.js), then to this page,
// which sends it over the link. What's shared never runs where this page does: either at an address
// of its own (Bridge AI's relay, with its share domain: share-frame.js, which this page gives only a
// port for those requests), or here with its scripts turned off (script-src 'none').
//
// The computer says what's what: what's shared, who shares it, until when, and whether it ended;
// what this page says before it has heard (a name from the link) is only shown, never believed.
import { viewerHello, viewerFinish, shareId, plainFrame, readPlain, K, pack, unpack, json, text, utf8, CHUNK, WINDOW, more, granter } from './link.js'

const $ = (id) => document.getElementById(id)
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g
const plain = (s, n = 60) => String(s || '').replace(HIDDEN, '').replace(/\s+/g, ' ').trim().slice(0, n)
const params = new URLSearchParams(location.hash.slice(1))
const secret = params.get('s') || ''
let owner = plain(params.get('n'), 40) // the name the link gives, until the computer says its own
let sid = null
let about = null // what the computer said it shares: { title, kind, name, needs, ends, entry, pdf, live }
let ws = null
let session = null
let waiting = null // a hello sent, its welcome not here yet
let ended = null // the computer said this share ended (sealed): nothing more is tried
let hold = false // turned away in the clear: tried again only with Try again (or, when busy, in a while)
let backoff = 1000
let retryTimer = null
let pinger = null
let nextId = 1
const streams = new Map()
let passed = false // let in: the password or the code, or none needed
let opened = false // the frame shows what's shared
let pass = null // the computer's pass for this page, after a password or a code (memory only)
// This page's key for its frame's requests, new each time it opens: only those under /_c/<k>/ are sent.
const k = [...crypto.getRandomValues(new Uint8Array(18))].map((x) => 'abcdefghijklmnopqrstuvwxyz234567'[x & 31]).join('')
let framePort = null // the content address's page (share-frame.js), when what's shared shows there

// ---------- screens ----------
const show = (id) => { for (const s of ['wait', 'password', 'email', 'code']) $(s).hidden = s !== id; $('view').hidden = id !== null; $('top').hidden = !about?.title }
const theirs = () => (owner ? `${owner}'s computer` : 'The computer sharing this')
function waitScreen(title, body = '', { spin = false, retry = false } = {}) {
  if (opened && !ended) return state(title)
  show('wait')
  $('wait-title').textContent = title
  $('wait-text').textContent = body
  $('wait-spin').hidden = !spin
  $('retry').hidden = !retry
}
// A word in the bar over what's shared, while it shows (the computer went offline, say).
const state = (s) => { $('top-state').textContent = s || '' }
$('retry').onclick = () => { hold = false; backoff = 1000; connect() }

function top() {
  if (!about?.title) return
  $('top-title').textContent = about.title
  $('top-who').textContent = about.name ? `· shared by ${about.name}` : ''
  document.title = about.title
  $('top').hidden = false
}

// ---------- the link to the computer ----------
async function start() {
  if (!secret && /^\/v\//.test(location.pathname)) return waitScreen('Open the link again', 'This page doesn\'t keep the link once it has opened it, so a reload needs the link again.')
  if (!/^[\w-]{43}$/.test(secret)) return waitScreen('This link isn\'t complete', 'Part of it is missing. Ask whoever sent it to send it again, and open all of it.')
  try { sid = await shareId(secret) } catch { return waitScreen('This link isn\'t complete', 'Part of it is missing. Ask whoever sent it to send it again, and open all of it.') }
  // The secret leaves the address at once. What stays names the share and this page's key, so the
  // service worker knows which page a frame's requests are for.
  history.replaceState(null, '', `/v/${sid}?k=${k}`)
  waitScreen('Opening…', `Connecting to ${theirs().replace(/^The/, 'the')}.`, { spin: true })
  connect()
}

function connect() {
  clearTimeout(retryTimer)
  if (ended) return
  if (ws && ws.readyState <= 1) return
  const sock = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/_relay/view`)
  sock.binaryType = 'arraybuffer'
  ws = sock
  let inbox = Promise.resolve()
  sock.onopen = () => {
    clearInterval(pinger)
    // Kept open through whatever is in between: the relay answers this itself.
    pinger = setInterval(() => { try { sock.send('ping') } catch { /* closing */ } }, 25000)
  }
  sock.onmessage = (e) => {
    if (e.data === 'pong') return
    inbox = inbox.then(() => (ws !== sock ? null : typeof e.data === 'string' ? onText(e.data) : onData(e.data))).catch((err) => { console.error(err); try { sock.close(4002, 'error') } catch { /* closed */ } })
  }
  sock.onclose = (e) => { if (ws === sock) lost(e.code) }
}

function lost(code) {
  clearInterval(pinger)
  dropSession()
  ws = null
  if (ended || hold) return
  // Bridge AI's relay said to wait (its limits for links): until then.
  if (limited?.until > Date.now()) { retryTimer = setTimeout(connect, Math.min(limited.until - Date.now(), 30 * 60000) + 1000); return }
  // The computer connected again (the relay starts its links over): at once. Otherwise less and
  // less often, and said.
  retryTimer = setTimeout(connect, code === 4001 ? 300 : backoff)
  backoff = Math.min(backoff * 2, 30000)
  if (code !== 4001 && backoff > 2000 && !limited) waitScreen(`Can't reach ${theirs().replace(/^The/, 'the')}`, 'Its relay doesn\'t answer. Check this device\'s connection; this page keeps trying.', { spin: true, retry: true })
}

function dropSession() {
  session = null
  waiting = null
  passed = false
  for (const s of streams.values()) s.onLost?.('The connection to the computer dropped')
  streams.clear()
}

let limited = null
async function onText(s) {
  let m = null
  try { m = JSON.parse(s) } catch { return }
  // Bridge AI's relay at a limit: its own words (the account's allowance, the relay's day).
  if (m?.t === 'limit') {
    limited = m
    waitScreen('Not now', String(m.text || 'The relay isn\'t carrying this just now.').slice(0, 400), { retry: true })
    return
  }
  if (!('host' in (m || {}))) return
  limited = null
  if (!m.host) {
    dropSession()
    const since = Number(m.seen) > 0 ? ` (since ${new Date(m.seen).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })})` : ''
    if (opened) state(`${theirs()} is offline`)
    else waitScreen(`${theirs()} is offline`, `The link works when it's back${since}. This page keeps trying.`, { spin: true })
    return
  }
  if (!session && !waiting) hello()
}

async function hello() {
  const st = await viewerHello(secret)
  waiting = st
  ws.send(plainFrame(st.hello))
}

const REFUSED = {
  'no-share': ['This link doesn\'t open any more', 'It ended, or it was stopped. Ask whoever sent it for a new one.'],
  busy: ['Too many at once', 'More people are opening links from this computer than it takes at once. This page tries again in a moment.'],
  unsupported: ['This link needs a newer Bridge AI', 'The computer sharing it needs Bridge AI updated to open it.'],
}
async function onData(buf) {
  if (waiting) {
    const st = waiting
    waiting = null
    const msg = readPlain(buf)
    if (msg?.t === 'refuse') {
      // Said in the clear, so only shown: the relay could have said it. A share that ended is said
      // sealed by the computer itself (GONE), and that's what stops this page trying.
      const [title, body] = REFUSED[msg.why] || ['This link doesn\'t open', 'The computer sharing it turned it away.']
      hold = true
      // No such link any more: what showed goes too (stopped while this page was away).
      if (msg.why === 'no-share' && opened) { opened = false; $('view').src = 'about:blank' }
      waitScreen(title, body, { retry: true })
      if (msg.why === 'busy') retryTimer = setTimeout(() => { hold = false; connect() }, 15000)
      try { ws.close(1000) } catch { /* closed */ }
      return
    }
    try { session = await viewerFinish(st, secret, msg) } catch {
      hold = true
      waitScreen('This link doesn\'t open', 'The answer that came back couldn\'t be checked, so nothing was shown. Try again; if it keeps happening, ask whoever sent the link.', { retry: true })
      try { ws.close(4002, 'unchecked') } catch { /* closed */ }
      return
    }
    backoff = 1000
    state('')
    // (Not waited for here: its answers come in after this, in the same order.)
    begin().catch((e) => waitScreen('This link doesn\'t open', e.message, { retry: true }))
    return
  }
  if (!session) return
  let rec
  try { rec = await session.open(buf) } catch { ws.close(4002, 'bad record'); return }
  const { kind, id, body } = unpack(rec)
  if (kind === K.GONE) { let m = {}; try { m = json(body) } catch { /* nothing said */ } return end(m) }
  if (kind === K.PING) return send(K.PONG, 0)
  if (kind === K.PONG) return
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

// The computer said, sealed, that this share ended: stopped by its owner, or its time ran out.
function end(m) {
  ended = m || {}
  clearTimeout(retryTimer)
  clearInterval(pinger)
  pass = null
  opened = false
  framePort = null
  $('view').src = 'about:blank'
  waitScreen(String(m?.title || 'This link has ended').slice(0, 120), String(m?.text || 'Whoever shared it stopped sharing it, or its time ran out.').slice(0, 400))
  try { ws?.close(1000) } catch { /* closed */ }
}

let outbox = Promise.resolve()
function send(kind, id, body) {
  const s = session
  if (!s) return Promise.reject(new Error('Not connected'))
  const p = outbox.then(async () => { const rec = await s.seal(pack(kind, id, body)); if (session === s) ws.send(rec) })
  outbox = p.catch(() => {})
  return p
}

// One request of this page's own (what's shared, the password, the code): its JSON answer.
function call(m, u, body) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    let head = null
    let out = ''
    streams.set(id, {
      onHead: (h) => { head = h },
      onChunk: (c) => { out += text(c) },
      onEnd: () => { let j = {}; try { j = JSON.parse(out) } catch { /* not JSON */ } resolve({ status: head?.s || 0, json: j }) },
      onError: (e) => reject(new Error(e)),
      onLost: (e) => reject(new Error(e)),
    })
    ;(async () => {
      const b = body ? utf8(JSON.stringify(body)) : null
      await send(K.REQ, id, { m, u, h: [['content-type', 'application/json']], body: !!b })
      if (b) { await send(K.BODY, id, b); await send(K.END, id) }
    })().catch(reject)
  })
}

// ---------- in: what's shared, and the password or the code ----------
async function begin() {
  const r = await call('GET', '/.share/about').catch(() => null)
  if (!session) return
  if (!r || r.status !== 200) return waitScreen('This link doesn\'t open', r?.json?.error || 'The computer sharing it didn\'t say what it shares. Try again.', { retry: true })
  about = r.json
  owner = plain(about.name, 40) || owner
  if (!about.needs) return letIn()
  // Let in earlier on this page (the link dropped, the computer came back): its pass, kept in memory.
  if (pass) {
    const p = await call('POST', '/.share/pass', { pass }).catch(() => null)
    if (p?.status === 200) return letIn(true)
    pass = null
  }
  if (opened) { opened = false; framePort = null; $('view').src = 'about:blank' }
  // Waiting for a code already: still that.
  if (about.needs === 'email' && emailAsked && !$('code').hidden) return
  if (about.needs === 'password') {
    show('password')
    $('password-text').textContent = `${about.name || 'Whoever shared it'} set a password for what they shared.`
    $('password-input').focus()
  } else if (about.needs === 'email') {
    show('email')
    $('email-input').focus()
  }
}

const keepPass = (p) => { if (typeof p === 'string') pass = p }
const busy = (form, on) => { for (const el of $(form).querySelectorAll('button, input')) el.disabled = on }
const sayErr = (id, msg) => { $(id).hidden = !msg; $(id).textContent = msg || '' }

$('password-form').onsubmit = async (e) => {
  e.preventDefault()
  sayErr('password-err', null)
  busy('password-form', true)
  const r = await call('POST', '/.share/password', { password: $('password-input').value }).catch((x) => ({ status: 0, json: { error: x.message } }))
  busy('password-form', false)
  if (r.status === 200) { $('password-input').value = ''; keepPass(r.json.pass); return letIn(true) }
  sayErr('password-err', r.json?.error || 'That didn\'t work. Try again.')
  $('password-input').select()
}

let emailAsked = ''
$('email-form').onsubmit = async (e) => {
  e.preventDefault()
  sayErr('email-err', null)
  const email = $('email-input').value.trim()
  busy('email-form', true)
  const r = await call('POST', '/.share/email', { email }).catch((x) => ({ status: 0, json: { error: x.message } }))
  busy('email-form', false)
  if (r.status !== 200) return sayErr('email-err', r.json?.error || 'That didn\'t work. Try again.')
  emailAsked = email
  show('code')
  $('code-text').textContent = r.json.said || `If ${email} is one this was shared with, a code to open it is on its way there.`
  sayErr('code-err', null)
  $('code-input').value = ''
  $('code-input').focus()
}
$('code-back').onclick = () => { show('email'); $('email-input').select() }
$('code-form').onsubmit = async (e) => {
  e.preventDefault()
  sayErr('code-err', null)
  busy('code-form', true)
  const r = await call('POST', '/.share/code', { email: emailAsked, code: $('code-input').value.replace(/\s+/g, '') }).catch((x) => ({ status: 0, json: { error: x.message } }))
  busy('code-form', false)
  if (r.status === 200) { keepPass(r.json.pass); return letIn(true) }
  sayErr('code-err', r.json?.error || 'That didn\'t work. Try again.')
  $('code-input').select()
}

// ---------- what's shared ----------
let sw = null // the service worker, once it's running
async function worker() {
  if (sw) return sw
  if (!('serviceWorker' in navigator)) return null
  try {
    await navigator.serviceWorker.register('/share-sw.js', { scope: '/' })
    sw = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))])
    // This page's key, told to it: only its frame's requests come here.
    sw?.active?.postMessage({ t: 'host', k })
  } catch { sw = null }
  return sw
}

// Let in. again: after a password or a code, what it is is asked again (until then it wasn't said).
async function letIn(again = false) {
  if (again) {
    const r = await call('GET', '/.share/about').catch(() => null)
    if (!session) return
    if (r?.status === 200 && !r.json.needs) about = r.json
  }
  passed = true
  top()
  // At an address of its own (it may run its scripts there): that address's page, given a port.
  if (about.frame) return showFrame()
  const reg = await worker()
  if (!session) return
  if (!reg) {
    // No service worker (a private window in some browsers): a single file or a document still
    // shows, fetched whole; a site or an app, whose pages ask for more as they go, can't.
    if (about.kind === 'folder' || about.kind === 'app') return waitScreen('This browser can\'t show it here', 'It needs what private windows turn off in this browser. Open the link in a normal window, or in another browser.')
    return whole()
  }
  if (!opened) {
    opened = true
    $('view').src = `/_c/${k}/${about.entry || ''}`
  }
  show(null)
  state('')
  if (about.live) live()
}

// What's shared at its own address: its page there (share-frame.js) is given a port, and every
// request it passes on comes in here (tunnel), and nothing else does.
function showFrame() {
  let origin
  try { origin = new URL(about.frame).origin } catch { return waitScreen('This link doesn\'t open', 'The computer sharing it gave an address that isn\'t one.', { retry: true }) }
  const f = $('view')
  if (!opened) {
    opened = true
    f.onload = () => {
      const ch = new MessageChannel()
      framePort = ch.port1
      framePort.onmessage = (e) => {
        if (e.data?.type === 'fetch' && e.ports[0]) tunnel(e.data, e.ports[0])
        else if (e.data?.t === 'nosw') state('This browser can\'t show it here')
      }
      f.contentWindow.postMessage({ t: 'port', k, entry: about.entry || '' }, origin, [ch.port2])
    }
    f.src = `${origin}/_relay/frame?k=${k}`
  }
  show(null)
  state('')
  if (about.live) live()
}

// A file or a document without the service worker: fetched over the link and shown from here.
async function whole() {
  const parts = []
  let head = null
  await new Promise((resolve) => tunnel({ m: 'GET', u: `/_c/${k}/${about.entry || ''}`, h: [] }, {
    postMessage: (x) => { if (x.head) head = x.head; else if (x.chunk) parts.push(new Uint8Array(x.chunk)); else if (x.end || x.error) resolve() },
    set onmessage(_) { /* nothing to cancel */ },
  }, false))
  if (!head || head.s !== 200) return waitScreen('This didn\'t open', 'The computer sharing it couldn\'t send it just now. Try again.', { retry: true })
  const type = (head.h.find(([k]) => k.toLowerCase() === 'content-type') || [])[1] || 'application/octet-stream'
  opened = true
  $('view').src = URL.createObjectURL(new Blob(parts, { type }))
  show(null)
}

// A Studio document, always its latest: the computer says when it changed, and the frame shows it
// again, where it was.
let liveId = 0
let versions = 0
function live() {
  if (liveId && streams.has(liveId)) return
  const id = nextId++
  liveId = id
  streams.set(id, {
    onMessage: () => {
      // At its own address: its page there shows it again.
      if (framePort) return framePort.postMessage({ t: 'show', v: ++versions })
      const f = $('view')
      let y = 0
      try { y = f.contentWindow.scrollY } catch { /* not there */ }
      f.addEventListener('load', () => { try { f.contentWindow.scrollTo(0, y) } catch { /* not there */ } }, { once: true })
      // Opened again from here (a reload from inside the frame can skip the service worker).
      f.src = `/_c/${k}/${about.entry || ''}?v=${++versions}`
    },
    onClose: () => { if (liveId === id) liveId = 0 },
    onLost: () => { if (liveId === id) liveId = 0 },
  })
  send(K.WS_OPEN, id, { u: '/.share/live' }).catch(() => {})
}

// ---------- the frame's requests, from the service worker (here), or the port (its own address) ----------
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'fetch' && e.ports[0] && !about?.frame) tunnel(e.data, e.ports[0])
  // The service worker asking which page has a key (it may not know this page's address changed).
  else if (e.data?.t === 'who' && e.ports[0]) e.ports[0].postMessage({ k: e.data.k === k ? k : null })
})
navigator.serviceWorker?.startMessages?.()

// One request over the link, its answer streamed back as the reader takes it in (acks: the service
// worker says how much it took), so no more than WINDOW is ever on its way; without acks, as it comes.
function tunnel({ m, u, h, body }, port, acks = true) {
  const prefix = `/_c/${k}`
  if (!session || !passed) return port.postMessage({ error: session ? 'Not opened yet' : `${theirs()} is offline. The link works when it's back.` })
  if (!String(u).startsWith(`${prefix}/`)) return port.postMessage({ error: 'Not part of what was shared' })
  const id = nextId++
  let over = false
  const grant = granter((n) => { if (streams.has(id)) send(K.MORE, id, more(n)).catch(() => {}) })
  port.onmessage = (x) => {
    if (x.data?.cancel) { over = true; streams.delete(id); send(K.CANCEL, id).catch(() => {}) }
    else if (x.data?.ack) grant(x.data.ack)
  }
  const failed = (msg) => { if (over) return; over = true; streams.delete(id); port.postMessage({ error: msg }) }
  streams.set(id, {
    // A redirect within what's shared (from its root) stays under this page's own path.
    onHead: (head) => port.postMessage({ head: { s: head.s, h: (head.h || []).map(([n, v]) => (String(n).toLowerCase() === 'location' && /^\/(?![/\\])/.test(String(v)) && !String(v).startsWith(`${prefix}/`) ? [n, `${prefix}${v}`] : [n, v])) } }),
    onChunk: (c) => { if (over) return; const n = c.byteLength; port.postMessage({ chunk: c.buffer }, [c.buffer]); if (!acks) grant(n) },
    onEnd: () => { over = true; port.postMessage({ end: true }) },
    onError: failed,
    onLost: failed,
  })
  ;(async () => {
    const b = body ? new Uint8Array(body) : null
    await send(K.REQ, id, { m: String(m || 'GET').slice(0, 10), u: `/c${String(u).slice(prefix.length)}`, h: Array.isArray(h) ? h.slice(0, 64) : [], body: !!b, w: WINDOW })
    if (b) {
      for (let o = 0; o < b.byteLength; o += CHUNK) await send(K.BODY, id, b.subarray(o, o + CHUNK))
      await send(K.END, id)
    }
  })().catch((err) => failed(err.message))
}

start()
