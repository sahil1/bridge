// Bridge AI's hosted relay (relay/worker.js with HOSTED on, relay/HOSTED.md), run in Node with a
// Durable Object for each name (a Hub per computer, an Account per account), as
// test/stand-ins/relay.mjs runs one, and the accounts service stood in for by its binding, so nothing
// reaches Cloudflare. Relay tokens are made here with a test key: registering needs one (none, forged,
// ended: 401 with why), for an account the service says may use it (no relay, suspended: 403); the
// same device gets the same address back with a new token; connecting needs the computer's token and
// a relay token of its account. Each account's 8-hour window and week (with the clock moved on),
// across its computers: past either, every computer of the account and its phones are told why and
// until when, phones are let go and turned away with the same words, the computers stay connected and
// hear the use, and it's lifted when the window or week resets. A suspension is heard within a
// minute, and lets the account's computers go too. MAX_ACCOUNTS: three accounts registering at once
// with two places, the third told it's full (another computer of an account already on it isn't);
// a place given back by Stop using the relay, by IDLE_DAYS, and by the registry's daily look; at 0,
// none taken. The use is reported to the accounts service; an account it no longer has is forgotten,
// with its computers. RELAY_DAILY_REQUESTS: past it, the phones and computers on the relay are told
// it has carried all it can today, phones let go until 00:00 UTC. A computer that sends on while its
// phones are stopped is let go until then. A relay of your own (HOSTED unset) has none of it.
// Cost watching: GET /_relay/stats, behind STATS_TOKEN (and not there at all without one), gives
// each day's computers, connections, messages, data and limits reached, the busiest computers by id,
// the requests that comes to and when to move to Workers Paid, and how many accounts are on it of how
// many it takes; nothing in it, or in the Analytics Engine's points, is an address, a token or an
// account. The docs: every setting in wrangler.hosted.toml is in HOSTED.md's table with the same
// default. And the one switch: server/hosted.js's HOSTED_URL set while server/account.js's
// ACCOUNTS_URL isn't, or while PRIVACY.md or TERMS.md lack the hosted relay's section (saying what it
// sees, keeps, counts and limits, that it may be full) fails, PRIVACY.md doesn't describe a hosted
// relay that isn't live, and until it is, HOSTED.md's drafts still match the policy they change and,
// pasted in, pass.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, checks, until } from '../lib/harness.mjs'
import { bundle } from '../../relay/build.js'

const { ok, done } = checks('relay-hosted')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')

// The clock, moved on in the test (the Worker reads Date.now).
const realNow = Date.now
let shift = 0
Date.now = () => realNow() + shift
const HOUR = 3600000
const DAY = 864e5

// ---------- what Cloudflare gives a Worker ----------
const { build, code } = bundle()
globalThis.FILES = JSON.parse(code.slice('const FILES = '.length, code.indexOf('\nconst RELAY_BUILD')))
globalThis.RELAY_BUILD = build
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res } }
const OrigResponse = globalThis.Response
globalThis.Response = class extends OrigResponse {
  constructor(body, init = {}) {
    super(body, { ...init, status: init.status === 101 ? 200 : init.status }) // Node's Response has no 101
    if (init.status === 101) { this.upgrade = true; this.webSocket = init.webSocket }
  }
}
// The relay's end of a WebSocket, keeping what it was sent (text as parsed JSON).
class End {
  constructor() { this.readyState = 1; this.got = []; this.att = null; this.tags = []; this.closed = null }
  send(m) { if (this.readyState !== 1) throw new Error('closed'); this.got.push(typeof m === 'string' ? JSON.parse(m) : m) }
  close(code, why) { if (this.readyState !== 3) { this.readyState = 3; this.closed = [code, why] } }
  accept() { /* refuse() uses it */ }
  serializeAttachment(a) { this.att = a }
  deserializeAttachment() { return this.att }
  said(t) { return this.got.filter((m) => m && m.t === t) }
}
globalThis.WebSocketPair = class { constructor() { const server = new End(); return { 0: { server }, 1: server } } }

const worker = await import('../../relay/worker.js')
// A Durable Object namespace: one object of Class per name, each with storage of its own (copied in
// and out, as Cloudflare stores it), and restart(name) for one put to sleep and woken. Each takes
// its requests one at a time, as Cloudflare's input gates keep one request's storage calls from
// interleaving with another's.
function namespace(env, Class = worker.Hub) {
  const objs = new Map()
  const make = (name, store = new Map()) => {
    const sockets = new Set()
    let alarm = null
    const copy = (v) => (v === undefined ? undefined : structuredClone(v))
    const storage = {
      async get(k) { return Array.isArray(k) ? new Map(k.map((x) => [x, copy(store.get(x))])) : copy(store.get(k)) },
      async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, copy(b)); else store.set(k, copy(v)) },
      async delete(k) { for (const x of [].concat(k)) store.delete(x) },
      async list({ prefix = '', limit } = {}) { const all = [...store].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, copy(v)]); return new Map(limit ? all.slice(0, limit) : all) },
      async getAlarm() { return alarm },
      async setAlarm(t) { alarm = t },
      async deleteAlarm() { alarm = null },
      async deleteAll() { store.clear() },
    }
    const ctx = {
      storage,
      ready: null,
      setWebSocketAutoResponse() {},
      getWebSocketAutoResponseTimestamp: () => null,
      blockConcurrencyWhile(fn) { this.ready = fn(); return this.ready },
      acceptWebSocket(ws, tags) { ws.tags = tags; sockets.add(ws) },
      getWebSockets(tag) { return [...sockets].filter((w) => w.readyState === 1 && (!tag || w.tags.includes(tag))) },
      getTags: (ws) => ws.tags,
    }
    const hub = new Class(ctx, env)
    let line = Promise.resolve()
    const fetch = (input, init) => {
      const run = line.then(async () => { await ctx.ready; return hub.fetch(input instanceof Request ? input : new Request(input, init)) })
      line = run.catch(() => {})
      return run
    }
    const o = { name, hub, ctx, store, fetch, alarm: () => line.then(async () => { await ctx.ready; return hub.alarm() }), alarmAt: () => alarm }
    objs.set(name, o)
    return o
  }
  return {
    idFromName: (n) => n,
    get: (n) => objs.get(n) || make(n),
    restart: (n) => make(n, objs.get(n).store),
    of: (n) => objs.get(n),
  }
}

// The accounts service, as the relay's binding reaches it: each account's status (active and
// allowed the relay unless set here), and the usage reports it was sent.
function accountsService() {
  const status = new Map()
  const reports = []
  const asked = []
  return {
    status, reports, asked,
    async fetch(input, init) {
      const r = input instanceof Request ? input : new Request(input, init)
      const u = new URL(r.url)
      const a = u.searchParams.get('a') || (r.method === 'POST' ? (await r.clone().json()).a : null)
      const st = status.get(a) || { status: 'active', relay: 'approved', tester: 'none' }
      if (u.pathname === '/internal/status') { asked.push(a); return Response.json(st) }
      if (u.pathname === '/internal/usage') { reports.push(await r.json()); return Response.json(st) }
      return new Response('Not found', { status: 404 })
    },
  }
}

// Relay tokens, as the accounts service signs them, with a key of the test's own.
const { privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC = privateKey.export({ format: 'jwk' }).x
const relayToken = (a, d, { exp = Math.floor(Date.now() / 1000) + 7 * 86400, k = 'relay', key = privateKey, kid } = {}) => {
  const text = Buffer.from(JSON.stringify({ k, a, d, iat: exp - 7 * 86400, exp, ...(kid ? { kid } : {}) })).toString('base64url')
  return `${text}.${crypto.sign(null, Buffer.from(text), key).toString('base64url')}`
}
// A key's id, as the accounts service puts it in each token (account/worker.js, keyId).
const kidOf = (x) => crypto.createHash('sha256').update(Buffer.from(x, 'base64url')).digest().toString('base64url').slice(0, 8)
let n = 0
const newAccount = () => `acct${String(++n).padStart(8, '0')}`
const newDevice = () => `dev${String(++n).padStart(9, '0')}`

const DOMAIN = 'relay.test'
const IP = '203.0.113.9'
const ID_SECRET = 'test-id-secret'
// A computer's id from 10 characters, its checksum keyed with secret (the relay's ID_SECRET), or
// with none, as it was worked out before (a plain hash anyone could make).
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
const idFrom = (s, secret = ID_SECRET) => {
  const h = secret ? crypto.createHmac('sha256', secret).update(`bridge relay id ${s}`).digest() : crypto.createHash('sha256').update(`bridge relay id ${s}`).digest()
  const v = secret ? ((h[0] << 8) | h[1]) >> 6 : parseInt(h.toString('hex').slice(0, 3), 16) >> 2
  return s + B32[v >> 5] + B32[v & 31]
}
const tenChars = () => [...crypto.randomBytes(10)].map((b) => B32[b & 31]).join('')
// A hosted relay with these settings, and what it counted for Analytics Engine.
function relay(vars = {}) {
  const points = []
  const accounts = accountsService()
  const env = { HOSTED: '1', HOSTED_DOMAIN: DOMAIN, ID_SECRET, ACCOUNTS_PUBLIC_KEY: PUBLIC, ACCOUNTS: accounts, STATS: { writeDataPoint: (p) => points.push(p) }, ...vars }
  env.HUB = namespace(env)
  env.ACCOUNT = namespace(env, worker.Account)
  const call = (url, init = {}) => worker.default.fetch(new Request(url, init), env)
  const registerWith = (token, body = { version: '3.9.2' }) => call(`https://${DOMAIN}/_relay/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': IP, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  // A computer of account a (a new one if not given) registered: { id, url, token, a, d, rt }.
  const register = async (a = newAccount(), d = newDevice()) => { const rt = relayToken(a, d); const r = await registerWith(rt); return { status: r.status, ...(await r.json()), a, d, rt } }
  // A WebSocket to a computer's address: the relay's end of it, or the refusal.
  const socket = async (id, p, headers = {}) => {
    const r = await call(`https://${id}.${DOMAIN}${p}`, { headers: { Upgrade: 'websocket', ...headers } })
    return r.upgrade ? r.webSocket.server : r
  }
  const computer = async (c, rt = c.rt) => socket(c.id, '/_relay/host', { Authorization: `Bearer ${c.token}`, 'X-Bridge-Version': '3.9.2', ...(rt ? { 'X-Relay-Token': rt } : {}) })
  const phone = (c) => socket(c.id, '/_relay/link')
  const hubOf = (c) => env.HUB.of(c.id).hub
  const say = (c, end, m) => hubOf(c).webSocketMessage(end, m)
  const ends = (c, end, code = 1000) => { end.readyState = 3; return hubOf(c).webSocketClose(end, code) }
  // What its Account holds for account a, once anything has reached it.
  const account = (a) => env.ACCOUNT.of(a)
  return { env, points, accounts, call, registerWith, register, computer, phone, hubOf, say, ends, account }
}
const bytes = (size) => new Uint8Array(size).fill(7).buffer
const frame = (op, id, payload = new Uint8Array(0)) => { const b = new Uint8Array(payload); const out = new Uint8Array(5 + b.byteLength); out[0] = op; new DataView(out.buffer).setUint32(1, id); out.set(b, 5); return out.buffer }
const OK = 4
const midnight = () => Date.parse(new Date(Date.now()).toISOString().slice(0, 10)) + DAY
const settle = () => new Promise((r) => setTimeout(r, 30)) // fire-and-forget calls between objects land

try {
  // ---------- Registering needs an account's relay token ----------
  {
    const r = relay()
    const none = await r.registerWith(null)
    const noneJ = await none.json()
    ok(none.status === 401 && noneJ.why === 'token' && /needs this computer signed in to a Bold Bridge account/.test(noneJ.error), 'no relay token: refused (401), saying it needs a Bold Bridge account', noneJ)
    const a = newAccount()
    const d = newDevice()
    const other = crypto.generateKeyPairSync('ed25519').privateKey
    const forged = await (await r.registerWith(relayToken(a, d, { key: other }))).json()
    const kind = await (await r.registerWith(relayToken(a, d, { k: 'device' }))).json()
    const ended = await (await r.registerWith(relayToken(a, d, { exp: Math.floor(Date.now() / 1000) - 60 }))).json()
    ok(forged.token === 'forged' && kind.token === 'forged' && ended.token === 'expired' && /ran out/.test(ended.error), 'one signed with another key, a device token, or one past its end: each refused, saying which', [forged, kind, ended])
    r.accounts.status.set(a, { status: 'active', relay: 'requested' })
    const asked = await r.registerWith(relayToken(a, d))
    const askedJ = await asked.json()
    ok(asked.status === 403 && askedJ.why === 'relay' && /doesn't have Bridge AI's relay/.test(askedJ.error), 'an account the accounts service says can\'t use the relay (yet): 403, saying so', askedJ)
    r.accounts.status.set(a, { status: 'suspended', relay: 'approved' })
    shift += 61000 // (what it said is kept a minute)
    const sus = await (await r.registerWith(relayToken(a, d))).json()
    ok(sus.why === 'suspended' && /suspended/.test(sus.error), 'a suspended one: refused, saying so', sus)
    r.accounts.status.delete(a)
    shift += 61000
    const c = await r.register(a, d)
    ok(c.status === 200 && /^[a-z2-7]{12}$/.test(c.id) && c.url === `https://${c.id}.${DOMAIN}` && c.token, 'an account that may use it: the computer gets its own address and token', c)
    ok(r.accounts.asked.includes(a), 'having asked the accounts service about the account', r.accounts.asked)
    const again = await r.register(a, d)
    ok(again.id === c.id && again.token !== c.token, 'the same device registering again: the same address, a new token', { first: c.id, again: again.id })
    const stale = await r.computer(c)
    ok(stale.status === 403, 'and the old token connects no more', stale.status)
    const second = await r.register(a, newDevice())
    ok(second.id && second.id !== c.id, 'another device of the account: another address', second.id)
    const meta = r.env.HUB.of(c.id).store.get('meta')
    ok(meta.a === a && meta.d === d && !JSON.stringify(meta).includes(again.token), 'a Hub keeps which account and device it\'s for, and a hash of the token, never the token', meta)
  }

  // ---------- Made-up addresses wake nothing, and the kill switch is said first ----------
  {
    const r = relay()
    const c = await r.register()
    ok(c.id === idFrom(c.id.slice(0, 10)), 'a computer\'s id ends in a checksum keyed with the relay\'s own secret (ID_SECRET)', c.id)
    let woken = 0
    const get = r.env.HUB.get
    r.env.HUB.get = (n) => { if (!r.env.HUB.of(n)) woken++; return get(n) }
    const statuses = new Set()
    for (let i = 0; i < 100; i++) {
      const s = tenChars()
      for (const made of [idFrom(s, null), idFrom(s, 'someone else\'s secret')]) {
        if (made === idFrom(s)) continue // (one in 1,024 passes by chance)
        statuses.add((await r.call(`https://${made}.${DOMAIN}/`)).status)
        statuses.add((await r.call(`https://${made}.${DOMAIN}/_relay/link`, { headers: { Upgrade: 'websocket' } })).status)
      }
    }
    ok(woken === 0 && [...statuses].join() === '404', '200 made-up addresses, with the checksum anyone could work out before or one keyed with another secret: each a plain 404, and not one Hub woken', { woken, statuses: [...statuses] })
    const real = await r.call(`https://${c.id}.${DOMAIN}/`)
    ok(real.status === 200, 'while the relay\'s own address still answers', real.status)
    const csp = real.headers.get('content-security-policy') || ''
    ok(/connect-src 'self' wss:\/\/\*\.relay\.test;/.test(csp) && !/ wss: | ws:/.test(csp) && real.headers.get('cross-origin-opener-policy') === 'same-origin', 'its page connects only to the relay\'s own addresses (connect-src), and keeps other sites\' windows off it (Cross-Origin-Opener-Policy)', { csp, coop: real.headers.get('cross-origin-opener-policy') })
    r.env.HOSTED_OFF = '1'
    const unknown = idFrom(tenChars())
    const off = await r.call(`https://${unknown}.${DOMAIN}/_relay/link`, { headers: { Upgrade: 'websocket' } })
    const offHost = await r.call(`https://${unknown}.${DOMAIN}/_relay/host`, { headers: { Upgrade: 'websocket' } })
    ok(off.webSocket?.server?.got?.[0]?.why === 'off' && offHost.webSocket?.server?.got?.[0]?.why === 'off' && woken === 0, 'switched off (HOSTED_OFF): a connection is told so before any Hub is asked whether the address is registered', { woken, said: off.webSocket?.server?.got?.[0] })
    delete r.env.HOSTED_OFF
    const noSecret = await worker.default.fetch(new Request(`https://${DOMAIN}/`), { ...r.env, ID_SECRET: '' })
    ok(noSecret.status === 500 && /ID_SECRET isn't set/.test(await noSecret.text()), 'without ID_SECRET the hosted relay answers nothing but that it isn\'t set', noSecret.status)
  }

  // ---------- Tokens say which key signed them, so the key can be changed ----------
  {
    const next = crypto.generateKeyPairSync('ed25519').privateKey
    const NEXT = next.export({ format: 'jwk' }).x
    const r = relay({ ACCOUNTS_PUBLIC_KEY: `${PUBLIC}, ${NEXT}` })
    const status = async (t) => { const x = await r.registerWith(t); return x.status === 200 ? 200 : (await x.json()).token }
    const one = () => [newAccount(), newDevice()]
    const got = {
      old: await status(relayToken(...one(), { kid: kidOf(PUBLIC) })),
      next: await status(relayToken(...one(), { key: next, kid: kidOf(NEXT) })),
      before: await status(relayToken(...one())),
      beforeNext: await status(relayToken(...one(), { key: next })),
      swapped: await status(relayToken(...one(), { kid: kidOf(NEXT) })),
      unknown: await status(relayToken(...one(), { kid: 'AAAAAAAA' })),
    }
    ok(got.old === 200 && got.next === 200, 'with two keys in ACCOUNTS_PUBLIC_KEY (comma separated), a token signed with either, saying which (kid), is taken', got)
    ok(got.before === 200 && got.beforeNext === 'forged', 'one from before tokens said which key is checked with the first key only', got)
    ok(got.swapped === 'forged' && got.unknown === 'forged', 'one whose kid names the other key, or none of them, is refused as forged', got)
  }

  // ---------- Connecting needs a relay token of its account ----------
  {
    const r = relay()
    const c = await r.register()
    const bare = await r.computer(c, null)
    ok(bare instanceof End && bare.got[0]?.t === 'limit' && bare.got[0].why === 'token' && /signed in to a Bold Bridge account/.test(bare.got[0].text) && bare.closed?.[0] === 4009, 'the computer\'s token alone isn\'t enough: told it needs its account\'s relay token, not a silent close', bare.got)
    const another = await r.computer(c, relayToken(newAccount(), newDevice()))
    const ended = await r.computer(c, relayToken(c.a, c.d, { exp: Math.floor(Date.now() / 1000) - 1 }))
    ok(another.got?.[0]?.why === 'token' && ended.got?.[0]?.why === 'token', 'nor another account\'s, or one past its end', [another.got?.[0], ended.got?.[0]])
    const host = await r.computer(c)
    ok(host instanceof End && host.readyState === 1 && !host.said('limit').length, 'with its account\'s: connected', host.got)
    const use = host.said('use')[0]
    ok(use?.window?.limit === 150000 && use.window.hours === 8 && use.week.limit === 1000000 && use.window.messages === 0, 'and it hears its account\'s use and limits (the defaults: 150,000 in 8 hours, 1,000,000 a week)', use)
  }

  // ---------- Each account's window, across its computers ----------
  {
    shift = 0
    const r = relay({ ACCOUNT_WINDOW_MESSAGES: '50' })
    const a = newAccount()
    const c1 = await r.register(a)
    const c2 = await r.register(a)
    const other = await r.register()
    const h1 = await r.computer(c1)
    const h2 = await r.computer(c2)
    const ho = await r.computer(other)
    const p1 = await r.phone(c1)
    const p2 = await r.phone(c2)
    const po = await r.phone(other)
    const start = Date.now()
    for (let i = 0; i < 30; i++) await r.say(c1, p1, bytes(64))
    for (let i = 0; i < 30 && p2.readyState === 1; i++) await r.say(c2, p2, bytes(64))
    await until(() => p1.said('limit').length && p2.said('limit').length, 3000, 20)
    const told = p2.said('limit')[0] || p1.said('limit')[0]
    const until8 = told?.until
    ok(told?.why === 'window' && until8 >= start + 8 * HOUR && until8 < start + 8 * HOUR + 60000 && /used its allowance on Bridge AI's relay for now \(50 messages in 8 hours\)/.test(told.text) && /resets at (?:[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, )?\d\d:\d\d UTC/.test(told.text) && /your own Cloudflare account/.test(told.text), 'past the window\'s 50 messages across both computers, the phone is told: the allowance, when it resets (8 hours from the first message), how to have no limits', told)
    ok(p1.said('limit')[0]?.why === 'window' && p1.closed?.[0] === 4005 && p2.closed?.[0] === 4005, 'both computers\' phones are let go, not only the one that went past it', [p1.closed, p2.closed])
    ok(h1.said('limit').some((m) => m.why === 'window') && h2.said('limit').some((m) => m.why === 'window') && h1.readyState === 1 && h2.readyState === 1, 'both computers are told, and stay connected for when it resets', [h1.said('limit').length, h2.said('limit').length])
    const used = h2.said('use').at(-1)
    ok(used?.window.messages > 50 && used.window.resetsAt === until8, 'and they hear the account\'s use', used)
    ok(po.readyState === 1 && !po.said('limit').length && !ho.said('limit').length, 'another account\'s computer carries on', po.got.filter((m) => m?.t))
    const late = await r.phone(c1)
    ok(late instanceof End && late.got[0]?.why === 'window' && late.closed?.[0] === 4005, 'a phone connecting before it resets is turned away with the same words', late.got)
    ok(r.points.some((p) => p.blobs[0] === 'limit' && p.blobs[1] === 'window' && p.indexes[0] === c1.id) && !JSON.stringify(r.points).includes(a), 'the limit reached is counted for the project by the computer\'s id, never the account\'s', r.points.filter((p) => p.blobs[0] === 'limit').map((p) => p.blobs))
    shift = 8 * HOUR + 60000
    const back = await r.phone(c1)
    ok(back instanceof End && back.readyState === 1 && !back.said('limit').length, 'once the window has ended, phones connect again', back.got)
    for (let i = 0; i < 5; i++) await r.say(c1, back, bytes(64))
    await r.ends(c1, back) // (what it carried goes to the Account as it ends)
    await settle()
    const fresh = await r.account(a).fetch('https://account/_account/check', { method: 'POST', body: JSON.stringify({ a }) }).then((x) => x.json())
    ok(!fresh.limit && fresh.use.window.messages >= 5 && fresh.use.window.messages < 50 && fresh.use.window.resetsAt > Date.now() + 7.9 * HOUR && fresh.use.window.resetsAt <= Date.now() + 8 * HOUR, 'and a new window starts with the first message after it (what was on its way before counts in it)', fresh.use.window)
    shift = 0
  }

  // ---------- ...and its week ----------
  {
    const r = relay({ ACCOUNT_WINDOW_MESSAGES: '1000', ACCOUNT_WEEK_MESSAGES: '100' })
    const c = await r.register()
    const first = Date.now()
    let ph = null
    let host = null
    for (let day = 0; day < 4; day++) {
      shift = day * DAY
      host = await r.computer(c) // (each day: a computer quiet for a day was let go)
      ph = await r.phone(c)
      for (let i = 0; i < 30 && ph.readyState === 1; i++) await r.say(c, ph, bytes(16))
    }
    await until(() => ph.said('limit').length, 3000, 20)
    const told = ph.said('limit')[0]
    ok(told?.why === 'week' && told.until >= first + 7 * DAY && told.until < first + 7 * DAY + 60000 && /used this week's allowance on Bridge AI's relay \(100 messages a week\)/.test(told.text) && /resets on \w{3} \d+ \w{3}, \d\d:\d\d UTC/.test(told.text), 'past the week\'s 100 messages over four days: told the week\'s allowance is used, and the day and time it resets (a week from the first use)', told)
    ok(host.readyState === 1 && host.said('limit').some((m) => m.why === 'week'), 'and the computer was told, and stayed connected', host.said('limit'))
    shift += 9 * HOUR
    const still = await r.phone(c)
    ok(still.got?.[0]?.why === 'week', 'a new 8-hour window doesn\'t lift it', still.got)
    shift = 7 * DAY + 60000
    const next = await r.phone(c)
    ok(next instanceof End && next.readyState === 1, 'the next week does', next.got)
    shift = 0
  }

  // ---------- A suspension, heard within a minute ----------
  {
    const r = relay()
    const c = await r.register()
    const host = await r.computer(c)
    const ph = await r.phone(c)
    await r.say(c, ph, bytes(16))
    r.accounts.status.set(c.a, { status: 'suspended', relay: 'approved' })
    shift += 61000
    const p2 = await r.phone(c)
    await until(() => host.closed, 2000, 20)
    ok(p2.got?.[0]?.why === 'suspended' && /account is suspended/.test(p2.got[0].text) && /your own Cloudflare account, or Tailscale/.test(p2.got[0].text), 'suspended: a phone connecting a minute later is told so, and of the other ways', p2.got)
    ok(host.said('limit').some((m) => m.why === 'suspended') && host.closed?.[0] === 4009 && ph.closed, 'and the computer is told and let go, with its other phones', { host: host.closed, ph: ph.closed })
    const again = await r.computer(c)
    ok(again.got?.[0]?.why === 'suspended' && again.got[0].until > Date.now() + 9 * 60000, 'connecting again it\'s turned away, with when to ask again (10 minutes)', again.got)
    r.accounts.status.delete(c.a)
    shift += 61000
    const ok2 = await r.computer(c)
    ok(ok2 instanceof End && ok2.readyState === 1 && !ok2.said('limit').length, 'restored, it connects again', ok2.got)
    r.accounts.status.set(c.a, { status: 'active', relay: 'declined' })
    shift += 61000
    const p3 = await r.phone(c)
    ok(p3.got?.[0]?.why === 'relay' && /doesn't have Bridge AI's relay any more/.test(p3.got[0].text), 'its relay taken away: said that way', p3.got)
    shift = 0
  }

  // ---------- MAX_ACCOUNTS ----------
  {
    const r = relay({ MAX_ACCOUNTS: '2', STATS_TOKEN: 'stats-secret-for-tests' })
    const accts = [newAccount(), newAccount(), newAccount()]
    const all = await Promise.all(accts.map((a) => r.register(a)))
    const ins = all.filter((x) => x.status === 200)
    const out = all.filter((x) => x.status !== 200)
    ok(ins.length === 2 && out.length === 1, 'three accounts registering at once with MAX_ACCOUNTS at 2: two get an address, however they interleave', all.map((x) => x.status))
    const no = out[0] || {}
    ok(no.status === 503 && no.why === 'full' && /full for now: it has as many accounts as it can take/.test(no.error) && /your own Cloudflare account/.test(no.error) && /Tailscale/.test(no.error), 'the third is told plainly: it\'s full for now, and the other ways, with why "full" for the app', no)
    const more = await r.register(ins[0].a)
    ok(more.status === 200 && more.id, 'another computer of an account already on it is taken', more)
    ok(r.points.filter((p) => p.blobs[0] === 'refused' && p.blobs[1] === 'full').length === 1, 'the refusal is counted for the project', r.points.map((p) => p.blobs))
    const stats = async () => (await r.call(`https://${DOMAIN}/_relay/stats`, { headers: { Authorization: 'Bearer stats-secret-for-tests' } })).json()
    const s = await stats()
    ok(s.accounts?.on === 2 && s.accounts.max === 2 && s.computers === 3 && s.days[0].limits.full === 1 && s.days[0].registered === 3 && s.days[0].refused === 1, '/_relay/stats says how many accounts are on it of how many it takes, its computers, and how many were turned away', { accounts: s.accounts, computers: s.computers, day: s.days[0] })
    // Stop using the relay on an account's only computer: its place is free at once.
    const single = ins.find((x) => x.a !== ins[0].a)
    const forgot = await r.call(`https://${single.id}.${DOMAIN}/_relay/forget`, { method: 'POST', headers: { Authorization: `Bearer ${single.token}` } })
    await settle()
    const third = await r.register(out[0].a)
    ok(forgot.status === 204 && third.status === 200 && (await stats()).accounts.on === 2, 'an account whose only computer stops using it frees its place at once: the next account registers', { forgot: forgot.status, third: third.status })
    // Unused for IDLE_DAYS: removed by its own alarm, and its account's place goes with it.
    const tHub = r.env.HUB.of(third.id)
    tHub.store.set('meta', { ...tHub.store.get('meta'), at: Date.now() - 91 * DAY })
    r.env.HUB.restart(third.id)
    await r.env.HUB.of(third.id).alarm()
    await settle()
    ok(!r.env.HUB.of(third.id).store.has('meta') && (await stats()).accounts.on === 1, 'a computer not seen for IDLE_DAYS is removed, and its account (with none left) counts no more', (await stats()).accounts)
    ok(!Object.values(r.account(third.a).store.get('s')?.computers || {}).includes(third.id), 'its Account forgets its address too', r.account(third.a).store.get('s')?.computers)
    // A Hub removed without the registry hearing: found by its daily look.
    const reg = r.env.HUB.of('registry')
    const gone = ins[0]
    r.env.HUB.of(gone.id).store.clear()
    r.env.HUB.restart(gone.id)
    reg.store.set(`c:${gone.id}`, { ...reg.store.get(`c:${gone.id}`), seen: '2020-01-01' })
    r.env.HUB.restart('registry')
    await r.env.HUB.of('registry').alarm()
    const regNow = r.env.HUB.of('registry').store
    ok(!regNow.has(`c:${gone.id}`) && regNow.has(`c:${more.id}`) && (await stats()).accounts.on === 1, 'a computer removed without the registry hearing is found by its daily look; its account stays while it has another', { computers: (await stats()).computers, accounts: (await stats()).accounts })
    const regText = JSON.stringify([...regNow])
    ok(!regText.includes(IP) && ![...ins, more].some((x) => regText.includes(x.token)), 'what the registry keeps for it is ids and days: no address, no token', regText.slice(0, 300))
    r.env.MAX_ACCOUNTS = '0'
    ok((await r.register()).why === 'full', 'MAX_ACCOUNTS at 0 takes no new accounts at all')
  }

  // ---------- The use reported, and an account deleted ----------
  {
    const r = relay()
    const c = await r.register()
    const host = await r.computer(c)
    const ph = await r.phone(c)
    for (let i = 0; i < 3; i++) await r.say(c, ph, bytes(16))
    await r.ends(c, ph) // (a connection ending tells the Account what it carried)
    await settle()
    const acc = r.account(c.a)
    ok(acc.alarmAt() > Date.now() && acc.alarmAt() <= Date.now() + 5 * 60000 + 1000, 'used: the Account reports within 5 minutes', acc.alarmAt() - Date.now())
    await acc.alarm()
    const rep = r.accounts.reports.at(-1)
    const today = new Date(Date.now()).toISOString().slice(0, 10)
    ok(rep?.a === c.a && rep.window.messages === 3 && Date.parse(rep.window.resetsAt) > Date.now() && rep.week.messages === 3 && rep.days[today] === 3 && rep.limits.window.messages === 150000 && rep.limits.week.messages === 1000000, 'it reports the account\'s window, week, each day\'s total and the relay\'s limits (POST /internal/usage)', rep)
    ok(acc.alarmAt() > Date.now() + 23 * HOUR, 'then asks again in a day if nothing happens', acc.alarmAt() - Date.now())
    r.accounts.status.set(c.a, { status: 'gone' })
    await acc.alarm()
    await settle()
    ok(!acc.store.size && !r.env.HUB.of(c.id).store.has('meta') && host.closed, 'an account the service no longer has: its Account forgets everything, and its computers are removed', { account: acc.store.size, hub: r.env.HUB.of(c.id).store.size, host: host.closed })
    ok(r.points.some((p) => p.blobs[0] === 'removed' && p.blobs[1] === 'account'), 'counted as removed for its account', r.points.map((p) => p.blobs))
  }

  // ---------- Too many phones, too big, too much at once ----------
  {
    const r = relay({ MAX_PHONES: '2', MAX_MESSAGE_KB: '4', MESSAGE_BURST: '6', MESSAGES_PER_SECOND: '1' })
    const c = await r.register()
    const host = await r.computer(c)
    const a = await r.phone(c)
    const b = await r.phone(c)
    await r.say(c, host, frame(OK, a.att.id))
    await r.say(c, host, frame(OK, b.att.id))
    const third = await r.phone(c)
    ok(third instanceof End && third.got[0]?.t === 'limit' && third.got[0].why === 'phones' && /takes 2 connections to one computer at once/.test(third.got[0].text) && third.got[0].until > Date.now() && third.closed?.[0] === 4005, 'with as many paired phones connected as it takes, one more is told why and when it tries again, not left with a bare 429', third.got[0])
    const told = host.said('limit').find((m) => m.why === 'phones')
    ok(told && /A phone was turned away/.test(told.text) && /2 connections to this computer at once/.test(told.text), 'and the computer is told a phone was turned away, and why', told)
    await r.say(c, a, bytes(5 * 1024))
    ok(a.said('limit')[0]?.why === 'size' && /over 4 KB at once/.test(a.said('limit')[0].text) && a.closed?.[0] === 4005, 'a message too big: that phone is told, and reconnects', a.said('limit'))
    ok(/over 4 KB/.test(host.said('limit').find((m) => m.why === 'size')?.text || ''), 'and the computer is told too', host.said('limit'))
    for (let i = 0; i < 10 && b.readyState === 1; i++) await r.say(c, b, bytes(16))
    ok(b.said('limit')[0]?.why === 'rate' && /Too much at once/.test(b.said('limit')[0].text) && b.closed?.[0] === 4005, 'too much at once: that phone is told, and reconnects a moment later', b.said('limit'))
    ok(/sent more at once than Bridge AI's relay takes/.test(host.said('limit').find((m) => m.why === 'rate')?.text || ''), 'and the computer hears it', host.said('limit'))
  }

  // ---------- RELAY_DAILY_REQUESTS: the whole relay's ceiling for a day ----------
  {
    const r = relay({ RELAY_DAILY_REQUESTS: '100', STATS_TOKEN: 'stats-secret-for-tests' })
    const one = await r.register()
    const two = await r.register()
    const h1 = await r.computer(one)
    const h2 = await r.computer(two)
    const p1 = await r.phone(one)
    const p2 = await r.phone(two)
    for (let i = 0; i < 2000 && p1.readyState === 1; i++) await r.say(one, p1, bytes(32))
    const told1 = await until(() => p1.said('limit')[0], 5000, 20)
    ok(told1?.why === 'all' && /carried all it can for today, for every computer on it/.test(told1.text) && told1.until === midnight() && /your own Cloudflare account/.test(told1.text) && /Tailscale/.test(told1.text) && p1.closed?.[0] === 4005, 'past the ceiling, a phone is told the relay has carried all it can today for everyone, when it starts again and the other ways, and is let go', told1)
    ok(h1.said('limit').some((m) => m.why === 'all') && h1.readyState === 1, 'its computer is told too, and stays connected for then', h1.said('limit'))
    // The other computer hears it with its next tally (a phone connecting is one).
    const p3 = await r.phone(two)
    const told2 = await until(() => [...p2.said('limit'), ...p3.said('limit')].find((m) => m.why === 'all'), 5000, 20)
    ok(!!told2 && h2.said('limit').some((m) => m.why === 'all') && h2.readyState === 1, 'every other computer on the relay hears it too, with its next tally, and its phones are let go', { p2: p2.said('limit'), p3: p3.said('limit') })
    const late = await r.phone(two)
    ok(late instanceof End && late.got[0]?.why === 'all' && late.closed?.[0] === 4005, 'a phone connecting after that is turned away with the same words, not a silent close', late.got)
    const s = await (await r.call(`https://${DOMAIN}/_relay/stats`, { headers: { Authorization: 'Bearer stats-secret-for-tests' } })).json()
    ok(s.requests.ceiling === 100 && s.days[0].ceilingAt > 0 && s.days[0].limits.all >= 2, '/_relay/stats says what the ceiling is, when today reached it and how many computers it stopped', { requests: s.requests, at: s.days[0].ceilingAt, limits: s.days[0].limits })
    const three = await r.register()
    ok(!!three.id, 'registering still works (it costs next to nothing); a new computer hears the ceiling when it connects', three)
    const h3 = await r.computer(three)
    await r.phone(three)
    ok(!!(await until(() => h3.said('limit').some((m) => m.why === 'all'), 5000, 20)), 'and does', h3.got)
  }

  // ---------- A computer that sends on while its phones are stopped is let go until then ----------
  {
    const r = relay({ ACCOUNT_WINDOW_MESSAGES: '50' })
    const c = await r.register()
    const host = await r.computer(c)
    const ph = await r.phone(c)
    const pid = ph.att.id
    for (let i = 0; i < 60 && ph.readyState === 1; i++) await r.say(c, ph, bytes(64))
    await until(() => ph.closed, 3000, 20)
    const resets = host.said('limit').find((m) => m.why === 'window')?.until
    for (let i = 0; i < 40; i++) await r.say(c, host, frame(1, pid, new Uint8Array(16)))
    ok(host.readyState === 1 && !host.said('limit').some((m) => m.why === 'shut'), 'a few messages from the computer after its phones were stopped (what was on its way) change nothing: it stays connected', host.said('limit'))
    for (let i = 0; i < 1000; i++) await r.say(c, host, frame(1, pid, new Uint8Array(16)))
    const shut = host.said('limit').find((m) => m.why === 'shut')
    ok(shut && /let this computer go until (?:[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, )?\d\d:\d\d UTC/.test(shut.text) && shut.until === resets && host.closed?.[0] === 4005, 'past 1,000 that had nowhere to go (each billed), its connection is closed, saying why and until when (the window\'s end)', shut)
    const again = await r.computer(c)
    ok(again instanceof End && again.got[0]?.why === 'shut' && again.closed?.[0] === 4005, 'connecting again before then, it\'s turned away with the same words', again.got)
    r.env.HUB.restart(c.id)
    const after = await r.computer(c)
    ok(after.got?.[0]?.why === 'shut', 'kept when its Hub starts again', after.got)
    ok(r.points.some((p) => p.blobs[0] === 'limit' && p.blobs[1] === 'shut'), 'and it\'s counted for the project', r.points.map((p) => p.blobs))
  }

  // ---------- A relay of your own: no limits ----------
  {
    const hub = namespace({}).get('hub')
    const env = { HOST_TOKEN: 'own-relay-token', HUB: { idFromName: () => 'hub', get: () => hub }, ACCOUNT_WINDOW_MESSAGES: '50', ACCOUNT_WEEK_MESSAGES: '50', MAX_MESSAGE_KB: '4', MESSAGE_BURST: '6', MESSAGES_PER_SECOND: '1', STATS_TOKEN: 's' }
    const sock = async (p, headers = {}) => { const res = await worker.default.fetch(new Request(`https://own.example.workers.dev${p}`, { headers: { Upgrade: 'websocket', ...headers } }), env); return res.webSocket?.server || res }
    const host = await sock('/_relay/host', { Authorization: 'Bearer own-relay-token' })
    const ph = await sock('/_relay/link')
    for (let i = 0; i < 2500; i++) await hub.hub.webSocketMessage(ph, bytes(16))
    await hub.hub.webSocketMessage(ph, bytes(300 * 1024))
    const relayed = host.got.filter((m) => m instanceof Uint8Array && m[0] === 1).length
    ok(relayed === 2501 && ph.readyState === 1 && ![...host.got, ...ph.got].some((m) => m?.t === 'limit' || m?.t === 'use'), 'on a relay of your own (HOSTED unset) the limit settings do nothing: 2,501 messages, one of 300 KB, all relayed, nothing said, nothing cut', { relayed, state: ph.readyState })
    const s = await worker.default.fetch(new Request('https://own.example.workers.dev/_relay/stats', { headers: { Authorization: 'Bearer s' } }), env)
    const reg = await worker.default.fetch(new Request('https://own.example.workers.dev/_relay/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env)
    ok(s.status === 404 && reg.status === 404, 'and has no stats or registering to ask for', [s.status, reg.status])
    const own = await worker.default.fetch(new Request('https://own.example.workers.dev/'), env)
    ok(/connect-src 'self' wss: ws:;/.test(own.headers.get('content-security-policy') || '') && own.headers.get('cross-origin-opener-policy') === 'same-origin', 'its page may still reach your other computers\' relays, wherever they are, and keeps other sites\' windows off it too', own.headers.get('content-security-policy'))
  }

  // ---------- Cost watching: /_relay/stats ----------
  {
    const r = relay()
    const busy = await r.register()
    const quiet = await r.register()
    const h1 = await r.computer(busy)
    const p1 = await r.phone(busy)
    for (let i = 0; i < 1250 && p1.readyState === 1; i++) await r.say(busy, p1, bytes(100))
    const h2 = await r.computer(quiet)
    const p2 = await r.phone(quiet)
    for (let i = 0; i < 20; i++) await r.say(quiet, p2, bytes(100))
    await r.ends(quiet, p2)
    await r.ends(quiet, h2)
    await r.ends(busy, p1)
    const stats = (token, host = DOMAIN, q = '') => r.call(`https://${host}/_relay/stats${q}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
    ok((await stats('anything')).status === 404, 'with no STATS_TOKEN, /_relay/stats isn\'t there at all (404)')
    r.env.STATS_TOKEN = 'stats-secret-for-tests'
    ok((await stats()).status === 403 && (await stats('wrong')).status === 403, 'with one, no token or a wrong one is refused (403)')
    ok((await stats('stats-secret-for-tests', `${busy.id}.${DOMAIN}`)).status === 404, 'and a computer\'s own address has none')
    const today = new Date(Date.now()).toISOString().slice(0, 10)
    const got = await until(async () => { const j = await (await stats('stats-secret-for-tests')).json(); const d = j.days?.[0]; return d && d.messages >= 1270 && d.connections.phones >= 2 ? j : null }, 5000, 50)
    const d = got?.days?.[0] || {}
    ok(d.day === today && d.registered === 2 && d.refused === 0 && d.computers === 2 && d.connections.computers === 2 && d.connections.phones === 2, 'with the token: today\'s computers set up and refused, computers in use, and connections', d)
    ok(d.messages >= 1270 && d.bytes >= 127000 && Object.keys(d.limits).sort().join() === 'account,all,full,phones,rate,shut,size,week,window', 'messages and data relayed, and each limit\'s count', { messages: d.messages, bytes: d.bytes, limits: d.limits })
    ok(d.top?.[0]?.id === busy.id && d.top[0].messages >= 1250 && d.top.some((x) => x.id === quiet.id && x.messages === 20), 'and the day\'s busiest computers by id, so a runaway one stands out', d.top)
    ok(d.requests >= Math.ceil(1270 / 20) && typeof got?.note === 'string' && /Workers Free/.test(got.note) && got.requests?.workers === 'free' && got.requests.today === d.requests && got.requests.ceiling === 5000000, 'what that comes to in Cloudflare requests, when it\'s time for Workers Paid, and the ceiling (5,000,000 by default)', { requests: got?.requests, note: got?.note })
    ok(got?.days?.length === 7 && (await (await stats('stats-secret-for-tests', DOMAIN, '?days=30')).json()).days.length === 30, 'the last 7 days by default, up to 35 asked for', got?.days?.length)
    const all = JSON.stringify(got) + JSON.stringify(r.points)
    ok(!all.includes(IP) && !all.includes(busy.token) && !all.includes(quiet.token) && !all.includes(busy.a) && !all.includes(quiet.a) && !/203\.0\.113/.test(all), 'nothing in the stats or the counts is an IP address, a token or an account', all.slice(0, 300))
    r.env.WORKERS_PAID = '1'
    const paid = await (await stats('stats-secret-for-tests')).json()
    ok(paid.requests.workers === 'paid' && /Workers Paid's included million/.test(paid.note), 'on Workers Paid, measured against its included million a month', paid.note)
    r.env.WORKERS_PAID = '0'
    const reg = r.env.HUB.of('registry')
    const s = reg.store.get(`s:${today}`)
    reg.store.set(`s:${today}`, { ...s, messages: 1_200_000 })
    const busyDay = await (await stats('stats-secret-for-tests')).json()
    ok(/move to Workers Paid \(\$5 a month\) now/.test(busyDay.note), 'past half of Workers Free\'s 100,000 requests a day, it says to move to Workers Paid now', busyDay.note)
    reg.store.set('s:2020-01-01', s)
    await reg.alarm()
    ok(!reg.store.has('s:2020-01-01') && reg.store.has(`s:${today}`), 'a day\'s counts go after 35 days', [...reg.store.keys()].filter((k) => k.startsWith('s:')))
    void h1
  }

  // ---------- The docs say what the config does ----------
  {
    const toml = read('relay', 'wrangler.hosted.toml')
    const md = read('relay', 'HOSTED.md')
    const vars = Object.fromEntries([...toml.slice(toml.indexOf('[vars]')).matchAll(/^([A-Z_]+) = "([^"]*)"/gm)].map((m) => [m[1], m[2]]))
    const missing = Object.entries(vars).filter(([k, v]) => !new RegExp(`^\\| \`${k}\` \\| ${v === '' || ['HOSTED', 'HOSTED_DOMAIN'].includes(k) ? '' : `\`${v.replace(/[{}]/g, '\\$&')}\``}`, 'm').test(md))
    ok(Object.keys(vars).length >= 14 && !missing.length && ['ACCOUNT_WINDOW_HOURS', 'ACCOUNT_WINDOW_MESSAGES', 'ACCOUNT_WEEK_MESSAGES', 'MAX_ACCOUNTS', 'ACCOUNTS_PUBLIC_KEY'].every((k) => k in vars), 'every setting in wrangler.hosted.toml is in HOSTED.md\'s table, with the same default, the account limits among them', missing)
    ok(/^\| `ID_SECRET` \|/m.test(md) && /secret put ID_SECRET/.test(md) && /#   ID_SECRET /.test(toml) && /STATS_TOKEN/.test(md) && /\[observability\]\nenabled = false/.test(toml) && /class_name = "Account"/.test(toml) && /tag = "v2"\nnew_sqlite_classes = \["Account"\]/.test(toml), 'and its secrets (ID_SECRET in Going live), the Account class with its migration, and the Worker\'s logs off', null)
    ok(/\| 500 \| 142 million \| 825,000 GB-s \| \$5 \+ \$21\.15 \+ \$12\.50 = \*\*\$38\.65\*\* \|/.test(md) && /about \*\*\$43\.75\*\* a month/.test(md), 'the cost of 500 accounts at their limits ($38.65) and the backstop\'s most ($43.75) are both under $50', null)
  }

  // ---------- The one switch: HOSTED_URL, and the policy ----------
  {
    const urlOf = (src) => /export const HOSTED_URL = '([^']*)'/.exec(src)?.[1]
    const HOSTED_URL = urlOf(read('server', 'hosted.js'))
    const ACCOUNTS_URL = /export const ACCOUNTS_URL = '([^']*)'/.exec(read('server', 'account.js'))?.[1]
    ok(HOSTED_URL !== undefined, 'server/hosted.js has HOSTED_URL, the one place the hosted relay is switched on', null)
    ok(!HOSTED_URL || !!ACCOUNTS_URL, 'HOSTED_URL is set only with ACCOUNTS_URL: the relay needs Bold Bridge accounts', { HOSTED_URL, ACCOUNTS_URL })
    const privacy = read('PRIVACY.md')
    const terms = read('TERMS.md')
    const section = (doc, heading) => { const i = doc.search(new RegExp(`^## ${heading}`, 'm')); if (i < 0) return null; const rest = doc.slice(i + 3); const j = rest.search(/^## /m); return j < 0 ? rest : rest.slice(0, j) }
    // What the policy must say once the hosted relay is live.
    const ready = (p, t) => {
      const s = section(p, 'Bridge AI\'s relay')
      if (!s) return ['PRIVACY.md has no "## Bridge AI\'s relay" section']
      const need = [['that it\'s end-to-end encrypted', /end-to-end encrypted/], ['what it sees', /IP addresses/], ['that it keeps a hash of the token', /hash of the token/], ['that it comes with a Bold Bridge account', /Bold Bridge account/], ['what it counts', /counts/], ['its limits, per account', /allowance for each account/], ['that it takes a limited number of accounts, and may be full', /limited number of accounts[\s\S]*full/], ['that it keeps a list of the computers on it', /list of the\s+computers/], ['that it may change or gain paid plans', /paid plans?/], ['how to stop using it', /Stop using the relay/]]
      const tSec = section(t, 'Bridge AI\'s relay')
      return [...need.filter(([, re]) => !re.test(s)).map(([w]) => `PRIVACY.md's section doesn't say ${w}`), ...(!tSec ? ['TERMS.md has no "## Bridge AI\'s relay" section'] : /be full/.test(tSec) ? [] : ['TERMS.md\'s section doesn\'t say it may be full'])]
    }
    const problems = HOSTED_URL ? ready(privacy, terms) : []
    ok(!problems.length, 'HOSTED_URL is set only with PRIVACY.md and TERMS.md saying what the hosted relay sees, keeps and limits', problems)
    ok(HOSTED_URL || !section(privacy, 'Bridge AI\'s relay'), 'and while it\'s empty, PRIVACY.md doesn\'t describe a hosted relay that isn\'t there', null)
    // The check itself: on the policy without the hosted relay's sections (today's, or the one before
    // they were pasted in), it fails.
    const before = HOSTED_URL ? { p: privacy.replace(/^## Bridge AI's relay[\s\S]*?(?=^## )/m, ''), t: terms.replace(/^## Bridge AI's relay[\s\S]*?(?=^## )/m, '') } : { p: privacy, t: terms }
    ok(ready(before.p, before.t).length > 0, 'the check itself: with HOSTED_URL set and no hosted relay sections, it fails', ready(before.p, before.t))
    // HOSTED.md's drafts, until they're pasted in: each "Replace" quotes the policy as it is now, and
    // pasted in, they pass. Once HOSTED_URL is set, they're in the policy (checked above) instead.
    const md = read('relay', 'HOSTED.md')
    const draftsAt = md.indexOf('## Policy text to add when it goes live')
    if (HOSTED_URL) ok(draftsAt < 0 && /^## The policy's hosted relay sections$/m.test(md), 'live: HOSTED.md no longer holds drafts, and says where the policy\'s sections are', null)
    else {
      const drafts = md.slice(draftsAt)
      const unquote = (s) => s.split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^> ?/, '')).join('\n').trim()
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const loose = (s) => new RegExp(s.trim().split(/\s+/).map(esc).join('\\s+')) // line breaks may differ
      const docs = { 'PRIVACY.md': privacy, 'TERMS.md': terms }
      const stale = []
      let parts = 0
      for (const m of drafts.matchAll(/^### (PRIVACY\.md|TERMS\.md): (.+)\n([\s\S]*?)(?=^### |^## |(?![\s\S]))/gm)) {
        const [, file, where, body] = m
        parts++
        const rep = /^Replace:?\n([\s\S]*?)\nwith:?\n([\s\S]*)$/m.exec(body)
        if (rep) {
          const from = unquote(rep[1])
          if (!loose(from).test(docs[file])) stale.push(`${file} (${where}): "${from.slice(0, 80)}…" isn't in it any more`)
          else docs[file] = docs[file].replace(loose(from), () => unquote(rep[2]))
          continue
        }
        const after = /a new section after "([^"]+)"/.exec(where)?.[1]
        const i = after ? docs[file].search(new RegExp(`^## ${esc(after)}`, 'm')) : -1
        if (i < 0) { stale.push(`${file}: no "## ${after}" to put a section after`); continue }
        const next = docs[file].slice(i + 3).search(/^## /m)
        const at = next < 0 ? docs[file].length : i + 3 + next
        docs[file] = `${docs[file].slice(0, at)}${unquote(body)}\n\n${docs[file].slice(at)}`
      }
      ok(parts >= 4 && !stale.length, 'HOSTED.md\'s policy drafts still quote PRIVACY.md and TERMS.md as they are', { parts, stale })
      const pasted = ready(docs['PRIVACY.md'], docs['TERMS.md'])
      ok(!pasted.length, 'and pasted in, they pass the check', pasted)
    }
  }
} catch (e) {
  ok(false, `the test ran to the end: ${e.stack}`)
}
process.exit(done().fail ? 1 : 0)
