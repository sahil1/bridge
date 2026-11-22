// Remote Screen and Preview (a Beta Feature; server/remote.js): the desktop app's part, on the
// computer being seen. The server says what it needs on the app's own live feed (main.js watchFleet,
// event: remote):
//   need-capture / capture-idle  the capture page (src/components/remote/Capture.jsx, ?remote=capture,
//                                with the token the server gave for it: its only way in) in a
//                                window that never shows: it takes the screen (desktopCapturer's
//                                sources, asked of macOS the first time someone looks, never before) and
//                                sends it peer-to-peer, or as pictures over the link
//   sessions                     the badge: a small window over everything, while anyone sees this
//                                screen, saying who, with Stop (?remote=badge)
//   page-start/-input/-stop      a project's app for a phone, drawn in a window off screen, its pictures
//                                sent to the server; taps and typing go to that page only (no
//                                permission: it's this app's own window, not the computer)
//   control                      "Let my other devices control this computer" is on or off here: the
//                                Accessibility question is then about it too (permissions.js)
//   reopen / allow-screen        chosen by a device that can't see this screen: the app reopens (as
//                                macOS's Quit & Reopen does), or System Settings opens at Screen &
//                                System Audio Recording, with the tile, for someone here
//   lock?                        whether this screen is locked (macOS and Windows let no app take a
//                                locked screen): said then, and each time it changes, so a device
//                                waits for it to be unlocked
// And on the computer looking: another computer's screen in a window of its own (view, ?remote=view),
// opened inside the work area of the display it opens on, in that screen's shape (fit, once the page
// knows it), at the size you left it for that computer when you've sized it yourself.
// Everything it uses comes in (create's options), so the tests can stand in for Electron.
const MAX_FRAME = 180 * 1024
// macOS listing the screens (or the windows) for the capture page: given this long, so a list that
// never comes can't keep the page from saying it has none (and why).
const LIST_MS = 8000
// The page's own window titles, left out of the windows it can show.
const OWN_TITLES = /^Bridge AI (screen sharing|is being viewed)$/
// A lock or unlock heard from the system: what it says when asked is taken over it only this long
// after (it may not have caught up yet).
const LOCK_HEARD_MS = 5000

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

// restart(): reopen this app (main.js), asked for by a device that found no screens to share.
// allowScreen(): System Settings at Screen & System Audio Recording, with the tile beside it, asked for
// by a device macOS doesn't let see this screen. power: Electron's powerSaveBlocker (none in tests);
// wake(): the display woken if it's asleep (main.js), as someone starts viewing it. taken(): someone
// views this screen, so the capture page takes it (main.js: macOS's picker for Watch a screen isn't
// used after that, until the app restarts). powerMonitor: Electron's, for whether the screen is
// locked (none in tests: then it isn't known, as on Linux).
function create({ BrowserWindow, desktopCapturer, screen, systemPreferences, session, nativeTheme, URL_BASE, preload, fetch, platform = process.platform, keyFor, sizes = null, restart = () => {}, allowScreen = () => {}, power = null, wake = () => {}, taken = () => {}, powerMonitor = null, listMs = LIST_MS }) {
  const MAC = platform === 'darwin'
  let capture = null
  let badge = null
  let control = false
  const pages = new Map() // session -> { win, w, h, timer, latest, sent }
  const views = new Map() // another computer's screen: machine ('' for this one's own) -> BrowserWindow

  // ---------- a locked screen ----------
  // macOS and Windows say when the screen is locked (powerMonitor), and neither lets an app take it
  // then (a capture asked for fails, or stops). The server is told when it asks (lock?) and each time
  // it changes, and the capture page says so with its list of screens: { locked, id, n }, n counting
  // each change in this run of the app (id), so a word that comes in late can't undo a newer one.
  // Linux, or a system that doesn't say ('unknown'): nothing is said, and nothing waits on it.
  const LOCKS = MAC || platform === 'win32'
  const lockNow = () => {
    if (!LOCKS || typeof powerMonitor?.getSystemIdleState !== 'function') return null
    try { const s = powerMonitor.getSystemIdleState(1); return s === 'locked' ? true : s === 'unknown' ? null : false } catch { return null }
  }
  const lock = { locked: lockNow(), id: Math.random().toString(36).slice(2, 10), n: 0 }
  const lockWord = () => (LOCKS && (lock.locked != null || lock.n > 0) ? { ...lock } : null)
  const tellLock = () => {
    const word = lockWord()
    if (!word) return
    try { Promise.resolve(fetch(`${URL_BASE}/api/remote/screen-lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(word) })).catch(() => {}) } catch { /* said next time */ }
  }
  const lockIs = (v) => { if (v === lock.locked) return; lock.locked = v; lock.n++; displayAwake(); tellLock() }
  // Looked at again (a lock or unlock not heard of): only a while after the last one heard, which the
  // system may not have caught up with yet.
  let heardAt = 0
  const lookAgain = () => { if (Date.now() - heardAt > LOCK_HEARD_MS) lockIs(lockNow()) }
  const heard = (v) => { heardAt = Date.now(); lockIs(v) }
  if (LOCKS && typeof powerMonitor?.on === 'function') { powerMonitor.on('lock-screen', () => heard(true)); powerMonitor.on('unlock-screen', () => heard(false)) }

  // ---------- what can be seen ----------
  // macOS's word on Screen Recording, without asking: 'ok', 'ask' or 'denied'. (macOS says denied
  // until it's been asked, so only an answer after a look counts as no.)
  const permission = () => {
    if (!MAC) return 'ok'
    const s = systemPreferences.getMediaAccessStatus('screen')
    return s === 'granted' ? 'ok' : s === 'restricted' ? 'restricted' : s === 'not-determined' ? 'ask' : 'denied'
  }
  // macOS's word when this app started: Screen Recording turned on after that takes effect only once
  // the app is reopened (macOS says so when it's turned on), and until then there are no screens.
  const startedWith = permission()
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
  // Screens apart from windows, so a window that can't be listed never hides them, and again a moment
  // later when there are none at first. None at all: why, as far as can be told (none: 'reopen' when
  // Screen Recording was turned on since this app started), and what getSources said.
  async function sources() {
    const get = async (type) => (await Promise.race([
      desktopCapturer.getSources({ types: [type], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }),
      new Promise((_, no) => setTimeout(() => no(new Error(`${MAC ? 'macOS' : 'The system'} didn't list the ${type === 'screen' ? 'screens' : 'windows'} within ${Math.round(listMs / 1000)} seconds`)), listMs)),
    ])).filter((s) => String(s.id).startsWith(`${type}:`))
    let screens = []
    let problem = null
    for (const wait of [0, 400, 1200]) {
      if (wait) await new Promise((r) => setTimeout(r, wait))
      try { screens = await get('screen'); problem = null } catch (e) { screens = []; problem = String(e?.message || e).slice(0, 200) }
      if (screens.length) break
    }
    let windows = []
    try { windows = await get('window') } catch { windows = [] }
    const list = [...screens, ...windows]
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
    const now = permission()
    const none = screens.length ? null : MAC && now === 'ok' && startedWith !== 'ok' ? 'reopen' : 'none'
    // (Whether it's locked, looked at again now: a capture that fails or stops is told apart by it.)
    lookAgain()
    const word = lockWord()
    return { sources: out.slice(0, 40), permission: now, ...(none ? { none, ...(problem ? { problem } : {}) } : {}), ...(word ? { lock: word } : {}) }
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
  // fresh: the server's page didn't connect (or say its screens) in time, so this one is closed and
  // another opened. A page that doesn't load (the server restarting just then) is loaded again a few
  // times, then closed; one that crashes or hangs is closed, and the next ask opens another. While
  // it's open, macOS doesn't put the app to sleep (App Nap) with its windows hidden.
  let napless = null
  const keepUp = (on) => {
    if (!power) return
    if (on && napless == null) napless = power.start('prevent-app-suspension')
    else if (!on && napless != null) { try { power.stop(napless) } catch { /* stopped */ } napless = null }
  }
  // A new token for a window that's open (its own spent: the server restarted, say): its page loads
  // again with it, and connects straight away.
  const pageAt = (token) => `${URL_BASE}/?${new URLSearchParams({ remote: 'capture', token: String(token || '').slice(0, 80) })}`
  function needCapture({ fresh = false, token = '' } = {}) {
    if (capture && !capture.isDestroyed()) {
      if (!fresh) { if (token && token !== capture.token) { capture.token = token; capture.loadURL(pageAt(token)).catch(() => {}) } return }
      try { capture.destroy() } catch { /* gone */ }
    }
    const w = new BrowserWindow({ show: false, width: 480, height: 320, title: 'Bridge AI screen sharing', skipTaskbar: true, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    capture = w
    w.token = token
    keepUp(true)
    const url = () => pageAt(w.token)
    const gone = () => { try { if (!w.isDestroyed()) w.destroy() } catch { /* gone */ } }
    let tries = 0
    w.on('page-title-updated', (e) => e.preventDefault())
    w.on('closed', () => { if (capture === w) { capture = null; keepUp(false) } })
    w.on('unresponsive', gone)
    w.webContents.on('render-process-gone', gone)
    w.webContents.on('did-fail-load', (_e, code, _desc, _url, main) => {
      if (main === false || code === -3) return // a frame's, or a load that was replaced
      if (++tries > 3) return gone()
      setTimeout(() => { if (!w.isDestroyed()) w.loadURL(url()).catch(() => {}) }, 1000 * tries)
    })
    w.loadURL(url()).catch(() => {})
  }
  function captureIdle() { if (capture && !capture.isDestroyed()) capture.destroy(); capture = null; keepUp(false) }

  // ---------- the badge ----------
  // Someone viewing: the display woken when it's asleep (they'd see nothing), and kept awake while
  // they do. Not while the screen is locked (that would only light the lock screen): once it's
  // unlocked, if they still are.
  let awake = null
  let seen = false
  function displayAwake() {
    const want = seen && lock.locked !== true
    if (want && awake == null) { try { wake() } catch { /* not here */ } awake = power ? power.start('prevent-display-sleep') : -1 }
    else if (!want && awake != null) { if (awake >= 0) try { power.stop(awake) } catch { /* stopped */ } awake = null }
  }
  function viewing(on) {
    if (on) { try { taken() } catch { /* only said */ } }
    seen = on
    displayAwake()
  }
  // While anyone sees this screen, or asks to (Ask Here First, answered on it).
  function sessions(list, asks) {
    viewing(Array.isArray(list) && list.length > 0)
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
    if (ev.t === 'need-capture') needCapture({ fresh: ev.fresh === true, token: typeof ev.token === 'string' ? ev.token : '' })
    else if (ev.t === 'reopen') setTimeout(restart, 500) // (the server tells the device first)
    else if (ev.t === 'allow-screen') { if (MAC) allowScreen() }
    else if (ev.t === 'capture-idle') captureIdle()
    else if (ev.t === 'sessions') sessions(ev.list, ev.asks)
    else if (ev.t === 'control') control = !!ev.on
    else if (ev.t === 'page-start') pageStart(ev)
    else if (ev.t === 'page-input') pageInput(ev)
    else if (ev.t === 'page-resize') pageResize(ev)
    else if (ev.t === 'page-go') pageGo(ev)
    else if (ev.t === 'page-stop') pageStop(ev)
    else if (ev.t === 'lock?') { const n = lock.n; lookAgain(); if (lock.n === n) tellLock() }
  }
  return { onEvent, sources, thumbs, permission, view, fit, isView: (w) => [...views.values()].includes(w), controlOn: () => control, setControl: (on) => { control = !!on }, windows: () => [capture, badge, ...views.values()].filter(Boolean), locked: () => lock.locked }
}

module.exports = { create, fitWindow, displayFor }
