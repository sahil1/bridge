// Bridge AI as a desktop app (macOS, Windows, Linux). The window shows the same app the server
// serves (http://127.0.0.1:7420). If the server isn't running, the app starts it:
//   built app (npm run desktop:dist)  the copy of Bridge AI inside the app, on the app's own Node,
//                                     so the person using it needs nothing else installed
//   from source (npm run desktop)     your clone, with `node scripts/start.js`
const electron = require('electron')
const { app, BrowserWindow, Menu, Tray, shell, globalShortcut, Notification, session, nativeTheme, ipcMain, powerMonitor, screen, nativeImage, systemPreferences, dialog, desktopCapturer } = electron
const dictation = require('./dictation.js')
const contextMenu = require('./contextmenu.js')
const permissions = require('./permissions.js')

// A picture of part of the window (the Preview tab's app), for sending to an agent. Only this
// window, only a rectangle of it, only when the page asks.
ipcMain.handle('bridge:capture', async (e, r) => {
  if (!fromApp(e)) return null
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || !r) return null
  const rect = { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }
  return (await w.webContents.capturePage(rect)).toPNG().toString('base64')
})
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crashes = require('./crashes.js')

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
// A meeting recording in the window: closing it hides it instead, so the recording goes on.
let recording = false
let quitting = false
let reopened = 0 // when the window was last opened again after its page went away

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

// On a Mac the server runs on the app's Helper, and so does everything it runs as Node (the
// terminal host, the `node` it gives agents). A Node process that names itself (process.title)
// checks in with macOS as the app its executable belongs to: on Bridge AI's own executable, macOS
// then takes the terminal host for Bridge AI still open after a restart and won't open the app
// ("can't be opened", -600). The Helper is a background-only app of its own.
const NODE_BIN = (() => {
  if (!IS_MAC || !BUNDLED) return process.execPath
  const name = path.basename(process.execPath)
  const helper = path.join(path.dirname(process.execPath), '..', 'Frameworks', `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`)
  return fs.existsSync(helper) ? path.resolve(helper) : process.execPath
})()

async function startServer() {
  const env = { ...process.env, PATH: PATH_READY ? await PATH_READY : process.env.PATH }
  // Built app: run the bundled server on Electron's Node. It keeps running when the window
  // closes, like `npm start`, so agents carry on; quit it from the Bridge AI menu.
  const [cmd, args] = BUNDLED
    ? [NODE_BIN, [path.join(ROOT, 'server', 'index.js')]]
    : [process.platform === 'win32' ? 'node.exe' : 'node', ['scripts/start.js', ...(DEV ? ['dev'] : [])]]
  if (BUNDLED) env.ELECTRON_RUN_AS_NODE = '1'
  // What it prints goes in logs/server.log, for a crash report's last lines.
  const log = crashes.serverLog(DATA)
  const child = require('node:child_process').spawn(cmd, args, { cwd: ROOT, env, detached: true, stdio: ['ignore', log, log], windowsHide: true })
  if (typeof log === 'number') try { fs.closeSync(log) } catch { /* the server has its own copy */ }
  // Same pid file as `npm start`, so `npm run stop` and "Quit and Stop Agents" both find it.
  if (BUNDLED) try { fs.mkdirSync(path.dirname(PID), { recursive: true }); fs.writeFileSync(PID, String(child.pid)) } catch { /* not fatal */ }
  // Ended without being asked to, while this app runs: written down, to offer a report once it's back.
  child.on('exit', (code, signal) => { if (!stoppingServer) crashes.note(crashes.fromServerExit(code, signal), { base: URL_BASE, data: DATA, version: app.getVersion() }).catch(() => {}) })
  child.unref()
  startedServer = true
}
let stoppingServer = false

function loadBounds() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return { width: 1500, height: 960 } }
}
function saveBounds() {
  if (!win || win.isMinimized()) return
  try { fs.writeFileSync(STATE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })) } catch { /* ignore */ }
}

const isLocal = (u) => { try { const x = new URL(u); return (x.hostname === '127.0.0.1' || x.hostname === 'localhost') && Number(x.port) === PORT } catch { return false } }
// Links out of the app open in their own apps, but only web, mail and Mail's message links: file:,
// smb: and other schemes can mount a network share or start a program.
const OUTSIDE = new Set(['http:', 'https:', 'mailto:', 'message:'])
const openOutside = (u) => { try { if (OUTSIDE.has(new URL(u).protocol)) shell.openExternal(u) } catch { /* not a link */ } }

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
  win.on('close', (e) => { if (recording && !quitting) { e.preventDefault(); win.hide() } })
  // With an agent open in its own window, closing this one doesn't end the app; forget it so the
  // Dock icon, the shortcut or Bring back opens a new one.
  const self = win
  win.on('closed', () => { if (win === self) win = null })
  win.on('session-end', shuttingDown) // Windows: shutting down, restarting or signing out

  // Links to anything but the app open in their own apps (Teams, Outlook, Mail, the browser).
  win.webContents.setWindowOpenHandler(({ url }) => { if (!isLocal(url)) openOutside(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (!isLocal(url) && !url.startsWith('data:')) { e.preventDefault(); openOutside(url) } })
  win.webContents.on('page-title-updated', (e, title) => { e.preventDefault(); updateBadge(title) })
  win.webContents.on('did-fail-load', (_e, code) => { if (code !== -3) setTimeout(connect, 1500) })
  // The page went away (a crash, out of memory): written down, and opened again, which then offers
  // to report it. At most once a minute, so a page that can't stay up doesn't go round and round.
  win.webContents.on('render-process-gone', (_e, d) => {
    const c = crashes.fromWindowGone(d)
    if (!c || quitting) return
    crashes.note(c, { base: URL_BASE, data: DATA, version: app.getVersion() }).catch(() => {})
    if (Date.now() - reopened > 60000) { reopened = Date.now(); setTimeout(() => { if (self && !self.isDestroyed()) self.webContents.reload() }, 1000) }
  })

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
const machineWins = new Map() // machine id ('' for this one) -> BrowserWindow
// Where each device's window was, to open it there again (the main window's is in window.json).
const DEVICE_STATE = path.join(app.getPath('userData'), 'device-windows.json')
const deviceBounds = () => { try { return JSON.parse(fs.readFileSync(DEVICE_STATE, 'utf8')) } catch { return {} } }
function saveDeviceBounds(key, w) {
  if (w.isDestroyed() || w.isMinimized()) return
  try { fs.writeFileSync(DEVICE_STATE, JSON.stringify({ ...deviceBounds(), [key]: { ...w.getNormalBounds(), maximized: w.isMaximized() } })) } catch { /* ignore */ }
}
// The app's own pages. Another device's pages (/m/<id>/) only get windows (fromAny), and a page an
// agent made (/api/...) gets nothing.
const ownPage = (u) => { try { return isLocal(u) && !/^\/(m|api)\//.test(new URL(u).pathname) } catch { return false } }
const fromApp = (e) => ownPage(e.senderFrame?.url || e.sender.getURL())
const fromAny = (e) => { const u = e.senderFrame?.url || e.sender.getURL(); return isLocal(u) && !/^\/api\//.test(new URL(u).pathname) }
ipcMain.handle('bridge:popout', (e, { paneId, title, machine } = {}) => {
  if (!fromAny(e) || typeof paneId !== 'string' || !paneId || paneId.length > 200) return false
  // An agent on another of your devices (machines.js) opens through it too.
  const prefix = machine && /^[A-Za-z0-9_-]{1,20}$/.test(machine) ? `/m/${machine}` : ''
  if (prefix) paneId = `${machine}:${paneId}`
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
  w.webContents.setWindowOpenHandler(({ url }) => { if (!isLocal(url)) openOutside(url); return { action: 'deny' } })
  w.webContents.on('will-navigate', (ev, url) => { if (!isLocal(url)) { ev.preventDefault(); openOutside(url) } })
  w.loadURL(`${URL_BASE}${prefix}/?window=${encodeURIComponent(prefix ? paneId.slice(machine.length + 1) : paneId)}`)
  pops.set(paneId, w)
  w.on('closed', () => { if (pops.get(paneId) === w) pops.delete(paneId) })
  return true
})
ipcMain.handle('bridge:focus-main', (e) => {
  if (!fromAny(e)) return false
  if (!win || win.isDestroyed()) createWindow()
  else { win.show(); win.focus() }
  return true
})
// One of your other devices (server/machines.js) in a window of its own, beside this one's.
ipcMain.handle('bridge:open-machine', (e, { id = null, agent = null } = {}) => {
  if (!fromAny(e) || (id != null && !/^[A-Za-z0-9_-]{1,20}$/.test(String(id))) || (agent != null && (typeof agent !== 'string' || agent.length > 200))) return false
  const key = id || ''
  const page = `${URL_BASE}${id ? `/m/${id}` : ''}/${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`
  const have = machineWins.get(key)
  if (have && !have.isDestroyed()) { if (agent) have.loadURL(page); have.show(); have.focus(); return true }
  const at = win && !win.isDestroyed() ? win.getBounds() : null
  const was = deviceBounds()[key]
  const w = new BrowserWindow({
    width: was?.width || at?.width || 1280, height: was?.height || at?.height || 820, minWidth: 420, minHeight: 400,
    ...(was ? { x: was.x, y: was.y } : at ? { x: at.x + 40, y: at.y + 40 } : {}),
    title: 'Bridge AI',
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 17 } } : { autoHideMenuBar: true }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f3',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  w.once('ready-to-show', () => w.show())
  w.webContents.setWindowOpenHandler(({ url }) => { if (!isLocal(url)) openOutside(url); return { action: 'deny' } })
  w.webContents.on('will-navigate', (ev, url) => { if (!isLocal(url)) { ev.preventDefault(); openOutside(url) } })
  if (was?.maximized) w.maximize()
  for (const ev of ['resize', 'move', 'close']) w.on(ev, () => saveDeviceBounds(key, w))
  w.loadURL(page)
  machineWins.set(key, w)
  w.on('closed', () => { if (machineWins.get(key) === w) machineWins.delete(key) })
  return true
})
// A folder for a new agent, picked in Finder rather than typed. Its path, or null if you cancel.
ipcMain.handle('bridge:pick-folder', async (e, start) => {
  if (!fromApp(e)) return null
  const owner = BrowserWindow.fromWebContents(e.sender) || win
  const r = await dialog.showOpenDialog(owner, { title: 'Choose a folder for the agent', buttonLabel: 'Choose', properties: ['openDirectory', 'createDirectory'], ...(typeof start === 'string' && start.length < 4096 ? { defaultPath: start } : {}) })
  return r.canceled ? null : r.filePaths[0] || null
})
// Files to link to a meeting, where they are (meetings read them when they write the notes).
ipcMain.handle('bridge:pick-files', async (e) => {
  if (!fromApp(e)) return null
  const owner = BrowserWindow.fromWebContents(e.sender) || win
  const r = await dialog.showOpenDialog(owner, { title: 'Files for this meeting', buttonLabel: 'Link', properties: ['openFile', 'multiSelections'] })
  return r.canceled ? [] : r.filePaths.slice(0, 30)
})
// While a meeting watches a shared screen, the window keeps its timers on time even when it's
// hidden behind the call, so a new slide is noticed.
ipcMain.handle('bridge:watching', (e, on) => { if (fromApp(e) && e.sender === win?.webContents) win.webContents.setBackgroundThrottling(!on); return true })
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
// This app's bundle ID, as macOS files its permissions under (from its own Info.plist).
const bundleId = () => { try { return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(fs.readFileSync(path.join(BUNDLE, 'Contents', 'Info.plist'), 'utf8'))?.[1] || null } catch { return null } }
const APP_NAME = BUNDLE ? path.basename(BUNDLE, '.app') : 'Bridge AI'
const TILE_STEPS = {
  'full-disk': { drag: true, text: `Drag ${APP_NAME} into the list above, then turn it on` },
  files: { text: `Under ${APP_NAME}, turn on the folders your projects are in` },
  calendars: { text: `Turn on ${APP_NAME} in the list above` },
  microphone: { text: `Turn on ${APP_NAME} in the list above` },
  automation: { text: `Under ${APP_NAME}, turn on Finder` },
  notifications: { text: `Turn on Allow notifications for ${APP_NAME}` },
  // Dictation's "Where I'm typing" (dictation.js): listed already, by macOS's own question.
  accessibility: { text: `Turn on ${APP_NAME} in the list above` },
  // A call's sound for meeting notes: listed once a recording has asked.
  audio: { text: `Under System Audio Recording Only, turn on ${APP_NAME}` },
  // Fn or the right ⌥ as the dictation key (dictation.js): listed already, by macOS's own question.
  'input-monitoring': { text: `Turn on ${APP_NAME} in the list above` },
}
let tile = null // { win, pane, timer, poll, icon }
function closeTile() {
  if (!tile) return
  clearTimeout(tile.timer); clearInterval(tile.poll)
  if (!tile.win.isDestroyed()) tile.win.close()
  tile = null
}
// Access on yet? The server answers for the folders it reads; the app asks macOS for the mic and
// Accessibility (without asking you).
async function tileDone(pane) {
  if (perms.kinds().includes(pane)) { const s = await perms.status(pane); if (s === 'ok') reportPerms(); return s === 'ok' }
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
// ---------- Permissions the app itself asks for (permissions.js) ----------
// The microphone, Accessibility (pasting where you're typing) and notifications: macOS's own question
// first, System Settings and the tile when it has none to ask, and Reset and ask again for an answer
// that shows as on and doesn't take. The page decides when (src/permissions.js); only the app's own
// pages may ask, never another device's shown here (its permissions are that computer's).
const perms = permissions.create({
  systemPreferences,
  openExternal: (u) => shell.openExternal(u),
  tccutil: (args) => new Promise((resolve) => execFile('/usr/bin/tccutil', args, { timeout: 10000 }, () => resolve())),
  bundleId: () => (BUNDLE ? bundleId() : null),
  showTile: (kind) => showTile(kind),
  paste: () => canPaste,
  lone: () => loneKey,
  // Whether macOS lets the app listen to keys, asked of native/bridgekeys (it can only look, or ask).
  listen: IS_MAC ? { access: () => listenAsk('listen-access'), ask: () => listenAsk('listen-ask') } : null,
  onChange: () => reportPerms(),
})
let canPaste = false // pasting where you're typing can work here (dictation.js says, each time the key is set)
let loneKey = false // a lone key (Fn, the right ⌥) is the dictation key, so Input Monitoring is asked about
const listenAsk = (cmd) => new Promise((resolve) => execFile(process.env.BRIDGE_KEYS || path.join(ROOT, 'native', 'bin', 'bridgekeys'), [cmd], { timeout: 10000 }, (err, out) => {
  try { resolve(!!JSON.parse(String(out).trim().split('\n').pop()).allowed) } catch { resolve(false) }
}))
ipcMain.handle('bridge:perm', async (e, { op, kind } = {}) => {
  if (!fromApp(e)) return null
  if (op === 'kinds') return perms.kinds()
  if (typeof kind !== 'string' || !perms.kinds().includes(kind)) return null
  const r = op === 'status' ? await perms.status(kind)
    : op === 'ask' ? await perms.ask(kind)
      : op === 'reset' ? await perms.reset(kind)
        : op === 'open' ? await perms.open(kind)
          : op === 'can-reset' ? perms.canReset(kind) : null
  reportPerms()
  return r
})
// What the app is allowed, told to the server now and then and when it may have changed, so your
// phone and your other devices can see it (server/fixes.js appReport) and the server knows this app
// listens for "allow it here" from them.
let reported = { body: '', at: 0 }
async function reportPerms() {
  let body
  try { body = JSON.stringify({ version: app.getVersion(), states: await perms.all() }) } catch { return }
  if (body === reported.body && Date.now() - reported.at < 60000) return
  reported = { body, at: Date.now() }
  fetch(`${URL_BASE}/api/fix/desktop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(5000) }).catch(() => { reported.at = 0 })
}
// Another of your devices (or your phone) asked this computer to allow something (server/fixes.js
// askHere): the main window comes forward at Settings › General › Permissions, which asks.
function onFixAsk(a) {
  if (!a || typeof a.pane !== 'string') return
  const ask = { pane: a.pane, folder: typeof a.folder === 'string' ? a.folder : null, from: typeof a.from === 'string' ? a.from : null, at: Date.now() }
  tellMain(`window.__bridgePermAsk = ${JSON.stringify(ask)}; window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'permissions' } })); window.dispatchEvent(new CustomEvent('bridge-permission-ask'))`, true).catch(() => {})
}
// Whether macOS lets the app use the mic: granted, denied, restricted or not-determined.
ipcMain.handle('bridge:media-access', (e, kind) => (fromApp(e) && kind === 'microphone' && IS_MAC ? systemPreferences.getMediaAccessStatus('microphone') : null))
// The mic, asked of macOS before the page opens it (src/audio/pcm.js askMic): the first time, macOS
// asks its own question, where opening the mic alone can be turned down with no question at all.
ipcMain.handle('bridge:media-ask', async (e, kind) => {
  if (!fromApp(e) || kind !== 'microphone' || !IS_MAC) return null
  if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') await systemPreferences.askForMediaAccess('microphone').catch(() => false)
  reportPerms()
  return systemPreferences.getMediaAccessStatus('microphone')
})
// macOS's answer about the mic forgotten (tccutil, for this app only), then asked again. For an
// answer kept from a version signed differently (up to 3.4.2), which can show as allowed in System
// Settings and still block the mic.
ipcMain.handle('bridge:media-reset', async (e, kind) => {
  if (!fromApp(e) || kind !== 'microphone' || !IS_MAC) return null
  const id = bundleId()
  if (id) await new Promise((resolve) => execFile('/usr/bin/tccutil', ['reset', 'Microphone', id], { timeout: 10000 }, () => resolve()))
  await systemPreferences.askForMediaAccess('microphone').catch(() => false)
  reportPerms()
  return systemPreferences.getMediaAccessStatus('microphone')
})
// A notification to see whether macOS shows them (it doesn't say when they're turned off).
ipcMain.handle('bridge:notify-test', (e) => {
  if (!fromApp(e) || !Notification.isSupported()) return false
  new Notification({ title: 'Bridge AI', body: 'Notifications are on. You\'ll see one when an agent needs you or finishes.' }).show()
  return true
})
ipcMain.handle('bridge:focus-popout', (e, paneId) => {
  const w = fromAny(e) && pops.get(paneId)
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
  const label = a.chief ? 'Chief of Staff' : a.title || a.tab || a.workspace
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
      // x-bridge-desktop: this is the app's own feed, which also hears "allow it here" (onFixAsk).
      const res = await fetch(`${URL_BASE}/api/events`, { headers: { Accept: 'text/event-stream', 'x-bridge-desktop': app.getVersion() } })
      reportPerms()
      if (!res.ok || !res.body) throw new Error(String(res.status))
      const dec = new TextDecoder()
      let buf = ''
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const fleet = /^event: fleet$/m.test(block)
          if (!fleet && !/^event: fix-ask$/m.test(block)) continue
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
          try { if (fleet) onFleet(JSON.parse(data)); else onFixAsk(JSON.parse(data)) } catch { /* partial or bad frame */ }
        }
      }
    } catch { /* server down or restarting; retry */ }
    await new Promise((r) => setTimeout(r, 3000))
  }
}

// Quitting leaves the server (and your agents) running. This stops the server; agents keep
// running in the terminal host unless Keep agents running is off (Settings › General).
function stopServer() {
  stoppingServer = true
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

// From the menu, so it works when the window can't: an update the page trips over leaves no way to
// its own Update button. Asks the server, which checks GitHub and installs as Settings › About does.
async function checkForUpdates() {
  const say = (o) => dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, { type: 'info', ...o })
  let u
  try { u = await fetch(`${URL_BASE}/api/updates?refresh=1`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()) } catch (e) { return say({ type: 'warning', message: 'Couldn\'t check for an update', detail: `${APP_NAME} isn't answering yet (${e.message}). Try again in a minute.` }) }
  if (u.error) return say({ type: 'warning', message: 'Couldn\'t check for an update', detail: u.error })
  if (u.disabled) return say({ message: 'Checking for updates is turned off', detail: 'Turn it on in Settings › About.' })
  // This app can be behind the server it shows: one run from your clone (npm start) is as new as the
  // clone, and the app around it only updates when asked. The app's own version counts too, and so
  // does the newest release's macOS minimum: a Mac that can't open it isn't offered it.
  const mine = app.getVersion()
  const appBehind = !!u.latest && newer(u.latest, mine)
  const held = u.held || (appBehind ? u.below : null)
  if (held) return say({ message: `${APP_NAME} ${held.latest} needs macOS ${held.macos} or later`, detail: `This Mac has macOS ${held.have}, so ${APP_NAME} stays on ${u.held ? u.current : mine}, which keeps working. Update macOS in System Settings › General › Software Update to get newer versions.` })
  if (!u.available && !appBehind) return say({ message: `You're on the latest version (${u.current})` })
  const forApp = !u.available && appBehind
  if (u.how !== 'app' && !(forApp && u.appUpdate)) return say({ message: `${APP_NAME} ${u.latest} is out`, detail: u.command ? `Update from a terminal:\n${u.command}` : '' })
  const { response } = await say({ message: `${APP_NAME} ${u.latest} is out`, detail: `You have ${forApp ? mine : u.current}. ${APP_NAME} restarts when the update is in.`, buttons: ['Update now', 'Later'], defaultId: 0, cancelId: 1 })
  if (response !== 0) return
  const r = await fetch(`${URL_BASE}/api/updates/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: forApp }), signal: AbortSignal.timeout(30000) }).then((x) => x.json(), (e) => ({ error: e.message }))
  if (r?.error) say({ type: 'warning', message: 'Couldn\'t update', detail: r.error })
}
// 1.24.0 < 1.24.1 < 2.0.0, as server/updates.js compares them.
const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0)
const newer = (a, b) => { const x = parts(a); const y = parts(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i] } return false }
// What the window remembers about its layout (open tabs, panel sizes, what's expanded), forgotten,
// as the crash screen's Reset this window's layout does: for a window that can't show that screen.
const resetLayout = () => win?.webContents.executeJavaScript(`(() => { const keep = new Set(['cc-appearance', 'cc-theme', 'cc-toured', 'cc-lang']); try { for (const k of Object.keys(localStorage)) if (k.startsWith('cc-') && !keep.has(k)) localStorage.removeItem(k) } catch {} location.reload() })()`).catch(() => {})

function buildMenu() {
  const login = app.getLoginItemSettings().openAtLogin
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Bridge AI', submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => { checkForUpdates().catch(() => {}) } },
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
      { label: 'Reset This Window\'s Layout', click: resetLayout },
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

// ---------- The floating card (Settings › Meetings) ----------
// A small window over the others, on every desktop and over full-screen apps: the meeting being
// recorded, Take notes when a call starts, Stop when it ends, or what needs you. It's the app's own
// page (?float=1); this decides when it shows, from the server's /api/calls, every two seconds.
const FLOAT_STATE = path.join(app.getPath('userData'), 'float.json')
let float = null
let floatHiddenFor = null // what was on the card when you hid it: it stays hidden until that changes
let floatKey = null
function floatAt(w, h) {
  try {
    // Where you left it, kept whole on that screen (it was moved while small, say).
    const p = JSON.parse(fs.readFileSync(FLOAT_STATE, 'utf8'))
    const d = screen.getAllDisplays().find((x) => p.x >= x.bounds.x && p.x < x.bounds.x + x.bounds.width && p.y >= x.bounds.y && p.y < x.bounds.y + x.bounds.height)
    if (d) return { x: Math.max(d.workArea.x, Math.min(p.x, d.workArea.x + d.workArea.width - w)), y: Math.max(d.workArea.y, Math.min(p.y, d.workArea.y + d.workArea.height - h)) }
  } catch { /* first time */ }
  const a = screen.getPrimaryDisplay().workArea
  return { x: a.x + a.width - w - 12, y: a.y + 12 }
}
function showFloat() {
  if (float && !float.isDestroyed()) { if (!float.isVisible()) float.showInactive(); return }
  const W = 324, H = 150
  const at = floatAt(W, H)
  float = new BrowserWindow({
    width: W, height: H, x: at.x, y: at.y, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, acceptFirstMouse: true, show: false, title: `${APP_NAME} card`,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  float.setAlwaysOnTop(true, 'floating')
  float.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Not in pictures of the screen: the meeting's own (Watch a screen) or a screen you share on a call.
  float.setContentProtection(true)
  float.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  float.webContents.on('will-navigate', (e) => e.preventDefault())
  float.on('moved', () => { try { const b = float.getBounds(); fs.writeFileSync(FLOAT_STATE, JSON.stringify({ x: b.x, y: b.y })) } catch { /* read-only */ } })
  float.on('closed', () => { float = null })
  float.once('ready-to-show', () => float?.showInactive())
  float.loadURL(`${URL_BASE}/?float=1`)
}
const hideFloat = () => { if (float && !float.isDestroyed() && float.isVisible()) float.hide() }
async function watchCalls() {
  for (;;) {
    try {
      const c = await fetch(`${URL_BASE}/api/calls`, { signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : null))
      if (c) {
        const mode = c.float === 'menubar' && !IS_MAC ? 'meetings' : c.float || 'meetings'
        floatKey = c.recording ? `rec:${c.recording.id}:${c.recording.callEnded || ''}` : c.prompt ? `call:${c.prompt.app}:${c.prompt.at}` : 'idle'
        const want = mode === 'always' || (mode === 'meetings' && floatKey !== 'idle')
        const card = want && floatHiddenFor !== floatKey
        if (card) showFloat()
        else hideFloat()
        // The menu bar: instead of the card (Settings), or for a meeting whose card you moved there.
        const bar = mode === 'menubar' ? !!(c.recording || c.prompt) : IS_MAC && want && !card && !!c.recording
        setTray(bar ? c : null, mode === 'menubar')
      }
    } catch { /* server down or restarting */ }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

// ---------- In the menu bar (Mac) ----------
// The meeting's time at the top of the screen, out of the way of a screen you share, with Pause,
// Stop and the way back to it in its menu; or Take notes when a call starts. Instead of the card
// (Settings › Meetings), or for one meeting when you move its card up here.
let tray = null
let trayMenu = null // what the menu was built for
let trayAt = null // { c, at, base }: the last /api/calls, when it came, and the time shown then
let trayTick = null
const clock = (s) => { const t = Math.max(0, Math.floor(s)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), ss = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}` }
const trayShown = () => {
  const r = trayAt?.c.recording
  return r ? trayAt.base + (r.status === 'paused' ? 0 : (Date.now() - trayAt.at) / 1000) : 0
}
function trayTitle() {
  if (!tray) return
  const r = trayAt?.c.recording
  tray.setTitle(r ? `${r.status === 'paused' ? '❚❚' : '●'} ${clock(trayShown())}` : 'Take notes?', { fontType: 'monospacedDigit' })
}
// An action on the meeting, done by the main window (it has the mic when it's the one recording).
const meetingOp = (op, id) => tellMain(`window.dispatchEvent(new CustomEvent('bridge-meeting-op', { detail: ${JSON.stringify({ op, id })} }))`, false)
const openFromBar = (detail) => tellMain(`window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: ${JSON.stringify(detail)} }))`, true)
function setTray(c, instead) {
  if (!c) {
    if (tray) { clearInterval(trayTick); tray.destroy(); tray = null; trayMenu = null; trayAt = null }
    return
  }
  if (!tray) {
    tray = new Tray(nativeImage.createEmpty())
    tray.setToolTip(APP_NAME)
    trayTick = setInterval(trayTitle, 1000)
  }
  const r = c.recording
  // The server's time trails the mic by a moment: it doesn't go back a few seconds when it comes.
  const was = trayAt?.c.recording?.id === r?.id ? trayShown() : 0
  const s = r?.seconds || 0
  // Paused, it holds where it was.
  const paused = r?.status === 'paused'
  trayAt = { c, at: Date.now(), base: was && (paused || (s < was && was - s < 8)) ? was : s }
  trayTitle()
  const key = JSON.stringify([r?.id, r?.title, paused, r?.callEnded, c.prompt?.app, c.prompt?.at, instead])
  if (key === trayMenu) return
  trayMenu = key
  const title = (t) => (t.length > 48 ? `${t.slice(0, 47)}…` : t)
  const items = r
    ? [
      { label: `${paused ? 'Paused' : 'Recording'}: ${title(r.title || 'Meeting')}`, enabled: false },
      ...(r.callEnded ? [{ label: `The ${r.callEndedApp || 'call'} call ended`, enabled: false }, { label: 'Keep recording', click: () => meetingOp('keep', r.id) }] : []),
      paused ? { label: 'Resume', click: () => meetingOp('resume', r.id) } : { label: 'Pause', click: () => meetingOp('pause', r.id) },
      { label: 'Stop', click: () => meetingOp('stop', r.id) },
      { type: 'separator' },
      { label: 'Open the meeting', click: () => openFromBar({ id: r.id }) },
      { label: 'All meetings', click: () => openFromBar({ list: true }) },
      ...(instead ? [] : [{ type: 'separator' }, { label: 'Show the card', click: () => { floatHiddenFor = null; setTray(null); showFloat() } }]),
    ]
    : [
      { label: `${c.prompt.browser ? `A call in ${c.prompt.app}` : `${c.prompt.app} call`} started`, enabled: false },
      { label: 'Take notes', click: () => tellMain(`window.dispatchEvent(new CustomEvent('bridge-meeting-start', { detail: { app: ${JSON.stringify(c.prompt.app)} } }))`, false) },
      { label: 'Not now', click: () => meetingOp('dismiss', null) },
    ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
}
const fromFloat = (e) => !!float && !float.isDestroyed() && e.sender === float.webContents
ipcMain.on('bridge:float-size', (e, w, h) => {
  if (!fromFloat(e) || !Number.isFinite(w) || !Number.isFinite(h)) return
  const [cw, ch] = float.getContentSize()
  const nw = Math.max(60, Math.min(420, Math.round(w))), nh = Math.max(40, Math.min(420, Math.round(h)))
  if (cw === nw && ch === nh) return
  // On the right of the screen it grows and shrinks to the left, so it stays in its corner; near
  // the bottom it grows upward, so it stays on the screen.
  const b = float.getBounds()
  const a = screen.getDisplayMatching(b).workArea
  float.setContentSize(nw, nh)
  const n = float.getBounds()
  const x = b.x + b.width / 2 > a.x + a.width / 2 ? b.x + b.width - n.width : n.x
  const y = b.y + b.height / 2 > a.y + a.height / 2 ? b.y + b.height - n.height : Math.min(n.y, a.y + a.height - n.height)
  if (x !== n.x || y !== n.y) float.setPosition(Math.round(x), Math.round(Math.max(a.y, y)))
})
ipcMain.handle('bridge:float-hide', (e) => { if (!fromFloat(e)) return false; floatHiddenFor = floatKey; hideFloat(); return true })
// Dragged from anywhere on it: kept whole on the screen it's over. (null, null): let go, so it's
// remembered there.
ipcMain.on('bridge:float-move', (e, x, y) => {
  if (!fromFloat(e)) return
  const b = float.getBounds()
  if (x == null || y == null) {
    // Let go near an edge of the screen (within 24 points of the card): against it, as a widget.
    // The card sits 12 points inside its window, so the window goes 12 past the edge's line.
    const a = screen.getDisplayMatching(b).workArea
    const near = (v, edge) => Math.abs(v - edge) <= 24
    let { x: nx, y: ny } = b
    if (near(b.x + 12, a.x)) nx = a.x - 12 + 8
    else if (near(b.x + b.width - 12, a.x + a.width)) nx = a.x + a.width - b.width + 12 - 8
    if (near(b.y + 12, a.y)) ny = a.y - 12 + 8
    else if (near(b.y + b.height - 12, a.y + a.height)) ny = a.y + a.height - b.height + 12 - 8
    nx = Math.max(a.x - 12, Math.min(nx, a.x + a.width - b.width + 12))
    ny = Math.max(a.y, Math.min(ny, a.y + a.height - b.height + 12))
    if (nx !== b.x || ny !== b.y) float.setPosition(Math.round(nx), Math.round(ny))
    try { const n = float.getBounds(); fs.writeFileSync(FLOAT_STATE, JSON.stringify({ x: n.x, y: n.y })) } catch { /* read-only */ }
    return
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  const a = screen.getDisplayNearestPoint({ x: Math.round(x + b.width / 2), y: Math.round(y + b.height / 2) }).workArea
  float.setPosition(Math.round(Math.max(a.x, Math.min(x, a.x + a.width - b.width))), Math.round(Math.max(a.y, Math.min(y, a.y + a.height - b.height))))
})
// The main window, made if it was closed and loaded, for something the card asks of it.
async function mainReady() {
  if (!win || win.isDestroyed()) {
    await createWindow()
    await new Promise((r) => setTimeout(r, 1500)) // the page sets itself up
  }
  return win
}
// gesture: as if you'd clicked in the main window (watching a screen asks for one).
const tellMain = async (js, show, gesture = false) => {
  const w = await mainReady()
  if (show) { if (w.isMinimized()) w.restore(); w.show(); w.focus() }
  return w.webContents.executeJavaScript(js, gesture).catch(() => {})
}
// Watch a screen, from the card: the main window records, so it asks which screen.
ipcMain.handle('bridge:float-watch', async (e) => {
  if (!fromFloat(e)) return false
  await tellMain(`window.dispatchEvent(new CustomEvent('bridge-watch-screen'))`, false, true)
  return true
})
// Take notes for the call: the recording runs in the main window (it has the mic), shown or not.
ipcMain.handle('bridge:float-start', async (e, { app: callApp } = {}) => {
  if (!fromFloat(e) || typeof callApp !== 'string' || callApp.length > 60) return false
  await tellMain(`window.dispatchEvent(new CustomEvent('bridge-meeting-start', { detail: { app: ${JSON.stringify(callApp)} } }))`, false)
  return true
})
ipcMain.handle('bridge:float-open', async (e, { meeting, meetings, paneId } = {}) => {
  if (!fromFloat(e)) return false
  if (meetings === true) await tellMain(`window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } }))`, true)
  else if (typeof meeting === 'string' && /^[\w-]{1,80}$/.test(meeting)) await tellMain(`window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id: ${JSON.stringify(meeting)} } }))`, true)
  else if (typeof paneId === 'string' && paneId.length < 200) await tellMain(`window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: ${JSON.stringify(paneId)}, view: 'chat' } }))`, true)
  return true
})
ipcMain.handle('bridge:recording', (e, on) => { if (fromApp(e) && e.sender === win?.webContents) recording = !!on; return true })

app.on('before-quit', () => { quitting = true })
// The graphics process went away (Chromium starts it again): written down, to offer a report.
app.on('child-process-gone', (_e, d) => { if (!quitting) crashes.note(crashes.fromChildGone(d), { base: URL_BASE, data: DATA, version: app.getVersion() }).catch(() => {}) })
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() } })
app.on('activate', () => { if (!win) createWindow(); else win.show() })
app.on('window-all-closed', () => { win = null })
app.on('will-quit', () => globalShortcut.unregisterAll())

// The computer is shutting down or restarting: the server keeps the open agents, and which were in
// the middle of something, to reopen afterwards, before their terminals end (Windows warns Bridge
// AI's background processes of nothing; on a Mac this is earlier than they hear).
function shuttingDown() {
  fetch(`${URL_BASE}/api/system/stopping`, { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => {})
}

app.whenReady().then(() => {
  powerMonitor.on('shutdown', shuttingDown) // macOS, Linux
  // Voice notes need the mic; allow it for the app's own page only, asked by the page itself and not
  // by a frame in it (a project's app in Preview, another device's agent). Copying works in those too.
  const ASK = new Set(['media', 'display-capture', 'notifications', 'geolocation'])
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d = {}) => {
    const u = d.requestingUrl || wc.getURL()
    cb(perm === 'clipboard-sanitized-write' ? isLocal(u) : ASK.has(perm) && d.isMainFrame !== false && ownPage(u))
  })
  // Watching a screen in a meeting: macOS's own picker (macOS 15 and later), where you pick the
  // window being shared. Before macOS 15: the whole main screen, which macOS asks to allow (Screen
  // Recording) the first time.
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    if (!ownPage(req.frame?.url || '')) return cb({})
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb(s[0] ? { video: s[0] } : {}), () => cb({}))
  }, { useSystemPicker: true })
  // Right-click: spelling suggestions, Cut, Copy and Paste, in every window from here on.
  contextMenu.attach({ app, Menu, clipboard: electron.clipboard, session })
  buildMenu()
  globalShortcut.register(SHORTCUT, toggleWindow)
  createWindow()
  watchFleet()
  watchCalls()
  // The dictation key from any app (dictation.js): the main window, an agent's own window and
  // another device's window take it as their own when they're in front.
  const ours = (w) => w === win || [...pops.values(), ...machineWins.values()].includes(w)
  // Each time the key is set: whether pasting can work and whether a lone key is picked, which is
  // what Accessibility and Input Monitoring are asked for.
  const onStatus = (v) => { canPaste = !!v?.paste?.can; loneKey = !!v?.lone && /^(Fn|RightAlt)$/.test(v.key || ''); reportPerms() }
  dictation.start({ electron, ROOT, DATA, URL_BASE, preload: path.join(__dirname, 'preload.js'), isOurs: ours, tellMain, askAccess: showTile, trusted: fromApp, perms, onStatus })
    .catch((e) => console.error('dictation:', e.message))
  // What the app is allowed: told once a minute (the server forgets it after three), and whenever you
  // come back to one of its windows (System Settings is where it changes).
  setInterval(reportPerms, 60000)
  app.on('browser-window-focus', () => reportPerms())
})
