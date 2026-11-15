// Releases started and moved on from GitHub itself, without a terminal (the admin view's Release,
// Promote, Pause and Nightly now only start workflows): rollout.yml and release-start.yml. Each runs
// from main only, with GitHub's own token and only the permissions it needs, and its inputs reach the
// shell as variables, never as code. rollout.yml lets only a version and a number get as far as
// scripts/rollout.js, which refuses the rest; release-start.yml refuses a version that isn't main's,
// runs scripts/release.js, then starts release.yml and docker.yml at the tag (a tag GitHub's token
// pushes starts nothing). Started at a tag, release.yml, test.yml and docker.yml do what a pushed
// tag makes them do: they go by the ref, never by what started them; and Fresh install follows such
// a run. The scripts as the workflows run them (GITHUB_ACTIONS): release.js in a repo of its own with
// an origin on this computer pushes the annotated tag at main and says what starts next, or refuses
// as the run's error (the tag there, main moved on, no CHANGELOG section, the two package.json files
// apart); rollout.js with gh stood in for, its refusals the run's error too. The steps' own shell is
// run by bash (not on Windows, which has none; the rest still runs there).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { checks, ROOT, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('release-controls')
const yml = (f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8')
const rollout = yml('rollout.yml')
const start = yml('release-start.yml')
const release = yml('release.yml')
const docker = yml('docker.yml')
const fresh = yml('fresh-install.yml')
const test = yml('test.yml')

// A step's shell script as GitHub runs it: its `run: |` block, unindented (or a one-line run).
function script(text, name) {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`)
  if (at < 0) return null
  for (let i = at + 1; i < lines.length && !/^\s*- /.test(lines[i]); i++) {
    const one = /^\s*run: '(.*)'$/.exec(lines[i])
    if (one) return `${one[1].replace(/''/g, '\'')}\n`
    const m = /^(\s*)run: \|$/.exec(lines[i])
    if (!m) continue
    const body = []
    for (let j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > m[1].length); j++) body.push(lines[j])
    const cut = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)))
    return `${body.map((l) => l.slice(cut)).join('\n').trim()}\n`
  }
  return null
}
// Every place a workflow's inputs are read: only where GitHub puts them in a variable or a title.
const inputsOnlyAsValues = (text) => text.split('\n').filter((l) => l.includes('${{ inputs.')).every((l) => /^\s*(run-name|group|[A-Z_]+): /.test(l))
const jobPermissions = (text) => (/\n    permissions:\n((?: {6}[\w-]+: \w+.*\n)+)/.exec(text)?.[1] || '').trim().split('\n').map((l) => l.trim().replace(/\s*#.*$/, ''))

// ---------- rollout.yml ----------
ok(/^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}version:\n[\s\S]*?required: true[\s\S]*?\n {6}percent:\n[\s\S]*?required: true/m.test(rollout) && !/^\s+(push|schedule|pull_request|workflow_call):/m.test(rollout), 'rollout.yml: started by hand or by the admin view only, with a version and a percentage')
ok(/^run-name: Rollout \$\{\{ inputs\.version \}\} to \$\{\{ inputs\.percent \}\}%$/m.test(rollout), 'its run says which release and to what, so the admin view finds the run and its timeline the change')
ok(/^permissions:\n {2}contents: read\n/m.test(rollout) && JSON.stringify(jobPermissions(rollout)) === '["contents: write"]', 'read-only, but for writing the release\'s notes', jobPermissions(rollout))
ok(inputsOnlyAsValues(rollout) && /run: node scripts\/rollout\.js "\$VERSION" "\$PERCENT"/.test(rollout) && /GH_TOKEN: \$\{\{ github\.token \}\}/.test(rollout) && /GH_REPO: \$\{\{ github\.repository \}\}/.test(rollout), 'the inputs reach the shell as variables, and the repo\'s own script does the change with GitHub\'s token')
ok(/persist-credentials: false/.test(rollout) && /group: rollout-\$\{\{ inputs\.version \}\}/.test(rollout), 'no token kept in the checkout, and one change to a release at a time')

// ---------- release-start.yml ----------
ok(/^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}version:\n[\s\S]*?default: ''/m.test(start) && !/^\s+(push|schedule|pull_request|workflow_call):/m.test(start) && !/required: true/.test(start), 'release-start.yml: started by hand or by the admin view, needing nothing (the version is main\'s)')
ok(/^permissions:\n {2}contents: read\n/m.test(start) && JSON.stringify(jobPermissions(start)) === '["contents: write","actions: write"]', 'read-only, but for the tag and starting the workflows at it', jobPermissions(start))
ok(inputsOnlyAsValues(start) && /^concurrency:\n {2}group: release-start$/m.test(start), 'its input reaches the shell as a variable, and one runs at a time')
const order = ['From main', 'The version asked for is main\'s', 'The checks npm run release makes, then the tag', 'The release and the Docker image, at the tag'].map((n) => start.indexOf(`- name: ${n}`))
ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'in order: from main, the version asked for, the checks and the tag, then the release', order)
const tagging = script(start, 'The checks npm run release makes, then the tag') || ''
ok(/git config user\.name 'github-actions\[bot\]'/.test(tagging) && /^node scripts\/release\.js$/m.test(tagging) && !/--dry-run/.test(tagging) && /echo "tag=v\$\(node -p "require\('\.\/package\.json'\)\.version"\)" >> "\$GITHUB_OUTPUT"/.test(tagging), 'npm run release\'s own script checks and pushes the tag, as the bot', tagging)
const starting = script(start, 'The release and the Docker image, at the tag') || ''
ok(/gh workflow run release\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$TAG"/.test(starting) && /gh workflow run docker\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$TAG"/.test(starting) && /GH_TOKEN: \$\{\{ github\.token \}\}/.test(start), 'then the release and the Docker image, at the tag: what pushing it from a computer starts', starting)
ok(/persist-credentials: true/.test(start) && !/\bnpm (ci|install|i)\b|npx /.test(start), 'the checkout keeps the token for the tag\'s push only where nothing is installed or run but the repo\'s own scripts')

// ---------- a tag started by hand is a pushed tag ----------
ok(/workflow_dispatch:/.test(release) && !/event_name/.test(release), 'release.yml can be started at a tag, and nothing in it asks what started it')
ok(/if: startsWith\(github\.ref, 'refs\/tags\/v'\)\n\s*run: \|\n\s*git fetch --no-tags origin main\n\s*git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/.test(release) && /\[ "v\$v" = "\$GITHUB_REF_NAME" \]/.test(release), 'started at a tag, the guard checks the tag\'s commit is on main and its version is the tag\'s, as for a push')
ok(/release:\n\s*name: Publish the release\n\s*# [^\n]*\n\s*if: \$\{\{ !cancelled\(\) && \(startsWith\(github\.ref, 'refs\/tags\/v'\) \|\| inputs\.nightly\) && needs\.build\.result == 'success' \}\}/.test(release) && /VERSION="\$\{GITHUB_REF_NAME#v\}"/.test(release) && /if: matrix\.platform == 'mac' && \(startsWith\(github\.ref, 'refs\/tags\/v'\) \|\| inputs\.nightly\)/.test(release), 'and publishes it, the Developer ID check first, as for a push')
ok(/elif \[\[ "\$GITHUB_REF" == refs\/tags\/\* \]\]; then base=$/m.test(test) && /if: github\.ref_type != 'tag' && needs\.scope\.outputs\.mobile == 'true'/.test(test), 'its tests are every test, by the ref, and the throwaway Android build left to the release, as for a push')
ok(/workflow_dispatch:/.test(docker) && !/event_name/.test(docker) && /push: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/.test(docker) && /uses: docker\/login-action[^\n]*\n\s*if: startsWith\(github\.ref, 'refs\/tags\/v'\)/.test(docker), 'docker.yml started at a tag pushes the image, as for a push')
ok(/github\.event\.workflow_run\.event == 'push' \|\| \(github\.event\.workflow_run\.event == 'workflow_dispatch' && startsWith\(github\.event\.workflow_run\.head_branch, 'v'\)\)/.test(fresh), 'and Fresh install follows a release started at its tag, as it does a pushed one')

// ---------- the steps' own shell ----------
if (IS_WIN) skip('the workflows\' shell steps', 'Windows has no bash')
else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-steps-'))
  const bash = (text, env, cwd = dir) => { const x = spawnSync('/bin/bash', ['-e', '-c', text], { cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }); return { status: x.status, out: `${x.stdout}${x.stderr}` } }
  const check = script(rollout, 'From main, with a version and a percentage')
  const main = { GITHUB_REF: 'refs/heads/main' }
  ok(['3.20.0', 'v3.20.0', '3.21.0-beta.1'].every((v) => bash(check, { ...main, VERSION: v, PERCENT: '50' }).status === 0) && bash(check, { ...main, VERSION: '3.20.0', PERCENT: '150' }).status === 0, 'rollout: a version and a whole number go on (scripts/rollout.js refuses over 100)')
  const refused = [
    [{ GITHUB_REF: 'refs/heads/feature', VERSION: '3.20.0', PERCENT: '50' }, /from main only, not refs\/heads\/feature/],
    [{ ...main, VERSION: '--dry-run', PERCENT: '50' }, /"--dry-run" isn't a version/],
    [{ ...main, VERSION: '3.20.0; echo hi', PERCENT: '50' }, /isn't a version/],
    [{ ...main, VERSION: '3.20.0', PERCENT: '--dry-run' }, /a whole number from 0 to 100, not "--dry-run"/],
    [{ ...main, VERSION: '3.20.0', PERCENT: '' }, /a whole number/],
    [{ ...main, VERSION: '3.20.0', PERCENT: 'ten' }, /a whole number/],
  ].map(([env, said]) => { const r = bash(check, env); return r.status !== 0 && said.test(r.out) && /::error::/.test(r.out) ? null : r })
  ok(refused.every((r) => r === null), 'and refuses, as the run\'s error: off main, something that isn\'t a version, a flag or nothing for the percentage', refused)
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "version": "99.1.0" }\n')
  const asked = script(start, 'The version asked for is main\'s')
  const a = [bash(asked, { ASKED: '' }), bash(asked, { ASKED: '99.1.0' }), bash(asked, { ASKED: '99.0.9' })]
  ok(a[0].status === 0 && a[1].status === 0 && a[2].status !== 0 && /::error::release: main is at 99\.1\.0 now, not 99\.0\.9/.test(a[2].out), 'release start: no version asked for, or main\'s, goes on; another (main moved on since the admin view showed it) is refused', a.map((x) => x.out))
  const from = script(start, 'From main')
  ok(bash(from, main).status === 0 && /from main only, not refs\/tags\/v1\.0\.0/.test(bash(from, { GITHUB_REF: 'refs/tags/v1.0.0' }).out), 'and only from main', from)
  fs.rmSync(dir, { recursive: true, force: true })
}

// ---------- scripts/release.js as release-start.yml runs it ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-release-start-'))
  const repo = path.join(dir, 'repo')
  const other = path.join(dir, 'other')
  const origin = path.join(dir, 'origin.git')
  for (const f of ['scripts/release.js', 'scripts/check-private.js', 'shared/private.js', 'shared/version.js', 'shared/rollout.js']) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true })
    fs.copyFileSync(path.join(ROOT, f), path.join(repo, f))
  }
  fs.mkdirSync(path.join(repo, 'desktop'))
  const gitConfig = path.join(dir, 'gitconfig')
  fs.writeFileSync(gitConfig, '[user]\n\tname = github-actions[bot]\n\temail = bot@example.com\n[init]\n\tdefaultBranch = main\n')
  const env = { ...process.env, HOME: dir, USERPROFILE: dir, BRIDGE_HOME: path.join(dir, 'data'), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GITHUB_ACTIONS: 'true' }
  delete env.GITHUB_REF_NAME
  const git = (cwd, ...a) => spawnSync('git', a, { cwd, env, encoding: 'utf8' })
  spawnSync('git', ['init', '-q', '--bare', origin], { env })
  git(dir, 'init', '-q', repo)
  git(repo, 'remote', 'add', 'origin', origin)
  const version = (v, section, desktop = v) => {
    fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'bridge-ai', version: v, type: 'module' }, null, 2)}\n`)
    fs.writeFileSync(path.join(repo, 'desktop', 'package.json'), `${JSON.stringify({ name: 'bridge-ai-desktop', version: desktop, build: { mac: { minimumSystemVersion: '14.0' } } }, null, 2)}\n`)
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), `# Changelog\n\n${section == null ? '' : `## ${v}\n\n${section}\n\n`}## 3.12.0\n\nThe one before.\n`)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', `Bridge AI ${v}`)
    git(repo, 'push', '-q', 'origin', 'HEAD:main')
  }
  const run = () => { const x = spawnSync(process.execPath, [path.join(repo, 'scripts', 'release.js')], { cwd: repo, env, encoding: 'utf8' }); return { status: x.status, out: `${x.stdout}${x.stderr}` } }
  const tags = () => git(repo, 'ls-remote', '--tags', 'origin').stdout.trim()

  version('99.1.0', 'Everyone gets the new thing.\n\n<!-- rollout: 10 -->')
  let r = run()
  const head = git(repo, 'rev-parse', 'HEAD').stdout.trim()
  ok(r.status === 0 && /10% of computers on Stable are offered it at first/.test(r.out) && new RegExp(`${head}\\s+refs/tags/v99\\.1\\.0\\^\\{\\}`).test(tags()), 'release start: main\'s version checked, who it goes to said, and the tag pushed at main\'s commit', r.out)
  ok(git(origin, 'cat-file', '-t', 'v99.1.0').stdout.trim() === 'tag' && /Bridge AI 99\.1\.0/.test(git(origin, 'cat-file', '-p', 'v99.1.0').stdout), 'an annotated tag, as npm run release makes it')
  ok(/starts nothing by itself: release-start\.yml starts the Release workflow and the Docker image at it next/.test(r.out) && !/GitHub is building/.test(r.out), 'and it says the push starts nothing, so the workflow starts them next', r.out)
  r = run()
  ok(r.status !== 0 && /^::error::release: v99\.1\.0 already exists on GitHub/m.test(r.out), 'run again: the tag is there, refused as the run\'s error', r.out)

  version('99.2.0', null)
  r = run()
  ok(r.status !== 0 && /^::error::release: CHANGELOG\.md has no section "## 99\.2\.0"/m.test(r.out) && !/v99\.2\.0/.test(tags()), 'no CHANGELOG section: refused, nothing pushed', r.out)
  version('99.2.0', 'Something.', '99.1.9')
  r = run()
  ok(r.status !== 0 && /^::error::release: desktop\/package\.json is 99\.1\.9 but package\.json is 99\.2\.0/m.test(r.out), 'the two package.json files apart: refused', r.out)

  // Main moves on after the run checked it out: another commit reaches origin first.
  version('99.3.0', 'The next thing.')
  git(dir, 'clone', '-q', origin, other)
  fs.writeFileSync(path.join(other, 'later.txt'), 'merged meanwhile\n')
  git(other, 'add', '-A')
  git(other, 'commit', '-qm', 'Merged meanwhile')
  git(other, 'push', '-q', 'origin', 'HEAD:main')
  r = run()
  ok(r.status !== 0 && /^::error::release: main moved on to [0-9a-f]{7} after this run started at [0-9a-f]{7}; start it again/m.test(r.out) && !/v99\.3\.0/.test(tags()), 'main moved on meanwhile: refused, nothing pushed', r.out)
  fs.rmSync(dir, { recursive: true, force: true })
}

// ---------- scripts/rollout.js as rollout.yml runs it, with the GitHub CLI stood in for ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-rollout-'))
  const state = path.join(dir, 'releases.json')
  const ghJs = path.join(dir, 'gh.cjs')
  fs.writeFileSync(ghJs, `const fs = require('fs')
const all = JSON.parse(fs.readFileSync(process.env.GH_STATE, 'utf8'))
const [cmd, sub, ...rest] = process.argv.slice(2)
const r = cmd === 'release' && all.find((x) => x.tagName === rest[0])
if (!r) { console.error('release not found'); process.exit(1) }
if (sub === 'view') console.log(JSON.stringify(r))
if (sub === 'edit') { r.body = fs.readFileSync(rest[rest.indexOf('--notes-file') + 1], 'utf8'); fs.writeFileSync(process.env.GH_STATE, JSON.stringify(all)) }
`)
  fs.writeFileSync(state, JSON.stringify([{ tagName: 'v99.1.0', body: 'Notes.\n\n<!-- rollout: 10 -->\n', isPrerelease: false, isDraft: false }, { tagName: 'v99.2.0', body: 'Not yet.\n', isPrerelease: false, isDraft: true }]))
  const env = { ...process.env, BRIDGE_GH: ghJs, GH_STATE: state, GITHUB_ACTIONS: 'true' }
  const set = (...a) => { const x = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'rollout.js'), ...a], { cwd: ROOT, env, encoding: 'utf8' }); return { status: x.status, out: `${x.stdout}${x.stderr}` } }
  const notes = () => JSON.parse(fs.readFileSync(state, 'utf8'))[0].body
  let r = set('99.1.0', '50')
  ok(r.status === 0 && /<!-- rollout: 50 -->/.test(notes()) && /now offered to 50% of computers on Stable/.test(r.out), 'rollout: 50, written on the release\'s notes', r.out)
  const said = [set('99.1.0', '150'), set('99.9.9', '10'), set('99.2.0', '10')]
  ok(said[0].status && /^::error::rollout: the percentage is a whole number from 0 to 100, not "150"/m.test(said[0].out) && said[1].status && /^::error::rollout: release not found/m.test(said[1].out) && said[2].status && /^::error::rollout: v99\.2\.0 is a draft/m.test(said[2].out) && /<!-- rollout: 50 -->/.test(notes()), 'and its refusals (over 100, a release GitHub doesn\'t have, a draft) are the run\'s error, nothing changed', said.map((x) => x.out))
  fs.rmSync(dir, { recursive: true, force: true })
}

process.exit(done().fail ? 1 : 0)
