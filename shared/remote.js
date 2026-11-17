// Remote Screen and Preview (a Beta Feature): what both ends agree on, shared by the server
// (server/remote.js), the desktop app (desktop/remote.js) and the page (src/components/remote/).
//
// A screen goes peer-to-peer (WebRTC) where the network allows it: the two ends find each other with
// a STUN server, Cloudflare's own (Bridge AI's relay already runs on Cloudflare; no other STUN is
// ever asked), and the offer, the answer and each candidate go over the encrypted link as everything
// else does. Where the network doesn't allow it (two strict NATs), the screen comes through the relay
// as pictures instead, a few a second at most, each one smaller than the relay takes in one message.

// Where each end learns its own public address (STUN), and nothing else. BRIDGE_REMOTE_ICE (tests):
// none, so two pages on one computer meet on their own addresses without asking anyone.
export const STUN = 'stun:stun.cloudflare.com:3478'
export const iceServers = (env = {}) => (env.BRIDGE_REMOTE_ICE === 'none' ? [] : [{ urls: STUN }])

// How long a peer-to-peer connection may take before the screen comes through the relay instead.
export const P2P_WAIT_MS = 10000
// Pictures through the relay: at most this many a second (Bridge AI's relay counts each message
// against the account's allowance: relay/HOSTED.md), each at most this big (the relay takes 256 KB in
// one message; a picture goes in one), and each sent only once the last one has been shown.
export const RATE = { hosted: 1, own: 4 }
export const MAX_FRAME = 180 * 1024
// Input through the relay, when the screen comes that way too: at most this many messages a second
// (moves in between are joined into the last one).
export const INPUT_PER_SECOND = { hosted: 6, own: 30 }
// Someone at the computer moving its mouse or pressing a key: remote input waits this long.
export const PAUSE_MS = 3000

// ---------- input ----------
// What the viewer sends, each checked here before anything is pressed:
//   { t: 'move', x, y }            x, y from 0 to 1 across the screen shown
//   { t: 'down' | 'up', b, x, y }  b: 0 left, 1 middle, 2 right
//   { t: 'wheel', dx, dy, x, y }   in pixels
//   { t: 'key', code, down }       code: KeyboardEvent.code ("KeyA", "ShiftLeft", "ArrowUp")
//   { t: 'text', s }               typed text (a phone's keyboard), up to 2000 characters
const unit = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null)
export function cleanInput(ev) {
  if (!ev || typeof ev !== 'object') return null
  const at = { x: unit(ev.x), y: unit(ev.y) }
  if (ev.t === 'move') return at.x == null || at.y == null ? null : { t: 'move', ...at }
  if (ev.t === 'down' || ev.t === 'up') return at.x == null || at.y == null || ![0, 1, 2].includes(ev.b) ? null : { t: ev.t, b: ev.b, ...at }
  if (ev.t === 'wheel') {
    const c = (v) => (Number.isFinite(v) ? Math.max(-2000, Math.min(2000, Math.round(v))) : 0)
    return { t: 'wheel', dx: c(ev.dx), dy: c(ev.dy), ...(at.x == null || at.y == null ? {} : at) }
  }
  if (ev.t === 'key') return typeof ev.code === 'string' && Object.hasOwn(KEYS, ev.code) ? { t: 'key', code: ev.code, down: ev.down === true } : null
  if (ev.t === 'text') return typeof ev.s === 'string' && ev.s.length ? { t: 'text', s: ev.s.slice(0, 2000) } : null
  return null
}

// The keys, by KeyboardEvent.code: [macOS virtual key code, Windows virtual key, X11 keysym, Electron's name].
const L = (c) => [c.toLowerCase(), c.toUpperCase()]
const MAC_LETTERS = { A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17, O: 31, U: 32, I: 34, P: 35, L: 37, J: 38, K: 40, N: 45, M: 46 }
const MAC_DIGITS = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25]
export const KEYS = {
  ...Object.fromEntries(Object.entries(MAC_LETTERS).map(([c, m]) => { const [x11, el] = L(c); return [`Key${c}`, [m, c.charCodeAt(0), x11, el]] })),
  ...Object.fromEntries(MAC_DIGITS.map((m, d) => [`Digit${d}`, [m, 0x30 + d, String(d), String(d)]])),
  Enter: [36, 0x0d, 'Return', 'Enter'], Tab: [48, 0x09, 'Tab', 'Tab'], Space: [49, 0x20, 'space', 'Space'], Backspace: [51, 0x08, 'BackSpace', 'Backspace'],
  Escape: [53, 0x1b, 'Escape', 'Escape'], Delete: [117, 0x2e, 'Delete', 'Delete'], Home: [115, 0x24, 'Home', 'Home'], End: [119, 0x23, 'End', 'End'],
  PageUp: [116, 0x21, 'Prior', 'PageUp'], PageDown: [121, 0x22, 'Next', 'PageDown'], ArrowLeft: [123, 0x25, 'Left', 'Left'], ArrowRight: [124, 0x27, 'Right', 'Right'],
  ArrowDown: [125, 0x28, 'Down', 'Down'], ArrowUp: [126, 0x26, 'Up', 'Up'], Insert: [114, 0x2d, 'Insert', 'Insert'],
  Minus: [27, 0xbd, 'minus', '-'], Equal: [24, 0xbb, 'equal', '='], BracketLeft: [33, 0xdb, 'bracketleft', '['], BracketRight: [30, 0xdd, 'bracketright', ']'],
  Backslash: [42, 0xdc, 'backslash', '\\'], Semicolon: [41, 0xba, 'semicolon', ';'], Quote: [39, 0xde, 'apostrophe', "'"], Backquote: [50, 0xc0, 'grave', '`'],
  Comma: [43, 0xbc, 'comma', ','], Period: [47, 0xbe, 'period', '.'], Slash: [44, 0xbf, 'slash', '/'],
  ShiftLeft: [56, 0xa0, 'Shift_L', 'Shift'], ShiftRight: [60, 0xa1, 'Shift_R', 'Shift'], ControlLeft: [59, 0xa2, 'Control_L', 'Control'], ControlRight: [62, 0xa3, 'Control_R', 'Control'],
  AltLeft: [58, 0xa4, 'Alt_L', 'Alt'], AltRight: [61, 0xa5, 'Alt_R', 'Alt'], MetaLeft: [55, 0x5b, 'Super_L', 'Meta'], MetaRight: [54, 0x5c, 'Super_R', 'Meta'], CapsLock: [57, 0x14, 'Caps_Lock', 'CapsLock'],
  ...Object.fromEntries([122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111].map((m, i) => [`F${i + 1}`, [m, 0x70 + i, `F${i + 1}`, `F${i + 1}`]])),
  ...Object.fromEntries([82, 83, 84, 85, 86, 87, 88, 89, 91, 92].map((m, d) => [`Numpad${d}`, [m, 0x60 + d, `KP_${d}`, `num${d}`]])),
  NumpadEnter: [76, 0x0d, 'KP_Enter', 'Enter'], NumpadAdd: [69, 0x6b, 'KP_Add', 'numadd'], NumpadSubtract: [78, 0x6d, 'KP_Subtract', 'numsub'],
  NumpadMultiply: [67, 0x6a, 'KP_Multiply', 'nummult'], NumpadDivide: [75, 0x6f, 'KP_Divide', 'numdiv'], NumpadDecimal: [65, 0x6e, 'KP_Decimal', 'numdec'],
}
export const keyFor = (code, os) => { const k = KEYS[code]; return k ? k[os === 'mac' ? 0 : os === 'windows' ? 1 : os === 'electron' ? 3 : 2] : null }
// Keys Windows needs marked as extended (the arrows and the block above them, the right-hand
// modifiers, the keypad's Enter and /).
export const WIN_EXTENDED = new Set(['Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Insert', 'ControlRight', 'AltRight', 'MetaLeft', 'MetaRight', 'NumpadEnter', 'NumpadDivide'])
export const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])
// ⌘ on a Mac is Ctrl on Windows and Linux (copy, paste, undo): swapped when the two ends differ,
// unless the viewer turns that off.
export const SWAP = { MetaLeft: 'ControlLeft', MetaRight: 'ControlRight', ControlLeft: 'MetaLeft', ControlRight: 'MetaRight' }
export const swapsKeys = (from, to) => !!from && !!to && (from === 'mac') !== (to === 'mac')

// ---------- pictures through the relay ----------
// Each picture is one binary message: [1][4 bytes: width][4 bytes: height][the picture's own type,
// as text, ending in a 0 byte][the picture]. The viewer answers each with { t: 'ack' } once shown.
export function packFrame(type, w, h, bytes) {
  const t = new TextEncoder().encode(String(type).slice(0, 40))
  const out = new Uint8Array(9 + t.length + 1 + bytes.byteLength)
  out[0] = 1
  const v = new DataView(out.buffer)
  v.setUint32(1, w >>> 0)
  v.setUint32(5, h >>> 0)
  out.set(t, 9)
  out[9 + t.length] = 0
  out.set(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), 10 + t.length)
  return out
}
export function unpackFrame(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (b[0] !== 1 || b.byteLength < 11) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const end = b.indexOf(0, 9)
  if (end < 0) return null
  return { w: v.getUint32(1), h: v.getUint32(5), type: new TextDecoder().decode(b.subarray(9, end)), bytes: b.subarray(end + 1) }
}

// ---------- previews ----------
// A project's app on another of your computers, at an address of its own on this one: its requests
// go to that computer's /_preview/<port>/, and only to a port it lists as one of its own dev servers.
// What a browser keeps for a site (its cookies) and what the page sends (its Authorization, its
// Origin) go along in headers of their own, as the link carries none of a browser's own.
export const PREVIEW = /^\/_preview\/(\d{2,5})(\/.*)?$/
export const PREVIEW_HEADERS = { cookie: 'x-bridge-preview-cookie', 'set-cookie': 'x-bridge-preview-set-cookie', authorization: 'x-bridge-preview-authorization', origin: 'x-bridge-preview-origin', root: 'x-bridge-preview-root' }
