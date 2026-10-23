// Herdr View: a real `herdr session attach` client in a PTY, bridged to the
// browser over a WebSocket. Each browser tab gets its own client; closing the
// tab detaches that client only. The herdr session itself is never touched.
import { WebSocketServer } from 'ws'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import pty from 'node-pty'
import { sessionName, herdrSocket, herdrBin } from './runtime/herdr-cli.js'

// The same session the rest of Bridge AI shows (picked in the sidebar or Settings), looked up on
// each connect so the view follows a switch. A picked session that isn't running isn't started here.
function runningSession(bin) {
  const same = sessionName()
  if (same) return fs.existsSync(herdrSocket()) ? same : { stopped: same }
  try {
    const out = execFileSync(bin, ['session', 'list']).toString()
    const row = out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).find((c) => c[1] === 'running')
    return row?.[0] || null
  } catch {
    return null
  }
}

// herdr refuses to nest, so strip the variables that mark "inside herdr".
function cleanEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERDR_') && k !== 'TMUX'))
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: env.LANG || 'en_US.UTF-8' }
}

const MIN_COLS = 100

// Returns the upgrade handler for /api/tty; the server's upgrade router calls it.
export function ttyHandler() {
  const wss = new WebSocketServer({ noServer: true })
  const handle = (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://x')
    const cols = Math.min(400, Number(url.searchParams.get('cols')) || 0)
    const rows = Math.max(10, Math.min(200, Number(url.searchParams.get('rows')) || 40))
    // herdr sizes the whole session to its attached clients, so a phone-sized client
    // would squeeze every pane on the Mac. Narrow screens use the Terminals view instead.
    if (cols < MIN_COLS) {
      ws.send(JSON.stringify({ type: 'error', message: `Herdr view needs at least ${MIN_COLS} columns; use Terminals on small screens` }))
      return ws.close(4001, 'too narrow')
    }
    const bin = await herdrBin()
    const name = runningSession(bin)
    if (!name || name.stopped) {
      ws.send(JSON.stringify({ type: 'error', message: name ? `The herdr session ${name.stopped} isn't running. Start it from the session menu in the sidebar.` : 'No running herdr session' }))
      return ws.close()
    }
    const term = pty.spawn(bin, ['session', 'attach', name], { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env: cleanEnv() })
    ws.send(JSON.stringify({ type: 'ready', session: name }))

    term.onData((d) => { if (ws.readyState === 1) ws.send(d) })
    term.onExit(({ exitCode }) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code: exitCode }))
      ws.close()
    })
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return term.write(raw.toString())
      const msg = raw.toString()
      if (msg.startsWith('{')) {
        try {
          const m = JSON.parse(msg)
          if (m.type === 'resize') return term.resize(Math.max(MIN_COLS, m.cols | 0), Math.max(10, m.rows | 0))
          if (m.type === 'input') return term.write(m.data)
        } catch { /* fall through: literal input that starts with { */ }
      }
      term.write(msg)
    })
    ws.on('close', () => { try { term.kill() } catch { /* already gone */ } })
  })
  return handle
}
