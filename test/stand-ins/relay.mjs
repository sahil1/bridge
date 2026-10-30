// A relay for tests: relay/worker.js itself (its Hub, the phone page), run in Node on this
// computer instead of on Cloudflare, so devices pair and link for real, end to end, with nothing
// leaving the machine. Cloudflare's WebSocket hibernation is stood in for by a few lines over `ws`.
//   node relay.mjs <port> <token>
// And, for tests, what a real network does to a connection:
//   POST /_test/freeze   connections stay open but nothing gets through (a Mac that slept)
//   POST /_test/thaw     as before
//   POST /_test/drop     every connection closes at once (a network that changed)
//   POST /_test/net?ms=60&host=15&kbps=8000   a phone on a mobile network: each message to or from
//                        a phone (and each of the page's files) takes ms to get there, the computer's
//                        host ms, and none goes faster than kbps; /_test/net alone: as fast as it goes
//   POST /_test/silence  the phones' connections go dead without a word (a phone that slept, a
//                        network that dropped them): nothing more gets through them, new ones work.
//                        ?who=host: the computer's
//   POST /_test/count    start counting again
//   GET  /_test/state    how many computers and phones are connected, the phones' messages each way
//                        (up, down and their bytes) and the bytes of the page's files (page)
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { bundle } from '../../relay/build.js'

const [port, token] = process.argv.slice(2)
const { build, code } = bundle()
// The bundle starts with its files and build; the worker after them is a module of its own.
globalThis.FILES = JSON.parse(code.slice('const FILES = '.length, code.indexOf('\nconst RELAY_BUILD')))
globalThis.RELAY_BUILD = build

// ---------- what Cloudflare gives a Worker ----------
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res } }
const OrigResponse = globalThis.Response
globalThis.Response = class extends OrigResponse {
  constructor(body, init = {}) {
    // A WebSocket's 101 isn't a status Node's Response allows.
    super(body, { ...init, status: init.status === 101 ? 200 : init.status })
    if (init.status === 101) { this.upgrade = true; this.webSocket = init.webSocket }
  }
}
// The relay's end of a WebSocket: what the Hub sends goes out once the real socket is there.
class End {
  constructor() { this.readyState = 1; this.out = []; this.real = null; this.att = null; this.tags = [] }
  send(m) {
    if (this.readyState !== 1) throw new Error('closed')
    if (frozen || this.dead) return
    if (!this.real) return this.out.push(m)
    count(this, 'down', m)
    const real = this.real
    this.wire ||= pipe(this)
    this.wire(size(m), () => { if (real.readyState === 1) real.send(m) })
  }
  close(code, why) {
    if (this.readyState === 3) return
    this.readyState = 3
    const c = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000
    if (this.real) try { this.real.close(c, why) } catch { /* gone */ } else this.pendingClose = [c, why]
  }
  accept() { /* refuse() uses it */ }
  serializeAttachment(a) { this.att = a }
  deserializeAttachment() { return this.att }
}
globalThis.WebSocketPair = class { constructor() { const server = new End(); return { 0: { server }, 1: server } } }

const store = new Map()
const storage = {
  async get(k) { return Array.isArray(k) ? new Map(k.map((x) => [x, store.get(x)])) : store.get(k) },
  async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, b); else store.set(k, v) },
  async delete(k) { for (const x of [].concat(k)) store.delete(x) },
  async list({ prefix = '', limit } = {}) { const all = [...store].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)); return new Map(limit ? all.slice(0, limit) : all) },
  async getAlarm() { return null },
  async setAlarm() {},
  async deleteAlarm() {},
  async deleteAll() { store.clear() },
}
const sockets = new Set()
const ctx = {
  storage,
  setWebSocketAutoResponse(pair) { this.auto = pair },
  blockConcurrencyWhile: (fn) => fn(),
  acceptWebSocket(ws, tags) { ws.tags = tags; sockets.add(ws) },
  getWebSockets(tag) { return [...sockets].filter((w) => w.readyState === 1 && (!tag || w.tags.includes(tag))) },
  getTags(ws) { return ws.tags },
}
const worker = await import('../../relay/worker.js')
const hub = new worker.Hub(ctx, {})
const env = { HOST_TOKEN: token, HUB: { idFromName: () => 'hub', get: () => hub } }

let frozen = false
// The network between the relay and each end (POST /_test/net), and what went over it.
const net = { ms: 0, host: 0, kbps: 0 }
const sent = { up: 0, down: 0, upBytes: 0, downBytes: 0, page: 0 }
const size = (m) => (typeof m === 'string' ? Buffer.byteLength(m) : m.byteLength)
const isHost = (end) => end.tags.includes('host')
const legMs = (end) => (isHost(end) ? net.host : net.ms)
// Phones' messages only: to the phone (down) and from it (up).
function count(end, way, m) { if (isHost(end)) return; sent[way]++; sent[`${way}Bytes`] += size(m) }
// One way of one connection: each message arrives legMs later, no faster than kbps allows, in order.
function pipe(end) {
  const q = []
  let timer = null
  let free = 0
  let last = 0
  const run = () => {
    timer = null
    const now = Date.now()
    while (q.length && q[0].at <= now) q.shift().fn()
    if (q.length) timer = setTimeout(run, q[0].at - now)
  }
  return (bytes, fn) => {
    const ms = legMs(end)
    const kbps = isHost(end) ? 0 : net.kbps
    if (!ms && !kbps && !q.length) return fn()
    const now = Date.now()
    free = Math.max(now, free) + (kbps ? (bytes * 8) / kbps : 0)
    last = Math.max(last, free + ms)
    q.push({ at: last, fn })
    if (!timer) timer = setTimeout(run, Math.max(0, q[0].at - now))
  }
}
const later = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : null)
const wss = new WebSocketServer({ noServer: true })
const request = (req) => new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string') })

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/_test/')) {
    const what = req.url.slice(7)
    if (what === 'freeze') frozen = true
    else if (what === 'thaw') frozen = false
    else if (what.startsWith('net')) {
      const q = new URL(req.url, 'http://x').searchParams
      Object.assign(net, { ms: Number(q.get('ms')) || 0, host: Number(q.get('host')) || 0, kbps: Number(q.get('kbps')) || 0 })
    } else if (what.startsWith('silence')) {
      const host = new URL(req.url, 'http://x').searchParams.get('who') === 'host'
      for (const w of sockets) if (isHost(w) === host) w.dead = true
    }
    else if (what === 'count') Object.assign(sent, { up: 0, down: 0, upBytes: 0, downBytes: 0, page: 0 })
    else if (what === 'drop') for (const w of sockets) try { w.real?.terminate() } catch { /* gone */ }
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify({ frozen, net, sent, computers: ctx.getWebSockets('host').length, phones: ctx.getWebSockets('phone').length }))
  }
  const r = await worker.default.fetch(request(req), env)
  const body = Buffer.from(await r.arrayBuffer())
  sent.page += body.byteLength
  // A file of the page, over the phone's network: there and back, and its bytes.
  await later(net.ms * 2 + (net.kbps ? (body.byteLength * 8) / net.kbps : 0))
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(body)
})

server.on('upgrade', async (req, socket, head) => {
  // Connecting takes a trip there and back.
  await later((req.url.startsWith('/_relay/host') ? net.host : net.ms) * 2)
  const r = await worker.default.fetch(request(req), env)
  if (!r.upgrade) { socket.end(`HTTP/1.1 ${r.status} ${http.STATUS_CODES[r.status] || ''}\r\n\r\n`); return }
  const end = r.webSocket.server
  wss.handleUpgrade(req, socket, head, (real) => {
    end.real = real
    for (const m of end.out.splice(0)) real.send(m)
    if (end.pendingClose) return real.close(...end.pendingClose)
    const wire = pipe(end)
    real.on('message', (data, isBinary) => {
      if (frozen || end.dead) return
      const text = isBinary ? null : String(data)
      const msg = isBinary ? new Uint8Array(data).buffer : text
      wire(size(msg), () => {
        if (frozen || end.dead || end.readyState !== 1) return
        if (text != null && ctx.auto && text === ctx.auto.req) return end.send(ctx.auto.res) // a keepalive, answered here
        count(end, 'up', msg)
        hub.webSocketMessage(end, msg).catch((e) => console.error('relay stand-in:', e.message))
      })
    })
    real.on('close', (c) => {
      const was = end.readyState
      end.readyState = 3
      if (was !== 3 || sockets.has(end)) hub.webSocketClose(end, c).catch(() => {}).finally(() => sockets.delete(end))
    })
    real.on('error', () => {})
  })
})

server.listen(Number(port), '127.0.0.1', () => console.log(`relay stand-in on ${port}`))
