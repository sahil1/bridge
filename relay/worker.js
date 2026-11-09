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
// Deployed by Bridge AI (Settings › Devices), as one module: FILES is filled in then.
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
// A computer that's gone quiet. Its connection can stay open for minutes after its network went (a
// Mac whose Wi-Fi dropped says nothing, and Cloudflare hears nothing either way), and meanwhile phones
// were told it was here and waited on it. It pings every 15 s (answered without waking the Hub, which
// keeps the time) and anything else it sends counts too: nothing for this long, and it's let go and
// phones hear it's offline, since it was last heard.
const QUIET_MS = 40 * 1000

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
// fetches from your computer; reaching here means the page isn't open yet. On the hosted relay
// (domain), the page connects only to the relay's own addresses: its computer's, and the others'
// on it, whose relays the Android app asks whether they're on (relay/web/shell.js, otherState).
function page(req, url, domain = null) {
  const p = url.pathname
  const name = p === '/' ? 'index.html' : p.slice(1)
  const f = FILES[name]
  if (!f) {
    if (req.headers.get('Sec-Fetch-Dest') === 'document' || req.headers.get('Accept')?.includes('text/html')) return Response.redirect(`${url.origin}/`, 302)
    return new Response('Not found', { status: 404 })
  }
  const headers = {
    'Content-Type': TYPES[name.split('.').pop()] || 'application/octet-stream',
    'Cache-Control': 'no-cache', // small, and must change together when the relay is updated
    // ...so the phone asks each time, and the build says whether it changed: if not, nothing to
    // download again (the page opens a little sooner, on a slow network much sooner).
    ETag: `"${RELAY_BUILD}"`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(name === 'index.html' ? {
      'Content-Security-Policy': `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ${domain ? `${url.protocol === 'http:' ? 'ws' : 'wss'}://*.${domain}${url.port ? `:${url.port}` : ''}` : 'wss: ws:'}; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
      // No other site's window keeps a hold on this one (window.opener), whoever opened it.
      'Cross-Origin-Opener-Policy': 'same-origin',
    } : {}),
  }
  // (Cloudflare marks the tag weak, W/, when it compresses the file on the way.)
  const has = (req.headers.get('If-None-Match') || '').split(',').some((t) => t.trim().replace(/^W\//, '') === headers.ETag)
  if (has) return new Response(null, { status: 304, headers })
  return new Response(f.b64 ? Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) : f.text, { headers })
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
// One relay for many computers, each signed in to a Bold Bridge account that may use it
// (account/API.md). https://<domain>/ is a small page and POST /_relay/register, which takes the
// account's relay token and gives that computer its own address, https://<id>.<domain> (one level
// down, so Cloudflare's free certificate covers it), its own Hub (idFromName(id)) and a token. The
// Hub keeps only a hash of the token. Phones then work exactly as with a relay of your own: one
// address per computer, so each keeps its own pairing and service worker. Each account's use, across
// its computers, is kept by an Account of its own (idFromName(a)). Any other name answers 404.
const on = (v) => v === true || v === '1' || v === 'true'
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
// Names a computer never gets (the project may want them for itself).
const RESERVED = new Set(['www', 'api', 'relay', 'admin', 'app', 'mail', 'status', 'docs', 'help', 'support', 'static', 'cdn', 'assets', 'auth', 'login', 'dashboard', 'blog'])
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const HOUR = 3600 * 1000
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)
const nextDay = (t = Date.now()) => Date.parse(utcDay(t)) + DAY
const version = (v) => (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(v || '')) ? String(v) : 'unknown')

// Every limit, from the Worker's settings (wrangler.hosted.toml [vars]); HOSTED.md says why each
// default is what it is. The window, the week and MAX_ACCOUNTS are per account; the rest per
// computer, but for RELAY_DAILY_REQUESTS, the whole relay's.
function limits(env) {
  const n = (k, d) => (env[k] != null && env[k] !== '' && Number.isFinite(Number(env[k])) ? Number(env[k]) : d)
  return {
    phones: n('MAX_PHONES', MAX_PHONES), // connections to one computer at once
    messageKB: n('MAX_MESSAGE_KB', 256), // one message
    rate: n('MESSAGES_PER_SECOND', 200), // incoming messages to one computer, on average…
    burst: n('MESSAGE_BURST', 2000), // …with this many at once
    idleDays: n('IDLE_DAYS', 90), // a computer not seen this long is deleted
    windowHours: n('ACCOUNT_WINDOW_HOURS', 8), // an account's window, from its first message after the last one ended…
    windowMessages: n('ACCOUNT_WINDOW_MESSAGES', 150000), // …and the messages it may send in it, which is what Cloudflare bills
    weekMessages: n('ACCOUNT_WEEK_MESSAGES', 1000000), // and in a week, the weeks running on from its first use
    accounts: n('MAX_ACCOUNTS', 500), // accounts with a computer on the relay, in all
    dayRequests: n('RELAY_DAILY_REQUESTS', 5000000), // the whole relay's Cloudflare requests a day, as /_relay/stats counts them
  }
}
// The kill switch: HOSTED_OFF=1 (or a message of your own) refuses new computers and connections.
// (Said to a phone, it also says where to change that: on the computer.)
const OFF_TEXT = 'Bridge AI\'s relay is switched off for now. To keep using your phone, put a relay on your own Cloudflare account, or use Tailscale'
const offText = (env, phone) => (!env.HOSTED_OFF || env.HOSTED_OFF === '0' || env.HOSTED_OFF === 'false' ? null : on(env.HOSTED_OFF) ? `${OFF_TEXT}${phone ? ' (Settings › Devices, on the computer)' : ' instead'}.` : String(env.HOSTED_OFF).slice(0, 300))

// What a phone (and the computer) is told when the relay stops carrying it for now, with when it
// can go on (`end`). The account's own: window, week, and the account itself (suspended, relay,
// deleted, token).
const ACCOUNT_WHY = new Set(['suspended', 'relay', 'deleted', 'token'])
const REFUSED_MS = 10 * 60000 // how long a computer whose account is stopped waits before it asks again
const OWN = 'For no limits, put the relay on your own Cloudflare account (Settings › Devices, on the computer).'
const OTHER = 'A relay on your own Cloudflare account, or Tailscale, still works (Settings › Devices, on the computer).'
function limitText(why, l, end) {
  const n = (x) => x.toLocaleString('en-US')
  const d = new Date(end)
  const at = d.toISOString().slice(11, 16)
  const when = utcDay(end) === utcDay() ? `${at} UTC` : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${at} UTC`
  return {
    window: `This computer's Bold Bridge account has used its allowance on Bridge AI's relay for now (${n(l.windowMessages)} messages in ${l.windowHours} hours). It resets at ${when}. ${OWN}`,
    week: `This computer's Bold Bridge account has used this week's allowance on Bridge AI's relay (${n(l.weekMessages)} messages a week). It resets on ${when}. ${OWN}`,
    all: `Bridge AI's relay has carried all it can for today, for every computer on it. It starts again at ${at} UTC. For no limits, put the relay on your own Cloudflare account (Settings › Devices, on the computer), or use Tailscale.`,
    shut: `Bridge AI's relay let this computer go until ${when}: it kept sending after its phones were stopped (over ${n(HOST_SLACK)} messages that had nowhere to go). Phones can connect again then. ${OWN}`,
    rate: 'Too much at once for Bridge AI\'s relay. Connecting again in a moment.',
    size: `That was too big for Bridge AI's relay (over ${l.messageKB} KB at once). Connecting again in a moment.`,
    phones: `Bridge AI's relay takes ${l.phones} connections to one computer at once, and this computer has that many paired phones and tabs connected. Close Bridge AI on one you're not using; this one tries again in a minute.`,
    suspended: `This computer's Bold Bridge account is suspended, so Bridge AI's relay doesn't carry it for now. ${OTHER}`,
    relay: `This computer's Bold Bridge account doesn't have Bridge AI's relay any more. ${OTHER}`,
    deleted: `This computer's Bold Bridge account was deleted, so Bridge AI's relay doesn't carry it any more. ${OTHER}`,
    token: 'Bridge AI\'s relay needs this computer signed in to a Bold Bridge account that may use it (Settings › Account, on the computer). It connects again once it is.',
  }[why]
}

// A computer's id: 10 random base32 characters and 2 of checksum, an HMAC keyed with a secret of the
// relay's own (ID_SECRET), so only the relay can make a name that passes, and a made-up one is turned
// away here, without waking a Hub (but for one in 1,024). Ids made before the checksum was keyed don't
// pass any more (HOSTED.md, Settings).
let idKey = null // [the secret, its CryptoKey]
async function check(env, s) {
  if (idKey?.[0] !== env.ID_SECRET) idKey = [env.ID_SECRET, await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ID_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])]
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', idKey[1], new TextEncoder().encode(`bridge relay id ${s}`)))
  const v = ((h[0] << 8) | h[1]) >> 6
  return B32[v >> 5] + B32[v & 31]
}
async function newId(env) { const s = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => B32[b & 31]).join(''); return s + (await check(env, s)) }
const idOk = async (env, s) => /^[a-z2-7]{12}$/.test(s) && !RESERVED.has(s) && (await check(env, s.slice(0, 10))) === s.slice(10)

// The registry's counts for /_relay/stats: one day's, kept 35 days, with its busiest computers.
// limits.full: registrations turned away because MAX_ACCOUNTS accounts had a computer on it;
// limits.all: computers stopped because the whole relay reached RELAY_DAILY_REQUESTS (at ceilingAt);
// limits.shut: computers let go for sending on while stopped; limits.account: computers stopped for
// their account (suspended, no relay any more, deleted, or no relay token).
const KEEP_STATS_DAYS = 35
const TOP = 10
const blankDay = () => ({ registered: 0, refused: 0, computers: 0, connections: { computers: 0, phones: 0 }, messages: 0, bytes: 0, limits: { window: 0, week: 0, rate: 0, size: 0, phones: 0, full: 0, all: 0, shut: 0, account: 0 }, top: [], ceilingAt: null })
// What a day's counts come to in Cloudflare requests: incoming messages at 20 to 1 (and a tally
// to the registry and one to the account every 1,000), and about three for each connection or
// computer set up (the Worker, its Hub, and the tally or the registry). Keepalives aren't in it.
const requestsOf = (s) => Math.ceil(s.messages / 20 + s.messages / 500) + 3 * (s.connections.computers + s.connections.phones + s.registered + s.refused)
// Messages a computer may go on sending once its phones are stopped (they go nowhere), before its
// own connection is closed until they may go on: Cloudflare bills each one that arrives.
const HOST_SLACK = 1000
// What a connection the computer hasn't vouched for may send (and be sent) before it's closed
// (Hub.stranger): messages, bytes and milliseconds from its first message, and a bucket of its own
// (BURST at once, then RATE a second). A paired phone sends one or two before it's vouched for.
const STRANGER = { MSGS: 32, BYTES: 64 * 1024, MS: 20000, BURST: 16, RATE: 8 }

const hub = (env, id) => env.HUB.get(env.HUB.idFromName(id))
// A question for the registry (gate, left, tally, stats), and its answer.
const registry = (env, what, body) => hub(env, 'registry').fetch(`https://hub/_hosted/${what}`, body ? { method: 'POST', body: JSON.stringify(body) } : {}).then((r) => r.json())
// A word with an account's Account (check, tally, computer, left), and its answer.
const toAccount = (env, a, what, body) => env.ACCOUNT.get(env.ACCOUNT.idFromName(a)).fetch(`https://account/_account/${what}`, { method: 'POST', body: JSON.stringify({ ...body, a }) }).then((r) => r.json())
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const notFound = () => new Response('Not found', { status: 404 })
const REPORT_MS = 5 * 60000 // how often an Account reports its use while it's used
const STATUS_MS = 60000 // how long an Account keeps what the accounts service said

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

// An account's relay token (account/API.md, Tokens): base64url of { k: 'relay', a, d, iat, exp, kid }
// and its Ed25519 signature, checked here with the accounts service's public keys, with nothing asked
// of anyone. ACCOUNTS_PUBLIC_KEY holds one or more, comma separated, so the service's key can be
// changed (account/README.md, Changing the signing key): a token's kid says which signed it (the
// start of a hash of the key, as account/worker.js's keyId); one without a kid, from before tokens
// had one, is checked with the first. { ok, a, d } or { ok: false, why: none | forged | expired }.
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
let accountsKeys = null // [the setting, [{ kid, key }], in its order]
async function publicKeys(setting) {
  if (accountsKeys?.[0] !== setting) {
    const list = []
    for (const x of String(setting).split(',').map((s) => s.trim()).filter(Boolean)) {
      try { list.push({ kid: b64u(await crypto.subtle.digest('SHA-256', unb64(x))).slice(0, 8), key: await crypto.subtle.importKey('raw', unb64(x), { name: 'Ed25519' }, false, ['verify']) }) } catch { /* not a key: left out */ }
    }
    accountsKeys = [setting, list]
  }
  return accountsKeys[1]
}
async function relayToken(env, header) {
  const m = /^Bearer ([A-Za-z0-9_-]{10,800})\.([A-Za-z0-9_-]{86})$/.exec(String(header || ''))
  const keys = env.ACCOUNTS_PUBLIC_KEY ? await publicKeys(env.ACCOUNTS_PUBLIC_KEY) : []
  if (!m || !keys.length) return { ok: false, why: 'none' }
  let p = null
  try {
    p = JSON.parse(new TextDecoder().decode(unb64(m[1])))
    const k = p?.kid == null ? keys[0] : keys.find((x) => x.kid === p.kid)
    if (!k || !(await crypto.subtle.verify({ name: 'Ed25519' }, k.key, unb64(m[2]), new TextEncoder().encode(m[1])))) return { ok: false, why: 'forged' }
  } catch { return { ok: false, why: 'forged' } }
  if (p?.k !== 'relay' || !/^[a-z0-9]{12}$/.test(String(p.a)) || !/^[a-z0-9]{12}$/.test(String(p.d)) || !Number.isInteger(p.exp)) return { ok: false, why: 'forged' }
  if (p.exp * 1000 <= Date.now()) return { ok: false, why: 'expired' }
  return { ok: true, a: p.a, d: p.d }
}

async function hosted(req, env) {
  const url = new URL(req.url)
  const p = url.pathname
  const domain = String(env.HOSTED_DOMAIN || '').toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!domain) return new Response('HOSTED_DOMAIN isn\'t set', { status: 500 })
  if (!env.ID_SECRET) return new Response('ID_SECRET isn\'t set (HOSTED.md, Going live)', { status: 500 })
  const host = url.hostname.toLowerCase()
  if (host === domain) {
    if (p === '/_relay/register') return req.method === 'POST' ? register(req, env, url) : new Response('Use POST', { status: 405 })
    if (p === '/_relay/health') return health()
    if (p === '/_relay/stats') return stats(req, env, url)
    if (p === '/') return new Response(LANDING, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } })
    if (p === '/mark.svg') return page(req, url)
    return notFound()
  }
  const id = host.endsWith(`.${domain}`) ? host.slice(0, -domain.length - 1) : ''
  if (!(await idOk(env, id))) return notFound()
  const sock = p === '/_relay/host' || p === '/_relay/link'
  // Switched off: said before anything is asked of a Hub.
  const off = sock && req.headers.get('Upgrade') === 'websocket' ? offText(env, p === '/_relay/link') : null
  if (off) return refuse({ t: 'limit', why: 'off', text: off, until: Date.now() + 30 * 60000 }, 4009)
  if (!(await registered(env, id))) return notFound()
  if (sock) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
    return hub(env, id).fetch(req) // the Hub checks the computer's token, and its account
  }
  if (p === '/_relay/forget') return req.method === 'POST' ? hub(env, id).fetch(req) : new Response('Use POST', { status: 405 })
  if (p === '/_relay/health') return health()
  return page(req, url, domain)
}

// POST /_relay/register: Authorization: Bearer <relay token>, { version } in, { id, url, token } out.
// The token says which account and device this is: an account that may use the relay (asked of its
// Account, which asks the accounts service), and one address per device, so the same device
// registering again gets the same address back (with a new token). A device new to the relay is
// counted in by the registry (a Hub of its own, one request at a time, so the cap holds however many
// register at once): its account's first takes one of MAX_ACCOUNTS places. A refusal says why ({
// error, why }), and the app shows it.
const NO_TOKEN = {
  none: 'Bridge AI\'s relay needs this computer signed in to a Bold Bridge account that may use it (Settings › Account).',
  forged: 'That pass for Bridge AI\'s relay doesn\'t check out. Sign in to your Bold Bridge account again (Settings › Account).',
  expired: 'This computer\'s pass for Bridge AI\'s relay ran out. Bridge AI gets a new one from your Bold Bridge account by itself; try again in a minute.',
  removed: 'This computer isn\'t on your Bold Bridge account any more (it was removed, or signed out). Sign in again (Settings › Account).',
}
const FULL = 'Bridge AI\'s relay is full for now: it has as many accounts as it can take. Put a relay on your own Cloudflare account instead (it\'s free), or use Tailscale.'
async function register(req, env, url) {
  const off = offText(env)
  if (off) return json({ error: off, why: 'off' }, 503)
  if (Number(req.headers.get('Content-Length') || 0) > 4096) return json({ error: 'Too big' }, 413)
  // JSON only, so a web page elsewhere can't make your browser register computers (it would need
  // to ask first, and nothing here answers that).
  if (!/^application\/json\b/i.test(req.headers.get('Content-Type') || '')) return json({ error: 'Send JSON' }, 415)
  const t = await relayToken(env, req.headers.get('Authorization'))
  if (!t.ok) { count(env, '', 'refused', ['token']); return json({ error: NO_TOKEN[t.why], why: 'token', token: t.why }, 401) }
  let body = {}
  try { body = JSON.parse(await req.text()) } catch { /* nothing said */ }
  const v = version(body?.version)
  const acc = await toAccount(env, t.a, 'check', { d: t.d }).catch(() => null)
  if (!acc) return json({ error: 'Bridge AI\'s relay couldn\'t check your account just now. Try again in a minute.' }, 503)
  if (acc.refused) {
    count(env, '', 'refused', [acc.refused.why])
    // This device isn't on the account any more: its relay token, still good for days, isn't enough.
    if (acc.refused.why === 'token') return json({ error: NO_TOKEN.removed, why: 'token', token: 'removed' }, 401)
    return json({ error: limitText(acc.refused.why, limits(env), Date.now()), why: acc.refused.why }, 403)
  }
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const hash = await sha(token)
  const init = (id) => hub(env, id).fetch('https://hub/_hosted/init', { method: 'POST', body: JSON.stringify({ id, hash, version: v, a: t.a, d: t.d }) })
  const done = (id) => {
    known.set(id, { ok: true, until: Date.now() + 300000 })
    return json({ id, url: `${url.protocol}//${id}.${url.host}`, token })
  }
  // This device has an address here: the same one, with a new token.
  if (acc.id && (await idOk(env, acc.id)) && (await init(acc.id)).ok) { count(env, acc.id, 'register', [v, 'again']); return done(acc.id) }
  const lim = limits(env)
  for (let i = 0; i < 4; i++) {
    const id = await newId(env)
    if (RESERVED.has(id)) continue
    const gate = await registry(env, 'gate', { a: t.a, id, max: lim.accounts })
    if (gate.why === 'taken') continue // an id it has already (vanishingly unlikely): another
    if (!gate.ok) {
      count(env, '', 'refused', [gate.why])
      return json({ error: FULL, why: 'full' }, 503)
    }
    const r = await init(id)
    if (r.status === 201) {
      await toAccount(env, t.a, 'computer', { d: t.d, id }).catch(() => {})
      count(env, id, 'register', [v])
      return done(id)
    }
    await registry(env, 'left', { id }).catch(() => {}) // its place back (the registry's daily look finds it otherwise)
    if (r.status !== 409) break
  }
  return json({ error: 'Couldn\'t set up an address. Try again in a minute.' }, 500)
}

// For whoever runs it, behind a secret of its own (wrangler secret put): without one, the address
// isn't there at all (404); with a wrong one, 403.
async function admin(req, secret) {
  if (!secret) return notFound()
  return (await tokenOk(req.headers.get('Authorization'), secret)) ? null : json({ error: 'Not allowed' }, 403)
}

// GET /_relay/stats (STATS_TOKEN): the last days' counts, kept by the registry: computers set up,
// connections, messages and data, limits reached, and today's busiest computers by id, with what
// that comes to in Cloudflare requests, and how many accounts have a computer on it of how many it
// takes. Nothing about what passed through, or who. ?days=N (up to 35, default 7).
async function stats(req, env, url) {
  const no = await admin(req, env.STATS_TOKEN)
  if (no) return no
  const days = Math.min(35, Math.max(1, Number(url.searchParams.get('days')) || 7))
  const out = await registry(env, 'stats')
  return json({ ...advice(out.days, env), ...out, accounts: { on: out.accounts, max: limits(env).accounts }, days: out.days.slice(0, days) })
}

// What the counts mean for Cloudflare's bill (HOSTED.md, Cost): incoming messages are billed as
// requests at 20 to 1, and each connection is a request too. Keepalives aren't counted here (up to
// about 290 requests a day for each computer that stays connected), so the dashboard's figure is
// the exact one. On Workers Free, past 100,000 requests a day the relay stops for everyone until
// 00:00 UTC; Workers Paid includes a million a month, then $0.15 a million. RELAY_DAILY_REQUESTS
// stops the relay for the day before a day comes to more.
const FREE_REQUESTS = 100000
const PAID_INCLUDED = 1000000
function advice(days, env) {
  const today = days[0]?.requests || 0
  const month = utcDay().slice(0, 7)
  const monthRequests = days.filter((d) => d.day.startsWith(month)).reduce((a, d) => a + d.requests, 0)
  const paid = on(env.WORKERS_PAID)
  const note = paid
    ? monthRequests > PAID_INCLUDED ? `Past Workers Paid's included million requests this month: about $${(((monthRequests - PAID_INCLUDED) / 1e6) * 0.15).toFixed(2)} so far, before keepalives.` : 'Within Workers Paid\'s included million requests this month.'
    : today > FREE_REQUESTS / 2 ? 'Over half of Workers Free\'s 100,000 requests a day: move to Workers Paid ($5 a month) now. When Free runs out, the relay stops for everyone until 00:00 UTC.' : 'Within Workers Free\'s 100,000 requests a day. Move to Workers Paid before telling anyone, or once a day passes 50,000.'
  return { requests: { today, month: monthRequests, workers: paid ? 'paid' : 'free', ceiling: limits(env).dayRequests }, note }
}
const LANDING = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bridge AI relay</title><meta name="robots" content="noindex">
<style>:root{color-scheme:light dark;--bg:#fafaf9;--ink:#1c1917;--ink2:#57534e;--line:#e7e5e4}@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--ink:#f5f5f4;--ink2:#a8a29e;--line:#292524}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,sans-serif}main{max-width:460px;padding:32px 20px}h1{font-size:20px;margin:14px 0 8px}p{color:var(--ink2);margin:0 0 12px}a{color:inherit}</style></head>
<body><main><img src="/mark.svg" alt="" width="44" height="44"><h1>Bridge AI relay</h1>
<p>This relay lets Bridge AI on a phone reach Bridge AI on a computer, from anywhere. Everything between them is end-to-end encrypted, so the relay passes it on without being able to read it.</p>
<p>There's nothing to do here: Bridge AI sets it up for you (Settings › Devices), for a Bold Bridge account that may use it. To run your own relay instead, see <a href="https://github.com/sahil1/bridge">github.com/sahil1/bridge</a>.</p></main></body></html>`

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
        this.shutUntil = (await ctx.storage.get('shut')) || 0
        // What the registry and its Account hadn't heard yet, saved with the day (saveDay).
        this.pend = (await ctx.storage.get('pend')) || null
        this.acctPend = (await ctx.storage.get('acct')) || 0
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
      server.serializeAttachment({ at: Date.now() })
      await this.ctx.storage.put('seen', null)
      if (this.lim) await this.hostIn(server, req)
    } else {
      // The address is public, so anyone can connect; only your computer can tell a paired phone
      // (it says so with OK). When full, the oldest connection it hasn't vouched for makes room,
      // so strangers can't crowd out your phones.
      const phones = this.ctx.getWebSockets('phone')
      if (phones.length >= (this.lim?.phones ?? MAX_PHONES)) {
        const stranger = phones.map((w) => [w, w.deserializeAttachment() || {}]).filter(([, a]) => !a.ok).sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0]
        if (!stranger) return this.lim ? this.full() : new Response('Too many connections', { status: 429 })
        try { stranger[0].close(4004, 'make room') } catch { /* gone */ }
      }
      const id = crypto.getRandomValues(new Uint32Array(1))[0]
      this.ctx.acceptWebSocket(server, ['phone', `p${id}`])
      server.serializeAttachment({ id, at: Date.now() })
      if (this.lim) this.connected()
      const h = await this.live()
      // q: this relay keeps notes (older pages ignore it).
      server.send(JSON.stringify({ host: !!h, seen: (await this.ctx.storage.get('seen')) || null, q: 1 }))
      if (h) h.send(frame(OP.OPEN, id))
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, msg) {
    if (this.lim && !(await this.meter(ws, msg))) return
    if (this.ctx.getTags(ws).includes('host')) this.heardFrom(ws)
    if (typeof msg === 'string') return this.text(ws, msg) // keepalives are answered before here
    if (this.ctx.getTags(ws).includes('host')) {
      const b = new Uint8Array(msg)
      const id = new DataView(b.buffer, b.byteOffset).getUint32(1)
      const ph = this.ctx.getWebSockets(`p${id}`)[0]
      if (!ph) { if (b[0] !== OP.CLOSE) ws.send(frame(OP.CLOSE, id)); return }
      if (b[0] === OP.DATA) ph.send(b.subarray(5))
      else if (b[0] === OP.OK) this.vouch(ph)
      else if (b[0] === OP.CLOSE) try { ph.close(4003, 'closed by the computer') } catch { /* gone */ }
      return
    }
    const h = await this.live()
    const { id } = ws.deserializeAttachment() || {}
    if (h && id != null) h.send(frame(OP.DATA, id, msg))
    // Nowhere to go (the computer went, or went quiet): the phone hears so, rather than wait.
    else if (!h) ws.send(JSON.stringify({ host: false, seen: (await this.ctx.storage.get('seen')) || null }))
  }

  // When the computer was last heard on this connection: its last ping, what else it sent, or when
  // it connected. null where the runtime can't say when it last pinged: then it's never quiet.
  heard(w) {
    if (typeof this.ctx.getWebSocketAutoResponseTimestamp !== 'function') return null
    const a = w.deserializeAttachment() || {}
    return Math.max(this.ctx.getWebSocketAutoResponseTimestamp(w)?.getTime() || 0, a.heard || 0, a.at || 0)
  }

  // Something from the computer (kept on its connection every few seconds at most).
  heardFrom(w) {
    const a = w.deserializeAttachment() || {}
    if (Date.now() - (a.heard || 0) > 5000) w.serializeAttachment({ ...a, heard: Date.now() })
  }

  // The computer's connection, unless it's gone quiet: then it's let go, and phones hear it's offline.
  async live() {
    const h = this.host()
    const at = h && this.heard(h)
    if (!at || Date.now() - at < QUIET_MS) return h
    h.serializeAttachment({ ...h.deserializeAttachment(), quiet: true })
    try { h.close(4006, 'quiet') } catch { /* gone */ }
    await this.offline(at)
    return this.host()
  }

  // The computer's gone: phones hear so, and since when.
  async offline(seen) {
    await this.ctx.storage.put('seen', seen)
    for (const ph of this.ctx.getWebSockets('phone')) try { ph.send(JSON.stringify({ host: false, seen })) } catch { /* gone */ }
  }

  async webSocketClose(ws, code) {
    await this.gone(ws, code)
    if (this.lim && this.day) {
      await this.saveDay(true)
      // (A stranger's connection ending waits for the next tally: connected(), below.)
      if (this.ctx.getTags(ws).includes('host') || ws.deserializeAttachment()?.ok) this.tally()
      this.tallyAccount()
    }
  }

  // The computer vouched for a connection (OK): one of its paired phones or tabs, never the one
  // dropped to make room. On the hosted relay, from then on it's metered as its account's, and its
  // connection goes to the registry (meter, connected).
  vouch(ws) {
    const a = ws.deserializeAttachment() || {}
    if (a.ok) return
    ws.serializeAttachment({ ...a, ok: true })
    if (this.lim) this.tally()
  }

  async webSocketError(ws) {
    await this.gone(ws, 1011)
  }

  async gone(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye') } catch { /* already closed */ }
    if (this.lim && !this.meta) return // removed (hosted): nothing to keep
    if (this.ctx.getTags(ws).includes('host')) {
      // A newer connection took over, or this one was let go as quiet (phones heard then).
      if (this.host(ws) || ws.deserializeAttachment()?.quiet) return
      await this.offline(Date.now())
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
      if (this.lim) await this.phoneIn(ws, m.box)
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
  // at, v, a (its account), d (its device) }, last (when its computer last connected), day { d,
  // bytes, msgs } (today's use, UTC, for the counts), shut (until when its computer is turned away for
  // sending on past its account's limits) and wk (which of its paired phones were counted this week,
  // by box). Its account's use is the Account's (below), which it tells what it carried and asks
  // whether to go on. The registry is a Hub of its own and keeps only s:<day>, each day's counts for
  // /_relay/stats (35 days), and c:<id>, each registered computer's id with its account, when it
  // registered and the last day it was in use (for MAX_ACCOUNTS).
  async gate(req, url) {
    const p = url.pathname
    if (p === '/_hosted/check') return new Response(null, { status: this.meta ? 204 : 404 })
    if (p === '/_hosted/gate') return this.admit(await req.json())
    if (p === '/_hosted/left') return this.left(await req.json())
    if (p === '/_hosted/tally') return this.tallied(await req.json())
    if (p === '/_hosted/stats') return this.statsOf()
    if (p === '/_hosted/init') {
      const { id, hash, version: v, a, d } = await req.json()
      if (this.meta && (this.meta.a !== a || this.meta.d !== d)) return new Response('Taken', { status: 409 })
      // The same device registering again: the same address, with a new token (the old one stops
      // working, and its connection is let go).
      const again = !!this.meta
      this.meta = { ...(this.meta || { id, at: Date.now() }), hash, v, a, d }
      await this.ctx.storage.put('meta', this.meta)
      if (again) for (const w of this.ctx.getWebSockets('host')) try { w.close(4000, 'replaced') } catch { /* gone */ }
      else await this.ctx.storage.setAlarm(Date.now() + this.lim.idleDays * DAY)
      return new Response(again ? 'Again' : 'Created', { status: again ? 200 : 201 })
    }
    if (!this.meta) return notFound()
    // From its Account: a limit reached, or lifted, or the account itself stopped.
    if (p === '/_hosted/account') { this.acctSaid(await req.json()); return new Response(null, { status: 204 }) }
    if (p === '/_hosted/remove') {
      count(this.env, this.meta.id, 'removed', ['account'])
      await this.remove(4008, 'account deleted')
      return new Response(null, { status: 204 })
    }
    if (p === '/_relay/forget') {
      if (!(await this.tokenOk(req))) return new Response('Not allowed', { status: 403 })
      count(this.env, this.meta.id, 'removed', ['forget'])
      await this.remove(4007, 'removed')
      return new Response(null, { status: 204 })
    }
    if (p === '/_relay/host') {
      if (!(await this.tokenOk(req))) return new Response('Not allowed', { status: 403 })
      // ...and a relay token from its account and its device, not past its end (Bridge AI sends a
      // fresh one each time), the device still on the account (askAccount).
      const t = await relayToken(this.env, `Bearer ${req.headers.get('X-Relay-Token') || ''}`)
      if (!t.ok || t.a !== this.meta.a || (t.d !== this.meta.d && !(await this.moved(t.d)))) { this.limited('token'); return refuse(this.limit('token'), 4009) }
      const s = await this.askAccount('check')
      if (s.refused) return refuse(this.limit(s.refused.why), 4009)
      // Let go for sending on past its account's limits: told so again, with when.
      return this.shutUntil > Date.now() ? refuse(this.limit('shut'), 4005) : null
    }
    if (p === '/_relay/link') {
      if (!this.acct || Date.now() - this.acct.at > 60000) await this.askAccount('check')
      const why = this.blocked()
      return why ? refuse(this.limit(why), 4005) : null
    }
    return notFound()
  }

  // This computer signed in to its account again, so it's another device there now: its address goes
  // with it if its Account says the device it was made for is off the account, and the new one is on
  // it with no address of its own here. Otherwise it's turned away.
  async moved(d) {
    const r = await toAccount(this.env, this.meta.a, 'move', { d: this.meta.d, to: d, id: this.meta.id }).catch(() => null)
    if (!r?.ok) return false
    this.meta = { ...this.meta, d }
    await this.ctx.storage.put('meta', this.meta)
    return true
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

  // The computer connected: it hears its account's use (Settings shows it), and that phones are
  // stopped for now if they are.
  async hostIn(ws, req) {
    count(this.env, this.meta.id, 'computer', [version(req.headers.get('X-Bridge-Version'))])
    await this.ctx.storage.put('last', Date.now())
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + this.lim.idleDays * DAY)
    if (this.use) { ws.send(JSON.stringify({ t: 'use', ...this.use })); this.useSent = Date.now() }
    this.pendOf(this.today().d).computers++
    this.tally()
    const why = this.blocked()
    if (why) ws.send(JSON.stringify(this.limit(why)))
  }

  // ---------- its account ----------
  // Its Account asked (check), or told what this computer carried since (tally, n messages); what it
  // says is acted on. Not answering (it's being deployed, say): this carries on as it was, and the
  // count goes with the next.
  async askAccount(what, n = 0) {
    try {
      const s = await toAccount(this.env, this.meta.a, what, { d: this.meta.d, id: this.meta.id, n })
      this.acctSaid(s)
      return s
    } catch {
      if (n) this.acctPend = (this.acctPend || 0) + n
      return {}
    }
  }
  tallyAccount() {
    const n = this.acctPend || 0
    if (!n || !this.meta?.a) return
    this.acctPend = 0
    this.acctAt = Date.now()
    this.ctx.storage.put('acct', 0).catch(() => {}) // (saved as told, so a Hub woken again doesn't tell it twice)
    this.askAccount('tally', n)
  }
  // What the Account said: { refused: { why } } (suspended, no relay, deleted), { limit: { why, until } }
  // (its window or week used up), left (messages to go), use (for the computer's Settings).
  acctSaid(s) {
    const now = Date.now()
    const why = s?.refused?.why || s?.limit?.why || null
    const was = this.acct?.why || null
    this.acct = { why, until: s?.refused ? now + REFUSED_MS : s?.limit?.until || 0, left: Number.isFinite(s?.left) ? s.left : null, at: now }
    const h = this.host()
    // Its computer hears the account's use: at a limit, when one is lifted, and once a minute at most.
    if (s?.use) {
      this.use = s.use
      if (h && (why !== was || !this.useSent || now - this.useSent > 60000)) { try { h.send(JSON.stringify({ t: 'use', ...s.use })) } catch { /* gone */ } this.useSent = now }
    }
    if (why && this.told !== why) this.stopPhones(why).catch(() => {})
    else if (!why && this.told && this.told !== 'all') this.told = null // reset, or raised
  }

  // A phone said which it is: if it's one of this computer's paired phones (its box on the list the
  // computer gave), it's vouched for by that, as by OK, and counted once a week.
  async phoneIn(ws, box) {
    const st = this.ctx.storage
    if (!(await st.get('roster'))?.includes(box)) return
    this.vouch(ws)
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
      if (this.day && this.pend?.d === this.day.d) this.tally(this.day) // the day that ended, with its totals
      this.day = { d, bytes: 0, msgs: 0, sb: 0, sm: 0 } // sb, sm: how much of it is saved (and counted)
    }
    return this.day
  }

  // What stops this computer's phones for now: its account's limits ('window', 'week'), the account
  // itself ('suspended', 'relay', 'deleted'), or the whole relay's day ('all', RELAY_DAILY_REQUESTS,
  // which the registry says in answer to a tally). Until when.
  blocked(now = Date.now()) {
    const a = this.acct
    if (a?.why && a.until > now) return a.why
    return this.today(now).capped ? 'all' : null
  }
  blockedUntil(now = Date.now()) { const a = this.acct; return a?.why && a.until > now ? a.until : nextDay(now) }

  // Saved every 100 messages or 256 KB, and when a connection ends, with what the registry and its
  // Account haven't heard yet (pend, acctPend): in between it's only in memory, so a Hub put to sleep
  // (as it is whenever nothing passes for a few seconds) forgets at most that much.
  async saveDay(force) {
    const d = this.day
    const more = d && (d.bytes !== d.sb || d.msgs !== d.sm)
    if (!d || (!more && !(force && this.unsaved))) return
    if (!force && d.bytes - d.sb < 262144 && d.msgs - d.sm < 100) return
    if (more) count(this.env, this.meta?.id, 'usage', [], [d.bytes - d.sb, d.msgs - d.sm])
    d.sb = d.bytes
    d.sm = d.msgs
    this.unsaved = false
    await this.ctx.storage.put({ day: d, pend: this.pend || null, acct: this.acctPend || 0 })
  }

  // This computer's use since its last tally, for the registry's counts (/_relay/stats): sent when
  // its computer connects, when it vouches for a phone, with a limit reached, every 1,000 messages,
  // 4 MB or 100 connections, and when the computer's or a paired phone's connection ends. A
  // stranger's connection goes with the next of those, never on its own, so connecting over and over
  // doesn't each time ask the registry, the one Hub for the whole relay. Saved with the day (saveDay)
  // until it's sent, so the counts can come out a little low, never high. Counting never gets in the
  // way: a tally that doesn't arrive is let go.
  pendOf(d) {
    if (this.pend && this.pend.d !== d) this.tally()
    return (this.pend ||= { d, msgs: 0, bytes: 0, computers: 0, phones: 0, limits: {} })
  }

  // A phone connected (or anyone at all: it's vouched for later, if it is).
  connected() {
    const p = this.pendOf(this.today().d)
    p.phones++
    this.unsaved = true
    if (p.phones >= 100) this.tally()
  }

  tally(day = this.day) {
    const p = this.pend
    if (!p || !this.meta) return
    this.pend = null
    const mine = day?.d === p.d ? day : null
    const first = !!mine && !mine.tallied // its first today: one more computer in use today
    if (first) mine.tallied = true
    // (Saved as sent, so a Hub woken again doesn't send it twice.)
    this.ctx.storage.put({ pend: null, ...(first ? { day: mine } : {}) }).catch(() => {})
    const total = mine && { msgs: mine.msgs, bytes: mine.bytes }
    const body = { d: p.d, id: this.meta.id, a: this.meta.a, msgs: p.msgs, bytes: p.bytes, computers: p.computers, phones: p.phones, limits: p.limits, first, total }
    // The answer says whether the whole relay has reached RELAY_DAILY_REQUESTS today.
    registry(this.env, 'tally', body).then((a) => (a?.over ? this.ceiling(p.d) : null)).catch(() => {})
  }

  // The whole relay reached its ceiling for the day: as at its account's limits, this computer's
  // phones are let go until 00:00 UTC, and its computer is told and stays connected for then.
  async ceiling(d) {
    const day = this.today()
    if (day.d !== d || day.capped || !this.meta) return
    day.capped = true
    await this.ctx.storage.put('day', day)
    if (!this.told) await this.stopPhones('all')
  }

  // Each message in: counted (for the day, and towards its account's allowance), and turned away if
  // it's too big, too many at once, or its phones are stopped for now. A phone's own is turned away by
  // closing that phone; so is a computer's message for a phone (its link can't carry on with a piece
  // missing). The computer's own text messages (about notes) only count. A computer that sends on
  // regardless is let go until then (dropped below). A connection the computer hasn't vouched for has
  // an allowance of its own (stranger, below), and costs its account nothing.
  async meter(ws, msg) {
    const now = Date.now()
    const size = typeof msg === 'string' ? msg.length : msg.byteLength
    const fromHost = this.ctx.getTags(ws).includes('host')
    const day = this.today(now)
    day.bytes += size
    day.msgs++
    const pend = this.pendOf(day.d)
    pend.bytes += size
    if (++pend.msgs >= 1000 || pend.bytes >= 4194304) this.tally()
    const housekeeping = fromHost && typeof msg === 'string'
    const phone = !fromHost ? ws : !housekeeping && size >= 5 ? this.ctx.getWebSockets(`p${new DataView(msg).getUint32(1)}`)[0] : null
    // A stranger's message, or the computer's data for one (its answer to a hello: OK and CLOSE are
    // the computer's own say).
    if (phone && !phone.deserializeAttachment()?.ok && (!fromHost || new Uint8Array(msg)[0] === OP.DATA)) return this.stranger(phone, size, now)
    // Its account hears every 1,000 messages, every 3 minutes while any pass (so a suspension is
    // heard then too), and more often as the allowance runs low, so its other computers' use counts.
    this.acctPend = (this.acctPend || 0) + 1
    if (this.acctPend >= Math.max(1, Math.min(1000, Math.floor((this.acct?.left ?? 10000) / 10))) || now - (this.acctAt || 0) > 180000) this.tallyAccount()
    // For a phone that's just been let go: nowhere to go (its computer hears it's gone).
    if (fromHost && phone && phone.readyState !== 1) return false
    if (!housekeeping && size > this.lim.messageKB * 1024) return this.cut(phone, 'size', now + 5000)
    this.tokens = Math.min(this.lim.burst, (this.tokens ?? this.lim.burst) + ((now - (this.tokAt ?? now)) * this.lim.rate) / 1000)
    this.tokAt = now
    if (!housekeeping && this.tokens < 1) return this.cut(phone, 'rate', now + 10000)
    this.tokens--
    const why = this.blocked(now)
    if (why) {
      if (this.told !== why) await this.stopPhones(why)
      return housekeeping || this.dropped(fromHost)
    }
    if (this.told) this.told = null // reset, or raised, since
    this.drops = 0
    await this.saveDay()
    return true
  }

  // A connection the computer hasn't vouched for: anyone with the address can connect, so as far as
  // the relay can tell it's a stranger's until the computer says otherwise (vouch). It has STRANGER's
  // allowance, its own (its messages and the computer's to it, from its first, and a bucket of its
  // own), never its account's or the computer's MESSAGES_PER_SECOND. Past any of it, it's closed:
  // the computer hears only that it closed, nothing is said, and nothing is counted as a limit (a
  // paired phone is vouched for with its first message or two, so it never gets here).
  async stranger(ws, size, now) {
    if (ws.readyState !== 1) return false
    const a = ws.deserializeAttachment() || {}
    const s = a.s || { n: 0, b: 0, at: now, tk: STRANGER.BURST, t: now }
    const tk = Math.min(STRANGER.BURST, s.tk + ((now - s.t) * STRANGER.RATE) / 1000)
    const next = { n: s.n + 1, b: s.b + size, at: s.at, tk: tk - 1, t: now }
    if (next.n > STRANGER.MSGS || next.b > STRANGER.BYTES || now - s.at > STRANGER.MS || tk < 1) {
      try { ws.close(4005, 'not vouched for') } catch { /* gone */ }
      try { if (a.id != null) this.host()?.send(frame(OP.CLOSE, a.id)) } catch { /* gone */ }
      return false
    }
    ws.serializeAttachment({ ...a, s: next })
    await this.saveDay()
    return true
  }

  // A message from the computer while its phones are stopped, which goes nowhere. Cloudflare bills
  // each one that arrives all the same, so past HOST_SLACK of them the computer's connection is
  // closed, and turned away until they may go on (saying so). Bridge AI sends next to none then: its
  // phones were let go. (Too big and too much at once count too, so they end here as well.) Always
  // false: the message isn't passed on.
  async dropped(fromHost) {
    if (!fromHost) return false
    this.drops = (this.drops || 0) + 1
    if (this.drops <= HOST_SLACK || this.shutUntil > Date.now()) return false
    this.shutUntil = this.blockedUntil()
    this.drops = 0
    await this.ctx.storage.put('shut', this.shutUntil)
    this.limited('shut')
    const h = this.host()
    if (h) try { h.send(JSON.stringify(this.limit('shut'))); h.close(4005, 'limit') } catch { /* gone */ }
    return false
  }

  // What a phone is told at a limit (and the computer, for its account's), with when it can carry on.
  limit(why, until) {
    const now = Date.now()
    const end = why === 'shut' ? Math.max(this.shutUntil || 0, now) : ['window', 'week', 'all'].includes(why) ? this.blockedUntil(now) : ACCOUNT_WHY.has(why) ? now + REFUSED_MS : until
    return { t: 'limit', why, text: limitText(why, this.lim, end), until: end }
  }

  // ...and what the computer is told when one of its phones was turned away (Settings shows it).
  tellHost(why, until) {
    const l = this.lim
    const text = {
      rate: 'A phone sent more at once than Bridge AI\'s relay takes, so it was disconnected for a few seconds. It connects again by itself.',
      size: `A message between a phone and this computer was over ${l.messageKB} KB, more than Bridge AI's relay takes at once, so that phone was disconnected. It connects again by itself.`,
      phones: `A phone was turned away: Bridge AI's relay takes ${l.phones} connections to this computer at once, and that many paired phones and tabs were connected. Close Bridge AI on one you're not using.`,
    }[why]
    try { this.host()?.send(JSON.stringify({ t: 'limit', why, text, until })) } catch { /* gone */ }
  }

  limited(why) {
    count(this.env, this.meta.id, 'limit', [why])
    const p = this.pendOf(this.today().d)
    const k = ACCOUNT_WHY.has(why) ? 'account' : why
    p.limits[k] = (p.limits[k] || 0) + 1
    this.tally()
  }

  cut(ws, why, until) {
    if (ws?.readyState !== 1) return false
    this.limited(why)
    try { ws.send(JSON.stringify(this.limit(why, until))); ws.close(4005, 'limit') } catch { /* gone */ }
    this.tellHost(why, until)
    return false
  }

  // Every connection to this computer is a paired phone's or tab's, as many as the relay takes at
  // once: this one is turned away, saying so, and the computer hears it too.
  full() {
    const until = Date.now() + 60000
    this.limited('phones')
    this.tellHost('phones', until)
    return refuse(this.limit('phones', until), 4005)
  }

  // Its phones are stopped for now (its account's window or week used up, or the whole relay's day):
  // both ends hear so, phones are let go until then, and the computer stays connected (quietly),
  // ready for then. The account itself stopped (suspended, no relay any more, deleted): the computer
  // is let go too, and waits before it tries again.
  async stopPhones(why) {
    this.told = why
    await this.saveDay(true)
    this.limited(why)
    const m = JSON.stringify(this.limit(why))
    const all = ACCOUNT_WHY.has(why)
    for (const w of this.ctx.getWebSockets()) try { w.send(m); if (all || !this.ctx.getTags(w).includes('host')) w.close(all ? 4009 : 4005, 'limit') } catch { /* gone */ }
  }

  // Forgotten by its computer, not seen for IDLE_DAYS, or its account deleted: everything this Hub
  // kept goes, and the registry and its Account count one computer fewer.
  async remove(code, why) {
    const all = this.ctx.getWebSockets()
    const { id, a, d } = this.meta || {}
    this.meta = null
    this.day = null
    this.pend = null
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    for (const w of all) try { w.close(code, why) } catch { /* gone */ }
    // If this doesn't arrive, the registry's daily look finds it gone.
    if (id) await registry(this.env, 'left', { id }).catch(() => {})
    if (id && a) await toAccount(this.env, a, 'left', { d, id }).catch(() => {})
  }

  // ---------- the registry ----------
  // The accounts with a computer registered, and how many each: from its c:<id> entries, counted once
  // each time the registry starts and kept in step after that (one request at a time, so it can't
  // miss one).
  async counted() {
    if (!this.accts) {
      this.accts = new Map()
      for (const c of (await this.ctx.storage.list({ prefix: 'c:' })).values()) if (c.a) this.accts.set(c.a, (this.accts.get(c.a) || 0) + 1)
    }
    return this.accts
  }

  // A computer registering (register() above): turned away when it's the first of an account and
  // MAX_ACCOUNTS accounts have one already, otherwise counted in, under the id it's about to get.
  async admit({ a, id, max }) {
    const st = this.ctx.storage
    if (!/^[a-z2-7]{12}$/.test(String(id)) || !/^[a-z0-9]{12}$/.test(String(a))) return json({ ok: false, why: 'bad' }, 400)
    if (await st.get(`c:${id}`)) return json({ ok: false, why: 'taken' })
    const day = utcDay()
    const s = (await st.get(`s:${day}`)) || blankDay()
    const accts = await this.counted()
    const why = !accts.has(a) && accts.size >= max ? 'full' : null
    if (why) { s.refused++; s.limits.full = (s.limits.full || 0) + 1 } else s.registered++
    await st.put({ ...(why ? {} : { [`c:${id}`]: { a, at: Date.now(), seen: day } }), [`s:${day}`]: s, registry: true })
    if (!why) accts.set(a, (accts.get(a) || 0) + 1)
    if (!(await st.getAlarm())) await st.setAlarm(nextDay() + 60000)
    return json(why ? { ok: false, why } : { ok: true })
  }

  // A computer removed (its Hub's remove(), or a registration that didn't finish): one fewer, and an
  // account with none left counts no more.
  async left({ id }) {
    const st = this.ctx.storage
    const c = await st.get(`c:${String(id)}`)
    if (c) {
      await st.delete(`c:${id}`)
      if (this.accts && c.a) { const n = (this.accts.get(c.a) || 1) - 1; if (n > 0) this.accts.set(c.a, n); else this.accts.delete(c.a) }
    }
    return json({ ok: true })
  }

  // A computer's tally (tally() above), added to its day's counts; the day's busiest computers by
  // id kept beside them. The answer says whether the whole relay is past RELAY_DAILY_REQUESTS today.
  async tallied(t) {
    if (!/^\d{4}-\d\d-\d\d$/.test(String(t?.d))) return json({ ok: false }, 400)
    const st = this.ctx.storage
    const k = `s:${t.d}`
    const s = (await st.get(k)) || blankDay()
    const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)
    s.messages += n(t.msgs)
    s.bytes += n(t.bytes)
    s.connections.computers += n(t.computers)
    s.connections.phones += n(t.phones)
    if (t.first) s.computers++
    for (const w of Object.keys(blankDay().limits)) s.limits[w] = (s.limits[w] || 0) + n(t.limits?.[w])
    const valid = /^[a-z2-7]{12}$/.test(String(t.id))
    if (t.total && valid) {
      const top = s.top.filter((x) => x.id !== t.id)
      if (top.length < TOP || n(t.total.msgs) > top[top.length - 1].messages) {
        top.push({ id: t.id, messages: n(t.total.msgs), bytes: n(t.total.bytes) })
        s.top = top.sort((a, b) => b.messages - a.messages).slice(0, TOP)
      } else s.top = top
    }
    if (t.d === utcDay() && !s.ceilingAt && requestsOf(s) >= this.lim.dayRequests) s.ceilingAt = Date.now()
    // In use today: the day it was last seen (and counted, if it somehow wasn't).
    const c = t.first && valid ? await st.get(`c:${t.id}`) : null
    if (t.first && valid && c?.seen !== t.d) {
      const a = c?.a || (/^[a-z0-9]{12}$/.test(String(t.a)) ? t.a : null)
      if (!c && a && this.accts) this.accts.set(a, (this.accts.get(a) || 0) + 1)
      await st.put(`c:${t.id}`, { a, at: c?.at || Date.now(), seen: t.d })
    }
    await st.put({ [k]: s, registry: true })
    if (!(await st.getAlarm())) await st.setAlarm(nextDay() + 60000)
    return json({ ok: true, over: t.d === utcDay() && !!s.ceilingAt })
  }

  // The last 35 days' counts, today first, each with what it comes to in Cloudflare requests
  // (requestsOf), and how many computers and accounts are registered.
  async statsOf() {
    const st = this.ctx.storage
    const days = []
    for (let i = 0; i < KEEP_STATS_DAYS; i++) {
      const day = utcDay(Date.now() - i * DAY)
      const s = (await st.get(`s:${day}`)) || blankDay()
      days.push({ day, ...s, requests: requestsOf(s) })
    }
    return json({ days, computers: (await st.list({ prefix: 'c:' })).size, accounts: (await this.counted()).size })
  }

  async hostedAlarm() {
    const st = this.ctx.storage
    if (await st.get('registry')) { // the registry: stats after 35 days go
      const keep = `s:${utcDay(Date.now() - (KEEP_STATS_DAYS - 1) * DAY)}`
      const old = [...(await st.list({ prefix: 's:' })).keys()].filter((k) => k < keep)
      for (let i = 0; i < old.length; i += 128) await st.delete(old.slice(i, i + 128))
      await this.sweep()
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

  // Once a day, the registry asks each computer it counts that hasn't been in use for two days
  // whether its Hub is still there: one removed without the registry hearing (left() didn't arrive)
  // stops counting (and its account, with none left, against MAX_ACCOUNTS). 200 a day at most (one
  // request each), those asked longest ago first.
  async sweep() {
    const st = this.ctx.storage
    const quiet = utcDay(Date.now() - 2 * DAY)
    const ask = [...(await st.list({ prefix: 'c:' }))].filter(([, c]) => c.seen < quiet).sort(([, a], [, b]) => ((a.asked || '') < (b.asked || '') ? -1 : 1)).slice(0, 200)
    for (const [k] of ask) {
      const r = await hub(this.env, k.slice(2)).fetch('https://hub/_hosted/check').catch(() => null)
      if (r?.status === 404) await this.left({ id: k.slice(2) })
      else if (r?.status === 204) {
        // (As it is now: it may have been used, or removed, while the Hub was asked.)
        const c = await st.get(k)
        if (c) await st.put(k, { ...c, asked: utcDay() })
      }
    }
  }
}

// ---------- Bridge AI's hosted relay: one account ----------
// One per account (the ACCOUNT binding, idFromName(a)): its use in its 8-hour window and its week,
// across its computers; the relay address of each of its devices (one each); and what the accounts
// service last said of it. Its Hubs tell it what they carried and ask it whether to go on, and it
// tells them all at once when a limit is reached or the account is stopped. It reports its use to
// the accounts service (the ACCOUNTS service binding) every few minutes while it's used, and asks
// about the account at most once a minute: a suspension is heard within a minute of its next use.
// Kept, as s: { a, first (its first message ever, which its weeks start from), win { start, msgs },
// week { start, msgs }, days { day: msgs } (the last few, for the accounts service), last (its last
// use), computers { device: computer id }, status { status, relay, at }, devs { device: { on, at } }
// (whether each device asking is still on the account), told }.
export class Account {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
    this.lim = limits(env)
    ctx.blockConcurrencyWhile(async () => { this.s = (await ctx.storage.get('s')) || null })
  }

  async fetch(req) {
    const p = new URL(req.url).pathname
    let b = {}
    try { b = await req.json() } catch { /* nothing said */ }
    if (!/^[a-z0-9]{12}$/.test(String(b?.a))) return json({ error: 'No account' }, 400)
    this.s ||= { a: b.a, first: null, win: null, week: null, days: {}, last: null, computers: {}, status: null, told: null }
    const s = this.s
    if (p === '/_account/computer') { s.computers[b.d] = b.id; await this.save(); return json({ ok: true }) }
    if (p === '/_account/left') { if (s.computers[b.d] === b.id) delete s.computers[b.d]; if (s.first != null || Object.keys(s.computers).length) await this.save(); else { this.s = null; await this.ctx.storage.delete('s') } return json({ ok: true }) }
    if (p === '/_account/check' || p === '/_account/tally') return json(await this.answer(b))
    if (p === '/_account/move') return json(await this.move(b))
    return notFound()
  }

  // What a Hub (or a computer registering) is told: refused { why } (the account is suspended, has no
  // relay any more, or was deleted; or 'token', the device asking isn't on it any more), limit { why,
  // until } (its window or week used up), left (messages to go), use, and the address of the device
  // asking, if it has one.
  async answer(b) {
    const s = this.s
    const now = Date.now()
    const n = Math.max(0, Math.floor(Number(b.n) || 0))
    if (n) this.add(n, now)
    const out = this.said(now, await this.status(now, b.d), b.id || null)
    if (n) await this.reportSoon()
    await this.save()
    // A device removed from the account (or signed out there) is turned away on its own, as a computer
    // without a relay token is, the next time it asks: not when its relay token ends, days later.
    if (!out.refused && this.offAccount(b.d)) return { ...out, refused: { why: 'token' }, id: null }
    return { ...out, id: s.computers[b.d] || null }
  }

  // A computer signed in again as a new device (to): its address moves to it (Hub.moved), only when
  // the device it was made for (d) is off the account, the new one is on it, and has no other address.
  async move(b) {
    const s = this.s
    const now = Date.now()
    const to = String(b.to || '')
    if (!/^[a-z0-9]{12}$/.test(to) || !/^[a-z2-7]{12}$/.test(String(b.id))) return { ok: false }
    await this.status(now, b.d)
    await this.status(now, to)
    const ok = this.offAccount(b.d) && s.devs?.[to]?.on === true && (!s.computers[to] || s.computers[to] === b.id)
    if (ok) {
      if (s.computers[b.d] === b.id) delete s.computers[b.d]
      s.computers[to] = b.id
      await this.save()
    }
    return { ok }
  }
  offAccount(d) { return !!d && this.s.devs?.[d]?.on === false }

  // The answer for now, and its other computers told at once when it changed.
  said(now, st, except = null) {
    const s = this.s
    const refused = st.status === 'suspended' ? 'suspended' : st.status === 'gone' ? 'deleted' : st.relay && st.relay !== 'approved' ? 'relay' : null
    const over = refused ? null : this.over(now)
    const out = { ...(refused ? { refused: { why: refused } } : {}), ...(over ? { limit: over } : {}), left: this.left(now), use: this.use(now) }
    const told = refused || over?.why || null
    if (told !== s.told) {
      s.told = told
      for (const id of new Set(Object.values(s.computers))) if (id !== except) hub(this.env, id).fetch('https://hub/_hosted/account', { method: 'POST', body: JSON.stringify(out) }).catch(() => {})
    }
    return out
  }

  // What the accounts service says of the account, and of the device asking (d: whether it's still
  // on the account), each asked at most once a minute. Can't ask just now: what it said last stands a
  // little longer, or it's let through (its tokens say it was allowed).
  async status(now, d = null) {
    const s = this.s
    d = /^[a-z0-9]{12}$/.test(String(d)) ? String(d) : null
    const dev = d && s.devs?.[d]
    if (s.status && now - s.status.at < STATUS_MS && (!d || (dev && now - dev.at < STATUS_MS))) return s.status
    if (!this.env.ACCOUNTS) return (s.status = { status: 'active', relay: 'approved', at: now })
    s.devs = Object.fromEntries(Object.entries(s.devs || {}).filter(([, v]) => now - v.at < DAY))
    try {
      const r = await this.env.ACCOUNTS.fetch(`https://accounts/internal/status?a=${s.a}${d ? `&d=${d}` : ''}`)
      if (!r.ok) throw new Error(`answered ${r.status}`)
      const j = await r.json()
      s.status = { status: String(j.status), relay: j.relay || null, at: now }
      if (d) s.devs[d] = { on: typeof j.device === 'boolean' ? j.device : null, at: now }
    } catch {
      s.status = { status: 'active', relay: 'approved', ...s.status, at: now - STATUS_MS + 15000 }
      if (d) s.devs[d] = { on: dev?.on ?? null, at: now - STATUS_MS + 15000 }
    }
    return s.status
  }

  add(n, now) {
    const s = this.s
    s.first ??= now
    s.last = now
    if (!s.win || now >= s.win.start + this.lim.windowHours * HOUR) s.win = { start: now, msgs: 0 } // from the first message after the last window ended
    s.win.msgs += n
    s.week = this.weekOf(now)
    s.week.msgs += n
    const d = utcDay(now)
    s.days[d] = (s.days[d] || 0) + n
    for (const k of Object.keys(s.days)) if (k < utcDay(now - 3 * DAY)) delete s.days[k]
  }
  // The week now: weeks run on from the account's first use, a week at a time.
  weekOf(now) {
    const s = this.s
    if (s.first == null) return { start: null, msgs: 0 }
    const start = s.first + Math.floor((now - s.first) / (7 * DAY)) * 7 * DAY
    return s.week?.start === start ? s.week : { start, msgs: 0 }
  }
  over(now) {
    const l = this.lim
    const wk = this.weekOf(now)
    const w = this.s.win
    if (wk.start != null && wk.msgs > l.weekMessages) return { why: 'week', until: wk.start + 7 * DAY }
    if (w && now < w.start + l.windowHours * HOUR && w.msgs > l.windowMessages) return { why: 'window', until: w.start + l.windowHours * HOUR }
    return null
  }
  left(now) {
    const l = this.lim
    const w = this.s.win
    const inWindow = w && now < w.start + l.windowHours * HOUR ? w.msgs : 0
    return Math.max(0, Math.min(l.windowMessages - inWindow, l.weekMessages - this.weekOf(now).msgs))
  }
  // Its use, as the computer's Settings and the accounts service show it.
  use(now) {
    const l = this.lim
    const w = this.s.win
    const live = w && now < w.start + l.windowHours * HOUR
    const wk = this.weekOf(now)
    return {
      window: { messages: live ? w.msgs : 0, limit: l.windowMessages, hours: l.windowHours, resetsAt: live ? w.start + l.windowHours * HOUR : null },
      week: { messages: wk.msgs, limit: l.weekMessages, resetsAt: wk.start != null ? wk.start + 7 * DAY : null },
    }
  }

  async save() { if (this.s) await this.ctx.storage.put('s', this.s) }
  async reportSoon() {
    const at = await this.ctx.storage.getAlarm()
    if (!at || at > Date.now() + REPORT_MS) await this.ctx.storage.setAlarm(Date.now() + REPORT_MS)
  }

  // Every few minutes while it's used: its use to the accounts service (for Bridge AI's Settings and
  // the admin view), whose answer says how the account is. Otherwise once a day, so an account
  // deleted is forgotten here within a day (and its computers' addresses with it), as is one with no
  // computer here and no use for IDLE_DAYS.
  async alarm() {
    const s = this.s
    if (!s) return
    const now = Date.now()
    let st = null
    if (this.env.ACCOUNTS) {
      const u = this.use(now)
      const at = (t) => (t ? new Date(t).toISOString() : null)
      try {
        const r = await this.env.ACCOUNTS.fetch('https://accounts/internal/usage', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ a: s.a, window: { messages: u.window.messages, resetsAt: at(u.window.resetsAt) }, week: { messages: u.week.messages, resetsAt: at(u.week.resetsAt) }, days: s.days, limits: { window: { hours: this.lim.windowHours, messages: this.lim.windowMessages }, week: { messages: this.lim.weekMessages } } }),
        })
        if (r.ok) st = await r.json()
      } catch { /* tried again in a few minutes */ }
    }
    if (st) s.status = { status: String(st.status), relay: st.relay || null, at: now }
    if (st?.status === 'gone' || (!Object.keys(s.computers).length && (s.last || 0) < now - this.lim.idleDays * DAY)) {
      for (const id of new Set(Object.values(s.computers))) hub(this.env, id).fetch('https://hub/_hosted/remove', { method: 'POST' }).catch(() => {})
      this.s = null
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.deleteAll()
      return
    }
    if (st) this.said(now, s.status)
    await this.save()
    await this.ctx.storage.setAlarm(now + (st || !this.env.ACCOUNTS ? DAY : REPORT_MS))
  }
}
