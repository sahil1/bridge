// The smoke test a release runs on each built app (scripts/smoke.js), run here against this checkout's
// server, so what it asks of the server can't fall behind it unseen until a release: 3.15.0's builds
// all stopped on it, as it never sent the API's key (3.15.0's) and every request but one was refused.
// The server gets a test's settings: nothing on its PATH but the system's, and no GitHub, usage stats,
// crash reports, accounts, relay or model downloads.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { checks, ROOT, OUT, freePort } from '../lib/harness.mjs'

const { ok, done } = checks('smoke')
const IS_WIN = process.platform === 'win32'

const port = await freePort()
const home = path.join(OUT, 'kits', `smoke-${port}`)
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(home, { recursive: true })
const sr = process.env.SystemRoot || 'C:\\Windows'
const PATH = (IS_WIN ? [path.join(sr, 'System32'), sr, path.join(sr, 'System32', 'WindowsPowerShell', 'v1.0')] : ['/usr/bin', '/bin', '/usr/sbin', '/sbin']).join(path.delimiter)
const nowhere = 'http://127.0.0.1:9'
const env = {
  PATH, BRIDGE_PATH: PATH, HOME: home, LANG: 'en_US.UTF-8', TMPDIR: os.tmpdir(), USER: os.userInfo().username, BRIDGE_RUNTIME: 'builtin',
  BRIDGE_COUNTS_URL: '', BRIDGE_CRASHES_URL: '', BRIDGE_HOSTED_URL: '', BRIDGE_ACCOUNTS_URL: '', BRIDGE_ACCOUNTS_KEY: '',
  BRIDGE_RELAY_SOURCE: nowhere, BRIDGE_RELEASES_API: nowhere, BRIDGE_NODE_DIST: nowhere, BRIDGE_MODELS_URL: nowhere,
  BRIDGE_SHERPA: path.join(ROOT, 'test', 'stand-ins', 'sherpa.cjs'), BRIDGE_APPLICATIONS: path.join(home, 'Applications'),
  SMOKE_FROM_SOURCE: '1', SMOKE_PORT: String(port),
  ...(IS_WIN
    ? { USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), SystemRoot: sr, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT, TEMP: os.tmpdir(), TMP: os.tmpdir() }
    : { BRIDGE_SHELL: '/bin/sh', SHELL: '/bin/sh' }),
}
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'smoke.js')], { cwd: ROOT, env, encoding: 'utf8', timeout: 180_000 })
const out = `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`
const lines = out.split('\n')
for (const name of ['server starts', 'without its key, the API is refused', 'UI is served', 'setup detects agents', 'notifications, phone, updates and diagnostics load', 'a terminal runs a command']) {
  ok(lines.some((l) => l.startsWith(`ok   ${name}`)), `the release's smoke test, from source: ${name}`, lines.find((l) => l.includes(name)) || out.slice(-1500))
}
ok(r.status === 0, 'and it passes as a whole, as each build has to before a release is published', out.slice(-2500))

process.exit(done().fail ? 1 : 0)
