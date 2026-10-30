// Signing in to Cloudflare with the browser (relay.js runs Cloudflare's wrangler through npx), on
// any platform, with a stand-in npx: like the real one it's a process that starts another, which
// waits for the browser on port 8976, and prints wrangler's error lines. Checks that the error shown
// is wrangler's own "[ERROR]" line (not "Logs were written to…"), that a sign-in left waiting by an
// earlier run is stopped with everything it started, and that a port taken by something else
// doesn't stop the sign-in. And npm: npx gets Bridge AI's own cache (not ~/.npm) and your
// ~/.npmrc, and when npm itself fails (a cache folder it can't write, as on a real new Mac; no
// network) it's said in plain words, not where npm wrote its log. And inside the app (the server on
// the app itself, as Node, when Electron is installed): wrangler gets a real Node.js, never the
// app's own `node` stand-in. Nothing reaches Cloudflare or npm and no browser opens.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { startKit, checks, until, sleep, stopTree, electronBin } from '../lib/harness.mjs'

const { ok, skip, done } = checks('relay-signin')
const kit = await startKit('relay-signin')
const CTL = path.join(kit.bin, 'standin.json') // { wait, forcePort }: what the next login does
const ARGS = path.join(kit.bin, 'npx-args.log')
const NPX = `// Stand-in npx for wrangler. The child (--child) is "wrangler", waiting on the callback port.
const fs = require('fs'), net = require('net'), path = require('path'), { spawn } = require('child_process')
const a = process.argv.slice(2)
const ctl = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'standin.json'), 'utf8')) } catch { return {} } })()
// npm failing before wrangler starts, in npm 10's words (the first from a real new Mac's log).
const NPM = {
  eacces: ['code EEXIST', 'syscall rename', 'path /tmp/npm-cache/_cacache/tmp/fb29886c', 'dest /tmp/npm-cache/_cacache/content-v2/sha512/4d/de/faab', 'errno -13', "EACCES: permission denied, rename '/tmp/npm-cache/_cacache/tmp/fb29886c' -> '/tmp/npm-cache/_cacache/content-v2/sha512/4d/de/faab'", 'File exists: /tmp/npm-cache/_cacache/content-v2/sha512/4d/de/faab', 'Remove the existing file and try again, or run npm', 'with --force to overwrite files recklessly.', 'A complete log of this run can be found in: /tmp/npm-cache/_logs/2026-10-28T03_53_10_441Z-debug-0.log'],
  offline: ['code ENOTFOUND', 'syscall getaddrinfo', 'errno ENOTFOUND', 'network request to https://registry.npmjs.org/wrangler failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org', 'network This is a problem related to network connectivity.', 'A complete log of this run can be found in: /tmp/npm-cache/_logs/2026-10-28T03_53_10_441Z-debug-0.log'],
}
const logsLine = '\\n\\n\\u{1FAB5}  Logs were written to "' + path.join(__dirname, 'wrangler.log') + '"\\n'
if (a[0] === '--child') {
  const port = Number(a[1])
  const s = net.createServer()
  s.once('error', () => { process.stderr.write('\\x1b[31m\\u2718 [ERROR]\\x1b[0m The OAuth callback server could not bind to localhost:' + port + ' because the port is already in use. Stop the process using that port or pass a different \`--callback-port\`.' + logsLine); process.exit(1) })
  s.listen(port, 'localhost', () => {
    process.stdout.write('Attempting to login via OAuth...\\nVisit this link to authenticate: https://dash.cloudflare.com/oauth2/auth?response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A' + port + '%2Foauth%2Fcallback\\n')
    setTimeout(() => { process.stderr.write('\\x1b[31m\\u2718 [ERROR]\\x1b[0m Timed out waiting for authorization code, please try again.' + logsLine); process.exit(1) }, Number(a[2]) || 3000)
  })
} else {
  fs.appendFileSync(path.join(__dirname, 'npx-args.log'), JSON.stringify(a) + '\\n')
  // The node its wrangler would run on: the first on its PATH.
  const node = (process.env.PATH || '').split(path.delimiter).find((d) => d && ['node', 'node.exe', 'node.cmd'].some((n) => fs.existsSync(path.join(d, n)))) || null
  fs.writeFileSync(path.join(__dirname, 'npx-env.json'), JSON.stringify({ cache: process.env.npm_config_cache, userconfig: process.env.npm_config_userconfig, node }))
  if (ctl.npm && a.includes('login')) { process.stderr.write(NPM[ctl.npm].map((l) => 'npm error ' + l).join('\\n') + '\\n'); process.exit(ctl.npm === 'eacces' ? 243 : 1) }
  if (a.includes('auth')) { process.stderr.write('\\u2718 [ERROR] Not logged in.' + logsLine); process.exit(1) }
  const i = a.indexOf('--callback-port')
  const port = ctl.forcePort || (i >= 0 ? Number(a[i + 1]) : 8976)
  const c = spawn(process.execPath, [__filename, '--child', String(port), String(ctl.wait || 1500), 'wrangler'], { stdio: 'inherit' })
  c.on('exit', (code) => process.exit(code ?? 1))
}
`
kit.program('npx', NPX)
const signIn = async (ctl) => {
  fs.writeFileSync(CTL, JSON.stringify(ctl))
  return kit.api('/relay/deploy', { method: 'browser' }).then(() => null, (e) => e.message)
}
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const portTaken = (port) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(true)); s.listen(port, 'localhost', () => s.close(() => resolve(false))) })
const logins = () => (fs.existsSync(ARGS) ? fs.readFileSync(ARGS, 'utf8') : '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.includes('login'))

try {
  // 1. The error shown is wrangler's own, not where it wrote its log.
  let e = await signIn({ wait: 1500 })
  ok(e === 'Timed out waiting for authorization code, please try again.', 'a failed sign-in shows wrangler\'s [ERROR] line, not "Logs were written to"', e)
  ok(!(await portTaken(8976)), 'and nothing is left waiting on its port')

  // 2. A sign-in left waiting by an earlier run (written down in login.pid) is stopped first, with
  // the "wrangler" it started, so this one gets the port.
  const left = spawn(process.execPath, [path.join(kit.bin, 'npx.cjs'), '-y', 'wrangler@4.149.0', 'login'], { detached: process.platform !== 'win32', stdio: 'ignore' })
  fs.writeFileSync(CTL, JSON.stringify({ wait: 120000 }))
  fs.mkdirSync(path.join(kit.data, 'cloudflare'), { recursive: true })
  fs.writeFileSync(path.join(kit.data, 'cloudflare', 'login.pid'), JSON.stringify({ pid: left.pid, at: Date.now() }))
  ok(!!(await until(() => portTaken(8976), 8000, 200)), '(an earlier sign-in is waiting on port 8976)')
  const before = logins().length
  e = await signIn({ wait: 1500 })
  ok(!alive(left.pid), 'the one left waiting is stopped')
  ok(e === 'Timed out waiting for authorization code, please try again.' && !logins()[before].includes('--callback-port'), 'and this sign-in waits on 8976 as usual', { e, args: logins()[before] })
  stopTree(left.pid)

  // 3. The port taken by something that isn't ours: another free port.
  const other = net.createServer()
  const got = await new Promise((r) => { other.once('error', () => r(false)); other.listen(8976, 'localhost', () => r(true)) })
  if (!ok(got, '(port 8976 is free again for the next check)')) throw new Error('port 8976 is still taken')
  const n = logins().length
  e = await signIn({ wait: 1500 })
  const args = logins()[n] || []
  const port = Number(args[args.indexOf('--callback-port') + 1])
  ok(args.includes('--callback-port') && port > 0 && port !== 8976 && e === 'Timed out waiting for authorization code, please try again.', 'with 8976 taken by something else, it waits on another free port', { e, args })
  other.close()

  // 4. When wrangler can't get its port anyway, it says so in plain words.
  const hold = net.createServer()
  await new Promise((r) => hold.listen(0, 'localhost', r))
  e = await signIn({ wait: 1500, forcePort: hold.address().port })
  hold.close()
  ok(/Another Cloudflare sign-in is still waiting for its browser tab/.test(e || ''), 'a port in use is explained, not quoted', e)

  // 5. npm: Bridge AI's own cache, your own settings.
  const env = JSON.parse(fs.readFileSync(path.join(kit.bin, 'npx-env.json'), 'utf8'))
  ok(env.cache && path.resolve(env.cache).startsWith(path.resolve(kit.data) + path.sep), "npx gets Bridge AI's own npm cache, not npm's shared one", env)
  ok(env.userconfig === path.join(kit.home, '.npmrc'), 'and your own ~/.npmrc (a proxy, a registry)', env)
  // 6. When npm itself can't go on, why, in plain words; never where it wrote its log.
  e = await signIn({ npm: 'eacces' })
  ok(/^Couldn't download Cloudflare's sign-in tool: npm isn't allowed to write to \S+/.test(e || '') && !/complete log|debug-0\.log/.test(e), 'npm unable to write its cache: said in plain words, with the folder', e)
  e = await signIn({ npm: 'offline' })
  ok(/^Couldn't download Cloudflare's sign-in tool: npm can't reach its registry/.test(e || '') && !/complete log/.test(e), 'npm with no network: said in plain words', e)

  // 7. Inside the app the server runs on the app itself, as Node, with a `node` stand-in for it on
  // PATH (paths.js, for computers without Node.js). wrangler run on that takes its own file for an
  // argument (a real Mac: "Unknown arguments: …/wrangler-dist/cli.js, login"). So npx's own
  // Node.js comes first, also when the PATH was read with the stand-in ahead of it, as when
  // Bridge AI installed Node.js while it ran.
  const electron = electronBin()
  if (!electron) skip('inside the app: wrangler on a real Node.js', 'Electron isn\'t installed (npm install in desktop/, or set BRIDGE_TEST_ELECTRON)')
  else {
    const app = await startKit('relay-signin-app', { node: electron, env: ({ data, PATH }) => ({ ELECTRON_RUN_AS_NODE: '1', BRIDGE_PATH: [path.join(data, 'cache', 'node'), PATH].join(path.delimiter) }) })
    try {
      app.program('npx', NPX)
      app.program('node', '// Node.js, next to npx as an installed one is.\n')
      fs.writeFileSync(path.join(app.bin, 'standin.json'), JSON.stringify({ wait: 300 }))
      const stand = path.join(app.data, 'cache', 'node')
      ok(fs.existsSync(path.join(stand, process.platform === 'win32' ? 'node.cmd' : 'node')), '(inside the app, its node stand-in is there)')
      const r = await app.api('/relay/deploy', { method: 'browser' }).then(() => null, (x) => x.message)
      const got = JSON.parse(fs.readFileSync(path.join(app.bin, 'npx-env.json'), 'utf8'))
      ok(got.node === app.bin, 'inside the app, wrangler gets the Node.js next to npx, not the app\'s stand-in', { node: got.node, stand })
      ok(r === 'Timed out waiting for authorization code, please try again.', 'and the sign-in runs as usual', r)
    } finally { app.stop() }
  }
} catch (x) {
  ok(false, `crashed: ${x.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
