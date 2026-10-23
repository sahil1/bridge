// Direct calls over herdr's API socket for the hot paths (typing into a pane, reading its screen),
// where spawning the CLI per keystroke would be too slow. Each call opens a fresh connection,
// so a herdr restart never leaves a stale socket behind.
import net from 'node:net'
import { herdrSocket } from './herdr-cli.js'
import os from 'node:os'
import path from 'node:path'

// Same lookup the CLI wrapper uses, so this works however the server was started, and follows
// a switch to another session at once.
const socket = () => herdrSocket() || path.join(os.homedir(), '.config', 'herdr', 'sessions', 'main', 'herdr.sock')

let seq = 0
// at: another session's socket (the session menu's "needs you" counts), else the one in view.
export function call(method, params, timeout = 8000, at = socket()) {
  return new Promise((resolve, reject) => {
    const s = net.connect(at)
    let buf = ''
    const timer = setTimeout(() => { s.destroy(); reject(new Error(`herdr ${method} timed out`)) }, timeout)
    s.on('error', (e) => { clearTimeout(timer); reject(e) })
    s.on('data', (d) => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      clearTimeout(timer)
      s.end()
      try {
        const msg = JSON.parse(buf.slice(0, nl))
        if (msg.error) reject(new Error(msg.error.message || msg.error.code))
        else resolve(msg.result)
      } catch (e) { reject(e) }
    })
    s.write(`${JSON.stringify({ id: `cc-${++seq}`, method, params })}\n`)
  })
}

// Keys herdr accepts by name (plus any single character); pastes are sent as text.
const KEY = /^(.|enter|esc|tab|shift\+tab|backspace|up|down|left|right|space|shift\+enter|alt\+enter|(ctrl|alt|shift)\+[a-z0-9]|[0-9]|f\d{1,2}|ctrl\+(left|right)|shift\+(up|down|left|right))$/

// Input is applied in order per pane, so fast typing never arrives shuffled.
const lanes = new Map()
export function input(paneId, steps) {
  const clean = []
  for (const st of steps || []) {
    if (typeof st?.text === 'string' && st.text) clean.push({ text: st.text.slice(0, 20000) })
    else if (Array.isArray(st?.keys)) {
      const keys = st.keys.map(String).filter((k) => k !== ' ' && KEY.test(k))
      if (keys.length) clean.push({ keys })
    }
  }
  const prev = lanes.get(paneId) || Promise.resolve()
  const next = prev.catch(() => {}).then(async () => {
    for (const st of clean) await call('pane.send_input', { pane_id: paneId, ...st })
  })
  lanes.set(paneId, next)
  next.finally(() => { if (lanes.get(paneId) === next) lanes.delete(paneId) })
  return next
}

export async function read(paneId, lines = 400) {
  const r = await call('pane.read', { pane_id: paneId, source: 'recent', lines, format: 'ansi', strip_ansi: false })
  return r.read?.text ?? ''
}
