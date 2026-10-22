// Bridge AI relay: a Cloudflare Worker you run on your own (free) Cloudflare account, so your phone
// can reach Bridge AI on your computer from anywhere, without a VPN and without opening a port.
//
// Your computer keeps one connection open to it (/_relay/host, with the token only your computer
// has). A phone connects to /_relay/link, and the relay passes bytes between the two. Everything
// past the handshake is end-to-end encrypted between phone and computer (see web/link.js), so the
// relay, and Cloudflare, see sizes and times, never content. What it stores: when your computer was
// last online, and messages your phone left for it while it was offline (sealed, see Hub below).
//
// It also serves the small page your phone opens (web/), which pairs with your computer and then
// shows Bridge AI from it, through the encrypted link.
//
// Deployed by Bridge AI (Settings › Phone & notifications), as one module: FILES is filled in then.
//
// The same code also runs Bridge AI's hosted relay, for people who'd rather not set up their own:
// with HOSTED=1 it serves many computers, one per subdomain, each with its own Hub and its own
// limits. See HOSTED.md. Without HOSTED, none of that code runs.
/* global FILES, RELAY_BUILD */

const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml' }
const MAX_PHONES = 16
const OP = { DATA: 1, OPEN: 2, CLOSE: 3, OK: 4 }
// Messages waiting for your computer: how long, how big, how many.
const Q = { DAYS: 7, NOTE: 64 * 1024, PER_BOX: 50, BOX_BYTES: 512 * 1024, BOXES: 16, RECEIPTS: 100 }
const ID = /^[\w-]{22}$/ // a note's id, or a box
const DAY = 24 * 3600 * 1000

export default {
  async fetch(req, env) {
    if (on(env.HOSTED)) return hosted(req, env)
    const url = new URL(req.url)
    const p = url.pathname
    if (p === '/_relay/host' || p === '/_relay/link') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
      if (p === '/_relay/host' && !(await tokenOk(req.headers.get('Authorization'), env.HOST_TOKEN))) return new Response('Not allowed', { status: 403 })
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(req)
    }
    // Public, so it says only that the relay is up and which version: nothing about your computer.
    if (p === '/_relay/health') return health()
    return page(req, url)
  },
}

const health = () => new Response(JSON.stringify({ ok: true, build: RELAY_BUILD }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// The page and its files. Anything else is Bridge AI itself, which the page's service worker
// fetches from your computer; reaching here means the page isn't open yet.
function page(req, url) {
  const p = url.pathname
  const name = p === '/' ? 'index.html' : p.slice(1)
  const f = FILES[name]
  if (!f) {
    if (req.headers.get('Sec-Fetch-Dest') === 'document' || req.headers.get('Accept')?.includes('text/html')) return Response.redirect(`${url.origin}/`, 302)
    return new Response('Not found', { status: 404 })
  }
  const body = f.b64 ? Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) : f.text
  return new Response(body, {
    headers: {
      'Content-Type': TYPES[name.split('.').pop()] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // small, and must change together when the relay is updated
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(name === 'index.html' ? { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'" } : {}),
    },
  })
}

async function tokenOk(header, token) {
  if (!token || !header) return false
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(header)))
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`Bearer ${token}`)))
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

const frame = (op, id, payload) => {
  const b = payload ? new Uint8Array(payload) : new Uint8Array(0)
  const out = new Uint8Array(5 + b.byteLength)
  out[0] = op
  new DataView(out.buffer).setUint32(1, id)
  out.set(b, 5)
  return out
}

// A phone's box: a hash of its key (web/link.js boxId), so notes are kept by phone without the key.
async function boxOf(d) {
  const raw = Uint8Array.from(atob(d.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (d.length % 4)) % 4)), (c) => c.charCodeAt(0))
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...new TextEncoder().encode('bridge box v1'), ...raw])))
  return btoa(String.fromCharCode(...h.subarray(0, 16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------- Bridge AI's hosted relay (HOSTED=1) ----------
// One relay for many computers. https://<domain>/ is a small page and POST /_relay/register, which
// gives a computer its own address, https://<id>.<domain> (one level down, so Cloudflare's free
// certificate covers it), its own Hub (idFromName(id)) and a token. The Hub keeps only a hash of
// the token. Phones then work exactly as with a relay of your own: one address per computer, so
// each keeps its own pairing and service worker. Any other name answers 404.
const on = (v) => v === true || v === '1' || v === 'true'
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
// Names a computer never gets (the project may want them for itself).
const RESERVED = new Set(['www', 'api', 'relay', 'admin', 'app', 'mail', 'status', 'docs', 'help', 'support', 'static', 'cdn', 'assets', 'auth', 'login', 'dashboard', 'blog'])
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)
const nextDay = (t = Date.now()) => Date.parse(utcDay(t)) + DAY
const version = (v) => (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(v || '')) ? String(v) : 'unknown')

// Every limit, from the Worker's settings (wrangler.hosted.toml [vars]); HOSTED.md says why each
// default is what it is.
function limits(env) {
  const n = (k, d) => (env[k] != null && env[k] !== '' && Number.isFinite(Number(env[k])) ? Number(env[k]) : d)
  return {
    phones: n('MAX_PHONES', MAX_PHONES), // connections to one computer at once
    messageKB: n('MAX_MESSAGE_KB', 256), // one message
    rate: n('MESSAGES_PER_SECOND', 200), // incoming messages to one computer, on average…
    burst: n('MESSAGE_BURST', 2000), // …with this many at once
    dayMB: n('DAILY_MB', 512), // a computer's daily allowance (UTC days), in data…
    dayMessages: n('DAILY_MESSAGES', 200000), // …and in messages, which is what Cloudflare bills
    idleDays: n('IDLE_DAYS', 90), // a computer not seen this long is deleted
    perIp: n('REGISTER_PER_IP', 10), // new computers a day from one network
    perDay: n('REGISTER_PER_DAY', 1000), // new computers a day, in all
  }
}
// The kill switch: HOSTED_OFF=1 (or a message of your own) refuses new computers and connections.
// (Said to a phone, it also says where to change that: on the computer.)
const OFF_TEXT = 'Bridge AI\'s relay is switched off for now. To keep using your phone, put a relay on your own Cloudflare account, or use Tailscale'
const offText = (env, phone) => (!env.HOSTED_OFF || env.HOSTED_OFF === '0' || env.HOSTED_OFF === 'false' ? null : on(env.HOSTED_OFF) ? `${OFF_TEXT}${phone ? ' (Settings › Phone & notifications, on the computer)' : ' instead'}.` : String(env.HOSTED_OFF).slice(0, 300))

// A computer's id: 10 random base32 characters and 2 of checksum, so a made-up name is turned away
// here, without waking a Hub.
async function check(s) { const h = await sha(`bridge relay id ${s}`); const v = parseInt(h.slice(0, 3), 16) >> 2; return B32[v >> 5] + B32[v & 31] }
async function newId() { const s = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => B32[b & 31]).join(''); return s + (await check(s)) }
const idOk = async (s) => /^[a-z2-7]{12}$/.test(s) && !RESERVED.has(s) && (await check(s.slice(0, 10))) === s.slice(10)

const hub = (env, id) => env.HUB.get(env.HUB.idFromName(id))
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const notFound = () => new Response('Not found', { status: 404 })

// Anonymous counts for the project (Workers Analytics Engine, if bound as STATS): by computer id
// only. HOSTED.md lists every one.
function count(env, id, what, blobs = [], doubles = []) {
  try { env.STATS?.writeDataPoint({ indexes: [id || ''], blobs: [what, ...blobs], doubles }) } catch { /* counting never gets in the way */ }
}

// A WebSocket answered with one message and closed: a browser can't read why a connection was
// refused, but it can read this.
function refuse(msg, code) {
  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  server.send(JSON.stringify(msg))
  server.close(code, msg.why || 'refused')
  return new Response(null, { status: 101, webSocket: client })
}

// Which ids are registered, remembered for a few minutes by this Worker instance, so a page's
// files don't each ask a Hub.
const known = new Map()
async function registered(env, id) {
  const k = known.get(id)
  if (k && k.until > Date.now()) return k.ok
  const ok = (await hub(env, id).fetch('https://hub/_hosted/check')).ok
  if (known.size > 5000) known.clear()
  known.set(id, { ok, until: Date.now() + (ok ? 300000 : 30000) })
  return ok
}

async function hosted(req, env) {
  const url = new URL(req.url)
  const p = url.pathname
  const domain = String(env.HOSTED_DOMAIN || '').toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!domain) return new Response('HOSTED_DOMAIN isn\'t set', { status: 500 })
  const host = url.hostname.toLowerCase()
  if (host === domain) {
    if (p === '/_relay/register') return req.method === 'POST' ? register(req, env, url) : new Response('Use POST', { status: 405 })
    if (p === '/_relay/health') return health()
    if (p === '/') return new Response(LANDING, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } })
    if (p === '/mark.svg') return page(req, url)
    return notFound()
  }
  const id = host.endsWith(`.${domain}`) ? host.slice(0, -domain.length - 1) : ''
  if (!(await idOk(id)) || !(await registered(env, id))) return notFound()
  if (p === '/_relay/host' || p === '/_relay/link') {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
    const off = offText(env, p === '/_relay/link')
    if (off) return refuse({ t: 'limit', why: 'off', text: off, until: Date.now() + 30 * 60000 }, 4009)
    return hub(env, id).fetch(req) // the Hub checks the computer's token
  }
  if (p === '/_relay/forget') return req.method === 'POST' ? hub(env, id).fetch(req) : new Response('Use POST', { status: 405 })
  if (p === '/_relay/health') return health()
  return page(req, url)
}

// POST /_relay/register: { version } in, { id, url, token } out, once. Limited per network and per
// day (the registry: a Hub of its own, keeping a count per day under a hash of the network's address
// and that day, gone the next day).
async function register(req, env, url) {
  const off = offText(env)
  if (off) return json({ error: off }, 503)
  if (Number(req.headers.get('Content-Length') || 0) > 4096) return json({ error: 'Too big' }, 413)
  // JSON only, so a web page elsewhere can't make your browser register computers (it would need
  // to ask first, and nothing here answers that).
  if (!/^application\/json\b/i.test(req.headers.get('Content-Type') || '')) return json({ error: 'Send JSON' }, 415)
  const lim = limits(env)
  let body = {}
  try { body = JSON.parse(await req.text()) } catch { /* nothing said */ }
  const v = version(body?.version)
  let ip = req.headers.get('CF-Connecting-IP') || ''
  if (ip.includes(':')) { // IPv6: its /64, which one home or server usually has to itself
    const [a, b = ''] = ip.toLowerCase().split('::')
    const head = a ? a.split(':') : []
    const tail = b ? b.split(':') : []
    ip = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail].slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':')
  }
  const day = utcDay()
  const key = (await sha(`bridge register ${day} ${ip}`)).slice(0, 32)
  const gate = await hub(env, 'registry').fetch('https://hub/_hosted/gate', { method: 'POST', body: JSON.stringify({ key, day, perIp: lim.perIp, perDay: lim.perDay }) }).then((r) => r.json())
  if (!gate.ok) {
    count(env, '', 'refused', [gate.why])
    return json({ error: gate.why === 'ip' ? 'Too many computers were set up from this network today. Try again tomorrow, or put a relay on your own Cloudflare account.' : 'Bridge AI\'s relay isn\'t taking more computers today. Try again tomorrow, or put a relay on your own Cloudflare account.' }, 429)
  }
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const hash = await sha(token)
  for (let i = 0; i < 4; i++) {
    const id = await newId()
    if (RESERVED.has(id)) continue
    const r = await hub(env, id).fetch('https://hub/_hosted/init', { method: 'POST', body: JSON.stringify({ id, hash, version: v }) })
    if (r.status === 409) continue // taken (vanishingly unlikely): another
    if (!r.ok) break
    known.set(id, { ok: true, until: Date.now() + 300000 })
    count(env, id, 'register', [v])
    return json({ id, url: `${url.protocol}//${id}.${url.host}`, token })
  }
  return json({ error: 'Couldn\'t set up an address. Try again in a minute.' }, 500)
}

const LANDING = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bridge AI relay</title><meta name="robots" content="noindex">
<style>:root{color-scheme:light dark;--bg:#fafaf9;--ink:#1c1917;--ink2:#57534e;--line:#e7e5e4}@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--ink:#f5f5f4;--ink2:#a8a29e;--line:#292524}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,sans-serif}main{max-width:460px;padding:32px 20px}h1{font-size:20px;margin:14px 0 8px}p{color:var(--ink2);margin:0 0 12px}a{color:inherit}</style></head>
<body><main><img src="/mark.svg" alt="" width="44" height="44"><h1>Bridge AI relay</h1>
<p>This relay lets Bridge AI on a phone reach Bridge AI on a computer, from anywhere. Everything between them is end-to-end encrypted, so the relay passes it on without being able to read it.</p>
<p>There's nothing to do here: Bridge AI sets it up by itself (Settings › Phone &amp; notifications). To run your own relay instead, see <a href="https://github.com/sahil1/bridge">github.com/sahil1/bridge</a>.</p></main></body></html>`

// One per relay: holds your computer's connection and the phones'. Uses WebSocket hibernation,
// so while nobody is talking it isn't running (and isn't billed).
//
// It also keeps the messages a phone leaves while your computer is offline, as text messages on the
// same connections (binary ones are the link, as before):
//   phone:    { t: 'box', box }    which phone this is (its box: a hash of its key), once connected;
//                                  answered with its notes still waiting and the receipts for the rest
//             { t: 'put', note }   leave a note (web/link.js seals it for your computer)
//             { t: 'got', ids }    receipts it has read;  { t: 'drop', ids }  notes it took back
//   computer: { t: 'take', boxes } it takes notes now (all of them, then each new one as it comes),
//                                  and these are its paired phones' boxes ({ t: 'roster' } later)
//             { t: 'ack', box, id, receipt }  done with a note: it's deleted, and the receipt
//                                  (what became of it, sealed for the phone) waits for the phone instead
// A note waits 7 days at most; 64 KB each, 50 or 512 KB a phone. Once your computer has said which
// phones are its own, other boxes can't leave notes; before that (an older Bridge AI), up to 16
// boxes can, and the notes wait until it's updated. Older phones and computers never see any of it.
export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx
    // Keepalives are answered without waking the hub.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    // On Bridge AI's hosted relay: one computer's Hub, with its limits (see Hosted below).
    if (on(env?.HOSTED)) {
      this.env = env
      this.lim = limits(env)
      ctx.blockConcurrencyWhile(async () => {
        this.meta = (await ctx.storage.get('meta')) || null
        this.day = (await ctx.storage.get('day')) || null
      })
    }
  }

  host(except) { return this.ctx.getWebSockets('host').find((w) => w !== except && w.readyState === 1) || null }

  async fetch(req) {
    const url = new URL(req.url)
    if (this.lim) { const r = await this.gate(req, url); if (r) return r }
    const [client, server] = Object.values(new WebSocketPair())
    if (url.pathname === '/_relay/host') {
      // A new connection from the computer replaces the old one; phones start over with it.
      for (const old of this.ctx.getWebSockets('host')) try { old.close(4000, 'replaced') } catch { /* gone */ }
      for (const ph of this.ctx.getWebSockets('phone')) try { ph.close(4001, 'computer reconnected') } catch { /* gone */ }
      this.ctx.acceptWebSocket(server, ['host'])
      await this.ctx.storage.put('seen', null)
      if (this.lim) await this.hostIn(server, req)
    } else {
      // The address is public, so anyone can connect; only your computer can tell a paired phone
      // (it says so with OK). When full, the oldest connection it hasn't vouched for makes room,
      // so strangers can't crowd out your phones.
      const phones = this.ctx.getWebSockets('phone')
      if (phones.length >= (this.lim?.phones ?? MAX_PHONES)) {
        const stranger = phones.map((w) => [w, w.deserializeAttachment() || {}]).filter(([, a]) => !a.ok).sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0]
        if (!stranger) return new Response('Too many connections', { status: 429 })
        try { stranger[0].close(4004, 'make room') } catch { /* gone */ }
      }
      const id = crypto.getRandomValues(new Uint32Array(1))[0]
      this.ctx.acceptWebSocket(server, ['phone', `p${id}`])
      server.serializeAttachment({ id, at: Date.now() })
      const h = this.host()
      // q: this relay keeps notes (older pages ignore it).
      server.send(JSON.stringify({ host: !!h, seen: (await this.ctx.storage.get('seen')) || null, q: 1 }))
      if (h) h.send(frame(OP.OPEN, id))
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, msg) {
    if (this.lim && !(await this.meter(ws, msg))) return
    if (typeof msg === 'string') return this.text(ws, msg) // keepalives are answered before here
    if (this.ctx.getTags(ws).includes('host')) {
      const b = new Uint8Array(msg)
      const id = new DataView(b.buffer, b.byteOffset).getUint32(1)
      const ph = this.ctx.getWebSockets(`p${id}`)[0]
      if (!ph) { if (b[0] !== OP.CLOSE) ws.send(frame(OP.CLOSE, id)); return }
      if (b[0] === OP.DATA) ph.send(b.subarray(5))
      else if (b[0] === OP.OK) ph.serializeAttachment({ ...ph.deserializeAttachment(), ok: true })
      else if (b[0] === OP.CLOSE) try { ph.close(4003, 'closed by the computer') } catch { /* gone */ }
      return
    }
    const h = this.host()
    const { id } = ws.deserializeAttachment() || {}
    if (h && id != null) h.send(frame(OP.DATA, id, msg))
  }

  async webSocketClose(ws, code) {
    await this.gone(ws, code)
    if (this.lim && this.day) await this.saveDay(true)
  }

  async webSocketError(ws) {
    await this.gone(ws, 1011)
  }

  async gone(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye') } catch { /* already closed */ }
    if (this.lim && !this.meta) return // removed (hosted): nothing to keep
    if (this.ctx.getTags(ws).includes('host')) {
      if (this.host(ws)) return // a newer connection took over
      const seen = Date.now()
      await this.ctx.storage.put('seen', seen)
      for (const ph of this.ctx.getWebSockets('phone')) try { ph.send(JSON.stringify({ host: false, seen })) } catch { /* gone */ }
      return
    }
    const { id } = ws.deserializeAttachment() || {}
    const h = this.host(ws)
    if (h && id != null) try { h.send(frame(OP.CLOSE, id)) } catch { /* gone */ }
  }

  // ---------- notes waiting for your computer ----------
  async text(ws, s) {
    let m
    try { m = JSON.parse(s) } catch { return }
    if (!m || typeof m !== 'object') return
    const st = this.ctx.storage
    if (this.ctx.getTags(ws).includes('host')) {
      if (m.t === 'take' || m.t === 'roster') await this.roster(m.boxes)
      if (m.t === 'take') {
        ws.serializeAttachment({ ...ws.deserializeAttachment(), takes: true })
        await this.purge()
        const all = [...(await st.list({ prefix: 'n:' })).values()].sort((a, b) => a.at - b.at)
        for (const n of all) ws.send(JSON.stringify({ t: 'note', box: n.box, note: n.note }))
      } else if (m.t === 'ack' && ID.test(m.box || '') && ID.test(m.id || '')) await this.ack(m)
      return
    }
    const a = ws.deserializeAttachment() || {}
    if (m.t === 'box' && ID.test(m.box || '')) {
      ws.serializeAttachment({ ...a, box: m.box })
      if (this.lim) await this.phoneIn(m.box)
      await this.purge()
      const waiting = [...(await st.list({ prefix: `n:${m.box}:` })).values()].map((n) => n.note.id)
      const receipts = [...(await st.list({ prefix: `r:${m.box}:` })).values()].map((r) => r.note)
      ws.send(JSON.stringify({ t: 'box', waiting, receipts }))
    } else if (m.t === 'put') await this.put(ws, m.note)
    else if ((m.t === 'got' || m.t === 'drop') && a.box && Array.isArray(m.ids)) {
      await st.delete(m.ids.filter((id) => ID.test(id)).slice(0, 128).map((id) => `${m.t === 'got' ? 'r' : 'n'}:${a.box}:${id}`))
    }
  }

  async put(ws, note) {
    const say = (ok, why) => ws.send(JSON.stringify({ t: 'put', id: note?.id, ok, ...(why ? { why } : {}) }))
    const size = JSON.stringify(note ?? null).length
    if (!ID.test(note?.id || '') || typeof note.d !== 'string' || note.d.length > 100) return say(false, 'bad')
    if (size > Q.NOTE) return say(false, 'too-big')
    const box = await boxOf(note.d).catch(() => null)
    if (!box) return say(false, 'bad')
    const st = this.ctx.storage
    await this.purge()
    const roster = await st.get('roster')
    const mine = await st.list({ prefix: `n:${box}:` })
    if (roster ? !roster.includes(box) : !mine.size && (await this.boxes()) >= Q.BOXES) return say(false, roster ? 'not-paired' : 'full')
    const key = `n:${box}:${note.id}`
    let bytes = size
    let count = 1
    for (const [k, v] of mine) if (k !== key) { bytes += v.size; count++ }
    if (count > Q.PER_BOX || bytes > Q.BOX_BYTES) return say(false, 'full')
    await st.put(key, { box, note, at: Date.now(), size })
    await this.wake()
    say(true)
    // Your computer is here after all (the phone hadn't heard yet): straight on.
    if (this.host()?.deserializeAttachment()?.takes) this.host().send(JSON.stringify({ t: 'note', box, note }))
  }

  async ack({ box, id, receipt }) {
    const st = this.ctx.storage
    await st.delete(`n:${box}:${id}`)
    if (!receipt || JSON.stringify(receipt).length > 4096) return
    await st.put(`r:${box}:${id}`, { box, note: receipt, at: Date.now() })
    const all = [...(await st.list({ prefix: `r:${box}:` }))].sort((x, y) => x[1].at - y[1].at)
    if (all.length > Q.RECEIPTS) await st.delete(all.slice(0, all.length - Q.RECEIPTS).map(([k]) => k))
    for (const ph of this.ctx.getWebSockets('phone')) if (ph.deserializeAttachment()?.box === box) try { ph.send(JSON.stringify({ t: 'receipt', note: receipt })) } catch { /* gone */ }
    await this.wake()
  }

  async roster(boxes) {
    if (Array.isArray(boxes)) await this.ctx.storage.put('roster', boxes.filter((b) => ID.test(b)).slice(0, 64))
  }

  async boxes() { return new Set([...(await this.ctx.storage.list({ prefix: 'n:' })).values()].map((n) => n.box)).size }

  // Notes and receipts go after 7 days: checked whenever they're used, and once a day while any wait.
  async purge() {
    const old = Date.now() - Q.DAYS * DAY
    const st = this.ctx.storage
    const gone = [...(await st.list({ prefix: 'n:' })), ...(await st.list({ prefix: 'r:' }))].filter(([, v]) => v.at < old).map(([k]) => k)
    for (let i = 0; i < gone.length; i += 128) await st.delete(gone.slice(i, i + 128))
  }

  // (On the hosted relay there's always an alarm, for the clean-up below: a sooner one for notes.)
  async wake() { const at = await this.ctx.storage.getAlarm(); if (!at || (this.lim && at > Date.now() + DAY)) await this.ctx.storage.setAlarm(Date.now() + DAY) }

  async alarm() {
    if (this.lim) return this.hostedAlarm()
    await this.purge()
    const st = this.ctx.storage
    if ((await st.list({ prefix: 'n:', limit: 1 })).size || (await st.list({ prefix: 'r:', limit: 1 })).size) await st.setAlarm(Date.now() + DAY)
  }

  // ---------- Bridge AI's hosted relay: one computer ----------
  // What a computer's Hub keeps beyond what a relay of your own does: meta { id, hash (of its token),
  // at, v }, last (when its computer last connected), day { d, bytes, msgs } (today's use, UTC) and
  // wk (which of its paired phones were counted this week, by box). The registry is a Hub of its
  // own and keeps only today's g:<day>:<network> counts.
  async gate(req, url) {
    const p = url.pathname
    if (p === '/_hosted/check') return new Response(null, { status: this.meta ? 204 : 404 })
    if (p === '/_hosted/gate') return this.registry(await req.json())
    if (p === '/_hosted/init') {
      if (this.meta) return new Response('Taken', { status: 409 })
      const { id, hash, version: v } = await req.json()
      this.meta = { id, hash, at: Date.now(), v }
      await this.ctx.storage.put('meta', this.meta)
      await this.ctx.storage.setAlarm(Date.now() + this.lim.idleDays * DAY)
      return new Response('Created', { status: 201 })
    }
    if (!this.meta) return notFound()
    if (p === '/_relay/forget') {
      if (!(await this.tokenOk(req))) return new Response('Not allowed', { status: 403 })
      count(this.env, this.meta.id, 'removed', ['forget'])
      await this.remove(4007, 'removed')
      return new Response(null, { status: 204 })
    }
    if (p === '/_relay/host') return (await this.tokenOk(req)) ? null : new Response('Not allowed', { status: 403 })
    if (p === '/_relay/link') return this.over(this.today()) ? refuse(this.limit('day'), 4005) : null
    return notFound()
  }

  async tokenOk(req) {
    const h = req.headers.get('Authorization') || ''
    if (!h.startsWith('Bearer ') || h.length > 256) return false
    const a = await sha(h.slice(7))
    const b = this.meta.hash
    let d = a.length ^ b.length
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i % b.length)
    return d === 0
  }

  async hostIn(ws, req) {
    count(this.env, this.meta.id, 'computer', [version(req.headers.get('X-Bridge-Version'))])
    await this.ctx.storage.put('last', Date.now())
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + this.lim.idleDays * DAY)
    if (this.over(this.today())) ws.send(JSON.stringify(this.limit('day')))
  }

  // A phone said which it is: counted once a week if it's one of this computer's paired phones.
  async phoneIn(box) {
    const st = this.ctx.storage
    if (!(await st.get('roster'))?.includes(box)) return
    const w = Math.floor((Date.now() / DAY + 3) / 7) // weeks start on Monday
    const wk = (await st.get('wk')) || {}
    if (wk.w === w && wk.boxes.includes(box)) return
    await st.put('wk', { w, boxes: wk.w === w ? [...wk.boxes, box].slice(-64) : [box] })
    count(this.env, this.meta.id, 'phone', [utcDay((w * 7 - 3) * DAY)]) // the week, by its Monday
  }

  today(now = Date.now()) {
    const d = utcDay(now)
    if (this.day?.d !== d) {
      if (this.day && (this.day.bytes > this.day.sb || this.day.msgs > this.day.sm)) count(this.env, this.meta?.id, 'usage', [], [this.day.bytes - this.day.sb, this.day.msgs - this.day.sm])
      this.day = { d, bytes: 0, msgs: 0, sb: 0, sm: 0 } // sb, sm: how much of it is saved (and counted)
    }
    return this.day
  }

  over(day) { return day.bytes > this.lim.dayMB * 1048576 || day.msgs > this.lim.dayMessages }

  // Saved every 100 messages or 256 KB, and when a connection ends: in between it's only in memory,
  // so a Hub put to sleep forgets at most that much.
  async saveDay(force) {
    const d = this.day
    if (!d || (d.bytes === d.sb && d.msgs === d.sm)) return
    if (!force && d.bytes - d.sb < 262144 && d.msgs - d.sm < 100) return
    count(this.env, this.meta?.id, 'usage', [], [d.bytes - d.sb, d.msgs - d.sm])
    d.sb = d.bytes
    d.sm = d.msgs
    await this.ctx.storage.put('day', d)
  }

  // Each message in: counted, and turned away if it's too big, too many at once, or past today's
  // allowance. A phone's own is turned away by closing that phone; so is a computer's message for
  // a phone (its link can't carry on with a piece missing). The computer's own text messages (about
  // notes) only count.
  async meter(ws, msg) {
    const now = Date.now()
    const size = typeof msg === 'string' ? msg.length : msg.byteLength
    const fromHost = this.ctx.getTags(ws).includes('host')
    const day = this.today(now)
    day.bytes += size
    day.msgs++
    const housekeeping = fromHost && typeof msg === 'string'
    const phone = !fromHost ? ws : !housekeeping && size >= 5 ? this.ctx.getWebSockets(`p${new DataView(msg).getUint32(1)}`)[0] : null
    // For a phone that's just been let go: nowhere to go (its computer hears it's gone).
    if (fromHost && phone && phone.readyState !== 1) return false
    if (!housekeeping && size > this.lim.messageKB * 1024) return this.cut(phone, 'size', now + 5000)
    this.tokens = Math.min(this.lim.burst, (this.tokens ?? this.lim.burst) + ((now - (this.tokAt ?? now)) * this.lim.rate) / 1000)
    this.tokAt = now
    if (!housekeeping && this.tokens < 1) return this.cut(phone, 'rate', now + 10000)
    this.tokens--
    if (this.over(day)) {
      if (!day.told) await this.dayOver(day)
      return housekeeping
    }
    if (day.told) day.told = false // the allowance was raised since
    await this.saveDay()
    return true
  }

  limit(why, until) {
    const reset = nextDay()
    const text = {
      day: `The hosted relay's daily limit for this computer is used up. It resets at ${new Date(reset).toISOString().slice(11, 16)} UTC. For no limits, put the relay on your own Cloudflare account (Settings › Phone & notifications, on the computer).`,
      rate: 'Too much at once for Bridge AI\'s relay. Connecting again in a moment.',
      size: `That was too big for Bridge AI's relay (over ${this.lim.messageKB} KB at once). Connecting again in a moment.`,
    }[why]
    return { t: 'limit', why, text, until: why === 'day' ? reset : until }
  }

  cut(ws, why, until) {
    if (ws?.readyState !== 1) return false
    count(this.env, this.meta.id, 'limit', [why])
    try { ws.send(JSON.stringify(this.limit(why, until))); ws.close(4005, 'limit') } catch { /* gone */ }
    return false
  }

  // Today's allowance is used up: both ends hear so, phones are let go until it resets, and the
  // computer stays connected (quietly), ready for then.
  async dayOver(day) {
    day.told = true
    await this.saveDay(true)
    await this.ctx.storage.put('day', day)
    count(this.env, this.meta.id, 'limit', ['day'])
    const m = JSON.stringify(this.limit('day'))
    for (const w of this.ctx.getWebSockets()) try { w.send(m); if (!this.ctx.getTags(w).includes('host')) w.close(4005, 'limit') } catch { /* gone */ }
  }

  // Forgotten by its computer, or not seen for IDLE_DAYS: everything this Hub kept goes.
  async remove(code, why) {
    const all = this.ctx.getWebSockets()
    this.meta = null
    this.day = null
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    for (const w of all) try { w.close(code, why) } catch { /* gone */ }
  }

  async registry({ key, day, perIp, perDay }) {
    const st = this.ctx.storage
    const mine = (await st.get(`g:${day}:${key}`)) || 0
    const all = (await st.get(`g:${day}`)) || 0
    if (mine >= perIp) return json({ ok: false, why: 'ip' })
    if (all >= perDay) return json({ ok: false, why: 'all' })
    await st.put({ [`g:${day}:${key}`]: mine + 1, [`g:${day}`]: all + 1, registry: true })
    if (!(await st.getAlarm())) await st.setAlarm(nextDay() + 60000)
    return json({ ok: true })
  }

  async hostedAlarm() {
    const st = this.ctx.storage
    if (await st.get('registry')) { // the registry: past days' counts go
      const today = `g:${utcDay()}`
      const old = [...(await st.list({ prefix: 'g:' })).keys()].filter((k) => k !== today && !k.startsWith(`${today}:`))
      for (let i = 0; i < old.length; i += 128) await st.delete(old.slice(i, i + 128))
      await st.setAlarm(nextDay() + 60000)
      return
    }
    if (!this.meta) return
    await this.purge()
    const idle = this.lim.idleDays * DAY
    if (this.host()) await st.put('last', Date.now())
    const last = Math.max((await st.get('last')) || 0, (await st.get('seen')) || 0, this.meta.at)
    if (Date.now() - last >= idle) {
      count(this.env, this.meta.id, 'removed', ['idle'])
      return this.remove(4006, 'unused')
    }
    const notes = (await st.list({ prefix: 'n:', limit: 1 })).size || (await st.list({ prefix: 'r:', limit: 1 })).size
    await st.setAlarm(Math.min(last + idle, notes ? Date.now() + DAY : Infinity))
  }
}
