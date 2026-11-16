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

const { ok, done } = checks('test-scope')
const list = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'test', 'run.mjs'), '--list', ...a], { cwd: ROOT, encoding: 'utf8' }))

// ---------- the runner ----------
const two = list('model-names', 'nightly')
ok(JSON.stringify(two.names) === JSON.stringify(['nightly', 'model-names']) && two.browser === true, '--list with names: just those, and whether one runs in a browser', two)
ok(list('model-names').browser === false, 'none in a browser: browser false')
const all = list('--all')
const suites = fs.readdirSync(path.join(ROOT, 'test', 'suites')).filter((f) => f.endsWith('.mjs')).length
ok(all.names.length === suites && all.browser, '--list --all: every suite there is', [all.names.length, suites])

// ---------- the workflows ----------
const yml = (f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8')
const test = yml('test.yml')
const scope = test.split('\n  scope:\n')[1]?.split('\n  test:\n')[0] || ''
ok(/node test\/run\.mjs --list \$args/.test(scope) && /echo "count=\$count"/.test(scope), 'test.yml works out which tests first (--list), and how many')
ok(/elif \[ "\$EVENT" = pull_request \]; then base="\$PR_BASE"/.test(scope) && /elif \[ "\$EVENT" = push \]; then base="\$BEFORE"/.test(scope), 'a pull request: since its base; a push to main: since the commit before')
ok(/if \[ -n "\$ASKED" \]; then base="\$ASKED"/.test(scope) && /refs\/tags\/\*\ \]\]; then base=$/m.test(scope) && /args=--all; mobile=true/.test(scope), 'asked for a base (a nightly): since that; a tag: every test')
ok(/isn't a commit here, so every test runs/.test(scope), 'a base that isn\'t a commit here: every test, never none')
ok(/schedule:\s*\n\s*- cron: '0 6 \* \* 6'/.test(test), 'Friday night (6:00 UTC on Saturday): every test on main')
ok(/test:\n\s*name: Tests \(\$\{\{ matrix\.name \}\}\)\n\s*needs: scope\n\s*if: needs\.scope\.outputs\.count != '0'/.test(test) && /node test\/run\.mjs \$ARGS --lanes 2/.test(test), 'the test machines only when a test applies, running just those')
ok(/- name: Tests\n\s*shell: bash\n\s*env:\n\s*ARGS: \$\{\{ needs\.scope\.outputs\.args \}\}\n\s*run: node test\/run\.mjs \$ARGS /.test(test), 'the tests in bash on Windows too, where PowerShell reads $ARGS as its own empty list (and ran none, 16 Nov)')
ok(/ios:\n\s*name: iPhone app\n\s*needs: scope\n\s*if: needs\.scope\.outputs\.mobile == 'true'/.test(test) && /android:\n\s*needs: scope\n\s*if: github\.ref_type != 'tag' && needs\.scope\.outputs\.mobile == 'true'/.test(test), 'the iPhone and Android builds with every test, or a change to mobile/')
const release = yml('release.yml')
ok(/test:\n\s*needs: guard\n\s*uses: \.\/\.github\/workflows\/test\.yml\n\s*with:\n\s*base: \$\{\{ needs\.guard\.outputs\.base \}\}/.test(release), 'release.yml: every test for a release, only what changed since for a nightly or a beta (the guard says from where)')
ok(/since=\$\(node scripts\/nightly\.js since\)/.test(yml('nightly.yml')) && /since: \$\{\{ needs\.plan\.outputs\.since \}\}/.test(yml('nightly.yml')), 'nightly.yml hands on the last nightly (or release) to test from')

process.exit(done().fail ? 1 : 0)
