// How many tests run, and when (test/run.mjs --list, test.yml, release.yml, nightly.yml). The runner
// says which tests it would run as JSON without running any. CI works that out first: a pull
// request's or a push's tests are only those for the files it changes (none for a change no test
// covers, and then no machine is set up for them), a nightly's those for what changed since the last
// nightly, and a release's tag, Friday night's run and a run by hand every test. The iPhone and
// Android builds go with every test, or a change to mobile/. Which tests a change picks
// (lib/scope.mjs pick): a change made up here for each rule.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { checks, ROOT } from '../lib/harness.mjs'
import { runnerChange, pick, cssRules, statements, styleChange, indexChange } from '../lib/scope.mjs'

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

// ---------- what a change picks ----------
// The runner's list and core files as run.mjs has them, and a change made up for each rule: files,
// or one line of server/index.js, the harness or styles.css (as git's diff of it says, the file as
// it is on both sides).
const literal = (name) => { const at = runner.indexOf(`const ${name} = [`); return new Function(`return ${runner.slice(at + `const ${name} = `.length, runner.indexOf(name === 'SUITES' ? '\n]\n' : '\n', at) + (name === 'SUITES' ? 2 : 0))}`)() }
const SUITES = literal('SUITES')
const core = literal('EVERYTHING')
const app = literal('THE_APP')
const picked = (changed, texts = {}, suites = SUITES) => pick({ suites, changed, core, app, runner: [], root: ROOT, texts }).map((s) => s.name)
const lineAt = (f, start) => {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
  const n = text.replace(/\r\n/g, '\n').split('\n').findIndex((l) => l.startsWith(start)) + 1
  ok(n > 0, `(${f} has ${start.slice(0, 50)})`)
  return { [f]: { before: text, after: text, diff: `@@ -${n} +${n} @@` } }
}
const names = SUITES.map((s) => s.name)
const studios = names.filter((n) => /^studio/.test(n))
const botsOnes = names.filter((n) => /^bots-/.test(n))
const opensApp = SUITES.filter((s) => s.build || s.browser).map((s) => s.name)
const has = (got, want) => want.every((n) => got.includes(n))
const none = (got, of) => !of.some((n) => got.includes(n))
ok(!!statements(fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8')) && !!statements(fs.readFileSync(path.join(ROOT, 'test', 'lib', 'harness.mjs'), 'utf8')) && !!cssRules(fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')), 'server/index.js, the harness and styles.css read as statements and rules (or every change to them would run every test)')

// Studio: its tests, not the bots'; a Studio route in server/index.js the same, not the 92 that
// list server/index.js.
const studio = picked(['src/components/studio/Studio.jsx', 'server/studio.js'])
ok(has(studio, ['studio', 'studio-docs', 'studio-pdf', 'studio-big', 'studio-gone', 'files-ui', 'dead-clicks']) && none(studio, botsOnes) && studio.length < 40, 'a change to Studio alone: the Studio tests and the ones opening it, none of the bots\'', studio)
const route = picked(['server/index.js'], lineAt('server/index.js', "app.get('/api/studio/recent'"))
ok(has(route, ['studio', 'studio-docs']) && none(route, botsOnes) && route.length < 40, 'a Studio route in server/index.js: the Studio tests, none of the bots\'', route)
const botRoute = picked(['server/index.js'], lineAt('server/index.js', "app.get('/api/bots/:id/activity'"))
ok(has(botRoute, ['bots-activity']) && none(botRoute, studios) && botRoute.length < 60, 'a bots route: the bots\' tests, none of Studio\'s', botRoute)
// The same on a server/index.js made up here (each line a statement): an import, its file; a route,
// what it calls and who asks for it; a function, what uses it; a value a file makes, that file; what
// runs a function at start, what that calls; a package's import or middleware for every request,
// every test.
const server2 = "import express from 'express'\nimport * as studio from './studio.js'\nimport { makeDesk } from './frontdesk.js'\nimport * as bots from './bots.js'\nconst app = express()\napp.use(express.json())\nconst desk = makeDesk({ ask: () => 1 })\nfunction rootOf(id) { return id }\napp.get('/api/studio/open', (req, res) => res.json(studio.open(rootOf(req.query.id))))\napp.get('/api/bots/:id', (req, res) => res.json(desk.view(req.params.id)))\nfunction tick() { bots.tick() }\nsetInterval(tick, 1000)\n"
const asked = (route) => ({ files: new Set(route === '/api/studio/open' ? ['src/components/studio/Studio.jsx'] : []), suites: new Set(route === '/api/bots/:id' ? ['bots-ui'] : []) })
const stmt = (line) => { const r = indexChange({ before: server2, after: server2, diff: `@@ -${line} +${line} @@`, users: asked }); return r.every ? 'every' : [...r.files, ...r.suites].sort().join() }
ok(stmt(2) === 'server/studio.js' && stmt(9) === 'server/studio.js,src/components/studio/Studio.jsx' && stmt(8) === 'server/studio.js,src/components/studio/Studio.jsx' && stmt(7) === 'server/frontdesk.js' && stmt(10) === 'bots-ui,server/bots.js,server/frontdesk.js' && stmt(11) === 'server/bots.js' && stmt(12) === 'server/bots.js' && stmt(1) === 'every' && stmt(6) === 'every' && stmt(5) === 'every', 'server/index.js\'s statements: an import, its file; a route, what it calls (a name in its address too: bots) and who asks for it; a function, what uses it; a value a file makes, that file; setInterval(tick), what tick calls; a package\'s import, middleware for every request and the app itself: every test', [1, 2, 5, 6, 7, 8, 9, 10, 11, 12].map(stmt))
// What every request goes through, and a server/index.js that can't be compared: every test.
ok(picked(['server/index.js'], lineAt('server/index.js', 'app.use(guard.http)')).length === names.length, 'server/index.js\'s middleware for every request: every test')
ok(picked(['server/index.js']).length === names.length, 'server/index.js with nothing to compare it with: every test')
// A view the sentinels don't open: only the tests for it.
const sheet = picked(['src/components/studio/editors/SheetEditor.jsx'])
ok(has(sheet, ['studio-sheets', 'studio-comments']) && none(sheet, ['dead-clicks', 'app-ui', 'i18n-ui', 'perf']), 'Studio\'s sheet editor (a part no test of the whole app opens): its tests, not those', sheet)
// What every page draws (the sidebar): the tests of the whole app too.
const rail = picked(['src/components/Rail.jsx'])
ok(has(rail, ['app-ui', 'dead-clicks', 'i18n-ui', 'perf', 'rail-ui']), 'the sidebar (on every page): the tests of the whole app, and its own', rail)

// The core files: every test; the app's, every test that opens the app, not the server's alone.
ok(picked(['package-lock.json']).length === names.length && picked(['test/lib/scope.mjs']).length === names.length, 'a package or lib/scope.mjs: every test')
const appCore = picked(['src/App.jsx'])
ok(has(appCore, opensApp) && !appCore.includes('bots-sessions') && !appCore.includes('server'), 'src/App.jsx: every test that opens the app, not the server\'s own', { picked: appCore.length, opensApp: opensApp.length })
ok(picked(['src/api.js']).length === appCore.length, 'and src/api.js the same')

// A language pack: the tests that show other languages (and the few that read every file in src/:
// class-names, smart-enter, usage-counts), not the whole app's.
const pack = picked(['src/i18n/de.json'])
ok(has(pack, ['i18n-ui', 'float-card-window', 'update-channel', 'calendar']) && none(pack, ['app-ui', 'dead-clicks', 'dead-clicks-settings', 'perf']) && pack.length <= 8, 'a language pack alone: i18n-ui and the few in other languages', pack)

// styles.css by its rules: one for a part, the tests of what shows it; :root's colours, every test
// that opens the app.
const css = picked(['src/styles.css'], lineAt('src/styles.css', '.update-pop {'))
ok(has(css, ['update-channel', 'updates']) && none(css, studios) && css.length < opensApp.length / 2, 'styles.css, the update card\'s rule: the tests of what shows it', css)
ok(has(picked(['src/styles.css'], lineAt('src/styles.css', ':root {')), opensApp), 'styles.css, :root\'s colours: every test that opens the app')
// The same on a sheet made up here: a rule, the files that show a class it needs; an @media's
// condition, each rule in it; what needs no class, or a class no file shows, null (every test that
// opens the app).
const sheet2 = '/* a */\n.a .x { color: red }\n@media (width < 600px) {\n  .b { color: red }\n  .c:not(.z) { color: red }\n}\nbody { margin: 0 }\n.k-idea { color: red }\n.gone { color: red }\n'
const shows = [['A.jsx', '<p className="a">'], ['B.jsx', 'el.classList.add(\'b\')'], ['C.jsx', '"c"'], ['K.jsx', 'className={`k-${kind}`}'], ['Z.jsx', '"z"']]
const styled = (line) => { const r = styleChange({ before: sheet2, after: sheet2, diff: `@@ -${line} +${line} @@` }, shows); return r && [...r].sort().join() }
ok(styled(2) === 'A.jsx' && styled(1) === 'A.jsx' && styled(4) === 'B.jsx' && styled(3) === 'B.jsx,C.jsx' && styled(5) === 'C.jsx' && styled(8) === 'K.jsx' && styled(7) === null && styled(9) === null, 'a rule: what shows a class it needs (its comment with it, `k-${kind}` for .k-idea, not :not(.z)\'s); an @media\'s condition: each rule in it; body, or a class nothing shows: every test that opens the app', [1, 2, 3, 4, 5, 7, 8, 9].map(styled))

// Under test/: the suites that name a file, or call the harness's function it's in.
const slack = picked(['test/stand-ins/slack.mjs'])
ok(has(slack, ['slack-bot', 'bots-activity', 'bots-approvals']) && none(slack, studios), 'the Slack stand-in: the tests that use it', slack)
ok(picked(['test/stand-ins/clock.mjs']).length === names.length, 'a stand-in the harness loads: every test')
ok(has(picked(['test/suites/dead-clicks.mjs']), ['dead-clicks', 'dead-clicks-settings']), 'a test file another runs (dead-clicks-settings runs dead-clicks.mjs): both')
const harnessText = fs.readFileSync(path.join(ROOT, 'test', 'lib', 'harness.mjs'), 'utf8')
const slackAt = harnessText.replace(/\r\n/g, '\n').split('\n').findIndex((l) => l.startsWith('export async function startSlack')) + 2
const inSlack = picked(['test/lib/harness.mjs'], { 'test/lib/harness.mjs': { before: harnessText, after: harnessText, diff: `@@ -${slackAt} +${slackAt} @@` } })
ok(has(inSlack, ['slack-bot', 'bots-activity']) && none(inSlack, studios), 'the harness\'s startSlack: the tests that start Slack', inSlack)
ok(picked(['test/lib/harness.mjs'], lineAt('test/lib/harness.mjs', 'globalThis.fetch = ')).length === names.length, 'what the harness does as it loads: every test')

// shared/: as the files that import it too; a `uses` file that's gone: its folder.
ok(has(picked(['shared/signmarks.js']), ['studio-pdf', 'server']), 'a file in shared/: the tests of what imports it')
const gone = [{ name: 'x-gone', build: null, covers: [], uses: ['src/components/nowhere/Gone.jsx'] }]
ok(JSON.stringify(picked(['src/components/nowhere/Other.jsx'], {}, gone)) === '["x-gone"]', 'a file in uses that isn\'t there: its folder, so a move never leaves its test out')

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
const machines = [...job.matchAll(/- os: (\S+)\n\s*name: (.+)\n\s*browser: (\w+)(?:\n\s*share: (.+))?/g)].map((m) => ({ os: m[1], name: m[2], browser: m[3], share: m[4] || '' }))
ok(JSON.stringify(machines.map((m) => [m.os, m.browser, m.share])) === JSON.stringify([['macos-15', 'chromium', ''], ['macos-15', 'webkit', '--browser-only --shard 1/2'], ['macos-15', 'webkit', '--browser-only --shard 2/2'], ['windows-latest', 'chromium', ''], ['ubuntu-22.04', 'chromium', '']]), 'every suite in Chromium on macOS, Windows and Linux; on macOS the ones in a browser in WebKit too, in two shares', machines)
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
