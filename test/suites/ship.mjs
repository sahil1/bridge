// Shipping from this computer (scripts/ship.js, npm run ship): the next beta from main's version and
// the tags there are (main's own while it isn't out; the one after; the first of the next version,
// minor or patch; never a tag that's taken), the release main's version names (none when it's out),
// a beta's notes from its commits when nobody wrote them, its CHANGELOG section added once above the
// newest, and the newest nightly, beta and release among GitHub's list. Then the test runner: a change
// to package.json that's only its version (a release's) doesn't run every test, while any other
// change to it still does. And the release workflow's tests: a beta's go from the last nightly or
// release before it (not itself), a release's are every test.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { checks, ROOT, OUT } from '../lib/harness.mjs'

const { ok, skip, done } = checks('ship')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ship = await import('../../scripts/ship.js')

// ---------- the next beta, and the release ----------
const T = ['v3.19.0', 'v3.20.0-beta.1', 'v3.20.0-nightly.20261116.3']
ok(ship.nextBeta('3.20.0-beta.1', ['v3.19.0']) === '3.20.0-beta.1', 'main on a beta that isn\'t out yet: that one (its notes written by hand)')
ok(ship.nextBeta('3.20.0-beta.1', T) === '3.20.0-beta.2', 'main on a beta that\'s out: the next')
ok(ship.nextBeta('3.20.0', ['v3.19.0']) === '3.20.0-beta.1', 'main on a version not out yet: its first beta')
ok(ship.nextBeta('3.20.0', ['v3.20.0']) === '3.21.0-beta.1' && ship.nextBeta('3.20.0', ['v3.20.0'], { how: 'patch' }) === '3.20.1-beta.1', 'main on a version that\'s out: the next minor version\'s first beta, or with --patch the next patch\'s')
ok(ship.nextBeta('3.20.0', ['v3.20.0', 'v3.21.0-beta.1', 'v3.21.0-beta.2']) === '3.21.0-beta.3', 'never a beta whose tag is taken')
ok(ship.stableOf('3.20.0-beta.2', T) === '3.20.0' && ship.stableOf('3.20.0', ['v3.19.0']) === '3.20.0' && ship.stableOf('3.20.0', ['v3.20.0']) === null, 'the release: the version a beta is of, or main\'s own; none when it\'s out')

// ---------- notes ----------
const notes = ship.betaNotes({ version: '3.20.0-beta.2', since: '3.20.0-beta.1', changes: ['Relay set up in place', 'Account & Devices'] })
ok(notes === 'A beta of 3.20.0 for Early Access, with what changed since 3.20.0-beta.1.\n\n- Relay set up in place\n- Account & Devices', 'a beta\'s notes from its commits', notes)
const log = '# Changelog\n\nEach version\'s section here becomes its notes.\n\n## 3.20.0\n\nThe release.\n\n## 3.19.0\n\nOlder.\n'
const added = ship.withSection(log, '3.20.0-beta.2', notes)
ok(added.indexOf('## 3.20.0-beta.2') > 0 && added.indexOf('## 3.20.0-beta.2') < added.indexOf('## 3.20.0\n') && added.startsWith('# Changelog\n\nEach version') && ship.withSection(added, '3.20.0-beta.2', 'other') === added, 'its CHANGELOG section goes above the newest, once')
const rel = (tagName, d) => ({ tagName, publishedAt: `2026-11-${d}T10:00:00Z`, isPrerelease: tagName.includes('-') })
const k = ship.newestKinds([rel('v3.19.0', 14), rel('v3.20.0-beta.1', 16), rel('v3.20.0-nightly.20261116.3', 16), rel('v3.20.0-nightly.20261117.4', 17), rel('v3.18.0', 10)])
ok(k.stable?.tagName === 'v3.19.0' && k.beta?.tagName === 'v3.20.0-beta.1' && k.nightly?.tagName === 'v3.20.0-nightly.20261117.4', 'the newest nightly, beta and release, each apart', k)

// ---------- the test runner: a version-only change to package.json ----------
if (process.platform === 'win32') skip('a version-only change to package.json', 'a scratch worktree with git on Windows is slow here; the rule is the same')
else {
  const dir = path.join(OUT, 'kits', `ship-scope-${process.pid}`)
  fs.rmSync(dir, { recursive: true, force: true })
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    git('worktree', 'add', '-q', '--detach', dir, 'HEAD')
    // This checkout's runner, as the one being tested (it may be newer than its last commit).
    fs.copyFileSync(path.join(ROOT, 'test', 'run.mjs'), path.join(dir, 'test', 'run.mjs'))
    execFileSync('git', ['update-index', '--assume-unchanged', 'test/run.mjs'], { cwd: dir })
    const list = () => JSON.parse(execFileSync(process.execPath, [path.join(dir, 'test', 'run.mjs'), '--list'], { cwd: dir, encoding: 'utf8' }))
    const pkg = path.join(dir, 'package.json')
    const text = fs.readFileSync(pkg, 'utf8')
    fs.writeFileSync(pkg, text.replace(/("version": ")[^"]*(")/, '$19.9.9-beta.9$2'))
    const v = list()
    const all = fs.readdirSync(path.join(ROOT, 'test', 'suites')).filter((f) => f.endsWith('.mjs')).length
    ok(v.names.length < all, 'only package.json\'s version changed (a release\'s): not every test', v.names.length)
    fs.writeFileSync(pkg, text.replace(/("express": ")/, '$1^'))
    ok(list().names.length === all, 'a dependency changed in it: every test')
  } finally {
    try { git('worktree', 'remove', '--force', dir) } catch { fs.rmSync(dir, { recursive: true, force: true }) }
  }
}

// ---------- the release workflow's tests ----------
const release = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
ok(/base: \$\{\{ needs\.guard\.outputs\.base \}\}/.test(release) && /if \[ -n "\$NIGHTLY" \]; then echo "base=\$SINCE"/.test(release) && /refs\/tags\/v\*-\* \]\]; then echo "base=\$\(node scripts\/nightly\.js since "\$GITHUB_REF_NAME"\)"/.test(release), 'release.yml: a nightly\'s tests from the last nightly, a beta\'s from the last nightly or release before it, a release\'s every test')
const nj = fs.readFileSync(path.join(ROOT, 'scripts', 'nightly.js'), 'utf8')
ok(/t !== self && RELEASE_VERSION\.test/.test(nj), 'and a beta\'s "since" is never itself')
ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts?.ship === 'node scripts/ship.js', 'npm run ship runs it')

process.exit(done().fail ? 1 : 0)
