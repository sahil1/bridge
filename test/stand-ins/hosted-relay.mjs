// Bridge AI's hosted relay for tests: relay/worker.js with HOSTED on, run in Node on this computer
// with a Durable Object for each name kept in memory, so the app registers with it, or is turned
// away (full, switched off), with nothing leaving the machine. Its domain is localhost (it listens
// on 127.0.0.1, and takes that as localhost too), so a computer's address is <id>.localhost. HTTP
// only: nothing connects through a computer's address; the relay-hosted test runs the connections,
// in one process.
//   node hosted-relay.mjs <port> [its settings as JSON, e.g. '{"MAX_COMPUTERS":"1"}']
//   POST /_test/vars   more settings (JSON), from then on
//   POST /_test/down   computers' addresses can't be reached (each connection dropped), as with no
//                      network; the bare domain still answers. POST /_test/up: as before
import http from 'node:http'
import { bundle } from '../../relay/build.js'

const [port, vars = '{}'] = process.argv.slice(2)
const { build, code } = bundle()
globalThis.FILES = JSON.parse(code.slice('const FILES = '.length, code.indexOf('\nconst RELAY_BUILD')))
globalThis.RELAY_BUILD = build
globalThis.WebSocketRequestResponsePair = class { constructor(req, res) { this.req = req; this.res = res } }
const worker = await import('../../relay/worker.js')

const env = { HOSTED: '1', HOSTED_DOMAIN: 'localhost', ...JSON.parse(vars) }
// One Hub per name, each taking its requests one at a time (as Cloudflare's input gates do).
const objs = new Map()
function make(name) {
  const store = new Map()
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
    setWebSocketAutoResponse() {},
    getWebSocketAutoResponseTimestamp: () => null,
    blockConcurrencyWhile(fn) { this.ready = fn(); return this.ready },
    acceptWebSocket() {},
    getWebSockets: () => [],
    getTags: () => [],
  }
  const hub = new worker.Hub(ctx, env)
  let line = Promise.resolve()
  return {
    fetch(input, init) {
      const run = line.then(async () => { await ctx.ready; return hub.fetch(input instanceof Request ? input : new Request(input, init)) })
      line = run.catch(() => {})
      return run
    },
  }
}
env.HUB = { idFromName: (n) => n, get: (n) => objs.get(n) || objs.set(n, make(n)).get(n) }

let down = false
const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  if (req.url.startsWith('/_test/')) {
    if (req.url === '/_test/vars') Object.assign(env, JSON.parse(String(body) || '{}'))
    if (req.url === '/_test/down' || req.url === '/_test/up') down = req.url === '/_test/down'
    res.setHeader('content-type', 'application/json')
    return res.end('{"ok":true}')
  }
  const headers = Object.entries(req.headers).filter(([, v]) => typeof v === 'string')
  const host = String(req.headers.host || `localhost:${port}`).replace(/^127\.0\.0\.1(?=:|$)/, 'localhost')
  if (down && host !== `localhost:${port}`) return req.socket.destroy()
  const r = await worker.default.fetch(new Request(`http://${host}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env)
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
})
// A computer connecting through its address (where <id>.localhost reaches this computer): not stood
// in for, so turned away as a relay that isn't there yet would be.
server.on('upgrade', (req, socket) => socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'))
server.listen(Number(port), '127.0.0.1')
