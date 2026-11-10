// Where the floating card's window goes when the card changes size (desktop/main.js): b is the
// window's bounds before, n after the new size, a the screen's work area. It grows and shrinks from
// its bar's side, which the card says (low: its bar at the bottom, for a card low on the screen) and
// keeps while it's open. By the window's middle, a card opened taller than half the screen had its
// middle past the screen's, so closing it took it from the top of the screen to the bottom.
// low isn't a boolean from a page older than this: the window's middle, as before.
function floatPlace(b, n, a, low) {
  const right = b.x + b.width / 2 > a.x + a.width / 2
  const bottom = typeof low === 'boolean' ? low : b.y + b.height / 2 > a.y + a.height / 2
  // On the right of the screen it grows and shrinks to the left, so it stays in its corner.
  const x = right ? b.x + b.width - n.width : n.x
  const y = bottom ? b.y + b.height - n.height : Math.min(n.y, a.y + a.height - n.height)
  return { x: Math.round(x), y: Math.round(Math.max(a.y, y)) }
}

// How big the window is for a card of w by h, as the page measures it, at zoom (the page's zoom
// factor), on a screen whose work area is a. The page zooms with the main window (⌘+ zooms every
// window of the app's own, as one site's tabs zoom together), so its pixels are zoom times the
// screen's: a window of the page's numbers cut the card off on the right and at the bottom, from
// 110% (⌘+ once). No bigger than the screen, less 8 points each side.
function floatSize(w, h, zoom, a) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return {
    width: Math.max(60, Math.min(a.width - 16, Math.ceil(w * z))),
    height: Math.max(40, Math.min(a.height - 16, Math.ceil(h * z))),
  }
}
// A window's zoom factor, 1 if it can't say.
function zoomOf(win) {
  try { const z = win.webContents.getZoomFactor(); return Number.isFinite(z) && z > 0 ? z : 1 } catch { return 1 }
}

// The card's window: no frame, see-through around the card, over the other windows, and a click
// on it works the first time.
const floatWindow = ({ x, y, width, height, title, preload }) => ({
  width, height, x, y, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
  skipTaskbar: true, hasShadow: false, alwaysOnTop: true, acceptFirstMouse: true, show: false, title,
  webPreferences: { preload, contextIsolation: true, sandbox: true },
})

// The card measured itself (w by h, the 12 points around it included): the window fits it, from
// its bar's side, staying on the screen. screen: Electron's.
function fitFloat(win, screen, w, h, low) {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return
  const b = win.getBounds()
  const a = screen.getDisplayMatching(b).workArea
  const { width, height } = floatSize(w, h, zoomOf(win), a)
  const [cw, ch] = win.getContentSize()
  if (cw === width && ch === height) return
  win.setContentSize(width, height)
  const n = win.getBounds()
  const { x, y } = floatPlace(b, n, a, low)
  if (x !== n.x || y !== n.y) win.setPosition(x, y)
}

module.exports = { floatPlace, floatSize, zoomOf, floatWindow, fitFloat }
