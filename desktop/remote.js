// Remote Screen and Preview (a Beta Feature; server/remote.js): the desktop app's part, on the
// computer being seen. The server says what it needs on the app's own live feed (main.js watchFleet,
// event: remote):
//   need-capture / capture-idle  the capture page (src/components/remote/Capture.jsx, ?remote=capture)
//                                in a window that never shows: it takes the screen (desktopCapturer's
//                                sources, asked of macOS the first time someone looks, never before) and
//                                sends it peer-to-peer, or as pictures over the link
//   sessions                     the badge: a small window over everything, while anyone sees this
//                                screen, saying who, with Stop (?remote=badge)
//   page-start/-input/-stop      a project's app for a phone, drawn in a window off screen, its pictures
//                                sent to the server; taps and typing go to that page only (no
//                                permission: it's this app's own window, not the computer)
//   control                      "Let my other devices control this computer" is on or off here: the
//                                Accessibility question is then about it too (permissions.js)
// And on the computer looking: another computer's screen in a window of its own (view, ?remote=view),
// opened inside the work area of the display it opens on, in that screen's shape (fit, once the page
// knows it), at the size you left it for that computer when you've sized it yourself.
// Everything it uses comes in (create's options), so the tests can stand in for Electron.
const MAX_FRAME = 180 * 1024
// The page's own window titles, left out of the windows it can show.
const OWN_TITLES = /^Bridge AI (screen sharing|is being viewed)$/

// A window for a picture w x h, with chrome (the toolbar, a frame) around it, as big as fits in
// most of area (a display's work area, { x, y, width, height }), its shape kept, centred there.
function fitWindow(area, w, h, chrome = { w: 0, h: 0 }, { margin = 0.9, min = { width: 520, height: 360 } } = {}) {
  const room = { w: Math.floor(area.width * margin) - chrome.w, h: Math.floor(area.height * margin) - chrome.h }
  const s = w > 0 && h > 0 ? Math.min(room.w / w, room.h / h) : 0
  const width = Math.min(area.width, Math.max(min.width, Math.round(w * s + chrome.w)))
  const height = Math.min(area.height, Math.max(min.height, Math.round(h * s + chrome.h)))
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height }
}
const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

// Which display each of desktopCapturer's screens is, and its name. The display: by display_id (a
// Mac, Windows, X11), else in the same order as the displays when there are as many, else by the
// number in its id (a Mac's CGDirectDisplayID), else the main one when it's the only screen (Wayland's
// one portal stream). Its name: the system's (Electron's label: "Built-in Retina Display", "LG
// UltraFine" on a Mac, the monitor's own on Windows, often none on Linux), else "Built-in Display"
// for a laptop's own, else desktopCapturer's when it isn't "Screen 1" or "Entire Screen", else
// "Display 2" by its place. Two of the same model are numbered, as macOS does: "LG UltraFine (1)".
const GENERIC = /^(entire screen|screen(\s*\d+)?)$/i
function displayFor(screens, displays, primary) {
  const out = new Map()
  const used = new Set()
  const free = (d) => (d && !used.has(d) ? d : null)
  const byId = (v) => free(displays.find((x) => v != null && v !== '' && String(x.id) === String(v)))
  screens.forEach((s, i) => {
    const d = byId(s.display_id) || (screens.length === displays.length ? free(displays[i]) : null) || byId(String(s.id).split(':')[1]) || (screens.length === 1 ? free(primary) : null)
    if (d) used.add(d)
    const label = String(d?.label || '').trim()
    const own = String(s.name || '').trim()
    out.set(s, { d, name: (label || (d?.internal ? 'Built-in Display' : own && !GENERIC.test(own) ? own : `Display ${i + 1}`)).slice(0, 80) })
  })
  const count = {}
  for (const x of out.values()) count[x.name] = (count[x.name] || 0) + 1
  const nth = {}
  for (const x of out.values()) if (count[x.name] > 1) { nth[x.name] = (nth[x.name] || 0) + 1; x.name = `${x.name} (${nth[x.name]})` }
  return out
}

function create({ BrowserWindow, desktopCapturer, screen, systemPreferences, session, nativeTheme, URL_BASE, preload, fetch, platform = process.platform, keyFor, sizes = null }) {
  const MAC = platform === 'darwin'
  let capture = null
  let badge = null
  let control = false
  const pages = new Map() // session -> { win, w, h, timer, latest, sent }
  const views = new Map() // another computer's screen: machine ('' for this one's own) -> BrowserWindow

  // ---------- what can be seen ----------
  // macOS's word on Screen Recording, without asking: 'ok', 'ask' or 'denied'. (macOS says denied
  // until it's been asked, so only an answer after a look counts as no.)
  const permission = () => {
    if (!MAC) return 'ok'
    const s = systemPreferences.getMediaAccessStatus('screen')
    return s === 'granted' ? 'ok' : s === 'restricted' ? 'restricted' : s === 'not-determined' ? 'ask' : 'denied'
  }
  // Where a display is in the pixels the system presses at: on a Mac, points (as its bounds are);
  // Windows and Linux (X11) move the pointer in pixels, so a display scaled up is told in those.
  const pixelsOf = (d) => {
    if (MAC || !d || d.scaleFactor === 1) return null
    if (screen.dipToScreenRect) { try { return screen.dipToScreenRect(null, d.bounds) } catch { /* not here */ } }
    const k = d.scaleFactor
    return { x: Math.round(d.bounds.x * k), y: Math.round(d.bounds.y * k), width: Math.round(d.bounds.width * k), height: Math.round(d.bounds.height * k) }
  }
  // The screens and windows, for the capture page. The first time, macOS asks about Screen Recording
  // here (someone looked: first use). Each screen by its display's own name and size (displayFor).
  async function sources() {
    let list = []
    try { list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }) } catch { list = [] }
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const shown = displayFor(list.filter((s) => s.id.startsWith('screen:')), displays, primary)
    const out = []
    for (const s of list) {
      const kind = s.id.startsWith('screen:') ? 'screen' : 'window'
      if (kind === 'window' && OWN_TITLES.test(s.name || '')) continue
      const { d = null, name = '' } = kind === 'screen' ? shown.get(s) || {} : {}
      out.push({
        id: s.id, name: kind === 'screen' ? name || 'Screen' : (s.name || 'Window').slice(0, 80), kind,
        w: d ? Math.round(d.size.width * d.scaleFactor) : 0, h: d ? Math.round(d.size.height * d.scaleFactor) : 0,
        primary: !!d && d.id === primary.id, scale: d ? d.scaleFactor : null,
        bounds: d ? { ...d.bounds, ...(pixelsOf(d) ? { px: pixelsOf(d) } : {}) } : null,
      })
    }
    return { sources: out.slice(0, 40), permission: permission() }
  }
  // A small still of each screen, for the viewer's Which screen? (asked only during a session, once
  // the guardrails let it in: server/remote.js): JPEG, inside 320 x 320, its shape kept.
  async function thumbs() {
    let list = []
    try { list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 320 }, fetchWindowIcons: false }) } catch { return [] }
    return list.map((s) => {
      const img = s.thumbnail
      if (!img || img.isEmpty?.()) return null
      return { id: s.id, data: `data:image/jpeg;base64,${img.toJPEG(70).toString('base64')}` }
    }).filter(Boolean).slice(0, 12)
  }

  // ---------- the capture page ----------
  function needCapture() {
    if (capture && !capture.isDestroyed()) return
    capture = new BrowserWindow({ show: false, width: 480, height: 320, title: 'Bridge AI screen sharing', skipTaskbar: true, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    capture.on('page-title-updated', (e) => e.preventDefault())
    capture.on('closed', () => { capture = null })
    capture.webContents.on('render-process-gone', () => { try { capture?.destroy() } catch { /* gone */ } })
    capture.loadURL(`${URL_BASE}/?remote=capture`).catch(() => {})
  }
  function captureIdle() { if (capture && !capture.isDestroyed()) capture.destroy(); capture = null }

  // ---------- the badge ----------
  // While anyone sees this screen, or asks to (Ask Here First, answered on it).
  function sessions(list, asks) {
    const any = (Array.isArray(list) && list.length > 0) || (Array.isArray(asks) && asks.length > 0)
    if (!any) { if (badge && !badge.isDestroyed()) badge.destroy(); badge = null; return }
    if (badge && !badge.isDestroyed()) { if (asks?.length) badge.showInactive?.(); return }
    const wa = screen.getPrimaryDisplay().workArea
    const W = 520
    badge = new BrowserWindow({
      width: W, height: 58, x: Math.round(wa.x + (wa.width - W) / 2), y: wa.y + 10,
      frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      alwaysOnTop: true, show: false, hasShadow: true, title: 'Bridge AI is being viewed',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1e25' : '#ffffff',
      webPreferences: { preload, contextIsolation: true, sandbox: true },
    })
    badge.setAlwaysOnTop(true, 'screen-saver')
    try { badge.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch { /* not here */ }
    badge.on('page-title-updated', (e) => e.preventDefault())
    badge.on('closed', () => { badge = null })
    badge.once('ready-to-show', () => badge?.showInactive())
    badge.loadURL(`${URL_BASE}/?remote=badge`).catch(() => {})
  }

  // ---------- a project's app, drawn off screen ----------
  function pageStart({ session: sid, port, w, h, rate }) {
    if (pages.has(sid) || !(port > 1023 && port < 65536)) return
    const origin = `http://localhost:${port}`
    const ses = session.fromPartition('persist:bridge-preview')
    // It asks for nothing (no mic, no camera, no notifications): it's shown on a phone.
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
    const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const p = { win, port, w, h, latest: null, sent: 0, timer: null, busy: false, rate: Math.max(1, Math.min(10, Number(rate) || 2)) }
    pages.set(sid, p)
    const wc = win.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    // It stays on its own app: a link elsewhere isn't followed, nor a redirect; and nothing in it (a
    // frame) goes to anything else on this computer (Bridge AI's own page, another local server).
    const own = (url) => { try { const o = new URL(url).origin; return o === origin || o === `http://127.0.0.1:${port}` } catch { return false } }
    const local = (url) => { try { return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|\[::\])$/i.test(new URL(url).hostname) } catch { return true } }
    const away = (url, main) => (main ? !own(url) : local(url) && !own(url))
    wc.on('will-navigate', (e, url) => { if (!own(e.url || url)) e.preventDefault() })
    wc.on('will-redirect', (e, url, _inPlace, main) => { if (away(e.url || url, e.isMainFrame ?? main)) e.preventDefault() })
    wc.on('will-frame-navigate', (e) => { if (away(e.url, e.isMainFrame)) e.preventDefault() })
    wc.setFrameRate(Math.min(30, p.rate * 4))
    const flush = () => {
      p.timer = null
      if (!p.latest || p.busy || !pages.has(sid)) return
      const wait = 1000 / p.rate - (Date.now() - p.sent)
      if (wait > 0) { p.timer = setTimeout(flush, wait); return }
      const image = p.latest
      p.latest = null
      let q = 84
      let jpg = image.toJPEG(q)
      while (jpg.length > MAX_FRAME && q > 30) { q -= 12; jpg = image.toJPEG(q) }
      const { width, height } = image.getSize()
      p.busy = true
      p.sent = Date.now()
      fetch(`${URL_BASE}/api/remote/sessions/${encodeURIComponent(sid)}/frame`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-frame-w': String(width), 'x-frame-h': String(height) }, body: jpg })
        .then((r) => { if (r.status === 404) pageStop({ session: sid }) }, () => {})
        .finally(() => { p.busy = false; if (p.latest && !p.timer) p.timer = setTimeout(flush, 1000 / p.rate) })
    }
    wc.on('paint', (_e, _dirty, image) => { p.latest = image; if (!p.timer) p.timer = setTimeout(flush, 0) })
    win.loadURL(`${origin}/`).catch(() => {})
  }
  // Another address of the same app (the Preview tab's address bar).
  function pageGo({ session: sid, path }) {
    const p = pages.get(sid)
    if (!p || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return
    p.win.loadURL(`http://localhost:${p.port}${path}`).catch(() => {})
  }
  function pageResize({ session: sid, w, h }) { const p = pages.get(sid); if (!p) return; p.w = w; p.h = h; p.win.setContentSize(w, h) }
  function pageStop({ session: sid }) { const p = pages.get(sid); if (!p) return; pages.delete(sid); clearTimeout(p.timer); try { p.win.destroy() } catch { /* gone */ } }
  const BUTTON = ['left', 'middle', 'right']
  function pageInput({ session: sid, evs }) {
    const p = pages.get(sid)
    if (!p || !Array.isArray(evs)) return
    const wc = p.win.webContents
    for (const ev of evs) {
      const x = Math.round((ev.x ?? 0.5) * p.w)
      const y = Math.round((ev.y ?? 0.5) * p.h)
      if (ev.t === 'move') wc.sendInputEvent({ type: 'mouseMove', x, y })
      else if (ev.t === 'down' || ev.t === 'up') wc.sendInputEvent({ type: ev.t === 'down' ? 'mouseDown' : 'mouseUp', x, y, button: BUTTON[ev.b] || 'left', clickCount: 1 })
      else if (ev.t === 'wheel') wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: -ev.dx, deltaY: -ev.dy, canScroll: true })
      else if (ev.t === 'key') { const k = keyFor(ev.code, 'electron'); if (k) wc.sendInputEvent({ type: ev.down ? 'keyDown' : 'keyUp', keyCode: k }) }
      else if (ev.t === 'text') for (const ch of String(ev.s)) wc.sendInputEvent({ type: 'char', keyCode: ch })
    }
  }

  // ---------- another computer's screen, in a window of its own ----------
  // sizes: where each was left ({ get(key), set(key, bounds) }, kept in the app's own folder).
  function view({ machine = null, name = '', near = null } = {}) {
    const key = machine || ''
    const have = views.get(key)
    if (have && !have.isDestroyed()) { have.show(); have.focus(); return have }
    const display = near ? screen.getDisplayMatching(near) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const was = sizes?.get(key)
    // Left somewhere that's still on a display: there again, as you sized it.
    const kept = was && Number.isFinite(was.width) && screen.getAllDisplays().some((d) => meets(d.workArea, was)) ? was : null
    const at = kept || fitWindow(display.workArea, 16, 10, { w: 0, h: 52 })
    const w = new BrowserWindow({
      x: at.x, y: at.y, width: at.width, height: at.height, minWidth: 480, minHeight: 320,
      title: `${String(name || 'Screen').slice(0, 60)}'s Screen · Bridge AI`,
      ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 17 } } : { autoHideMenuBar: true }),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f3',
      show: false,
      webPreferences: { preload, contextIsolation: true, sandbox: true },
    })
    w.userSized = !!kept
    // A resize of your own (not the fit below): kept, and the window isn't fitted again.
    w.on('will-resize', () => { w.userSized = true })
    const keep = () => { if (!w.isDestroyed() && !w.isMinimized() && !w.isFullScreen?.()) sizes?.set(key, w.getNormalBounds ? w.getNormalBounds() : w.getBounds()) }
    w.on('resized', () => { if (w.userSized) keep() })
    w.on('moved', () => { if (w.userSized) keep() })
    w.on('close', keep)
    w.once('ready-to-show', () => w.show())
    w.on('closed', () => { if (views.get(key) === w) views.delete(key) })
    w.loadURL(`${URL_BASE}/?remote=view&${new URLSearchParams({ ...(machine ? { machine } : {}), name: String(name || '').slice(0, 80) })}`).catch(() => {})
    views.set(key, w)
    return w
  }
  // The page knows that screen's shape (w x h, its toolbar chrome px tall): the window takes it, on
  // the display it's on, unless you've sized it yourself.
  function fit(win, { w, h, chrome = 52 } = {}) {
    if (!win || win.isDestroyed() || win.userSized || win.isFullScreen?.() || win.isMaximized?.() || !(w > 0) || !(h > 0)) return false
    const outer = win.getBounds()
    const inner = win.getContentBounds ? win.getContentBounds() : outer
    const frame = { w: outer.width - inner.width, h: outer.height - inner.height }
    const area = screen.getDisplayMatching(outer).workArea
    win.setBounds(fitWindow(area, w, h, { w: frame.w, h: frame.h + Math.max(0, Math.min(200, Number(chrome) || 0)) }))
    return true
  }

  function onEvent(ev) {
    if (!ev || typeof ev.t !== 'string') return
    if (ev.t === 'need-capture') needCapture()
    else if (ev.t === 'capture-idle') captureIdle()
    else if (ev.t === 'sessions') sessions(ev.list, ev.asks)
    else if (ev.t === 'control') control = !!ev.on
    else if (ev.t === 'page-start') pageStart(ev)
    else if (ev.t === 'page-input') pageInput(ev)
    else if (ev.t === 'page-resize') pageResize(ev)
    else if (ev.t === 'page-go') pageGo(ev)
    else if (ev.t === 'page-stop') pageStop(ev)
  }
  return { onEvent, sources, thumbs, permission, view, fit, isView: (w) => [...views.values()].includes(w), controlOn: () => control, setControl: (on) => { control = !!on }, windows: () => [capture, badge, ...views.values()].filter(Boolean) }
}

module.exports = { create, fitWindow, displayFor }
