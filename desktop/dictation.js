// The dictation key from any app (main.js starts this), and the small window that shows what you
// said there (the app's own page, ?dictate=1: src/dictation/Hud.jsx). Settings › Voice › Dictation
// picks the key and turns it on or off; holding it inside Bridge AI is the page's own and needs none
// of this.
//
// What hears the key depends on what this computer allows without a permission prompt
// (shared/dictation/platform.js decides, from what's found when the app starts):
//   a Mac          native/bridgekeys (Carbon's hotkeys): pressed and let go, no prompt
//   Windows, X11   Electron's globalShortcut for the press (it keeps the key from the app in front,
//                  and fails when another app has it), and uiohook-napi's keyboard hook for the
//                  let-go, started at the press and stopped at the let-go, so nothing watches the
//                  keyboard the rest of the time. Never on a Mac, where it asks for Accessibility.
//   Wayland        globalShortcut through the desktop's portal: a press only, so a tap starts
//                  listening and the next stops it (GNOME asks once; sway has no portal: none)
// With one of Bridge AI's windows in front, the key goes to that page (as if pressed there);
// otherwise to the dictation window, shown without taking the keyboard from the app you're in.
// uiohook-napi comes built for each system (Node-API, so any Electron loads it): the app's build
// doesn't rebuild it (package.json, npmRebuild) and keeps only the system's own (its files lists).
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { pathToFileURL } = require('node:url')

// ---------- What hears the key ----------
// Each: { ok, stop() }, calling onDown(at, info) and onUp(at). at: when, in ms since 1970.

// native/bridgekeys hotkey <code> <mods>. onState({ ready } | { error, by, status }) once it's set.
function helperSource({ bin, code, mods, onDown, onUp, onState, onExit, spawnFn = spawn }) {
  const p = spawnFn(bin, ['hotkey', String(code), String(mods)], { stdio: ['pipe', 'pipe', 'ignore'] })
  let buf = ''
  let told = false
  p.stdout.on('data', (d) => {
    buf += d
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      let j
      try { j = JSON.parse(line) } catch { continue }
      if (j.ready || j.error) { told = true; onState?.(j) } else if (j.down) onDown(j.down, j)
      else if (j.up) onUp(j.up)
    }
  })
  p.on('error', () => { if (!told) { told = true; onState?.({ error: 'failed' }) } })
  p.on('exit', (code) => { if (!told) { told = true; onState?.({ error: 'failed', status: code }) } onExit?.(code) })
  p.stdin.on('error', () => {})
  return {
    ok: true,
    stop() { try { p.stdin.end() } catch { /* gone */ } try { p.kill() } catch { /* gone */ } },
    // As if the key itself went down or up (the tests' way in).
    press() { p.stdin.write('press\n') },
    release() { p.stdin.write('release\n') },
  }
}

// globalShortcut for the press, the hook for the let-go. codes: shared/dictation/keys.js hookKey().
// X11 repeats a held key as a let-go and a press at the same moment, so a let-go only counts once
// no press follows it within `settle` ms.
function hookSource({ accel, codes, globalShortcut, hook, onDown, onUp, settle = 0, now = Date.now }) {
  let down = false
  let last = 0
  let watching = false
  let pending = null
  const part = (c) => c === codes.key || codes.mods.includes(c)
  const end = () => { pending = null; down = false; unwatch(); onUp(now()) }
  const keyup = (e) => {
    if (!down || !part(e.keycode)) return
    clearTimeout(pending)
    if (settle) pending = setTimeout(end, settle); else end()
  }
  const keydown = (e) => { if (pending && e.keycode === codes.key) { clearTimeout(pending); pending = null } }
  const watch = () => {
    if (watching) return true
    try { hook.on('keyup', keyup); hook.on('keydown', keydown); hook.start(); watching = true } catch { hook.off?.('keyup', keyup); hook.off?.('keydown', keydown) }
    return watching
  }
  function unwatch() {
    if (!watching) return
    watching = false
    hook.off('keyup', keyup)
    hook.off('keydown', keydown)
    try { hook.stop() } catch { /* stopped */ }
  }
  const ok = globalShortcut.register(accel, () => {
    const t = now()
    // The key held down repeats; one whose let-go was missed (well over a second ago) is a new press.
    if (down && t - last < 1200) { last = t; return }
    if (down) end()
    down = true
    last = t
    onDown(t)
    // No hook: the let-go can't be heard, so it's a tap (the page keeps listening until the next).
    if (!watch()) { down = false; onUp(t) }
  })
  return { ok, stop() { clearTimeout(pending); unwatch(); if (ok) globalShortcut.unregister(accel) } }
}

// globalShortcut alone: each press is a tap (down and up at once).
function shortcutSource({ accel, globalShortcut, onDown, onUp, now = Date.now }) {
  const ok = globalShortcut.register(accel, () => { const t = now(); onDown(t); onUp(t) })
  return { ok, stop() { if (ok) globalShortcut.unregister(accel) } }
}

// ---------- What this computer has ----------
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 3000 }, (err, out) => resolve(err ? null : String(out))))
// The desktop's GlobalShortcuts portal (Wayland), asked over D-Bus: true, false, or null (no way to ask).
async function hasPortal() {
  const dest = ['org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop']
  const out = await run('gdbus', ['introspect', '--session', '--dest', dest[0], '--object-path', dest[1]])
    ?? await run('busctl', ['--user', 'introspect', dest[0], dest[1]])
  return out == null ? null : out.includes('org.freedesktop.portal.GlobalShortcuts')
}
function loadHook() {
  try { return require('uiohook-napi').uIOhook } catch { return null }
}

// ---------- The app's side ----------
// electron: the module; ROOT: Bridge AI's code (shared/, native/bin); DATA: its data folder;
// isOurs(win): one of the app's own windows, where the key goes to the page.
function start({ electron, ROOT, DATA, URL_BASE, preload, isOurs, tellMain }) {
  const { BrowserWindow, globalShortcut, screen, ipcMain, clipboard } = electron
  const IS_MAC = process.platform === 'darwin'
  let lib = null
  let facts = null
  let g = { mode: null }
  let source = null
  let status = { mode: null }
  let settings = {}
  let route = null // where the key's press went: a page's webContents, or 'hud'
  let hud = null
  let pending = null // a press from before the dictation window's page was ready
  let ready = false
  let esc = false
  const helperBin = () => process.env.BRIDGE_KEYS || path.join(ROOT, 'native', 'bin', 'bridgekeys')
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).dictation || {} } catch { return {} } }

  const say = (wc, detail) => { if (wc && !wc.isDestroyed()) wc.executeJavaScript(`window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: ${JSON.stringify(detail)} }))`).catch(() => {}) }
  const toHud = (detail) => {
    if (!ready) { if (detail.type === 'down') pending = { down: detail.at, up: null }; else if (detail.type === 'up' && pending) pending.up = detail.at; return }
    say(hud?.webContents, detail)
  }
  function onDown(at) {
    const w = BrowserWindow.getFocusedWindow()
    if (w && w !== hud && isOurs(w)) { route = w.webContents; say(route, { type: 'down', at }); return }
    route = 'hud'
    showHud()
    toHud({ type: 'down', at })
  }
  function onUp(at) {
    if (route === 'hud') toHud({ type: 'up', at })
    else say(route, { type: 'up', at })
  }

  // ---------- The dictation window ----------
  const SIZE = { w: 444, h: 92 }
  function place(w = SIZE.w, h = SIZE.h) {
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    return { x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + a.height - h - 48), width: w, height: h }
  }
  function showHud() {
    if (!hud || hud.isDestroyed()) {
      ready = false
      hud = new BrowserWindow({
        ...place(), frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, hasShadow: false, alwaysOnTop: true, acceptFirstMouse: true, show: false, title: 'Bridge AI dictation',
        // On a Mac it never takes the keyboard from the app you're in, even when clicked.
        ...(IS_MAC ? { focusable: false } : {}),
        webPreferences: { preload, contextIsolation: true, sandbox: true },
      })
      hud.setAlwaysOnTop(true, 'floating')
      hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      // Not in pictures of the screen (a screen you share on a call).
      hud.setContentProtection(true)
      hud.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      hud.webContents.on('will-navigate', (e) => e.preventDefault())
      hud.on('closed', () => { hud = null; ready = false; holdEsc(false) })
      hud.once('ready-to-show', () => hud?.showInactive())
      hud.loadURL(`${URL_BASE}/?dictate=1`)
      return
    }
    const [w, h] = hud.getContentSize()
    hud.setBounds(place(w, h))
    if (!hud.isVisible()) hud.showInactive()
  }
  const hideHud = () => { holdEsc(false); if (hud && !hud.isDestroyed() && hud.isVisible()) hud.hide() }
  // Esc cancels while it listens (held only then: it's every app's Esc meanwhile).
  function holdEsc(on) {
    if (on === esc) return
    esc = on
    if (on) { if (!globalShortcut.register('Escape', () => toHud({ type: 'cancel' }))) esc = false } else globalShortcut.unregister('Escape')
  }
  const fromHud = (e) => !!hud && !hud.isDestroyed() && e.sender === hud.webContents
  ipcMain.handle('bridge:hud-ready', (e) => { if (!fromHud(e)) return null; ready = true; const p = pending; pending = null; return p })
  ipcMain.on('bridge:hud-size', (e, w, h) => {
    if (!fromHud(e) || !Number.isFinite(w) || !Number.isFinite(h)) return
    const nw = Math.max(200, Math.min(640, Math.round(w))), nh = Math.max(48, Math.min(520, Math.round(h)))
    const b = hud.getBounds()
    if (b.width === nw && b.height === nh) return
    // It grows upward, keeping its bottom and its middle where they were.
    hud.setBounds({ x: Math.round(b.x + (b.width - nw) / 2), y: b.y + b.height - nh, width: nw, height: nh })
  })
  ipcMain.on('bridge:hud-phase', (e, phase) => { if (fromHud(e)) holdEsc(phase === 'opening' || phase === 'listening' || phase === 'working') })
  ipcMain.handle('bridge:hud-hide', (e) => { if (fromHud(e)) hideHud(); return true })
  ipcMain.handle('bridge:hud-copy', (e, text) => { if (!fromHud(e) || typeof text !== 'string') return false; clipboard.writeText(text.slice(0, 200_000)); return true })
  // Edit in Bridge AI: the agent's tab in the main window, the text in its message box.
  ipcMain.handle('bridge:hud-open', async (e, { paneId, text } = {}) => {
    if (!fromHud(e)) return false
    hideHud()
    if (typeof paneId === 'string' && paneId.length < 200 && typeof text === 'string') await tellMain(`window.dispatchEvent(new CustomEvent('bridge-dictate-text', { detail: ${JSON.stringify({ paneId, text: text.slice(0, 100_000) })} }))`, true)
    return true
  })

  // ---------- The key ----------
  let applying = 0
  async function apply() {
    const gen = ++applying
    source?.stop()
    source = null
    const key = settings.key || lib.defaultKey(process.platform)
    const background = settings.background === true // off until you say yes (shared/dictation/platform.js)
    status = { mode: g.mode, via: g.via || null, asks: !!g.asks, why: g.why || null, key, background, active: false, taken: null, fallback: null, error: null }
    if (settings.on === false || !background || !g.mode) return status
    const handlers = { onDown, onUp }
    if (g.via === 'bridgekeys') {
      const tryKey = (k) => new Promise((resolve) => {
        const mk = lib.macKey(k)
        if (!mk) return resolve({ error: 'key' })
        let s = null
        const timer = setTimeout(() => resolve({ ready: true }), 3000)
        s = helperSource({ bin: helperBin(), ...mk, ...handlers, onState: (j) => { clearTimeout(timer); resolve(j) }, onExit: () => { if (source === s) { source = null; status.active = false } } })
        source = s
      })
      let r = await tryKey(key)
      // macOS 15 for a while turned down hotkeys with only ⌥ (it says "failed"): ⌃⌥Space then.
      if (r.error === 'failed' && !settings.key && gen === applying) { r = await tryKey('Control+Alt+Space'); if (r.ready) status.fallback = 'Control+Alt+Space' }
      if (gen !== applying) return status // settings changed meanwhile: that one's in charge
      if (r.ready) status.active = true
      else { source?.stop(); source = null; if (r.error === 'taken') status.taken = r.by || 'app'; else status.error = r.error || 'failed' }
      return status
    }
    const accel = key
    if (g.via === 'uiohook') source = hookSource({ accel, codes: lib.hookKey(key, process.platform), globalShortcut, hook: loadHook(), settle: process.platform === 'linux' ? 40 : 0, ...handlers })
    else source = shortcutSource({ accel, globalShortcut, ...handlers })
    if (source.ok) status.active = true
    else { source = null; status.taken = 'app' }
    return status
  }

  ipcMain.handle('bridge:dictate-status', () => status)
  ipcMain.handle('bridge:dictate-configure', async (e, s) => {
    if (!s || typeof s !== 'object') return status
    settings = { ...s }
    if (!lib) return status
    return apply()
  })

  // What this computer has, then the key as Settings has it.
  return (async () => {
    const imp = (f) => import(pathToFileURL(path.join(ROOT, 'shared', 'dictation', f)).href)
    const [keys, platform] = await Promise.all([imp('keys.js'), imp('platform.js')])
    lib = { ...keys, ...platform }
    facts = { platform: process.platform, arch: process.arch, desktop: true, electron: Number(String(process.versions.electron).split('.')[0]) }
    if (IS_MAC) facts.helper = fs.existsSync(helperBin())
    if (process.platform === 'linux') {
      facts.wayland = String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'
      facts.session = process.env.XDG_CURRENT_DESKTOP || ''
      if (facts.wayland) facts.portal = await hasPortal()
    }
    // Only loaded where it's used: never on a Mac (it asks for Accessibility there) or on Wayland.
    if (process.platform === 'win32' || (process.platform === 'linux' && !facts.wayland)) facts.hook = !!loadHook()
    g = lib.globalKey(facts)
    settings = readSettings()
    return apply()
  })()
}

// The helper goes with the app (it watches for that), and the shortcuts with will-quit (main.js).
module.exports = { start, helperSource, hookSource, shortcutSource }
