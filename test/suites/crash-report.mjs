// Report a crash on GitHub. What's personal comes out of the report (shared/crashreport.js): this
// computer's home folder and anyone else's (macOS, Linux, Windows), other paths that are someone's
// while Bridge AI's own stay, emails, keys and tokens of every shape check-private knows plus ones
// in a link or a header, Tailscale names, a relay on someone's Cloudflare account, network
// addresses, and your name, this computer's and your projects', not inside Bridge AI's own paths.
// The link to GitHub's new-issue page carries the text exactly, and a report too long for a link
// goes on the clipboard instead. Then the server: an error nothing caught is written down as it
// stops (a server of its own, made to crash), the next start offers it, and its report has the
// version, the system, what crashed, the error, the settings that matter and the server's last log
// lines, with your name, project, home folder, email and key gone; the desktop app's window or
// graphics going away is kept the same way; Not now puts it away for good. The desktop app's side
// (desktop/crashes.js, no Electron needed): which endings count, its server log kept short, and a
// crash written down when its server isn't answering. In the app: the card after a crash, Report on
// GitHub showing the whole issue to change before anything is sent (nothing reaches GitHub until
// the link is followed), the crash screen's Report on GitHub over it, too long for a link, and on a
// phone.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { ROOT, OUT, startKit, checks, until, browser, page, shot, freePort } from '../lib/harness.mjs'

const { ok, done } = checks('crash-report')
// Each browser's run has folders of its own: the two can run at once.
const LANE = process.env.BRIDGE_TEST_BROWSER || 'chromium'
const { scrub, issueLink, reportText, MAX_URL } = await import('../../shared/crashreport.js')
const { SECRETS } = await import('../../shared/private.js')

// Made up, and put together here so this file holds no key, address or home folder itself.
const K = {
  anthropic: ['sk', 'ant', 'api03', 'Q'.repeat(40)].join('-'),
  openai: ['sk', 'proj', 'Z'.repeat(40)].join('-'),
  github: ['ghp', 'A'.repeat(36)].join('_'),
  aws: 'AKIA' + 'B'.repeat(16),
  slack: ['xoxb', '123456789', 'abcdefghij'].join('-'),
  jwt: ['eyJ' + 'a'.repeat(20), 'eyJ' + 'b'.repeat(20), 'c'.repeat(20)].join('.'),
  random: 'r9'.repeat(24),
}
const HOME = ['', 'Users', 'priya'].join('/')
const email = ['priya.raman', 'acme-corp.com'].join('@')
const tailnet = ['studio', 'tail1234', 'ts', 'net'].join('.')

// ---------- What comes out ----------
{
  const app = '/Applications/Bridge AI.app/Contents/Resources/app-root'
  const names = [['acme-billing', '<project>'], ['Priya Raman', '<name>'], ['Priyas-MacBook-Pro', '<computer>'], ['server', '<project>']]
  const s = (x, o = {}) => scrub(x, { home: HOME, app, names, ...o })
  ok(s(`at f (${HOME}/code/acme-billing/src/app.js:10:5)`) === 'at f (~/<path>:10:5)', 'this computer\'s home folder and the project under it: gone, the line and column kept', s(`at f (${HOME}/code/acme-billing/src/app.js:10:5)`))
  ok(s(`at g (${app}/server/index.js:20:3)`) === 'at g (<app>/server/index.js:20:3)', 'Bridge AI\'s own files stay, as <app> (a project called "server" doesn\'t touch them)', s(`at g (${app}/server/index.js:20:3)`))
  ok(s(`open ${['', 'home', 'sam'].join('/')}/notes/plan.md failed`) === 'open <path> failed', 'someone else\'s home folder on Linux', s(`open ${['', 'home', 'sam'].join('/')}/notes/plan.md failed`))
  const win = ['C:', 'Users', 'priya', 'work', 'acme-billing', 'x.js'].join('\\')
  ok(s(`at h (${win}:3:1)`, { home: '' }) === 'at h (<path>:3:1)', 'a Windows path', s(`at h (${win}:3:1)`, { home: '' }))
  ok(s(`read ${HOME}/My Projects/acme-billing/notes.md`) === 'read ~/<path>', 'a path with a space in it, all of it', s(`read ${HOME}/My Projects/acme-billing/notes.md`))
  ok(s(`file://${HOME}/x.js`) === '~/<path>', 'a file: link to it')
  ok(s('/Volumes/Work/q3/plan.key and /tmp/bridge-xyz/a.wav') === '<path> and <path>', 'another disk and a temp folder')
  ok(s(`${HOME}/.bridge-ai/logs/ui-errors.log`) === '~/.bridge-ai/logs/ui-errors.log', 'Bridge AI\'s own log stays, under ~')
  ok(s(`${HOME}/.bridge-ai/worktrees/acme-billing-fix-login/src`) === '~/<path>', 'but not a worktree, named after your repo and branch')
  ok(s(`mail ${email}, and noreply@github.com`) === 'mail <email>, and noreply@github.com', 'an email address, and not a no-reply one', s(`mail ${email}`))
  for (const [what, v] of Object.entries(K)) ok(s(`key ${v} here`) === 'key <key> here', `a key: ${what}`, s(`key ${v} here`))
  ok(['anthropic', 'openai', 'github', 'aws', 'slack', 'jwt'].every((k) => SECRETS.some(([, re]) => re.test(K[k]))), 'the keys are the ones check-private looks for too (shared/private.js)')
  ok(s('Authorization: Bearer abcdefghijklmnop12345') === 'Authorization: Bearer <key>' && s('/api/x?agent=p1&token=s3cret&b=2') === '/api/x?agent=p1&token=<key>&b=2', 'a token in a header and in a link')
  ok(s(`on ${tailnet} at 10.1.2.3, here 127.0.0.1`) === 'on <tailnet name> at <ip address>, here 127.0.0.1', 'a Tailscale name and a network address; this computer\'s own address stays', s(`on ${tailnet} at 10.1.2.3`))
  ok(s('relay https://bridge-relay.priya-acct.workers.dev/x') === 'relay https://<host>.workers.dev/x', 'a relay on someone\'s Cloudflare account')
  ok(s('Chrome/156.0.7000.12 Safari/605.1.15 macOS 14.6.1') === 'Chrome/156.0.7000.12 Safari/605.1.15 macOS 14.6.1', 'version numbers stay')
  ok(s('Priya Raman ran acme-billing on Priyas-MacBook-Pro') === '<name> ran <project> on <computer>', 'your name, your project and this computer\'s name', s('Priya Raman ran acme-billing on Priyas-MacBook-Pro'))
  ok(scrub(`at f (${HOME}/a/b.js:1:2)`) === 'at f (<path>:1:2)', 'with nothing known about this computer (the page, when the server can\'t answer), a home folder still goes')
}

// ---------- The link to GitHub ----------
{
  const text = { title: 'The window hit an error: x & y #1 100%', what: 'It stopped.\n\nWhat I was doing: ünïcode, 日本語', details: 'Bridge AI: 3.7.1\n\n  at a (<app>/x.js:1:2)\nSettings:\n  runtime: builtin' }
  const { url, fits } = issueLink(text)
  const q = new URL(url).searchParams
  ok(fits && url.startsWith('https://github.com/sahil1/bridge/issues/new?template=bug.yml') && q.get('labels') === 'bug', 'a new issue on sahil1/bridge, from the bug template', url.slice(0, 120))
  ok(q.get('title') === text.title && q.get('what') === text.what && q.get('diagnostics') === text.details, 'carrying the title, what happened and the details exactly', [...q.entries()])
  const long = { ...text, details: 'x'.repeat(MAX_URL + 2000) }
  const l = issueLink(long)
  const lq = new URL(l.url).searchParams
  ok(!l.fits && l.url.length <= MAX_URL && lq.get('title') === text.title && /paste them here/.test(lq.get('diagnostics')), 'too long for a link: the title and what happened, and paste the details (put on the clipboard)', { fits: l.fits, len: l.url.length })
  const r = reportText({ kind: 'server', message: 'boom', stack: 'Error: boom\n    at x', at: '2026-10-31T10:42:11.000Z', reason: 'exited with code 1' }, { about: { version: '3.7.1', install: 'desktop app', system: 'darwin 14.6 arm64' }, settings: { runtime: 'builtin' }, log: { name: 'server.log', lines: ['last line'] } })
  ok(/^The server stopped: boom$/.test(r.title) && ['Bridge AI: 3.7.1 (desktop app)', 'System: darwin 14.6 arm64', 'What crashed: the server stopped', 'When: 2026-10-31 10:42 UTC', 'Error: boom', '    at x', 'Settings:', '  runtime: builtin', 'Last lines of server.log:', 'last line'].every((l) => r.details.split('\n').includes(l)), 'the report: version and install, system, what crashed and when, the error and its stack, settings, the log\'s last lines', r)
}

// ---------- The desktop app's side ----------
{
  const require = createRequire(import.meta.url)
  const d = require(path.join(ROOT, 'desktop', 'crashes.js'))
  ok(d.fromWindowGone({ reason: 'clean-exit' }) === null && d.fromWindowGone({ reason: 'oom', exitCode: 9 })?.kind === 'window' && d.fromWindowGone({ reason: 'crashed', exitCode: 11 })?.reason === 'crashed', 'the window\'s page: a crash or out of memory counts, closing doesn\'t')
  ok(d.fromChildGone({ type: 'GPU', reason: 'crashed', exitCode: 5 })?.kind === 'gpu' && d.fromChildGone({ type: 'GPU', reason: 'killed' }) === null && d.fromChildGone({ type: 'Utility', reason: 'crashed' }) === null, 'the graphics process crashing counts; ended on purpose, or another process, doesn\'t')
  ok(d.fromServerExit(0, null) === null && d.fromServerExit(null, 'SIGTERM') === null && d.fromServerExit(null, 'SIGKILL') === null && d.fromServerExit(1, null)?.reason === 'exited with code 1' && d.fromServerExit(null, 'SIGSEGV')?.reason === 'ended by SIGSEGV', 'the server: an exit code or a crash signal counts; stopped, updated or forced to quit doesn\'t')
  const data = path.join(OUT, `crash-report-desktop-${LANE}`)
  fs.rmSync(data, { recursive: true, force: true })
  fs.mkdirSync(path.join(data, 'logs'), { recursive: true })
  fs.writeFileSync(path.join(data, 'logs', 'server.log'), 'y'.repeat(1.5 * 1024 * 1024))
  const fd = d.serverLog(data)
  fs.writeSync(fd, 'hello from the server\n')
  fs.closeSync(fd)
  const log = fs.readFileSync(path.join(data, 'logs', 'server.log'), 'utf8')
  ok(log.length < 300 * 1024 && /Bridge AI's server started\nhello from the server\n$/.test(log), 'the server\'s log: what it prints, the last 256 KB kept from before', log.length)
  const nobody = `http://127.0.0.1:${await freePort()}`
  ok(await d.note({ kind: 'window', reason: 'oom', exitCode: 9 }, { base: nobody, data, version: '3.7.1' }) && JSON.parse(fs.readFileSync(path.join(data, 'cache', 'crash.json'), 'utf8')).reason === 'oom', 'with the server not answering, the window\'s crash is written where the server looks')
  fs.writeFileSync(path.join(data, 'cache', 'crash.json'), JSON.stringify({ kind: 'server', message: 'its own words' }))
  ok(await d.note(d.fromServerExit(1, null), { base: nobody, data, version: '3.7.1' }) === false && JSON.parse(fs.readFileSync(path.join(data, 'cache', 'crash.json'), 'utf8')).message === 'its own words', 'a server that just wrote down its own crash keeps its words')
}

// ---------- The server ----------
// A server of its own, made to crash: an error nothing catches, with personal things in it.
const crashed = path.join(OUT, `crash-report-crashed-${LANE}`)
fs.rmSync(crashed, { recursive: true, force: true })
fs.mkdirSync(crashed, { recursive: true })
const boom = `import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'server', 'crashes.js')).href)}).then((c) => { c.watch('9.9.9'); setTimeout(() => { throw new Error('Cannot read ${HOME}/code/acme-billing/package.json for ${email}') }, 10) })`
const r = spawnSync(process.execPath, ['--input-type=module', '-e', boom], { env: { PATH: process.env.PATH, BRIDGE_HOME: crashed }, encoding: 'utf8', timeout: 20000 })
const kept = (() => { try { return JSON.parse(fs.readFileSync(path.join(crashed, 'cache', 'crash.json'), 'utf8')) } catch { return null } })()
ok(r.status === 1 && kept?.kind === 'server' && kept.version === '9.9.9' && /Cannot read/.test(kept.message) && /at Timeout/.test(kept.stack), 'an error nothing caught: written down, and the server still stops (exit code 1)', { status: r.status, kept, err: r.stderr.slice(-300) })

const github = []
const kits = []
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  const kit = await startKit('crash-report', {
    config: { name: 'Priya Raman' },
    env: ({ data, home }) => {
      fs.mkdirSync(path.join(data, 'cache'), { recursive: true })
      fs.mkdirSync(path.join(data, 'logs'), { recursive: true })
      if (kept) fs.writeFileSync(path.join(data, 'cache', 'crash.json'), JSON.stringify(kept))
      fs.mkdirSync(path.join(home, 'code', 'acme-billing'), { recursive: true })
      // What the server printed before it stopped, as the desktop app keeps it.
      fs.writeFileSync(path.join(data, 'logs', 'server.log'), `Bridge AI on http://127.0.0.1:7420\nopening ${home}/code/acme-billing for Priya Raman\nkey ${K.anthropic} from ${email}\nFATAL: the last line\n`)
      return {}
    },
  })
  kits.push(kit)
  await kit.api('/setup', { name: 'Priya Raman' })
  await kit.api('/projects', { paths: [path.join(kit.home, 'code', 'acme-billing')] }).catch(() => {})
  const p0 = await kit.api('/crashes')
  ok(p0.crash?.kind === 'server' && p0.crash.version === '9.9.9', 'started again, the server offers the crash it wrote down', p0)
  const rep = await kit.api('/crashes/report', { kind: 'last', language: 'en-GB' })
  const all = `${rep.title}\n${rep.what}\n${rep.details}`
  const lines = rep.details.split('\n')
  ok(/^The server stopped: Cannot read <path> for <email>$/.test(rep.title), 'its report\'s title: what crashed and the error, with the path and email gone', rep.title)
  ok(lines.includes('Bridge AI: 9.9.9 (from source, Node ' + process.versions.node + ')') && lines.some((l) => /^System: \w+ /.test(l)) && lines.includes('Language: en-GB') && lines.includes('What crashed: the server stopped'), 'with the version, how it\'s installed, the system and the language', lines.slice(0, 8))
  ok(lines.some((l) => /^\s+at Timeout/.test(l)) && lines.includes('Settings:') && lines.includes('  runtime: builtin') && lines.includes('  layout: simple'), 'the stack, and the settings that matter', rep.details)
  ok(lines.includes('Last lines of server.log:') && lines.includes('FATAL: the last line') && lines.includes('opening ~/<path> for <name>') && lines.includes('key <key> from <email>'), 'the server\'s last log lines, with your folder, name, key and email gone', rep.details)
  ok(![kit.home, 'Priya', 'acme-billing', email, K.anthropic, HOME].some((v) => all.includes(v)), 'nothing personal anywhere in it', all)
  // The window's crash, from the crash screen.
  await kit.api('/ui-error', { where: 'Settings', message: `earlier: ${email} in acme-billing`, stack: '', url: '/' })
  const ui = await kit.api('/crashes/report', { kind: 'ui', where: 'Meetings', message: 'TypeError: x is undefined', stack: `TypeError: x is undefined\n    at Foo (${kit.home}/code/acme-billing/a.js:1:2)\n    at http://127.0.0.1:${kit.port}/assets/index.js:3:4` })
  ok(ui.title === 'The window hit an error: TypeError: x is undefined' && ui.details.includes('What crashed: the window hit an error (Meetings)') && ui.details.includes('at Foo (~/<path>:1:2)') && ui.details.includes(`at http://127.0.0.1:${kit.port}/assets/index.js:3:4`), 'the window\'s crash: where, the error and its stack, Bridge AI\'s own address kept', ui.details)
  ok(ui.details.includes('Last lines of ui-errors.log:') && /\[Settings\] earlier: <email> in <project>/.test(ui.details), 'and the window\'s errors before it, a line each, with what\'s yours gone', ui.details)
  // The desktop app's window or graphics going away.
  await kit.api('/crashes', { kind: 'window', reason: 'oom', exitCode: 9 })
  const w = await kit.api('/crashes')
  const wr = await kit.api('/crashes/report', { kind: 'last' })
  ok(w.crash?.kind === 'window' && /^The window went away: oom$/.test(wr.title) && wr.details.includes('Why: oom (exit code 9)'), 'the desktop app\'s window going away: kept, and its report says why', { w, title: wr.title })
  ok(await kit.api('/crashes', { kind: 'anything' }).then(() => false, () => true), 'and nothing else is taken as a crash')
  await kit.api('/crashes', { kind: 'server' }).catch(() => {})
  // Put back the server's crash for the window's checks.
  fs.writeFileSync(path.join(kit.data, 'cache', 'crash.json'), JSON.stringify(kept))
  await kit.restart()

  // ---------- In the app ----------
  const watchGithub = async (c) => { await c.route(/^https:\/\/github\.com\//, (route) => { github.push(route.request().url()); route.abort() }) }
  {
    const { ctx, p, errors } = await page(b, kit.url, { before: watchGithub })
    const card = p.locator('.crash-notice')
    const said = await until(async () => { const x = await card.innerText().catch(() => ''); return /server stopped unexpectedly and started again/.test(x) && x }, 15000)
    ok(!!said, 'after a crash: a card says the server stopped and started again, with Report on GitHub', await p.locator('body').innerText().catch(() => ''))
    await card.locator('button', { hasText: 'Report on GitHub' }).click({ timeout: 3000 }).catch(() => {})
    const dlg = p.locator('.crash-report')
    const details = dlg.locator('textarea.cr-details')
    const text = await until(async () => { const v = await details.inputValue().catch(() => ''); return /What crashed: the server stopped/.test(v) && v }, 8000)
    ok(!!text && /^The server stopped: Cannot read <path> for <email>$/.test(await dlg.locator('input').inputValue().catch(() => '')), 'Report on GitHub shows the whole issue: its title, what happened and the details', text)
    ok(!!text && ![kit.home, 'Priya', 'acme-billing', email].some((v) => text.includes(v)), 'with nothing personal in it', text)
    const href = async () => { const h = await dlg.locator('a.cr-open').getAttribute('href').catch(() => ''); try { return Object.fromEntries(new URL(h).searchParams) } catch { return {} } }
    ok((await href()).diagnostics === text, 'the link to GitHub carries exactly that')
    await details.fill(`${text}\n\nEDITED BY THE PERSON`)
    ok(/EDITED BY THE PERSON$/.test((await href()).diagnostics || ''), 'changed, the link carries the change')
    await p.waitForTimeout(300)
    await shot(p, `${tag}crash-report-dialog`)
    ok(github.length === 0, 'and nothing has gone to GitHub', github)
    await dlg.locator('button', { hasText: 'Cancel' }).click()
    ok(!!(await until(async () => !(await dlg.count()) && await card.isVisible(), 3000)), 'Cancel closes it, the card stays')
    await card.locator('button', { hasText: 'Not now' }).click()
    ok(!!(await until(async () => !(await card.count()) && !(await kit.api('/crashes')).crash, 4000)), 'Not now puts it away')
    await p.reload()
    await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
    await p.waitForTimeout(1000)
    ok(await card.count() === 0, 'for good')
    ok(errors.filter((e) => !/due to access control checks/.test(e)).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  // The crash screen, with a crash on cue (src/main.jsx), once it has stopped trying by itself.
  {
    const { ctx, p, errors } = await page(b, kit.url, { before: watchGithub })
    if (which === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: kit.url })
    await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
    await p.evaluate(() => localStorage.setItem('cc-test-crash', '1'))
    await p.reload()
    await until(async () => (await p.locator('.crash-card').count()) > 0 && (await p.locator('.crash-card.retrying').count()) === 0, 15000)
    const btn = p.locator('.crash-card button', { hasText: 'Report on GitHub' })
    ok(await btn.isVisible().catch(() => false), 'the crash screen has Report on GitHub, beside Copy details')
    await btn.click().catch(() => {})
    const dlg = p.locator('.crash-report')
    const title = await until(async () => { const v = await dlg.locator('input').inputValue().catch(() => ''); return /A crash made by a test/.test(v) && v }, 8000)
    const onTop = await p.evaluate(() => { const d = document.querySelector('.crash-report'); if (!d) return false; const r = d.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return !!at && d.contains(at) })
    ok(!!title && onTop, 'it opens over the crash screen, about this crash', title)
    const details = dlg.locator('textarea.cr-details')
    const v = await details.inputValue().catch(() => '')
    ok(/What crashed: the window hit an error\n/.test(v) && /Error: A crash made by a test/.test(v), 'with what crashed and the error', v.slice(0, 400))
    await details.fill('z'.repeat(MAX_URL + 1000))
    const note = dlg.locator('.cr-long')
    ok(/too long for a link/.test(await note.innerText().catch(() => '')), 'too long for a link: it says the details are copied first')
    const h = new URL(await dlg.locator('a.cr-open').getAttribute('href')).searchParams
    ok(/paste them here/.test(h.get('diagnostics') || '') && /A crash made by a test/.test(h.get('title') || ''), 'and the link asks to paste them', Object.fromEntries(h))
    if (which === 'chromium') {
      await dlg.locator('a.cr-open').click()
      const clip = await until(async () => { const c = await p.evaluate(() => navigator.clipboard.readText()).catch(() => ''); return c.length > MAX_URL && c }, 4000)
      ok(!!clip && /^z+$/.test(clip), 'Open on GitHub copies the details', (clip || '').length)
      ok(github.length > 0 && github.every((u) => u.startsWith('https://github.com/sahil1/bridge/issues/new?')), 'and only then is GitHub opened: the new-issue page, by the person', github)
    }
    await shot(p, `${tag}crash-report-over-crash-screen`)
    ok(errors.filter((e) => !/A crash made by a test|due to access control checks/.test(e)).length === 0, 'no other page errors', errors)
    await ctx.close()
  }
  // On a phone: the card fits.
  {
    fs.writeFileSync(path.join(kit.data, 'cache', 'crash.json'), JSON.stringify({ kind: 'window', reason: 'crashed', at: new Date().toISOString(), version: '3.7.1' }))
    await kit.restart()
    const { ctx, p } = await page(b, kit.url, { phone: true, mode: 'dark', before: watchGithub })
    const card = p.locator('.crash-notice')
    const said = await until(async () => /This window stopped unexpectedly and was opened again/.test(await card.innerText().catch(() => '')), 15000)
    const fits = await p.evaluate(() => { const r = document.querySelector('.crash-notice')?.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth })
    ok(said && fits, 'phone: the card says the window stopped and was opened again, and fits', await p.locator('body').innerText().catch(() => ''))
    await shot(p, `${tag}crash-report-phone`)
    await ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  for (const k of kits) k.stop()
  await b.close()
}

process.exit(done().fail ? 1 : 0)
