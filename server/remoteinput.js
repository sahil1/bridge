// Mouse and keyboard from another of your devices (Remote Screen and Preview, server/remote.js), and
// the clipboard both ways. What presses them is what "Where I'm typing" already uses where it can
// (desktop/dictation.js), so nothing new is installed:
//   a Mac          native/bridgekeys control: CGEvents, which need Accessibility, the same
//                  permission pasting where you're typing needs (asked when you turn control on,
//                  never before). It also watches for someone at this Mac (a listen-only event tap,
//                  which Accessibility covers), so remote input waits while they use it.
//   Windows        SendInput, from a small PowerShell helper (Windows' own; nothing to install). It
//                  watches the same way, with low-level hooks that tell injected input from a
//                  person's. uiohook-napi, which pastes there, presses keys only, not the mouse.
//   Linux (X11)    xdotool, when it's installed (it says so when it isn't); someone moving the mouse
//                  is seen by where the pointer is.
//   Wayland        not available: it lets no app move the pointer or press keys for others.
// Each helper gets one line of JSON per action: { t: 'move', x, y } (a point on the whole desktop),
// { t: 'down'|'up', b, x, y }, { t: 'wheel', dx, dy }, { t: 'key', k, down } (that system's key code),
// { t: 'text', s }; and says { ready: true } or { error }, then { local: <ms> } whenever someone at
// the computer moves the mouse or presses a key.
//
// Tests stand in for all of it: BRIDGE_TEST_INPUT=<file> writes each action there as a line of JSON
// (touching <file>.local is someone at the computer), BRIDGE_TEST_CLIPBOARD=<file> is the clipboard.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { ROOT, IS_MAC, IS_WIN } from './paths.js'
import { which } from './agents.js'
import { keyFor, WIN_EXTENDED, MODIFIERS } from '../shared/remote.js'

const TEST_INPUT = process.env.BRIDGE_TEST_INPUT || ''
const TEST_CLIP = process.env.BRIDGE_TEST_CLIPBOARD || ''
const HELPER = process.env.BRIDGE_KEYS || path.join(ROOT, 'native', 'bin', 'bridgekeys')
const wayland = () => !!process.env.WAYLAND_DISPLAY && process.env.XDG_SESSION_TYPE !== 'x11'
const x11 = () => !!process.env.DISPLAY

// ---------- what can work here ----------
// { can, via, why, asks } now, and allowed (whether the system lets it press keys) when it asks.
let xdotool = null
const findXdotool = async () => (xdotool ??= !!(await which('xdotool').catch(() => null)))
let access = { at: 0, allowed: null }
export async function status({ fresh = false } = {}) {
  if (TEST_INPUT) return { can: true, via: 'test', allowed: true }
  if (IS_MAC) {
    if (!fs.existsSync(HELPER)) return { can: false, via: 'bridgekeys', why: "native/bin/bridgekeys isn't in this build (it needs Xcode's command line tools)" }
    if (fresh || Date.now() - access.at > 10000) access = { at: Date.now(), allowed: await askHelper(['control-access']).then((j) => !!j?.allowed, () => null) }
    return { can: true, via: 'bridgekeys', asks: 'accessibility', allowed: access.allowed }
  }
  if (IS_WIN) return { can: true, via: 'sendinput', allowed: true }
  if (wayland() && !x11()) return { can: false, via: null, why: "This computer's desktop is Wayland, which lets no app move the pointer or press keys for another, so it can be viewed but not controlled." }
  if (!x11()) return { can: false, via: null, why: 'There\'s no desktop on this computer to control (no display).' }
  if (!(await findXdotool())) return { can: false, via: 'xdotool', why: 'Install xdotool to control this computer from your other devices (sudo apt install xdotool, or your system\'s package), then turn this on again.' }
  return { can: true, via: 'xdotool', allowed: true }
}
const askHelper = (args) => new Promise((resolve, reject) => execFile(HELPER, args, { timeout: 8000 }, (err, out) => {
  try { resolve(JSON.parse(String(out).trim().split('\n').pop())) } catch { reject(err || new Error('no answer')) }
}))

// ---------- pressing ----------
// start({ onLocal, onError }): a sink for one or more sessions. send(ev, bounds): ev as
// shared/remote.js cleanInput gives it, bounds the screen it's on ({ x, y, width, height } in the
// system's own points: on Windows its pixels, px). releaseAll(): every key and button let go.
export function start({ onLocal = () => {}, onError = () => {} } = {}) {
  const held = { keys: new Set(), buttons: new Set() }
  const at = (ev, b) => {
    const r = b?.px || b || { x: 0, y: 0, width: 1, height: 1 }
    return { x: Math.round(r.x + ev.x * Math.max(1, r.width - 1)), y: Math.round(r.y + ev.y * Math.max(1, r.height - 1)) }
  }
  const os = TEST_INPUT ? 'test' : IS_MAC ? 'mac' : IS_WIN ? 'windows' : 'linux'
  const out = os === 'test' ? testWriter(onLocal) : os === 'mac' ? helperWriter(HELPER, ['control'], onLocal, onError) : os === 'windows' ? powershellWriter(onLocal, onError) : xdotoolWriter(onLocal, onError)
  // One action, in that system's own words.
  const word = (ev, b) => {
    if (ev.t === 'move') return { t: 'move', ...at(ev, b) }
    if (ev.t === 'down' || ev.t === 'up') return { t: ev.t, b: ev.b, ...at(ev, b) }
    if (ev.t === 'wheel') return { t: 'wheel', dx: ev.dx, dy: ev.dy, ...(ev.x == null ? {} : at(ev, b)) }
    if (ev.t === 'key') return { t: 'key', k: keyFor(ev.code, os === 'test' ? 'mac' : os), code: ev.code, down: ev.down, ...(os === 'windows' && WIN_EXTENDED.has(ev.code) ? { ext: 1 } : {}) }
    if (ev.t === 'text') return { t: 'text', s: ev.s }
    return null
  }
  const send = (ev, b) => {
    const w = word(ev, b)
    if (!w) return
    if (ev.t === 'key') { if (ev.down) held.keys.add(ev.code); else held.keys.delete(ev.code) }
    if (ev.t === 'down') held.buttons.add(ev.b)
    if (ev.t === 'up') held.buttons.delete(ev.b)
    out.write(w)
  }
  // Nothing left pressed: a session that ends, or pauses for someone at the computer, lets go of
  // every key and button it was holding (a ⌘ left down would turn their typing into shortcuts).
  const releaseAll = (b) => {
    for (const code of [...held.keys].sort((x, y) => MODIFIERS.has(x) - MODIFIERS.has(y))) out.write({ t: 'key', k: keyFor(code, os === 'test' ? 'mac' : os), code, down: false, ...(os === 'windows' && WIN_EXTENDED.has(code) ? { ext: 1 } : {}) })
    for (const btn of held.buttons) out.write({ t: 'up', b: btn, ...(out.last || at({ x: 0.5, y: 0.5 }, b)) })
    held.keys.clear()
    held.buttons.clear()
  }
  return { send, releaseAll, stop: () => { try { releaseAll() } catch { /* gone */ } out.stop() }, os }
}

// The tests' stand-in: each action a line in the file; <file>.local touched is someone here.
function testWriter(onLocal) {
  let stopped = false
  const local = `${TEST_INPUT}.local`
  let seen = (() => { try { return fs.statSync(local).mtimeMs } catch { return 0 } })()
  const timer = setInterval(() => {
    let m = 0
    try { m = fs.statSync(local).mtimeMs } catch { return }
    if (m > seen) { seen = m; onLocal() }
  }, 100)
  timer.unref?.()
  return {
    write: (w) => { if (!stopped) fs.appendFileSync(TEST_INPUT, `${JSON.stringify({ ...w, at: Date.now() })}\n`) },
    stop: () => { stopped = true; clearInterval(timer) },
  }
}

// A helper that reads actions on stdin (bridgekeys control, or PowerShell's), started once and kept
// while anything controls this computer.
function helperWriter(bin, args, onLocal, onError, opts = {}) {
  let p = null
  let buf = ''
  let dead = false
  const begin = () => {
    p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, ...opts })
    p.stdout.on('data', (d) => {
      buf += d
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        let j
        try { j = JSON.parse(line) } catch { continue }
        if (j.local) onLocal()
        else if (j.error) onError(j.error === 'accessibility' ? 'accessibility' : String(j.error))
      }
    })
    p.on('error', (e) => { dead = true; onError(e.message) })
    p.on('exit', (code) => { if (!dead && code) onError(`the input helper stopped (${code})`); p = null })
    p.stdin.on('error', () => {})
  }
  begin()
  const self = {
    last: null,
    write: (w) => {
      if (!p) begin()
      if (w.x != null) self.last = { x: w.x, y: w.y }
      try { p.stdin.write(`${JSON.stringify(w)}\n`) } catch { /* restarting */ }
    },
    stop: () => { dead = true; try { p?.stdin.end() } catch { /* gone */ } setTimeout(() => { try { p?.kill() } catch { /* gone */ } }, 500) },
  }
  return self
}

// Windows: SendInput, with low-level hooks for someone at the computer (input that isn't injected).
const PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Threading; using System.IO;
public static class BridgeInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr h; public uint m; public IntPtr w, l; public uint t; public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct LL { public uint a, b, flags, time; public IntPtr extra; }
  delegate IntPtr Hook(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Hook fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  static Hook mouse, keys; static long said;
  static void Say(string s) { lock (Console.Out) { Console.Out.WriteLine(s); Console.Out.Flush(); } }
  static void Local(IntPtr l, uint injected) {
    LL e = (LL)Marshal.PtrToStructure(l, typeof(LL));
    if ((e.flags & injected) != 0) return;
    long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    if (now - said > 250) { said = now; Say("{\"local\":" + now + "}"); }
  }
  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static void Mouse(uint flags, int x, int y, uint data) {
    INPUT i = new INPUT(); i.type = 0;
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = Math.Max(1, GetSystemMetrics(78) - 1), vh = Math.Max(1, GetSystemMetrics(79) - 1);
    i.u.mi.dx = (int)((x - vx) * 65535L / vw); i.u.mi.dy = (int)((y - vy) * 65535L / vh);
    i.u.mi.dwFlags = flags | 0x8000 | 0x4000 | 0x0001; i.u.mi.mouseData = data; Send(i);
  }
  static void Key(ushort vk, bool down, bool ext, ushort scan, uint more) {
    INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan;
    i.u.ki.dwFlags = (down ? 0u : 2u) | (ext ? 1u : 0u) | more; Send(i);
  }
  static string Field(string line, string name) {
    int a = line.IndexOf("\"" + name + "\":"); if (a < 0) return null; a += name.Length + 3;
    if (line[a] == '"') { var sb = new System.Text.StringBuilder(); for (int i = a + 1; i < line.Length; i++) { char c = line[i]; if (c == '\\' && i + 1 < line.Length) { char n = line[++i]; if (n == 'n') sb.Append('\n'); else if (n == 't') sb.Append('\t'); else if (n == 'u') { sb.Append((char)Convert.ToInt32(line.Substring(i + 1, 4), 16)); i += 4; } else sb.Append(n); } else if (c == '"') break; else sb.Append(c); } return sb.ToString(); }
    int b = a; while (b < line.Length && line[b] != ',' && line[b] != '}') b++; return line.Substring(a, b - a);
  }
  static int Num(string line, string name) { string v = Field(line, name); double d; return v != null && double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out d) ? (int)d : 0; }
  static void Act(string line) {
    string t = Field(line, "t");
    uint[] downs = { 0x0002, 0x0020, 0x0008 }, ups = { 0x0004, 0x0040, 0x0010 };
    if (t == "move") Mouse(0, Num(line, "x"), Num(line, "y"), 0);
    else if (t == "down") Mouse(downs[Math.Min(2, Num(line, "b"))], Num(line, "x"), Num(line, "y"), 0);
    else if (t == "up") Mouse(ups[Math.Min(2, Num(line, "b"))], Num(line, "x"), Num(line, "y"), 0);
    else if (t == "wheel") {
      INPUT i = new INPUT(); i.type = 0; int dy = -Num(line, "dy"), dx = Num(line, "dx");
      if (dy != 0) { i.u.mi.dwFlags = 0x0800; i.u.mi.mouseData = (uint)dy; Send(i); }
      if (dx != 0) { i.u.mi.dwFlags = 0x1000; i.u.mi.mouseData = (uint)dx; Send(i); }
    }
    else if (t == "key") Key((ushort)Num(line, "k"), Field(line, "down") == "true", Field(line, "ext") == "1", 0, 0);
    else if (t == "text") { string s = Field(line, "s") ?? ""; foreach (char c in s) { Key(0, true, false, c, 4); Key(0, false, false, c, 4); } }
  }
  public static void Run() {
    SetProcessDPIAware();
    new Thread(() => { string line; while ((line = Console.In.ReadLine()) != null) { try { Act(line); } catch { } } Environment.Exit(0); }) { IsBackground = true }.Start();
    mouse = (c, w, l) => { if (c >= 0) Local(l, 1); return CallNextHookEx(IntPtr.Zero, c, w, l); };
    keys = (c, w, l) => { if (c >= 0) Local(l, 0x10); return CallNextHookEx(IntPtr.Zero, c, w, l); };
    IntPtr me = GetModuleHandle(null);
    SetWindowsHookEx(14, mouse, me, 0); SetWindowsHookEx(13, keys, me, 0);
    Say("{\"ready\":true}");
    MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
  }
}
'@
[BridgeInput]::Run()
`
// The script goes as PowerShell's command (encoded), so stdin carries the actions alone.
const powershellWriter = (onLocal, onError) => helperWriter('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')], onLocal, onError)

// X11: xdotool, the actions of one message in one run of it; someone moving the mouse is seen by
// where the pointer is, between runs.
function xdotoolWriter(onLocal, onError) {
  let queue = []
  let running = false
  let last = null // where Bridge AI last put the pointer
  let lastAt = 0
  const BTN = [1, 2, 3]
  const words = (w) => {
    if (w.t === 'move') return ['mousemove', String(w.x), String(w.y)]
    if (w.t === 'down') return ['mousemove', String(w.x), String(w.y), 'mousedown', String(BTN[w.b] || 1)]
    if (w.t === 'up') return ['mousemove', String(w.x), String(w.y), 'mouseup', String(BTN[w.b] || 1)]
    if (w.t === 'wheel') {
      const out = []
      for (let n = Math.min(10, Math.round(Math.abs(w.dy) / 40)); n > 0; n--) out.push('click', w.dy < 0 ? '4' : '5')
      for (let n = Math.min(10, Math.round(Math.abs(w.dx) / 40)); n > 0; n--) out.push('click', w.dx < 0 ? '6' : '7')
      return out
    }
    if (w.t === 'key' && w.k) return [w.down ? 'keydown' : 'keyup', String(w.k)]
    if (w.t === 'text') return ['type', '--delay', '0', '--', w.s]
    return []
  }
  const flush = () => {
    if (running || !queue.length) return
    const args = queue.flatMap(words)
    queue = []
    if (!args.length) return
    running = true
    execFile('xdotool', args, { timeout: 10000 }, (err) => { running = false; if (err) onError(err.message); flush() })
  }
  const watch = setInterval(() => {
    if (!last || Date.now() - lastAt < 400 || running) return
    execFile('xdotool', ['getmouselocation', '--shell'], { timeout: 2000 }, (err, out) => {
      if (err) return
      const x = Number(/X=(\d+)/.exec(out)?.[1]), y = Number(/Y=(\d+)/.exec(out)?.[1])
      if (Number.isFinite(x) && last && Date.now() - lastAt >= 400 && (Math.abs(x - last.x) > 3 || Math.abs(y - last.y) > 3)) { last = { x, y }; onLocal() }
    })
  }, 250)
  watch.unref?.()
  const self = {
    last: null,
    write: (w) => {
      if (w.x != null) { last = { x: w.x, y: w.y }; lastAt = Date.now(); self.last = last }
      queue.push(w)
      flush()
    },
    stop: () => clearInterval(watch),
  }
  return self
}

// ---------- the clipboard ----------
// Text only, both ways, while a session may control this computer.
const run = (bin, args, input) => new Promise((resolve, reject) => {
  const p = execFile(bin, args, { timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out))))
  if (input != null) { p.stdin.on('error', () => {}); p.stdin.end(input) }
})
async function linuxTool(read) {
  if (wayland() && await which('wl-copy').catch(() => null)) return read ? ['wl-paste', ['--no-newline']] : ['wl-copy', []]
  if (await which('xclip').catch(() => null)) return ['xclip', ['-selection', 'clipboard', ...(read ? ['-o'] : [])]]
  if (await which('xsel').catch(() => null)) return ['xsel', ['--clipboard', read ? '--output' : '--input']]
  return null
}
export async function readClipboard() {
  if (TEST_CLIP) { try { return fs.readFileSync(TEST_CLIP, 'utf8') } catch { return '' } }
  if (IS_MAC) return run('pbpaste', [])
  if (IS_WIN) return (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'])).replace(/\r?\n$/, '')
  const tool = await linuxTool(true)
  if (!tool) throw new Error('Install wl-clipboard, xclip or xsel to share the clipboard with this computer.')
  return run(...tool)
}
export async function writeClipboard(text) {
  const s = String(text).slice(0, 1_000_000)
  if (TEST_CLIP) { fs.writeFileSync(TEST_CLIP, s); return }
  if (IS_MAC) return void await run('pbcopy', [], s)
  if (IS_WIN) return void await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t'], s)
  const tool = await linuxTool(false)
  if (!tool) throw new Error('Install wl-clipboard, xclip or xsel to share the clipboard with this computer.')
  await run(tool[0], tool[1], s)
}
