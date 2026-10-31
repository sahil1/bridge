// Dictation's parts that need no browser, on any platform: the key (its default on each system,
// what it's called, macOS's and the keyboard hook's codes for it, matching it in the page), where the
// key works from other apps on each kind of machine (simulated: a Mac with and without the helper,
// Windows, X11, Wayland on GNOME, KDE and sway, Linux Arm, Docker and a browser), what GNOME needs of
// the desktop app (its Electron, an application ID GNOME accepts, a menu entry of that name, which
// install.sh puts in place), the light cleanup
// (fillers, doubled words, capitals, the full stop, names spelled the way they're written, files
// said aloud), and how the desktop app hears the key (desktop/dictation.js) with a stand-in keyboard
// hook and globalShortcut: held, tapped, a key repeating, X11's repeats, another app having it, no
// hook at all. Pasting where you're typing: where it can work (simulated per system and desktop),
// telling a terminal on X11, Windows' and X11's paste with a stand-in clipboard and hook (the text on
// the clipboard as Ctrl+V is pressed, what was there put back unless something was copied meanwhile,
// Ctrl+Shift+V in a terminal, Ctrl+V only once Ctrl, Alt and Shift are let go, and not at all while one
// stays down), the Mac helper's answers, wtype; and the desktop app's side with a Mac
// simulated (stand-in Electron and helper): nothing asked at start, Accessibility looked up without
// asking, asked once when picked, then System Settings; the dictation window's text pasted into the
// app the key was pressed in, refused without Accessibility or with the setting off; the window in the
// middle at the top, growing down and back with its top kept, clicks going through it but for the
// pill; the app's icon kept for the list of dictations (not with history off); Paste again from that
// list, into the app it was said in. On a Mac:
// native/bridgekeys builds for both chips, says what's in front, sets a key and prints its presses
// (made through its stdin, no real key), says when macOS has the key, and pastes into a pasteboard of
// the test's own (never a key pressed, never your clipboard): what was there back once it's read,
// every item and type; not when something was copied meanwhile; the text left when nothing read it;
// a password field or no Accessibility refused before touching anything.
// Then the server's names for it (/api/dictation/words) and its settings in /api/config.
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { ROOT, OUT, TEST, IS_MAC, IS_WIN, startKit, checks, until, sleep } from '../lib/harness.mjs'

const { ok, skip, done } = checks('dictation')
const keys = await import('../../shared/dictation/keys.js')
const { globalKey, pasteInto, isTerminal } = await import('../../shared/dictation/platform.js')
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

// ---------- Where pasting where you're typing works ----------
const P = (m) => pasteInto({ desktop: true, electron: 44, ...m })
const pastes = [
  ['macOS, Apple silicon', { platform: 'darwin', arch: 'arm64', helper: true }, 'bridgekeys', 'accessibility'],
  ['macOS, Intel', { platform: 'darwin', arch: 'x64', helper: true }, 'bridgekeys', 'accessibility'],
  ['macOS built without Xcode\'s tools', { platform: 'darwin', arch: 'arm64', helper: false }, null],
  ['Windows x64', { platform: 'win32', arch: 'x64', hook: true }, 'keytap', null],
  ['Windows with the hook not loading', { platform: 'win32', arch: 'x64', hook: false }, null],
  ['Linux x64, X11', { platform: 'linux', arch: 'x64', hook: true }, 'keytap', null],
  ['Linux x64, X11, without libXtst', { platform: 'linux', arch: 'x64', hook: false }, null],
  ['Linux Arm, X11', { platform: 'linux', arch: 'arm64', hook: false }, null],
  ['Wayland, Hyprland, with wtype', { platform: 'linux', arch: 'x64', wayland: true, session: 'Hyprland', portal: true, wtype: true }, 'wtype', null],
  ['Wayland, Hyprland, without wtype', { platform: 'linux', arch: 'x64', wayland: true, session: 'Hyprland', portal: true, wtype: false }, null],
  ['Wayland, GNOME (Electron 45), wtype installed', { platform: 'linux', arch: 'x64', wayland: true, session: 'ubuntu:GNOME', portal: true, electron: 45, wtype: true }, null],
  ['Wayland, KDE, wtype installed', { platform: 'linux', arch: 'x64', wayland: true, session: 'KDE', portal: true, wtype: true }, null],
  ['Wayland, sway (no key from other apps)', { platform: 'linux', arch: 'x64', wayland: true, session: 'sway', portal: false, wtype: true }, null],
]
for (const [name, m, via, asks] of pastes) {
  const p = P(m)
  ok(via ? p.can && p.via === via && p.asks === asks : !p.can && !!p.why, `${name}: ${via ? `pasted where you're typing (${via}${asks ? `, asks for ${asks} when picked` : ', nothing to allow'})` : 'no pasting (hidden)'}`, p)
}
const away = [pasteInto({ desktop: false, platform: 'darwin', helper: true }), pasteInto({ desktop: false, platform: 'linux', hook: true })]
ok(away.every((p) => !p.can && /desktop app/.test(p.why || '')), 'Docker, a browser and a phone: no pasting into other apps (only the desktop app hears the key there)', away)
ok(P({ platform: 'win32', hook: true }).limit === 'admin' && !P({ platform: 'darwin', helper: true }).limit, 'Windows says it can\'t paste into an app running as administrator')
ok(['WM_CLASS(STRING) = "gnome-terminal-server", "Gnome-terminal"', '"konsole", "konsole"', '"kitty", "kitty"', '"Alacritty", "Alacritty"', '"xfce4-terminal", "Xfce4-terminal"', '"org.wezfurlong.wezterm", "org.wezfurlong.wezterm"', '"tilix", "Tilix"'].every(isTerminal) && !['"Navigator", "firefox"', '"code", "Code"', '"slack", "Slack"', '"gedit", "Gedit"', null].some(isTerminal), 'X11: a terminal told by its window\'s class')

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

// ---------- How the desktop app pastes ----------
// A clipboard like Electron's: text, HTML, RTF and a picture.
const fakeClipboard = (init = {}) => {
  const c = { s: { ...init } }
  c.readText = () => c.s.text || ''
  c.readHTML = () => c.s.html || ''
  c.readRTF = () => c.s.rtf || ''
  c.readImage = () => ({ isEmpty: () => !c.s.image, id: c.s.image })
  c.writeText = (text) => { c.s = { text } }
  c.write = (o) => { c.s = { ...o, image: o.image?.id } }
  c.clear = () => { c.s = {} }
  return c
}
{
  const cb = fakeClipboard({ text: 'what you had copied', html: '<b>what you had copied</b>', image: 'logo.png' })
  const taps = []
  const r = await desk.keyPaste({ text: 'Dictated.', clipboard: cb, hook: { keyTap: (k, mods) => taps.push({ k, mods, on: cb.readText() }) }, wait: 30 })
  ok(taps.length === 1 && taps[0].k === 47 && taps[0].mods.join() === '29' && taps[0].on === 'Dictated.', 'Windows/X11: the text on the clipboard as Ctrl+V is pressed', taps)
  ok(r.pasted && r.restored && cb.readText() === 'what you had copied' && cb.readHTML() === '<b>what you had copied</b>' && cb.s.image === 'logo.png', 'then what was there put back: its text, formatting and picture', cb.s)
}
{
  const cb = fakeClipboard({ text: 'old' })
  const r = await desk.keyPaste({ text: 'Dictated.', clipboard: cb, hook: { keyTap: () => setTimeout(() => cb.writeText('copied meanwhile'), 5) }, wait: 40 })
  ok(r.pasted && !r.restored && cb.readText() === 'copied meanwhile', 'something copied meanwhile stays', cb.s)
  const empty = fakeClipboard()
  const taps = []
  await desk.keyPaste({ text: 'git status', clipboard: empty, hook: { keyTap: (k, mods) => taps.push(mods.join()) }, terminal: true, wait: 10 })
  ok(taps[0] === '29,42' && empty.readText() === '', 'a terminal: Ctrl+Shift+V; a clipboard that was empty is empty again', taps)
  const kept = fakeClipboard({ text: 'kept' })
  ok((await desk.keyPaste({ text: 'x', clipboard: kept, hook: null })).error === 'failed' && kept.readText() === 'kept', 'no keyboard hook: nothing pasted, the clipboard untouched')
}
{
  // Windows/X11: Ctrl+V waits until no modifier is held (the key's own Ctrl and Alt, still down after
  // its Space was let go, or Shift pressed meanwhile), and isn't pressed at all if one stays down.
  const gs = fakeShortcuts()
  const hook = Object.assign(fakeHook(), { taps: [] })
  hook.keyTap = (k, mods) => hook.taps.push(mods.join())
  const src = desk.hookSource({ accel: 'Control+Alt+Space', codes: hk, globalShortcut: gs, hook, modOf: keys.hookMod, linger: 400, onDown: () => {}, onUp: () => {} })
  const ready = (ms) => () => src.modsUp?.(ms) ?? true
  gs.on.get('Control+Alt+Space')()
  hook.emit('keyup', { keycode: 0x39 }) // Space let go first
  const listening = hook.running
  const cb = fakeClipboard({ text: 'old' })
  const pasting = desk.keyPaste({ text: 'Dictated.', clipboard: cb, hook, wait: 10, ready: ready(1500) })
  await sleep(60)
  const early = [hook.taps.length, cb.readText()]
  hook.emit('keyup', { keycode: 0x1d }) // Ctrl
  await sleep(40)
  const mid = hook.taps.length
  hook.emit('keyup', { keycode: 0x38 }) // Alt
  const r = await pasting
  ok(listening && early.join() === '0,old' && mid === 0 && hook.taps.join('|') === '29' && r.pasted && !hook.running, 'Windows/X11: Ctrl and Alt still down after the key\'s let-go: Ctrl+V waits (the clipboard untouched) until both are up, then the hook stops listening', { listening, early, mid, taps: hook.taps, r })
  gs.on.get('Control+Alt+Space')()
  hook.emit('keyup', { keycode: 0x39 })
  hook.emit('keydown', { keycode: 0x2a }) // Shift, pressed meanwhile
  hook.emit('keyup', { keycode: 0x1d }); hook.emit('keyup', { keycode: 0x38 })
  const more = desk.keyPaste({ text: 'Dictated.', clipboard: fakeClipboard(), hook, wait: 10, ready: ready(1500) })
  await sleep(60)
  const beforeShift = hook.taps.length
  hook.emit('keyup', { keycode: 0x2a })
  ok(beforeShift === 1 && (await more).pasted && hook.taps.length === 2, 'a modifier pressed meanwhile (Shift) is waited for too', { beforeShift, taps: hook.taps })
  gs.on.get('Control+Alt+Space')()
  hook.emit('keyup', { keycode: 0x39 })
  hook.emit('keyup', { keycode: 0x38 }) // Ctrl stays down
  const cb2 = fakeClipboard({ text: 'kept' })
  const t0 = Date.now()
  const r2 = await desk.keyPaste({ text: 'Dictated.', clipboard: cb2, hook, wait: 10, ready: ready(300) })
  ok(r2.error === 'held' && hook.taps.length === 2 && cb2.readText() === 'kept' && Date.now() - t0 >= 250 && !hook.running, 'still held after the wait: not pasted (held), the clipboard untouched, no key let go for you, and the hook stops listening', { r2, taps: hook.taps })
  gs.on.get('Control+Alt+Space')()
  hook.emit('keyup', { keycode: 0x39 })
  const lingering = hook.running
  await sleep(500)
  ok(lingering && !hook.running, 'a modifier never heard let go: the hook stops listening anyway, a moment after the key\'s let-go', { lingering, running: hook.running })
  src.stop()
}
{
  const calls = []
  const cls = await desk.activeClass(async (cmd, args) => { calls.push(`${cmd} ${args.join(' ')}`); return args[0] === '-root' ? '_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00007\n' : 'WM_CLASS(STRING) = "kitty", "kitty"\n' })
  const none = await desk.activeClass(async () => null)
  ok(isTerminal(cls) && calls[1] === 'xprop -id 0x3a00007 WM_CLASS' && none === null, 'X11: the window in front asked of xprop (not known without it: Ctrl+V)', calls)
  let got = null
  const typed = await desk.typeIn({ text: 'Hello.', execFn: (cmd, args, o, cb) => { got = [cmd, ...args]; cb(null) } })
  ok(typed.pasted && got.join(' ') === 'wtype -- Hello.', 'Wayland: typed in by wtype', got)
}
{
  // The Mac's helper: its arguments, the text on its stdin, its one line back.
  const child = (out, code = 0) => {
    const c = new EventEmitter()
    c.stdout = new EventEmitter()
    c.stdin = Object.assign(new EventEmitter(), { got: null, end(s) { this.got = s; setTimeout(() => { c.stdout.emit('data', Buffer.from(out)); c.emit('exit', code) }, 5) } })
    c.kill = () => {}
    return c
  }
  let last = null
  const run = (out, code, pid) => desk.helperPaste({ bin: 'bridgekeys', text: 'Hi there.', pid, spawnFn: (bin, args) => { last = { args, c: child(out, code) }; return last.c } })
  const r = await run('{"pasted":true,"read":true,"restored":true}\n', 0, 321)
  ok(r.pasted && r.restored && last?.args.join(' ') === 'paste --pid 321' && last.c.stdin.got === 'Hi there.', 'a Mac: bridgekeys paste, told the app the key was pressed in, the text on its stdin', last?.args)
  ok((await run('{"error":"secure"}\n', 1)).error === 'secure' && last?.args.join(' ') === 'paste', 'a password field: said so')
  const moved = await run('{"error":"moved","app":"Safari","pid":9}\n', 1, 5)
  ok(moved.error === 'moved' && moved.app === 'Safari', 'another app in front by then: said so, with which', moved)
  ok((await run('nonsense', 1)).error === 'failed', 'anything else: it failed')
}
// The desktop app's side, with a Mac simulated (Electron and the helper stood in for, so it runs on
// any computer): what Settings is told, the Accessibility question, and the dictation window's paste.
if (IS_WIN) skip('the desktop app pasting, a Mac simulated', 'its stand-in helper is a shell script')
else {
  const bin = path.join(OUT, 'bin-dictation-paste')
  fs.rmSync(bin, { recursive: true, force: true })
  fs.mkdirSync(bin, { recursive: true })
  const helper = path.join(bin, 'bridgekeys')
  fs.writeFileSync(helper, `#!/bin/sh\nexec "${process.execPath}" "${path.join(TEST, 'stand-ins', 'bridgekeys.cjs')}" "$@"\n`, { mode: 0o755 })
  const data = path.join(bin, 'data')
  fs.mkdirSync(data)
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ dictation: { background: true, to: 'paste' } }))
  const log = path.join(bin, 'pasted.log')
  const pasted = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const handlers = {}
  const call = (name, ...a) => handlers[name]?.(...a)
  const asked = []
  const opened = []
  const tiles = []
  let allowed = false
  let hud = null
  class Win {
    static getFocusedWindow() { return null }
    constructor(o) { hud = this; this.shown = false; this.made = o; this.bounds = { x: o.x, y: o.y, width: o.width, height: o.height }; this.through = []; this.told = []; this.webContents = { setWindowOpenHandler() {}, on() {}, isDestroyed: () => false, executeJavaScript: async (js) => { this.told.push(js) } } }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setContentProtection() {} on() {} loadURL() {}
    setBounds(b) { this.bounds = { ...b } }
    getBounds() { return { ...this.bounds } }
    setIgnoreMouseEvents(on, o) { this.through.push([on, !!o?.forward]) }
    once(ev, fn) { if (ev === 'ready-to-show') fn() }
    showInactive() { this.shown = true }
    hide() { this.shown = false }
    isVisible() { return this.shown }
    isDestroyed() { return false }
    isFocused() { return false }
    getContentSize() { return [this.bounds.width, this.bounds.height] }
  }
  // The icon of the app the key was pressed in, as macOS would give it; and Bridge AI stepping back.
  const thumbs = []
  let hidden = 0
  const electron = {
    BrowserWindow: Win, globalShortcut: fakeShortcuts(), clipboard: fakeClipboard(),
    nativeImage: { createThumbnailFromPath: async (p) => { thumbs.push(p); return { isEmpty: () => false, toPNG: () => Buffer.from('png of TextEdit') } } },
    app: { hide: () => { hidden++ } },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    ipcMain: { handle: (n, fn) => { handlers[n] = fn }, on: (n, fn) => { handlers[n] = fn } },
    systemPreferences: { isTrustedAccessibilityClient: (prompt) => { if (prompt) asked.push(prompt); return allowed } },
    shell: { openExternal: async (u) => { opened.push(u) } },
  }
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  const env = { BRIDGE_KEYS: process.env.BRIDGE_KEYS, BRIDGEKEYS_PRESS: process.env.BRIDGEKEYS_PRESS, BRIDGEKEYS_LOG: process.env.BRIDGEKEYS_LOG }
  Object.assign(process.env, { BRIDGE_KEYS: helper, BRIDGEKEYS_PRESS: '1', BRIDGEKEYS_LOG: log })
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
  const me = { own: true }
  const brought = []
  try {
    await desk.start({ electron, ROOT, DATA: data, URL_BASE: 'http://127.0.0.1:9', preload: '', isOurs: () => false, tellMain: async () => {}, askAccess: (pane) => tiles.push(pane), trusted: (e) => e.own === true, openApp: async (b) => { brought.push(b) } })
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
  try {
    const st = await call('bridge:dictate-status', me)
    ok(st.paste?.can && st.paste.via === 'bridgekeys' && st.paste.asks === 'accessibility' && st.paste.allowed === false && !asked.length && !tiles.length, 'a Mac (simulated): pasting can work and needs Accessibility, and nothing was asked when the app started', st.paste)
    ok(await call('bridge:paste-access', me) === 'denied' && !asked.length, 'whether it\'s allowed is looked up without asking')
    ok(await call('bridge:paste-ask', { own: false }) === null && !asked.length, 'a page that isn\'t the app\'s own can\'t make it ask')
    ok(await call('bridge:paste-ask', me) === 'asked' && asked.length === 1 && tiles.join() === 'accessibility' && !opened.length, 'picked: macOS asks (it lists Bridge AI under Accessibility), and the tile says what to do', { asked, tiles, opened })
    ok(await call('bridge:paste-ask', me) === 'asked' && asked.length === 1 && /Privacy_Accessibility$/.test(opened[0] || ''), 'Allow access again: System Settings at Accessibility, without macOS asking again', opened)
    // The key, pressed in TextEdit (the stand-in helper presses it): the dictation window, told which app.
    await until(() => hud?.shown, 5000, 50)
    const from = { sender: hud?.webContents }
    const first = await call('bridge:hud-ready', from)
    ok(!!hud?.shown && first?.down > 0 && first.app === 'TextEdit' && first.bundle === 'com.apple.TextEdit', 'the key pressed in another app: the dictation window, told it was TextEdit (and its bundle ID, for the history)', first)
    // The pill's window: in the middle at the top, under the menu bar, clicks going through it.
    ok(hud.made.width === 420 && hud.made.x === 510 && hud.made.y === 2 && JSON.stringify(hud.through[0]) === '[true,true]', 'the dictation window: in the middle at the top of the screen, clicks going through it', { made: { x: hud.made.x, y: hud.made.y, width: hud.made.width }, through: hud.through })
    call('bridge:hud-size', from, 420, 260)
    const grown = hud.getBounds()
    call('bridge:hud-size', from, 999, 80)
    const shrunk = hud.getBounds()
    ok(grown.x === 510 && grown.y === 2 && grown.width === 420 && grown.height === 260 && shrunk.x === 510 && shrunk.y === 2 && shrunk.width === 420 && shrunk.height === 80, 'it grows down and back, keeping its top, its middle and its width', { grown, shrunk })
    call('bridge:hud-pointer', from, true)
    call('bridge:hud-pointer', from, false)
    call('bridge:hud-pointer', me, true)
    ok(JSON.stringify(hud.through.slice(-2)) === '[[false,true],[true,true]]', 'the pointer on the pill: clicks are the window\'s, and go through again once it leaves (only the window itself can say so)', hud.through)
    const iconFile = path.join(data, 'dictations', 'icons', 'com.apple.TextEdit.png')
    ok(!!(await until(() => fs.existsSync(iconFile), 3000, 50)) && fs.readFileSync(iconFile, 'utf8') === 'png of TextEdit' && thumbs[0] === '/System/Applications/TextEdit.app', 'the app\'s icon, asked of macOS and kept in the data folder for the list of dictations', thumbs)
    ok((await call('bridge:hud-paste', from, 'Hello there.'))?.error === 'accessibility' && !pasted().length, 'without Accessibility: not pasted, nothing sent to the helper')
    allowed = true
    ok(await call('bridge:paste-access', me) === 'ok' && (await call('bridge:dictate-status', me))?.paste?.allowed && await call('bridge:paste-ask', me) === 'ok' && asked.length === 1, 'turned on in System Settings: allowed, and nothing more is asked')
    const r = await call('bridge:hud-paste', from, 'Hello there.')
    const p = pasted().at(-1)
    ok(r?.pasted && p?.text === 'Hello there.' && p.args.join(' ') === '--pid 4242', 'the text pasted by the helper, into the app the key was pressed in (TextEdit\'s pid)', { r, p })
    ok((await call('bridge:hud-paste', me, 'not from the window'))?.error === 'off' && pasted().length === 1, 'only the dictation window can ask for a paste')
    // Paste again, from the list of dictations: into the app it was said in.
    ok((await call('bridge:dictate-repaste', { own: false }, { text: 'Again.', bundle: 'com.apple.TextEdit' }))?.error === 'off' && !brought.length, 'Paste again: only from the app\'s own page')
    const again = await call('bridge:dictate-repaste', me, { text: 'Again.', bundle: 'com.apple.TextEdit' })
    ok(again?.pasted && brought.join() === 'com.apple.TextEdit' && pasted().at(-1)?.text === 'Again.' && pasted().at(-1).args.join(' ') === '--pid 4242', 'Paste again: that app brought to the front, then the words pasted into it', { again, brought, last: pasted().at(-1) })
    const unknown = await call('bridge:dictate-repaste', me, { text: 'Where I was.' })
    ok(unknown?.pasted && hidden === 1 && brought.length === 1, 'with no app known: Bridge AI steps back, and it goes where you were before', { unknown, hidden })
    allowed = false
    ok((await call('bridge:dictate-repaste', me, { text: 'Not allowed.' }))?.error === 'accessibility' && pasted().length === 3, 'not without Accessibility')
    allowed = true
    await call('bridge:dictate-configure', me, { background: true, to: 'last' })
    ok((await call('bridge:hud-paste', from, 'Hello again.'))?.error === 'off' && pasted().length === 3, 'with the text going to an agent instead: nothing pasted')
    // History off: no icon kept (the stand-in helper presses the key again as it starts).
    fs.rmSync(iconFile, { force: true })
    thumbs.length = 0
    const told = hud.told.length
    await call('bridge:dictate-configure', me, { background: true, to: 'last', history: false })
    await until(() => hud.told.slice(told).some((js) => js.includes('"type":"down"')), 3000, 50)
    await sleep(500)
    ok(hud.told.slice(told).some((js) => js.includes('"bundle":"com.apple.TextEdit"')) && !fs.existsSync(iconFile) && !thumbs.length, 'with history off: the key pressed in TextEdit again, and no icon kept', hud.told.slice(told))
  } catch (e) {
    ok(false, `the desktop app pasting crashed: ${e.stack}`)
  } finally {
    await handlers['bridge:dictate-configure']?.(me, { background: false })
    for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v }
  }
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

    // Pasting, into a pasteboard of the test's own: --test presses nothing and says where it would
    // have, then waits for something to read it (here, bridgekeys board read, as an app pasting does).
    const B = `dev.bridge-ai.test.${process.pid}`
    const board = (cmd, input = '') => { const r = spawnSync(helper, ['board', cmd, '--board', B], { input, encoding: 'utf8', timeout: 10000 }); try { return JSON.parse(r.stdout.trim()) } catch { return { out: r.stdout, status: r.status } } }
    const paste = (text, extra = [], onPosted) => new Promise((resolve) => {
      const p = spawn(helper, ['paste', '--test', '--board', B, ...extra], { stdio: ['pipe', 'pipe', 'ignore'] })
      const lines = []
      let buf = ''
      p.stdout.on('data', (d) => {
        buf += d
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          let l = null
          try { l = JSON.parse(buf.slice(0, i)) } catch { /* not a line of ours */ }
          buf = buf.slice(i + 1)
          if (l) lines.push(l)
          if (l?.posted) onPosted?.()
        }
      })
      p.on('exit', (code) => resolve({ code, lines, last: lines.at(-1) }))
      p.stdin.end(text)
    })
    try {
      board('write', 'what you had copied')
      const before = board('read')
      let during = null
      const r = await paste('Dictated text.', ['--wait', '5000'], () => { during = board('read') })
      ok(Number.isInteger(r.lines[0]?.key) && r.lines[0].key >= 0 && r.lines[0].key < 128, 'bridgekeys paste: ⌘V with the key that types V in this keyboard layout (not pressed in a test)', r.lines[0])
      ok(during?.text === 'Dictated text.' && during.types.includes('org.nspasteboard.TransientType'), 'while it pastes, the text is what the app in front reads, marked for clipboard managers to skip', during)
      const after = board('read')
      ok(r.code === 0 && r.last?.pasted && r.last.read && r.last.restored && after.text === before.text && after.items === 2 && after.types.includes('dev.bridge-ai.test.extra'), 'read: what was there before put back, every item and every type', { r: r.last, before, after })
      const meanwhile = await paste('Second.', ['--wait', '5000', '--settle', '1500'], () => { board('read'); board('write', 'copied meanwhile') })
      ok(meanwhile.last?.read && !meanwhile.last.restored && board('read').text.startsWith('copied meanwhile'), 'something copied meanwhile stays', meanwhile.last)
      const unread = await paste('Nobody took this.', ['--wait', '300'])
      const left = board('read')
      ok(unread.last?.pasted && !unread.last.read && !unread.last.restored && left.text === 'Nobody took this.' && !left.types.includes('org.nspasteboard.TransientType'), 'nothing read it: the text stays on the clipboard, to paste by hand', { r: unread.last, left })
      board('write', 'kept')
      const was = board('read').change
      const secure = await paste('x', ['--as', 'secure'])
      const untrusted = await paste('x', ['--as', 'untrusted'])
      const moved = await paste('x', ['--as', 'moved'])
      ok(secure.code === 1 && secure.last?.error === 'secure' && untrusted.last?.error === 'accessibility' && moved.last?.error === 'moved' && typeof moved.last.app === 'string' && board('read').change === was, 'a password field, no Accessibility, another app in front: refused, the clipboard untouched', [secure.last, untrusted.last, moved.last])
      const general = spawnSync(helper, ['board', 'read', '--board', 'Apple CFPasteboard general'], { encoding: 'utf8', timeout: 5000 })
      ok(general.status === 2 && /"board"/.test(general.stdout), 'the test commands won\'t touch any pasteboard but a test\'s own', general.stdout)
    } finally {
      board('free')
    }
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
