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
//
// "Where I'm typing" (Settings › Voice, off until you pick it): the dictation window, once it has
// the text, asks for it to be pasted into the app you were in (pasteInto in platform.js says how,
// and whether this computer can): a Mac's helper (bridgekeys paste, which needs Accessibility, asked
// for when you pick it), the keyboard hook's keyTap on Windows and X11, wtype on Wayland. Anything in
// the way (Secure Input, no Accessibility yet, another app in front now) and it keeps the text, to
// copy or send.
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

// ---------- Pasting where you're typing ----------
// Each answers { pasted: true, read, restored } or { error }: secure (a password field), accessibility
// (not allowed yet), moved (another app in front now), focus (one of Bridge AI's windows is), failed.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A Mac: native/bridgekeys paste, the text on its stdin. pid: the app in front when the key was pressed.
function helperPaste({ bin, text, pid, spawnFn = spawn, timeout = 10000 }) {
  return new Promise((resolve) => {
    const p = spawnFn(bin, ['paste', ...(Number.isInteger(pid) && pid > 0 ? ['--pid', String(pid)] : [])], { stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => { try { p.kill() } catch { /* gone */ } resolve({ error: 'failed' }) }, timeout)
    p.stdout.on('data', (d) => { out += d })
    p.on('error', () => { clearTimeout(timer); resolve({ error: 'failed' }) })
    p.on('exit', () => {
      clearTimeout(timer)
      let j = null
      try { j = JSON.parse(out.trim().split('\n').pop()) } catch { /* below */ }
      resolve(j?.pasted ? j : { error: j?.error || 'failed', ...(j?.app ? { app: j.app } : {}) })
    })
    p.stdin.on('error', () => {})
    p.stdin.end(text)
  })
}

// Windows and X11: the text on the clipboard, Ctrl+V pressed with the keyboard hook's keyTap
// (Ctrl+Shift+V in a terminal), then what was there put back, unless something else was copied
// meanwhile. Nothing says when the app in front has read it (a Mac's pasteboard can), so it waits
// `wait` ms first. Electron's clipboard puts back text, HTML, RTF and a picture; anything else (files
// copied in a file manager, say) is lost to a paste.
const KEY = { V: 47, Ctrl: 29, Shift: 42 } // uiohook-napi's UiohookKey
function savedClipboard(c) {
  const s = {}
  const text = c.readText(); if (text) s.text = text
  const html = c.readHTML(); if (html) s.html = html
  const rtf = c.readRTF(); if (rtf) s.rtf = rtf
  const image = c.readImage(); if (image && !image.isEmpty()) s.image = image
  return s
}
const putBack = (c, s) => { if (Object.keys(s).length) c.write(s); else c.clear() }
async function keyPaste({ text, clipboard, hook, terminal = false, wait = 600 }) {
  if (!hook?.keyTap) return { error: 'failed' }
  const saved = savedClipboard(clipboard)
  clipboard.writeText(text)
  try { hook.keyTap(KEY.V, terminal ? [KEY.Ctrl, KEY.Shift] : [KEY.Ctrl]) } catch { putBack(clipboard, saved); return { error: 'failed' } }
  await sleep(wait)
  if (clipboard.readText() !== text) return { pasted: true, restored: false }
  putBack(clipboard, saved)
  return { pasted: true, restored: true }
}

// Wayland: typed in by wtype (no clipboard), on desktops with the virtual keyboard it needs.
function typeIn({ text, execFn = execFile }) {
  return new Promise((resolve) => execFn('wtype', ['--', text.slice(0, 30000)], { timeout: 20000 }, (err) => resolve(err ? { error: 'failed' } : { pasted: true })))
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
// A program on the PATH (wtype), looked for without blocking.
async function onPath(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    try { await fs.promises.access(path.join(dir, name), fs.constants.X_OK); return true } catch { /* not here */ }
  }
  return false
}
// X11: the class of the window in front (WM_CLASS, as xprop prints it), to tell a terminal; null
// without xprop.
async function activeClass(runFn = run) {
  const root = await runFn('xprop', ['-root', '_NET_ACTIVE_WINDOW'])
  const id = /0x[0-9a-f]+/i.exec(root || '')?.[0]
  if (!id || /^0x0+$/i.test(id)) return null
  return runFn('xprop', ['-id', id, 'WM_CLASS'])
}

// ---------- The app's side ----------
// electron: the module; ROOT: Bridge AI's code (shared/, native/bin); DATA: its data folder;
// isOurs(win): one of the app's own windows, where the key goes to the page.
// askAccess(pane): the Allow access tile (main.js); trusted(e): an IPC call from the app's own page.
function start({ electron, ROOT, DATA, URL_BASE, preload, isOurs, tellMain, askAccess, trusted = () => true }) {
  const { BrowserWindow, globalShortcut, screen, ipcMain, clipboard, systemPreferences, shell } = electron
  const IS_MAC = process.platform === 'darwin'
  let lib = null
  let facts = null
  let g = { mode: null }
  let pz = { can: false } // pasteInto: whether pasting where you're typing can work here
  let front = null // the app in front when the key was pressed there (a Mac: { app, pid })
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
    if (!ready) { if (detail.type === 'down') pending = { down: detail.at, up: null, app: detail.app || null }; else if (detail.type === 'up' && pending) pending.up = detail.at; return }
    say(hud?.webContents, detail)
  }
  // info: what the Mac's helper says was in front ({ app, pid, secure }).
  function onDown(at, info) {
    const w = BrowserWindow.getFocusedWindow()
    if (w && w !== hud && isOurs(w)) { route = w.webContents; say(route, { type: 'down', at }); return }
    route = 'hud'
    front = Number.isInteger(info?.pid) ? { app: typeof info.app === 'string' ? info.app.slice(0, 80) : '', pid: info.pid } : null
    showHud()
    toHud({ type: 'down', at, ...(front?.app ? { app: front.app } : {}) })
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
  // ---------- Pasting where you're typing ----------
  // Allowed now? Asked of macOS each time without asking you (Accessibility); elsewhere nothing to allow.
  const allowedNow = () => !IS_MAC || !!systemPreferences?.isTrustedAccessibilityClient?.(false)
  const pasteStatus = () => ({ ...pz, allowed: !!pz.can && (pz.asks !== 'accessibility' || allowedNow()) })
  async function pasteHere(text) {
    const p = pasteStatus()
    if (settings.to !== 'paste' || !p.can) return { error: 'off' }
    if (!p.allowed) return { error: 'accessibility' }
    // The Mac's dictation window never has the keyboard; the helper checks the app in front is still
    // the one the key was pressed in. macOS counts the helper's Accessibility as the app's (the app
    // started it), so both answer alike; if they ever don't, the log says so.
    if (p.via === 'bridgekeys') {
      const r = await helperPaste({ bin: helperBin(), text, pid: front?.pid })
      if (r.error === 'accessibility') console.error('dictation: macOS lets Bridge AI use Accessibility, but not its helper (bridgekeys)')
      return r
    }
    // Elsewhere it has it if it was clicked, and on Wayland it may have taken it when it showed:
    // hidden, the app you were in gets it back.
    if (p.via === 'wtype' || hud?.isFocused()) { hideHud(); await sleep(150) }
    if (BrowserWindow.getFocusedWindow()) return { error: 'focus' }
    if (p.via === 'wtype') return typeIn({ text })
    const terminal = process.platform === 'linux' && lib.isTerminal(await activeClass())
    return keyPaste({ text, clipboard, hook: loadHook(), terminal })
  }
  ipcMain.handle('bridge:hud-paste', (e, text) => (fromHud(e) && typeof text === 'string' && text ? pasteHere(text.slice(0, 100_000)) : { error: 'off' }))
  ipcMain.handle('bridge:paste-access', (e) => (trusted(e) ? (pasteStatus().allowed ? 'ok' : 'denied') : null))
  // Picking "Where I'm typing" on a Mac: the first time, macOS lists Bridge AI under Accessibility
  // (turned off) and asks in a window of its own, whose Open System Settings goes to that list; after
  // that (Allow access again), the list itself. The tile says what to do there, and goes once it's on.
  let askedMac = false
  ipcMain.handle('bridge:paste-ask', (e) => {
    if (!trusted(e)) return null
    const p = pasteStatus()
    if (!p.can) return 'no'
    if (p.allowed) return 'ok'
    if (!askedMac) { askedMac = true; systemPreferences.isTrustedAccessibilityClient(true) } else shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility').catch(() => {})
    askAccess?.('accessibility')
    return 'asked'
  })

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

  // What Settings and the dictation window are told: the key's status, and pasting's.
  const view = () => ({ ...status, paste: pasteStatus() })
  ipcMain.handle('bridge:dictate-status', () => view())
  ipcMain.handle('bridge:dictate-configure', async (e, s) => {
    if (!s || typeof s !== 'object') return view()
    settings = { ...s }
    if (lib) await apply()
    return view()
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
      if (facts.wayland) [facts.portal, facts.wtype] = await Promise.all([hasPortal(), onPath('wtype')])
    }
    // Only loaded where it's used: never on a Mac (it asks for Accessibility there) or on Wayland.
    if (process.platform === 'win32' || (process.platform === 'linux' && !facts.wayland)) facts.hook = !!loadHook()
    g = lib.globalKey(facts)
    pz = lib.pasteInto(facts)
    settings = readSettings()
    await apply()
    return view()
  })()
}

// The helper goes with the app (it watches for that), and the shortcuts with will-quit (main.js).
module.exports = { start, helperSource, hookSource, shortcutSource, helperPaste, keyPaste, typeIn, activeClass }
