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
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'desktop', 'dist')
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
const server = spawn(app.exe, [path.join(app.root, 'server', 'index.js')], {
  cwd: app.root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BRIDGE_HOME: home, BRIDGE_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => log.push(String(d)))
server.stderr.on('data', (d) => log.push(String(d)))

let failed = false
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
    return by
  })
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
    // The answer only appears if the shell ran the line (the typed line itself shows 6*7, not 42); typed
    // again once if nothing came of it.
    const line = process.platform === 'win32' ? 'echo ("bridge-" + 6*7 + "-ok")\r' : 'echo bridge-$((6*7))-ok\r'
    ws.send(line)
    if (!(await until(() => seen.includes('bridge-42-ok'), 15000))) { ws.send(line); await until(() => seen.includes('bridge-42-ok'), 15000) }
    ws.close()
    if (!seen.includes('bridge-42-ok')) throw new Error(`no output${prompted ? '' : ' (and no prompt in 30 s)'}; the terminal showed: ${JSON.stringify(shown().replace(/(\r?\n)+/g, '⏎').slice(-400))}`)
  })
} finally {
  server.kill()
  if (failed) console.log(`\nServer log:\n${log.join('').slice(-3000)}`)
  try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* Windows may still hold files */ }
}
process.exit(failed ? 1 : 0)
