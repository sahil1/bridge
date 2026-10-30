// Sending a message to an agent pastes it into the agent's input box and presses Enter.
// If something is already sitting in that box (a stray keystroke from the Terminal tab, a
// half-typed draft), the two would merge into one message. So look first, and clear it.
import { caps } from './agents.js'

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/\r/g, '')
const RULE = /^\s*─{3,}/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Each character of a line with how it's drawn: faint (dim or grey) and inverse (the cursor). The
// style is followed through the line's colour codes, which can arrive as \x1b[2m, \x1b[0;2m,
// \x1b[90m, \x1b[38;5;244m or a grey \x1b[38;2;r;g;bm, depending on the terminal layer.
function cells(line) {
  const st = { dim: false, grey: false, inverse: false }
  const out = []
  // eslint-disable-next-line no-control-regex
  for (const m of line.matchAll(/\x1b\[([\d;]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|([^\x1b])/gu)) {
    if (m[2] !== undefined) { out.push({ ch: m[2], faint: st.dim || st.grey, inverse: st.inverse }); continue }
    if (m[1] === undefined) continue // not a colour code
    const p = m[1] === '' ? [0] : m[1].split(';').map(Number)
    for (let i = 0; i < p.length; i++) {
      const n = p[i]
      if (n === 0) Object.assign(st, { dim: false, grey: false, inverse: false })
      else if (n === 2) st.dim = true
      else if (n === 22) st.dim = false
      else if (n === 7) st.inverse = true
      else if (n === 27) st.inverse = false
      else if (n === 39) st.grey = false
      else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) st.grey = n === 90
      else if (n === 38 || n === 48) {
        const fg = n === 38
        if (p[i + 1] === 5) { if (fg) st.grey = p[i + 2] >= 240 && p[i + 2] <= 250; i += 2 } // 256-colour grey
        else if (p[i + 1] === 2) { const [r, g, b] = p.slice(i + 2, i + 5); if (fg) st.grey = Math.max(r, g, b) - Math.min(r, g, b) < 12 && r > 90 && r < 170; i += 4 } // rgb grey
      }
    }
  }
  return out
}

// Whether the box's rows hold typed text, drawn plain. Claude draws its placeholder and its
// suggested next message faint, its cursor can sit on their first letter (inverse), and it greys
// the ❯ while it works, so: a letter after the ❯ that is neither faint nor the cursor.
function typedIn(rows) {
  let cursor = false
  return rows.some((row, k) => cells(row).slice(k ? 0 : 2).some((c) => {
    if (!c.ch.trim()) return false
    if (c.inverse && !cursor) { cursor = true; return false }
    return !c.faint
  }))
}

// Clears what's typed in the box with Backspace, then waits for it to redraw empty (a long one
// takes a moment). Not Ctrl+C: while the agent works, Ctrl+C stops its turn and leaves the text
// where it is, and when it's idle Claude takes it as the first of "press Ctrl-C again to exit".
async function clearBox(rt, paneId, left) {
  await rt.input(paneId, [{ keys: Array(Math.min(left.length + 4, 20000)).fill('backspace') }])
  for (let waited = 0; waited < 2000; waited += 100) {
    await sleep(100)
    if (!draftIn(await rt.read(paneId, 30))) return true
  }
  return false
}

// What's typed in the input box, '' when it's empty (Claude shows a dimmed placeholder or
// suggestion then), or null when there's no input box on screen at all (a menu, picker or panel is
// covering it).
export function draftIn(ansi) {
  const raw = String(ansi || '').split('\n')
  const lines = raw.map(plain)
  // The box is a prompt line (❯ or ›) right under a rule, closed by another rule.
  for (let i = lines.length - 1; i > 0; i--) {
    if (!/^[❯›][ \u00a0]/.test(lines[i]) || !RULE.test(lines[i - 1])) continue
    let end = i + 1
    while (end < lines.length && !RULE.test(lines[end])) end++
    if (!typedIn(raw.slice(i, end))) return ''
    const out = [lines[i].slice(2)]
    for (let j = i + 1; j < end; j++) out.push(lines[j].replace(/^ {2}/, ''))
    return out.join('\n').trim()
  }
  return null
}

// Codex's input box: the last "› " line near the bottom; empty when only its dim placeholder shows,
// null when there's none.
export function codexBox(s) {
  const lines = String(s || '').replace(/\r/g, '').split('\n')
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
    const raw = lines[i]
    if (!/^(\x1b\[[0-9;]*m)*›/.test(raw)) continue
    const after = raw.slice(raw.indexOf('›') + 1).replace(/^(\x1b\[0m)?\s?/, '')
    return /^\x1b\[[0-9;]*\b2m/.test(after) ? '' : plain(raw).replace(/^›\s*/, '').trim()
  }
  return null
}

// A one-line name for whatever is covering the input box, for the "held" note.
function coverName(ansi) {
  if (/Enter to select|Review your answers/.test(plain(String(ansi || '')))) return 'a question is waiting for your answer'
  const lines = plain(String(ansi || '')).split('\n').map((l) => l.trim()).filter((l) => l && !RULE.test(l))
  const hint = lines.slice(-6).find((l) => /esc to|enter to|↑\/↓|select/i.test(l))
  const title = lines.slice(-12).find((l) => /^[A-Z][\w ]{2,40}$/.test(l))
  return title ? `"${title}" is open` : hint ? `a menu is open (${hint.slice(0, 60)})` : 'a menu or dialog is open'
}

export class NotAtPrompt extends Error {
  constructor(reason) { super(`Not sent yet: ${reason} in the agent`); this.reason = reason; this.code = 'not_at_prompt' }
}

// Only agents whose input box Bridge can read (caps.inputBox) are checked; others are sent to as is.
export async function promptSafe(rt, paneId, text, agent) {
  let cleared = null
  let screen = null
  if (!agent || caps(agent.kind).inputBox) {
    try { screen = await rt.read(paneId, 30) } catch { /* couldn't read the screen: send as before */ }
  }
  if (screen != null) {
    const left = draftIn(screen)
    // Pasting while a panel or menu covers the box loses the message, so hold it instead.
    if (left === null) throw new NotAtPrompt(coverName(screen))
    if (left) {
      if (!(await clearBox(rt, paneId, left))) throw new Error(`The agent's input box already has text in it ("${left.slice(0, 80)}") and it couldn't be cleared. Clear it in the Terminal tab, then send again.`)
      cleared = left
    }
  }
  // Codex: keys typed in its Terminal tab and left there (a "1" meant for a menu) would start the
  // message. Cleared with Backspace: Ctrl+C would also stop a turn that's running. No box found
  // (something covers it): sent as before.
  if (agent?.kind === 'codex') {
    try {
      for (let i = 0; i < 2; i++) {
        const left = codexBox(await rt.read(paneId, 30))
        if (!left) break
        cleared = cleared || left
        await rt.input(paneId, [{ keys: Array(Math.min(left.length + 2, 400)).fill('backspace') }])
        await sleep(300)
      }
    } catch { /* couldn't read the screen: send as before */ }
    if (cleared && codexBox(await rt.read(paneId, 30).catch(() => ''))) throw new Error(`Codex's input box already has text in it ("${cleared.slice(0, 80)}") and it couldn't be cleared. Clear it in the Terminal tab, then send again.`)
  }
  await rt.prompt(paneId, text)
  return { ok: true, cleared }
}
