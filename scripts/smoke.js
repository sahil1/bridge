#!/usr/bin/env node
// Smoke test for a built desktop app (run after electron-builder, on the same platform):
//   node scripts/smoke.js
// Starts the server bundled in desktop/dist on the app's own Node, with an empty data folder, and
// checks that the UI is served, setup works, and a terminal can run a command. CI runs this on
// every platform before a release is published.
//   SMOKE_FROM_SOURCE=1 SMOKE_PORT=<port> node scripts/smoke.js
// runs the same against this checkout's server on this Node (the smoke test, on every change), so
// what it asks of the server can't fall behind it unseen until a release: what only a built app has
// (its signature, the dictation key's helper, the speech engine and the local model's runtime) is
// left out then.
//   SMOKE_WINDOWS=1 node scripts/smoke.js
// also opens the built Mac app itself, with a data folder and a port of its own, and checks its
// windows and the line between them and its server (scripts/smokewindows.js). SMOKE_DIST: where the
// build is, if not desktop/dist.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import WebSocket from 'ws'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = process.env.SMOKE_DIST ? path.resolve(process.env.SMOKE_DIST) : path.join(ROOT, 'desktop', 'dist')
const SOURCE = process.env.SMOKE_FROM_SOURCE === '1'
const PORT = Number(process.env.SMOKE_PORT) || 7599
const BASE = `http://127.0.0.1:${PORT}`

// Where electron-builder puts the unpacked app on each platform (from source: this checkout).
const app = SOURCE ? { exe: process.execPath, root: ROOT } : {
  darwin: () => {
    const dir = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
    const contents = path.join(DIST, dir, 'Bridge AI.app', 'Contents')
    return { exe: path.join(contents, 'MacOS', 'Bridge AI'), root: path.join(contents, 'Resources', 'app-root') }
  },
  win32: () => ({ exe: path.join(DIST, 'win-unpacked', 'Bridge AI.exe'), root: path.join(DIST, 'win-unpacked', 'resources', 'app-root') }),
  linux: () => ({ exe: path.join(DIST, 'linux-unpacked', 'bridge-ai'), root: path.join(DIST, 'linux-unpacked', 'resources', 'app-root') }),
}[process.platform]?.()
if (!app || !fs.existsSync(app.exe)) { console.error(`smoke: no built app found for ${process.platform} (${app?.exe})`); process.exit(1) }

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-smoke-'))
// Terminals still run in the terminal host, but end with the server here, so nothing is left behind.
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ keepAgents: false }))
const log = []
// (Started as the app starts it: desktop/serverflags.js.)
const { SERVER_NODE_FLAGS } = createRequire(import.meta.url)('../desktop/serverflags.js')
const server = spawn(app.exe, [...SERVER_NODE_FLAGS, path.join(app.root, 'server', 'index.js')], {
  cwd: app.root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BRIDGE_HOME: home, BRIDGE_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => log.push(String(d)))
server.stderr.on('data', (d) => log.push(String(d)))

let failed = false
let marked = null // a build made for the smoke test of the app's windows (desktop/startgate.js): read below
const step = async (name, fn) => {
  const t = Date.now()
  try { const note = await fn(); console.log(`ok   ${name} (${Date.now() - t} ms)${note ? `: ${note}` : ''}`) } catch (e) { failed = true; console.log(`FAIL ${name}: ${e.message}`) }
}
// The key the server makes in its data folder as it starts (server/apitoken.js), sent with each
// request as the app's own programs send it: without it, all but /api/health and the app's built
// files are refused (server/apiauth.js).
let key = null
const auth = () => (key ? { authorization: `Bearer ${key}` } : {})
const get = async (p) => { const r = await fetch(BASE + p, { headers: auth() }); if (!r.ok) throw new Error(`${p} returned ${r.status}`); return r }
const built = (name, fn) => (SOURCE ? console.log(`--   ${name}: a built app's only`) : step(name, fn))

try {
  // The Mac app's signature holds together, and with the certificate given (desktop/sign.js) it's
  // that one, so macOS keeps what people allowed across updates.
  if (process.platform === 'darwin') await built('the app is signed', async () => {
    const bundle = path.dirname(path.dirname(path.dirname(app.exe)))
    const ok = spawnSync('codesign', ['--verify', '--deep', '--strict', bundle], { encoding: 'utf8' })
    if (ok.status !== 0) throw new Error(ok.stderr.trim())
    const d = spawnSync('codesign', ['-d', '-vv', '-r-', bundle], { encoding: 'utf8' }) // details on stderr, the requirement on stdout
    const shown = `${d.stderr}\n${d.stdout}`
    const by = /Authority=(.+)/.exec(shown)?.[1] || (/Signature=adhoc/.test(shown) ? 'ad hoc' : '?')
    if (process.env.BRIDGE_SIGN_P12 && !/certificate leaf = H"/.test(shown)) throw new Error(`a certificate was given, but it's signed ${by}`)
    // Signed with a certificate (not ad hoc): under the hardened runtime, so no other code gets in
    // (no DYLD_ variables, no debugger attached), the app and its Helper both.
    if (by !== 'ad hoc') {
      for (const f of [bundle, path.join(bundle, 'Contents', 'Frameworks', 'Bridge AI Helper.app')]) {
        const v = spawnSync('codesign', ['-d', '-v', f], { encoding: 'utf8' })
        if (!/flags=0x[0-9a-f]*\(.*runtime.*\)/.test(v.stderr)) throw new Error(`${path.basename(f)} isn't signed with the hardened runtime: ${(/flags=.*/.exec(v.stderr) || [''])[0]}`)
      }
    }
    return by
  })
  // Electron's fuses (desktop/package.json electronFuses): Node's own options (NODE_OPTIONS) and its
  // inspector (--inspect) are off for the app and anything run on it; running as Node stays on, as
  // the server runs that way.
  await built('Electron\'s fuses are set', async () => {
    const { getCurrentFuseWire, FuseV1Options } = createRequire(path.join(ROOT, 'desktop', 'package.json'))('@electron/fuses')
    const FuseState = { DISABLE: 48, ENABLE: 49 } // ('0' and '1' in the wire: @electron/fuses' constants)
    const bundle = process.platform === 'darwin' ? path.dirname(path.dirname(path.dirname(app.exe))) : app.exe
    const wire = await getCurrentFuseWire(bundle)
    const want = {
      [FuseV1Options.RunAsNode]: FuseState.ENABLE,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FuseState.DISABLE,
      [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
      // The app's own archive checked against what was built, and nothing loaded from outside it.
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
      [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
    }
    const off = Object.entries(want).filter(([k, v]) => wire[k] !== v).map(([k]) => FuseV1Options[k])
    if (off.length) throw new Error(`not as set: ${off.join(', ')}`)
    return 'RunAsNode on, NODE_OPTIONS and --inspect off, its archive checked and the only place it loads from'
  })
  // A release build doesn't start with any switch, or with Electron's logging or Node's proxy asked
  // for in the environment (desktop/startgate.js); only a Mac build made for the smoke test of the
  // app's windows is let, by its own bundle id (dev.bridge-ai.smoke), which its signature covers.
  const startGate = createRequire(import.meta.url)('../desktop/startgate.js')
  const id = SOURCE ? null : startGate.bundleId({ resources: path.dirname(app.root) })
  marked = SOURCE ? null : startGate.smokeBuild(id)
  await built('a release build: not the smoke test\'s', async () => {
    if (marked && process.env.SMOKE_WINDOWS !== '1') throw new Error(`its bundle id is the smoke test's (${id}): a release never is`)
    return marked ? `the smoke test's own build (${id}, SMOKE_WINDOWS)` : `${id || 'no bundle id here'}`
  })
  // Each launch in a folder of its own, with a profile and a port of its own, and the stand-in keychain
  // too, so even one that started would reach no keychain and nothing of a copy installed here. code:
  // what it ended with; said: the reason in logs/desktop.log; opened: a window profile or a server.
  const launchOnce = async (exe, args, extraEnv = {}, { wait = 20000, until = null } = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-smoke-start-'))
    const env = { ...process.env, BRIDGE_HOME: dir, BRIDGE_PORT: String(PORT + 3), ...extraEnv }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(exe, args, { env, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
    const said = () => { try { return fs.readFileSync(path.join(dir, 'logs', 'desktop.log'), 'utf8') } catch { return '' } }
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => resolve('still running'), wait)
      const look = until && setInterval(() => { if (until(said())) { clearTimeout(t); clearInterval(look); resolve('still running') } }, 200)
      child.on('exit', (c, sig) => { clearTimeout(t); if (look) clearInterval(look); resolve(c ?? sig) })
    })
    const opened = { profile: fs.existsSync(path.join(dir, 'desktop')), keys: fs.existsSync(path.join(dir, 'desktop', 'signing-keys')), server: fs.existsSync(path.join(dir, 'cache', 'server.pid')) }
    if (child.exitCode == null && child.signalCode == null) {
      // (Its server too, if it got that far: only as a child of the one started here.)
      try { const pid = Number(fs.readFileSync(path.join(dir, 'cache', 'server.pid'), 'utf8')); if (Number(spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()) === child.pid) process.kill(pid, 'SIGTERM') } catch { /* none */ }
      child.kill('SIGTERM')
      await new Promise((r) => { const t = setTimeout(() => { child.kill('SIGKILL'); r() }, 8000); child.on('exit', () => { clearTimeout(t); r() }) })
    }
    const log = said()
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Windows may still hold files */ }
    return { code, log, opened }
  }
  const gui = process.platform !== 'linux' || !!process.env.DISPLAY
  if (marked === false && gui) await built('it doesn\'t start with any switch, nor with Electron\'s logging or Node\'s proxy asked for', async () => {
    const tries = [
      '--remote-debugging-port=0', '-remote-debugging-port=0', '--remote-debugging-pipe', '--remote-allow-origins=*', '--use-mock-keychain', '--inspect', '--inspect-brk', '--inspect-port=0',
      '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--proxy-pac-url=http://127.0.0.1:9/p.pac', `--log-net-log=${path.join(os.tmpdir(), 'bridge-smoke-net.json')}`, '--net-log-capture-mode=Everything',
      '--host-resolver-rules=MAP * 127.0.0.1', `--user-data-dir=${path.join(os.tmpdir(), 'bridge-smoke-profile')}`, '--a-switch-nobody-has-heard-of',
    ]
    const results = []
    for (const t of tries) {
      const name = t.replace(/=.*/s, '')
      const r = await launchOnce(app.exe, [...(t === '--use-mock-keychain' ? [] : ['--use-mock-keychain']), t])
      results.push({ t, code: r.code, said: r.log.includes(name), opened: r.opened.profile || r.opened.server })
    }
    for (const k of startGate.ENV) {
      const r = await launchOnce(app.exe, ['--use-mock-keychain'], { [k]: k === 'ELECTRON_LOG_FILE' ? path.join(os.tmpdir(), 'bridge-smoke-electron.log') : '1' })
      results.push({ t: k, code: r.code, said: r.log.includes(k), opened: r.opened.profile || r.opened.server })
    }
    const bad = results.filter((r) => r.code !== 1 || !r.said || r.opened)
    if (bad.length) throw new Error(JSON.stringify(bad))
    return `each refused at once (exit 1, the reason in logs/desktop.log, no window profile or server): ${results.map((r) => r.t.replace(/=.*/s, '')).join(' ')}`
  })
  // Its own copy of Bridge AI changed by one byte (in a copy of the whole app): it starts no server
  // and opens no keys, and says so (desktop/rootlist.js). With the stand-in keychain, so only in the
  // smoke test's own build or on CI's throwaway machines.
  if (!SOURCE && gui && (marked || process.env.CI)) await step('a copy of it with a byte changed in its server starts no server and opens no keys', async () => {
    const top = process.platform === 'darwin' ? path.dirname(path.dirname(path.dirname(app.exe))) : path.dirname(app.exe)
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-smoke-changed-'))
    const copy = path.join(copyDir, path.basename(top))
    fs.cpSync(top, copy, { recursive: true, verbatimSymlinks: true })
    const rel = path.relative(top, app.exe)
    const file = path.join(copy, path.relative(top, app.root), 'server', 'index.js')
    const bytes = fs.readFileSync(file)
    const at = bytes.indexOf('// ') + 3
    bytes[at] = bytes[at] === 0x78 ? 0x79 : 0x78
    fs.writeFileSync(file, bytes)
    try {
      const r = await launchOnce(path.join(copy, rel), marked ? ['--use-mock-keychain'] : [], {}, { wait: 30000, until: (log) => /own files aren't as they were built/.test(log) })
      const named = /server\/index\.js/.test(r.log)
      if (!/own files aren't as they were built/.test(r.log) || !named || r.opened.server || r.opened.keys) throw new Error(JSON.stringify({ code: r.code, log: r.log.slice(-300), opened: r.opened }))
      return 'it said its own files aren\'t as built (server/index.js), and started no server and opened no keys'
    } finally {
      if (process.platform === 'darwin') spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-u', copy])
      fs.rmSync(copyDir, { recursive: true, force: true })
    }
  })
  // Studio's signing (server/signhelper.js): on a Mac its helper (native/bridgesign) is in the app and
  // says what this Mac has, asking nothing.
  if (process.platform === 'darwin') {
    await built('Studio\'s signing helper answers', async () => {
      const r = spawnSync(path.join(app.root, 'native', 'bin', 'bridgesign'), ['probe'], { encoding: 'utf8', timeout: 10000 })
      if (r.status !== 0 || !/"trackpad"/.test(r.stdout)) throw new Error(`native/bin/bridgesign probe: ${r.error?.message || r.stderr || r.stdout || r.status}`)
      return r.stdout.trim()
    })
  }
  // Dictation's key from other apps (desktop/dictation.js): on a Mac its helper (native/bridgekeys)
  // is in the app and answers; on Windows and Linux the keyboard hook's build for this system is.
  await built('the dictation key can be heard from other apps', async () => {
    if (process.platform === 'darwin') {
      const r = spawnSync(path.join(app.root, 'native', 'bin', 'bridgekeys'), ['front'], { encoding: 'utf8', timeout: 10000 })
      if (r.status !== 0 || !/"bundle"/.test(r.stdout)) throw new Error(`native/bin/bridgekeys front: ${r.error?.message || r.stderr || r.stdout || r.status}`)
      return r.stdout.trim()
    }
    const want = `${process.platform}-x64`
    const found = []
    const look = (d, depth = 0) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 8) look(p, depth + 1); else if (e.name === 'uiohook-napi.node') found.push(p) } }
    look(path.dirname(app.root))
    const ours = found.find((f) => f.includes(want) && f.includes('app.asar.unpacked'))
    if (!ours) throw new Error(`no unpacked ${want} uiohook-napi.node (found: ${found.join(', ') || 'none'})`)
    return path.relative(path.dirname(app.root), ours)
  })
  await step('server starts', async () => {
    for (let i = 0; i < 300; i++) {
      try { await get('/api/health'); break } catch { await new Promise((r) => setTimeout(r, 200)) }
      if (server.exitCode != null) throw new Error(`server exited with ${server.exitCode}`)
      if (i === 299) throw new Error('no answer after 60 s')
    }
    try { key = fs.readFileSync(path.join(home, 'api-token'), 'utf8').trim() } catch { /* said below */ }
    if (!key) throw new Error('it made no key (api-token) in its data folder')
    await get('/api/config')
  })
  // Another program sending the server SIGUSR1 (which opens Node's inspector on 9229, from which
  // its memory can be read): nothing opens, and the server carries on. Not on Windows (no signals).
  if (process.platform !== 'win32') await step('SIGUSR1 opens no inspector', async () => {
    const listening = () => new Promise((resolve) => { const c = net.connect(9229, '127.0.0.1'); c.once('connect', () => { c.destroy(); resolve(true) }); c.once('error', () => resolve(false)) })
    if (await listening()) return 'skipped: something else is on 9229 here'
    process.kill(server.pid, 'SIGUSR1')
    await new Promise((r) => setTimeout(r, 1500))
    if (await listening()) throw new Error('an inspector is listening on 9229')
    if (server.exitCode != null) throw new Error(`the server exited (${server.exitCode})`)
    await get('/api/health')
    return 'nothing on 9229, still answering'
  })
  await step('without its key, the API is refused', async () => {
    const r = await fetch(`${BASE}/api/setup`)
    const out = await r.json().catch(() => ({}))
    if (r.status !== 401 || out.code !== 'apiKey') throw new Error(`/api/setup without the key returned ${r.status} ${JSON.stringify(out).slice(0, 200)}`)
  })
  await step('UI is served', async () => {
    const html = await (await get('/')).text()
    if (!html.includes('Bridge AI')) throw new Error('index.html looks wrong')
    const js = html.match(/\/assets\/index-[^"]+\.js/)?.[0]
    if (!js) throw new Error('no script in index.html')
    await get(js)
    return js
  })
  await step('setup detects agents', async () => {
    const s = await (await get('/api/setup')).json()
    return `${s.runtime} runtime; agents found: ${(s.usable || []).map((a) => a.kind).join(', ') || 'none (expected on CI)'}`
  })
  await step('notifications, phone, updates and diagnostics load', async () => {
    const key = await (await get('/api/push/key')).json()
    if (!/^[A-Za-z0-9_-]{80,}$/.test(key.publicKey || '')) throw new Error('no push key')
    const ph = await (await get('/api/phone')).json()
    const up = await (await get('/api/updates')).json()
    const d = await (await get('/api/diagnostics')).json()
    if (!d.bridgeAi) throw new Error('no diagnostics')
    return `tailscale ${ph.installed ? ph.state : 'not installed'}; version ${up.current}, latest ${up.latest || up.error || '?'}`
  })
  // sherpa-onnx's addon (Parakeet) loads in the app's own Node, in its own process, as it will
  // for the first voice note. It's built for newer systems than some Bridge AI runs on, so it's
  // also worth running this by hand on the oldest macOS and Linux supported.
  await built('the speech engine loads', async () => {
    const s = await (await get('/api/speech')).json()
    if (!s.machine?.sherpa?.ok) throw new Error(`sherpa-onnx didn't load: ${s.machine?.sherpa?.error || JSON.stringify(s.hidden)}`)
    if (!s.local.models.some((m) => m.id === 'parakeet-v3')) throw new Error('Parakeet isn\'t offered')
    return `${s.machine.platform} ${s.machine.arch}${s.machine.os ? ` ${s.machine.os}` : ''}${s.machine.glibc ? `, glibc ${s.machine.glibc}` : ''}`
  })
  // The local model's runtime (llama.cpp's llama-server, scripts/llama.js) is in the app for this
  // computer, signed with it on a Mac, and loads: its device list, as the app asks it (no model).
  await built('the local model\'s runtime loads', async () => {
    const s = await (await get('/api/llm')).json()
    if (!s.runtime?.ok) throw new Error(s.runtime?.why || 'no answer')
    return `${s.gpu ? `GPU: ${s.gpu}` : 'processor only'}; ${s.offered ? 'offered' : s.why}`
  })
  await step('a terminal runs a command', async () => {
    const r = await fetch(BASE + '/api/agents/launch', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ kind: 'shell', cwd: os.homedir(), label: 'smoke' }) })
    const out = await r.json()
    if (!r.ok || !out.paneId) throw new Error(`launch failed: ${JSON.stringify(out)}`)
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/panes/${encodeURIComponent(out.paneId)}/attach?cols=100&rows=30`, { headers: auth() })
    let seen = ''
    ws.on('message', (d) => { seen += String(d) })
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    const shown = () => seen.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    const until = async (test, ms) => { for (let t = 0; t < ms && !test(); t += 100) await new Promise((r) => setTimeout(r, 100)); return test() }
    // The shell's prompt first: PowerShell starting in a profile it hasn't seen (a test's) takes a while.
    const prompted = await until(() => /[$#%>] ?$/.test(shown().trimEnd().split('\n').pop() || ''), 30000)
    await new Promise((r) => setTimeout(r, 300))
    // The answer only appears if the shell ran the line (the typed line itself shows 6*7, not 42). Typed
    // once, then waited for as a person would once they see the shell take it, however long it takes:
    // the first command in a Windows PowerShell with a profile it hasn't seen (a test's, or a new CI
    // machine's) waits while it makes its module cache from every module on its path (on GitHub's
    // Windows runners, Az's hundred and more), 20 to 40 s; typed again then, it only queued behind.
    // Typed again once if it never showed.
    const line = process.platform === 'win32' ? 'echo ("bridge-" + 6*7 + "-ok")\r' : 'echo bridge-$((6*7))-ok\r'
    const answered = () => seen.includes('bridge-42-ok')
    const taken = () => shown().includes('6*7')
    const typedAt = Date.now()
    ws.send(line)
    if (!(await until(() => answered() || taken(), 15000))) ws.send(line)
    await until(answered, 90000)
    ws.close()
    const secs = Math.round((Date.now() - typedAt) / 1000)
    if (!answered()) throw new Error(`no output${prompted ? '' : ' (and no prompt in 30 s)'} ${taken() ? `${secs} s after the shell took the line` : 'and the line never showed'}; the terminal showed: ${JSON.stringify(shown().replace(/(\r?\n)+/g, '⏎').slice(-400))}`)
    return `answered ${secs} s after it was typed`
  })
  // The app itself: its windows, and the line between them and its own server (smokewindows.js).
  // Asked for (SMOKE_WINDOWS=1), as it opens the app's windows on the screen; a built Mac app's only.
  if (process.env.SMOKE_WINDOWS === '1') {
    if (SOURCE || process.platform !== 'darwin') console.log('--   the app\'s windows: a built Mac app\'s only')
    else if (!marked) console.log('--   the app\'s windows: only in a Mac build made for it (electron-builder ... -c.appId=dev.bridge-ai.smoke), as a release build refuses DevTools and the stand-in keychain')
    else await (await import('./smokewindows.js')).windows({ app, step, ROOT })
  }
} finally {
  server.kill()
  if (failed) console.log(`\nServer log:\n${log.join('').slice(-3000)}`)
  try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* Windows may still hold files */ }
}
process.exit(failed ? 1 : 0)
