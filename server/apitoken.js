// The local API's key. The server answers on 127.0.0.1, which every program on this computer can
// reach, and anyone else signed in to it too; the key is what tells Bridge AI's own windows and
// programs from the rest. It's kept in the data folder (api-token), readable only by you:
//   - programs (the CLI, the Chief of Staff's bin/bridge, `bridge-ai mcp`) read it from there and
//     send it as Authorization: Bearer <key>;
//   - the desktop app's main process reads it too and gives its windows a cookie (desktop/apitoken.js
//     makes the same cookie, and the same file when it's first);
//   - a browser tab gets the cookie from a one-time link the app or `bridge-ai open` opens (apiauth.js).
// The cookie holds a value made from the key, not the key, so the key itself never reaches a page.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataFile, ensureDir, IS_WIN } from './paths.js'

export const TOKEN_FILE = dataFile('api-token')
const SHAPE = /^[A-Za-z0-9_-]{32,200}$/

export function readToken(file = TOKEN_FILE) {
  try { const t = fs.readFileSync(file, 'utf8').trim(); return SHAPE.test(t) ? t : null } catch { return null }
}

// The key, made the first time. Written whole beside it and linked into place, so a program reading
// it at that moment finds it there entire or not at all, and two that start together (the server and
// the desktop app) end up with the same one: the second link fails and that one reads the first's.
export function ensureToken(file = TOKEN_FILE) {
  const have = readToken(file)
  if (have) return have
  ensureDir(path.dirname(file))
  const t = crypto.randomBytes(32).toString('base64url')
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, `${t}\n`, { mode: 0o600 })
  try {
    if (!IS_WIN) fs.chmodSync(tmp, 0o600)
    try { fs.linkSync(tmp, file); return t } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'ENOTSUP') throw e
      const theirs = readToken(file)
      if (theirs) return theirs
      // A file there with no key in it (emptied, or edited by hand): this one in its place.
      fs.renameSync(tmp, file)
      return t
    }
  } finally { fs.rmSync(tmp, { force: true }) }
}

// The server's own key, read (or made) once: the server, and what runs requests through it as you
// (the relay), use this.
let mine = null
export const localKey = () => mine || (mine = ensureToken())

// The cookie a browser keeps for this server: named for its port, as cookies are kept per address
// and not per port (a second Bridge AI on another port keeps its own).
export const cookieName = (port) => `bridge-ai-${port}`
export const cookieValue = (token) => crypto.createHmac('sha256', String(token)).update('bridge-ai browser').digest('base64url')

// Equal, taking as long whatever they hold.
export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  const h = (s) => crypto.createHash('sha256').update(s).digest()
  return crypto.timingSafeEqual(h(a), h(b))
}

// What a program sends with each request: the key, if there is one yet.
export const authHeaders = (token = readToken()) => (token ? { authorization: `Bearer ${token}` } : {})
