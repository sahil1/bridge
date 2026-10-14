#!/usr/bin/env node
// Stop the Bridge AI server. With the herdr runtime your agents keep running in herdr; with the
// built-in runtime they stop, and the layout comes back (resuming sessions) on the next start.
//   npm run stop            stop the server
//   npm run stop -- phone   also remove the Tailscale HTTPS publish
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { cacheFile, loadConfig, IS_WIN } from '../server/paths.js'

const PID = cacheFile('server.pid')
let stopped = false
try {
  const pid = Number(fs.readFileSync(PID, 'utf8'))
  if (pid) { process.kill(pid, 'SIGTERM'); stopped = true }
} catch { /* not running, or already gone */ }
try { fs.rmSync(PID) } catch { /* fine */ }

if (process.argv[2] === 'phone') spawnSync('tailscale', ['serve', '--https=8443', 'off'], { stdio: 'ignore', shell: IS_WIN })

const { port, host } = loadConfig()
for (let i = 0; i < 20; i++) {
  try { await fetch(`http://${host}:${port}/api/config`, { signal: AbortSignal.timeout(500) }) } catch { break }
  await new Promise((r) => setTimeout(r, 250))
}
console.log(stopped ? 'Bridge AI stopped.' : 'Bridge AI was not running.')
