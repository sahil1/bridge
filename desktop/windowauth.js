// The app's side of server/windowkey.js and server/appkeys.js, kept apart from main.js so the tests
// can run it against a real server: the app's keys (the window secret, the signatures' key, this
// server start's secret and what it last heard of the signatures' list), what it hands the server it
// starts on fd 3, the check that a server is the one it started before it sends anything, and the
// MAC each of its windows' requests carries instead of the secret.
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const rand = (n = 32) => crypto.randomBytes(n).toString('base64url')
const hmac = (k, s) => crypto.createHmac('sha256', String(k)).update(s).digest('base64url')
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }

// Kept in one file, sealed by safeStorage (macOS's Keychain, Windows' DPAPI, a Linux secret service),
// so no other program reads it without asking. With none of those (safeStorage can't), nothing is
// kept: a window secret for this run only, and the signatures stay with the server's own key file.
// A file there that can't be opened (its keychain item denied this time, or damaged) is never
// written over: it's moved aside (<file>.unreadable) and tried again at the next start, and until it
// opens this run has no signatures' key (unreadable: said in Settings › Studio), never a new one,
// which would leave every saved signature sealed with a key nobody has. Tried again and still not
// opening (retried), Settings › Studio offers Start Over, behind Touch ID, the Mac's password or
// Windows Hello (server/signing.js): startOver() keeps the file that won't open (<file>.unreadable-
// <time>) and makes new keys; the signatures sealed with the old ones are then set aside, and said.
function keysAt(file, safeStorage, { listen = null } = {}) {
  const can = (() => { try { return !!safeStorage?.isEncryptionAvailable() } catch { return false } })()
  const store = process.platform === 'darwin' ? 'keychain' : process.platform === 'win32' ? 'dpapi' : (() => { try { return safeStorage.getSelectedStorageBackend?.() === 'basic_text' ? 'basic' : 'secret-service' } catch { return 'basic' } })()
  const aside = `${file}.unreadable`
  const open = (f) => JSON.parse(safeStorage.decryptString(fs.readFileSync(f)))
  let k = null
  // (Kept before, and no keychain to open it with this time: as unreadable, never replaced.)
  let unreadable = !can && fs.existsSync(file)
  let retried = false
  if (can && fs.existsSync(file)) {
    try { k = open(file) } catch { unreadable = true }
    if (unreadable) { try { if (!fs.existsSync(aside)) fs.renameSync(file, aside); else retried = true } catch { /* left where it is */ } }
  } else if (can && fs.existsSync(aside)) {
    try { k = open(aside); fs.renameSync(aside, file) } catch { unreadable = true; retried = true; k = null }
  }
  if (k && typeof k.window !== 'string') { k = null; unreadable = true }
  if (unreadable) k = { window: rand(), key: null, launch: null, state: null }
  if (!k) k = { window: rand(), key: can ? crypto.randomBytes(32).toString('base64') : null, launch: null, state: null }
  const save = () => {
    if (!can || unreadable) return
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(k)), { mode: 0o600 }) } catch { /* this run only */ }
  }
  save()
  return {
    get window() { return k.window },
    get launch() { return k.launch },
    get kept() { return can && !unreadable },
    get unreadable() { return unreadable },
    // Start Over (only once the keys that won't open were tried again): they're kept beside, under a
    // name of their own, and new ones made and kept. true when it did.
    startOver() {
      if (!unreadable || !retried || !can) return false
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      for (const f of [aside, file]) { try { if (fs.existsSync(f)) fs.renameSync(f, `${file}.unreadable-${stamp}${f === file ? '-b' : ''}`) } catch { return false } }
      k = { window: rand(), key: crypto.randomBytes(32).toString('base64'), launch: null, state: null }
      unreadable = false
      retried = false
      save()
      return true
    },
    // For a server about to start: a new secret for this start, kept (so a later run of the app can
    // check the same server), and what goes on its fd 3, with where the app talks to it (listen) and
    // the app's own code-signing requirement (code: codesig.js), which its signing helper is held to.
    forStart({ code = null } = {}) {
      k.launch = rand()
      save()
      return JSON.stringify({ window: k.window, key: k.key, launch: k.launch, state: k.state, store: can && !unreadable ? store : null, listen, unreadable, startOver: unreadable && retried && can, code })
    },
    // What the server says of the signatures' list ({ v, ask }), kept for its next start.
    heard(st) {
      if (!st || !Number.isInteger(st.v)) return
      k.state = { v: st.v, ask: st.ask === true }
      save()
    },
  }
}

// The MAC a window's request carries (server/windowkey.js macFor): over the method, the address and
// port it's sent to (at: the server's own, 127.0.0.1:<port>; the URL's when not given), the path
// with its query, the time, a nonce of its own and the body's SHA-256 ('' with none).
function windowHeader(secret, method, url, { at = null, body = '' } = {}) {
  let u
  try { u = new URL(url) } catch { return null }
  const ms = String(Date.now())
  const nonce = rand(18)
  return `1.${ms}.${nonce}.${hmac(secret, `bridge-ai window 2\n${String(method).toUpperCase()}\n${at || u.host}\n${u.pathname}${u.search}\n${ms}\n${nonce}\n${body}`)}`
}
// A request body's SHA-256, from what Electron says it will send (webRequest's uploadData): '' with
// none, null when part of it is a file or a blob it doesn't give the bytes of.
function bodyHash(uploadData) {
  if (!uploadData?.length) return ''
  const h = crypto.createHash('sha256')
  for (const part of uploadData) {
    if (!part.bytes) return null
    h.update(part.bytes)
  }
  return h.digest('hex')
}

// Whether the server at host:port is the one this app started: it answers the app's nonce with this
// start's secret over this very connection, naming its own address and port and the app's end's port
// as the app sees them from its end, so a program passing requests on to it from elsewhere can't.
// What it comes to: 'ok'; 'wrong', an answer without that secret (another program, or a server the
// app didn't start); 'slow', no answer in time (a busy start, a Mac waking up, a server held up for a
// moment), which says nothing either way; 'down', nothing there. It needs no key (it gives nothing
// away), and the app's key goes to no server before it has proved itself (main.js).
function proof({ host = '127.0.0.1', port, launch, headers = {}, timeout = 3000 }) {
  if (!launch) return Promise.resolve('wrong')
  const n = rand(24)
  return new Promise((resolve) => {
    let slow = false
    const req = http.get({ host, port, path: `/api/window/proof?n=${n}`, headers, timeout, agent: false }, (res) => {
      const s = res.socket
      const there = `${s.remoteAddress?.includes(':') ? `[${s.remoteAddress}]` : s.remoteAddress}:${s.remotePort}`
      const want = hmac(launch, `bridge-ai server 2\n${n}\n${there}\n${s.localPort}`)
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => { try { resolve(res.statusCode === 200 && same(JSON.parse(body).mac, want) ? 'ok' : 'wrong') } catch { resolve('wrong') } })
      res.on('error', () => resolve(slow ? 'slow' : 'down'))
    })
    req.on('timeout', () => { slow = true; req.destroy() })
    req.on('error', () => resolve(slow ? 'slow' : 'down'))
  })
}
const proves = async (o) => (await proof(o)) === 'ok'
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

module.exports = { keysAt, windowHeader, bodyHash, proof, proves, hello }
