#!/usr/bin/env node
// Keeps the repo distribution-ready: nothing from your own use of Bridge AI (settings, sessions,
// transcripts, keys, logins, your name, your machine's paths) may be committed or shipped.
//   npm run check:private              every file git would ship (tracked, plus new files not ignored)
//   node scripts/check-private.js --staged   only what's staged (the pre-commit hook)
//   node scripts/check-private.js --dir build/app-root   a folder about to be packaged
//   node scripts/check-private.js --commits <git rev-list args>   every commit about to be pushed
//     (the pre-push hook), each file as that commit has it, so something added in one commit and
//     deleted in the next is still caught: it would still be in the pushed history.
// It also reads your own Bridge AI data folder (~/.bridge-ai, or BRIDGE_HOME), if there is one,
// for values that are yours (your name, places, hostnames) and fails if any of them shows up.
// Exit code 1 lists each problem with file and line. A line that must stay can end with
// `private-ok` and a reason, e.g. a test fixture.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const STAGED = args.includes('--staged')
const DIR = opt('--dir')
const COMMITS = args.includes('--commits') ? args.slice(args.indexOf('--commits') + 1) : null

// ---------- Which files ----------
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, base, out) } else out.push(path.relative(base, p))
  }
  return out
}
const show = (spec) => execFileSync('git', ['show', spec], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
let base = ROOT
// Each entry: the path, how to read it, and a prefix for messages (the commit, when checking pushes).
let list
if (DIR) { base = path.resolve(DIR); list = walk(base).map((f) => ({ f, read: () => fs.readFileSync(path.join(base, f)) })) }
else if (STAGED) list = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean).map((f) => ({ f, read: () => show(`:${f}`) }))
else if (COMMITS) {
  list = []
  const shas = git('rev-list', ...COMMITS).split('\n').filter(Boolean)
  for (const sha of shas) {
    const subject = git('log', '-1', '--format=%s', sha).trim().slice(0, 50)
    // Files the commit adds or changes (for a root commit, everything in it).
    const files = git('diff-tree', '--root', '--no-commit-id', '-r', '--name-only', '--diff-filter=ACMR', '-z', sha).split('\0').filter(Boolean)
    for (const f of files) list.push({ f, read: () => show(`${sha}:${f}`), at: `${sha.slice(0, 7)} "${subject}" ` })
  }
  list.commits = shas.length
}
else list = [...new Set([...git('ls-files', '-z').split('\0'), ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')])].filter(Boolean).map((f) => ({ f, read: () => fs.readFileSync(path.join(base, f)) }))

// ---------- Files that are personal by what they are ----------
// The names Bridge AI and the agents it runs use for your data, wherever they'd appear.
const PRIVATE_FILES = [
  [/(^|\/)config\.json$/, 'your Bridge AI settings (only config.example.json belongs here)', (f) => !/^(desktop|public)\//.test(f)],
  [/(^|\/)config\.local\.json$/, 'your local settings'],
  [/(^|\/)(secrets|push|accounts|runtime|routines|queue|ideas)\.json$/, 'Bridge AI data-folder file'],
  [/(^|\/)ideas\.md$/, 'your ideas list'],
  [/(^|\/)\.credentials\.json$|(^|\/)auth\.json$|(^|\/)oauth_creds\.json$/, 'an agent login'],
  [/\.jsonl$/, 'a session transcript or history log'],
  [/(^|\/)\.claude\.json$|(^|\/)\.claude\/(projects|todos|file-history|sessions|history)/, 'Claude Code state'],
  [/(^|\/)\.codex\/|(^|\/)\.gemini\//, 'agent state'],
  [/(^|\/)\.env(\.|$)/, 'environment secrets'],
  [/\.(pem|key|p12|pfx|keychain)$/, 'a key or certificate'],
  [/(^|\/)desktop\/root\.json$/, 'a path on your machine'],
  [/(^|\/)chief\/(state\/(?!(ledger|playbook)\.md$)|\.claude\/settings\.local\.json$|CLAUDE\.local\.md$)/, "the chief of staff's memory"],
  [/(^|\/)(cache|chats|accounts)\/[^/]+/, 'a data-folder entry', (f) => !/^(src|server|scripts|public)\//.test(f)],
]

// The chief of staff templates ship with placeholders, never filled in.
const TEMPLATES = { 'chief/state/ledger.md': /\{\{name\}\}/, 'chief/state/playbook.md': /\{\{name\}\}/ }

// ---------- Text that is personal ----------
const ALLOW_EMAIL = /(noreply|no-reply)@|@(users\.noreply\.github\.com|example\.(com|org)|anthropic\.com|openai\.com)$|^git@github\.com$/i
const GENERIC_USER = new Set(['you', 'me', 'user', 'username', 'name', 'runner', 'example', 'shared', 'public', 'yourname', 'your-name', '<you>', 'jane', 'john', 'alice', 'bob', 'admin', 'default'])
const PATTERNS = [
  ['an Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['an OpenAI-style key', /\bsk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['a GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['an AWS access key', /\b(AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ['a web-push private key', /"privateKey"\s*:\s*"[A-Za-z0-9_-]{40,}"/],
  ['your Tailscale machine name', /\b[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b/i, (m) => !/^(your|my|machine|device|name|example)[.-]/i.test(m)],
  ['a home-folder path', /(?:\/Users\/|\/home\/|[A-Za-z]:\\\\?Users\\\\?)([A-Za-z0-9._-]+)/, (m, g) => !GENERIC_USER.has(g.toLowerCase())],
  ['an email address', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/, (m) => !ALLOW_EMAIL.test(m)],
]

// Values that are yours, from this machine and your Bridge AI data folder.
function personalValues() {
  const vals = new Map() // value -> where it came from
  const addVal = (v, from) => { if (typeof v === 'string' && v.trim().length >= 4) vals.set(v.trim(), from) }
  try { const u = os.userInfo().username; if (u.length >= 4 && !GENERIC_USER.has(u)) addVal(u, 'your username') } catch { /* no user */ }
  addVal(os.homedir(), 'your home folder')
  try { addVal(git('config', 'user.email').trim(), 'your git email') } catch { /* not set */ }
  try { addVal(os.hostname().replace(/\.local$/, ''), 'your computer name') } catch { /* none */ }
  const data = path.resolve(process.env.BRIDGE_HOME || path.join(os.homedir(), '.bridge-ai'))
  try {
    const c = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
    addVal(c.name, 'your name in Bridge AI settings')
    addVal(c.location?.label, 'your location in Bridge AI settings')
    for (const v of [c.location?.lat, c.location?.lon]) if (typeof v === 'number' && String(v).includes('.')) addVal(String(v), 'your location in Bridge AI settings')
    for (const h of c.allowedHosts || []) addVal(h, 'an allowed host in your settings')
    for (const m of [].concat(c.mail?.accounts || [])) addVal(m?.address || m?.email, 'a mail account in your settings')
  } catch { /* no settings */ }
  try { for (const v of Object.values(JSON.parse(fs.readFileSync(path.join(data, 'secrets.json'), 'utf8')))) if (String(v).length >= 8) addVal(v, 'a key saved in Bridge AI') } catch { /* none */ }
  try { addVal(JSON.parse(fs.readFileSync(path.join(data, 'push.json'), 'utf8'))?.keys?.privateKey, 'your push key') } catch { /* none */ }
  return vals
}

// The repo's own public identity is fine to mention.
const PUBLIC_NAMES = new Set()
try { const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).repository?.url?.match(/github\.com[/:]([^/]+)\//); if (m) PUBLIC_NAMES.add(m[1].toLowerCase()) } catch { /* no repo url */ }

// ---------- Check ----------
const problems = []
// Whole words only, so a first name doesn't match inside another word.
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mine = [...personalValues()].filter(([v]) => !PUBLIC_NAMES.has(v.toLowerCase())).map(([v, from]) => [new RegExp(`(?<![A-Za-z0-9])${esc(v)}(?![A-Za-z0-9])`, 'i'), from])
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|pdf|zip|gz|dmg|exe|node|wasm|mp[34]|wav)$/i
const SKIP_TEXT = new Set(['package-lock.json', 'desktop/package-lock.json'])
const self = path.relative(ROOT, fileURLToPath(import.meta.url))
// Built bundles carry the libraries' own credits (authors' emails); your values and secrets are
// still looked for in them.
const BUNDLE = /(^|\/)assets\/[^/]+\.(js|css|map)$/

for (const { f, read, at: commit = '' } of list) {
  const rel = f.split(path.sep).join('/')
  for (const [re, why, when] of PRIVATE_FILES) if (re.test(rel) && (!when || when(rel))) problems.push(`${commit}${rel}: ${why}; it belongs in your data folder, not the repo`)
  let buf
  try { buf = read() } catch { continue }
  if (TEMPLATES[rel] && !TEMPLATES[rel].test(buf.toString('utf8'))) problems.push(`${commit}${rel}: the template has been filled in with someone's details; restore the {{name}} placeholders`)
  if (BINARY.test(rel) || buf.includes(0) || buf.length > 4 * 1024 * 1024) continue
  const text = buf.toString('utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (/private-ok/.test(line)) return
    const at = `${commit}${rel}:${i + 1}`
    if (!SKIP_TEXT.has(rel) && rel !== self) {
      for (const [what, re, keep] of PATTERNS) {
        const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
        if (what === 'an email address' && BUNDLE.test(rel)) continue
        for (const m of line.matchAll(g)) if (!keep || keep(m[0], m[1] || '')) problems.push(`${at}: ${what} (${m[0].slice(0, 12)}…)`)
      }
    }
    for (const [re, from] of mine) if (re.test(line)) problems.push(`${at}: ${from} appears here`)
  })
}

const where = DIR ? path.relative(ROOT, base) || base : STAGED ? 'staged files' : COMMITS ? `${list.commits} commit${list.commits === 1 ? '' : 's'} to push` : 'the repo'
if (problems.length) {
  console.error(`check-private: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${where} (${list.length} files checked):\n`)
  for (const p of [...new Set(problems)]) console.error(`  ${p}`)
  console.error('\nPersonal data lives in your data folder (~/.bridge-ai), never in the repo. Remove these, or end a line with "private-ok: <reason>" if it is really meant to ship.')
  if (COMMITS) console.error('Already committed: fix it in a new commit and, if it is a secret, rewrite those commits (git rebase -i) before pushing, and rotate the secret.')
  process.exit(1)
}
console.log(`check-private: ${COMMITS ? `${where}: clean` : `${where} is clean`} (${list.length} files checked)`)
