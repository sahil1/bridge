// Sending a message to an agent pastes it into the agent's input box and presses Enter.
// If something is already sitting in that box (a stray keystroke from the Terminal tab, a
// half-typed draft), the two would merge into one message. So look first, and clear it.
import { caps } from './agents.js'

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')
const RULE = /^\s*─{3,}/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Text drawn dim or grey: Claude's placeholder. Colour codes can arrive as \x1b[2m, \x1b[0;2m,
// \x1b[90m, \x1b[38;5;244m or a grey \x1b[38;2;r;g;bm, depending on the terminal layer.
function isFaint(s) {
  const m = /^\x1b\[([\d;]*)m/.exec(s)
  if (!m) return false
  const p = m[1].split(';').map(Number)
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 2 || p[i] === 90) return true
    if (p[i] === 38 || p[i] === 48) {
      const fg = p[i] === 38
      if (p[i + 1] === 5) { if (fg && p[i + 2] >= 240 && p[i + 2] <= 250) return true; i += 2 } // 256-colour grey
      else if (p[i + 1] === 2) { const [r, g, b] = p.slice(i + 2, i + 5); if (fg && Math.max(r, g, b) - Math.min(r, g, b) < 12 && r > 90 && r < 170) return true; i += 4 } // rgb grey
    }
  }
  return false
}

// What's typed in the input box, '' when it's empty (Claude shows a dimmed placeholder then),
// or null when there's no input box on screen at all (a menu, picker or panel is covering it).
export function draftIn(ansi) {
  const raw = String(ansi || '').split('\n')
  const lines = raw.map(plain)
  // The box is a prompt line (❯ or ›) right under a rule, closed by another rule.
  for (let i = lines.length - 1; i > 0; i--) {
    if (!/^[❯›][ \u00a0]/.test(lines[i]) || !RULE.test(lines[i - 1])) continue
    const first = raw[i].replace(/^(\x1b\[0m)+/, '').replace(/^[❯›][ \u00a0]/, '').replace(/^(\x1b\[0m)+/, '')
    if (isFaint(first)) return '' // placeholder
    const out = [lines[i].slice(2)]
    for (let j = i + 1; j < lines.length && !RULE.test(lines[j]); j++) out.push(lines[j].replace(/^ {2}/, ''))
    return out.join('\n').trim()
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
      // Ctrl+C clears the whole box (all lines) when it has text in it.
      await rt.input(paneId, [{ keys: ['ctrl+c'] }])
      await sleep(350)
      if (draftIn(await rt.read(paneId, 30))) throw new Error(`The agent's input box already has text in it ("${left.slice(0, 80)}") and it couldn't be cleared. Clear it in the Terminal tab, then send again.`)
      cleared = left
    }
  }
  await rt.prompt(paneId, text)
  return { ok: true, cleared }
}
