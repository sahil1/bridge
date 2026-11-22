// The desktop app's own windows, told apart from everything else that holds Bridge AI's key. The key
// (apitoken.js) is in a file any program running as you can read, and the windows' cookie is made
// from it, so neither says a request came from one of the app's windows. What does is a secret the
// app makes and keeps in the Keychain (Electron's safeStorage), given to the server it starts on a
// pipe of its own (appkeys.js), and never sent anywhere after that: each request its windows make to
// this server's /api carries a MAC of it instead (X-Bridge-Window: 1.<ms>.<nonce>.<mac>, over the
// method, the address and port it was sent to, the path, the time and the body's SHA-256), added by
// the app outside the page (desktop/main.js), so no page script has it, one seen can't be used again
// or for another request, and one passed on through another program (sent to it, not here) or with
// its body changed is refused.
// The app sends nothing to a server until it has proved it has this start's own secret over that very
// connection (launch: proof below), so a program on the port the app expects gets neither.
//
// Kept sealed with your signatures (signstore.js), so a server started again finds it; replaced only
// by one the app gives with the signatures' own key (said in Settings › Studio when it is). A server
// started any other way (npm start, the CLI, Docker) has none from the app: there, signing is done
// from your phone. From source (npm run desktop:dev, under npm and node --watch, which pass no pipe
// on) the first one the app gives is taken, once (BRIDGE_WINDOW_TOFU, which only the app's own start
// sets), and then only that.
import crypto from 'node:crypto'
import * as store from './signstore.js'
import { appKeys } from './appkeys.js'

const HEADER = 'x-bridge-window'
const SKEW = 60_000
const okShape = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(s)
const hmac = (k, s) => crypto.createHmac('sha256', String(k)).update(s).digest('base64url')
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }
let current = null // the secret this server checks the windows' MACs with

// At start: the secret the app gave on its pipe; then, once the list opens, checked against the one
// sealed there (reconcile).
export function fromStart() {
  const a = appKeys()
  if (a.window) current = a.window
  ready = reconcile().catch(() => {})
  return !!current
}
let ready = Promise.resolve()
async function reconcile() {
  const given = appKeys().window
  const sealed = await store.windowSecret()
  if (!given) { if (sealed) current = sealed; return }
  if (!sealed) return store.setWindowSecret(given)
  if (sealed === given) return
  // Another one on the pipe: taken only when it came with the list's own key (the app's: it opened
  // the list), and said. With a key file instead (an app with no keychain to keep its secret in makes
  // a new one each time it starts: appkeys.js), the app's new one is taken as it is: whoever can start
  // this server can read that file too. Otherwise the sealed one stays.
  if (store.sealedWith()?.by === 'app') return store.setWindowSecret(given, { changed: true })
  if (store.sealedWith()?.by === 'file') return store.setWindowSecret(given)
  current = sealed
}
export const settled = () => ready

// The MAC a window's request carries (the app makes it the same way: desktop/windowauth.js): at, the
// address and port it was sent to (127.0.0.1:7420); body, its SHA-256 ('' with none).
export const macFor = (secret, method, at, url, ms, nonce, body = '') => hmac(secret, `bridge-ai window 2\n${String(method).toUpperCase()}\n${at}\n${url}\n${ms}\n${nonce}\n${body}`)
// This end of a connection, as the app writes the address it dialled: 127.0.0.1:7420, [::1]:7420.
const plain = (a) => String(a || '').replace(/^::ffff:/, '')
export const hereOf = (socket) => { const a = plain(socket?.localAddress); return `${a.includes(':') ? `[${a}]` : a}:${socket?.localPort}` }
const used = new Map() // nonce -> until
function fresh(nonce, ms) {
  const now = Date.now()
  if (used.size > 5000) for (const [n, t] of used) if (t < now) used.delete(n)
  if (used.has(nonce)) return false
  used.set(nonce, ms + SKEW)
  return true
}
// A request from one of the app's own windows: its MAC, made with this server's secret, for this
// request (method and path), within a minute, never seen before; at this computer itself (here(req):
// not through the relay, another computer's page or Tailscale). Answered once per request.
export function fromWindow(req, here) {
  if (req._fromWindow !== undefined) return req._fromWindow
  let ok = false
  // (A body the server didn't hash as it came, one that isn't JSON, can't be the one the MAC is over.)
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding']
  const m = hasBody && req.bodySha256 == null ? null : /^1\.(\d{12,16})\.([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{43})$/.exec(String(req.headers[HEADER] || ''))
  if (current && here && m && Math.abs(Date.now() - Number(m[1])) <= SKEW && same(macFor(current, req.method, hereOf(req.socket), req.originalUrl || req.url, m[1], m[2], req.bodySha256 || ''), m[3])) ok = fresh(m[2], Number(m[1]))
  // (A test's browser page, in the tests only: appkeys.js testHeader.)
  else if (current && here && appKeys().testHeader && same(String(req.headers[HEADER] || ''), `test.${current}`)) ok = true
  req._fromWindow = ok
  return ok
}
export const have = () => !!current

// ---------- The app checking this server, and this server the app ----------
// proof: that this server is the one the app started (it has this start's secret), answered to the
// app's nonce, over this very connection: this end's address and port and the other end's port, as
// the app sees them from its own end (desktop/windowauth.js proves). null when it isn't one the app
// started.
export const proof = (nonce, socket) => (appKeys().launch && /^[A-Za-z0-9_-]{16,64}$/.test(String(nonce || '')) ? hmac(appKeys().launch, `bridge-ai server 2\n${nonce}\n${hereOf(socket)}\n${socket?.remotePort}`) : null)
// hello: the app checking that this server has its window secret, without sending it: a nonce
// (GET), then the app's MAC of it (POST). From source only, with none yet, the secret itself, once.
const nonces = new Map() // nonce -> until
export function helloNonce() {
  const now = Date.now()
  for (const [n, t] of nonces) if (t < now) nonces.delete(n)
  if (nonces.size > 50) nonces.delete(nonces.keys().next().value)
  const n = crypto.randomBytes(24).toString('base64url')
  nonces.set(n, now + SKEW)
  return { nonce: n, has: !!current }
}
export async function hello({ nonce, mac, secret }) {
  await ready
  if (secret != null) {
    if (!okShape(secret)) throw Object.assign(new Error('Not a window secret'), { status: 400 })
    if (current || process.env.BRIDGE_WINDOW_TOFU !== '1') throw Object.assign(new Error('That isn\'t how this app\'s window is checked'), { status: 403, code: 'window' })
    current = secret
    await store.setWindowSecret(secret).catch(() => {})
    return { ok: true }
  }
  const n = String(nonce || '')
  const known = nonces.get(n)
  nonces.delete(n)
  if (!current || !known || known < Date.now() || !same(hmac(current, `bridge-ai hello\n${n}`), String(mac || ''))) throw Object.assign(new Error('That isn\'t this app\'s window secret'), { status: 403, code: 'window' })
  return { ok: true }
}
