// Stand-in for native/bridgesign (Studio's signing on a Mac: the trackpad and Touch ID), so the
// server's side (server/signauth.js) and the pad can be checked on any computer, with no window
// over the screen, no pointer hidden and no Touch ID or password asked for. It reads what to do
// from $BRIDGESIGN_STATE, a JSON file the test rewrites as it goes, each time it's started:
//   { "probe": { "trackpad": true, "touchID": true, "auth": true },
//     "auth": { "ok": true, "how": "touchid" } | { "ok": false, "code": "cancel", "error": "…" },
//     "trackpad": [ { "d": [x, y, p] }, { "m": [x, y, p] }, …, { "u": 1 }, { "done": true } ],
//     "gap": 15,                      ms between the trackpad's lines (a finger moving)
//     "key": "<base64 of 32 bytes>" | { "error": "…" } }   the Keychain's key (one of its own when unset)
// and notes each start (its arguments) in $BRIDGESIGN_LOG.
//   probe                  what this "Mac" has
//   key                    the "Keychain's" key for the saved signatures
//   auth --reason <text>   answers as auth says, a moment later (as a person would)
//   trackpad               {"ready"} with a trackpad's size, then trackpad's lines one by one; ends
//                          at "done" or "cancel", or with {"cancel":"stop"} on "stop" or stdin closed.
//                          Without a list, it waits (a finger that never comes) until stopped.
const fs = require('node:fs')
const [cmd, ...rest] = process.argv.slice(2)
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const state = (() => { try { return JSON.parse(fs.readFileSync(process.env.BRIDGESIGN_STATE, 'utf8')) } catch { return {} } })()
if (process.env.BRIDGESIGN_LOG) fs.appendFileSync(process.env.BRIDGESIGN_LOG, `${JSON.stringify({ args: [cmd, ...rest] })}\n`)

if (cmd === 'probe') {
  say({ trackpad: true, touchID: true, auth: true, ...(state.probe || {}) })
} else if (cmd === 'key') {
  const k = state.key ?? Buffer.alloc(32, 7).toString('base64')
  if (typeof k === 'object') { say({ error: k.error || 'locked', status: -25308 }); process.exit(1) }
  say({ key: k })
} else if (cmd === 'auth') {
  setTimeout(() => say(state.auth || { ok: true, how: 'touchid' }), 150)
} else if (cmd === 'trackpad') {
  let over = false
  const end = (o) => { if (over) return; over = true; say(o); setTimeout(() => process.exit(0), 20) }
  let buf = ''
  process.stdin.on('data', (d) => {
    buf += d
    if (/(^|\n)stop\s*(\n|$)/.test(buf)) end({ cancel: 'stop' })
  })
  process.stdin.on('end', () => end({ cancel: 'stop' }))
  say({ ready: true, w: 160, h: 100 })
  const lines = Array.isArray(state.trackpad) ? state.trackpad : []
  let at = 0
  const t0 = Date.now()
  const next = () => {
    if (over || at >= lines.length) return
    const line = lines[at++]
    if (line.done || line.cancel) return end(line)
    say({ ...line, ms: Date.now() - t0 })
    setTimeout(next, state.gap ?? 15)
  }
  setTimeout(next, 200)
} else process.exit(2)
