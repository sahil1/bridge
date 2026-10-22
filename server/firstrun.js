// An agent's first-run screens, read off its terminal: the look, the sign-in, safety notes and
// trusting the folder. They wait in the terminal, where Chat can't show them, so the app walks you
// through them instead (Console.jsx, FirstRun.jsx). Their wording as of Claude Code 2.1 and Codex
// 0.160; a screen this doesn't know still shows as an ordinary question, or in the terminal.
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
// Only these, as a link the card may show: the agents' own sign-in pages.
const SIGN_IN_URL = /^https:\/\/(?:claude\.ai|console\.anthropic\.com|platform\.claude\.com|auth\.openai\.com)\/\S+$/
const URL_CHARS = /^[\w%.~:/?#[\]@!$&'()*+,;=-]+$/

export const knows = (kind) => !!STEPS[kind]

// lines: the screen, one string per row. Returns { step, url } or null.
export function firstRun(kind, lines) {
  const steps = STEPS[kind]
  if (!steps) return null
  const text = lines.join('\n')
  const hit = steps.find(([, re]) => re.test(text))
  if (!hit) return null
  return { step: hit[0], url: hit[0] === 'browser' ? signInUrl(lines) : null }
}

// The sign-in link, which the agent wraps across rows: its first row, then rows that carry on with
// nothing but URL characters.
function signInUrl(lines) {
  const at = lines.findIndex((l) => /https:\/\//.test(l))
  if (at < 0) return null
  let url = lines[at].slice(lines[at].indexOf('https://')).trim()
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l || !URL_CHARS.test(l)) break
    url += l
  }
  return SIGN_IN_URL.test(url) ? url : null
}
