// Bridge AI as a desktop app (macOS, Windows, Linux). The window shows the same app the server
// serves (http://127.0.0.1:7420). If the server isn't running, the app starts it:
//   built app (npm run desktop:dist)  the copy of Bridge AI inside the app, on the app's own Node,
//                                     so the person using it needs nothing else installed
//   from source (npm run desktop)     your clone, with `node scripts/start.js`
const { app, BrowserWindow, Menu, shell, globalShortcut, Notification, session, nativeTheme, ipcMain } = require('electron')

// A picture of part of the window (the Preview tab's app), for sending to an agent. Only this
// window, only a rectangle of it, only when the page asks.
ipcMain.handle('bridge:capture', async (e, r) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || !r) return null
  const rect = { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }
  return (await w.webContents.capturePage(rect)).toPNG().toString('base64')
})
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Where Bridge AI's code is: inside the app when built, the repo next to this folder from source.
// BRIDGE_ROOT overrides both (a built app running your clone, say).
const BUNDLED = app.isPackaged && !process.env.BRIDGE_ROOT
const ROOT = process.env.BRIDGE_ROOT || (app.isPackaged ? path.join(process.resourcesPath, 'app-root') : path.resolve(__dirname, '..'))
const DATA = process.env.BRIDGE_HOME || path.join(os.homedir(), '.bridge-ai')
const CONFIG = (() => {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return {} } }
  return { ...read(path.join(ROOT, 'config.example.json')), ...read(path.join(DATA, 'config.json')), ...read(path.join(ROOT, 'config.local.json')) }
})()
// Dev mode (npm run desktop:dev): the window shows the hot-reloading UI on the next port, so your
// edits appear without restarting or rebuilding the app.
const DEV = process.env.BRIDGE_DEV === '1'
const PID = path.join(DATA, 'cache', 'server.pid')
const PORT = (Number(process.env.BRIDGE_PORT) || CONFIG.port || 7420) + (DEV ? 1 : 0)
const URL_BASE = `http://127.0.0.1:${PORT}`
const SHORTCUT = CONFIG.desktop?.shortcut || 'Alt+CommandOrControl+A'
const IS_MAC = process.platform === 'darwin'

// Dev gets its own name, and with it its own profile, so the dev window can run next to the
// installed app instead of focusing it.
app.setName(DEV ? 'Bridge AI Dev' : 'Bridge AI')
// A separate data folder (BRIDGE_HOME) is a separate Bridge AI: give it its own window profile so it
// can run next to your usual one.
if (process.env.BRIDGE_HOME) app.setPath('userData', path.join(DATA, 'desktop'))
if (!app.requestSingleInstanceLock()) app.quit()
const STATE = path.join(app.getPath('userData'), 'window.json')

let win = null
let startedServer = false

// Apps opened from the Dock or a launcher get a bare PATH; ask a login shell for the user's real
// one (node and the agent CLIs live there). Windows apps get the full PATH already.
function loginPath() {
  if (process.platform === 'win32') return Promise.resolve(process.env.PATH)
  return new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/sh', ['-lic', 'printf "%s" "$PATH"'], { timeout: 8000 }, (err, out) => resolve(err ? process.env.PATH : out.trim().split('\n').pop()))
  })
}

async function serverUp() {
  try { const r = await fetch(`${URL_BASE}/api/config`, { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false }
}

// From source the server needs your shell's PATH to find node, so look it up while the app is
// still launching. The built app runs on its own Node and starts right away; the server looks up
// your PATH itself, in the background, for the agents.
const PATH_READY = app.isPackaged && !process.env.BRIDGE_ROOT ? null : loginPath()

async function startServer() {
  const env = { ...process.env, PATH: PATH_READY ? await PATH_READY : process.env.PATH }
  // Built app: run the bundled server on Electron's Node. It keeps running when the window
  // closes, like `npm start`, so agents carry on; quit it from the Bridge AI menu.
  const [cmd, args] = BUNDLED
    ? [process.execPath, [path.join(ROOT, 'server', 'index.js')]]
    : [process.platform === 'win32' ? 'node.exe' : 'node', ['scripts/start.js', ...(DEV ? ['dev'] : [])]]
  if (BUNDLED) env.ELECTRON_RUN_AS_NODE = '1'
  const child = require('node:child_process').spawn(cmd, args, { cwd: ROOT, env, detached: true, stdio: 'ignore', windowsHide: true })
  // Same pid file as `npm start`, so `npm run stop` and "Quit and Stop Agents" both find it.
  if (BUNDLED) try { fs.mkdirSync(path.dirname(PID), { recursive: true }); fs.writeFileSync(PID, String(child.pid)) } catch { /* not fatal */ }
  child.unref()
  startedServer = true
}

function loadBounds() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return { width: 1500, height: 960 } }
}
function saveBounds() {
  if (!win || win.isMinimized()) return
  try { fs.writeFileSync(STATE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })) } catch { /* ignore */ }
}

const isLocal = (u) => { try { const x = new URL(u); return (x.hostname === '127.0.0.1' || x.hostname === 'localhost') && Number(x.port) === PORT } catch { return false } }

// Shown for the second or so while the server starts: the logo and a line of text.
const LOGO = (() => { for (const f of ['dist/mark.svg', 'public/mark.svg']) { try { return fs.readFileSync(path.join(ROOT, f), 'utf8') } catch { /* next */ } } return '' })()
function splash(text) {
  const bg = nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f3'
  const fg = nativeTheme.shouldUseDarkColors ? '#a9b0bf' : '#4a5263'
  const logo = LOGO ? `<div style="width:64px;height:64px;margin:0 auto 16px;border-radius:15px;overflow:hidden;box-shadow:0 10px 30px rgb(0 0 0 / .25)">${LOGO.replace('<svg ', '<svg width="64" height="64" ')}</div>` : ''
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${bg};color:${fg};font:14px -apple-system,system-ui,sans-serif;-webkit-app-region:drag"><div style="text-align:center">${logo}${text}</div></body></html>`)}`
}

async function createWindow() {
  const b = loadBounds()
  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y, minWidth: 420, minHeight: 500,
    title: 'Bridge AI',
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 17 } } : { autoHideMenuBar: true }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f3',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  if (b.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  for (const ev of ['resize', 'move', 'close']) win.on(ev, saveBounds)

  // Links to anything but the app open in their own apps (Teams, Outlook, Mail, the browser).
  win.webContents.setWindowOpenHandler(({ url }) => { if (!isLocal(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (!isLocal(url) && !url.startsWith('data:')) { e.preventDefault(); shell.openExternal(url) } })
  win.webContents.on('page-title-updated', (e, title) => { e.preventDefault(); updateBadge(title) })
  win.webContents.on('did-fail-load', (_e, code) => { if (code !== -3) setTimeout(connect, 1500) })

  await connect()
}

async function connect() {
  if (await serverUp()) return win.loadURL(URL_BASE)
  win.loadURL(splash('Starting Bridge AI…'))
  // Dev mode needs both ports; a normal server already on the API port would block it.
  if (DEV && !startedServer) {
    const api = await fetch(`http://127.0.0.1:${PORT - 1}/api/config`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false)
    if (api) return win.loadURL(splash(`Bridge AI is already running without hot reload.<br>Run <code>npm run stop</code>, then <code>npm run desktop:dev</code> again.`))
  }
  if (!startedServer) await startServer().catch(() => {})
  // The server is usually up in under half a second, so check often (for up to a minute; the dev
  // server can take longer the first time).
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if (await serverUp()) return win.loadURL(URL_BASE)
  }
  win.loadURL(splash(BUNDLED
    ? `Couldn't start Bridge AI on port ${PORT}.<br>Another program may be using it: set <code>"port"</code> in ~/.bridge-ai/config.json and reopen.`
    : `Couldn't reach the server on port ${PORT}.<br>Run <code>npm start</code> in ${ROOT.replace(os.homedir(), '~')} and reopen Bridge AI.`))
}

// The page title carries the "needs you" count: "(2) Bridge AI". Mirror it on the Dock icon (macOS)
// or the taskbar (Windows, Linux).
let lastCount = 0
function updateBadge(title) {
  const n = Number(/^\((\d+)\)/.exec(title || '')?.[1] || 0)
  if (app.dock) app.dock.setBadge(n ? String(n) : '')
  else app.setBadgeCount?.(n)
  if (n > lastCount && !win?.isFocused()) app.dock?.bounce('informational')
  lastCount = n
}

// Agent notifications come from Bridge AI itself: watch the server's live fleet feed and post one
// when an agent starts waiting on you or finishes. Clicking it opens that agent.
const seen = new Map() // paneId -> { status, seq } last seen
const live = new Map() // paneId -> Notification (kept so macOS doesn't drop the click handler)
function notifyFor(a) {
  const label = a.chief ? 'Chief of staff' : a.title || a.tab || a.workspace
  const n = new Notification({
    title: a.status === 'blocked' ? 'Needs you' : 'Finished',
    subtitle: `${a.workspace}${a.tab && a.tab !== label ? ` › ${a.tab}` : ''}`,
    body: label,
    silent: a.status !== 'blocked',
  })
  n.on('click', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show(); win.focus()
    win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: ${JSON.stringify(a.paneId)} } }))`).catch(() => {})
    live.delete(a.paneId)
  })
  n.on('close', () => live.delete(a.paneId))
  live.get(a.paneId)?.close()
  live.set(a.paneId, n)
  n.show()
}
let primed = false
function onFleet(f) {
  for (const a of f.agents || []) {
    const before = seen.get(a.paneId)
    // A change to "needs you" or "finished", or a new agent that shows up already there. The
    // state counter catches quick tasks that start and finish between two updates.
    const changed = before ? before.status !== a.status || before.seq !== a.seq : primed
    if (changed && (a.status === 'blocked' || a.status === 'done')) {
      // Skip it if you're already looking at Bridge AI.
      if (!(win && win.isFocused() && win.isVisible())) notifyFor(a)
    }
    seen.set(a.paneId, { status: a.status, seq: a.seq })
  }
  primed = true
}
async function watchFleet() {
  for (;;) {
    try {
      const res = await fetch(`${URL_BASE}/api/events`, { headers: { Accept: 'text/event-stream' } })
      if (!res.ok || !res.body) throw new Error(String(res.status))
      const dec = new TextDecoder()
      let buf = ''
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          if (!/^event: fleet$/m.test(block)) continue
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
          try { onFleet(JSON.parse(data)) } catch { /* partial or bad frame */ }
        }
      }
    } catch { /* server down or restarting; retry */ }
    await new Promise((r) => setTimeout(r, 3000))
  }
}

// Quitting leaves the server (and your agents) running. This stops it too.
function stopServerAndQuit() {
  try { const pid = Number(fs.readFileSync(PID, 'utf8')); if (pid) process.kill(pid, 'SIGTERM') } catch { /* not running */ }
  try { fs.rmSync(PID) } catch { /* fine */ }
  app.quit()
}

function toggleWindow() {
  if (!win) return createWindow()
  if (win.isFocused()) win.hide()
  else { win.show(); win.focus() }
}

function buildMenu() {
  const login = app.getLoginItemSettings().openAtLogin
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Bridge AI', submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Open at Login', type: 'checkbox', checked: login, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked }) },
      { label: 'Show or Hide Bridge AI', accelerator: SHORTCUT, registerAccelerator: false, click: toggleWindow },
      { type: 'separator' },
      ...(IS_MAC ? [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }] : []),
      { role: 'quit' },
      { label: 'Quit and Stop Agents', click: stopServerAndQuit },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
      { label: 'Open in Browser', click: () => shell.openExternal(URL_BASE) },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools' },
    ] },
    { role: 'windowMenu' },
  ]))
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() } })
app.on('activate', () => { if (!win) createWindow(); else win.show() })
app.on('window-all-closed', () => { win = null })
app.on('will-quit', () => globalShortcut.unregisterAll())

app.whenReady().then(() => {
  // Voice notes need the mic; allow it for the app's own page only.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(isLocal(wc.getURL()) && ['media', 'notifications', 'geolocation', 'clipboard-read', 'clipboard-sanitized-write'].includes(perm)))
  buildMenu()
  globalShortcut.register(SHORTCUT, toggleWindow)
  createWindow()
  watchFleet()
})
