#!/usr/bin/env node
// Early-access codes, for testers (server/earlyaccess.js, and CONTRIBUTING.md › Releases, betas and
// rollouts). npm run early-access -- … runs this too.
//   node scripts/early-access-code.js <name> [--days N]   a code for one tester, signed with your
//                                                         key; it ends after N days, or never
//   node scripts/early-access-code.js --new-key           your key pair, made once
//   node scripts/early-access-code.js --check <code>      what a code says, and whether it checks out
//   node scripts/early-access-code.js --revoke <id>       a code taken back, in the newest release's
//                                                         notes (with gh), for computers to read
// The private key is a file of yours, outside this repo: --key FILE, or the file named by
// BRIDGE_EARLY_ACCESS_PRIVATE_KEY, or else ~/.config/bridge-ai/early-access-key.pem. Whoever has it can make codes, so it's never
// committed (npm run check:private refuses a private key) and best kept in a password manager too.
// Its public half goes in server/earlyaccess.js (PUBLIC_KEY), and builds from then on take codes.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeCode, readCode, publicOf, publicKey, whyNot } from '../server/earlyaccess.js'
import { withRevoked } from '../shared/rollout.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const fail = (msg) => { console.error(`early-access-code: ${msg}`); process.exit(1) }
const keyFile = path.resolve(opt('--key') || process.env.BRIDGE_EARLY_ACCESS_PRIVATE_KEY || path.join(os.homedir(), '.config', 'bridge-ai', 'early-access-key.pem'))
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const inRepo = (f) => { const r = path.relative(ROOT, f); return !r.startsWith('..') && !path.isAbsolute(r) }

// ---------- The key pair, once ----------
if (args.includes('--new-key')) {
  if (inRepo(keyFile)) fail(`${keyFile} is inside this repo, where a private key must never be. Pick a place outside it (--key FILE).`)
  if (fs.existsSync(keyFile)) fail(`there's a key at ${keyFile} already. Codes made with it stop working once a build has another key, so it isn't replaced; move it away first if that's what you want.`)
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 })
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.log(`Made a key pair for early-access codes.

The private key is in ${keyFile} (only you can read it). Keep a copy somewhere safe, like a password
manager: it can't be made again, and whoever has it can make codes. Never put it in the repo.

The public key goes in server/earlyaccess.js, in place of the empty one:

  export const PUBLIC_KEY = '${publicOf(privateKey)}'

Commit that; every build from then on takes codes signed with this key. Then make one:
  node scripts/early-access-code.js <name> --days 60`)
  process.exit(0)
}

// ---------- What a code says ----------
if (args.includes('--check')) {
  const r = readCode(opt('--check'))
  if (r.why === 'none') fail('server/earlyaccess.js has no PUBLIC_KEY yet, so nothing checks out (node scripts/early-access-code.js --new-key)')
  if (r.id) console.log(`For ${r.for} (id ${r.id}), made ${day(r.made)}, ${r.until ? `until ${day(r.until)}` : 'with no end date'}.`)
  console.log(r.ok ? 'It checks out: a build with this repo\'s key takes it.' : whyNot(r))
  process.exit(r.ok ? 0 : 1)
}

// ---------- Taking one back ----------
// Into the newest release's notes (pre-releases too), which computers on Early Access read with
// every check while it's among the newest 30. For good: REVOKED in server/earlyaccess.js, in the
// next version.
if (args.includes('--revoke')) {
  const id = opt('--revoke')
  if (!/^[0-9a-f]{8}$/.test(id || '')) fail('which code? --revoke <id>, the 8 letters and digits said when it was made (or by --check)')
  // BRIDGE_GH (tests): a Node script standing in for gh.
  const gh = (...a) => {
    const [cmd, all] = process.env.BRIDGE_GH ? [process.execPath, [process.env.BRIDGE_GH, ...a]] : ['gh', a]
    try { return execFileSync(cmd, all, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { fail(e.code === 'ENOENT' ? 'this needs the GitHub CLI (gh): https://cli.github.com, then gh auth login' : String(e.stderr || e.message).trim()) }
  }
  const tag = JSON.parse(gh('release', 'list', '--limit', '1', '--exclude-drafts', '--json', 'tagName'))[0]?.tagName
  if (!tag) fail('there\'s no release on GitHub to write it in')
  const { body } = JSON.parse(gh('release', 'view', tag, '--json', 'body'))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-revoke-')), 'notes.md')
  fs.writeFileSync(file, withRevoked(body, id))
  gh('release', 'edit', tag, '--notes-file', file)
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  console.log(`Code ${id} is taken back in ${tag}'s notes: computers on Early Access with it go back to regular releases at their next check (within 6 hours), keeping the version they have until Stable passes it.
For good, add it to REVOKED in server/earlyaccess.js before the next release: '${id}'`)
  process.exit(0)
}

// ---------- A code ----------
const label = args.find((a, i) => !a.startsWith('--') && !['--days', '--key'].includes(args[i - 1]))
if (!label) fail('who is it for? node scripts/early-access-code.js <name> [--days N], with a first name or nickname')
const days = opt('--days') == null ? null : Number(opt('--days'))
if (days != null && !(days > 0)) fail('--days needs a number of days, more than 0')
let privateKey
try { privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8')) } catch (e) { fail(e.code === 'ENOENT' ? `there's no key at ${keyFile}. Make one with --new-key, or say where yours is (--key FILE or BRIDGE_EARLY_ACCESS_PRIVATE_KEY).` : `${keyFile} isn't a private key (${e.message})`) }
if (inRepo(keyFile)) fail(`${keyFile} is inside this repo, where a private key must never be. Move it out first.`)
let code
try { code = makeCode({ label, days, privateKey }) } catch (e) { fail(e.message) }
const r = readCode(code)
if (publicKey() && !r.ok) fail(`this key isn't the one server/earlyaccess.js has (${whyNot(r)}), so no build would take codes made with it`)
const d = JSON.parse(Buffer.from(code.split('.')[1], 'base64url').toString('utf8'))
console.log(`Early-access code for ${label} (id ${d.id}), ${d.until ? `good for ${days} days, until ${day(d.until * 1000)}` : 'with no end date'}:

${code}

In Bridge AI: Settings › About & Updates › Have an early-access code?, paste it, Join.
Take it back: node scripts/early-access-code.js --revoke ${d.id}`)
if (!publicKey()) console.log('\nNo build takes it yet: server/earlyaccess.js has no PUBLIC_KEY. Put the one --new-key printed there.')
