#!/usr/bin/env node
// Start Bridge AI: install dependencies and build the UI when needed, then serve UI + API on one
// port. Works the same on macOS, Linux and Windows.
//   npm start            build (when sources changed) and run
//   npm start -- dev     hot-reload UI on :7421 (port + 1), API on the usual port
//   npm start -- phone   also publish over Tailscale HTTPS for your phone (tailnet only)
import { spawnSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { ROOT, DATA, cacheFile, ensureDir, loadConfig, IS_WIN } from '../server/paths.js'

const mode = process.argv[2] || ''
const npm = IS_WIN ? 'npm.cmd' : 'npm'
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN }); if (r.status) process.exit(r.status) }
const mtime = (p) => { try { return fs.statSync(p).mtimeMs } catch { return 0 } }
const newest = (dir) => {
  let t = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    t = Math.max(t, e.isDirectory() ? newest(p) : mtime(p))
  }
  return t
}

if (!fs.existsSync(path.join(ROOT, 'node_modules')) || mtime(path.join(ROOT, 'package.json')) > mtime(path.join(ROOT, 'node_modules'))) {
  console.log('Installing dependencies...')
  run(npm, ['install', '--no-fund', '--no-audit'])
  fs.utimesSync(path.join(ROOT, 'node_modules'), new Date(), new Date())
}

const cfg = loadConfig()
const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)))
  s.listen(port, cfg.host)
})

if (mode === 'dev') {
  // Hot reload: UI edits show instantly (Vite, on port + 1); server edits restart the API by
  // itself (node --watch). Built-in agents restart with it and resume their sessions.
  for (const p of [cfg.port, cfg.port + 1]) {
    if (!(await portFree(p))) { console.error(`Port ${p} is already in use. Run "npm run stop" first.`); process.exit(1) }
  }
  ensureDir(path.dirname(cacheFile('server.pid')))
  fs.writeFileSync(cacheFile('server.pid'), String(process.pid))
  // Its own process group, so stopping this stops the API and Vite with it.
  const child = spawn(npm, ['run', 'dev'], { cwd: ROOT, stdio: 'inherit', shell: IS_WIN, detached: !IS_WIN })
  const stop = () => {
    try { if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); else process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ }
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stop(); process.exit(0) })
  console.log(`\nBridge AI (dev): http://127.0.0.1:${cfg.port + 1}  edits reload live; Ctrl+C or npm run stop to quit\n`)
  child.on('exit', (code) => process.exit(code ?? 0))
} else {
  const built = mtime(path.join(ROOT, 'dist', 'index.html'))
  const src = Math.max(newest(path.join(ROOT, 'src')), mtime(path.join(ROOT, 'index.html')), mtime(path.join(ROOT, 'vite.config.js')))
  if (!built || src > built) { console.log('Building UI...'); run(npm, ['run', 'build']) }

  if (!(await portFree(cfg.port))) { console.error(`Port ${cfg.port} is already in use. Run "npm run stop" first, or set "port" in ${path.join(DATA, 'config.json')}.`); process.exit(1) }

  if (mode === 'phone') {
    const ts = spawnSync('tailscale', ['serve', '--bg', '--https=8443', `http://127.0.0.1:${cfg.port}`], { encoding: 'utf8', shell: IS_WIN })
    if (ts.status === 0) {
      const st = JSON.parse(spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', shell: IS_WIN }).stdout || '{}')
      console.log(`Phone: https://${String(st.Self?.DNSName || '').replace(/\.$/, '')}:8443`)
    } else console.log('Tailscale is not running. Start it for phone access (open the Tailscale app or run "tailscale up").')
  }

  ensureDir(path.dirname(cacheFile('server.pid')))
  fs.writeFileSync(cacheFile('server.pid'), String(process.pid))
  await import('../server/index.js')
}
