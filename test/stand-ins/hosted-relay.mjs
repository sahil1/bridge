// Bridge AI's hosted relay for tests: relay/worker.js with HOSTED on, run in Node on this computer
// with a Durable Object for each name kept in memory (a Hub per computer, an Account per account),
// so the app registers with it and connects to it, or is turned away (full, its account stopped,
// switched off), with nothing leaving the machine. Its domain is localhost (it listens on 127.0.0.1,
// and takes that as localhost too), so a computer's address is <id>.localhost. Relay tokens are
// checked with ACCOUNTS_PUBLIC_KEY (the harness's test key), and ACCOUNTS_URL is the accounts
// stand-in, which the ACCOUNTS binding reaches through its Relay entrypoint (stand-ins/accounts.mjs,
// /_test/relay/...).
//   node hosted-relay.mjs <port> [its settings as JSON, e.g. '{"MAX_ACCOUNTS":"1"}']
//   POST /_test/vars   more settings (JSON), from then on
//   POST /_test/down   computers' addresses can't be reached (each connection dropped), as with no
//                      network; the bare domain still answers. POST /_test/up: as before
//   POST /_test/clock  { shift }: its clock, that many ms ahead of the real one
//   POST /_test/use    { a, n }: n messages counted to account a, as its other computers' Hubs would
//                      tell its Account (each of its computers hears what that comes to)
//   GET  /_test/state  how many computers are connected
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { bundle } from '../../relay/build.js'

const [port, vars = '{}'] = process.argv.slice(2)
const realNow = Date.now
let shift = 0
Date.now = () => realNow() + shift
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
// The relay's end of a WebSocket: what the Hub sends goes out once the real socket is there.
class End {
  constructor() { this.readyState = 1; this.out = []; this.real = null; this.att = null; this.tags = [] }
  send(m) { if (this.readyState !== 1) throw new Error('closed'); if (this.real) this.real.send(m); else this.out.push(m) }
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
const worker = await import('../../relay/worker.js')

const env = { HOSTED: '1', HOSTED_DOMAIN: 'localhost', ID_SECRET: 'the stand-in\'s own', ...JSON.parse(vars) }
// One object per name, each taking its requests one at a time (as Cloudflare's input gates do).
function namespace(Class) {
  const objs = new Map()
  const make = (name) => {
    const store = new Map()
    const sockets = new Set()
    const copy = (v) => (v === undefined ? undefined : structuredClone(v))
    let alarm = null
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
      setWebSocketAutoResponse(pair) { this.auto = pair },
      getWebSocketAutoResponseTimestamp: () => null,
      blockConcurrencyWhile(fn) { this.ready = fn(); return this.ready },
      acceptWebSocket(ws, tags) { ws.tags = tags; sockets.add(ws) },
      getWebSockets(tag) { return [...sockets].filter((w) => w.readyState === 1 && (!tag || w.tags.includes(tag))) },
      getTags: (ws) => ws.tags,
    }
    const obj = new Class(ctx, env)
    let line = Promise.resolve()
    const o = {
      obj, ctx, sockets,
      fetch(input, init) {
        const run = line.then(async () => { await ctx.ready; return obj.fetch(input instanceof Request ? input : new Request(input, init)) })
        line = run.catch(() => {})
        return run
      },
    }
    objs.set(name, o)
    return o
  }
  return { idFromName: (n) => n, get: (n) => objs.get(n) || make(n), of: (n) => objs.get(n), all: () => [...objs.values()] }
}
env.HUB = namespace(worker.Hub)
env.ACCOUNT = namespace(worker.Account)
// The service binding to the accounts service: its stand-in, by the way only the relay's binding
// reaches it.
if (env.ACCOUNTS_URL) {
  env.ACCOUNTS = {
    fetch: async (input, init) => {
      const r = input instanceof Request ? input : new Request(input, init)
      const u = new URL(r.url)
      return fetch(`${env.ACCOUNTS_URL}/_test/relay${u.pathname}${u.search}`, { method: r.method, headers: r.headers, body: ['GET', 'HEAD'].includes(r.method) ? undefined : await r.arrayBuffer() })
    },
  }
}

let down = false
const hostOf = (req) => String(req.headers.host || `localhost:${port}`).replace(/^127\.0\.0\.1(?=:|$)/, 'localhost')
const request = (req, body) => new Request(`http://${hostOf(req)}${req.url}`, { method: req.method, headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'), body: body && !['GET', 'HEAD'].includes(req.method) ? body : undefined })
const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  if (req.url.startsWith('/_test/')) {
    const said = JSON.parse(String(body) || '{}')
    let out = { ok: true }
    if (req.url === '/_test/vars') Object.assign(env, said)
    if (req.url === '/_test/down' || req.url === '/_test/up') down = req.url === '/_test/down'
    if (req.url === '/_test/clock') shift = Number(said.shift) || 0
    if (req.url === '/_test/use') out = await env.ACCOUNT.get(said.a).fetch('https://account/_account/tally', { method: 'POST', body: JSON.stringify({ a: said.a, n: said.n }) }).then((r) => r.json())
    if (req.url === '/_test/state') out = { computers: env.HUB.all().reduce((n, o) => n + o.ctx.getWebSockets('host').length, 0) }
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify(out))
  }
  if (down && hostOf(req) !== `localhost:${port}`) return req.socket.destroy()
  const r = await worker.default.fetch(request(req, body), env)
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
})
// A computer connecting through its address (<id>.localhost): its Hub takes it, or turns it away
// with a message, as on Cloudflare.
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', async (req, socket, head) => {
  if (down) return socket.destroy()
  const r = await worker.default.fetch(request(req), env)
  if (!r.upgrade) { socket.end(`HTTP/1.1 ${r.status} ${http.STATUS_CODES[r.status] || ''}\r\n\r\n`); return }
  const end = r.webSocket.server
  const hubOf = () => env.HUB.all().find((o) => o.sockets.has(end))?.obj
  wss.handleUpgrade(req, socket, head, (real) => {
    end.real = real
    for (const m of end.out.splice(0)) real.send(m)
    if (end.pendingClose) return real.close(...end.pendingClose)
    real.on('message', (data, isBinary) => {
      if (end.readyState !== 1) return
      const text = isBinary ? null : String(data)
      if (text === 'ping') return end.send('pong') // a keepalive, answered here
      hubOf()?.webSocketMessage(end, isBinary ? new Uint8Array(data).buffer : text).catch((e) => console.error('hosted relay stand-in:', e.message))
    })
    real.on('close', (c) => {
      end.readyState = 3
      const o = env.HUB.all().find((x) => x.sockets.has(end))
      if (o) o.obj.webSocketClose(end, c).catch(() => {}).finally(() => o.sockets.delete(end))
    })
    real.on('error', () => {})
  })
})
server.listen(Number(port), '127.0.0.1')
