// How many tests run, and when (test/run.mjs --list, test.yml, release.yml, nightly.yml). The runner
// says which tests it would run as JSON without running any. CI works that out first: a pull
// request's or a push's tests are only those for the files it changes (none for a change no test
// covers, and then no machine is set up for them), a nightly's those for what changed since the last
// nightly, and a release's tag, Friday night's run and a run by hand every test. The iPhone and
// Android builds go with every test, or a change to mobile/.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { checks, ROOT } from '../lib/harness.mjs'
import { runnerChange } from '../lib/scope.mjs'

const { ok, done } = checks('test-scope')
const list = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'test', 'run.mjs'), '--list', ...a], { cwd: ROOT, encoding: 'utf8' }))

// ---------- the runner ----------
const two = list('model-names', 'nightly')
ok(JSON.stringify(two.names) === JSON.stringify(['nightly', 'model-names']) && two.browser === true, '--list with names: just those, and whether one runs in a browser', two)
ok(list('model-names').browser === false, 'none in a browser: browser false')
const all = list('--all')
const suites = fs.readdirSync(path.join(ROOT, 'test', 'suites')).filter((f) => f.endsWith('.mjs')).length
ok(all.names.length === suites && all.browser, '--list --all: every suite there is', [all.names.length, suites])

// A change to the runner: the suites whose entry changed (lib/scope.mjs), every test when more did.
const runner = fs.readFileSync(path.join(ROOT, 'test', 'run.mjs'), 'utf8')
const entry = runner.split('\n').find((l) => l.startsWith("  { name: 'mail', "))
const nowWith = (from, to) => { ok(runner.includes(from), `(the runner has ${from.slice(0, 60)})`); return runner.replace(from, to) }
ok(!!entry && JSON.stringify(runnerChange(runner, runner)) === '[]', 'the runner as it was: no test for it', runnerChange(runner, runner))
ok(JSON.stringify(runnerChange(runner, nowWith(entry, entry.replace('covers: [', 'covers: [/^server\\/x\\.js$/, ')))) === '["mail"]', 'one suite\'s entry changed (what it covers): that suite only')
ok(JSON.stringify(runnerChange(runner, nowWith(entry, `${entry}\n  { name: 'brand-new', build: null, covers: [/^x$/] },`))) === '["brand-new"]', 'a suite added: that one')
ok(JSON.stringify(runnerChange(runner, nowWith(entry, ''))) === '[]' && JSON.stringify(runnerChange(runner, nowWith(entry, `  // A note about it.\n${entry}`))) === '[]', 'a suite taken off, or a comment in the list: none')
ok(runnerChange(runner, nowWith('const lanes = Math.max(1, Number(opt(\'--lanes\', 3)))', 'const lanes = Math.max(1, Number(opt(\'--lanes\', 4)))')) === null, 'the rest of the runner changed (how they run): every test')
ok(runnerChange(runner, nowWith(entry, entry.replace(" covers:", "\n    covers:"))) === null && runnerChange(null, runner) === null, 'an entry over two lines, or no runner before: every test, rather than miss one')

// CI's WebKit machines: the suites in a browser, in shares about as long, each suite in one.
const browsers = list('--all', '--browser-only')
const shares = [list('--all', '--browser-only', '--shard', '1/2'), list('--all', '--browser-only', '--shard', '2/2')]
const inBoth = shares[0].names.filter((n) => shares[1].names.includes(n))
const minutes = (names) => names.reduce((t, n) => t + (Number(runner.split('\n').find((l) => l.startsWith(`  { name: '${n}', `))?.match(/minutes: (\d+)/)?.[1]) || 2), 0)
ok(browsers.names.length > 50 && browsers.names.length < all.names.length && browsers.browser, '--browser-only: only the suites in a browser', browsers.names.length)
ok(!inBoth.length && shares[0].names.length + shares[1].names.length === browsers.names.length && [...shares[0].names, ...shares[1].names].every((n) => browsers.names.includes(n)), '--shard 1/2 and 2/2: every one of them, each in one share', { inBoth, sizes: shares.map((s) => s.names.length) })
ok(Math.abs(minutes(shares[0].names) - minutes(shares[1].names)) <= 12, 'and the two about as long (by each suite\'s time limit)', shares.map((s) => minutes(s.names)))
ok(JSON.stringify(list('--all', '--browser-only', '--shard', '1/2')) === JSON.stringify(shares[0]), 'the same share every time')
ok(JSON.stringify(list('model-names', '--shard', '2/2').names) === '[]' && JSON.stringify(list('model-names', '--shard', '1/2').names) === '["model-names"]', 'one suite in two shares: the first has it, the second none')

// ---------- the workflows ----------
// With \n between lines on Windows too, where git checks them out with \r\n.
const yml = (f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8').replace(/\r\n/g, '\n')
const test = yml('test.yml')
const scope = test.split('\n  scope:\n')[1]?.split('\n  test:\n')[0] || ''
ok(/node test\/run\.mjs --list \$args/.test(scope) && /echo "count=\$count"/.test(scope), 'test.yml works out which tests first (--list), and how many')
ok(/elif \[ "\$EVENT" = pull_request \]; then base="\$PR_BASE"/.test(scope) && /elif \[ "\$EVENT" = push \]; then base="\$BEFORE"/.test(scope), 'a pull request: since its base; a push to main: since the commit before')
ok(/if \[ -n "\$ASKED" \]; then base="\$ASKED"/.test(scope) && /refs\/tags\/\*\ \]\]; then base=$/m.test(scope) && /args=--all; mobile=true/.test(scope), 'asked for a base (a nightly): since that; a tag: every test')
ok(/isn't a commit here, so every test runs/.test(scope), 'a base that isn\'t a commit here: every test, never none')
ok(/schedule:\s*\n\s*- cron: '0 6 \* \* 6'/.test(test), 'Friday night (6:00 UTC on Saturday): every test on main')
ok(/test:\n\s*name: Tests \(\$\{\{ matrix\.name \}\}\)\n\s*needs: scope\n\s*if: needs\.scope\.outputs\.count != '0'/.test(test) && /node test\/run\.mjs \$ARGS --lanes 2/.test(test), 'the test machines only when a test applies, running just those')
ok(/- name: Tests\n\s*if: steps\.share\.outputs\.count != '0'\n\s*shell: bash\n\s*env:\n\s*ARGS: \$\{\{ needs\.scope\.outputs\.args \}\} \$\{\{ matrix\.share \}\}\n\s*run: node test\/run\.mjs \$ARGS /.test(test), 'the tests in bash on Windows too, where PowerShell reads $ARGS as its own empty list (and ran none, 16 Nov)')
const job = test.split('\n  test:\n')[1]?.split('\n  ios:\n')[0] || ''
// The machines, as the scope picks them (its script run here on made-up counts of tests): those in no
// browser on macOS; those in a browser in WebKit on macOS, in two shares from 16, and in Chromium on
// Linux, a share for each 25 or so up to four; Windows, and Linux's in no browser, only for every
// test, and optional there.
const pick = scope.match(/node -e '\n([\s\S]*?)\n {10}'/)?.[1] || ''
const machinesFor = (browser, none, all = false) => {
  const dir = fs.mkdtempSync(path.join(ROOT, 'test', '.out', 'scope-'))
  try {
    fs.writeFileSync(path.join(dir, 'scope-browser.json'), JSON.stringify({ names: Array(browser).fill('x') }))
    fs.writeFileSync(path.join(dir, 'scope-none.json'), JSON.stringify({ names: Array(none).fill('x') }))
    const out = path.join(dir, 'out')
    execFileSync(process.execPath, ['-e', pick], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, ALL: all ? '1' : '' } })
    return JSON.parse(fs.readFileSync(out, 'utf8').replace(/^machines=/, '')).include.map((m) => [m.os, m.browser, m.share, m.optional && 'optional'].filter(Boolean).join(' '))
  } catch (e) { return [`failed: ${e.message}`] } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
const every = machinesFor(107, 46, true), big = machinesFor(107, 46), small = machinesFor(10, 3), quiet = machinesFor(0, 5)
const lx = (n) => Array.from({ length: n }, (_, i) => `ubuntu-22.04 chromium --browser-only --shard ${i + 1}/${n}`)
const mac = ['macos-15 chromium --no-browser', 'macos-15 webkit --browser-only --shard 1/2', 'macos-15 webkit --browser-only --shard 2/2']
ok(JSON.stringify(big) === JSON.stringify([...mac, ...lx(4)]) && JSON.stringify(every) === JSON.stringify([...mac, ...lx(4), 'windows-latest chromium optional', 'ubuntu-22.04 chromium --no-browser optional']) && JSON.stringify(small) === JSON.stringify(['macos-15 chromium --no-browser', 'macos-15 webkit --browser-only', 'ubuntu-22.04 chromium --browser-only']) && JSON.stringify(quiet) === JSON.stringify(['macos-15 chromium --no-browser']), 'the tests in no browser on macOS, the ones in a browser in WebKit on macOS and in Chromium on Linux, in shares when there are many; Windows and the rest of Linux only for every test, and optional', { every, big, small, quiet })
ok(/matrix: \$\{\{ fromJSON\(needs\.scope\.outputs\.machines\) \}\}/.test(job) && /continue-on-error: \$\{\{ matrix\.optional \}\}/.test(job) && /--list \$args --browser-only > scope-browser\.json/.test(scope) && /--list \$args --no-browser > scope-none\.json/.test(scope), 'the test job takes the machines the scope picked, an optional one failing without failing the run')
ok(!/^  push:/m.test(test.split('\njobs:\n')[0]), 'a merge to main runs no tests of its own (its pull request\'s did, and the nightly covers what changed since)')
const steps = job.split('\n    steps:\n')[1] || ''
const share = steps.split('\n      - id: share\n')[1]?.split('\n\n')[0] || ''
ok(/ARGS: \$\{\{ needs\.scope\.outputs\.args \}\} \$\{\{ matrix\.share \}\}/.test(share) && /node test\/run\.mjs --list \$ARGS > share\.json/.test(share) && /echo "count=/.test(share), 'each machine works out its own tests first', share)
const after = steps.split('\n      - id: share\n')[1]?.split('\n\n').slice(1).filter((x) => /^\s*(- uses: actions\/setup-node|- name: )/m.test(x) && !/upload-artifact/.test(x)) || []
ok(after.length >= 6 && after.every((x) => /\n\s*if: steps\.share\.outputs\.count != '0'/.test(x)), 'and one with none (a WebKit share, for a change to no test in a browser) sets nothing up', after.map((x) => x.match(/name: (.+)|uses: (\S+)/)?.[0]))
ok(/ios:\n\s*name: iPhone app\n\s*needs: scope\n\s*if: needs\.scope\.outputs\.mobile == 'true'/.test(test) && /android:\n\s*needs: scope\n\s*if: github\.ref_type != 'tag' && needs\.scope\.outputs\.mobile == 'true'/.test(test), 'the iPhone and Android builds with every test, or a change to mobile/')
const release = yml('release.yml')
ok(/test:\n\s*needs: guard\n\s*uses: \.\/\.github\/workflows\/test\.yml\n\s*with:\n\s*base: \$\{\{ needs\.guard\.outputs\.base \}\}/.test(release), 'release.yml: every test for a release, only what changed since for a nightly or a beta (the guard says from where)')
ok(/since=\$\(node scripts\/nightly\.js since\)/.test(yml('nightly.yml')) && /since: \$\{\{ needs\.plan\.outputs\.since \}\}/.test(yml('nightly.yml')), 'nightly.yml hands on the last nightly (or release) to test from')

process.exit(done().fail ? 1 : 0)
