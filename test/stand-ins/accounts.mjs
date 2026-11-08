// Bold Bridge's accounts service for tests: account/worker.js itself, run in Node on this computer
// with SQLite for D1 and a mailbox for the Email Service, signed with a key made for the run (the
// harness makes it and gives its public half to the app and the relay), so no test reaches
// boldbridge.ai. Its address is http://127.0.0.1:<port>, as accounts.boldbridge.ai would be.
//   node accounts.mjs <port> <mail log>      BRIDGE_TEST_SIGNING_KEY: the private key (PKCS #8 PEM)
// What the service answers on the internet (/v1/...), and for tests:
//   ANY  /_test/bound/<path>   the same request through the service binding (/admin/..., /internal/...),
//                              as the admin view and the relay make it (X-Admin-Email given if it's missing)
//   GET  /_test/mail           every email sent, oldest first: [{ to, subject, text }]
//   POST /_test/mail-fails     { code }: sending fails from now on, as Cloudflare's does ('' stops it)
//   POST /_test/clock          { shift }: its clock, that many ms ahead of the real one
import http from 'node:http'
import { d1, mailbox } from '../lib/workers.mjs'

const [port, log] = process.argv.slice(2)
const realNow = Date.now
let shift = 0
Date.now = () => realNow() + shift
const worker = await import('../../account/worker.js')
const mail = mailbox(log)
const env = { DB: d1(), EMAIL: mail, FROM: 'accounts@example.com', ADMINS: 'admins@example.com', SITE: 'https://boldbridge.example', RELAY_MAX_ACCOUNTS: process.env.BRIDGE_TEST_RELAY_MAX || '500', SIGNING_KEY: process.env.BRIDGE_TEST_SIGNING_KEY }
const internal = new worker.Internal({}, env)

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)) }
  if (req.url === '/_test/mail') return send(200, mail.sent)
  if (req.url === '/_test/mail-fails') { mail.fail(JSON.parse(String(body) || '{}').code || null); return send(200, { ok: true }) }
  if (req.url === '/_test/clock') { shift = Number(JSON.parse(String(body) || '{}').shift) || 0; return send(200, { ok: true, now: Date.now() }) }
  const bound = req.url.startsWith('/_test/bound/')
  const path = bound ? req.url.slice('/_test/bound'.length) : req.url
  const headers = Object.entries(req.headers).filter(([k, v]) => typeof v === 'string' && k !== 'host')
  if (bound && !req.headers['x-admin-email']) headers.push(['x-admin-email', 'admin@example.com'])
  if (!bound) headers.push(['cf-connecting-ip', req.socket.remoteAddress?.replace(/^::ffff:/, '') || '127.0.0.1'])
  const r = new Request(`https://accounts.boldbridge.ai${path}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body })
  const out = bound ? await internal.fetch(r) : await worker.default.fetch(r, env)
  res.writeHead(out.status, Object.fromEntries(out.headers))
  res.end(Buffer.from(await out.arrayBuffer()))
})
server.listen(Number(port), '127.0.0.1', () => console.log(`accounts stand-in on ${port}`))
