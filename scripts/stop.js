#!/usr/bin/env node
// Stop the Bridge AI server. Your agents keep running (in Bridge AI's terminal host, or in herdr)
// and the next start picks them up as they are. With Keep agents running turned off (Settings ›
// General), built-in agents stop with the server, and the next start resumes their sessions.
//   npm run stop            stop the server
//   npm run stop -- agents  stop the built-in agents too (they resume on the next start)
//   npm run stop -- phone   also remove the Tailscale HTTPS publish
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { cacheFile, loadConfig, IS_WIN } from '../server/paths.js'
import { stopHost } from '../server/runtime/hostlink.js'

const args = process.argv.slice(2)
const PID = cacheFile('server.pid')
let stopped = false
try {
  const pid = Number(fs.readFileSync(PID, 'utf8'))
  if (pid) { process.kill(pid, 'SIGTERM'); stopped = true }
} catch { /* not running, or already gone */ }
try { fs.rmSync(PID) } catch { /* fine */ }

if (args.includes('phone')) spawnSync('tailscale', ['serve', '--https=8443', 'off'], { stdio: 'ignore', shell: IS_WIN })

const { port, host } = loadConfig()
let up = true
for (let i = 0; i < 20; i++) {
  try { await fetch(`http://${host}:${port}/api/config`, { signal: AbortSignal.timeout(500) }) } catch { up = false; break }
  await new Promise((r) => setTimeout(r, 250))
}
// After the server, so it has saved them to come back next time; never from under one still running.
const agents = args.includes('agents') && !up && await stopHost().catch(() => false)
console.log(`${stopped ? 'Bridge AI stopped.' : 'Bridge AI was not running.'}${agents ? ' Its agents stopped too.' : ''}`)
