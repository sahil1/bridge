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
// Everything it uses comes in (create's options), so the tests can stand in for Electron.
const MAX_FRAME = 180 * 1024
// The page's own window titles, left out of the windows it can show.
const OWN_TITLES = /^Bridge AI (screen sharing|is being viewed)$/

function create({ BrowserWindow, desktopCapturer, screen, systemPreferences, session, nativeTheme, URL_BASE, preload, fetch, platform = process.platform, keyFor }) {
  const MAC = platform === 'darwin'
  let capture = null
  let badge = null
  let control = false
  const pages = new Map() // session -> { win, w, h, timer, latest, sent }

  // ---------- what can be seen ----------
  // macOS's word on Screen Recording, without asking: 'ok', 'ask' or 'denied'. (macOS says denied
  // until it's been asked, so only an answer after a look counts as no.)
  const permission = () => {
    if (!MAC) return 'ok'
    const s = systemPreferences.getMediaAccessStatus('screen')
    return s === 'granted' ? 'ok' : s === 'restricted' ? 'restricted' : s === 'not-determined' ? 'ask' : 'denied'
  }
  // The screens and windows, for the capture page. The first time, macOS asks about Screen Recording
  // here (someone looked: first use).
  async function sources() {
    let list = []
    try { list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }) } catch { list = [] }
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const out = []
    for (const s of list) {
      const kind = s.id.startsWith('screen:') ? 'screen' : 'window'
      if (kind === 'window' && OWN_TITLES.test(s.name || '')) continue
      const d = kind === 'screen' ? displays.find((x) => String(x.id) === String(s.display_id)) || (list.filter((x) => x.id.startsWith('screen:')).length === 1 ? primary : null) : null
      const px = d && platform === 'win32' && screen.dipToScreenRect ? screen.dipToScreenRect(null, d.bounds) : null
      out.push({
        id: s.id, name: kind === 'screen' ? (s.name || 'Screen') : (s.name || 'Window').slice(0, 80), kind,
        w: d ? Math.round(d.size.width * d.scaleFactor) : 0, h: d ? Math.round(d.size.height * d.scaleFactor) : 0,
        primary: !!d && d.id === primary.id,
        bounds: d ? { ...d.bounds, ...(px ? { px } : {}) } : null,
      })
    }
    return { sources: out.slice(0, 40), permission: permission() }
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
  function sessions(list) {
    const any = Array.isArray(list) && list.length > 0
    if (!any) { if (badge && !badge.isDestroyed()) badge.destroy(); badge = null; return }
    if (badge && !badge.isDestroyed()) return
    const wa = screen.getPrimaryDisplay().workArea
    const W = 460
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
    // It stays on its own app: a link elsewhere isn't followed.
    wc.on('will-navigate', (e, url) => { try { if (new URL(url).origin !== origin && new URL(url).origin !== `http://127.0.0.1:${port}`) e.preventDefault() } catch { e.preventDefault() } })
    wc.setFrameRate(Math.min(30, p.rate * 4))
    const flush = () => {
      p.timer = null
      if (!p.latest || p.busy || !pages.has(sid)) return
      const wait = 1000 / p.rate - (Date.now() - p.sent)
      if (wait > 0) { p.timer = setTimeout(flush, wait); return }
      const image = p.latest
      p.latest = null
      let q = 72
      let jpg = image.toJPEG(q)
      while (jpg.length > MAX_FRAME && q > 25) { q -= 16; jpg = image.toJPEG(q) }
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

  function onEvent(ev) {
    if (!ev || typeof ev.t !== 'string') return
    if (ev.t === 'need-capture') needCapture()
    else if (ev.t === 'capture-idle') captureIdle()
    else if (ev.t === 'sessions') sessions(ev.list)
    else if (ev.t === 'control') control = !!ev.on
    else if (ev.t === 'page-start') pageStart(ev)
    else if (ev.t === 'page-input') pageInput(ev)
    else if (ev.t === 'page-resize') pageResize(ev)
    else if (ev.t === 'page-go') pageGo(ev)
    else if (ev.t === 'page-stop') pageStop(ev)
  }
  return { onEvent, sources, permission, controlOn: () => control, setControl: (on) => { control = !!on }, windows: () => [capture, badge].filter(Boolean) }
}

module.exports = { create }
