#!/usr/bin/env node
// Smoke test for a built desktop app (run after electron-builder, on the same platform):
//   node scripts/smoke.js
// Starts the server bundled in desktop/dist on the app's own Node, with an empty data folder, and
// checks that the UI is served, setup works, and a terminal can run a command. CI runs this on
// every platform before a release is published.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'desktop', 'dist')
const PORT = 7599
const BASE = `http://127.0.0.1:${PORT}`

// Where electron-builder puts the unpacked app on each platform.
const app = {
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
const get = async (p) => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(`${p} returned ${r.status}`); return r }

try {
  // The Mac app's signature holds together, and with the certificate given (desktop/sign.js) it's
  // that one, so macOS keeps what people allowed across updates.
  if (process.platform === 'darwin') await step('the app is signed', async () => {
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
  await step('the dictation key can be heard from other apps', async () => {
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
      try { await get('/api/config'); return } catch { await new Promise((r) => setTimeout(r, 200)) }
      if (server.exitCode != null) throw new Error(`server exited with ${server.exitCode}`)
    }
    throw new Error('no answer after 60 s')
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
  await step('the speech engine loads', async () => {
    const s = await (await get('/api/speech')).json()
    if (!s.machine?.sherpa?.ok) throw new Error(`sherpa-onnx didn't load: ${s.machine?.sherpa?.error || JSON.stringify(s.hidden)}`)
    if (!s.local.models.some((m) => m.id === 'parakeet-v3')) throw new Error('Parakeet isn\'t offered')
    return `${s.machine.platform} ${s.machine.arch}${s.machine.os ? ` ${s.machine.os}` : ''}${s.machine.glibc ? `, glibc ${s.machine.glibc}` : ''}`
  })
  await step('a terminal runs a command', async () => {
    const r = await fetch(BASE + '/api/agents/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'shell', cwd: os.homedir(), label: 'smoke' }) })
    const out = await r.json()
    if (!r.ok || !out.paneId) throw new Error(`launch failed: ${JSON.stringify(out)}`)
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/panes/${encodeURIComponent(out.paneId)}/attach?cols=100&rows=30`)
    let seen = ''
    ws.on('message', (d) => { seen += String(d) })
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    await new Promise((r) => setTimeout(r, 1500)) // let the shell print its prompt
    // The answer only appears if the shell ran the line (the typed line itself shows 6*7, not 42).
    ws.send(process.platform === 'win32' ? 'echo ("bridge-" + 6*7 + "-ok")\r' : 'echo bridge-$((6*7))-ok\r')
    for (let i = 0; i < 100 && !seen.includes('bridge-42-ok'); i++) await new Promise((r) => setTimeout(r, 100))
    ws.close()
    if (!seen.includes('bridge-42-ok')) throw new Error(`no output; the terminal showed: ${JSON.stringify(seen.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').slice(-300))}`)
  })
} finally {
  server.kill()
  if (failed) console.log(`\nServer log:\n${log.join('').slice(-3000)}`)
  try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* Windows may still hold files */ }
}
process.exit(failed ? 1 : 0)
