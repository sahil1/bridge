// The local API's key, as the desktop app uses it (server/apitoken.js keeps it; this is the same
// file, the same cookie and, when the app is first, the same way of making it). The app's main
// process reads it, sends it with its own requests to the server, and gives its windows the cookie
// before any of them opens, so the page itself never holds the key or the cookie (HttpOnly).
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const SHAPE = /^[A-Za-z0-9_-]{32,200}$/
const fileIn = (data) => path.join(data, 'api-token')

function read(data) {
  try { const t = fs.readFileSync(fileIn(data), 'utf8').trim(); return SHAPE.test(t) ? t : null } catch { return null }
}

// Read, or made if the app starts before the server ever has: whole beside it, then linked into
// place, so whichever is second reads the first's.
function ensure(data) {
  const have = read(data)
  if (have) return have
  const file = fileIn(data)
  fs.mkdirSync(data, { recursive: true })
  const t = crypto.randomBytes(32).toString('base64url')
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, `${t}\n`, { mode: 0o600 })
  try {
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600)
    try { fs.linkSync(tmp, file); return t } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'ENOTSUP') throw e
      const theirs = read(data)
      if (theirs) return theirs
      fs.renameSync(tmp, file)
      return t
    }
  } finally { fs.rmSync(tmp, { force: true }) }
}

const cookieName = (port) => `bridge-ai-${port}`
const cookieValue = (token) => crypto.createHmac('sha256', String(token)).update('bridge-ai browser').digest('base64url')

// The cookie on this computer's addresses (every port of them: another computer's window is at a
// port of its own, served by the same server), for the windows of the app's session.
async function letIn(session, { port, token }) {
  const value = cookieValue(token)
  const expirationDate = Math.floor(Date.now() / 1000) + 400 * 86400
  for (const host of ['127.0.0.1', 'localhost']) {
    await session.cookies.set({ url: `http://${host}:${port}/`, name: cookieName(port), value, path: '/', httpOnly: true, sameSite: 'strict', expirationDate })
  }
}

module.exports = { read, ensure, cookieName, cookieValue, letIn }
