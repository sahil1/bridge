#!/usr/bin/env node
// Runs Bridge AI's tests: npm test (the ones for what you changed), npm test -- --all, or by name.
//   node test/run.mjs                       the tests for the files changed since the last commit
//   node test/run.mjs --base origin/main    ... and the ones changed since origin/main
//   node test/run.mjs --all                 every test
//   node test/run.mjs meetings-ui app-ui    just these
//   --lanes N     how many at once (default 3; each has its own server and port)
//   --browser webkit|chromium|both          which engine the app's tests run in (default chromium)
//   --no-retry    report a failure straight away instead of running it once more on its own
// The app is built first when its source is newer than the build. A test that fails, then passes
// on its own, is reported as flaky rather than failed. Logs and pictures go in test/.out.
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT, OUT, stopTree } from './lib/harness.mjs'

// Each test, what it needs built, and the files it covers (a change to one of them runs it).
const SUITES = [
  { name: 'server', build: null, covers: [/^server\//, /^shared\//, /^scripts\/(start|cli)\.js$/] },
  { name: 'relay-signin', build: null, covers: [/^server\/(relay|agents|nodejs|paths)\.js$/] },
  { name: 'meetings-api', build: null, covers: [/^server\/(meetings|meetmemory|speech|calendar|doctext|index)\.js$/] },
  { name: 'meetings-ui', build: 'dist', browser: true, covers: [/^src\/components\/meetings\//, /^src\/components\/(Rail|Icon|FileExtras|layout)\.jsx$/, /^src\/(api|App|appearance)\.jsx?$/, /^server\/(meetings|calendar|calls|index)\.js$/] },
  { name: 'rail-ui', build: 'dist', browser: true, covers: [/^src\/components\/(Rail|Palette|Tour|Console)\.jsx$/, /^src\/components\/meetings\/(RailMeetings|bulk)\.jsx$/, /^src\/App\.jsx$/, /^src\/styles\.css$/, /^server\/(meetings|threads)\.js$/] },
  { name: 'app-ui', build: 'dist', browser: true, covers: [/^src\//, /^index\.html$/, /^public\//, /^vite\.config\.js$/, /^server\/(index|attach|terminal|settings)\.js$/, /^server\/runtime\//] },
  { name: 'chat-background', build: 'dist', browser: true, covers: [/^server\/(subagents|logread|transcripts|usage|index)\.js$/, /^server\/runtime\//, /^src\/components\/(Subagents|Console)\.jsx$/, /^src\/styles\.css$/] },
  { name: 'no-prompts', build: null, covers: [/^server\/projects\.js$/, /^scripts\/tcc-sim\.mjs$/] },
  { name: 'agents-found', build: null, covers: [/^server\/agents\.js$/, /^scripts\/tcc-sim\.mjs$/] },
  { name: 'resume-work', build: null, covers: [/^server\/runtime\/builtin\.js$/, /^server\/(queue|index)\.js$/, /^test\/stand-ins\/claude\.cjs$/] },
  { name: 'chat-account', build: 'dist', browser: true, covers: [/^src\/components\/(ModelChip|AccountMenu|Console|Handoff)\.jsx$/, /^src\/App\.jsx$/, /^server\/(accounts|models|handoff|index|transcripts|queue)\.js$/] },
  { name: 'accounts-ui', build: 'dist', browser: true, covers: [/^src\/components\/(AccountMenu|Usage|UsageStats|Trackers|Dock|ModelChip|AddAccount)\.jsx$/, /^src\/components\/settings\/(Providers\.jsx|providers\.css)$/, /^src\/App\.jsx$/, /^src\/styles\.css$/, /^server\/(accounts|feeds)\.js$/] },
  { name: 'i18n-ui', build: 'dist', browser: true, covers: [/^src\//, /^scripts\/i18n\.js$/] },
  { name: 'devices-ui', build: 'dist', browser: true, covers: [/^src\/components\/(Machines|OnboardingPhone)\.jsx$/, /^src\/components\/settings\/(Relay|Phone)\.jsx$/, /^server\/(machines|relay)\.js$/, /^test\/stand-ins\/relay\.mjs$/] },
  { name: 'phone-link', build: 'dist', browser: true, covers: [/^relay\//, /^server\/relay\.js$/, /^test\/stand-ins\/relay\.mjs$/] },
  { name: 'mail', build: null, covers: [/^server\/(mail|mailparse)\.js$/] },
  { name: 'updates', build: 'dist', browser: true, covers: [/^server\/(updates|machine)\.js$/, /^install\.sh$/, /^scripts\/release\.js$/, /^desktop\/package\.json$/, /^src\/components\/(UpdateChip|TopNotes)\.jsx$/, /^src\/components\/settings\/About\.jsx$/] },
  { name: 'screen-watch', build: null, covers: [/^src\/components\/meetings\/(changes|screen)\.js$/] },
  { name: 'devices', build: null, covers: [/^server\/(machines|relay|index)\.js$/, /^relay\//, /^test\/stand-ins\/relay\.mjs$/] },
  { name: 'setup-all', build: 'dist', browser: true, covers: [/^src\/components\/(Onboarding|SetupAll|SetupChip|PermissionFix|LiveShell)\.jsx$/, /^src\/components\/settings\/General\.jsx$/, /^src\/(setupPlan|App)\.jsx?$/, /^server\/(index|speech|voice|fixes|nodejs|gitready)\.js$/, /^scripts\/setup-mac\.sh$/, /^test\/stand-ins\/(installer|xcode-select)\.cjs$/] },
  { name: 'setup-mac', build: null, covers: [/^scripts\/setup-mac\.sh$/, /^test\/stand-ins\/xcode-select\.cjs$/] },
  { name: 'new-install', build: 'dist', browser: true, covers: [/^src\/components\/(Onboarding|SignIn|Home|NewAgent|ModelChip|Console|SetupAll|SetupChip)\.jsx$/, /^src\/components\/settings\/Providers\.jsx$/, /^src\/(App|api|setupPlan)\.jsx?$/, /^server\/(index|agents|nodejs|providers|chatagent|chatmodels|places|projects|gitready)\.js$/] },
  { name: 'phone-meetings', build: 'dist', browser: true, covers: [/^src\/components\/meetings\//, /^src\/(App|api)\.jsx?$/, /^src\/styles\.css$/, /^server\/(meetings|speech|index)\.js$/] },
  { name: 'demo-ui', build: 'dist-demo', browser: true, covers: [/^src\/demo\//, /^src\/components\/meetings\//, /^src\/(App|api)\.jsx?$/, /^vite\.config\.js$/] },
  { name: 'herdr', build: null, covers: [/^server\/runtime\/(herdr[\w-]*|index)\.js$/, /^server\/(index|agents|chatagent)\.js$/] },
  { name: 'saves', build: null, covers: [/^server\/paths\.js$/] },
  { name: 'desktop-menu', build: null, covers: [/^desktop\/(contextmenu|main)\.js$/, /^desktop\/package\.json$/] },
  { name: 'room-voices', build: null, covers: [/^server\/(voices|speech|asr|asr-worker|machine|meetings)\.js$/, /^test\/stand-ins\/(sherpa\.cjs|model\.mjs)$/] },
  { name: 'speech', build: null, covers: [/^server\/(speech|voice|asr|asr-worker|machine|meetmemory|meetings)\.js$/, /^test\/stand-ins\/sherpa\.cjs$/] },
  { name: 'voice-ui', build: 'dist', browser: true, covers: [/^src\/components\/settings\/(Voice|Meetings)\.jsx$/, /^src\/components\/(Composer|Settings)\.jsx$/, /^src\/audio\//, /^server\/(speech|voice|asr|asr-worker|machine|index)\.js$/, /^test\/stand-ins\/sherpa\.cjs$/] },
  { name: 'dictation', build: null, covers: [/^shared\/dictation\//, /^desktop\/(dictation|preload)\.js$/, /^desktop\/package(-lock)?\.json$/, /^install\.sh$/, /^native\/bridgekeys\.swift$/, /^scripts\/calltap\.js$/, /^server\/(dictation|meetmemory|index)\.js$/] },
  { name: 'dictation-ui', build: 'dist', browser: true, covers: [/^src\/(dictation|audio)\//, /^shared\/dictation\//, /^src\/components\/(Composer|Terminal|LiveShell|Settings|Solo)\.jsx$/, /^src\/components\/settings\/(Voice|Dictation)\.jsx$/, /^src\/(App|main|api)\.jsx?$/, /^server\/(dictation|index)\.js$/] },
  { name: 'remote-files', build: 'dist', browser: true, covers: [/^src\/components\/(Files|FileMedia|FileExtras)\.jsx$/, /^server\/(files|machines|relay|index)\.js$/, /^relay\/web\//, /^test\/fixtures\//] },
  { name: 'dictation-history', build: 'dist', browser: true, covers: [/^src\/dictation\//, /^src\/components\/dictations\//, /^src\/components\/settings\/Dictation\.jsx$/, /^src\/components\/Rail\.jsx$/, /^src\/(App|lazy)\.jsx$/, /^server\/(dictations|index)\.js$/] },
  { name: 'live-words', build: 'dist', browser: true, covers: [/^server\/(livewords|speech|asr|asr-worker|meetings)\.js$/, /^src\/dictation\//, /^src\/audio\//, /^src\/components\/(Composer)\.jsx$/, /^src\/components\/meetings\/(Meetings|FloatCard)\.jsx$/, /^src\/components\/settings\/Dictation\.jsx$/, /^test\/stand-ins\/sherpa\.cjs$/] },
  { name: 'voice-chief', build: 'dist', browser: true, covers: [/^src\/voice\//, /^src\/dictation\//, /^src\/components\/Console\.jsx$/, /^src\/components\/settings\/Voice\.jsx$/, /^server\/(voicespeak|chief|index)\.js$/, /^chief\//] },
  { name: 'permissions', build: 'dist', browser: true, covers: [/^src\/permissions\.js$/, /^src\/components\/(PermissionFix|RestartChip|UpdateChip)\.jsx$/, /^src\/components\/settings\/(Permissions|General|About|where)\.jsx?$/, /^desktop\/(permissions|main|preload)\.js$/, /^server\/(fixes|updates)\.js$/, /^scripts\/tcc-sim\.mjs$/] },
  { name: 'whiteboard', build: 'dist', browser: true, covers: [/^src\/components\/whiteboard\//, /^src\/components\/(Files|Console|Rail|Icon)\.jsx$/, /^src\/(App|lazy)\.jsx$/, /^server\/(boards|index)\.js$/, /^chief\/bin\/bridge$/, /^scripts\/whiteboard-assets\.js$/, /^vite\.config\.js$/] },
  { name: 'ios-app', build: null, covers: [/^mobile\/ios\//, /^relay\/web\/index\.html$/, /^PRIVACY\.md$/, /^src\/components\/Settings\.jsx$/, /^src\/components\/settings\/Relay\.jsx$/] },
]
// A change to these runs everything.
const EVERYTHING = [/^test\/(lib|stand-ins)\//, /^test\/run\.mjs$/, /^package(-lock)?\.json$/]

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const lanes = Math.max(1, Number(opt('--lanes', 3)))
const engines = { both: ['chromium', 'webkit'], webkit: ['webkit'] }[opt('--browser', 'chromium')] || ['chromium']
const named = args.filter((a, i) => !a.startsWith('--') && !['--lanes', '--browser', '--base'].includes(args[i - 1]))
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean) } catch { return [] } }

let pick
if (flag('--all')) pick = SUITES
else if (named.length) {
  const bad = named.filter((n) => !SUITES.some((s) => s.name === n))
  if (bad.length) { console.error(`No test called ${bad.join(', ')}. There are: ${SUITES.map((s) => s.name).join(', ')}`); process.exit(2) }
  pick = SUITES.filter((s) => named.includes(s.name))
} else {
  const base = opt('--base')
  const changed = [...new Set([...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard'), ...(base ? git('diff', '--name-only', `${base}...HEAD`) : [])])].map((f) => f.replace(/\\/g, '/'))
  pick = changed.some((f) => EVERYTHING.some((re) => re.test(f))) ? SUITES : SUITES.filter((s) => changed.some((f) => s.covers.some((re) => re.test(f))) || changed.includes(`test/suites/${s.name}.mjs`))
  console.log(changed.length ? `Changed: ${changed.length} file${changed.length === 1 ? '' : 's'}` : 'Nothing changed since the last commit.')
  if (!pick.length) { console.log('No test covers these changes. node test/run.mjs --all runs every test.'); process.exit(0) }
}

// The app's build, when its source is newer (or it isn't there).
const newest = (dirs) => { let t = 0; const walk = (p) => { let st; try { st = fs.statSync(p) } catch { return } if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)) } else t = Math.max(t, st.mtimeMs) }; for (const d of dirs) walk(path.join(ROOT, d)); return t }
for (const out of [...new Set(pick.map((s) => s.build).filter(Boolean))]) {
  const built = (() => { try { return fs.statSync(path.join(ROOT, out, 'index.html')).mtimeMs } catch { return 0 } })()
  if (newest(['src', 'public', 'index.html', 'vite.config.js']) > built) {
    console.log(`Building ${out} (the source is newer)…`)
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', out === 'dist' ? 'build' : 'demo:build'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' })
    if (r.status !== 0) { console.error(`npm run ${out === 'dist' ? 'build' : 'demo:build'} failed`); process.exit(1) }
  }
}

const jobs = pick.flatMap((s) => (s.browser ? engines.map((e) => ({ ...s, engine: e, label: e === 'chromium' ? s.name : `${s.name} (${e})` })) : [{ ...s, label: s.name }]))
fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true })
const runOne = (j, attempt) => new Promise((resolve) => {
  const t0 = Date.now()
  const log = path.join(OUT, 'logs', `${j.label.replace(/[^\w-]+/g, '-')}${attempt > 1 ? '-retry' : ''}.log`)
  const out = fs.openSync(log, 'w')
  const p = spawn(process.execPath, [path.join(ROOT, 'test', 'suites', `${j.name}.mjs`)], { cwd: ROOT, env: { ...process.env, BRIDGE_TEST_BROWSER: j.engine || '' }, stdio: ['ignore', out, out] })
  // Too long: stopped with everything it started (its server, its browser). Playwright catches a
  // plain stop to close its browser first, and a test stuck waiting would then never end.
  const limit = setTimeout(() => { fs.appendFileSync(log, '\nFAIL took more than 5 minutes, so it was stopped\n'); stopTree(p.pid) }, 5 * 60_000)
  p.on('exit', (code) => {
    clearTimeout(limit)
    const text = fs.readFileSync(log, 'utf8')
    const last = text.trim().split('\n').reverse().find((l) => /: \d+ passed, \d+ failed/.test(l)) || '(no result: see the log)'
    resolve({ ok: code === 0, ms: Date.now() - t0, line: last.replace(/^[\w-]+: /, ''), fails: text.split('\n').filter((l) => l.startsWith('FAIL ')), log })
  })
})

console.log(`Running ${jobs.map((j) => j.label).join(', ')} (${Math.min(lanes, jobs.length)} at once)`)
const t0 = Date.now()
const results = []
const queue = [...jobs]
await Promise.all(Array.from({ length: Math.min(lanes, jobs.length) }, async () => {
  for (let j = queue.shift(); j; j = queue.shift()) {
    let r = await runOne(j, 1)
    if (!r.ok && !flag('--no-retry')) {
      const again = await runOne(j, 2)
      if (again.ok) r = { ...again, flaky: r }
      else r = { ...again, first: r }
    }
    results.push({ j, r })
    console.log(`${r.ok ? (r.flaky ? 'FLAKY' : 'ok   ') : 'FAIL '} ${j.label}: ${r.line} (${Math.round(r.ms / 1000)} s)${r.flaky ? `: failed once (${r.flaky.fails.slice(0, 2).join('; ').slice(0, 200)}), passed on its own` : ''}`)
    if (!r.ok) for (const f of r.fails.slice(0, 8)) console.log(`        ${f.slice(0, 300)}`)
  }
}))
const failed = results.filter((x) => !x.r.ok)
console.log(`\n${failed.length ? `${failed.length} of ${results.length} failed` : `All ${results.length} passed`} in ${Math.round((Date.now() - t0) / 1000)} s on ${os.platform()}. Logs: ${path.relative(ROOT, path.join(OUT, 'logs'))}`)
process.exit(failed.length ? 1 : 0)
