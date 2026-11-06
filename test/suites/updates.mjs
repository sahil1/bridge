// A Mac whose macOS is too old for the newest version. The release's notes say the oldest macOS
// its Mac app opens on (scripts/release.js writes it there from desktop/package.json), and the
// update check reads it: a Mac below it isn't offered the update, on any kind of install, while
// other Macs and other systems are; asked of the rules for every kind of computer and of a server
// with GitHub's releases stood in for (a Mac on 13.6 and one on 14.6). In the app on the 13.6 Mac:
// no Update anywhere, the desktop's top bar says once that the new version needs macOS 14 and puts
// it away for good after OK, the phone's line the same, and About & Updates says why it stays on
// this version. Then install.sh on a Mac, simulated (stand-ins for sw_vers, curl, defaults and
// osascript; nothing downloads or installs): on macOS 13 it installs 3.7.1, the last version for
// it, saying why; the app's own Update to a newer version, with 3.7.1 already there, stops before
// touching anything and says so in a window of macOS's own; an older version asked for by name is
// installed as asked; macOS 14 gets the newest; macOS 12 is told it needs 14. Not on Windows (no sh).
// The desktop app's own update (its version behind a server run from a clone, which is as new as the
// release) is held back the same way: not offered on the 13.6 Mac, said once with the app's version.
// Updating by itself while you're away: the rules (shared/autoupdate.js) at any moment, for the
// release (its age, a pre-release, held back, the switch), what runs (agents, a meeting, dictation,
// an install going in or one that failed) and the desktop app's side (away, locked, just woken,
// battery, each window's answer). Then a server in the desktop app on a Mac (stood in for), with
// GitHub's release a stand-in the test changes: on to start with; not until the desktop app says
// it's the time; waiting for a release out an hour, one with no date, a pre-release, the switch or
// Check for new versions off, an agent working, a meeting recording and an unsaved window, each
// refused when asked to install then, as is a release pulled since the last check or GitHub not
// answering right before; away with nothing running, the same install as Update now; one
// that fails said with the installer's last line and not tried again, also after a restart, until
// the next check (6 hours on), then it goes in, and isn't started twice; once it has, which version
// and when. Never by itself on a Mac that can't open the release or from source, and never asked for
// through the relay. The page, in the desktop app: About & Updates' switch, on, saying when, saved
// when turned off; "Updated to … by itself on … while you were away"; out a day and still waiting,
// why in plain words; no switch in a browser, on a phone or from source. And what a window answers
// the desktop app (src/busy.js): nothing open, nothing; Studio with an unsaved change, busy; a chat
// with a message being typed, busy; each back to nothing once saved or cleared.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { ROOT, OUT, IS_WIN, startKit, checks, until, browser, page, shot, freePort } from '../lib/harness.mjs'

const { ok, skip, done } = checks('updates')
const appMin = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).build.mac.minimumSystemVersion
ok(appMin === '14.0', 'the Mac app opens on macOS 14 or later', appMin)

// ---------- The release's notes say what it needs ----------
const notesFile = path.join(OUT, 'updates-notes.md')
fs.mkdirSync(OUT, { recursive: true })
const env = { ...process.env }
delete env.GITHUB_REF_NAME // CI's branch, which release.js would take for the tag
const wrote = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release.js'), '--notes', notesFile], { cwd: ROOT, env, encoding: 'utf8' })
const notes = wrote.status === 0 ? fs.readFileSync(notesFile, 'utf8') : ''
const up = await import('../../server/updates.js')
ok(up.minMacOf?.(notes) === appMin, 'the release notes say the oldest macOS the app opens on, as the update check reads it', `${wrote.stderr || ''}${notes.slice(-200)}`)
ok(/The Mac app needs macOS 14 or later\./.test(notes), 'and say it in words too', notes.slice(-200))

// ---------- The rules, for every kind of computer ----------
const NEW = { latest: '99.0.0', minMac: '14.0' }
const RULES = [
  ['a Mac on macOS 13.6', { platform: 'darwin', arch: 'arm64', os: '13.6' }, NEW, { latest: '99.0.0', macos: '14', have: '13.6' }],
  ['an Intel Mac on macOS 13.7.8', { platform: 'darwin', arch: 'x64', os: '13.7.8' }, NEW, { latest: '99.0.0', macos: '14', have: '13.7.8' }],
  ['a Mac on macOS 14.0', { platform: 'darwin', arch: 'arm64', os: '14.0' }, NEW, null],
  ['a Mac on macOS 26.1', { platform: 'darwin', arch: 'arm64', os: '26.1' }, NEW, null],
  ['a Mac on 14.6 and a version that needs 15', { platform: 'darwin', arch: 'x64', os: '14.6' }, { latest: '99.0.0', minMac: '15.0' }, { latest: '99.0.0', macos: '15', have: '14.6' }],
  ['a Mac on 13.6 and a release that says nothing (made before this)', { platform: 'darwin', arch: 'arm64', os: '13.6' }, { latest: '99.0.0', minMac: null }, null],
  ['a Mac on 13.6 with no newer version', { platform: 'darwin', arch: 'arm64', os: '13.6' }, { latest: '1.0.0', minMac: '14.0' }, null],
  ['a Mac whose version couldn\'t be read', { platform: 'darwin', arch: 'arm64', os: null }, NEW, null],
  ['Windows', { platform: 'win32', arch: 'x64', os: '10.0.22631' }, NEW, null],
  ['Linux', { platform: 'linux', arch: 'x64', os: '6.8.0', glibc: '2.39' }, NEW, null],
  ['the Docker image', { platform: 'linux', arch: 'arm64', os: '6.8.0', docker: true }, NEW, null],
]
for (const [what, m, release, want] of RULES) {
  const got = typeof up.heldBack === 'function' ? up.heldBack(release, m) : 'no rule'
  ok(JSON.stringify(got) === JSON.stringify(want), `${what}: ${want ? `not offered ${release.latest} (needs macOS ${want.macos})` : 'offered as usual'}`, got)
}
// The desktop app's own update: the release's macOS minimum, whatever version the server is.
{
  const same = { latest: '1.0.0', minMac: '14.0' }
  const mac13 = { platform: 'darwin', arch: 'arm64', os: '13.6' }
  const got = [up.below?.(same, mac13), up.below?.(same, { ...mac13, os: '14.6' }), up.below?.(same, { platform: 'win32', arch: 'x64', os: '10.0.22631' }), up.below?.({ latest: '1.0.0', minMac: null }, mac13)]
  ok(JSON.stringify(got) === JSON.stringify([{ latest: '1.0.0', macos: '14', have: '13.6' }, null, null, null]), 'the desktop app\'s own update: a Mac on 13.6 isn\'t offered a release that needs 14, even one no newer than the server; 14.6, Windows and a release that says nothing are', got)
}

// ---------- Updating by itself while you're away: the rules ----------
// shared/autoupdate.js, as the server and the desktop app ask it: what each waits for at a moment.
const au = await import('../../shared/autoupdate.js')
const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-11-06T03:00:00Z')
const ago = (h) => new Date(NOW - h * HOUR).toISOString()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
ok(au.RELEASE_HOURS === 4 && au.AWAY_MINUTES === 20, 'by itself: a release out 4 hours, and you away 20 minutes', [au.RELEASE_HOURS, au.AWAY_MINUTES])
{
  const out = (o = {}) => ({ how: 'app', available: true, latest: '99.0.0', publishedAt: ago(30), ...o })
  const RELEASE = [
    ['out 30 hours, offered here', {}, {}, []],
    ['out 3 hours', { publishedAt: ago(3) }, {}, ['young']],
    ['out just over 4 hours', { publishedAt: ago(4.02) }, {}, []],
    ["that GitHub didn't say when it came out", { publishedAt: null }, {}, ['young']],
    ['marked a pre-release', { prerelease: true }, {}, ['prerelease']],
    ['named as a pre-release', { latest: '99.0.0-beta.1' }, {}, ['prerelease']],
    ['this Mac\'s macOS can\'t open', { available: false, held: { latest: '99.0.0', macos: '14', have: '13.6' } }, {}, ['held']],
    ['no newer than this one', { available: false }, {}, ['none']],
    ['for a copy run from source', { how: 'source' }, {}, ['unsupported']],
    ['for the Linux package', { how: 'app-linux' }, {}, ['unsupported']],
    ['when the last check didn\'t reach GitHub (it may have been pulled since)', { error: 'GitHub answered 503' }, {}, ['unchecked']],
    ['with the switch off', {}, { on: false }, ['off']],
    ['with Check for new versions off', {}, { checks: false }, ['checks']],
  ]
  for (const [what, u, o, want] of RELEASE) {
    const got = au.releaseWhy({ u: out(u), now: NOW, ...o })
    ok(same(got, want), `by itself, a release ${what}: ${want.length ? `waits (${want})` : 'goes ahead'}`, got)
  }
  const mine = { version: '99.0.0', from: '3.10.0', at: NOW - 60 * 1000, failed: null }
  const QUIET = [
    ['nothing running', { agents: 0 }, null, []],
    ['an agent working or waiting on you', { agents: 1 }, null, ['agents']],
    ['agents it couldn\'t count', { agents: null }, null, ['agents']],
    ['a meeting recording', { agents: 0, meeting: true }, null, ['meeting']],
    ['a dictation being heard', { agents: 0, dictation: true }, null, ['dictation']],
    ['this version going in now', { agents: 0 }, mine, ['installing']],
    ['this version failed an hour ago', { agents: 0 }, { ...mine, at: NOW - HOUR, failed: { code: 1, line: 'couldn\'t download' } }, ['failed']],
    ['this version started 20 minutes ago and never came', { agents: 0 }, { ...mine, at: NOW - 20 * 60 * 1000 }, ['failed']],
    ['this version failed 7 hours ago, before the last check', { agents: 0 }, { ...mine, at: NOW - 7 * HOUR, failed: { code: 1 } }, []],
    ['an older version failed', { agents: 0 }, { ...mine, version: '98.0.0', failed: { code: 1 } }, []],
    ['a failure from before this version', { agents: 0 }, { ...mine, from: '3.9.0', failed: { code: 1 } }, []],
  ]
  for (const [what, quiet, tried, want] of QUIET) {
    const got = au.quietWhy({ quiet, tried, current: '3.10.0', latest: '99.0.0', now: NOW })
    ok(same(got, want), `by itself, with ${what}: ${want.length ? `waits (${want})` : 'goes ahead'}`, got)
  }
  const AWAY = [
    ['away 25 minutes, plugged in, two windows with nothing unsaved', { idle: 25 * 60, windows: [[], []] }, []],
    ['you using the computer', { idle: 30, windows: [[]] }, ['here']],
    ['away 19 minutes', { idle: 19 * 60 }, ['here']],
    ['the screen locked 3 minutes ago', { idle: 180, locked: true }, []],
    ['the screen locked a moment ago', { idle: 30, locked: true }, ['here']],
    ['the computer just woken, its screen still locked', { idle: 40 * 60, locked: true, woke: 60 }, ['here']],
    ['the computer woken an hour ago, you away since', { idle: 25 * 60, woke: 3600 }, []],
    ['the computer on battery', { idle: 25 * 60, battery: true }, ['battery']],
    ['a document unsaved in Studio, and a chat draft in another window', { idle: 25 * 60, windows: [['studio'], ['draft']] }, ['studio', 'draft']],
    ['a window that didn\'t answer', { idle: 25 * 60, windows: [[], null] }, ['window']],
    ['a window that said something it can\'t know', { idle: 25 * 60, windows: [['unknown']] }, ['window']],
  ]
  for (const [what, o, want] of AWAY) {
    const got = au.desktopWhy(o)
    ok(same(got, want), `by itself, the desktop app with ${what}: ${want.length ? `waits (${want})` : 'goes ahead'}`, got)
  }
  ok(au.waitingLong(out(), NOW) && !au.waitingLong(out({ publishedAt: ago(5) }), NOW) && !au.waitingLong(out({ available: false }), NOW), 'out a day and still not in: said why; out 5 hours, or nothing to update to: not', null)
}

// ---------- The server, with GitHub's releases stood in for ----------
// The notes as GitHub would send them. A long release's notes are cut at 4,000 characters in the
// app, so the stand-in's are the start and the part this test is about: the macOS line and after.
const tailAt = notes.indexOf('The Mac app needs macOS')
const body = tailAt > 1000 ? `${notes.slice(0, 600).trimEnd()}\n\n${notes.slice(tailAt)}` : notes
// /same/...: a release the same version as this server (run from a clone), for the desktop app's own update.
const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ tag_name: req.url.startsWith('/same/') ? `v${current}` : 'v99.0.0', html_url: 'https://github.com/sahil1/bridge/releases/tag/v99.0.0', body })) })
const port = await freePort()
await new Promise((r) => srv.listen(port, '127.0.0.1', r))
const API = `http://127.0.0.1:${port}/repos/sahil1/bridge/releases/latest`
const kits = []
const kitOn = async (name, version, api = API) => {
  const k = await startKit(`updates-${name}`, { env: { BRIDGE_RELEASES_API: api, BRIDGE_MACHINE: JSON.stringify({ platform: 'darwin', arch: 'arm64', os: version, docker: false }) } })
  kits.push(k)
  await k.api('/setup', { name: 'Tester' })
  return k
}
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
// A request a reload cut off isn't the page's fault (WebKit reports it as an error).
const cut = (errors) => errors.filter((e) => !/due to access control checks/.test(e))
let gh = null // GitHub's latest release, stood in for, for updating by itself
try {
  const old = await kitOn('mac13', '13.6')
  const u = await old.api('/updates?refresh=1')
  ok(u.latest === '99.0.0' && u.available === false && u.held?.macos === '14' && u.held?.have === '13.6', 'a Mac on 13.6: 99.0.0 isn\'t offered, and the answer says it needs macOS 14', u)
  ok(u.latest === '99.0.0' && !/<!--/.test(u.notes || '') && /The Mac app needs macOS 14 or later\. Checksums/.test(u.notes || ''), 'the notes shown leave out the line GitHub hides', (u.notes || '').slice(-200))
  const newer = await kitOn('mac14', '14.6')
  const n = await newer.api('/updates?refresh=1')
  ok(n.available === true && !n.held, 'a Mac on 14.6: offered as usual', n)
  // The desktop app behind a server run from a clone, on the 13.6 Mac: the newest release is this
  // server's own version, so the server isn't held back, but the app (1.0.0) is.
  const clone = await kitOn('mac13same', '13.6', `http://127.0.0.1:${port}/same/repos/sahil1/bridge/releases/latest`)
  const c = await clone.api('/updates?refresh=1')
  ok(c.latest === current && !c.held && !c.available && c.below?.macos === '14' && c.below?.have === '13.6' && c.appUpdate === false, 'a clone\'s server on 13.6: nothing newer for it, and the app\'s own update held back (needs macOS 14)', c)
  {
    const { ctx, p, errors } = await page(b, clone.url, { mode: 'light', theme: 'sky', before: async (cx) => {
      await cx.addInitScript(() => {
        const ua = `${navigator.userAgent} BridgeAI/1.0.0`
        Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ua, configurable: true })
        window.bridgeApp = { platform: 'darwin', desktop: true }
      })
    } })
    const chip = p.locator('.topbar .top-chip', { hasText: 'Newer version' })
    const shown = await chip.waitFor({ timeout: 15000 }).then(() => true, () => false)
    await chip.click({ timeout: 3000 }).catch(() => {})
    const said = await until(async () => { const x = await p.locator('.update-pop').innerText().catch(() => ''); return /you have 1\.0\.0/.test(x) && /macOS 14 or later/.test(x) && x }, 5000)
    ok(shown && !!said && await p.locator('.topbar .update-chip').count() === 0 && await p.locator('.update-pop button', { hasText: /Update/ }).count() === 0, 'the desktop app 1.0.0 behind it: not offered the update, said once that it needs macOS 14', await p.locator('.update-pop').innerText().catch(() => ''))
    ok(cut(errors).length === 0, 'and no page errors', errors)
    await ctx.close()
  }

  // ---------- In the app, on the 13.6 Mac ----------
  {
    const { ctx, p, errors } = await page(b, old.url, { mode: 'light', theme: 'sky' })
    const chip = p.locator('.topbar .top-chip', { hasText: 'Newer version' })
    // Each check after the first holds only once it was said, so none passes on nothing shown.
    const shown = await chip.waitFor({ timeout: 15000 }).then(() => true, () => false)
    ok(shown, 'desktop: the top bar says once that there\'s a newer version')
    ok(shown && await p.locator('.topbar .update-chip').count() === 0, 'desktop: and offers no Update')
    await chip.click({ timeout: 3000 }).catch(() => {})
    const pop = p.locator('.update-pop')
    const said = await until(async () => { const x = await pop.innerText().catch(() => ''); return /99\.0\.0/.test(x) && /macOS 14 or later/.test(x) && /macOS 13\.6/.test(x) && /keeps working/.test(x) && x }, 5000)
    ok(!!said, 'desktop: it says the version needs macOS 14, this Mac has 13.6, and this one keeps working', await pop.innerText().catch(() => ''))
    ok(!!said && await pop.locator('button', { hasText: /Update/ }).count() === 0, 'desktop: with nothing to update to')
    await p.waitForTimeout(400) // its fade-in
    await shot(p, `${tag}updates-held-desktop`)
    await pop.locator('button', { hasText: 'OK' }).click({ timeout: 3000 }).catch(() => {})
    ok(shown && !!(await until(async () => !(await chip.count()), 4000)), 'desktop: OK puts it away')
    await p.reload()
    await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
    await p.waitForTimeout(1500)
    ok(shown && await chip.count() === 0, 'desktop: and it isn\'t said again after a reload')
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
    const about = await until(async () => { const x = await p.locator('.st-body').innerText().catch(() => ''); return /Up to date for this Mac/.test(x) && /Bridge AI 99\.0\.0 needs macOS 14 or later, and this Mac has macOS 13\.6/.test(x) && x }, 8000)
    ok(!!about, 'About & Updates: up to date for this Mac, and why it stays on this version', (await p.locator('.st-body').innerText().catch(() => '')).slice(0, 600))
    await shot(p, `${tag}updates-held-about`)
    ok(!!about && await p.locator('.st-body button', { hasText: /Update to/ }).count() === 0, 'About & Updates: no Update button')
    ok(cut(errors).length === 0, 'desktop: no page errors', errors)
    await ctx.close()
  }
  {
    const { ctx, p, errors } = await page(b, old.url, { mode: 'dark', theme: 'sky', phone: true })
    const line = p.locator('.top-notes .update-note')
    const text = await until(async () => { const x = (await line.innerText().catch(() => '')).trim(); return /Bridge AI 99\.0\.0 needs macOS 14$/.test(x) && x }, 15000)
    ok(!!text, 'phone: one line under the top bar says 99.0.0 needs macOS 14', await p.locator('.top-notes').innerText().catch(() => ''))
    await shot(p, `${tag}updates-held-phone`)
    await p.locator('.top-notes .top-note-x').tap().catch(() => {})
    ok(!!text && !!(await until(async () => !(await line.count()), 4000)), 'phone: Not now puts it away')
    await p.reload()
    await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
    await p.waitForTimeout(1500)
    ok(!!text && await line.count() === 0, 'phone: and it isn\'t said again after a reload')
    ok(cut(errors).length === 0, 'phone: no page errors', errors)
    await ctx.close()
  }

  // ---------- Updating by itself while you're away: the server ----------
  // The desktop app on a Mac (stood in for: BRIDGE_INSTALL_HOW), GitHub's latest release a stand-in
  // the test changes, and the installer the tests' stand-in (nothing installs). The desktop app's
  // side is said by the test, as the app says it (POST /api/updates/auto).
  const rel = { tag_name: 'v99.0.0', html_url: 'https://github.com/sahil1/bridge/releases/tag/v99.0.0', body, published_at: new Date(Date.now() - 30 * HOUR).toISOString(), prerelease: false }
  let ghDown = false
  gh = http.createServer((req, res) => { res.writeHead(ghDown ? 503 : 200, { 'content-type': 'application/json' }); res.end(ghDown ? '{}' : JSON.stringify(rel)) })
  const ghPort = await freePort()
  await new Promise((r) => gh.listen(ghPort, '127.0.0.1', r))
  const GH = `http://127.0.0.1:${ghPort}/repos/sahil1/bridge/releases/latest`
  const appKit = async (name, os) => {
    const k = await startKit(`updates-${name}`, { env: { BRIDGE_RELEASES_API: GH, BRIDGE_INSTALL_HOW: 'app', BRIDGE_MACHINE: JSON.stringify({ platform: 'darwin', arch: 'arm64', os, docker: false }) } })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }
  const a = await appKit('auto', '14.6')
  a.program('claude', fs.readFileSync(path.join(ROOT, 'test', 'stand-ins', 'claude.cjs'), 'utf8'))
  await a.api('/agents/catalog') // found, now it's there
  const auto = async (refresh = true) => { if (refresh) await a.api('/updates?refresh=1'); return a.api('/updates/auto') }
  const say = (why) => a.api('/updates/auto', { why })
  const go = () => a.api('/updates/install', { auto: true })
  const installs = () => { try { return fs.readFileSync(path.join(a.bin, 'installs.log'), 'utf8').split('\n').filter((l) => /sahil1\/bridge\/v99\.0\.0\/install\.(sh|ps1)/.test(l)).length } catch { return 0 } }
  let v = await auto()
  ok(v.on === true && v.release === true && same(v.why, []) && v.desktop === null && v.ready === false, 'by itself: on to start with; a release out 30 hours, nothing running, but not yet: the desktop app hasn\'t said it\'s the time', v)
  v = await say(['here'])
  ok(v.ready === false && same(v.desktop?.why, ['here']), 'you using the computer: not yet, and what the app said is kept', v)
  v = await say([])
  ok(v.ready === true, 'you away and nothing unsaved in its windows: it\'s the time', v)
  // The release.
  rel.published_at = new Date(Date.now() - 1 * HOUR).toISOString()
  v = await auto()
  ok(v.release === false && same(v.why, ['young']), 'a release out an hour: it waits', v)
  await say([])
  let r = await go()
  ok(r.started === false && same(r.why, ['young']) && installs() === 0, 'and asked to install by itself then, it doesn\'t', r)
  rel.published_at = null
  ok(same((await auto()).why, ['young']), 'a release GitHub doesn\'t say the age of: it waits', null)
  rel.published_at = new Date(Date.now() - 5 * HOUR).toISOString()
  rel.prerelease = true
  ok(same((await auto()).why, ['prerelease']), 'a pre-release: never by itself', null)
  rel.prerelease = false
  ok(same((await auto()).why, []), 'out 5 hours: it goes ahead', null)
  // Right before installing, GitHub is asked again: a release pulled since isn't installed, nor one
  // GitHub can't be asked about.
  rel.tag_name = `v${current}`
  v = await say([])
  r = await go()
  ok(v.ready === true && r.started === false && same(r.why, ['none']) && installs() === 0, 'pulled since the last check (GitHub\'s latest is this version again): asked again right before, it doesn\'t', { v, r })
  rel.tag_name = 'v99.0.0'
  await auto()
  ghDown = true
  await say([])
  r = await go()
  ok(r.started === false && same(r.why, ['unchecked']) && installs() === 0, 'GitHub not answering right then: it doesn\'t either', r)
  ghDown = false
  ok(same((await auto()).why, []), 'answering again: it goes ahead', null)
  // The settings.
  await a.api('/settings', { updates: { auto: false } }, 'PATCH')
  v = await auto(false)
  ok(v.on === false && same(v.why, ['off']) && v.ready === false, 'turned off: it doesn\'t', v)
  await a.api('/settings', { updates: { check: false } }, 'PATCH')
  await a.api('/settings', { updates: { auto: true } }, 'PATCH')
  ok(same((await auto(false)).why, ['checks']), 'Check for new versions off: it doesn\'t either', null)
  await a.api('/settings', { updates: { check: true } }, 'PATCH')
  ok(same((await auto()).why, []), 'both on again: it goes ahead', null)
  // What runs here: an agent working, then closed; a meeting recording, then stopped.
  const work = path.join(a.home, 'code', 'shop')
  fs.mkdirSync(work, { recursive: true })
  const ag = await a.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Fix checkout', newSpace: 'shop' })
  v = await until(async () => { const x = await auto(false); return x.why.includes('agents') && x }, 20000, 500)
  ok(!!v, 'an agent working here: it waits', v || await auto(false))
  await say([])
  r = await go()
  ok(r.started === false && r.why.includes('agents') && installs() === 0, 'and asked to install by itself, it doesn\'t', r)
  const tab = (await a.api('/fleet')).agents.find((x) => x.paneId === ag.paneId)?.tabId
  if (tab) await a.api(`/tabs/${encodeURIComponent(tab)}/close`, {})
  ok(!!(await until(async () => same((await auto(false)).why, []), 15000, 500)), 'closed: it goes ahead', await auto(false))
  const mt = await a.api('/meetings', { title: 'Standup', call: false })
  ok(same((await auto(false)).why, ['meeting']), 'a meeting recording: it waits', await auto(false))
  await a.api(`/meetings/${mt.id}/stop`, {})
  ok(!!(await until(async () => same((await auto(false)).why, []), 15000, 500)), 'stopped (and nothing to transcribe): it goes ahead', await auto(false))
  // The desktop app's own reasons, said with Studio's unsaved document: kept for About & Updates.
  v = await say(['studio'])
  r = await go()
  ok(v.ready === false && r.started === false && same(r.why, ['studio']) && installs() === 0, 'a window with an unsaved document: it doesn\'t, and says that\'s why', r)

  // A failed install by itself: said, kept through a restart, and not tried again until the next check.
  fs.writeFileSync(path.join(a.bin, 'update-fails.txt'), "couldn't download Bridge-AI-mac-arm64.zip")
  await say([])
  r = await go()
  ok(r.started === true && !!(await until(() => installs() === 1, 8000)), 'away, nothing running, nothing unsaved: it installs by itself, as Update now does', { r, installs: installs() })
  let st = await until(async () => { const x = await a.api('/updates'); return x.failed && x }, 15000, 300)
  ok(st?.failed?.auto === true && /couldn't download Bridge-AI-mac-arm64\.zip/.test(st.failed.line), 'it didn\'t go through: said where a manual one is, with the installer\'s last line, as by itself', st?.failed)
  v = await say([])
  r = await go()
  ok(same(v.why, ['failed']) && v.ready === false && r.started === false && installs() === 1, 'and not tried by itself again, however often asked', { v, r, installs: installs() })
  await a.restart()
  v = await say([])
  st = await a.api('/updates')
  ok(same(v.why, ['failed']) && /couldn't download/.test(st.failed?.line || '') && st.failed?.auto, 'Bridge AI opened again: still said, and still not tried again', { v, failed: st.failed })
  // The next check, 6 hours on: tried again, and this time it goes through (the stand-in says so).
  const triedFile = path.join(a.data, 'cache', 'update', 'tried.json')
  const tried = JSON.parse(fs.readFileSync(triedFile, 'utf8'))
  ok(tried.version === '99.0.0' && tried.from === current && tried.auto === true && /couldn't download/.test(tried.failed?.line || ''), 'what it tried is kept on disk: the version, from which, by itself, and why it didn\'t go in', tried)
  fs.writeFileSync(triedFile, JSON.stringify({ ...tried, at: Date.now() - 7 * HOUR }))
  fs.rmSync(path.join(a.bin, 'update-fails.txt'))
  await a.restart()
  v = await say([])
  ok(same(v.why, []) && v.ready && !(await a.api('/updates')).failed, 'after the next check: it\'s the time again, and the old failure isn\'t said', v)
  r = await go()
  ok(r.started === true && !!(await until(() => installs() === 2, 8000)), 'and it installs by itself again', { r, installs: installs() })
  v = await say([])
  r = await go()
  ok(same(v.why, ['installing']) && r.started === false && installs() === 2, 'while it\'s going in, not again', { v, r })
  // Updated: the new version opened (its tried.json says it was this version, by itself).
  fs.writeFileSync(triedFile, JSON.stringify({ version: current, from: '3.9.0', at: Date.now() - 2 * HOUR, auto: true, failed: null }))
  await a.restart()
  v = await a.api('/updates/auto')
  ok(v.done?.version === current && Math.abs(Date.parse(v.done.at) - (Date.now() - 2 * HOUR)) < 60000, 'once it has: to which version, and when', v.done)
  // Elsewhere: a Mac that can't open the release, and a copy run from source.
  const held = await appKit('auto-held', '13.6')
  await held.api('/updates?refresh=1')
  v = await held.api('/updates/auto')
  ok(same(v.why, ['held']) && v.release === false, 'a Mac on 13.6, the release needing 14: never by itself', v)
  v = await newer.api('/updates/auto')
  ok(same(v.why, ['unsupported']) && v.release === false, 'from source: never by itself (git pull)', v)
  // Only the desktop app on this computer says what it waits for, or asks to install by itself: not
  // a phone through the relay.
  const viaRelay = (p) => fetch(`${a.url}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-relay': 'phone-test' }, body: JSON.stringify({ why: [], auto: true }) }).then((x) => x.status)
  const refused = [await viaRelay('/updates/auto'), await viaRelay('/updates/install')]
  ok(refused.every((s) => s >= 400) && installs() === 2, 'from a phone (through the relay): refused, both', refused)

  // ---------- Updating by itself: the page ----------
  // In the desktop app (its bridgeApp stood in for, with the page's answer to "what would an update
  // lose here" kept to ask), About & Updates: the switch, on, with when it updates; and once it has,
  // when; and out a day and still waiting, why.
  const desktop = (cx) => cx.addInitScript(() => { window.bridgeApp = { platform: 'darwin', desktop: true, answerBusy: (fn) => { window.__busy = fn } } })
  const about = async (p) => {
    await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
    await until(async () => {
      if (!(await p.locator('.modal.settings').count())) await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
      return p.locator('.modal.settings').waitFor({ timeout: 1000 }).then(() => true, () => false)
    }, 10000, 300)
  }
  const sw = (p) => p.locator('.st-check', { hasText: "Update by itself while you're away" })
  {
    const { ctx, p, errors } = await page(b, a.url, { mode: 'light', theme: 'sky', before: desktop })
    await about(p)
    const line = await until(async () => { const x = await sw(p).innerText().catch(() => ''); return /Once a new version has been out 4 hours/.test(x) && /no keyboard or mouse for 20 minutes, or the screen locked/.test(x) && x }, 10000)
    ok(!!line && await sw(p).locator('input').isChecked(), 'About & Updates, in the desktop app: Update by itself while you\'re away, on, saying when', line || await p.locator('.st-body').innerText().catch(() => ''))
    const did = await until(async () => { const x = await p.locator('.ab-auto-done').innerText().catch(() => ''); return new RegExp(`^Updated to ${current.replace(/\./g, '\\.')} by itself on .+ while you were away\\.$`).test(x) && x }, 8000)
    ok(!!did, `and once it has: "Updated to ${current} by itself on … while you were away"`, did || await p.locator('.st-body').innerText().catch(() => ''))
    ok(await p.locator('.ab-auto-wait').count() === 0, 'with nothing waiting a long time, nothing more')
    await shot(p, `${tag}updates-auto-about`)
    await sw(p).locator('input').uncheck()
    ok(!!(await until(async () => (await a.api('/settings')).effective?.updates?.auto === false, 5000)), 'turned off there: saved')
    await sw(p).locator('input').check()
    ok(!!(await until(async () => (await a.api('/settings')).effective?.updates?.auto === true, 5000)), 'and on again')
    ok(cut(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  // Waiting a long time: the release out 30 hours, an agent working, and the desktop app saying a
  // document in Studio isn't saved.
  rel.published_at = new Date(Date.now() - 30 * HOUR).toISOString()
  fs.writeFileSync(triedFile, JSON.stringify({ version: '1.0.0', from: '0.9.0', at: Date.now() - 50 * HOUR, auto: true, failed: null }))
  await a.restart()
  await a.api('/updates?refresh=1')
  const ag2 = await a.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Fix totals', newSpace: 'shop' })
  await until(async () => (await a.api('/updates/auto')).why.includes('agents'), 20000, 500)
  await say(['studio'])
  {
    const { ctx, p, errors } = await page(b, a.url, { mode: 'dark', theme: 'midnight', before: desktop })
    await about(p)
    const wait = await until(async () => { const x = await p.locator('.ab-auto-wait').innerText().catch(() => ''); return /Bridge AI 99\.0\.0 is waiting to update by itself:/.test(x) && /An agent is working or waiting on you\./.test(x) && /A document in Studio has unsaved changes\./.test(x) && x }, 10000)
    ok(!!wait, 'out a day and still not in: it says why, in plain words (an agent working, an unsaved document)', wait || await p.locator('.st-body').innerText().catch(() => ''))
    await shot(p, `${tag}updates-auto-waiting`)
    ok(cut(errors).length === 0, 'and no page errors', errors)
    await ctx.close()
  }
  const tab2 = (await a.api('/fleet')).agents.find((x) => x.paneId === ag2.paneId)?.tabId
  if (tab2) await a.api(`/tabs/${encodeURIComponent(tab2)}/close`, {})
  // Not shown where it can't work: in a browser, on a phone, and from source.
  for (const [what, url, o] of [['in a browser', a.url, {}], ['on a phone', a.url, { phone: true }], ['from source, in the desktop app', newer.url, { before: desktop }]]) {
    const { ctx, p } = await page(b, url, { mode: 'light', theme: 'sky', ...o })
    await about(p)
    const shown = await until(async () => /Check for new versions/.test(await p.locator('.modal.settings').innerText().catch(() => '')), 10000)
    ok(!!shown && await sw(p).count() === 0, `${what}: no Update by itself switch`, (await p.locator('.modal.settings').innerText().catch(() => '')).slice(0, 400))
    await ctx.close()
  }

  // ---------- What a window says an update would lose (src/busy.js) ----------
  // Asked as the desktop app asks it: nothing open, nothing; Studio with an unsaved change; a chat
  // with a message being typed.
  await a.api('/settings', { trials: { studio: true } }, 'PATCH')
  const doc = await a.api('/studio/new', { root: 'studio', dir: '', name: 'Plan.md', text: '# Plan\n\nFirst draft.\n' })
  const chat = await a.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Billing', newSpace: 'shop', prompt: 'idle' })
  {
    const { ctx, p, errors } = await page(b, a.url, { mode: 'light', theme: 'sky', before: desktop })
    await p.locator('.rail-nav-btn').first().waitFor({ timeout: 15000 }).catch(() => {})
    const busy = () => p.evaluate(() => (window.__busy ? window.__busy() : 'no answer'))
    ok(same(await until(async () => { const x = await busy(); return Array.isArray(x) && x }, 8000), []), 'nothing open: nothing an update would lose', await busy())
    // Asked again until it shows: WebKit can take it before the app is listening.
    const pm = p.locator('.sd-page .ProseMirror')
    await until(async () => {
      if (!(await pm.count())) await p.evaluate((d) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root: d.root || 'studio', path: d.path || d.name } })), doc)
      return /First draft/.test(await pm.innerText({ timeout: 1000 }).catch(() => ''))
    }, 20000, 700)
    await pm.click({ timeout: 5000 }).catch(() => {})
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await p.keyboard.type(' More.')
    ok(!!(await until(async () => same(await busy(), ['studio']), 5000)), 'Studio with an unsaved change: busy, the document', await busy())
    await p.locator('.pane-head button', { hasText: 'Save' }).click()
    ok(!!(await until(async () => same(await busy(), []), 8000)), 'saved: nothing again', await busy())
    const box = p.locator('.composer textarea:visible').first()
    await until(async () => {
      await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId, view: 'chat' } })), chat.paneId)
      return /Billing/.test(await box.getAttribute('placeholder', { timeout: 1500 }).catch(() => '') || '')
    }, 20000, 700)
    await box.fill('Check the totals on the invoice')
    ok(!!(await until(async () => same(await busy(), ['draft']), 5000)), 'a message being typed in a chat: busy, the draft', await busy())
    await box.fill('')
    ok(!!(await until(async () => same(await busy(), []), 5000)), 'cleared: nothing again', await busy())
    ok(cut(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
} finally {
  for (const k of kits) k.stop()
  srv.close()
  gh?.close()
  await b.close()
}

// ---------- install.sh on a Mac, simulated ----------
if (IS_WIN) skip('install.sh on a Mac', 'Windows has no sh')
else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-updates-install-'))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  for (const t of ['mktemp', 'rm', 'mkdir', 'awk', 'cat', 'cp', 'mv', 'sleep']) {
    const at = ['/bin', '/usr/bin'].map((d) => path.join(d, t)).find((f) => fs.existsSync(f))
    if (at) fs.symlinkSync(at, path.join(bin, t))
  }
  const log = path.join(dir, 'log.txt')
  const sh = (name, src) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${src}\n`, { mode: 0o755 })
  sh('uname', 'case "$1" in -m) echo arm64 ;; *) echo Darwin ;; esac')
  sh('sw_vers', 'echo "$TEST_MACOS"')
  // Nothing downloads: what was asked for is written down, and the download fails.
  sh('curl', `for a in "$@"; do case "$a" in http*) echo "curl $a" >> "${log}" ;; esac; done\nexit 22`)
  // The installed app's version, from its Info.plist (here, a file with the version in it).
  sh('defaults', '[ -f "$2" ] && /bin/cat "$2" || exit 1')
  sh('osascript', `echo "osascript $*" >> "${log}"`)
  for (const t of ['pkill', 'pgrep', 'xattr', 'open', 'ditto', 'sysctl']) sh(t, `echo "${t} $*" >> "${log}"\nexit 1`)
  const run = (macos, { version, installed } = {}) => {
    fs.rmSync(log, { force: true })
    const apps = fs.mkdtempSync(path.join(dir, 'apps-'))
    if (installed) {
      fs.mkdirSync(path.join(apps, 'Bridge AI.app', 'Contents'), { recursive: true })
      fs.writeFileSync(path.join(apps, 'Bridge AI.app', 'Contents', 'Info.plist'), installed)
    }
    const r = spawnSync('/bin/sh', [path.join(ROOT, 'install.sh')], { encoding: 'utf8', timeout: 30000, env: { PATH: bin, HOME: dir, TMPDIR: dir, TEST_MACOS: macos, BRIDGE_APP_DIR: apps, BRIDGE_NO_OPEN: '1', BRIDGE_RELEASES: 'http://127.0.0.1:9/releases', ...(version ? { BRIDGE_VERSION: version } : {}) } })
    const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []
    return { status: r.status, out: `${r.stdout}${r.stderr}`, asked: lines.filter((l) => l.startsWith('curl ')).map((l) => l.slice(5)), lines, kept: installed ? fs.readFileSync(path.join(apps, 'Bridge AI.app', 'Contents', 'Info.plist'), 'utf8') === installed : null }
  }
  const zip = (v) => `http://127.0.0.1:9/releases/${v ? `download/${v}` : 'latest/download'}/Bridge-AI-mac-arm64.zip`

  let r = run('13.6')
  ok(/The newest Bridge AI needs macOS 14 \(Sonoma\) or later, and this Mac has macOS 13\.6\./.test(r.out) && /Installing Bridge AI 3\.7\.1, the last version for macOS 13\./.test(r.out), 'macOS 13: says the newest version needs macOS 14, and installs 3.7.1, the last for 13', r.out)
  ok(r.asked[0] === zip('v3.7.1'), 'macOS 13: it downloads 3.7.1', r.asked)

  r = run('13.6', { version: 'v3.8.0', installed: '3.7.1' })
  ok(r.status === 0 && /Bridge AI 3\.8\.0 needs macOS 14 \(Sonoma\) or later, and this Mac has macOS 13\.6\./.test(r.out) && /Bridge AI 3\.7\.1, the last version for macOS 13, stays as it is and keeps working\./.test(r.out), 'macOS 13, the app\'s Update to 3.8.0 with 3.7.1 there: says it stays on 3.7.1', r.out)
  ok(r.asked.length === 0 && r.kept && !r.lines.some((l) => /^(pkill|ditto|open|xattr)/.test(l)), 'and touches nothing: no download, the app left as it was and not closed', r.lines)
  ok(r.lines.some((l) => /^osascript .*display alert.*needs macOS 14 \(Sonoma\).*stays as it is/.test(l)), 'and, with no terminal to say it in, says it in a window of macOS\'s own', r.lines)

  r = run('13.6', { version: 'v3.8.0', installed: '3.6.0' })
  ok(/Installing Bridge AI 3\.7\.1, the last version for macOS 13\./.test(r.out) && r.asked[0] === zip('v3.7.1'), 'macOS 13 with 3.6.0, updating to 3.8.0: 3.7.1 instead', { out: r.out, asked: r.asked })

  r = run('13.6', { version: 'v3.6.0' })
  ok(!/needs macOS 14/.test(r.out) && r.asked[0] === zip('v3.6.0'), 'macOS 13, an older version asked for by name: that one', { out: r.out, asked: r.asked })

  r = run('14.0')
  ok(!/needs macOS/.test(r.out) && r.asked[0] === zip(null), 'macOS 14: the newest version', { out: r.out, asked: r.asked })

  r = run('12.7.6')
  ok(r.status !== 0 && /needs macOS 14 \(Sonoma\) or later, and this Mac has macOS 12\.7\.6/.test(r.out) && r.asked.length === 0, 'macOS 12: told it needs macOS 14, nothing downloaded', r.out)
  fs.rmSync(dir, { recursive: true, force: true })
}

process.exit(done().fail ? 1 : 0)
