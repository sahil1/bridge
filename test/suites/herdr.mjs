// The herdr runtime. First with a herdr too old for Bridge AI (a stand-in that says it's 0.8.2):
// agents run in Bridge AI itself, and the app is told why. Then against the real herdr, when one is
// here (BRIDGE_TEST_HERDR names it, else `herdr` on this computer's PATH; CI downloads a release on
// Linux): its server started from Bridge AI in a home of its own, Bridge AI on it, a stand-in
// Claude Code (stand-ins/claude.cjs, never the real one) started with a short opening prompt on
// its command line and with a long one sent once it's up, its screen read, typed into, and closed;
// a start herdr refuses leaving no tab behind; an out-of-date herdr integration named with the
// command that updates it. Not on Windows, where Bridge AI doesn't drive herdr.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, checks, until, IS_WIN, TEST } from '../lib/harness.mjs'

const { ok, skip, done } = checks('herdr')
if (IS_WIN) {
  skip('the herdr runtime', 'Bridge AI talks to herdr over a Unix socket, so not on Windows')
  process.exit(done().fail ? 1 : 0)
}

// ---------- A herdr too old ----------
const old = await startKit('herdr-old', {
  config: { runtime: 'herdr' },
  env: ({ bin }) => {
    fs.writeFileSync(path.join(bin, 'herdr'), '#!/bin/sh\necho "herdr 0.8.2"\n', { mode: 0o755 })
    return { BRIDGE_RUNTIME: 'herdr', HERDR_BIN: path.join(bin, 'herdr') }
  },
})
try {
  const rt = (await old.api('/config')).runtime
  ok(rt.name === 'builtin', 'herdr 0.8.2 installed and chosen: agents run in Bridge AI itself instead', rt)
  ok(/0\.8\.2/.test(rt.fellBack?.why || '') && /0\.9\.0/.test(rt.fellBack?.why || ''), 'and the app is told why: its version and the oldest that works', rt.fellBack)
  ok(/herdr update/.test(old.log()), 'the server log says so too, with how to update', old.log().slice(-600))
} catch (e) {
  ok(false, `the old herdr part crashed: ${e.message}`)
} finally {
  old.stop()
}

// ---------- The real herdr ----------
const which = (name) => (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, name)).find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true } catch { return false } })
const HERDR = process.env.BRIDGE_TEST_HERDR || which('herdr')
if (!HERDR || !fs.existsSync(HERDR)) {
  skip('the herdr runtime against a real herdr', 'no herdr here: BRIDGE_TEST_HERDR names one (CI downloads it on Linux)')
  process.exit(done().fail ? 1 : 0)
}
const ver = spawnSync(HERDR, ['--version'], { encoding: 'utf8' }).stdout?.trim()
console.log(`Using ${ver} at ${HERDR}`)

// herdr's home, which is Bridge AI's too (it finds herdr's sockets under ~/.config/herdr): in /tmp,
// not the system's temporary folder, since a socket's path can't be longer than about a hundred
// characters (a Mac's is half that already).
const home = fs.mkdtempSync('/tmp/bh-')
const own = path.join(home, 'bin')
const work = path.join(home, 'work')
for (const d of [path.join(own, 'claude-agent'), work, path.join(home, '.config', 'herdr'), path.join(home, '.codex')]) fs.mkdirSync(d, { recursive: true })
// The stand-in Claude Code, run as `node …/claude.js` the way an npm install runs it, so herdr
// knows it for Claude Code.
fs.writeFileSync(path.join(own, 'claude-agent', 'package.json'), '{ "type": "commonjs" }\n')
fs.copyFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), path.join(own, 'claude-agent', 'claude.js'))
fs.writeFileSync(path.join(own, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(own, 'claude-agent', 'claude.js')}" "$@"\n`, { mode: 0o755 })
// Panes run a plain /bin/sh, not a login shell: a login shell on a Mac puts the system's folders
// (and any real agents in them) ahead of the stand-ins on PATH.
fs.writeFileSync(path.join(home, '.config', 'herdr', 'config.toml'), 'onboarding = false\n\n[terminal]\nshell_mode = "non_login"\ndefault_shell = "/bin/sh"\n')
// herdr's Codex hooks from before 0.9.5, which herdr says to update.
fs.writeFileSync(path.join(home, '.codex', 'herdr-agent-state.sh'), '#!/bin/sh\n# HERDR_INTEGRATION_VERSION=3\n')

const herdr = (...a) => spawnSync(HERDR, a, { encoding: 'utf8', timeout: 30000, env: { PATH: '/usr/bin:/bin', HOME: home, HERDR_SOCKET_PATH: path.join(home, '.config', 'herdr', 'sessions', 'main', 'herdr.sock') } })
const kit = await startKit('herdr', {
  config: { runtime: 'herdr' },
  env: ({ PATH }) => ({ BRIDGE_RUNTIME: 'herdr', HERDR_BIN: HERDR, HOME: home, PATH: `${own}${path.delimiter}${PATH}`, BRIDGE_PATH: `${own}${path.delimiter}${PATH}`, CLAUDE_STAND_IN: 'fresh' }),
})
const read = (f) => { try { return fs.readFileSync(path.join(home, f), 'utf8') } catch { return '' } }
const plain = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') // eslint-disable-line no-control-regex
try {
  ok((await kit.api('/config')).runtime?.name === 'herdr', 'Bridge AI runs on herdr')
  const before = await kit.api('/herdr/sessions')
  ok(before.installed === true && !before.sessions.some((s) => s.running), 'herdr is found, with no session running yet', before)
  // herdr's headless server, started from Bridge AI as from the sidebar's session menu.
  const started = await kit.api('/herdr/sessions', { name: 'main' })
  ok(started.started || started.already, 'a herdr session starts in the background', started)
  const sessions = await kit.api('/herdr/sessions')
  ok(sessions.sessions.some((s) => s.name === 'main' && s.running && s.current), 'and it\'s the one in view', sessions.sessions)
  const codex = (sessions.outdated || []).find((o) => o.target === 'codex')
  ok(codex?.command === 'herdr integration install codex' && codex.label === 'Codex', 'herdr\'s out-of-date Codex integration is named, with the command that updates it', sessions.outdated)

  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  const agentAt = async (paneId) => ((await kit.api('/fleet')).agents || []).find((a) => a.paneId === paneId)

  // A short opening prompt goes on the command line.
  const t0 = Date.now()
  const one = await kit.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Short', newSpace: 'Herdr test', prompt: 'look at the tests' })
  ok(!!one.paneId && Date.now() - t0 < 45000, 'an agent starts in herdr', { one, ms: Date.now() - t0 })
  const startedWith = () => read('claude-started.log').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  ok(startedWith().some((a) => a.includes('look at the tests')), 'with its short opening prompt on its command line', startedWith())
  const a1 = await until(() => agentAt(one.paneId), 15000)
  ok(a1?.kind === 'claude' && ['idle', 'done'].includes(a1.status), 'it\'s listed as a Claude Code agent, ready', a1)

  // Its screen, read through herdr.
  const screen = async (p) => plain((await kit.api(`/agents/${encodeURIComponent(p)}/screen?lines=60`)).ansi)
  ok(!!(await until(async () => /auto mode on/.test(await screen(one.paneId)), 10000)), 'its screen can be read', (await screen(one.paneId)).slice(-400))

  // Typed into, as from its terminal, and a message as from Chat.
  await kit.api(`/panes/${encodeURIComponent(one.paneId)}/text`, { text: 'typed from the test', enter: true })
  ok(!!(await until(() => read('claude-typed.log').includes('typed from the test'), 10000)), 'what\'s typed reaches it', read('claude-typed.log'))
  await kit.api(`/agents/${encodeURIComponent(one.paneId)}/prompt`, { text: 'and a message' })
  ok(!!(await until(() => read('claude-typed.log').includes('and a message'), 10000)), 'a message reaches it', read('claude-typed.log'))

  // A long opening prompt, one line with nothing a shell reads into (more than a shell still
  // starting takes in one line on a Mac), goes in once the agent is up, whole.
  const long = `Please read every file in this folder and say what each one does, ${Array.from({ length: 160 }, (_, i) => `part${i}`).join(' ')} and that is all.`
  const two = await kit.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Long', newSpace: 'Herdr test', prompt: long })
  ok(!!two.paneId && two.paneId !== one.paneId, 'an agent with a long opening prompt starts', two)
  ok(startedWith().length === 2 && !startedWith()[1].some((a) => a.includes('part1 ')), 'not with it on its command line', startedWith()[1])
  ok(!!(await until(() => read('claude-typed.log').includes(long), 15000)), `and the whole prompt (${long.length} characters) reaches it once it's up`, read('claude-typed.log').slice(-300))
  const a2 = await until(() => agentAt(two.paneId), 10000)
  ok(a2?.kind === 'claude', 'and it\'s listed too', a2)

  // A start herdr refuses (an argument it can't put in a shell) leaves no tab behind.
  process.env.HOME = home
  process.env.HERDR_BIN = HERDR
  process.env.HERDR_SOCKET_PATH = path.join(home, '.config', 'herdr', 'sessions', 'main', 'herdr.sock')
  const cli = await import('../../server/runtime/herdr-cli.js')
  const refused = await cli.launchTask({ name: `ba-refused-${Date.now()}`, kind: 'claude', cwd: work, label: 'Refused', args: ['bad\u0007argument'] }).then((r) => ({ r }), (e) => ({ e }))
  ok(!!refused.e, 'herdr refuses a start it can\'t type into a shell', refused.r)
  const tabs = JSON.parse(herdr('api', 'snapshot').stdout || '{}').result?.snapshot?.workspaces || []
  ok(!tabs.some((w) => w.label === 'Refused'), 'and the space made for it is closed again, not left with a bare shell', tabs.map((w) => w.label))

  // A space with a herdr worktree space open (made with herdr's own `worktree create`): closing it
  // alone is refused in plain words naming the other, rather than closing that one too.
  const git = (...a) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], { cwd: path.join(home, 'repo'), encoding: 'utf8' })
  fs.mkdirSync(path.join(home, 'repo'))
  if (git('init', '-q').status !== 0 || git('commit', '-q', '--allow-empty', '-m', 'start').status !== 0) skip('closing a space with a herdr worktree open', 'no git here')
  else {
    const repoWs = JSON.parse(herdr('workspace', 'create', '--cwd', path.join(home, 'repo'), '--label', 'Repo', '--no-focus').stdout).result?.workspace?.workspace_id
    const tree = herdr('worktree', 'create', '--workspace', repoWs, '--branch', 'try-this', '--label', 'Try this', '--no-focus')
    ok(tree.status === 0, 'herdr makes a worktree space beside it', tree.stdout + tree.stderr)
    const refusedClose = await kit.api(`/workspaces/${encodeURIComponent(repoWs)}/close`, {}).then(() => null, (e) => e.message)
    ok(/worktree spaces open \(Try this\)\. Close those first/.test(refusedClose || ''), 'closing its main space alone says which to close first', refusedClose)
    const spaces = () => (JSON.parse(herdr('api', 'snapshot').stdout || '{}').result?.snapshot?.workspaces || []).map((w) => w.label)
    ok(spaces().includes('Try this') && spaces().includes('Repo'), 'and closes neither', spaces())
    const treeWs = (await kit.api('/fleet')).workspaces.find((w) => w.label === 'Try this')?.id
    await kit.api(`/workspaces/${encodeURIComponent(treeWs)}/close`, {})
    await kit.api(`/workspaces/${encodeURIComponent(repoWs)}/close`, {})
    ok(!spaces().includes('Try this') && !spaces().includes('Repo'), 'the worktree space first, then the main one, close', spaces())
  }

  // Closed: the first agent's tab, then the other's space.
  await kit.api(`/tabs/${encodeURIComponent(a1.tabId)}/close`, {})
  ok(!!(await until(async () => !(await agentAt(one.paneId)), 10000)), 'closing its tab ends the agent')
  await kit.api(`/workspaces/${encodeURIComponent(a2.workspaceId)}/close`, {})
  ok(!!(await until(async () => !(await agentAt(two.paneId)), 10000)), 'closing its space ends the other')
  const left = JSON.parse(herdr('api', 'snapshot').stdout || '{}').result?.snapshot?.workspaces || []
  ok(!left.some((w) => w.label === 'Herdr test'), 'and herdr has closed both spaces', left.map((w) => w.label))
} catch (e) {
  ok(false, `crashed: ${e.message}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop()
  herdr('session', 'stop', 'main', '--json')
  fs.rmSync(home, { recursive: true, force: true })
}
process.exit(done().fail ? 1 : 0)
