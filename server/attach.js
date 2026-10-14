// A terminal client attached to a pane (`bridge-ai attach`): raw keystrokes in, the pane's output
// out, like `tmux attach` or `herdr session attach`. While a client is attached the pane takes its
// size; when the last one leaves it goes back to the default. Built-in runtime only.
import { WebSocketServer } from 'ws'

export function attachHandler(rt) {
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x')
    const m = url.pathname.match(/^\/api\/panes\/([^/]+)\/attach$/)
    const cols = Math.max(20, Math.min(500, Number(url.searchParams.get('cols')) || 120))
    const rows = Math.max(5, Math.min(300, Number(url.searchParams.get('rows')) || 40))
    let link
    try {
      link = rt.attach(decodeURIComponent(m[1]), { cols, rows },
        (data) => { if (ws.readyState === 1) ws.send(data) },
        () => { if (ws.readyState === 1) { ws.send(JSON.stringify({ type: 'exit' })); ws.close() } })
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }))
      return ws.close()
    }
    ws.on('message', (raw) => {
      const msg = raw.toString()
      if (msg.startsWith('{"type":')) {
        try {
          const j = JSON.parse(msg)
          if (j.type === 'resize') return link.resize(j.cols | 0, j.rows | 0)
          if (j.type === 'input') return link.write(String(j.data))
        } catch { /* literal input */ }
      }
      link.write(msg)
    })
    ws.on('close', () => link.detach())
  })
  return (req, socket, head) => {
    if (!/^\/api\/panes\/[^/]+\/attach(\?|$)/.test(req.url)) return socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  }
}
