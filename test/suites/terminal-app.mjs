// "Open in your terminal app" on an agent, with no real terminal app. A stand-in notes what it's
// asked to open (on a Mac `open`, on Linux x-terminal-emulator, on Windows what stands in for
// wt.exe and cmd.exe), and this test plays the terminal app: on a Mac or Linux it runs the script
// it was handed in a terminal of its own (a pty, with a terminal app's surroundings: your home, a
// login shell, the system's PATH); on Windows, what the PowerShell command it was handed runs, with
// the variables it sets.
// Nothing runs osascript.
// On a Mac, Settings lists the terminal apps found, and what Automatic opens: the one you have
// open, else the first found, never Warp (which runs nothing it's handed) ahead of Terminal. On
// Windows, Windows Terminal when it's there, else a PowerShell window. What it runs is Bridge AI's
// own CLI on the server's Node (in your login shell, outside Windows), told where this server is.
// Run, it shows the agent's screen and takes keys; Ctrl+] leaves it, and the command ends. Only
// then does the app say it opened ("Opened in Terminal. Ctrl+] detaches there."), having said
// "Opening…" meanwhile. When it can't, it says why and what to do: the app didn't run the command
// (with the command to run in any terminal), the window couldn't show the agent (why, and the
// window stays open to say so too), the app couldn't be opened (macOS's words), or there's no
// terminal app at all.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import pty from 'node-pty'
import { startKit, checks, until, browser, page, shot, withoutCutOff, TEST, ROOT, IS_MAC, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('terminal-app')
const WAIT = 6000
// On Windows the terminal app's place is taken by a stand-in program (BRIDGE_TERMINAL_STANDIN):
// wt.exe and cmd.exe aren't programs a test can put on the PATH in their place.
const kit = await startKit('terminal-app', { env: ({ bin }) => ({ BRIDGE_TERMINAL_WAIT_MS: String(WAIT), ...(IS_WIN ? { BRIDGE_TERMINAL_STANDIN: path.join(bin, 'terminal.cmd') } : {}) }) })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'long-output.cjs'), 'utf8'))
const LOG = path.join(kit.bin, 'terminal-app.log')
const MODE = path.join(kit.bin, 'terminal-app.mode') // ok, or fail: the stand-in fails as macOS's `open` does
const RUNNING = path.join(kit.bin, 'running.txt') // what the stand-in `ps` lists
// A stand-in launcher: notes [what it is, ...its arguments], and fails when told to.
const launcher = (name) => `const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ launch: ${name ? `[${JSON.stringify(name)}, ...args]` : 'args'} }) + '\\n')
let mode = 'ok'; try { mode = fs.readFileSync(${JSON.stringify(MODE)}, 'utf8').trim() } catch {}
if (mode === 'fail') { process.stderr.write("Unable to find application named 'Terminal'\\n"); process.exit(1) }`
kit.program('open', launcher('open'))
kit.program('x-terminal-emulator', launcher('x-terminal-emulator'))
kit.program('terminal', launcher(null)) // Windows: handed what it stands for first
kit.program('osascript', `require('node:fs').appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ osascript: process.argv.slice(2) }) + '\\n')`)
kit.program('ps', `let out = ''; try { out = require('node:fs').readFileSync(${JSON.stringify(RUNNING)}, 'utf8') } catch {} process.stdout.write(out)`)
const APPS = path.join(kit.dir, 'Applications')
const apps = (...names) => { fs.rmSync(APPS, { recursive: true, force: true }); for (const n of names) fs.mkdirSync(path.join(APPS, `${n}.app`, 'Contents', 'MacOS'), { recursive: true }) }
// Windows Terminal, as `where wt.exe` finds it (the stand-in runs in its place).
const windowsTerminal = (on) => { const f = path.join(kit.bin, 'wt.exe'); if (on) fs.writeFileSync(f, ''); else fs.rmSync(f, { force: true }) }
const asked = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const launched = () => asked().filter((x) => x.launch).at(-1)?.launch || null
// What the terminal app was handed to run: the script (Mac, Linux), or PowerShell's command (Windows).
const handed = () => launched()?.at(-1)
const enc = encodeURIComponent
const plainText = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
const APP = IS_MAC ? 'Terminal' : IS_WIN ? 'Windows Terminal' : 'Default terminal'

// The terminal app: runs what it was handed. { text(), write(s), code (null while it runs), stop() }
function terminalApp(what) {
  const t = { out: '', code: null }
  t.text = () => plainText(t.out)
  if (IS_WIN) {
    // $env:NAME='value'; … & 'program' 'argument' …, quoted as PowerShell quotes ('' for ').
    const unq = (x) => x.replace(/''/g, "'")
    const env = Object.fromEntries([...what.matchAll(/\$env:(\w+)='((?:[^']|'')*)'; /g)].map((m) => [m[1], unq(m[2])]))
    const argv = [...(/; & (.+)$/.exec(what)?.[1] || '').matchAll(/'((?:[^']|'')*)'|(\S+)/g)].map((m) => (m[1] != null ? unq(m[1]) : m[2]))
    const ps = spawn(argv[0], argv.slice(1), { cwd: kit.home, env: { ...process.env, USERPROFILE: kit.home, ...env }, windowsHide: true })
    ps.stdout.on('data', (d) => { t.out += d })
    ps.stderr.on('data', (d) => { t.out += d })
    ps.on('exit', (c) => { t.code = c ?? 1 })
    t.write = (s) => ps.stdin.write(s)
    t.stop = () => { try { ps.kill() } catch { /* gone */ } }
    return t
  }
  const env = { HOME: kit.home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/sh', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', USER: process.env.USER || 'me' }
  const p = pty.spawn('/bin/sh', [what], { cols: 100, rows: 30, cwd: kit.home, env })
  p.onData((d) => { t.out += d })
  p.onExit((e) => { t.code = e.exitCode })
  t.write = (s) => p.write(s)
  t.stop = () => { try { p.kill() } catch { /* gone */ } }
  return t
}
const typed = () => { const f = path.join(kit.home, 'agent-input.log'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).join('') : '' }

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const dir = path.join(kit.home, 'code', 'app')
  fs.mkdirSync(dir, { recursive: true })
  const agent = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Billing', newSpace: 'Work', prompt: 'plain 40' })
  await until(async () => /line 40 of/.test((await kit.api(`/agents/${enc(agent.paneId)}/screen?lines=60`)).ansi), 20000)
  fs.writeFileSync(MODE, 'ok')

  // ---------- Which app ----------
  if (IS_MAC) {
    apps('iTerm', 'Warp', 'Terminal')
    const found = await kit.api('/terminals')
    ok(JSON.stringify(found.found.map((t) => t.id)) === '["iterm","warp","terminal"]' && found.app === 'auto', 'Settings lists the terminal apps on this Mac, and "auto" is chosen', found)
    fs.writeFileSync(RUNNING, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal\n/usr/sbin/cfprefsd\n')
    ok((await kit.api('/terminals')).auto?.name === 'Terminal', 'Settings says what Automatic opens: the terminal app you have open', (await kit.api('/terminals')).auto)
    await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).catch(() => {})
    ok(launched()?.[1] === '-a' && launched()?.[2] === 'Terminal', '"auto" picks the terminal app you have open (Terminal, with iTerm installed too)', launched())
    fs.writeFileSync(RUNNING, '')
    await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).catch(() => {})
    ok(launched()?.[2] === 'iTerm', 'with none open, the first found', launched())
    apps('Warp', 'Terminal')
    await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).catch(() => {})
    ok(launched()?.[2] === 'Terminal', 'never Warp, which runs nothing it\'s handed, ahead of Terminal', launched())
    apps('Terminal')
  } else if (IS_WIN) {
    windowsTerminal(false)
    ok(JSON.stringify((await kit.api('/terminals')).found.map((t) => t.id)) === '["powershell"]', 'Windows without Windows Terminal: Settings lists PowerShell', (await kit.api('/terminals')).found)
    fs.rmSync(LOG, { force: true })
    await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).catch(() => {})
    const ps = launched() || []
    ok(ps[0] === 'cmd.exe' && JSON.stringify(ps.slice(1, 6)) === '["/c","start","powershell","-NoExit","-Command"]', 'and opens a PowerShell window (cmd.exe /c start powershell -NoExit -Command …)', ps)
    windowsTerminal(true)
    ok((await kit.api('/terminals')).auto?.id === 'wt', 'with Windows Terminal there, Automatic opens it', (await kit.api('/terminals')).auto)
  } else skip('which app "auto" picks', 'a Mac\'s and Windows\' choice; on Linux the first terminal found')

  // ---------- It opens, attaches, and only then says so ----------
  fs.rmSync(LOG, { force: true })
  const answer = kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
  ok(!!(await until(() => handed(), 5000)), 'it asks the terminal app to open the agent', asked())
  const call = launched() || []
  const what = handed()
  ok(!asked().some((x) => x.osascript), 'never through osascript (which macOS asks permission for)')
  if (IS_WIN) {
    ok(call[0] === 'wt.exe' && JSON.stringify(call.slice(1, 5)) === '["new-tab","powershell","-NoExit","-Command"]', 'in a new tab of Windows Terminal, in PowerShell, which stays open after (wt.exe new-tab powershell -NoExit -Command …)', call)
    ok(what.includes(`$env:BRIDGE_HOME='${kit.data}'; `) && what.includes(`$env:BRIDGE_PORT='${kit.port}'; `) && /\$env:BRIDGE_OPENED='[0-9a-f]{24}'; /.test(what), 'it tells the command where this server is, and how to say it opened', what)
    ok(what.endsWith(`& '${process.execPath}' '${path.join(ROOT, 'scripts', 'cli.js')}' attach '${agent.paneId}'`), 'and runs Bridge AI\'s attach on this server\'s Node', what)
  } else {
    if (IS_MAC) ok(call[0] === 'open' && call[1] === '-a' && call[2] === 'Terminal' && call.length === 4 && /\.command$/.test(what), 'with `open -a Terminal <script>.command`', call)
    else ok(call[0] === 'x-terminal-emulator' && call[1] === '-e' && /\.command$/.test(what), 'with `x-terminal-emulator -e <script>`', call)
    const body = fs.readFileSync(what, 'utf8')
    ok(body.startsWith('#!/bin/sh\n') && (fs.statSync(what).mode & 0o111) !== 0, 'the script is a shell script it can run')
    ok(body.includes(`export BRIDGE_HOME='${kit.data}'`) && body.includes(`export BRIDGE_PORT='${kit.port}'`) && /export BRIDGE_OPENED='[0-9a-f]{24}'/.test(body), 'it tells the command where this server is, and how to say it opened', body)
    const line = body.split('\n').find((l) => l.includes(' -lc ')) || ''
    ok(line.startsWith('"${SHELL:-/bin/sh}" -lc ') && line.includes(process.execPath) && line.includes(path.join(ROOT, 'scripts', 'cli.js')) && line.includes('attach') && line.includes(agent.paneId), 'and runs Bridge AI\'s attach on this server\'s Node, in your login shell', line)
    ok(/&& exit 0\nprintf '\\n%s ' 'Press Return to close this window\.'\nread reply\n$/.test(body), 'when that fails, the window stays open to say why', body)
  }
  let early = null
  answer.then((x) => { early ||= x })
  await new Promise((r) => setTimeout(r, 1500))
  ok(early === null, 'until the window shows the agent, the app doesn\'t answer that it opened', early)
  const term = terminalApp(what)
  ok(!!(await until(() => /line 40 of the agent's output/.test(term.text()), 20000)), 'run as the terminal app runs it, it shows the agent\'s screen', term.text().slice(-400))
  const got = await answer
  ok(got.r?.app === APP && got.r?.attached === true, `and the app answers that it opened in ${APP}`, got)
  fs.rmSync(path.join(kit.home, 'agent-input.log'), { force: true })
  term.write('hello from the terminal app')
  ok(!!(await until(() => /hello from the terminal app/.test(typed()), 8000)), 'what you type there reaches the agent', typed())
  term.write('\x1d')
  ok(!!(await until(() => term.code !== null, 8000)) && term.code === 0, 'Ctrl+] leaves it, and the command ends', { code: term.code, tail: term.text().slice(-200) })
  ok(/Detached from Work › Billing/.test(term.text()) && !/Press Return/.test(term.text()), 'saying it detached, nothing to read', term.text().slice(-200))
  term.stop()

  // ---------- The app didn't run it ----------
  fs.rmSync(LOG, { force: true })
  const t0 = Date.now()
  const silent = await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
  ok(!silent.r && Date.now() - t0 >= WAIT - 500, 'when nothing runs the command, it doesn\'t say it opened', silent)
  ok(new RegExp(`didn't run Bridge AI's command within ${WAIT / 1000} seconds, so the agent isn't open there`).test(silent.e || ''), 'it says so', silent.e)
  if (IS_WIN) skip('and gives the command to run in any terminal instead', 'on Windows the command is PowerShell\'s, in the error above it')
  else ok((silent.e || '').includes(`run this in any terminal: sh '${handed()}'`), 'and gives the command to run in any terminal instead', silent.e)

  // ---------- The window couldn't show the agent ----------
  const gone = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Short-lived', newSpace: 'Work', prompt: 'plain 5' })
  await until(async () => /line 5 of/.test((await kit.api(`/agents/${enc(gone.paneId)}/screen?lines=20`)).ansi), 20000)
  fs.rmSync(LOG, { force: true })
  const failing = kit.api(`/panes/${enc(gone.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
  await until(() => handed(), 5000)
  const goneWhat = handed()
  const goneCall = launched() || []
  const fleet = await kit.api('/fleet')
  await kit.api(`/tabs/${enc(fleet.tabs.find((x) => x.panes.some((q) => q.paneId === gone.paneId)).tabId)}/close`, {})
  await until(async () => !(await kit.api('/panes')).panes.some((q) => q.paneId === gone.paneId), 5000)
  const broken = terminalApp(goneWhat)
  const why = await failing
  ok(!why.r && /opened, but couldn't show the agent: No agent or shell matches/.test(why.e || ''), 'when the window can\'t show the agent, the app says why', why)
  if (IS_WIN) {
    ok(!!(await until(() => /No agent or shell matches/.test(broken.text()), 8000)) && goneCall.includes('-NoExit'), 'and the window says why too, PowerShell staying open (-NoExit)', { text: broken.text().slice(-300), call: goneCall })
    broken.stop()
  } else {
    ok(!!(await until(() => /No agent or shell matches/.test(broken.text()) && /Press Return to close this window\./.test(broken.text()), 8000)) && broken.code === null, 'and the window says why too, staying open', broken.text().slice(-300))
    broken.write('\r')
    ok(!!(await until(() => broken.code !== null, 5000)), 'until Return is pressed')
  }

  // ---------- The app can't be opened, and no terminal app ----------
  if (IS_MAC) {
    fs.writeFileSync(MODE, 'fail')
    const t1 = Date.now()
    const failed = await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
    ok(!failed.r && failed.e === "Couldn't open Terminal: Unable to find application named 'Terminal'" && Date.now() - t1 < WAIT, 'when macOS can\'t open the app, it says so at once, in macOS\'s words', failed)
    fs.writeFileSync(MODE, 'ok')
    apps()
    const none = await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
    ok(/^No terminal app found on this Mac to open it in\. In any terminal, run: sh '.+attach-w\d+_p\d+\.command'$/.test(none.e || ''), 'with no terminal app at all, it says what to run instead', none)
    apps('Terminal')
  } else if (IS_WIN) {
    fs.writeFileSync(MODE, 'fail')
    const t1 = Date.now()
    const failed = await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
    ok(!failed.r && failed.e === "Couldn't open Windows Terminal: wt.exe stopped (1)" && Date.now() - t1 < WAIT, 'when Windows Terminal can\'t be started, it says so at once', failed)
    fs.writeFileSync(MODE, 'ok')
    skip('with no terminal app at all, it says what to run instead', 'Windows always has PowerShell')
  } else skip('when the app can\'t be opened, and with none at all', 'the Mac\'s and Windows\' ways; on Linux the terminal is found on the PATH')

  // ---------- In the app ----------
  const { b, which } = await browser()
  const tag = which === 'webkit' ? 'webkit-' : ''
  try {
    const { ctx, p, errors } = await page(b, kit.url, { height: 900 })
    await p.locator('.tab-main', { hasText: 'Billing' }).first().click({ timeout: 20000 })
    const btn = p.locator('.console button[aria-label="Open in your terminal app"]').first()
    const note = () => p.locator('.console .comp-note, .console .keybar .flash').first().innerText().catch(() => '')
    fs.rmSync(LOG, { force: true })
    await btn.click()
    ok(!!(await until(async () => /Opening in your terminal app…/.test(await note()), 3000)) && await btn.isDisabled(), 'the button says it\'s opening, and waits', await note())
    await until(() => handed(), 5000)
    const t2 = terminalApp(handed())
    ok(!!(await until(async () => (await note()) === `Opened in ${APP}. Ctrl+] detaches there.`, 20000)), `once the agent shows there: Opened in ${APP}. Ctrl+] detaches there.`, await note())
    await shot(p, `${tag}terminal-app-opened`)
    t2.write('\x1d')
    await until(() => t2.code !== null, 5000)
    t2.stop()
    fs.rmSync(LOG, { force: true })
    await btn.click()
    ok(!!(await until(async () => /didn't run Bridge AI's command/.test(await note()), WAIT + 5000)), 'when nothing ran it, the button says why, not that it opened', await note())
    ok(!/Opened in/.test(await note()), 'and never "Opened in"')
    await shot(p, `${tag}terminal-app-not-opened`)
    ok(withoutCutOff(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  } finally { await b.close() }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
