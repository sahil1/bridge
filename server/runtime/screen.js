// Reading a headless xterm's screen back out as text with colors. Shared by the built-in runtime
// (builtin.js) and the terminal host (ptyhost.js), which hands a terminal's whole screen and
// scrollback to a server that picks it up again.

// The terminal host's protocol version (see ptyhost.js). A server and a host only work together
// when theirs match.
export const PROTOCOL = 1
// Lines kept above the screen, the same on both sides so a picked-up terminal keeps all of them.
export const SCROLLBACK = 5000

// One buffer line as text with color codes (SGR only, no cursor moves), the same shape herdr returns.
function sgrOf(c) {
  const out = [0]
  if (c.isBold()) out.push(1)
  if (c.isDim()) out.push(2)
  if (c.isItalic()) out.push(3)
  if (c.isUnderline()) out.push(4)
  if (c.isInverse()) out.push(7)
  if (c.isStrikethrough?.()) out.push(9)
  const color = (base, rgb, pal, v) => {
    if (rgb) return [base + 8, 2, (v >> 16) & 255, (v >> 8) & 255, v & 255]
    if (pal) return v < 8 ? [base + v] : v < 16 ? [base + 60 + v - 8] : [base + 8, 5, v]
    return []
  }
  out.push(...color(30, c.isFgRGB(), c.isFgPalette(), c.getFgColor()), ...color(40, c.isBgRGB(), c.isBgPalette(), c.getBgColor()))
  return out.join(';')
}
export function lineAnsi(line, cols, cell) {
  if (!line) return ''
  let out = ''
  let cur = '0'
  let pendingSpaces = ''
  for (let x = 0; x < cols; x++) {
    const c = line.getCell(x, cell)
    if (!c || c.getWidth() === 0) continue
    const ch = c.getChars() || ' '
    const sgr = sgrOf(c)
    // Keep trailing default-styled blanks out of the line.
    if (ch === ' ' && sgr === '0') { pendingSpaces += ' '; continue }
    if (pendingSpaces) { if (cur !== '0') { out += '\x1b[0m'; cur = '0' } out += pendingSpaces; pendingSpaces = '' }
    if (sgr !== cur) { out += `\x1b[${sgr}m`; cur = sgr }
    out += ch
  }
  return cur !== '0' ? `${out}\x1b[0m` : out
}

// Everything a fresh terminal of the same size needs to look the same: the scrollback and screen,
// the full-screen app's screen on top if one is open, where the cursor is, the title, and the
// modes the app turned on. Written into a new terminal, it picks up where this one is.
export function snapshot(term, title = '') {
  const cols = term.cols
  const normal = term.buffer.normal
  const cell = normal.getNullCell()
  const lines = []
  for (let y = 0; y < normal.length; y++) lines.push(lineAnsi(normal.getLine(y), cols, cell))
  let out = `\x1b[0m${lines.join('\r\n')}\x1b[${normal.cursorY + 1};${normal.cursorX + 1}H`
  if (term.buffer.active.type === 'alternate') {
    const alt = term.buffer.alternate
    out += '\x1b[?1049h\x1b[H\x1b[2J'
    for (let y = 0; y < term.rows; y++) out += `\x1b[${y + 1};1H${lineAnsi(alt.getLine(y), cols, cell)}`
    out += `\x1b[${alt.cursorY + 1};${alt.cursorX + 1}H`
  }
  const m = term.modes
  const mouse = { x10: 9, vt200: 1000, drag: 1002, any: 1003 }[m.mouseTrackingMode]
  out += [
    m.bracketedPasteMode && '\x1b[?2004h', m.applicationCursorKeysMode && '\x1b[?1h', m.applicationKeypadMode && '\x1b=',
    mouse && `\x1b[?${mouse}h`, m.sendFocusMode && '\x1b[?1004h', m.insertMode && '\x1b[4h',
    m.reverseWraparoundMode && '\x1b[?45h', !m.wraparoundMode && '\x1b[?7l',
  ].filter(Boolean).join('')
  // eslint-disable-next-line no-control-regex
  if (title) out += `\x1b]0;${title.replace(/[\x00-\x1f\x7f]/g, '')}\x07`
  return out
}
