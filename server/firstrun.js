// An agent's first-run screens, read off its terminal: the look, the sign-in, safety notes and
// trusting the folder. They wait in the terminal, where Chat can't show them, so the app walks you
// through them instead (Console.jsx, FirstRun.jsx). Their wording as of Claude Code 2.1 and Codex
// 0.160; a screen this doesn't know still shows as an ordinary question, or in the terminal. Also
// a sign-in run in a terminal tab of its own (signInScreen: Sign in buttons, server/index.js).
import { parseScreen } from '../src/components/questionParse.js'

const STEPS = {
  claude: [
    ['trust', /Quick safety check: Is this a project you created|Do you trust the files in this folder/],
    ['terminal', /Use Claude Code's terminal setup\?/],
    ['continue', /Security notes:|Login successful\. Press/],
    ['browser', /Browser didn't open\? (?:Use the url below|Visit)|Paste code here if prompted/],
    ['login', /Select login method:/],
    ['theme', /Choose the text style that looks best with your terminal/],
  ],
  codex: [
    ['trust', /allow Codex to work in this folder|Do you trust the contents of this directory/i],
    ['browser', /Finish signing in via your browser/],
    ['login', /Sign in with ChatGPT to use Codex as part of your paid plan/],
    ['continue', /Welcome to Codex[\s\S]*Press Enter to continue/],
  ],
}
// Only these, as a link the card may show: the agents' own sign-in pages (Claude Code 2.1.311
// signs in at claude.com/cai/oauth/authorize).
const SIGN_IN_URL = /^https:\/\/(?:claude\.ai|claude\.com|console\.anthropic\.com|platform\.claude\.com|auth\.openai\.com)\/\S+$/
const URL_CHARS = /^[\w%.~:/?#[\]@!$&'()*+,;=-]+$/

export const knows = (kind) => !!STEPS[kind]

// lines: the screen, one string per row. Returns { step, url, keys, code } or null. keys: what
// answers yes to trusting the folder, wherever that answer is: Claude Code 2.1 put "Yes, proceed"
// first, later versions put "No, exit" first and drop the numbers. code: Codex's one-time code, when
// it signs in with one (Sign in with Device Code), to enter on the page at url.
export function firstRun(kind, lines) {
  const steps = STEPS[kind]
  if (!steps) return null
  const text = lines.join('\n')
  const hit = steps.find(([, re]) => re.test(text))
  if (!hit) return null
  const code = hit[0] === 'browser' ? deviceCode(lines) : null
  return { step: hit[0], url: hit[0] === 'browser' ? signInUrl(lines, code ? /Open this link/ : null) : null, keys: hit[0] === 'trust' ? trustKeys(text) : null, code }
}

function trustKeys(text) {
  const q = parseScreen(text)
  const yes = q?.options.find((o) => /^yes\b/i.test(o.label))
  if (!yes) return null
  if (!q.arrows) return yes.selected ? ['enter'] : [yes.n]
  const d = yes.i - Math.max(0, q.at)
  return [...Array(Math.abs(d)).fill(d > 0 ? 'down' : 'up'), 'enter']
}

// The sign-in link, which the agent wraps across rows: its first row, then rows that carry on with
// nothing but URL characters. after: only a link after the row this matches.
function signInUrl(lines, after = null) {
  const from = after ? lines.findIndex((l) => after.test(l)) : 0
  if (from < 0) return null
  const at = lines.findIndex((l, i) => i >= from && /https:\/\//.test(l))
  if (at < 0) return null
  let url = lines[at].slice(lines[at].indexOf('https://')).trim()
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l || !URL_CHARS.test(l)) break
    url += l
  }
  return SIGN_IN_URL.test(url) ? url : null
}

// Codex's one-time code, on its own row after "Enter this one-time code" (ABCD-12345).
function deviceCode(lines) {
  const at = lines.findIndex((l) => /Enter this one-time code/.test(l))
  if (at < 0) return null
  const row = lines.slice(at + 1).map((l) => l.trim()).find(Boolean)
  return row && /^[A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+$/.test(row) ? row : null
}

// A sign-in in a terminal tab of its own (`claude auth login`, `codex login`, typed by the Sign in
// buttons), read off its screen (ansi: the tab's rows, as rt.read gives them), in the agents' own
// words as of Claude Code 2.1.311 and Codex 0.160. Returns what the app can offer beside it:
//   codeUrl   Claude Code's other link ("If the browser didn't open, visit:"), whose page shows a
//             code to paste, for when the browser can't come back to it on localhost
//   asksCode  it's waiting at "Paste code here if prompted >", where that code goes
//   device    { url, code }: Codex signing in with a one-time code (codex login --device-auth)
//   ended     the login is over (the line Bridge AI types after it has printed), and why, when it
//             said: its last line that reads as a failure
// eslint-disable-next-line no-control-regex
const ESC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\r/g
export const SIGN_IN_ENDED = '[Bridge AI] The sign-in has ended.'
const FAILED = /\b(error|failed|failure|denied|invalid|timed out|aborted|cancell?ed|expired)\b/i
export function signInScreen(kind, ansi) {
  const rows = String(ansi || '').replace(ESC, '').split('\n').map((l) => l.trimEnd())
  // From the line typed on (the login, then echo of that line): the shell's greeting isn't the sign-in's.
  const typed = rows.findLastIndex((l) => l.includes(`echo '${SIGN_IN_ENDED.slice(0, 11)}`))
  const lines = rows.slice(Math.max(0, typed + 1))
  const endedAt = lines.findIndex((l) => l.trim() === SIGN_IN_ENDED)
  const live = endedAt < 0 ? lines : lines.slice(0, endedAt)
  const said = live.filter((l) => l.trim() && !/https?:\/\//.test(l))
  const out = { codeUrl: null, asksCode: false, device: null, ended: endedAt >= 0, problem: null, success: said.some((l) => /\b(Login successful|Successfully logged in)\b/i.test(l)) }
  if (out.ended && !out.success) out.problem = [...said].reverse().find((l) => FAILED.test(l))?.trim() || null
  if (kind === 'claude') {
    out.codeUrl = signInUrl(live, /If the browser didn't open|Browser didn't open/)
    out.asksCode = !out.ended && /Paste code here if prompted/.test(said.slice(-2).join('\n'))
  }
  if (kind === 'codex') {
    const code = deviceCode(live)
    const url = code && signInUrl(live, /Open this link/)
    if (code && url) out.device = { url, code }
  }
  return out
}
