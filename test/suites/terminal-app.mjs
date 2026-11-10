// "Open in your terminal app" on an agent, with no real terminal app: on a Mac a stand-in `open`
// notes what it's asked and this test plays the terminal app, running the script it was handed in
// a terminal of its own (a pty, with a terminal app's surroundings: your home, a login shell, the
// system's PATH); elsewhere a stand-in x-terminal-emulator. Nothing runs osascript.
// Settings lists the terminal apps found, and what Automatic opens: the one you have open, else the
// first found, never Warp (which runs nothing it's handed) ahead of Terminal. The script runs Bridge AI's own
// CLI on the server's Node, in your login shell, told where this server is. Run, it shows the
// agent's screen and takes keys; Ctrl+] leaves it, and the window closes. Only then does the app
// say it opened ("Opened in Terminal. Ctrl+] detaches there."), having said "Opening…" meanwhile.
// When it can't, it says why and what to do: the app didn't run the script (with the command to
// run in any terminal), the window couldn't show the agent (why, and the window stays open until
// Return), `open` failed (its own words), or there's no terminal app at all.
import fs from 'node:fs'
import path from 'node:path'
import pty from 'node-pty'
import { startKit, checks, until, browser, page, shot, withoutCutOff, TEST, ROOT, IS_MAC, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('terminal-app')
if (IS_WIN) { skip('Open in your terminal app', 'runs through PowerShell on Windows, not covered here'); process.exit(0) }
const WAIT = 6000
const kit = await startKit('terminal-app', { env: { BRIDGE_TERMINAL_WAIT_MS: String(WAIT) } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'long-output.cjs'), 'utf8'))
const LOG = path.join(kit.bin, 'terminal-app.log')
const MODE = path.join(kit.bin, 'terminal-app.mode') // ok, or fail: the stand-in `open` fails as macOS's does
const RUNNING = path.join(kit.bin, 'running.txt') // what the stand-in `ps` lists
const note = (name) => `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ ${name}: process.argv.slice(2) }) + '\\n')`
kit.program('open', `${note('open')}
let mode = 'ok'; try { mode = fs.readFileSync(${JSON.stringify(MODE)}, 'utf8').trim() } catch {}
if (mode === 'fail') { process.stderr.write("Unable to find application named 'Terminal'\\n"); process.exit(1) }`)
kit.program('x-terminal-emulator', note('open'))
kit.program('osascript', note('osascript'))
kit.program('ps', `let out = ''; try { out = require('node:fs').readFileSync(${JSON.stringify(RUNNING)}, 'utf8') } catch {} process.stdout.write(out)`)
const APPS = path.join(kit.dir, 'Applications')
const apps = (...names) => { fs.rmSync(APPS, { recursive: true, force: true }); for (const n of names) fs.mkdirSync(path.join(APPS, `${n}.app`, 'Contents', 'MacOS'), { recursive: true }) }
const asked = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const enc = encodeURIComponent
const plainText = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')

// The terminal app: runs the script it was handed, in a terminal of its own.
function terminalApp(file) {
  const t = { out: '', code: null }
  const env = { HOME: kit.home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/sh', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', USER: process.env.USER || 'me' }
  t.p = pty.spawn('/bin/sh', [file], { cols: 100, rows: 30, cwd: kit.home, env })
  t.p.onData((d) => { t.out += d })
  t.p.onExit((e) => { t.code = e.exitCode })
  t.text = () => plainText(t.out)
  return t
}
// The script handed to the terminal app by the last open.
const handed = () => asked().filter((x) => x.open).at(-1)?.open.at(-1)

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const dir = path.join(kit.home, 'code', 'app')
  fs.mkdirSync(dir, { recursive: true })
  const agent = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Billing', newSpace: 'Work', prompt: 'plain 40' })
  await until(async () => /line 40 of/.test((await kit.api(`/agents/${enc(agent.paneId)}/screen?lines=60`)).ansi), 20000)

  // ---------- Which app ----------
  if (IS_MAC) {
    apps('iTerm', 'Warp', 'Terminal')
    const found = await kit.api('/terminals')
    ok(JSON.stringify(found.found.map((t) => t.id)) === '["iterm","warp","terminal"]' && found.app === 'auto', 'Settings lists the terminal apps on this Mac, and "auto" is chosen', found)
    fs.writeFileSync(MODE, 'ok')
    fs.writeFileSync(RUNNING, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal\n/usr/sbin/cfprefsd\n')
    ok((await kit.api('/terminals')).auto?.name === 'Terminal', 'Settings says what Automatic opens: the terminal app you have open', (await kit.api('/terminals')).auto)
    await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).catch(() => {})
    ok(/^-a$/.test(asked().at(-1)?.open?.[0] || '') && asked().at(-1).open[1] === 'Terminal', '"auto" picks the terminal app you have open (Terminal, with iTerm installed too)', asked().at(-1))
    fs.writeFileSync(RUNNING, '')
    await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).catch(() => {})
    ok(asked().at(-1)?.open?.[1] === 'iTerm', 'with none open, the first found', asked().at(-1))
    apps('Warp', 'Terminal')
    await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).catch(() => {})
    ok(asked().at(-1)?.open?.[1] === 'Terminal', 'never Warp, which runs nothing it\'s handed, ahead of Terminal', asked().at(-1))
    apps('Terminal')
  }

  // ---------- It opens, attaches, and only then says so ----------
  fs.rmSync(LOG, { force: true })
  const answer = kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
  ok(!!(await until(() => handed(), 5000)), 'it asks the terminal app to open a script', asked())
  const call = asked().find((x) => x.open)?.open || []
  const file = handed()
  if (IS_MAC) ok(call[0] === '-a' && call[1] === 'Terminal' && call.length === 3 && /\.command$/.test(file), 'with `open -a Terminal <script>.command`', call)
  ok(!asked().some((x) => x.osascript), 'and never through osascript (which macOS asks permission for)')
  const body = fs.readFileSync(file, 'utf8')
  ok(body.startsWith('#!/bin/sh\n') && (fs.statSync(file).mode & 0o111) !== 0, 'the script is a shell script it can run')
  ok(body.includes(`export BRIDGE_HOME='${kit.data}'`) && body.includes(`export BRIDGE_PORT='${kit.port}'`) && /export BRIDGE_OPENED='[0-9a-f]{24}'/.test(body), 'it tells the command where this server is, and how to say it opened', body)
  const line = body.split('\n').find((l) => l.includes(' -lc ')) || ''
  ok(line.startsWith('"${SHELL:-/bin/sh}" -lc ') && line.includes(process.execPath) && line.includes(path.join(ROOT, 'scripts', 'cli.js')) && line.includes('attach') && line.includes(agent.paneId), 'and runs Bridge AI\'s attach on this server\'s Node, in your login shell', line)
  ok(/&& exit 0\nprintf '\\n%s ' 'Press Return to close this window\.'\nread reply\n$/.test(body), 'when that fails, the window stays open to say why', body)
  let early = null
  answer.then((x) => { early ||= x })
  await new Promise((r) => setTimeout(r, 1500))
  ok(early === null, 'until the window shows the agent, the app doesn\'t answer that it opened', early)
  const term = terminalApp(file)
  ok(!!(await until(() => /line 40 of the agent's output/.test(term.text()), 15000)), 'run as a terminal app runs it, it shows the agent\'s screen', term.text().slice(-400))
  const got = await answer
  ok(got.r?.app === (IS_MAC ? 'Terminal' : 'Default terminal') && got.r?.attached === true, 'and the app answers that it opened there', got)
  fs.rmSync(path.join(kit.home, 'agent-input.log'), { force: true })
  term.p.write('hello from the terminal app')
  ok(!!(await until(() => fs.existsSync(path.join(kit.home, 'agent-input.log')) && /hello from the terminal app/.test(fs.readFileSync(path.join(kit.home, 'agent-input.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).join('')), 8000)), 'what you type there reaches the agent')
  term.p.write('\x1d')
  ok(!!(await until(() => term.code !== null, 8000)) && term.code === 0, 'Ctrl+] leaves it, and the window\'s command ends', { code: term.code, tail: term.text().slice(-200) })
  ok(/Detached from Work › Billing/.test(term.text()) && !/Press Return/.test(term.text()), 'saying it detached, nothing to read', term.text().slice(-200))

  // ---------- The app didn't run it ----------
  fs.rmSync(LOG, { force: true })
  const t0 = Date.now()
  const silent = await kit.api(`/panes/${enc(agent.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
  ok(!silent.r && Date.now() - t0 >= WAIT - 500, 'when nothing runs the script, it doesn\'t say it opened', silent)
  ok(new RegExp(`didn't run Bridge AI's command within ${WAIT / 1000} seconds, so the agent isn't open there`).test(silent.e || '') && (silent.e || '').includes(`run this in any terminal: sh '${handed()}'`), 'it says so, and the command to run in any terminal instead', silent.e)

  // ---------- The window couldn't show the agent ----------
  const gone = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Short-lived', newSpace: 'Work', prompt: 'plain 5' })
  await until(async () => /line 5 of/.test((await kit.api(`/agents/${enc(gone.paneId)}/screen?lines=20`)).ansi), 20000)
  fs.rmSync(LOG, { force: true })
  const failing = kit.api(`/panes/${enc(gone.paneId)}/terminal`, {}).then((r) => ({ r }), (e) => ({ e: e.message }))
  await until(() => handed(), 5000)
  const goneFile = handed()
  const fleet = await kit.api('/fleet')
  await kit.api(`/tabs/${enc(fleet.tabs.find((x) => x.panes.some((q) => q.paneId === gone.paneId)).tabId)}/close`, {})
  await until(async () => !(await kit.api('/panes')).panes.some((q) => q.paneId === gone.paneId), 5000)
  const broken = terminalApp(goneFile)
  const why = await failing
  ok(!why.r && /opened, but couldn't show the agent: No agent or shell matches/.test(why.e || ''), 'when the window can\'t show the agent, the app says why', why)
  ok(!!(await until(() => /No agent or shell matches/.test(broken.text()) && /Press Return to close this window\./.test(broken.text()), 8000)) && broken.code === null, 'and the window says why too, staying open', broken.text().slice(-300))
  broken.p.write('\r')
  ok(!!(await until(() => broken.code !== null, 5000)), 'until Return is pressed')

  // ---------- open fails, and no terminal app ----------
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
  }

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
    ok(!!(await until(async () => (await note()) === `Opened in ${IS_MAC ? 'Terminal' : 'Default terminal'}. Ctrl+] detaches there.`, 15000)), 'once the agent shows there: Opened in Terminal. Ctrl+] detaches there.', await note())
    await shot(p, `${tag}terminal-app-opened`)
    t2.p.write('\x1d')
    await until(() => t2.code !== null, 5000)
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
