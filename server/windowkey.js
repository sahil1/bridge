// The desktop app's own windows, told apart from everything else that holds Bridge AI's key. The key
// (apitoken.js) is in a file any program running as you can read, and the windows' cookie is made
// from it, so neither says a request came from one of the app's windows. What does is a secret the
// app makes itself and keeps in the Keychain (Electron's safeStorage): it hands it to the server it
// starts on an inherited pipe (never the environment or a file), and its windows send it with every
// request to this server's /api (desktop/main.js, X-Bridge-Window), added by the app outside the page,
// so no page script reads it. Studio's signing (signing.js) takes your own windows to be this.
//
// The server keeps only a hash of it, sealed with your signatures (signstore.js), so the app can give
// it again after the server restarts or when it finds one already running (POST /api/window/hello),
// and a program that only has the key can't set one of its own: the first is only ever the one the
// app started the server with. A server started any other way (npm start, the CLI, Docker) has no
// window secret: there, signing is done from your phone.
import crypto from 'node:crypto'
import fs from 'node:fs'
import * as store from './signstore.js'

const HEADER = 'x-bridge-window'
const hash = (s) => crypto.createHash('sha256').update(`bridge-ai window\n${s}`).digest('base64url')
const okShape = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(s)
let current = null // the secret this server has now

// At start: the secret on the pipe the app gave (BRIDGE_WINDOW_FD), read whole and closed; in the
// tests only, from a file of the test's own (BRIDGE_TEST_WINDOW_FILE).
export function fromStart() {
  let s = null
  const fd = Number(process.env.BRIDGE_WINDOW_FD)
  if (Number.isInteger(fd) && fd > 2) {
    try { s = fs.readFileSync(fd, 'utf8').trim() } catch { /* none */ }
    try { fs.closeSync(fd) } catch { /* closed */ }
  } else if (process.env.BRIDGE_FIX_DRYRUN && process.env.BRIDGE_TEST_WINDOW_FILE) {
    try { s = fs.readFileSync(process.env.BRIDGE_TEST_WINDOW_FILE, 'utf8').trim() } catch { /* none */ }
  }
  delete process.env.BRIDGE_WINDOW_FD
  if (!okShape(s)) return false
  current = s
  // Its hash sealed, for the app to give it again later (once the store opens: now, or when it can).
  store.setWindowHash(hash(s)).catch(() => { pending = hash(s) })
  return true
}
let pending = null
// The app giving it again (a server it found running, or this one restarted): taken only when it's
// the one the app started a server with before, by its sealed hash.
export async function hello(s) {
  if (!okShape(s)) throw Object.assign(new Error('Not a window secret'), { status: 400 })
  if (current && timingSame(current, s)) return { ok: true }
  if (pending) { await store.setWindowHash(pending).catch(() => {}); pending = null }
  const want = await store.windowHash().catch(() => null)
  // From source (npm run desktop:dev, under npm and node --watch, which pass no pipe on): the first
  // the app gives, once, when there's none yet (BRIDGE_WINDOW_TOFU, which only the app's own
  // start sets), and then only that.
  if (!want && !current && process.env.BRIDGE_WINDOW_TOFU === '1') {
    await store.setWindowHash(hash(s))
    current = s
    return { ok: true }
  }
  if (!want || !timingSame(want, hash(s))) throw Object.assign(new Error('That isn\'t this app\'s window secret'), { status: 403, code: 'window' })
  current = s
  return { ok: true }
}
const timingSame = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }
// A request from one of the app's own windows: its secret, at this computer itself (here(req): not
// through the relay, another computer's page or Tailscale).
export const fromWindow = (req, here) => !!current && here && timingSame(current, req.headers[HEADER] || '')
export const have = () => !!current
