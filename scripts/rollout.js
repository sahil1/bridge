#!/usr/bin/env node
// A release out a few computers at a time: npm run rollout -- <version> <percent>
//
// Sets how many of the computers on Stable are offered a release, by the line GitHub hides in its
// notes (<!-- rollout: 10 -->, shared/rollout.js), changed with the GitHub CLI (gh, signed in).
// Each computer has a bucket from 0 to 99, picked at random once; those under the percentage are
// offered it at their next check (within 6 hours). 100 is everyone, and the line goes. 0 pauses it
// for everyone, Early Access too, and nobody can update to it, not even by hand; anything above 0
// is offered at once to Early Access and to anyone who checks by hand. Lowering it doesn't take it
// back from computers that already updated.
//   npm run rollout -- 3.13.0           what it's at now
//   npm run rollout -- 3.13.0 10        10%, then 50, then 100
//   npm run rollout -- 3.13.0 0         paused
//   npm run rollout -- 3.13.0 50 --dry-run   the notes it would write, changing nothing
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolloutOf, withRollout } from '../shared/rollout.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const fail = (msg) => { console.error(`rollout: ${msg}`); process.exit(1) }
// BRIDGE_GH (tests): a Node script standing in for gh.
const gh = (...a) => {
  const [cmd, all] = process.env.BRIDGE_GH ? [process.execPath, [process.env.BRIDGE_GH, ...a]] : ['gh', a]
  try { return execFileSync(cmd, all, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) {
    if (e.code === 'ENOENT') fail('this needs the GitHub CLI (gh): https://cli.github.com, then gh auth login')
    fail(String(e.stderr || e.message).trim())
  }
}

const [raw, pct] = args.filter((a) => !a.startsWith('--'))
if (!raw) fail('which version? npm run rollout -- 3.13.0 10')
const version = raw.replace(/^v/, '')
const tag = `v${version}`
const percent = pct == null ? null : Number(pct)
if (pct != null && !(Number.isInteger(percent) && percent >= 0 && percent <= 100)) fail(`the percentage is a whole number from 0 to 100, not "${pct}"`)

let rel
try { rel = JSON.parse(gh('release', 'view', tag, '--json', 'tagName,body,isPrerelease,isDraft')) } catch { fail(`GitHub didn't say what ${tag} is`) }
if (rel.isDraft) fail(`${tag} is a draft; publish it first`)
const now = rolloutOf(rel.body)
const words = (p) => (p == null || p >= 100 ? 'everyone' : p === 0 ? 'nobody (paused)' : `${p}% of computers on Stable, and Early Access`)
const kind = rel.isPrerelease ? 'pre-release (Early Access only)' : 'release'
if (percent == null) {
  console.log(`Bridge AI ${version}, a ${kind}: offered to ${words(now)}.`)
  process.exit(0)
}
const body = withRollout(rel.body, percent)
if (body.trim() === String(rel.body || '').trim()) {
  console.log(`Bridge AI ${version} is already offered to ${words(now)}; nothing changed.`)
  process.exit(0)
}
if (args.includes('--dry-run')) {
  console.log(`Bridge AI ${version}: from ${words(now)} to ${words(percent)}. The notes would end:\n\n${body.slice(-400)}\nDry run: nothing changed.`)
  process.exit(0)
}
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-rollout-')), 'notes.md')
fs.writeFileSync(file, body)
gh('release', 'edit', tag, '--notes-file', file)
fs.rmSync(path.dirname(file), { recursive: true, force: true })
const after = rolloutOf(body)
console.log(`Bridge AI ${version}: now offered to ${words(after)} (was ${words(now)}). Computers see it at their next check, within 6 hours.`)
if (rel.isPrerelease && percent > 0 && percent < 100) console.log('A pre-release goes to every computer on Early Access whatever the percentage; only 0 holds it back.')
if ((after ?? 100) < (now ?? 100) && after > 0) console.log('Computers that already updated keep it; to stop the rest from getting it, use 0.')
