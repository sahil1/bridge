// The desktop app's floating card, for float-card-window.mjs: a real window, made, fitted and resized
// as desktop/main.js does it (desktop/floatfit.js, desktop/preload.js), beside a main window
// at the same address, whose zoom the card's follows (Chromium zooms one site's pages together, as
// ⌘+ in the main window zooms the card). Kept out of the way of whoever is at the computer: it
// can't be seen, clicks go through it and it never takes the keyboard.
const path = require('node:path')
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const desktop = path.join(__dirname, '..', '..', 'desktop')
const { floatWindow, floatResizer, fitWhileResizing } = require(path.join(desktop, 'floatfit.js'))
const URL_BASE = process.env.KIT_URL
const preload = path.join(desktop, 'preload.js')
let float = null
let resizer = null
// Where the test puts the pointer on the screen while it resizes the card (the real one stays put).
globalThis.cursor = null
app.whenReady().then(() => {
  // Hidden, as when you've closed it: its timers run as they do in the app's.
  globalThis.mainWin = new BrowserWindow({ width: 1000, height: 700, show: false, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  globalThis.mainWin.loadURL(URL_BASE)
  // Where main.js puts it the first time: the top right of the screen.
  globalThis.openFloat = () => {
    const a = screen.getPrimaryDisplay().workArea
    float = new BrowserWindow({ ...floatWindow({ width: 324, height: 150, x: a.x + a.width - 336, y: a.y + 12, title: 'Bridge AI card (test)', preload }), focusable: false })
    float.setOpacity(0)
    float.setIgnoreMouseEvents(true)
    globalThis.floatWin = float
    resizer = floatResizer(float, screen, () => globalThis.cursor || screen.getCursorScreenPoint())
    float.once('ready-to-show', () => float.showInactive())
    float.loadURL(`${URL_BASE}/?float=1`)
  }
  const ours = (e) => float && !float.isDestroyed() && e.sender === float.webContents
  ipcMain.on('bridge:float-size', (e, w, h, low) => { if (ours(e)) fitWhileResizing(float, screen, resizer, w, h, low) })
  ipcMain.on('bridge:float-resize', (e, edge) => { if (ours(e)) resizer.set(edge) })
})
