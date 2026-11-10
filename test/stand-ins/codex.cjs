// Stand-in Codex for signing in, in the words Codex prints (codex-rs/cli/src/login.rs and
// codex-rs/login, November 2026). Signed in: $CODEX_HOME/auth.json (else ~/.codex/auth.json) holds
// tokens, which is what Bridge AI looks at too.
//   codex --version
//   codex login status          says whether it's signed in (exits 1 when it isn't)
//   codex login                 the browser's way: listens on localhost (1455 for the real one; here
//                               a free port, in ~/codex-login-port.txt), opens the browser there (with
//                               the stand-in `open` beside it, a test's, never the computer's own),
//                               prints the link and waits. The browser coming back signs it in.
//   codex login --device-auth   a one-time code instead: the page and the code (ABCD-12345), then it
//                               waits until ~/codex-device-ok is there (the test signing in on that
//                               page), and is signed in
//   codex logout
//   codex, with ~/codex-first-run.json there: its own sign-in, waiting for the browser; Esc goes back
//                               to how to sign in, where the second, Sign in with Device Code, shows
//                               the page and the code as the TUI does (keys in ~/codex-typed.log);
//                               signed in there, its welcome, and Enter to its prompt
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
const openBrowser = (url) => { const open = path.join(__dirname, process.platform === 'win32' ? 'open.cmd' : 'open'); if (fs.existsSync(open)) spawn(open, [url], { stdio: 'ignore', shell: process.platform === 'win32' }).unref() }
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
  openBrowser(authorize(1455))
  browser()
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  // Each key on its own, however the terminal hands them over (down and Enter can come as one).
  process.stdin.on('data', (chunk) => {
    fs.appendFileSync(path.join(os.homedir(), 'codex-typed.log'), JSON.stringify(chunk) + '\n')
    for (const d of chunk.match(/\x1b\[[A-D]|\x1b|\r|[^\x1b\r]+/g) || []) key(d)
  })
  function key(d) {
    if (at === 'done') { if (d.includes('\r')) { at = 'main'; screen(['', '› Ask Codex to do anything', '']) } return }
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
console.log('codex-cli 0.160.0 (stand-in)')
