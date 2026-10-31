// Dictation's parts that need no browser, on any platform: the key (its default on each system,
// what it's called, macOS's and the keyboard hook's codes for it, matching it in the page), where the
// key works from other apps on each kind of machine (simulated: a Mac with and without the helper,
// Windows, X11, Wayland on GNOME, KDE and sway, Linux Arm, Docker and a browser), what GNOME needs of
// the desktop app (its Electron, an application ID GNOME accepts, a menu entry of that name, which
// install.sh puts in place), the light cleanup
// (fillers, doubled words, capitals, the full stop, names spelled the way they're written, files
// said aloud), and how the desktop app hears the key (desktop/dictation.js) with a stand-in keyboard
// hook and globalShortcut: held, tapped, a key repeating, X11's repeats, another app having it, no
// hook at all. On a Mac: native/bridgekeys builds for both chips, says what's in front, sets a key
// and prints its presses (made through its stdin, no real key), and says when macOS has the key.
// Then the server's names for it (/api/dictation/words) and its settings in /api/config.
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { ROOT, OUT, IS_MAC, startKit, checks, until, sleep } from '../lib/harness.mjs'

const { ok, skip, done } = checks('dictation')
const keys = await import('../../shared/dictation/keys.js')
const { globalKey } = await import('../../shared/dictation/platform.js')
const { clean, makeNames } = await import('../../shared/dictation/clean.js')
const desk = createRequire(import.meta.url)('../../desktop/dictation.js')

// ---------- The key ----------
ok(keys.defaultKey('darwin') === 'Alt+Space' && keys.defaultKey('win32') === 'Control+Alt+Space' && keys.defaultKey('linux') === 'Control+Alt+Space', 'the key is ⌥Space on a Mac, Ctrl+Alt+Space on Windows and Linux')
ok(keys.keyLabel('Alt+Space', 'darwin') === '⌥Space' && keys.keyLabel('Control+Alt+Space', 'win32') === 'Ctrl+Alt+Space' && keys.keyLabel('Control+Super+D', 'linux') === 'Ctrl+Super+D', 'and it\'s called that', [keys.keyLabel('Alt+Space', 'darwin'), keys.keyLabel('Control+Alt+Space', 'win32')])
ok(JSON.stringify(keys.parseKey('CommandOrControl+Shift+K', 'darwin')) === JSON.stringify({ key: 'K', ctrl: false, alt: false, meta: true, shift: true }) && keys.parseKey('CmdOrCtrl+K', 'win32').ctrl, 'CommandOrControl is ⌘ on a Mac and Ctrl elsewhere')
ok(!keys.parseKey('Space') && !keys.parseKey('A') && !keys.parseKey('Shift+A') && !keys.parseKey('Alt+Space+K') && !!keys.parseKey('F9'), 'a key typed all day (Space, a letter, Shift+a letter) isn\'t one; an F key alone is', [keys.parseKey('Space'), keys.parseKey('F9')])
ok(JSON.stringify(keys.macKey('Alt+Space')) === JSON.stringify({ code: 49, mods: 2048 }) && JSON.stringify(keys.macKey('Control+Alt+Space')) === JSON.stringify({ code: 49, mods: 6144 }) && keys.macKey('Command+Shift+D').mods === 768, 'macOS\'s key code and Carbon\'s modifiers for it', keys.macKey('Alt+Space'))
const hk = keys.hookKey('Control+Alt+Space', 'win32')
ok(hk.key === 0x39 && [0x1d, 0x0e1d, 0x38, 0x0e38].every((c) => hk.mods.includes(c)) && hk.mods.length === 4, 'the keyboard hook\'s codes: Space, and both sides of Ctrl and Alt', hk)
const ev = (o) => ({ code: 'Space', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...o })
const k = keys.parseKey('Control+Alt+Space', 'linux')
ok(keys.isKeyDown(ev({ ctrlKey: true, altKey: true }), k) && !keys.isKeyDown(ev({ ctrlKey: true, altKey: true, shiftKey: true }), k) && !keys.isKeyDown(ev({ altKey: true }), k), 'in the page, the key down is that combination exactly')
ok(keys.isKeyUp(ev({ code: 'AltLeft' }), k) && keys.isKeyUp(ev({ code: 'Space' }), k) && keys.isKeyUp(ev({ code: 'ControlRight' }), k) && !keys.isKeyUp(ev({ code: 'KeyA' }), k), 'and letting go of any part of it ends it')
ok(keys.keyFromEvent({ code: 'KeyD', ctrlKey: true, altKey: true }, 'win32') === 'Control+Alt+D' && keys.keyFromEvent({ code: 'Space', altKey: true }, 'darwin') === 'Alt+Space' && keys.keyFromEvent({ code: 'AltLeft', altKey: true }, 'darwin') === null && keys.keyFromEvent({ code: 'KeyD' }, 'darwin') === null, 'a new key picked from what\'s pressed (not modifiers alone, not a bare letter)')

// ---------- Where the key works from other apps ----------
// The Electron the desktop app is built with, as its lockfile has it.
const desktopPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'))
const ELECTRON = Number(JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package-lock.json'), 'utf8')).packages['node_modules/electron'].version.split('.')[0])
const G = (m) => globalKey({ desktop: true, electron: ELECTRON, ...m })
const table = [
  ['macOS, Apple silicon, with the helper', { platform: 'darwin', arch: 'arm64', helper: true }, 'hold', 'bridgekeys'],
  ['macOS, Intel, with the helper', { platform: 'darwin', arch: 'x64', helper: true }, 'hold', 'bridgekeys'],
  ['macOS built without Xcode\'s tools', { platform: 'darwin', arch: 'arm64', helper: false }, 'toggle', 'shortcut'],
  ['Windows x64', { platform: 'win32', arch: 'x64', hook: true }, 'hold', 'uiohook'],
  ['Windows on Arm (the x64 app, emulated)', { platform: 'win32', arch: 'x64', hook: true }, 'hold', 'uiohook'],
  ['Windows with the hook not loading', { platform: 'win32', arch: 'x64', hook: false }, 'toggle', 'shortcut'],
  ['Linux x64, X11', { platform: 'linux', arch: 'x64', hook: true }, 'hold', 'uiohook'],
  ['Linux x64, X11, without libXtst', { platform: 'linux', arch: 'x64', hook: false }, 'toggle', 'shortcut'],
  ['Linux Arm, X11 (from source; the hook\'s Arm build is x64)', { platform: 'linux', arch: 'arm64', hook: false }, 'toggle', 'shortcut'],
  ['Wayland, GNOME, installed (its menu entry there)', { platform: 'linux', arch: 'x64', wayland: true, session: 'ubuntu:GNOME', portal: true, entry: true }, 'toggle', 'shortcut'],
  ['Wayland, GNOME, menu entry unknown', { platform: 'linux', arch: 'x64', wayland: true, session: 'GNOME', portal: true, entry: null }, 'toggle', 'shortcut'],
  ['Wayland, GNOME, run from source with Electron 44', { platform: 'linux', arch: 'x64', wayland: true, session: 'ubuntu:GNOME', portal: true, entry: true, electron: 44 }, null],
  ['Wayland, GNOME, no menu entry of its own (from source, or the AppImage opened as it is)', { platform: 'linux', arch: 'x64', wayland: true, session: 'ubuntu:GNOME', portal: true, entry: false }, null],
  ['Wayland, KDE', { platform: 'linux', arch: 'x64', wayland: true, session: 'KDE', portal: true }, 'toggle', 'shortcut'],
  ['Wayland, Hyprland', { platform: 'linux', arch: 'x64', wayland: true, session: 'Hyprland', portal: true }, 'toggle', 'shortcut'],
  ['Wayland, sway (no portal)', { platform: 'linux', arch: 'x64', wayland: true, session: 'sway', portal: false }, null],
  ['Wayland, portal unknown', { platform: 'linux', arch: 'x64', wayland: true, session: 'KDE', portal: null }, null],
]
for (const [name, m, mode, via] of table) {
  const g = G(m)
  ok(g.mode === mode && (!mode || g.via === via), `${name}: ${mode ? `${mode === 'hold' ? 'held' : 'tapped'} from any app (${via})` : 'not from other apps (hidden)'}`, g)
}
ok(globalKey({ desktop: false, platform: 'linux' }).mode === null && globalKey({ desktop: false, platform: 'darwin', helper: true }).mode === null, 'Docker and a browser: inside Bridge AI only')
ok(G({ platform: 'linux', wayland: true, session: 'GNOME', portal: true, entry: true }).asks && !G({ platform: 'linux', wayland: true, session: 'KDE', portal: true }).asks, 'GNOME asks once to allow the key; KDE doesn\'t')
ok(ELECTRON >= 45, `the desktop app's Electron (${ELECTRON}) is one GNOME's shortcuts portal answers (45 or later)`)

// GNOME 50 only lets an app have a key when its ID (desktopName, which Electron hands on) is a valid
// application ID that names an installed menu entry: reverse-DNS, as GLib's g_application_id_is_valid
// has it. The .deb's entry takes that name (linux.syncDesktopName), and so does the installer's.
const appId = /^(.+)\.desktop$/.exec(desktopPkg.desktopName || '')?.[1] || ''
ok(appId.length <= 255 && /^[A-Za-z_-][\w-]*(\.[A-Za-z_-][\w-]*)+$/.test(appId) && desktopPkg.build?.linux?.syncDesktopName === true, 'the desktop app has an application ID GNOME accepts (desktopName), and the .deb\'s menu entry is named for it', { desktopName: desktopPkg.desktopName, syncDesktopName: desktopPkg.build?.linux?.syncDesktopName })
{
  // Where the desktop app looks for its menu entry (desktop/dictation.js), with a home of its own.
  const xdg = path.join(OUT, 'dictation-xdg')
  fs.rmSync(xdg, { recursive: true, force: true })
  fs.mkdirSync(path.join(xdg, 'home', '.local', 'share', 'applications'), { recursive: true })
  fs.mkdirSync(path.join(xdg, 'usr', 'share', 'applications'), { recursive: true })
  const env = { XDG_DATA_DIRS: path.join(xdg, 'usr', 'share') }
  const found = (where) => { fs.writeFileSync(path.join(xdg, ...where, 'applications', desktopPkg.desktopName), '[Desktop Entry]\n'); const r = desk.hasEntry?.(desktopPkg.desktopName, env, path.join(xdg, 'home')); fs.rmSync(path.join(xdg, ...where, 'applications', desktopPkg.desktopName)); return r }
  ok(typeof desk.hasEntry === 'function' && desk.hasEntry(desktopPkg.desktopName, env, path.join(xdg, 'home')) === false && found(['home', '.local', 'share']) === true && found(['usr', 'share']) === true && desk.hasEntry('', env, xdg) === null, 'the desktop app finds its menu entry in ~/.local/share or the system\'s, and knows when there\'s none')
}

// install.sh on Linux without apt (the AppImage, unpacked into ~/.local), run with a stand-in AppImage
// and only the few programs it needs (so never apt or sudo), as if on a Linux x64 machine: the menu
// entry takes the name of the one the app comes with, its ID, and an older entry goes; an older
// version's (bridge-ai.desktop) keeps that name.
if (process.platform === 'win32') skip('install.sh names the menu entry for the app', 'not on Windows (install.ps1 has no menu entry to name)')
else {
  const dir = path.join(OUT, 'dictation-install')
  fs.rmSync(dir, { recursive: true, force: true })
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  for (const t of ['mktemp', 'id', 'rm', 'mkdir', 'cp', 'chmod', 'mv', 'ln']) {
    const at = ['/bin', '/usr/bin'].map((d) => path.join(d, t)).find((f) => fs.existsSync(f))
    if (at) fs.symlinkSync(at, path.join(bin, t))
  }
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -m) echo x86_64 ;; *) echo Linux ;; esac\n', { mode: 0o755 })
  const install = (entry, name) => {
    const home = path.join(dir, name)
    const apps = path.join(home, '.local', 'share', 'applications')
    fs.mkdirSync(apps, { recursive: true })
    fs.writeFileSync(path.join(apps, 'bridge-ai.desktop'), '[Desktop Entry]\nName=Bridge AI\n') // from an earlier install
    // What an AppImage unpacks to (--appimage-extract): the app, its icon and its own menu entry.
    const image = path.join(dir, `${name}.AppImage`)
    fs.writeFileSync(image, `#!/bin/sh\n[ "$1" = --appimage-extract ] || exit 1\nmkdir -p squashfs-root\nprintf '#!/bin/sh\\n' > squashfs-root/bridge-ai\nchmod +x squashfs-root/bridge-ai\n: > squashfs-root/bridge-ai.png\nprintf '[Desktop Entry]\\nName=Bridge AI\\n' > 'squashfs-root/${entry}'\n`, { mode: 0o755 })
    const r = spawnSync('/bin/sh', [path.join(ROOT, 'install.sh')], { encoding: 'utf8', timeout: 30000, env: { PATH: bin, HOME: home, TMPDIR: dir, BRIDGE_FILE: image, BRIDGE_NO_OPEN: '1' } })
    const files = fs.existsSync(apps) ? fs.readdirSync(apps) : []
    const text = files.length === 1 ? fs.readFileSync(path.join(apps, files[0]), 'utf8') : ''
    return { status: r.status, out: `${r.stdout}${r.stderr}`.slice(-600), files, text, home }
  }
  const now = install(desktopPkg.desktopName, 'now')
  ok(now.status === 0 && now.files.join() === desktopPkg.desktopName && now.text.includes(`StartupWMClass=${appId}\n`) && now.text.includes(`Exec="${path.join(now.home, '.local', 'share', 'bridge-ai', 'app', 'bridge-ai')}" %U`), `install.sh: the menu entry is the app's own (${desktopPkg.desktopName}), matched to its windows, and the earlier one is gone`, now)
  ok(desk.hasEntry?.(desktopPkg.desktopName, {}, now.home) === true, 'and the desktop app finds it there, so GNOME\'s key is offered')
  const older = install('bridge-ai.desktop', 'older')
  ok(older.status === 0 && older.files.join() === 'bridge-ai.desktop' && older.text.includes('StartupWMClass=bridge-ai\n'), 'install.sh: an older version, without an ID of its own, keeps bridge-ai.desktop', older)
}

// ---------- Light cleanup ----------
const names = makeNames(['payments-api', 'worktree', 'Claude Code', 'GitHub', 'Notes', 'main', 'Fix the login bug', 'Chief of Staff', 'gpt-5'])
const C = (s, o = {}) => clean(s, { names, ...o })
const cases = [
  ['um so open the the work tree for payments api and uh run the tests', 'So open the worktree for payments-api and run the tests.', 'fillers and a doubled word go; names joined up and hyphenated; a capital and a full stop'],
  ['ask claude code to look, you know, at github', 'Ask Claude Code to look, at GitHub.', 'a name in capitals; a word with capitals inside'],
  ['notes on the main branch', 'Notes on the main branch.', 'a plain word isn\'t capitalised for a project with its name'],
  ['fix the login bug please', 'Fix the login bug please.', 'an agent\'s title that\'s a phrase isn\'t a name'],
  ['use gpt 5 for this', 'Use gpt-5 for this.', 'a model\'s name'],
  ['i think it works', 'I think it works.', '"i" is "I"'],
  ['look at payments dot ts and at src slash app dot jsx', 'Look @payments.ts and @src/app.jsx', 'files said aloud are mentions, and no full stop after one'],
  ['check at payments.ts', 'Check @payments.ts', 'a file the engine already wrote with its dot'],
  ['um', '', 'only a filler is nothing'],
  ['ich habe um drei Uhr die die Datei geändert', 'Ich habe um drei Uhr die die Datei geändert.', 'German keeps its "um" and its "die die"'],
  ['这是一个测试', '这是一个测试', 'no full stop added to Chinese'],
]
for (const [said, want, what] of cases) ok(C(said) === want, `cleanup: ${what}`, `${JSON.stringify(said)} -> ${JSON.stringify(C(said))}`)
ok(C('git status', { sentence: false }) === 'git status' && C('payments', { sentence: false }) === 'payments', 'a terminal or a search box gets no capital or full stop')
ok(C('um look at payments dot ts', { cleanup: false, atFiles: false }) === 'um look at payments dot ts', 'with cleanup and file mentions off, it\'s as said')
ok(C('tell strike about it', { heard: [['strike', 'Stripe']] }) === 'Tell Stripe about it.', 'meeting memory\'s "heard as" pairs')

// ---------- How the desktop app hears the key ----------
const fakeShortcuts = (taken = []) => {
  const on = new Map()
  return { on, register: (a, fn) => { if (taken.includes(a)) return false; on.set(a, fn); return true }, unregister: (a) => on.delete(a) }
}
const fakeHook = ({ fails = false } = {}) => {
  const h = new EventEmitter()
  h.running = false
  h.starts = 0
  h.start = () => { if (fails) throw new Error('no display'); h.running = true; h.starts++ }
  h.stop = () => { h.running = false }
  return h
}
{
  const gs = fakeShortcuts()
  const hook = fakeHook()
  const seen = []
  const src = desk.hookSource({ accel: 'Control+Alt+Space', codes: hk, globalShortcut: gs, hook, onDown: () => seen.push('down'), onUp: () => seen.push('up') })
  ok(src.ok && gs.on.has('Control+Alt+Space') && !hook.running, 'Windows/X11: the key is set, and nothing watches the keyboard until it\'s pressed')
  gs.on.get('Control+Alt+Space')()
  ok(seen.join() === 'down' && hook.running, 'pressed: down, and the hook starts to hear the let-go')
  gs.on.get('Control+Alt+Space')() // the key repeating
  hook.emit('keyup', { keycode: 0x1e }) // another key
  ok(seen.join() === 'down', 'a repeat and another key change nothing', seen)
  hook.emit('keyup', { keycode: 0x38 }) // Alt let go first
  ok(seen.join() === 'down,up' && !hook.running, 'any part of it let go: up, and the hook stops', seen)
  gs.on.get('Control+Alt+Space')()
  hook.emit('keyup', { keycode: 0x39 })
  ok(seen.join() === 'down,up,down,up' && hook.starts === 2, 'and again', seen)
  src.stop()
  ok(!gs.on.has('Control+Alt+Space'), 'stopped: the key is given back')
}
{
  const gs = fakeShortcuts()
  const hook = fakeHook()
  const seen = []
  desk.hookSource({ accel: 'Control+Alt+Space', codes: hk, globalShortcut: gs, hook, settle: 40, onDown: () => seen.push('down'), onUp: () => seen.push('up') })
  gs.on.get('Control+Alt+Space')()
  hook.emit('keyup', { keycode: 0x39 }); hook.emit('keydown', { keycode: 0x39 }) // X11's repeat: up and down together
  await sleep(80)
  ok(seen.join() === 'down', 'X11: a held key\'s repeats (let go and pressed at once) aren\'t a let-go', seen)
  hook.emit('keyup', { keycode: 0x39 })
  await sleep(80)
  ok(seen.join() === 'down,up', 'the real let-go is', seen)
}
{
  const gs = fakeShortcuts(['Control+Alt+Space'])
  const src = desk.hookSource({ accel: 'Control+Alt+Space', codes: hk, globalShortcut: gs, hook: fakeHook(), onDown: () => {}, onUp: () => {} })
  ok(!src.ok, 'another app has the key: said so')
}
{
  const gs = fakeShortcuts()
  const seen = []
  desk.hookSource({ accel: 'Control+Alt+Space', codes: hk, globalShortcut: gs, hook: fakeHook({ fails: true }), onDown: () => seen.push('down'), onUp: () => seen.push('up') })
  gs.on.get('Control+Alt+Space')()
  ok(seen.join() === 'down,up', 'the hook can\'t start: a press is a tap (the page keeps listening until the next)', seen)
  const ts = fakeShortcuts()
  const tapped = []
  desk.shortcutSource({ accel: 'Control+Alt+Space', globalShortcut: ts, onDown: () => tapped.push('down'), onUp: () => tapped.push('up') })
  ts.on.get('Control+Alt+Space')()
  ok(tapped.join() === 'down,up', 'Wayland: each press is a tap')
}
{
  // The helper's lines, split anywhere, read the same.
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stdin = Object.assign(new EventEmitter(), { written: '', write(s) { this.written += s }, end() {} })
  child.kill = () => {}
  const seen = []
  let state = null
  const src = desk.helperSource({ bin: 'bridgekeys', code: 49, mods: 2048, spawnFn: (bin, args) => { seen.push(args.join(' ')); return child }, onState: (j) => { state = j }, onDown: (at, j) => seen.push(`down ${at} ${j.app}`), onUp: (at) => seen.push(`up ${at}`) })
  for (const part of ['{"ready":tr', 'ue}\n{"down":5,"app":"Safari","bundle":"com.apple.Safari","pid":1,"secure":false}\n{"u', 'p":9}\n']) child.stdout.emit('data', Buffer.from(part))
  ok(state?.ready && seen.join('|') === 'hotkey 49 2048|down 5 Safari|up 9', 'the Mac helper\'s lines, however they arrive', seen)
  src.press()
  ok(child.stdin.written === 'press\n', 'and a press made through its stdin')
}

// ---------- native/bridgekeys (a Mac) ----------
if (!IS_MAC) skip('native/bridgekeys', 'macOS only')
else if (spawnSync('swiftc', ['--version']).status !== 0 && !process.env.CI) skip('native/bridgekeys', 'no swiftc here (Xcode\'s command line tools)')
else {
  const bin = path.join(OUT, 'bin-dictation')
  fs.rmSync(bin, { recursive: true, force: true })
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'calltap.js'), bin, '--only', 'bridgekeys', '--strict'], { encoding: 'utf8' })
  const helper = path.join(bin, 'bridgekeys')
  const lipo = fs.existsSync(helper) ? spawnSync('lipo', ['-archs', helper], { encoding: 'utf8' }).stdout.trim() : ''
  ok(built.status === 0 && /arm64/.test(lipo) && /x86_64/.test(lipo), 'native/bridgekeys builds, for Apple silicon and Intel', `${built.stdout}${built.stderr}${lipo}`)
  if (fs.existsSync(helper)) {
    const front = spawnSync(helper, ['front'], { encoding: 'utf8', timeout: 10000 })
    let j = null
    try { j = JSON.parse(front.stdout.trim()) } catch { /* below */ }
    ok(front.status === 0 && j && typeof j.app === 'string' && typeof j.bundle === 'string' && Number.isInteger(j.pid) && typeof j.secure === 'boolean', 'bridgekeys front: the app in front and Secure Input, as JSON', front.stdout)
    // ⌃⌥⇧F13: nobody's key. Presses made through stdin go through the key's own handler.
    const lines = []
    let state = null
    const src = desk.helperSource({ bin: helper, code: 105, mods: 6656, onState: (s) => { state = s }, onDown: (at, d) => lines.push({ down: at, ...d }), onUp: (at) => lines.push({ up: at }) })
    await until(() => state, 10000, 100)
    ok(state?.ready === true, 'bridgekeys hotkey: the key is set, with no permission asked', state)
    for (const c of ['press', 'release', 'press', 'press', 'release']) { src[c](); await sleep(60) }
    await until(() => lines.length >= 4, 5000, 100)
    const shape = lines.map((l) => (l.down ? 'down' : 'up')).join()
    ok(shape === 'down,up,down,up', 'its presses and let-gos, a press while held not told twice', lines)
    ok(lines.every((l) => Number.isFinite(l.down || l.up) && Math.abs((l.down || l.up) - Date.now()) < 60000) && typeof lines[0]?.app === 'string' && typeof lines[0]?.secure === 'boolean', 'each with its time, and a press with the app in front', lines[0])
    src.stop()
    // ⌘Space is Spotlight's, unless it's been turned off on this Mac.
    const spot = spawnSync(helper, ['hotkey', '49', '256'], { encoding: 'utf8', timeout: 5000, input: '' })
    if (/"ready"/.test(spot.stdout)) skip('a key macOS has', 'Spotlight\'s ⌘Space is turned off on this Mac')
    else ok(/^\{"error":"taken","by":"macOS"\}/.test(spot.stdout.trim()) && spot.status === 1, 'a key macOS has (Spotlight\'s ⌘Space): taken, by macOS', spot.stdout)
    const bad = spawnSync(helper, ['hotkey', 'x'], { encoding: 'utf8', timeout: 5000 })
    ok(bad.status === 2, 'and nonsense is turned away')
  }
}

// ---------- The server: the names to spell, and the settings ----------
const kit = await startKit('dictation')
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/meetings/memory', { term: 'Northwind', heard: ['north wind'] })
  const w = await kit.api('/dictation/words')
  ok(['Claude Code', 'worktree', 'Chief of Staff', 'Northwind'].every((x) => w.terms.includes(x)), 'the server\'s names: its agents, models and words, and meeting memory', w.terms.slice(0, 30))
  ok(w.heard.some(([h, t]) => h === 'north wind' && t === 'Northwind'), 'and how meeting memory\'s names are misheard', w.heard)
  ok(JSON.stringify((await kit.api('/config')).dictation) === '{}', 'no dictation settings at first: everything as it comes')
  await kit.api('/settings', { dictation: { key: 'Control+Alt+D', cleanup: false } }, 'PATCH')
  const c = (await kit.api('/config')).dictation
  ok(c.key === 'Control+Alt+D' && c.cleanup === false, 'Settings › Voice saves them, and pages read them from /api/config', c)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
