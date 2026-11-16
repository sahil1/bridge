// Sending a message to an agent pastes it into the agent's input box and presses Enter.
// If something is already sitting in that box (a stray keystroke from the Terminal tab, a
// half-typed draft), the two would merge into one message. So look first, and clear it. Then, for
// an agent whose box Bridge can read (agents.js submit.box), look again: the message shows there
// before Enter goes, and leaves once Enter has taken it. When it doesn't, that's said, never that
// it went.
import { adapter, caps } from './agents.js'

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

// Codex's input box: the last "› " line near the bottom, with the lines under it while they hold
// text; empty when only its dim placeholder shows, null when there's none. Read cell by cell: when
// Codex knows the terminal's background the box has one of its own, which the placeholder's colour
// codes then carry too. Not a "›" Codex draws dim (your messages above the box, and the box itself
// while it takes nothing: codex-rs/tui/src/history_cell/messages.rs, bottom_pane/chat_composer.rs),
// nor a menu's selected row ("› 1. Yes", bottom_pane/picker_option.rs). A tall box (a long message
// on many lines) is found up to 30 lines up.
export function codexBox(s) {
  const lines = String(s || '').replace(/\r/g, '').split('\n')
  const text = (row) => row.map((c) => c.ch).join('').trim()
  const typed = (row) => row.some((c) => c.ch.trim() && !c.faint)
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    const row = cells(lines[i])
    if (row[0]?.ch !== '›' || row[0].faint || /^\d+\.\s/.test(text(row.slice(1)))) continue
    if (!typed(row.slice(1))) return ''
    const out = [text(row.slice(1))]
    // Its other lines, down to the blank one closing the box (or the dim hints under it).
    for (let j = i + 1; j < lines.length; j++) {
      const next = cells(lines[j])
      if (!typed(next)) break
      out.push(text(next))
    }
    return out.join('\n')
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
    let left = draftIn(screen)
    // No input box: looked at again before it's taken as covered. A terminal on Windows (ConPTY)
    // hands over a repaint in pieces, so a read can land on the cleared screen before the box is
    // drawn again; held then, a message to a free agent waited, said "a menu or dialog is open".
    // A screen with nothing on it is still being drawn: looked at for a while longer then (a busy
    // computer can take a moment over it), where something drawn without the box is held as before.
    for (const ms of [150, 300, 500, 1000]) {
      if (left !== null) break
      if (ms > 300 && plain(screen).trim()) break
      await sleep(ms)
      try { screen = await rt.read(paneId, 30) } catch { break }
      left = draftIn(screen)
    }
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
        const left = codexBox(await rt.read(paneId, 40))
        if (!left) break
        cleared = cleared || left
        await rt.input(paneId, [{ keys: Array(Math.min(left.length + 2, 2000)).fill('backspace') }])
        await sleep(300)
      }
    } catch { /* couldn't read the screen: send as before */ }
    if (cleared && codexBox(await rt.read(paneId, 40).catch(() => ''))) throw new Error(`Codex's input box already has text in it ("${cleared.slice(0, 80)}") and it couldn't be cleared. Clear it in the Terminal tab, then send again.`)
  }
  return { ...(await typeIn(rt, paneId, text, agent)), cleared }
}

// Readers of an agent's input box, by its submit.box (agents.js).
const BOX = { draft: draftIn, codex: codexBox }
const SHOW_MS = 4000 // for a pasted message to show in the box
const LEAVE_MS = 2000 // for it to leave once Enter is pressed

// Not taken: still in the box after Enter twice (left), or never shown in it.
export class NotTaken extends Error {
  constructor(name, left) {
    super(left ? `${name} didn't take the message. It's still in its box: press Enter in the Terminal tab, or Send again.` : `${name} didn't take the message: it never showed up in its box. Send again, or type it in the Terminal tab.`)
    this.code = 'not_taken'
  }
}

// The message typed in and sent the way its agent takes one (agents.js submit). With a box Bridge
// can read, it's looked at after Enter until the message has gone. Still there, Enter once more (it
// came while the agent counted it part of the paste); still there then, NotTaken. With shown, Enter
// waits until the message shows in the box (sooner, the agent can take it as part of the paste), and
// isn't pressed when the box stayed empty: the paste went nowhere, or to whatever opened over the
// box, which Enter would answer. { taken: true } once it's seen in the box and then leaving it. A box
// that can't be seen (something covers it, or no reader): sent as before, and no more is said.
export async function typeIn(rt, paneId, text, agent) {
  const how = adapter(agent?.kind).submit || {}
  const read = BOX[how.box]
  const look = async () => { try { return read(await rt.read(paneId, 40)) } catch { return null } }
  if (!read || (await look()) === null) { await rt.prompt(paneId, text, how); return { ok: true } }
  const name = adapter(agent.kind).label
  const at = Date.now()
  const r = await rt.prompt(paneId, text, { ...how, enter: !how.shown })
  let seen = null
  if (!r?.entered) {
    while (Date.now() - at < SHOW_MS && !(seen = await look())) await sleep(60)
    if (seen === '') throw new NotTaken(name, false)
    await sleep(Math.max(0, (how.enterAfter ?? 120) - (Date.now() - at)))
    await rt.input(paneId, [{ keys: ['enter'] }])
  }
  for (let again = false; ; again = true) {
    // Gone: the box empty, or covered a while by what the message opened (a command's panel; a
    // moment's gap is a repaint in pieces, as on Windows).
    let left = null
    for (let until = Date.now() + LEAVE_MS, covered = 0; Date.now() < until; await sleep(100)) {
      left = await look()
      covered = left === null ? covered || Date.now() : 0
      if (left === '' || (covered && Date.now() - covered >= 600)) break
    }
    if (!left) return seen ? { ok: true, taken: true } : { ok: true }
    if (again) throw new NotTaken(name, true)
    await rt.input(paneId, [{ keys: ['enter'] }])
  }
}
