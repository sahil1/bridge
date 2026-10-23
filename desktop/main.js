// Bridge AI as a desktop app (macOS, Windows, Linux). The window shows the same app the server
// serves (http://127.0.0.1:7420). If the server isn't running, the app starts it:
//   built app (npm run desktop:dist)  the copy of Bridge AI inside the app, on the app's own Node,
//                                     so the person using it needs nothing else installed
//   from source (npm run desktop)     your clone, with `node scripts/start.js`
const { app, BrowserWindow, Menu, shell, globalShortcut, Notification, session, nativeTheme, ipcMain, powerMonitor, screen, nativeImage, systemPreferences } = require('electron')

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
  // With an agent open in its own window, closing this one doesn't end the app; forget it so the
  // Dock icon, the shortcut or Bring back opens a new one.
  const self = win
  win.on('closed', () => { if (win === self) win = null })

  // Links to anything but the app open in their own apps (Teams, Outlook, Mail, the browser).
  win.webContents.setWindowOpenHandler(({ url }) => { if (!isLocal(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (!isLocal(url) && !url.startsWith('data:')) { e.preventDefault(); shell.openExternal(url) } })
  win.webContents.on('page-title-updated', (e, title) => { e.preventDefault(); updateBadge(title) })
  win.webContents.on('did-fail-load', (_e, code) => { if (code !== -3) setTimeout(connect, 1500) })

  await connect()
}

// The server outlives the window, so the one on the port can be left over from an older build or
// another copy of the app (an update that couldn't stop it, a copy run from elsewhere). Its code is
// the old one, so stop it and start this app's own. Agents carry on (in the terminal host, or in
// herdr); with Keep agents running off (Settings › General), built-in ones resume.
// A server you run from source (npm start) is left alone.
async function replaceStale() {
  if (!BUNDLED) return
  const mine = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) } catch { return {} } })()
  let theirs = null
  try { const r = await fetch(`${URL_BASE}/api/version`, { signal: AbortSignal.timeout(1500) }); theirs = r.ok ? await r.json() : null } catch { /* older server */ }
  if (theirs && (!theirs.bundled || (theirs.version === app.getVersion() && theirs.build === (mine.bridgeBuild || null)))) return
  let pid = theirs?.pid
  // Servers from before 2.2.1 don't say who they are: only the app's own bundled server, by its pid file.
  if (!pid && process.platform !== 'win32') {
    try {
      const p = Number(fs.readFileSync(PID, 'utf8'))
      const cmd = require('node:child_process').execFileSync('ps', ['-o', 'command=', '-p', String(p)], { encoding: 'utf8' })
      if (/app-root[\\/]server[\\/]index\.js/.test(cmd)) pid = p
    } catch { /* not running */ }
  }
  if (!pid) return
  try { process.kill(pid, 'SIGTERM') } catch { return }
  for (let i = 0; i < 50 && await serverUp(); i++) await new Promise((r) => setTimeout(r, 100))
}

// An agent in a window of its own (the ⧉ button in its header), one window per agent. Only the
// app's own pages can ask, and only for the app's own page.
const pops = new Map() // paneId -> BrowserWindow
const fromApp = (e) => isLocal(e.senderFrame?.url || e.sender.getURL())
ipcMain.handle('bridge:popout', (e, { paneId, title } = {}) => {
  if (!fromApp(e) || typeof paneId !== 'string' || !paneId || paneId.length > 200) return false
  const have = pops.get(paneId)
  if (have && !have.isDestroyed()) { have.show(); have.focus(); return true }
  const at = win && !win.isDestroyed() ? win.getBounds() : null
  const n = pops.size
  const w = new BrowserWindow({
    width: 980, height: 840, minWidth: 420, minHeight: 400,
    ...(at ? { x: at.x + 60 + n * 28, y: at.y + 50 + n * 28 } : {}),
    title: `${String(title || 'Agent').slice(0, 80)} · Bridge AI`,
    ...(IS_MAC ? {} : { autoHideMenuBar: true }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f3',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  w.once('ready-to-show', () => w.show())
  w.webContents.setWindowOpenHandler(({ url }) => { if (!isLocal(url)) shell.openExternal(url); return { action: 'deny' } })
  w.webContents.on('will-navigate', (ev, url) => { if (!isLocal(url)) { ev.preventDefault(); shell.openExternal(url) } })
  w.loadURL(`${URL_BASE}/?window=${encodeURIComponent(paneId)}`)
  pops.set(paneId, w)
  w.on('closed', () => { if (pops.get(paneId) === w) pops.delete(paneId) })
  return true
})
ipcMain.handle('bridge:focus-main', (e) => {
  if (!fromApp(e)) return false
  if (!win || win.isDestroyed()) createWindow()
  else { win.show(); win.focus() }
  return true
})
// Seconds since you last touched the computer, so a window left in front while you're away
// doesn't keep your phone quiet.
ipcMain.handle('bridge:idle', (e) => (fromApp(e) ? powerMonitor.getSystemIdleTime() : null))
// Restart Bridge AI, server too: what you allow in System Settings (Full Disk Access, say) only
// reaches processes started after. The relaunched app starts the server again. Agents keep
// running in the terminal host meanwhile, unless Keep agents running is off.
ipcMain.handle('bridge:restart', (e) => {
  if (!fromApp(e)) return false
  app.relaunch()
  stopServer()
  app.quit()
  return true
})
// ---------- Allow access: a tile next to System Settings ----------
// After Allow access opens a page of System Settings, a small tile floats at the bottom of the
// screen, above it: the app's icon, which you drag into the list (a real file drag of the app),
// and what to do there. It closes when access is detected, when you close it, or after 5 minutes.
const BUNDLE = IS_MAC ? /^(.*?\.app)\//.exec(process.execPath)?.[1] || null : null
const APP_NAME = BUNDLE ? path.basename(BUNDLE, '.app') : 'Bridge AI'
const TILE_STEPS = {
  'full-disk': { drag: true, text: `Drag ${APP_NAME} into the list above, then turn it on` },
  files: { text: `Under ${APP_NAME}, turn on the folders your projects are in` },
  calendars: { text: `Turn on ${APP_NAME} in the list above` },
  microphone: { text: `Turn on ${APP_NAME} in the list above` },
  automation: { text: `Under ${APP_NAME}, turn on Finder` },
  notifications: { text: `Turn on Allow notifications for ${APP_NAME}` },
}
let tile = null // { win, pane, timer, poll, icon }
function closeTile() {
  if (!tile) return
  clearTimeout(tile.timer); clearInterval(tile.poll)
  if (!tile.win.isDestroyed()) tile.win.close()
  tile = null
}
// Access on yet? The server answers for the folders it reads; the app asks macOS for the mic.
async function tileDone(pane) {
  if (pane === 'microphone') return systemPreferences.getMediaAccessStatus('microphone') === 'granted'
  try {
    const r = await fetch(`${URL_BASE}/api/fix/check?pane=${encodeURIComponent(pane)}`, { signal: AbortSignal.timeout(20000) })
    const d = r.ok ? await r.json() : null
    return d?.state === 'ok' || d?.state === 'restart'
  } catch { return false }
}
async function showTile(pane) {
  const step = TILE_STEPS[pane]
  if (!IS_MAC || !BUNDLE || !step) return false
  closeTile()
  let icon = null
  try { icon = await nativeImage.createThumbnailFromPath(BUNDLE, { width: 128, height: 128 }) } catch { /* below */ }
  if (!icon || icon.isEmpty()) icon = await app.getFileIcon(BUNDLE, { size: 'normal' }).catch(() => null)
  if (!icon || icon.isEmpty()) return false
  const W = 440, H = 96
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const w = new BrowserWindow({
    width: W, height: H, x: Math.round(area.x + (area.width - W) / 2), y: Math.round(area.y + area.height - H - 28),
    frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, acceptFirstMouse: true, show: false, title: `${APP_NAME}: allow access`,
    webPreferences: { preload: path.join(__dirname, 'tile-preload.js'), contextIsolation: true, sandbox: true },
  })
  w.setAlwaysOnTop(true, 'floating')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { color-scheme: light dark; --bg: #ffffff; --ink: #1d2433; --ink2: #5b6476; --line: rgba(16,24,40,.12); --accent: #2f6fe0; }
    @media (prefers-color-scheme: dark) { :root { --bg: #1b1f27; --ink: #e8ebf1; --ink2: #a9b0bf; --line: rgba(255,255,255,.12); --accent: #4e82ef; } }
    html, body { margin: 0; height: 100%; background: transparent; font: 13px -apple-system, system-ui, sans-serif; color: var(--ink); overflow: hidden; user-select: none; }
    .tile { position: absolute; inset: 8px; display: flex; align-items: center; gap: 12px; padding: 0 12px 0 10px; border-radius: 14px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 8px 24px rgb(0 0 0 / .22); -webkit-app-region: drag; }
    .icon { width: 56px; height: 56px; flex: none; border-radius: 12px; cursor: grab; -webkit-app-region: no-drag; animation: nudge 2.4s ease-in-out infinite; }
    .icon:active { cursor: grabbing; }
    @keyframes nudge { 0%, 70%, 100% { transform: translateY(0); } 80% { transform: translateY(-5px); } 90% { transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { .icon { animation: none; } }
    .text { flex: 1; min-width: 0; line-height: 1.35; }
    .text b { display: block; font-weight: 600; }
    .text span { color: var(--ink2); }
    button { -webkit-app-region: no-drag; flex: none; width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; color: var(--ink2); font-size: 17px; line-height: 1; cursor: pointer; }
    button:hover { background: var(--line); color: var(--ink); }
  </style></head><body><div class="tile">
    <img class="icon" id="icon" src="${icon.resize({ width: 112, height: 112 }).toDataURL()}" alt="${esc(APP_NAME)}" draggable="${step.drag ? 'true' : 'false'}" title="${step.drag ? `Drag ${esc(APP_NAME)} into the list` : ''}">
    <div class="text"><b>${esc(APP_NAME)}</b><span>${esc(step.text)}</span></div>
    <button id="x" aria-label="Close" title="Close">×</button>
  </div><script>
    document.getElementById('icon').addEventListener('dragstart', (e) => { e.preventDefault(); window.tile.drag() })
    document.getElementById('x').addEventListener('click', () => window.tile.close())
    addEventListener('keydown', (e) => { if (e.key === 'Escape') window.tile.close() })
  </script></body></html>`
  w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  w.once('ready-to-show', () => w.showInactive())
  const t = { win: w, pane, icon: icon.resize({ width: 64, height: 64 }) }
  t.timer = setTimeout(closeTile, 5 * 60 * 1000)
  // Gently, only while the tile is up.
  t.poll = setInterval(async () => { if (tile === t && await tileDone(pane) && tile === t) closeTile() }, 2500)
  w.on('closed', () => { if (tile === t) { clearTimeout(t.timer); clearInterval(t.poll); tile = null } })
  tile = t
  return true
}
ipcMain.handle('bridge:fix-tile', (e, pane) => (fromApp(e) && typeof pane === 'string' ? showTile(pane) : false))
ipcMain.handle('bridge:fix-tile-close', (e) => { if (fromApp(e)) closeTile(); return true })
// Only the tile may start the drag, and only of the app itself.
ipcMain.on('bridge:tile-drag', (e) => {
  if (!tile || e.sender !== tile.win.webContents || !TILE_STEPS[tile.pane]?.drag) return
  e.sender.startDrag({ file: BUNDLE, icon: tile.icon })
})
ipcMain.on('bridge:tile-close', (e) => { if (tile && e.sender === tile.win.webContents) closeTile() })
// Whether macOS lets the app use the mic: granted, denied, restricted or not-determined.
ipcMain.handle('bridge:media-access', (e, kind) => (fromApp(e) && kind === 'microphone' && IS_MAC ? systemPreferences.getMediaAccessStatus('microphone') : null))
// A notification to see whether macOS shows them (it doesn't say when they're turned off).
ipcMain.handle('bridge:notify-test', (e) => {
  if (!fromApp(e) || !Notification.isSupported()) return false
  new Notification({ title: 'Bridge AI', body: 'Notifications are on. You\'ll see one when an agent needs you or finishes.' }).show()
  return true
})
ipcMain.handle('bridge:focus-popout', (e, paneId) => {
  const w = fromApp(e) && pops.get(paneId)
  if (!w || w.isDestroyed()) return false
  w.show(); w.focus()
  return true
})

async function connect() {
  // Never in the way of opening: if the check fails, use whatever server is there.
  if (await serverUp()) await replaceStale().catch(() => {})
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
// when an agent starts waiting on you (with what it's asking) or finishes. Clicking it opens that
// agent, at its question.
const seen = new Map() // paneId -> { status, seq } last seen
const live = new Map() // paneId -> Notification (kept so macOS doesn't drop the click handler)
async function notifyFor(a) {
  const label = a.chief ? 'Chief of staff' : a.title || a.tab || a.workspace
  const blocked = a.status === 'blocked'
  const q = blocked ? await fetch(`${URL_BASE}/api/agents/${encodeURIComponent(a.paneId)}/question`).then((r) => r.json(), () => null).catch(() => null) : null
  const n = new Notification({
    title: blocked ? (q?.text ? `${label} needs you` : 'Needs you') : 'Finished',
    subtitle: `${a.workspace}${a.tab && a.tab !== label ? ` › ${a.tab}` : ''}`,
    body: q?.text || label,
    silent: !blocked,
  })
  n.on('click', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show(); win.focus()
    win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: ${JSON.stringify(a.paneId)}, view: ${JSON.stringify(blocked ? 'chat' : undefined)} } }))`).catch(() => {})
    live.delete(a.paneId)
  })
  n.on('close', () => live.delete(a.paneId))
  live.get(a.paneId)?.close()
  live.set(a.paneId, n)
  n.show()
}
let primed = false
let shownSession
function onFleet(f) {
  // Another herdr session in view: its agents are new here, not news, and the last session's only
  // left the view (they didn't finish). The same pane ids name other agents there.
  if ((f.session ?? null) !== shownSession) { if (shownSession !== undefined) { seen.clear(); primed = false } shownSession = f.session ?? null }
  if (f.down) return
  for (const a of f.agents || []) {
    const before = seen.get(a.paneId)
    // A change to "needs you" or "finished", or a new agent that shows up already there. The
    // state counter catches quick tasks that start and finish between two updates.
    const changed = before ? before.status !== a.status || before.seq !== a.seq : primed
    if (changed && (a.status === 'blocked' || a.status === 'done') && !a.muted) {
      // Skip it if you're already looking at Bridge AI.
      if (!(win && win.isFocused() && win.isVisible())) notifyFor(a).catch(() => {})
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

// Quitting leaves the server (and your agents) running. This stops the server; agents keep
// running in the terminal host unless Keep agents running is off (Settings › General).
function stopServer() {
  try { const pid = Number(fs.readFileSync(PID, 'utf8')); if (pid) process.kill(pid, 'SIGTERM') } catch { /* not running */ }
  try { fs.rmSync(PID) } catch { /* fine */ }
}
// Ask the terminal host to end its agents and exit, with the two messages every version of it
// understands (server/runtime/ptyhost.js). Its socket and token are in the data folder.
function stopAgents() {
  return new Promise((resolve) => {
    let info
    try { info = JSON.parse(fs.readFileSync(path.join(DATA, 'host', 'host.json'), 'utf8')) } catch { return resolve() }
    const s = require('node:net').connect(info.sock)
    const done = () => { s.destroy(); resolve() }
    s.on('connect', () => s.write(`${JSON.stringify({ t: 'hello', token: info.token, protocol: info.protocol })}\n${JSON.stringify({ t: 'quit' })}\n`))
    s.on('error', done)
    s.on('close', done)
    setTimeout(done, 3000)
  })
}
// Quit and Stop Agents: the server first (it saves your agents, to resume them next time), then
// them. Not from under a server that's still running (one this app didn't start).
async function stopAllAndQuit() {
  stopServer()
  for (let i = 0; i < 30 && await serverUp(); i++) await new Promise((r) => setTimeout(r, 100))
  if (!(await serverUp())) await stopAgents()
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
      { label: 'Quit and Stop Agents', click: () => { stopAllAndQuit().catch(() => app.quit()) } },
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
