// Bridge AI's hosted relay (relay/worker.js with HOSTED on, relay/HOSTED.md), run in Node with a
// Durable Object for each name, as test/stand-ins/relay.mjs runs one, so nothing reaches Cloudflare.
// The free plan's limits: a computer that uses up its day is told so with when it resets, and so is
// its phone, and a new phone is turned away saying the same; too big, too much at once and too many
// phones connected each tell the phone and the computer. Plans: a computer starts on free, POST
// /_relay/plan (behind PLAN_TOKEN) moves it to another of PLANS, its limits change at once and its
// computer hears its plan, it's kept when the Hub starts again, and a plan PLANS no longer has is
// free. A relay of your own (HOSTED unset) has none of it. Cost watching: GET /_relay/stats, behind
// STATS_TOKEN (and not there at all without one), gives each day's computers, connections, messages,
// data and limits reached, the busiest computers by id, the requests that comes to and when to move
// to Workers Paid; nothing in it, or in the Analytics Engine's points, is an address or a token. The
// docs: every setting in wrangler.hosted.toml is in HOSTED.md's table with the same default. And the
// one switch: server/hosted.js's HOSTED_URL set while PRIVACY.md or TERMS.md lack the hosted relay's
// section fails, PRIVACY.md doesn't describe a hosted relay that isn't live, and HOSTED.md's drafts
// still match the policy they change and, pasted in, pass.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, checks, until } from '../lib/harness.mjs'
import { bundle } from '../../relay/build.js'

const { ok, done } = checks('relay-hosted')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')

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
// A Durable Object namespace: one Hub per name, each with storage of its own (copied in and out, as
// Cloudflare stores it), and restart(name) for one put to sleep and woken.
function namespace(env) {
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
    const hub = new worker.Hub(ctx, env)
    const o = { name, hub, ctx, store, fetch: async (input, init) => { await ctx.ready; return hub.fetch(input instanceof Request ? input : new Request(input, init)) } }
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

const DOMAIN = 'relay.test'
const IP = '203.0.113.9'
// A hosted relay with these settings, and what it counted for Analytics Engine.
function relay(vars = {}) {
  const points = []
  const env = { HOSTED: '1', HOSTED_DOMAIN: DOMAIN, STATS: { writeDataPoint: (p) => points.push(p) }, ...vars }
  env.HUB = namespace(env)
  const call = (url, init = {}) => worker.default.fetch(new Request(url, init), env)
  const register = async () => (await call(`https://${DOMAIN}/_relay/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': IP }, body: JSON.stringify({ version: '3.9.2' }) })).json()
  // A WebSocket to a computer's address: the relay's end of it, or the refusal.
  const socket = async (id, p, headers = {}) => {
    const r = await call(`https://${id}.${DOMAIN}${p}`, { headers: { Upgrade: 'websocket', ...headers } })
    return r.upgrade ? r.webSocket.server : r
  }
  const computer = async (c) => socket(c.id, '/_relay/host', { Authorization: `Bearer ${c.token}`, 'X-Bridge-Version': '3.9.2' })
  const phone = (c) => socket(c.id, '/_relay/link')
  const hubOf = (c) => env.HUB.of(c.id).hub
  const say = (c, end, m) => hubOf(c).webSocketMessage(end, m)
  const ends = (c, end, code = 1000) => { end.readyState = 3; return hubOf(c).webSocketClose(end, code) }
  return { env, points, call, register, computer, phone, hubOf, say, ends }
}
const bytes = (n) => new Uint8Array(n).fill(7).buffer
const frame = (op, id, payload = new Uint8Array(0)) => { const b = new Uint8Array(payload); const out = new Uint8Array(5 + b.byteLength); out[0] = op; new DataView(out.buffer).setUint32(1, id); out.set(b, 5); return out.buffer }
const OK = 4
const midnight = () => Date.parse(new Date().toISOString().slice(0, 10)) + 864e5

try {
  // ---------- The free plan: a day's allowance used up ----------
  {
    const r = relay({ DAILY_MESSAGES: '50' })
    const c = await r.register()
    ok(/^[a-z2-7]{12}$/.test(c.id) && c.token, 'a computer registers on the hosted relay', c)
    const host = await r.computer(c)
    const plan = host.said('plan')[0]
    ok(plan?.plan === 'free' && plan.dayMessages === 50 && plan.dayMB === 512 && plan.resets === midnight(), 'it starts on the free plan, and hears its plan and daily allowance as it connects', host.got)
    const ph = await r.phone(c)
    ok(ph instanceof End && ph.readyState === 1, 'a phone connects to it', ph)
    for (let i = 0; i < 49; i++) await r.say(c, ph, bytes(64))
    ok(!ph.said('limit').length && !host.said('limit').length && ph.readyState === 1, 'within the allowance nothing is said and nothing is cut', ph.got.filter((m) => m?.t))
    for (let i = 0; i < 3; i++) await r.say(c, ph, bytes(64))
    const toPhone = ph.said('limit')[0]
    const toHost = host.said('limit')[0]
    ok(toPhone?.why === 'day' && toPhone.until === midnight() && /daily limit for this computer is used up/.test(toPhone.text) && /50 messages or 512 MB a day on the free plan/.test(toPhone.text) && /resets at 00:00 UTC/.test(toPhone.text) && /your own Cloudflare account/.test(toPhone.text), 'past it, the phone is told plainly: the daily limit, the free plan\'s allowance, when it resets, and how to have no limits', toPhone)
    ok(ph.closed?.[0] === 4005, 'and is let go until then', ph.closed)
    ok(toHost?.why === 'day' && toHost.until === midnight() && host.readyState === 1, 'the computer is told the same, and stays connected for when it resets', { toHost, state: host.readyState })
    const again = await r.phone(c)
    ok(again instanceof End && again.got[0]?.t === 'limit' && again.got[0].why === 'day' && again.closed?.[0] === 4005, 'a phone connecting again before the reset is turned away with the same message, not a silent close', again.got)
    const reconnect = await r.computer(c)
    ok(reconnect.said('limit')[0]?.why === 'day', 'and the computer connecting again hears it is still used up', reconnect.got)
    ok(r.points.some((p) => p.blobs[0] === 'limit' && p.blobs[1] === 'day' && p.indexes[0] === c.id), 'the limit reached is counted for the project, by the computer\'s id', r.points.map((p) => p.blobs))
  }

  // ---------- Plans: the hook ----------
  {
    const r = relay({ DAILY_MESSAGES: '50', PLANS: JSON.stringify({ plus: { dayMessages: 500, phones: 3 } }) })
    const c = await r.register()
    const host = await r.computer(c)
    const set = (body, token) => r.call(`https://${DOMAIN}/_relay/plan`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
    ok((await set({ id: c.id, plan: 'plus' })).status === 404, 'with no PLAN_TOKEN, there\'s no way to set a plan at all (404)')
    r.env.PLAN_TOKEN = 'plan-secret-for-tests'
    ok((await set({ id: c.id, plan: 'plus' })).status === 403 && (await set({ id: c.id, plan: 'plus' }, 'wrong')).status === 403, 'with one, a missing or wrong token is refused (403)')
    ok((await r.call(`https://${c.id}.${DOMAIN}/_relay/plan`, { method: 'POST', headers: { Authorization: 'Bearer plan-secret-for-tests' }, body: '{}' })).status === 404, 'a computer\'s own address has no plan to set (only the bare domain does)')
    const bad = await set({ id: c.id, plan: 'gold' }, 'plan-secret-for-tests')
    ok(bad.status === 400 && /free, plus/.test((await bad.json()).error), 'a plan PLANS doesn\'t have is refused, saying which there are', bad.status)
    ok((await set({ id: 'aaaaaaaaaaaa', plan: 'plus' }, 'plan-secret-for-tests')).status === 404, 'and a computer that isn\'t registered is a 404')
    const asked = await (await set({ id: c.id }, 'plan-secret-for-tests')).json()
    ok(asked.plan === 'free' && asked.limits?.dayMessages === 50 && asked.today?.messages === 0, 'asked without a plan, it says which plan a computer is on, its limits and today\'s use', asked)
    const moved = await (await set({ id: c.id, plan: 'plus' }, 'plan-secret-for-tests')).json()
    ok(moved.plan === 'plus' && moved.limits.dayMessages === 500 && moved.limits.phones === 3 && moved.limits.dayMB === 512, 'moved to plus: its limits are what plus raises, and the free plan\'s for the rest', moved)
    ok(host.said('plan').at(-1)?.plan === 'plus' && host.said('plan').at(-1).dayMessages === 500, 'and its computer hears the new plan at once', host.said('plan'))
    ok(r.points.some((p) => p.blobs[0] === 'plan' && p.blobs[1] === 'plus'), 'a plan change is counted for the project', r.points.map((p) => p.blobs))
    const ph = await r.phone(c)
    for (let i = 0; i < 120; i++) await r.say(c, ph, bytes(64))
    ok(!ph.said('limit').length, 'past the free plan\'s allowance, a computer on plus carries on', ph.said('limit'))
    for (let i = 0; i < 400; i++) await r.say(c, ph, bytes(64))
    ok(/500 messages or 512 MB a day on the plus plan/.test(ph.said('limit')[0]?.text || ''), 'until its own plan\'s allowance, which its message names', ph.said('limit')[0])
    r.env.HUB.restart(c.id)
    const after = await (await set({ id: c.id }, 'plan-secret-for-tests')).json()
    ok(after.plan === 'plus' && after.today.messages > 500, 'its plan, and today\'s use, are kept when its Hub starts again', after)
    r.env.PLANS = '{}'
    r.env.HUB.restart(c.id)
    const gone = await (await set({ id: c.id }, 'plan-secret-for-tests')).json()
    ok(gone.plan === 'free' && gone.limits.dayMessages === 50, 'a plan PLANS no longer has gets the free plan\'s limits', gone)
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
    ok(third instanceof End && third.got[0]?.t === 'limit' && third.got[0].why === 'phones' && /takes 2 connections to one computer at once/.test(third.got[0].text) && third.got[0].until > Date.now() && third.closed?.[0] === 4005, 'with as many paired phones connected as the plan takes, one more is told why and when it tries again, not left with a bare 429', third.got[0])
    const told = host.said('limit').find((m) => m.why === 'phones')
    ok(told && /A phone was turned away/.test(told.text) && /2 connections to this computer at once \(the free plan\)/.test(told.text), 'and the computer is told a phone was turned away, and why', told)
    await r.say(c, a, bytes(5 * 1024))
    ok(a.said('limit')[0]?.why === 'size' && /over 4 KB at once/.test(a.said('limit')[0].text) && a.closed?.[0] === 4005, 'a message too big: that phone is told, and reconnects', a.said('limit'))
    ok(/over 4 KB/.test(host.said('limit').find((m) => m.why === 'size')?.text || ''), 'and the computer is told too', host.said('limit'))
    for (let i = 0; i < 10 && b.readyState === 1; i++) await r.say(c, b, bytes(16))
    ok(b.said('limit')[0]?.why === 'rate' && /Too much at once/.test(b.said('limit')[0].text) && b.closed?.[0] === 4005, 'too much at once: that phone is told, and reconnects a moment later', b.said('limit'))
    ok(/sent more at once than Bridge AI's relay takes/.test(host.said('limit').find((m) => m.why === 'rate')?.text || ''), 'and the computer hears it', host.said('limit'))
  }

  // ---------- A relay of your own: no limits ----------
  {
    const hub = namespace({}).get('hub')
    const env = { HOST_TOKEN: 'own-relay-token', HUB: { idFromName: () => 'hub', get: () => hub }, DAILY_MESSAGES: '50', MAX_MESSAGE_KB: '4', MESSAGE_BURST: '6', MESSAGES_PER_SECOND: '1', STATS_TOKEN: 's', PLAN_TOKEN: 'p' }
    const sock = async (p, headers = {}) => { const res = await worker.default.fetch(new Request(`https://own.example.workers.dev${p}`, { headers: { Upgrade: 'websocket', ...headers } }), env); return res.webSocket?.server || res }
    const host = await sock('/_relay/host', { Authorization: 'Bearer own-relay-token' })
    const ph = await sock('/_relay/link')
    for (let i = 0; i < 2500; i++) await hub.hub.webSocketMessage(ph, bytes(16))
    await hub.hub.webSocketMessage(ph, bytes(300 * 1024))
    const relayed = host.got.filter((m) => m instanceof Uint8Array && m[0] === 1).length
    ok(relayed === 2501 && ph.readyState === 1 && ![...host.got, ...ph.got].some((m) => m?.t === 'limit' || m?.t === 'plan'), 'on a relay of your own (HOSTED unset) the limit settings do nothing: 2,501 messages, one of 300 KB, all relayed, nothing said, nothing cut', { relayed, state: ph.readyState })
    const s = await worker.default.fetch(new Request('https://own.example.workers.dev/_relay/stats', { headers: { Authorization: 'Bearer s' } }), env)
    const p = await worker.default.fetch(new Request('https://own.example.workers.dev/_relay/plan', { method: 'POST', headers: { Authorization: 'Bearer p' }, body: '{}' }), env)
    ok(s.status === 404 && p.status === 404, 'and has no stats or plans to ask for', [s.status, p.status])
  }

  // ---------- Cost watching: /_relay/stats ----------
  {
    const r = relay({ DAILY_MESSAGES: '1200', REGISTER_PER_IP: '2' })
    const busy = await r.register()
    const quiet = await r.register()
    const refused = await r.call(`https://${DOMAIN}/_relay/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': IP }, body: '{}' })
    ok(refused.status === 429, 'a third computer from one network today is refused (REGISTER_PER_IP)', refused.status)
    const h1 = await r.computer(busy)
    const p1 = await r.phone(busy)
    for (let i = 0; i < 1250 && p1.readyState === 1; i++) await r.say(busy, p1, bytes(100))
    const h2 = await r.computer(quiet)
    const p2 = await r.phone(quiet)
    for (let i = 0; i < 20; i++) await r.say(quiet, p2, bytes(100))
    await r.ends(quiet, p2)
    await r.ends(quiet, h2)
    const stats = (token, host = DOMAIN, q = '') => r.call(`https://${host}/_relay/stats${q}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
    ok((await stats('anything')).status === 404, 'with no STATS_TOKEN, /_relay/stats isn\'t there at all (404)')
    r.env.STATS_TOKEN = 'stats-secret-for-tests'
    ok((await stats()).status === 403 && (await stats('wrong')).status === 403, 'with one, no token or a wrong one is refused (403)')
    ok((await stats('stats-secret-for-tests', `${busy.id}.${DOMAIN}`)).status === 404, 'and a computer\'s own address has none')
    const today = new Date().toISOString().slice(0, 10)
    const got = await until(async () => { const j = await (await stats('stats-secret-for-tests')).json(); const d = j.days?.[0]; return d && d.messages >= 1221 && d.connections.phones >= 2 ? j : null }, 5000, 50)
    const d = got?.days?.[0] || {}
    ok(d.day === today && d.registered === 2 && d.refused === 1 && d.computers === 2 && d.connections.computers === 2 && d.connections.phones === 2, 'with the token: today\'s computers set up and refused, computers in use, and connections', d)
    ok(d.messages >= 1221 && d.bytes >= 122100 && d.limits.day === 1, 'messages and data relayed, and limits reached', { messages: d.messages, bytes: d.bytes, limits: d.limits })
    ok(d.top?.[0]?.id === busy.id && d.top[0].ofAllowance >= 1 && d.top[0].plan === 'free' && d.top.some((x) => x.id === quiet.id && x.messages === 20), 'and the day\'s busiest computers by id, with how much of their allowance each used, so a runaway one stands out', d.top)
    ok(d.requests >= Math.ceil(1221 / 20) && typeof got?.note === 'string' && /Workers Free/.test(got.note) && got.requests?.workers === 'free' && got.requests.today === d.requests, 'what that comes to in Cloudflare requests, and when it\'s time for Workers Paid', { requests: got?.requests, note: got?.note })
    ok(got?.days?.length === 7 && (await (await stats('stats-secret-for-tests', DOMAIN, '?days=30')).json()).days.length === 30, 'the last 7 days by default, up to 35 asked for', got?.days?.length)
    const all = JSON.stringify(got) + JSON.stringify(r.points)
    ok(!all.includes(IP) && !all.includes(busy.token) && !all.includes(quiet.token) && !/203\.0\.113/.test(all), 'nothing in the stats or the counts is an IP address or a token', all.slice(0, 300))
    r.env.WORKERS_PAID = '1'
    const paid = await (await stats('stats-secret-for-tests')).json()
    ok(paid.requests.workers === 'paid' && /Workers Paid's included million/.test(paid.note), 'on Workers Paid, measured against its included million a month', paid.note)
    // Busy enough that Workers Free would run out: the note says to move.
    r.env.WORKERS_PAID = '0'
    const reg = r.env.HUB.of('registry')
    const s = reg.store.get(`s:${today}`)
    reg.store.set(`s:${today}`, { ...s, messages: 1_200_000 })
    const busyDay = await (await stats('stats-secret-for-tests')).json()
    ok(/move to Workers Paid \(\$5 a month\) now/.test(busyDay.note), 'past half of Workers Free\'s 100,000 requests a day, it says to move to Workers Paid now', busyDay.note)
    // The registry forgets after 35 days.
    reg.store.set('s:2020-01-01', s)
    await reg.hub.alarm()
    ok(!reg.store.has('s:2020-01-01') && reg.store.has(`s:${today}`), 'a day\'s counts go after 35 days', [...reg.store.keys()].filter((k) => k.startsWith('s:')))
  }

  // ---------- The docs say what the config does ----------
  {
    const toml = read('relay', 'wrangler.hosted.toml')
    const md = read('relay', 'HOSTED.md')
    const vars = Object.fromEntries([...toml.slice(toml.indexOf('[vars]')).matchAll(/^([A-Z_]+) = "([^"]*)"/gm)].map((m) => [m[1], m[2]]))
    const missing = Object.entries(vars).filter(([k, v]) => !new RegExp(`^\\| \`${k}\` \\| ${v === '' || ['HOSTED', 'HOSTED_DOMAIN'].includes(k) ? '' : `\`${v.replace(/[{}]/g, '\\$&')}\``}`, 'm').test(md))
    ok(Object.keys(vars).length >= 14 && !missing.length, 'every setting in wrangler.hosted.toml is in HOSTED.md\'s table, with the same default', missing)
    ok(/STATS_TOKEN/.test(md) && /PLAN_TOKEN/.test(md) && /^## Plans$/m.test(md) && /\[observability\]\nenabled = false/.test(toml), 'and its secrets, its Plans section, and the Worker\'s logs off', null)
  }

  // ---------- The one switch: HOSTED_URL, and the policy ----------
  {
    const urlOf = (src) => /export const HOSTED_URL = '([^']*)'/.exec(src)?.[1]
    const HOSTED_URL = urlOf(read('server', 'hosted.js'))
    ok(HOSTED_URL !== undefined, 'server/hosted.js has HOSTED_URL, the one place the hosted relay is switched on', null)
    const privacy = read('PRIVACY.md')
    const terms = read('TERMS.md')
    const section = (doc, heading) => { const i = doc.search(new RegExp(`^## ${heading}`, 'm')); if (i < 0) return null; const rest = doc.slice(i + 3); const j = rest.search(/^## /m); return j < 0 ? rest : rest.slice(0, j) }
    // What the policy must say once the hosted relay is live.
    const ready = (p, t) => {
      const s = section(p, 'Bridge AI\'s relay')
      if (!s) return ['PRIVACY.md has no "## Bridge AI\'s relay" section']
      const need = [['that it\'s end-to-end encrypted', /end-to-end encrypted/], ['what it sees', /IP addresses/], ['that it keeps a hash of the token', /hash of the token/], ['what it counts', /counts/], ['its limits', /limit/], ['that it may change or gain paid plans', /paid plans?/], ['how to stop using it', /Stop using the relay/]]
      return [...need.filter(([, re]) => !re.test(s)).map(([w]) => `PRIVACY.md's section doesn't say ${w}`), ...(section(t, 'Bridge AI\'s relay') ? [] : ['TERMS.md has no "## Bridge AI\'s relay" section'])]
    }
    const problems = HOSTED_URL ? ready(privacy, terms) : []
    ok(!problems.length, 'HOSTED_URL is set only with PRIVACY.md and TERMS.md saying what the hosted relay sees, keeps and limits', problems)
    ok(HOSTED_URL || !section(privacy, 'Bridge AI\'s relay'), 'and while it\'s empty, PRIVACY.md doesn\'t describe a hosted relay that isn\'t there', null)
    ok(ready(privacy, terms).length > 0, 'the check itself: with HOSTED_URL set and today\'s policy, it fails', ready(privacy, terms))
    // HOSTED.md's drafts: each "Replace" quotes the policy as it is now, and pasted in, they pass.
    const md = read('relay', 'HOSTED.md')
    const drafts = md.slice(md.indexOf('## Policy text to add when it goes live'))
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
} catch (e) {
  ok(false, `the test ran to the end: ${e.stack}`)
}
process.exit(done().fail ? 1 : 0)
