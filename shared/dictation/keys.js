// The dictation key: one combination you hold to talk (or tap to keep listening), written the way
// Electron's accelerators are ("Alt+Space", "Control+Alt+Space"). The page matches it against its own
// key events (inside Bridge AI, on every platform); the desktop app hands it to what hears it in other
// apps: native/bridgekeys on a Mac (Carbon's key codes), uiohook-napi on Windows and X11 (its codes,
// to hear the key let go), Electron's globalShortcut elsewhere. Plain functions, so the server, the
// page and the desktop app (desktop/dictation.js) all use the same ones.

// ⌥Space on a Mac. Alt+Space opens the window menu on Windows and many Linux desktops, so there
// it's Ctrl+Alt+Space.
export const defaultKey = (platform) => (platform === 'darwin' ? 'Alt+Space' : 'Control+Alt+Space')

const MODS = { alt: 'alt', option: 'alt', altgr: 'alt', control: 'ctrl', ctrl: 'ctrl', command: 'meta', cmd: 'meta', super: 'meta', meta: 'meta', shift: 'shift', commandorcontrol: 'cmdOrCtrl', cmdorctrl: 'cmdOrCtrl' }
// Keys by their accelerator name, with the browser's KeyboardEvent.code for each.
const PUNCT = { ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '-': 'Minus', '=': 'Equal', '`': 'Backquote' }
export function domCode(key) {
  if (key === 'Space') return 'Space'
  if (/^[A-Z]$/.test(key)) return `Key${key}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key
  return PUNCT[key] || null
}
const KEY_OF_CODE = Object.fromEntries(Object.entries(PUNCT).map(([k, v]) => [v, k]))
const keyOfCode = (code) => (code === 'Space' ? 'Space' : /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : /^F([1-9]|1[0-9]|2[0-4])$/.test(code) ? code : KEY_OF_CODE[code] || null)

// "Control+Alt+Space" -> { key: 'Space', ctrl: true, alt: true, meta: false, shift: false }, or null
// for something that isn't a key and modifiers. CommandOrControl is ⌘ on a Mac, Ctrl elsewhere.
export function parseKey(accel, platform) {
  if (typeof accel !== 'string' || !accel.trim() || accel.length > 60) return null
  const k = { key: null, ctrl: false, alt: false, meta: false, shift: false }
  for (const raw of accel.split('+').map((s) => s.trim())) {
    const m = MODS[raw.toLowerCase()]
    if (m === 'cmdOrCtrl') k[platform === 'darwin' ? 'meta' : 'ctrl'] = true
    else if (m) k[m] = true
    else if (k.key) return null
    else {
      const key = raw.length === 1 ? raw.toUpperCase() : raw === 'space' ? 'Space' : raw.charAt(0).toUpperCase() + raw.slice(1)
      if (!domCode(key)) return null
      k.key = key
    }
  }
  if (!k.key) return null
  // A plain letter or Space on its own would be typed all day: it needs a modifier (F keys don't).
  if (!(k.ctrl || k.alt || k.meta) && !/^F\d+$/.test(k.key)) return null
  return k
}
// Back to an accelerator, in one order (Control, Alt, Shift, Command or Super, the key).
export function keyString(k, platform) {
  if (!k?.key) return null
  return [k.ctrl && 'Control', k.alt && 'Alt', k.shift && 'Shift', k.meta && (platform === 'darwin' ? 'Command' : 'Super'), k.key].filter(Boolean).join('+')
}
// How it's shown: ⌃⌥⇧⌘Space on a Mac, Ctrl+Alt+Shift+Win+Space elsewhere.
export function keyLabel(accel, platform) {
  const k = typeof accel === 'string' ? parseKey(accel, platform) : accel
  if (!k) return String(accel || '')
  if (platform === 'darwin') return `${k.ctrl ? '⌃' : ''}${k.alt ? '⌥' : ''}${k.shift ? '⇧' : ''}${k.meta ? '⌘' : ''}${k.key}`
  return [k.ctrl && 'Ctrl', k.alt && 'Alt', k.shift && 'Shift', k.meta && (platform === 'win32' ? 'Win' : 'Super'), k.key].filter(Boolean).join('+')
}

// A key event in the page: is it the key going down, exactly (no other modifier)?
export const isKeyDown = (e, k) => !!k && e.code === domCode(k.key) && !!e.altKey === k.alt && !!e.ctrlKey === k.ctrl && !!e.metaKey === k.meta && !!e.shiftKey === k.shift
// ...or any part of it let go (the key, or one of its modifiers first).
export const isKeyUp = (e, k) => !!k && (e.code === domCode(k.key) || (k.alt && /^Alt/.test(e.code)) || (k.ctrl && /^Control/.test(e.code)) || (k.meta && /^(Meta|OS)/.test(e.code)) || (k.shift && /^Shift/.test(e.code)))
// The key someone pressed to pick a new one (Settings): an accelerator, or null while it's only
// modifiers, or for a key that can't be one.
export function keyFromEvent(e, platform) {
  const key = keyOfCode(e.code)
  if (!key) return null
  const k = { key, ctrl: !!e.ctrlKey, alt: !!e.altKey, meta: !!e.metaKey, shift: !!e.shiftKey }
  const s = keyString(k, platform)
  return parseKey(s, platform) ? s : null
}

// For native/bridgekeys: macOS's virtual key code and Carbon's modifier bits.
const MAC_CODE = {
  A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17, 1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29, ']': 30, O: 31, U: 32, '[': 33, I: 34, P: 35, L: 37, J: 38, "'": 39, K: 40, ';': 41, '\\': 42, ',': 43, '/': 44, N: 45, M: 46, '.': 47, Space: 49, '`': 50,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111, F13: 105, F14: 107, F15: 113, F16: 106, F17: 64, F18: 79, F19: 80, F20: 90,
}
export function macKey(accel) {
  const k = parseKey(accel, 'darwin')
  if (!k || MAC_CODE[k.key] == null) return null
  return { code: MAC_CODE[k.key], mods: (k.meta ? 256 : 0) | (k.shift ? 512 : 0) | (k.alt ? 2048 : 0) | (k.ctrl ? 4096 : 0) }
}

// For uiohook-napi: its codes for the key and for each side of each modifier, so the key let go
// (any part of it) can be heard.
const HOOK_CODE = {
  Space: 0x39, 1: 0x02, 2: 0x03, 3: 0x04, 4: 0x05, 5: 0x06, 6: 0x07, 7: 0x08, 8: 0x09, 9: 0x0a, 0: 0x0b,
  A: 0x1e, B: 0x30, C: 0x2e, D: 0x20, E: 0x12, F: 0x21, G: 0x22, H: 0x23, I: 0x17, J: 0x24, K: 0x25, L: 0x26, M: 0x32, N: 0x31, O: 0x18, P: 0x19, Q: 0x10, R: 0x13, S: 0x1f, T: 0x14, U: 0x16, V: 0x2f, W: 0x11, X: 0x2d, Y: 0x15, Z: 0x2c,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, F11: 0x57, F12: 0x58, F13: 0x5b, F14: 0x5c, F15: 0x5d, F16: 0x63, F17: 0x64, F18: 0x65, F19: 0x66, F20: 0x67, F21: 0x68, F22: 0x69, F23: 0x6a, F24: 0x6b,
  ';': 0x27, '=': 0x0d, ',': 0x33, '-': 0x0c, '.': 0x34, '/': 0x35, '`': 0x29, '[': 0x1a, '\\': 0x2b, ']': 0x1b, "'": 0x28,
}
const HOOK_MODS = { ctrl: [0x1d, 0x0e1d], alt: [0x38, 0x0e38], shift: [0x2a, 0x36], meta: [0x0e5b, 0x0e5c] }
export function hookKey(accel, platform) {
  const k = parseKey(accel, platform)
  if (!k || HOOK_CODE[k.key] == null) return null
  return { key: HOOK_CODE[k.key], mods: ['ctrl', 'alt', 'shift', 'meta'].filter((m) => k[m]).flatMap((m) => HOOK_MODS[m]) }
}
