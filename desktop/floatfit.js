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

// Resized by its edges and corners, as any window is. The card's limits, in the page's pixels: no
// narrower than its bar needs, no wider than a column of text reads well, no shorter than its bar.
const LIMITS = { minW: 260, maxW: 720, minH: 120 }
// The window's bounds b resized from edge (n, s, e, w or a corner, as ne) by the pointer moving
// from p to q: that edge follows the pointer and the other stays, within the card's limits at zoom
// z and on the screen a (no bigger than it less 8 points each side, as the card fits itself; the 12
// pixels around the card may go past its edge, as when it's put against one). height: the window's
// height now, for an edge that only resizes it sideways.
function resizedBounds(b, p, q, edge, z, a, height = b.height) {
  const m = 12 * z
  const clamp = (v, lo, hi) => Math.round(Math.max(lo, Math.min(Math.max(lo, hi), v)))
  const minW = Math.ceil((LIMITS.minW + 24) * z), maxW = Math.min(a.width - 16, Math.floor((LIMITS.maxW + 24) * z))
  const minH = Math.ceil((LIMITS.minH + 24) * z), maxH = a.height - 16
  const dx = q.x - p.x, dy = q.y - p.y
  const n = { x: b.x, y: b.y, width: b.width, height: /[ns]/.test(edge) ? b.height : height }
  if (edge.includes('e')) n.width = clamp(b.width + dx, minW, Math.min(maxW, a.x + a.width + m - b.x))
  if (edge.includes('w')) { n.width = clamp(b.width - dx, minW, Math.min(maxW, b.x + b.width - (a.x - m))); n.x = b.x + b.width - n.width }
  if (edge.includes('s')) n.height = clamp(b.height + dy, minH, Math.min(maxH, a.y + a.height + m - b.y))
  if (edge.includes('n')) { n.height = clamp(b.height - dy, minH, Math.min(maxH, b.y + b.height - a.y)); n.y = b.y + b.height - n.height }
  return n
}
// The page says which edge the pointer took (null: let go); the window follows the pointer from
// there, sixty times a second, until it's let go (or a minute on, if the page never says). An edge
// that only resizes it sideways leaves its height to the card (its words wrap again). cursor: where
// the pointer is on the screen (Electron's, or a test's).
function floatResizer(win, screen, cursor = () => screen.getCursorScreenPoint()) {
  let on = null
  const stop = () => { if (on) { clearInterval(on.timer); clearTimeout(on.end); on = null } }
  const set = (edge) => {
    stop()
    if (!/^(n|s|e|w|ne|nw|se|sw)$/.test(edge || '') || win.isDestroyed()) return
    const b = win.getBounds(), p = cursor()
    const tick = () => {
      if (win.isDestroyed()) return stop()
      const now = win.getBounds()
      const n = resizedBounds(b, p, cursor(), edge, zoomOf(win), screen.getDisplayMatching(b).workArea, now.height)
      if (n.x !== now.x || n.y !== now.y || n.width !== now.width || n.height !== now.height) win.setBounds(n)
    }
    on = { edge, timer: setInterval(tick, 16), end: setTimeout(stop, 60000) }
  }
  return { set, stop, edge: () => on?.edge || null }
}
// What the card asks for while it's being resized: nothing the pointer decides (the window follows
// the pointer, and the card the window). Sideways only, its height still fits what it shows.
function fitWhileResizing(win, screen, resizer, w, h, low) {
  const edge = resizer.edge()
  if (!edge) return fitFloat(win, screen, w, h, low)
  if (/[ns]/.test(edge)) return
  fitFloat(win, screen, win.getContentSize()[0] / zoomOf(win), h, low)
}

module.exports = { floatPlace, floatSize, zoomOf, floatWindow, fitFloat, LIMITS, resizedBounds, floatResizer, fitWhileResizing }
