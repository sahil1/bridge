// What the desktop app sees go wrong underneath the page, written down so the window can offer to
// report it on GitHub once it's back (server/crashes.js keeps it, shared/crashreport.js writes the
// report): its window's renderer going away (it's opened again), its graphics process going away,
// and the server it started ending without being asked to, with what the server printed last
// (logs/server.log). Nothing is sent anywhere.
const fs = require('node:fs')
const path = require('node:path')

// The window's page went away. A clean exit is the window closing; anything else (a crash, out of
// memory, the system ending it) is worth reporting.
function fromWindowGone(d) {
  if (!d || d.reason === 'clean-exit') return null
  return { kind: 'window', reason: d.reason || 'gone', exitCode: Number.isFinite(d.exitCode) ? d.exitCode : null }
}
// Another process of the app went away: only the graphics process (GPU) counts, and not when it
// was ended on purpose (Chromium restarts it, and so does quitting).
function fromChildGone(d) {
  if (!d || d.type !== 'GPU' || d.reason === 'clean-exit' || d.reason === 'killed') return null
  return { kind: 'gpu', reason: d.reason || 'gone', exitCode: Number.isFinite(d.exitCode) ? d.exitCode : null }
}
// The server ended by itself: an exit code other than 0, or a signal it didn't get from Bridge AI,
// an update or the system shutting down (those are SIGTERM, SIGINT or SIGHUP, and SIGKILL is
// someone forcing it to quit).
function fromServerExit(code, signal) {
  if (signal ? ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGKILL'].includes(signal) : !code) return null
  return { kind: 'server', reason: signal ? `ended by ${signal}` : `exited with code ${code}`, exitCode: signal ? null : code }
}

// Where the server's output goes: logs/server.log, its last 256 KB kept from before. An open file
// for the server's stdout and stderr, or 'ignore' when it can't be opened.
function serverLog(data) {
  const file = path.join(data, 'logs', 'server.log')
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const size = fs.statSync(file, { throwIfNoEntry: false })?.size || 0
    if (size > 1024 * 1024) fs.writeFileSync(file, fs.readFileSync(file).subarray(-256 * 1024))
    const fd = fs.openSync(file, 'a')
    fs.writeSync(fd, `\n---- ${new Date().toISOString()} Bridge AI's server started\n`)
    return fd
  } catch { return 'ignore' }
}

// A crash, kept for the server to offer when the window is back. The server takes it when it's up
// (POST /api/crashes); when it isn't, it's written where the server looks, unless the server just
// wrote down a crash of its own (an error nothing caught: its own words say more).
async function note(crash, { base, data, version, fetch = globalThis.fetch }) {
  if (!crash) return false
  if (crash.kind !== 'server') {
    try {
      const r = await fetch(`${base}/api/crashes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(crash), signal: AbortSignal.timeout(3000) })
      if (r.ok) return true
    } catch { /* the server isn't answering: write it down here */ }
  }
  const file = path.join(data, 'cache', 'crash.json')
  try {
    const was = fs.statSync(file, { throwIfNoEntry: false })
    if (crash.kind === 'server' && was && Date.now() - was.mtimeMs < 15000) return false
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...crash, at: new Date().toISOString(), version }))
    if (crash.kind === 'server') fs.appendFileSync(path.join(data, 'logs', 'server.log'), `---- ${new Date().toISOString()} Bridge AI's server ${crash.reason}\n`)
    return true
  } catch { return false }
}

module.exports = { fromWindowGone, fromChildGone, fromServerExit, serverLog, note }
