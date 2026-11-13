// The desktop app's windows, for api-key.mjs: each kind desktop/main.js and desktop/dictation.js open
// (the main window, an agent's own window, the floating card, the dictation pill, and a window
// showing another of your computers at its own port), with the app's preload, let in as main.js lets
// them in (desktop/apitoken.js) before any opens. Kept out of the way of whoever is at the computer:
// none is shown. KIT_URL, KIT_DATA: the kit; PAGES: a JSON list of [name, path or address].
const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')
const desktop = path.join(__dirname, '..', '..', 'desktop')
const apiToken = require(path.join(desktop, 'apitoken.js'))
const URL_BASE = process.env.KIT_URL
const preload = path.join(desktop, 'preload.js')
app.setPath('userData', path.join(process.env.KIT_DATA, 'desktop-windows'))
app.whenReady().then(async () => {
  await apiToken.letIn(session.defaultSession, { port: new URL(URL_BASE).port, token: apiToken.read(process.env.KIT_DATA) })
  globalThis.wins = {}
  for (const [name, at] of JSON.parse(process.env.PAGES || '[]')) {
    const w = new BrowserWindow({ width: 1000, height: 700, show: false, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    globalThis.wins[name] = w
    w.loadURL(at.startsWith('http') ? at : `${URL_BASE}${at}`).catch(() => {})
  }
})
