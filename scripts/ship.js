#!/usr/bin/env node
// Shipping from this computer, a step at a time (the admin view will start the same steps later):
// each change goes to main and out as a nightly for the owner's computers, a beta to Early Access
// when they say so, and a release to everyone at the weekend.
//   npm run ship                          where things stand: this branch, main, the newest
//                                         nightly, beta and release, runs going, and this computer
//   npm run ship -- nightly [--wait]      this branch onto main, then a nightly built from main now
//   npm run ship -- beta [--minor|--patch] [--wait]   main as the next beta, for Early Access
//   npm run ship -- stable [--wait]       main as the release its version names, to everyone
//   npm run ship -- promote <version> <percent>      a release on Stable to more computers (0 pauses)
//   npm run ship -- join [--install]      this computer on Nightly (--install: first the newest
//                                         nightly, when the version here can't take them)
//   --dry-run   says what it would do, and does nothing
// It uses git and the GitHub CLI (gh, signed in), never a token of its own. A nightly's tests are
// those for what changed since the last one, a beta's since the last nightly, and a release's every
// test (.github/workflows/release.yml); a step whose tests fail publishes nothing.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compare, isPre, isNightly, RELEASE_VERSION } from '../shared/version.js'
import { rolloutOf } from '../shared/rollout.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'sahil1/bridge'

// ---------- what each step works out (pure, for the tests) ----------

const parts = (v) => String(v).split('-')[0].split('.').map(Number)
const bump = (v, how) => { const [a, b, c] = parts(v); return how === 'patch' ? `${a}.${b}.${c + 1}` : `${a}.${b + 1}.0` }
// The next beta from main's version and the tags there are: main's own when it isn't out yet; the
// beta after it (3.20.0-beta.1 → beta.2); the first of a version not out yet (3.20.0 →
// 3.20.0-beta.1); or, when
// main's version is out, the first of the next one (a minor version unless how is 'patch'). Never
// one whose tag is taken.
export function nextBeta(version, tags = [], { how = 'minor' } = {}) {
  const m = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(version)
  // main says a beta that isn't out yet (its notes written by hand): that one.
  if (m && !tags.includes(`v${version}`)) return version
  const core = m ? m[1] : /^\d+\.\d+\.\d+$/.test(version) && tags.includes(`v${version}`) ? bump(version, how) : String(version).split('-')[0]
  let n = m ? Number(m[2]) + 1 : 1
  while (tags.includes(`v${core}-beta.${n}`)) n++
  return `${core}-beta.${n}`
}
// The release main's version names: the version a beta is of, or main's own when it isn't out yet.
// One that's out already: null (ship a beta first, which moves main on).
export function stableOf(version, tags = []) {
  const core = String(version).split('-')[0]
  return tags.includes(`v${core}`) ? null : core
}
// A beta's notes, when nobody wrote its CHANGELOG section: what it is, and the changes since the
// last beta or release, as their commit messages.
export function betaNotes({ version, since, changes }) {
  const list = changes.length ? changes.slice(0, 40).map((c) => `- ${c}`).join('\n') + (changes.length > 40 ? `\n- …and ${changes.length - 40} more` : '') : '- Nothing new since the last one: built again.'
  return `A beta of ${version.split('-')[0]} for Early Access, with what changed since ${since || 'the last release'}.\n\n${list}`
}
// CHANGELOG.md with a section for version, above the newest one, unless it has one already.
export function withSection(changelog, version, text) {
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(changelog)) return changelog
  const i = changelog.search(/^## /m)
  const at = i < 0 ? changelog.length : i
  return `${changelog.slice(0, at)}## ${version}\n\n${text.trim()}\n\n${changelog.slice(at)}`
}
// The newest of each kind among GitHub's releases ({ tagName, publishedAt, isPrerelease }).
export function newestKinds(releases) {
  const by = (ok) => releases.filter((r) => ok(r.tagName.replace(/^v/, ''))).sort((a, b) => compare(b.tagName, a.tagName))[0] || null
  return { nightly: by(isNightly), beta: by((v) => isPre(v) && !isNightly(v)), stable: by((v) => RELEASE_VERSION.test(v) && !isPre(v)) }
}

// ---------- doing it ----------

const say = (s = '') => console.log(s)
const fail = (msg) => { console.error(`ship: ${msg}`); process.exit(1) }
const run = (cmd, a, o = {}) => execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim()
const git = (...a) => run('git', a)
const gh = (...a) => run('gh', a)
const ghJson = (...a) => JSON.parse(gh(...a) || 'null')
const live = (cmd, a, o = {}) => { const r = spawnSync(cmd, a, { cwd: ROOT, stdio: 'inherit', ...o }); if (r.status !== 0) fail(`${cmd} ${a.join(' ')} didn't go through`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tags = () => { git('fetch', '-q', 'origin', 'main', '--tags', '--force'); return git('tag', '-l', 'v*').split('\n').filter(Boolean) }
const mainVersion = () => JSON.parse(git('show', 'origin/main:package.json')).version
const clean = () => { if (git('status', '--porcelain', '--untracked-files=no')) fail('there are uncommitted changes here; commit them first') }

// This computer's Bridge AI, through its local API and its key: { current, channel, latest, … }.
async function here(p = '/updates', o = {}) {
  const data = process.env.BRIDGE_HOME || path.join(os.homedir(), '.bridge-ai')
  let key = null
  try { key = fs.readFileSync(path.join(data, 'api-token'), 'utf8').trim() } catch { return null }
  const port = process.env.BRIDGE_PORT || 7420
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { ...o, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(o.headers || {}) }, signal: AbortSignal.timeout(15000) })
    const j = await r.json().catch(() => ({}))
    return r.ok ? j : { failed: j.error || `HTTP ${r.status}` }
  } catch { return null }
}
// Asked to look on GitHub now; when GitHub turns it away (its limit for computers not signed in to
// it), what it knew from its last look.
const hereNow = async () => { const u = await here('/updates?refresh=1'); return u?.failed ? await here('/updates') || u : u }
const hereLine = (u) => (!u ? 'Bridge AI isn\'t running on this computer (or its key isn\'t where it should be).'
  : u.failed ? `This computer's Bridge AI said: ${u.failed}`
    : `This computer: Bridge AI ${u.current}, on ${({ stable: 'Stable', early: 'Early Access', nightly: 'Nightly' })[u.channel] || u.channel}${u.available ? `; ${u.latest} is ready (About & Updates, or by itself while you're away)` : u.latest ? '; up to date' : ''}${u.error ? ` (it couldn't ask GitHub just now: ${u.error})` : ''}.`)

// The run a workflow_dispatch just started (gh says nothing back): the newest of that workflow since.
async function startedRun(workflow, since) {
  for (let i = 0; i < 20; i++) {
    const runs = ghJson('run', 'list', '--repo', REPO, '--workflow', workflow, '--limit', '5', '--json', 'databaseId,url,createdAt,status')
    const r = (runs || []).find((x) => Date.parse(x.createdAt) >= since - 5000)
    if (r) return r
    await sleep(3000)
  }
  return null
}
// A tag's Release run, once GitHub has started it.
async function tagRun(tag) {
  for (let i = 0; i < 20; i++) {
    const runs = ghJson('run', 'list', '--repo', REPO, '--workflow', 'release.yml', '--branch', tag, '--limit', '1', '--json', 'databaseId,url,status')
    if (runs?.[0]) return runs[0]
    await sleep(3000)
  }
  return null
}
async function follow(r, what, wait) {
  if (!r) return say(`${what} started; its run is at https://github.com/${REPO}/actions`)
  say(`${what}: ${r.url}`)
  if (!wait) return say('npm run ship says how it\'s going; add --wait to follow it here.')
  live('gh', ['run', 'watch', String(r.databaseId), '--repo', REPO, '--exit-status', '--interval', '30'])
  say(hereLine(await hereNow()))
}

// This branch onto main through a pull request, merged at once: the nightly's own tests decide
// whether it goes out. Returns the merge's commit on main.
function ontoMain(dry) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch === 'HEAD') fail('this checkout is on no branch; switch to the branch with the change')
  git('fetch', '-q', 'origin', 'main')
  if (branch === 'main') {
    if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('main here isn\'t main on GitHub; put the change on a branch, or pull')
    return null
  }
  const ahead = Number(git('rev-list', '--count', `origin/main..${branch}`))
  if (!ahead) { say(`${branch} has nothing main doesn't: the nightly is built from main as it is.`); return null }
  say(`${branch}: ${ahead} commit${ahead === 1 ? '' : 's'} onto main, through a pull request merged now.`)
  if (dry) return null
  live('git', ['push', '-u', 'origin', branch])
  let pr = ghJson('pr', 'list', '--repo', REPO, '--head', branch, '--base', 'main', '--state', 'open', '--json', 'number,url')?.[0]
  if (!pr) {
    gh('pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--fill')
    pr = ghJson('pr', 'list', '--repo', REPO, '--head', branch, '--base', 'main', '--state', 'open', '--json', 'number,url')?.[0]
  }
  if (!pr) fail(`couldn't open a pull request for ${branch}`)
  say(`Pull request: ${pr.url}`)
  live('gh', ['pr', 'merge', String(pr.number), '--repo', REPO, '--merge'])
  git('fetch', '-q', 'origin', 'main')
  return git('rev-parse', 'origin/main')
}

async function nightly(o) {
  clean()
  ontoMain(o.dry)
  say('A nightly built from main now: the tests for what changed since the last nightly, then the builds, about 40 minutes. Computers on Nightly are offered it within half an hour of it coming out.')
  if (o.dry) return say('Dry run: nothing pushed or started.')
  const t0 = Date.now()
  live('gh', ['workflow', 'run', 'nightly.yml', '--repo', REPO, '--ref', 'main'])
  await follow(await startedRun('nightly.yml', t0), 'Nightly', o.wait)
}

// main's version and notes changed in a checkout of main of its own (this one is left as it is),
// through a pull request merged at once; then the tag, from main, by npm run release's own checks.
async function versioned(version, notes, o) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ship-'))
  const branch = `ship-${version}`
  try {
    git('worktree', 'add', '-q', '-B', branch, tmp, 'origin/main')
    const at = (f) => path.join(tmp, f)
    const was = JSON.parse(fs.readFileSync(at('package.json'), 'utf8')).version
    if (was !== version) {
      for (const dir of [tmp, at('desktop')]) run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], { cwd: dir, shell: process.platform === 'win32' })
    }
    const log = fs.readFileSync(at('CHANGELOG.md'), 'utf8')
    const next = notes ? withSection(log, version, notes) : log
    if (next !== log) fs.writeFileSync(at('CHANGELOG.md'), next)
    const changed = run('git', ['status', '--porcelain'], { cwd: tmp })
    if (changed) {
      say(`main to ${version}: ${changed.split('\n').map((l) => l.slice(3)).join(', ')}.`)
      if (o.dry) { say(run('git', ['diff', '--', 'CHANGELOG.md'], { cwd: tmp }).split('\n').slice(0, 40).join('\n')); return say('Dry run: nothing pushed or started.') }
      run('git', ['commit', '-qam', `${version}: ${isPre(version) ? 'a beta for Early Access' : 'a release to everyone'}`], { cwd: tmp })
      live('git', ['push', '-u', 'origin', branch], { cwd: tmp })
      gh('pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--title', version, '--body', isPre(version) ? `${version} for Early Access.` : `${version} for everyone.`)
      live('gh', ['pr', 'merge', branch, '--repo', REPO, '--merge', '--delete-branch'], { cwd: tmp })
      run('git', ['fetch', '-q', 'origin', 'main'], { cwd: tmp })
      run('git', ['checkout', '-q', '--detach', 'origin/main'], { cwd: tmp })
    } else if (o.dry) return say(`main says ${version} already, with its notes: the tag goes from main as it is.\nDry run: nothing pushed or started.`)
    // npm run release's checks and its tag, from this checkout of main.
    live(process.execPath, [path.join(tmp, 'scripts', 'release.js')], { cwd: tmp })
  } finally {
    try { git('worktree', 'remove', '--force', tmp) } catch { fs.rmSync(tmp, { recursive: true, force: true }) }
    try { git('branch', '-D', branch) } catch { /* merged and gone, or never made */ }
  }
  await follow(await tagRun(`v${version}`), isPre(version) ? 'Beta' : 'Release', o.wait)
}

async function beta(o) {
  clean()
  const all = tags()
  const v = mainVersion()
  const version = nextBeta(v, all, { how: o.patch ? 'patch' : 'minor' })
  // The changes since the last beta or release, for its notes when nobody wrote them.
  const since = all.filter((t) => !isNightly(t) && RELEASE_VERSION.test(t.replace(/^v/, ''))).filter((t) => { try { git('merge-base', '--is-ancestor', t, 'origin/main'); return true } catch { return false } }).sort((a, b) => compare(b, a))[0] || null
  const changes = git('log', '--no-merges', '--format=%s', ...(since ? [`${since}..origin/main`] : ['-30', 'origin/main'])).split('\n').filter(Boolean)
  say(`main is ${v}: the beta is ${version}, for Early Access only. Its tests: those for what changed since the last nightly.`)
  await versioned(version, betaNotes({ version, since: since?.replace(/^v/, ''), changes }), o)
}

async function stable(o) {
  clean()
  const all = tags()
  const v = mainVersion()
  const version = stableOf(v, all)
  if (!version) fail(`${v.split('-')[0]} is out already. npm run ship -- beta starts the next one.`)
  // A release's notes are written for people, not made from commits: its CHANGELOG section first.
  const log = git('show', 'origin/main:CHANGELOG.md')
  const m = log.match(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))
  if (!m || !m[1].replace(/<!--.*?-->/g, '').trim()) fail(`main's CHANGELOG.md has no "## ${version}" section yet. Write what's in it (on a branch, then npm run ship -- nightly), then ship it.`)
  const r = rolloutOf(m[1])
  say(`main is ${v}: the release is ${version}, to ${r == null ? 'everyone on Stable at once' : `${r}% of Stable at first (npm run ship -- promote ${version} 50, then 100)`}, Early Access and Nightly too. Every test runs first, about an hour.`)
  await versioned(version, null, o)
}

function promote(version, percent, o) {
  if (!version || percent == null) fail('promote <version> <percent>: 10, 50 or 100, or 0 to pause')
  live(process.execPath, [path.join(ROOT, 'scripts', 'rollout.js'), version, String(percent), ...(o.dry ? ['--dry-run'] : [])])
}

async function join(o) {
  const u = await here()
  if (!u || u.failed) fail(hereLine(u))
  if (u.nightly?.on) return say(hereLine(u))
  if (u.nightly) {
    if (o.dry) return say(`${hereLine(u)}\nDry run: it would switch to Nightly.`)
    const r = await here('/updates/nightly', { method: 'POST', body: '{}' })
    if (r?.failed) fail(r.failed)
    return say(hereLine(await hereNow()))
  }
  // A version from before Nightly (3.19.0 and older): the newest nightly installed first.
  const n = newestKinds(ghJson('release', 'list', '--repo', REPO, '--limit', '60', '--json', 'tagName,publishedAt,isPrerelease') || []).nightly
  if (!n) fail(`Bridge AI ${u.current} here can't take nightlies, and there's no nightly to install yet: npm run ship -- nightly makes one.`)
  const cmd = `curl --proto '=https' -fsSL https://raw.githubusercontent.com/${REPO}/${n.tagName}/install.sh | BRIDGE_VERSION=${n.tagName} sh`
  if (!o.install) return say(`Bridge AI ${u.current} here can't take nightlies. Install the newest, ${n.tagName.slice(1)}, with:\n  npm run ship -- join --install\n(it runs ${cmd}), then npm run ship -- join again.`)
  if (o.dry) return say(`Dry run: it would run ${cmd}`)
  say(`Installing ${n.tagName.slice(1)} (Bridge AI closes and opens again; agents carry on)…`)
  live('/bin/sh', ['-c', cmd])
  say('When Bridge AI is open again: npm run ship -- join')
}

async function status() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  const all = tags()
  const v = mainVersion()
  const ahead = branch !== 'main' && branch !== 'HEAD' ? Number(git('rev-list', '--count', `origin/main..${branch}`)) : 0
  say(`This checkout: ${branch}${ahead ? `, ${ahead} commit${ahead === 1 ? '' : 's'} not on main yet (npm run ship -- nightly)` : ''}.`)
  const out = stableOf(v, all)
  say(`main: ${v}${out ? ` (npm run ship -- stable would release ${out}; -- beta, ${nextBeta(v, all)})` : ` is out; -- beta would make ${nextBeta(v, all)}`}.`)
  let rel = []
  try { rel = ghJson('release', 'list', '--repo', REPO, '--limit', '60', '--json', 'tagName,publishedAt,isPrerelease') || [] } catch { say('(GitHub didn\'t answer: is gh signed in?)') }
  const k = newestKinds(rel)
  const when = (r) => (r ? `${r.tagName.slice(1)}, ${new Date(r.publishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'none yet')
  say(`Newest nightly: ${when(k.nightly)}\nNewest beta:    ${when(k.beta)}\nNewest release: ${when(k.stable)}`)
  try {
    const runs = ghJson('run', 'list', '--repo', REPO, '--limit', '20', '--json', 'workflowName,displayTitle,status,conclusion,url,createdAt') || []
    const going = runs.filter((r) => ['Nightly', 'Release'].includes(r.workflowName)).slice(0, 4)
    if (going.length) say(`Runs:\n${going.map((r) => `  ${r.workflowName}: ${r.displayTitle} · ${r.status === 'completed' ? r.conclusion : r.status} · ${r.url}`).join('\n')}`)
  } catch { /* said above */ }
  say(hereLine(await hereNow()))
}

async function main(args) {
  const o = { dry: args.includes('--dry-run'), wait: args.includes('--wait'), install: args.includes('--install'), patch: args.includes('--patch') }
  const [cmd, a1, a2] = args.filter((a) => !a.startsWith('--'))
  try { run('gh', ['auth', 'status']) } catch { if (cmd !== 'join') fail('the GitHub CLI isn\'t signed in: gh auth login') }
  if (!cmd) return status()
  if (cmd === 'nightly') return nightly(o)
  if (cmd === 'beta') return beta(o)
  if (cmd === 'stable') return stable(o)
  if (cmd === 'promote') return promote(a1, a2, o)
  if (cmd === 'join') return join(o)
  fail('nightly | beta | stable | promote <version> <percent> | join (or nothing, for where things stand)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
