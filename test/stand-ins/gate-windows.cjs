// The desktop app's gate (desktop/servergate.js) in real Electron, wired as desktop/main.js wires it
// (servergate.wire), for app-gate.mjs. Its own stand-ins: the app's server (S, at 127.0.0.1:<port>:
// its page, its API and a terminal's WebSocket), another program at another name for this computer
// at the same port ([::1]), and a project's app (P, at another port) shown in a frame of the app's
// page, which tries to send the page elsewhere when clicked. The server "proves itself" when the
// suite says so (globalThis.proveAs). No window is shown, nothing outside this process is used.
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')
const servergate = require(path.join(__dirname, '..', '..', 'desktop', 'servergate.js'))
const senders = require(path.join(__dirname, '..', '..', 'desktop', 'senders.js'))

app.setPath('userData', process.env.GATE_DATA)
const listen = (host, port, fn) => new Promise((resolve) => {
  const s = http.createServer(fn)
  s.once('error', () => resolve(null))
  s.listen(port, host, () => resolve(s))
})
const page = (title, body = '') => `<!doctype html><title>${title}</title><body style="margin:0">${body}</body>`
// A WebSocket taken as the server takes a terminal's (ws, the server's own package).
const { WebSocketServer } = require(path.join(__dirname, '..', '..', 'node_modules', 'ws'))
function upgrade(seen, name) {
  const wss = new WebSocketServer({ noServer: true })
  return (req, sock, head) => {
    seen.push(`${name} ws ${req.url}`)
    sock.on('error', () => {})
    wss.handleUpgrade(req, sock, head, (ws) => ws.on('error', () => {}))
  }
}

app.whenReady().then(async () => {
  if (app.dock) app.dock.hide()
  const seen = []
  globalThis.seen = seen
  let P = 0
  const S = await listen('127.0.0.1', 0, (q, s) => {
    seen.push(`S ${q.url}`)
    const u = new URL(q.url, 'http://x')
    // /go?to=: a redirect, as a linked computer's page can answer one.
    if (u.pathname === '/go') { s.writeHead(302, { location: u.searchParams.get('to') || '/' }); s.end(); return }
    s.setHeader('content-type', 'text/html')
    const frame = u.searchParams.get('frame')
    s.end(page('APP', frame ? `<iframe src="${frame}" style="border:0;width:400px;height:300px"></iframe>` : ''))
  })
  S.on('upgrade', upgrade(seen, 'S'))
  const PORT = S.address().port
  const other = await listen('::1', PORT, (q, s) => { seen.push(`OTHER ${q.url}`); s.setHeader('content-type', 'text/html'); s.end(page('OTHER')) })
  if (other) other.on('upgrade', upgrade(seen, 'OTHER'))
  const Pserver = await listen('127.0.0.1', 0, (q, s) => {
    seen.push(`P ${q.url}`)
    s.setHeader('content-type', 'text/html')
    const to = new URL(q.url, 'http://x').searchParams.get('to') || ''
    s.end(page('PROJECT', `<div style="width:400px;height:300px" onclick="top.location = ${JSON.stringify(to).replace(/"/g, '&quot;')}">click</div>`))
  })
  P = Pserver.address().port
  globalThis.proveAs = 'wrong'
  globalThis.proofs = 0
  const gate = servergate.create({ bundled: true, ...servergate.addresses(() => [PORT]), prove: async () => { globalThis.proofs++; return globalThis.proveAs }, patience: [] })
  globalThis.gate = gate
  globalThis.blocked = []
  servergate.wire(gate, { session: session.defaultSession, app, blocked: (_wc, url) => globalThis.blocked.push(url) })
  const w = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  // (A page from the start: a window with none yet holds up a debugger attaching, as the suite does.)
  await w.loadURL('about:blank').catch(() => {})
  globalThis.win = w
  // Its redirects as main.js's windows have them (senders.js redirect): one out of the app opened in
  // its own app (here, noted).
  const pages = senders.create(PORT)
  globalThis.opened = []
  w.webContents.on('will-redirect', (e, u) => pages.redirect(e, u, (to) => globalThis.opened.push(to)))
  globalThis.ports = { app: PORT, project: P, other: !!other }
  globalThis.ready = true
})
