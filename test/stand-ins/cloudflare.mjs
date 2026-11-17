// Cloudflare for tests: the calls of its API that Bridge AI makes to deploy a relay of your own
// (server/relay.js, deployWith), with an API token, and the Workers deployed with them, each run in
// Node as the relay stand-in (stand-ins/relay.mjs) with the token it was deployed with. A Worker is
// reached at <script>.<subdomain>.localhost on this stand-in's port, as workers.dev would have it at
// <script>.<subdomain>.workers.dev. Nothing leaves the machine.
//   node cloudflare.mjs <port> <settings as JSON: { token, accounts: [{ id, name, subdomain }] }>
//   GET /_test/state   the calls made ({ method, path }), each account's subdomain, and each Worker
//                      { account, tag (its migration tag), token (its HOST_TOKEN), same (its code is
//                      the relay as built here), enabled (on workers.dev), uploads }
// The API, under /client/v4, as Cloudflare answers it ({ success, errors, messages, result }):
//   GET  /accounts                                     the accounts the token reaches
//   GET  /accounts/:a/workers/scripts                  the account's Workers
//   GET  /accounts/:a/workers/subdomain                its workers.dev subdomain (none yet: 10007)
//   PUT  /accounts/:a/workers/subdomain                { subdomain }: it picks one
//   PUT  /accounts/:a/workers/scripts/:name            a Worker (multipart: metadata, worker.js)
//   POST /accounts/:a/workers/scripts/:name/subdomain  { enabled }: on workers.dev or not
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bundle } from '../../relay/build.js'

const [port, settings = '{}'] = process.argv.slice(2)
const { token, accounts = [] } = JSON.parse(settings)
const RELAY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'relay.mjs')
const built = bundle().code
const calls = []
const subs = new Map(accounts.filter((a) => a.subdomain).map((a) => [a.id, a.subdomain])) // account -> subdomain
const workers = new Map() // `${account}/${name}` -> { account, name, tag, token, same, enabled, uploads, port, proc }

const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const ok = (res, result) => send(res, 200, { success: true, errors: [], messages: [], result })
const no = (res, status, code, message) => send(res, status, { success: false, errors: [{ code, message }], messages: [], result: null })

// A port nothing listens on, for a Worker's relay.
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)) }) })
// A Worker's relay, started (again, with a new token), and answering before the upload is.
async function run(w) {
  w.proc?.kill()
  w.port = await freePort()
  w.proc = spawn(process.execPath, [RELAY, String(w.port), w.token], { stdio: 'inherit' })
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${w.port}/_relay/health`).then((r) => r.ok, () => false)) return
    await new Promise((r) => setTimeout(r, 150))
  }
}
const stop = () => { for (const w of workers.values()) w.proc?.kill(); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

async function api(req, res, body) {
  const u = new URL(req.url, 'http://x')
  const p = u.pathname.slice('/client/v4'.length)
  calls.push({ method: req.method, path: p })
  if (req.headers.authorization !== `Bearer ${token}`) return no(res, 400, 10000, 'Authentication error')
  if (req.method === 'GET' && p === '/accounts') return ok(res, accounts.map(({ id, name }) => ({ id, name })))
  const m = /^\/accounts\/([\w-]+)\/workers\/(subdomain|scripts)(?:\/([\w-]+)(\/subdomain)?)?$/.exec(p)
  const acct = m && accounts.find((a) => a.id === m[1])
  if (!acct) return no(res, 404, 7003, 'Could not route to this path, perhaps your object identifier is invalid?')
  const json = () => { try { return JSON.parse(String(body)) } catch { return {} } }
  if (m[2] === 'subdomain') {
    if (req.method === 'GET') return subs.has(acct.id) ? ok(res, { subdomain: subs.get(acct.id) }) : no(res, 404, 10007, 'This subdomain does not exist.')
    if (req.method === 'PUT') {
      const want = String(json().subdomain || '')
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(want)) return no(res, 400, 10032, 'Invalid subdomain')
      subs.set(acct.id, want)
      return ok(res, { subdomain: want })
    }
  }
  if (m[2] === 'scripts' && !m[3] && req.method === 'GET') return ok(res, [...workers.values()].filter((w) => w.account === acct.id).map((w) => ({ id: w.name, migration_tag: w.tag || undefined, created_on: w.at, modified_on: w.at })))
  if (m[2] === 'scripts' && m[3] && !m[4] && req.method === 'PUT') {
    // As Cloudflare reads an upload: the metadata part, and the module it names.
    let form
    try { form = await new Request('http://x', { method: 'PUT', headers: { 'content-type': req.headers['content-type'] || '' }, body }).formData() } catch { return no(res, 400, 10021, 'Uploaded script must be multipart/form-data') }
    let meta
    try { meta = JSON.parse(await form.get('metadata').text()) } catch { return no(res, 400, 10021, 'No metadata part') }
    const main = meta.main_module && form.get(meta.main_module)
    if (!main) return no(res, 400, 10021, 'No such module: the main module isn\'t in the upload')
    const b = meta.bindings || []
    const secret = b.find((x) => x.type === 'secret_text' && x.name === 'HOST_TOKEN')?.text
    if (!b.some((x) => x.type === 'durable_object_namespace' && x.name === 'HUB' && x.class_name === 'Hub') || !secret) return no(res, 400, 10021, 'A binding the relay needs is missing')
    const key = `${acct.id}/${m[3]}`
    const was = workers.get(key)
    // A migration once: a new Worker's Durable Object class needs one, and the same tag again fails.
    const tag = meta.migrations?.new_tag
    if (was?.tag && tag === was.tag) return no(res, 400, 10079, `Migration tag precondition failed; current tag is ${was.tag}`)
    if (!was?.tag && !tag) return no(res, 400, 10061, 'Cannot create binding for class Hub: it isn\'t configured to implement Durable Objects (a migration is needed)')
    const w = was || { account: acct.id, name: m[3], enabled: false, uploads: 0 }
    Object.assign(w, { tag: tag || w.tag, same: (await main.text()) === built, at: new Date().toISOString(), uploads: w.uploads + 1 })
    workers.set(key, w)
    if (w.token !== secret || !w.proc) { w.token = secret; await run(w) }
    return ok(res, { id: w.name, migration_tag: w.tag })
  }
  if (m[2] === 'scripts' && m[3] && m[4] && req.method === 'POST') {
    const w = workers.get(`${acct.id}/${m[3]}`)
    if (!w) return no(res, 404, 10007, 'This Worker does not exist on your account.')
    w.enabled = !!json().enabled
    return ok(res, { enabled: w.enabled })
  }
  return no(res, 405, 10000, 'Not something this stand-in answers')
}

// A Worker at its workers.dev address: <script>.<subdomain>.localhost:<port>.
function workerOf(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '')
  const x = /^([\w-]+)\.([\w-]+)\.localhost$/.exec(host)
  if (!x) return null
  const acct = [...subs].find(([, s]) => s === x[2])?.[0]
  const w = acct && workers.get(`${acct}/${x[1]}`)
  return w?.enabled && w.port ? w : null
}

const server = http.createServer(async (req, res) => {
  const w = workerOf(req)
  if (w) {
    const p = http.request({ host: '127.0.0.1', port: w.port, method: req.method, path: req.url, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    p.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    return req.pipe(p)
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  if (/^[\w-]+\.[\w-]+\.localhost(:\d+)?$/.test(String(req.headers.host || ''))) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('There is nothing here yet') }
  if (req.url === '/_test/state') return send(res, 200, { calls, subdomains: Object.fromEntries(subs), workers: Object.fromEntries([...workers].map(([k, x]) => [k, { account: x.account, name: x.name, tag: x.tag, token: x.token, same: x.same, enabled: x.enabled, uploads: x.uploads }])) })
  if (req.url.startsWith('/client/v4/')) return api(req, res, body).catch((e) => no(res, 500, 10013, e.message))
  no(res, 404, 7000, 'No route for that URI')
})
// A Worker's WebSockets (the computer's, a phone's): passed through to its relay as they are.
server.on('upgrade', (req, socket, head) => {
  const w = workerOf(req)
  if (!w) return socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
  const up = net.connect(w.port, '127.0.0.1', () => {
    let lines = `${req.method} ${req.url} HTTP/1.1\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
    up.write(`${lines}\r\n`)
    if (head?.length) up.write(head)
    socket.pipe(up).pipe(socket)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})
server.listen(Number(port), '127.0.0.1', () => console.log(`cloudflare stand-in on ${port}`))
