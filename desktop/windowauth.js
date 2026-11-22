// The app's side of server/windowkey.js and server/appkeys.js, kept apart from main.js so the tests
// can run it against a real server: the app's keys (the window secret, the signatures' key, this
// server start's secret and what it last heard of the signatures' list), what it hands the server it
// starts on fd 3, the check that a server is the one it started before it sends anything, and the
// MAC each of its windows' requests carries instead of the secret.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const rand = (n = 32) => crypto.randomBytes(n).toString('base64url')
const hmac = (k, s) => crypto.createHmac('sha256', String(k)).update(s).digest('base64url')
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }

// Kept in one file, sealed by safeStorage (macOS's Keychain, Windows' DPAPI, a Linux secret service),
// so no other program reads it without asking. With none of those (safeStorage can't), nothing is
// kept: a window secret for this run only, and the signatures stay with the server's own key file.
function keysAt(file, safeStorage) {
  const can = (() => { try { return !!safeStorage?.isEncryptionAvailable() } catch { return false } })()
  const store = process.platform === 'darwin' ? 'keychain' : process.platform === 'win32' ? 'dpapi' : (() => { try { return safeStorage.getSelectedStorageBackend?.() === 'basic_text' ? 'basic' : 'secret-service' } catch { return 'basic' } })()
  let k = null
  if (can) { try { k = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) } catch { k = null } }
  if (!k || typeof k.window !== 'string') k = { window: rand(), key: can ? crypto.randomBytes(32).toString('base64') : null, launch: null, state: null }
  const save = () => {
    if (!can) return
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(k)), { mode: 0o600 }) } catch { /* this run only */ }
  }
  save()
  return {
    get window() { return k.window },
    get launch() { return k.launch },
    kept: can,
    // For a server about to start: a new secret for this start, kept (so a later run of the app can
    // check the same server), and what goes on its fd 3.
    forStart() {
      k.launch = rand()
      save()
      return JSON.stringify({ window: k.window, key: k.key, launch: k.launch, state: k.state, store: can ? store : null })
    },
    // What the server says of the signatures' list ({ v, ask }), kept for its next start.
    heard(st) {
      if (!st || !Number.isInteger(st.v)) return
      k.state = { v: st.v, ask: st.ask === true }
      save()
    },
  }
}

// The MAC a window's request carries (server/windowkey.js macFor): over the method, the path with
// its query, the time and a nonce of its own.
function windowHeader(secret, method, url) {
  let u
  try { u = new URL(url) } catch { return null }
  const ms = String(Date.now())
  const nonce = rand(18)
  return `1.${ms}.${nonce}.${hmac(secret, `bridge-ai window\n${String(method).toUpperCase()}\n${u.pathname}${u.search}\n${ms}\n${nonce}`)}`
}

// Whether the server at base is the one this app started (it has that start's secret), asked with a
// nonce of the app's; fetch: one that sends the app's key.
async function proves(fetch, base, launch) {
  if (!launch) return false
  const n = rand(24)
  try {
    const r = await fetch(`${base}/api/window/proof?n=${n}`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return false
    const j = await r.json()
    return same(j.mac, hmac(launch, `bridge-ai server\n${n}`))
  } catch { return false }
}
// Whether the server has this app's window secret, never sending it: its nonce, the app's MAC of it.
// tofu (from source only): a server with none yet is given it, once.
async function hello(fetch, base, secret, { tofu = false } = {}) {
  try {
    const n = await (await fetch(`${base}/api/window/hello`, { signal: AbortSignal.timeout(3000) })).json()
    if (!n.has && tofu) {
      const r = await fetch(`${base}/api/window/hello`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret }) })
      return r.ok
    }
    const r = await fetch(`${base}/api/window/hello`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce: n.nonce, mac: hmac(secret, `bridge-ai hello\n${n.nonce}`) }) })
    return r.ok
  } catch { return false }
}

module.exports = { keysAt, windowHeader, proves, hello }
