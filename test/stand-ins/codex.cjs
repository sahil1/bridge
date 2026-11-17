// Stand-in Codex for signing in, in the words Codex prints (codex-rs/cli/src/login.rs and
// codex-rs/login, November 2026). Signed in: $CODEX_HOME/auth.json (else ~/.codex/auth.json) holds
// tokens, which is what Bridge AI looks at too.
//   codex --version
//   codex login status          says whether it's signed in (exits 1 when it isn't)
//   codex login                 the browser's way: listens on localhost (1455 for the real one; here
//                               a free port, in ~/codex-login-port.txt), opens the browser there (with
//                               the stand-in open.cjs beside it, a test's, never the computer's own),
//                               prints the link and waits. The browser coming back signs it in.
//   codex login --device-auth   a one-time code instead: the page and the code (ABCD-12345), then it
//                               waits until ~/codex-device-ok is there (the test signing in on that
//                               page), and is signed in
//   codex logout
//   codex, with ~/codex-first-run.json there: its own sign-in, waiting for the browser; Esc goes back
//                               to how to sign in, where the second, Sign in with Device Code, shows
//                               the page and the code as the TUI does (keys in ~/codex-typed.log);
//                               signed in there, its welcome, and Enter to its prompt
//   codex [--model <m>] [<prompt>], in a terminal: a conversation, its log started where Codex
//                               keeps it ($CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl,
//                               the id and folder in its first line), then its prompt, waiting (keys
//                               in ~/codex-typed.log); its arguments noted in ~/codex-started.log
//   codex [--model <m>] resume <id>, in a terminal: that conversation again, the same way
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')

const args = process.argv.slice(2)
const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
const auth = path.join(home, 'auth.json')
const CODE = 'ABCD-12345'
const DEVICE = 'https://auth.openai.com/codex/device'
const say = (s) => process.stdout.write(s.replace(/\n/g, '\r\n'))
const signedIn = () => { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(auth, JSON.stringify({ tokens: { id_token: 'stand-in' } })) }
const isIn = () => { try { return Object.keys(JSON.parse(fs.readFileSync(auth, 'utf8')).tokens || {}).length > 0 } catch { return false } }
// The browser, as stand-ins/claude.cjs opens it: the stand-in open.cjs beside this, run by Node.
const openBrowser = (url) => { const open = path.join(__dirname, 'open.cjs'); if (fs.existsSync(open)) spawn(process.execPath, [open, url], { stdio: 'ignore', windowsHide: true }).unref() }
const authorize = (port) => `https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_stand_in&redirect_uri=http%3A%2F%2Flocalhost%3A${port}%2Fauth%2Fcallback&scope=openid&state=stand-in`
const waitForDevice = (then) => { const t = setInterval(() => { if (fs.existsSync(path.join(os.homedir(), 'codex-device-ok'))) { clearInterval(t); signedIn(); then() } }, 300) }

if (args.includes('--version')) { console.log('codex-cli 0.160.0'); process.exit(0) }
if (args[0] === 'logout') { fs.rmSync(auth, { force: true }); console.log('Successfully logged out'); process.exit(0) }
if (args[0] === 'login' && args[1] === 'status') { if (isIn()) { console.log('Logged in using ChatGPT'); process.exit(0) } console.log('Not logged in'); process.exit(1) }
if (args[0] === 'login' && args.includes('--device-auth')) {
  say(`\nWelcome to Codex [v0.160.0]\nOpenAI's command-line coding agent\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \x1b[94m${DEVICE}\x1b[0m\n\n2. Enter this one-time code (expires in 15 minutes)\n   \x1b[94m${CODE}\x1b[0m\n\nContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\n\n`)
  waitForDevice(() => { say('Successfully logged in\n'); process.exit(0) })
  return
}
if (args[0] === 'login') {
  const server = http.createServer((req, res) => {
    res.writeHead(200).end()
    if (/^\/auth\/callback\?code=/.test(req.url)) { signedIn(); say('Successfully logged in\n'); process.exit(0) }
  }).listen(0, '127.0.0.1', () => {
    const port = server.address().port
    fs.writeFileSync(path.join(os.homedir(), 'codex-login-port.txt'), String(port))
    openBrowser(authorize(port))
    say(`Starting local login server on http://localhost:${port}.\nIf your browser did not open, navigate to this URL to authenticate:\n\n${authorize(port)}\n\nOn a remote or headless machine? Use \`codex login --device-auth\` instead.\n`)
  })
  return
}

// Its TUI's sign-in, for a new Codex in a terminal.
if (fs.existsSync(path.join(os.homedir(), 'codex-first-run.json'))) {
  const screen = (rows) => process.stdout.write(`\x1b[2J\x1b[H${rows.join('\r\n')}`)
  const browser = () => screen(['', '  Finish signing in via your browser', '', "  If the link doesn't open automatically, press c to copy it:", `  ${authorize(1455)}`, '',
    '  On a remote or headless machine? Press Esc and choose "Sign in with Device Code".', '', '  Press Esc to cancel', ''])
  let at = 'browser'
  let pick = 0
  const picker = () => screen(['', '  Sign in with ChatGPT to use Codex as part of your paid plan', '  or connect an API key for usage-based billing', '',
    ...['Sign in with ChatGPT', 'Sign in with Device Code', 'Sign in another way'].map((o, i) => `${i === pick ? '› ' : '  '}${i + 1}. ${o}`), '', '  Press Enter to continue', ''])
  // Keys a key at a time before its screen is up, as the Claude Code stand-in reads them.
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  openBrowser(authorize(1455))
  browser()
  // Each key on its own, however the terminal hands them over (down and Enter can come as one).
  process.stdin.on('data', (chunk) => {
    fs.appendFileSync(path.join(os.homedir(), 'codex-typed.log'), JSON.stringify(chunk) + '\n')
    for (const d of chunk.match(/\x1b\[[A-D]|\x1b|\r|[^\x1b\r]+/g) || []) key(d)
  })
  function key(d) {
    if (at === 'done') { if (d.includes('\r')) { at = 'main'; screen(['', '\x1b[1m›\x1b[0m \x1b[2mAsk Codex to do anything\x1b[0m', '']) } return }
    if (at === 'browser' || at === 'device') { if (d === '\x1b') { at = 'picker'; pick = 0; picker() } return }
    if (at !== 'picker') return
    if (d === '\x1b[B') { pick = Math.min(2, pick + 1); return picker() }
    if (d === '\x1b[A') { pick = Math.max(0, pick - 1); return picker() }
    if (d === '\r' && pick === 0) { at = 'browser'; openBrowser(authorize(1455)); return browser() }
    if (d === '\r' && pick === 1) {
      at = 'device'
      screen(['', '  Finish signing in via your browser', '', '  1. Open this link in your browser and sign in', '', `  ${DEVICE}`, '', '  2. Enter this one-time code after you are signed in (expires in 15 minutes)', '',
        `  ${CODE}`, '', '  Continue only if you started this login in Codex. If a website or another person gave you this code, cancel.', '', '  Press Esc to cancel', ''])
      waitForDevice(() => { at = 'done'; screen(['', '  Welcome to Codex, OpenAI\'s command-line coding agent', '', '  Press Enter to continue', '']) })
    }
  }
  setInterval(() => {}, 1 << 30)
  return
}

// A conversation, in a terminal: a new one's log named as Codex names it (where Bridge AI finds its
// session), or the one it resumes; then its prompt, waiting.
if (process.stdin.isTTY) {
  fs.appendFileSync(path.join(os.homedir(), 'codex-started.log'), JSON.stringify(args) + '\n')
  let session = args[args.indexOf('resume') + 1] || null
  if (!args.includes('resume')) {
    const now = new Date()
    const day = path.join(home, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'))
    const id = require('node:crypto').randomUUID()
    session = id
    fs.mkdirSync(day, { recursive: true })
    fs.writeFileSync(path.join(day, `rollout-${now.toISOString().slice(0, 19).replace(/:/g, '-')}-${id}.jsonl`), JSON.stringify({ timestamp: now.toISOString(), type: 'session_meta', payload: { id, timestamp: now.toISOString(), cwd: process.cwd(), originator: 'codex_cli_rs', cli_version: '0.160.0' } }) + '\n')
  }
  composer(session)
  return
}
console.log('codex-cli 0.160.0 (stand-in)')

// Its prompt, as Codex 0.160 draws it and takes keys where that matters to Bridge AI
// (codex-rs/tui/src/bottom_pane: chat_composer.rs, paste_burst.rs; history_cell/messages.rs):
//   its screen: what it said last; the messages you sent, each a "› " line drawn dim; its working
//     line while it works ("• Working (2s • esc to interrupt)"); its box, a bold "›" and its
//     placeholder drawn dim (what's typed on the lines under it), a blank line, and its hints dim
//   pastes: it turns bracketed paste on, and takes one whatever the terminal says (its terminal
//     library reads ESC[200~ either way); one over 1,000 characters shows as "[Pasted Content N
//     chars]" in the box, and goes as written
//   keys: a run of them faster than 8 ms apart is a paste, so an Enter among them (within 8 ms of
//     the last, as it reads them) is a newline, not a send; Ctrl+J a newline; Enter otherwise sends
//     what's in the box; Backspace, Ctrl+C clears the box (stops a turn while it works), Esc stops one
//   each message it takes goes in ~/codex-got.log ({ session, text }), as it got it, and it works on
//     it for a second and a half; its first message can come with it as its argument
//   ~/codex-enter-newline there: every Enter is a newline (as one among a paste's keys is), so what's
//     typed stays in its box. ~/codex-slow: it reads what came in every 400 ms, as a busy Codex gets
//     to it, so text and an Enter sent apart can be read together. ~/codex-no-bracketed: bracketed
//     paste left off, as before a terminal has seen it asked for. Keys as they came in ~/codex-typed.log
function composer(session) {
  const flag = (n) => fs.existsSync(path.join(os.homedir(), n))
  const got = (text) => fs.appendFileSync(path.join(os.homedir(), 'codex-got.log'), JSON.stringify({ session, text }) + '\n')
  let box = '' // what's typed, with a placeholder for each long paste
  const pastes = new Map() // placeholder -> the paste
  let pending = '' // keys of a run not in the box yet
  let lastKey = 0
  let pasting = null // a bracketed paste coming in
  let said = 'Ready.'
  let mine = [] // the messages you sent, latest last
  let working = 0 // since when
  let turn = null

  const draw = () => {
    const shown = box.split('\n')
    const lines = [`• ${said}`, '', ...mine.slice(-3).flatMap((m) => [`\x1b[1;2m›\x1b[0m ${m.split('\n')[0]}`, '']),
      working ? `• Working (${Math.round((Date.now() - working) / 1000)}s • esc to interrupt)` : '', '', '',
      box ? `\x1b[1m›\x1b[0m ${shown[0].replace(/\[Pasted Content \d+ chars\]/g, (x) => `\x1b[36m${x}\x1b[0m`)}` : '\x1b[1m›\x1b[0m \x1b[2mAsk Codex to do anything\x1b[0m',
      ...shown.slice(1).map((l) => `  ${l}`), '', `\x1b[2m  ? for shortcuts${' '.repeat(40)}100% context left\x1b[0m`]
    process.stdout.write(`\x1b[2J\x1b[H${'\r\n'.repeat(Math.max(0, (process.stdout.rows || 24) - lines.length - 1))}${lines.join('\r\n')}`)
  }
  const flush = () => { if (pending) { box += pending; pending = '' } }
  const stop = () => { if (!working) return; clearTimeout(turn); working = 0; said = 'Stopped, as you asked.' }
  const submit = () => {
    const text = [...pastes].reduce((t, [k, v]) => t.split(k).join(v), box).trim()
    box = ''
    pastes.clear()
    if (!text) return
    got(text)
    mine.push(text)
    working = Date.now()
    clearTimeout(turn)
    turn = setTimeout(() => { working = 0; said = `Done: ${text.split('\n')[0]}`; draw() }, 1500)
  }
  const paste = (t) => {
    t = t.replace(/\r\n?/g, '\n')
    if ([...t].length > 1000) {
      let k = `[Pasted Content ${[...t].length} chars]`
      for (let n = 2; pastes.has(k); n++) k = `[Pasted Content ${[...t].length} chars] #${n}`
      pastes.set(k, t)
      box += k
    } else box += t
    lastKey = 0
  }
  const key = (k, now) => {
    if (k === '\r') {
      if (flag('codex-enter-newline')) { flush(); box += '\n' } else if (pending && now - lastKey <= 8) pending += '\n'
      else { flush(); submit() }
      return
    }
    if (k.length === 1 && k >= ' ' && k !== '\x7f') { pending += k; lastKey = now; return }
    flush()
    if (k === '\n') box += '\n'
    else if (k === '\x7f' || k === '\b') { const el = [...pastes.keys()].find((p) => box.endsWith(p)); if (el) { box = box.slice(0, -el.length); pastes.delete(el) } else box = Array.from(box).slice(0, -1).join('') }
    else if (k === '\x03') { if (working) stop(); else { box = ''; pastes.clear() } }
    else if (k === '\x1b') stop()
  }
  const take = (chunk, now) => {
    let s = chunk
    while (s.length) {
      if (pasting != null) {
        const end = s.indexOf('\x1b[201~')
        if (end < 0) { pasting += s; s = '' } else { pasting += s.slice(0, end); s = s.slice(end + 6); flush(); paste(pasting); pasting = null }
      } else if (s.startsWith('\x1b[200~')) { pasting = ''; s = s.slice(6) } else if (s.startsWith('\x1b[') || s.startsWith('\x1bO')) {
        const k = /^\x1b[[O][0-9;?]*[A-Za-z~]/.exec(s)
        s = s.slice(k ? k[0].length : 2) // arrows and the like
      } else {
        const [c] = s
        s = s.slice(c.length)
        key(c, now)
      }
    }
  }

  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  if (!flag('codex-no-bracketed')) process.stdout.write('\x1b[?2004h')
  let waiting = []
  process.stdin.on('data', (chunk) => {
    fs.appendFileSync(path.join(os.homedir(), 'codex-typed.log'), JSON.stringify(chunk) + '\n')
    if (flag('codex-slow')) return waiting.push(chunk)
    take(chunk, Date.now())
    draw()
  })
  // Read late: what came in meanwhile, all at once.
  setInterval(() => { if (!waiting.length) return; const now = Date.now(); for (const c of waiting.splice(0)) take(c, now); draw() }, 400)
  // A run of keys goes in once 8 ms pass without one; and the working line counts on.
  setInterval(() => { if (pending && Date.now() - lastKey > 8) { flush(); draw() } }, 4)
  setInterval(() => { if (working) draw() }, 1000)
  const opening = args.filter((a, i) => !a.startsWith('-') && !['--model', '-m', '--sandbox', '--ask-for-approval'].includes(args[i - 1]) && a !== 'resume' && args[i - 1] !== 'resume').pop()
  if (opening) { mine.push(opening); got(opening); working = Date.now(); turn = setTimeout(() => { working = 0; said = `Done: ${opening.split('\n')[0]}`; draw() }, 1500) }
  draw()
}
