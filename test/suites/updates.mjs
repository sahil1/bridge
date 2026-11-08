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
// An install that didn't go through: one stopped with an error, or one whose installer said so
// without one (install.ps1 does, on Windows), and not one that finished.
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
// Channels. The rules: versions in semver's order (a pre-release before its version, the desktop
// app's copy the same); the release each channel takes from GitHub's list (Early Access the newest,
// pre-releases too, never a draft or a paused one; Stable never a pre-release); offered or not
// (never an older version, so leaving Early Access stays put until Stable passes it; a staged
// release to the buckets under its percentage, at 0, 10 and 100, or asked for by hand; paused, to
// nobody); the lines a release's notes hide; codes good, ended, taken back, forged, cut short. npm
// run release in a repo of its own: a beta (3.13.0-beta.1) said to be a pre-release for Early Access
// only, never the latest release or Docker's latest, its notes saying so; a rollout line kept, last;
// a version that's neither refused. npm run rollout and the code script with gh stood in for: 10, 50,
// 0, 100, --dry-run, a key pair made once and never in the repo, a code that checks out, --revoke.
// Then servers with GitHub's list stood in for: a staged release (bucket 37 at 10%: not offered, nor
// by itself; Check now offers it; 50 does; 0 doesn't even by hand, and Update refuses it; bucket 5
// at 10% is offered), Early Access (wrong codes refused saying why and not kept; Sam's code: the
// newest pre-release, by itself too, the usage stats saying early, Sam and the bucket; taken back
// in a release's notes: Stable, saying why; leaving; an older Stable never installed; a kept code
// that ended), and where it isn't offered (Docker, a build with no key), the bucket picked once and
// kept, Linux's command with the pre-release's tag. The page: the quiet link, a wrong and an ended
// code saying why, Sam's code in light, dark and on a phone (nothing wider than it), leaving, a
// ?early= link filling it in, a kept code that ended, no link where it can't work, and a staged
// release Up to date until Check now.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
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
ok(notes.split('a star on GitHub').length === 2 && /SHA256SUMS\.txt`\.\n\nIf Bridge AI is useful to you, a star on GitHub helps other people find it\.\n\n<!-- macOS/.test(notes), 'and end, once, with a line asking for a GitHub star, before the line GitHub hides', notes.slice(-300))

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

// An install that didn't go through, from how the installer ended: with an error, or saying so in
// its own words without one (install.ps1 returns, so a PowerShell window it was pasted into stays
// open: on Windows its line is the only sign).
{
  const ENDS = [
    ['install.sh stopping with an error', 1, "Bridge AI install: couldn't download https://example.com/Bridge-AI-mac-arm64.zip", true],
    ['an error with nothing said', 1, '', true],
    ['install.ps1 saying why, with no error', 0, "Bridge AI install: the download of Bridge-AI-win-x64.exe doesn't match its checksum; run the installer again", true],
    ['install.ps1 done', 0, 'Bridge AI is installed. Opening it now; next time, find it in the Start menu.', false],
    ['install.sh leaving a Mac on its last version', 0, 'Bridge AI 3.7.1, the last version for macOS 13, stays as it is and keeps working.', false],
  ]
  const got = ENDS.map(([, code, line]) => up.didntGoThrough?.(code, line))
  ok(JSON.stringify(got) === JSON.stringify(ENDS.map((x) => x[3])), 'an install that didn\'t go through: an error, or the installer saying so without one (install.ps1); not one that finished or kept the version there', ENDS.map(([what], i) => `${what}: ${got[i]}`))
}

// ---------- Updating by itself while you're away: the rules ----------
// shared/autoupdate.js, as the server and the desktop app ask it: what each waits for at a moment.
const au = await import('../../shared/autoupdate.js')
// As PRIVACY.md and SECURITY.md say: not only when you update, but by itself in the desktop app.
{
  const doc = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\s+/g, ' ')
  ok(/by itself while you're away in the desktop app on a Mac or Windows unless you turn that off/.test(doc('PRIVACY.md')) && /by itself while you're away unless you turn that off/.test(doc('SECURITY.md')), 'PRIVACY.md and SECURITY.md say the desktop app updates by itself while you\'re away, unless turned off', null)
}
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

// ---------- Channels: the rules ----------
// Versions in semver's order (a pre-release before its version), in the server and in the desktop
// app's copy; the release each channel takes from GitHub's list; whether one is offered here (never
// an older version, the staged rollout's bucket, asked for by hand, paused); the lines a release's
// notes hide; early-access codes, good and not; and a pre-release by itself only on Early Access.
const ver = await import('../../shared/version.js')
const ro = await import('../../shared/rollout.js')
const ea = await import('../../server/earlyaccess.js')
{
  const ORDER = ['3.12.0', '3.13.0-alpha.1', '3.13.0-beta.1', '3.13.0-beta.2', '3.13.0-beta.10', '3.13.0-rc.1', '3.13.0', '3.13.1', '3.14.0-beta.1', '4.0.0']
  // As checked out: a Windows checkout ends its lines with \r\n.
  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const from = main.indexOf('const parts = (v) =>')
  // Its copy, taken out of the file; one that can't be is a failed check, not the end of the test.
  let appNewer = () => null
  try { appNewer = new Function(`${main.slice(from, main.indexOf('\n}\n', main.indexOf('const newer = (a, b) =>', from)) + 3)}; return newer`)() } catch { /* said below */ }
  const wrong = []
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = 0; j < ORDER.length; j++) {
      if (ver.newer(ORDER[i], ORDER[j]) !== i > j) wrong.push(`${ORDER[i]} vs ${ORDER[j]}`)
      if (appNewer(ORDER[i], ORDER[j]) !== i > j) wrong.push(`desktop app: ${ORDER[i]} vs ${ORDER[j]}`)
    }
  }
  ok(!wrong.length, 'versions in order, a pre-release before its version (3.13.0-beta.2 < beta.10 < rc.1 < 3.13.0), the desktop app\'s copy the same', wrong)

  const R = (tag, o = {}) => ({ tag_name: tag, prerelease: !!o.pre, draft: !!o.draft, body: `Notes\n${o.rollout != null ? `<!-- rollout: ${o.rollout} -->\n` : ''}` })
  const LIST = [R('v99.3.0-beta.1', { pre: true, rollout: 0 }), R('v99.2.0', { draft: true }), R('nightly-1', { pre: true }), R('v99.1.0-beta.2', { pre: true }), R('v99.1.0-beta.1', { pre: true }), R('v99.0.0', { rollout: 10 }), R('v98.0.0')]
  ok(up.newestOf?.(LIST, { early: true })?.tag_name === 'v99.1.0-beta.2' && up.newestOf(LIST)?.tag_name === 'v99.0.0', 'from GitHub\'s list, Early Access takes the newest release, pre-releases too, but not a draft, a paused one or a tag that isn\'t a version; Stable never a pre-release', [up.newestOf?.(LIST, { early: true })?.tag_name, up.newestOf?.(LIST)?.tag_name])
  ok(up.newestOf?.([R('v99.1.0-beta.2', { pre: true }), R('v99.1.0')], { early: true })?.tag_name === 'v99.1.0', 'a release is newer than its betas: Early Access moves on to it')

  const OFFERED = [
    ['on Stable, a release with no rollout line', { latest: '99.0.0', bucket: 99 }, true],
    ['at 10%, to bucket 5', { latest: '99.0.0', rollout: 10, bucket: 5 }, true],
    ['at 10%, to bucket 10', { latest: '99.0.0', rollout: 10, bucket: 10 }, false],
    ['at 10%, to bucket 37 that asked by hand', { latest: '99.0.0', rollout: 10, bucket: 37, asked: '99.0.0' }, true],
    ['at 100%, to bucket 99', { latest: '99.0.0', rollout: 100, bucket: 99 }, true],
    ['paused (0), to bucket 0', { latest: '99.0.0', rollout: 0, bucket: 0 }, false],
    ['paused, asked for by hand', { latest: '99.0.0', rollout: 0, bucket: 0, asked: '99.0.0' }, false],
    ['paused, on Early Access', { latest: '99.0.0', rollout: 0, channel: 'early' }, false],
    ['at 10%, on Early Access in bucket 80', { latest: '99.0.0', rollout: 10, bucket: 80, channel: 'early' }, true],
    ['the version it has', { latest: '3.12.0' }, false],
    ['an older one', { latest: '3.11.0', channel: 'early' }, false],
    ['on 99.1.0-beta.2 after leaving Early Access, Stable at 99.0.0 (it stays put)', { current: '99.1.0-beta.2', latest: '99.0.0' }, false],
    ['on 99.1.0-beta.2, once Stable passes it with 99.1.0', { current: '99.1.0-beta.2', latest: '99.1.0' }, true],
    ['on 99.1.0-beta.2 on Early Access, the next beta', { current: '99.1.0-beta.2', latest: '99.1.0-beta.3', channel: 'early' }, true],
  ]
  const got = OFFERED.map(([, o]) => up.offered?.({ current: '3.12.0', ...o }))
  ok(same(got, OFFERED.map((x) => x[2])), 'offered or not: never an older version or the same one, a staged release to the buckets under its percentage or by hand, a paused one to nobody', OFFERED.map(([what], i) => `${what}: ${got[i]}`))

  const n0 = 'Notes.\n\n<!-- macOS 14.0 or later -->\n'
  const n10 = ro.withRollout(n0, 10)
  ok(ro.rolloutOf(n0) === null && ro.rolloutOf(n10) === 10 && ro.rolloutOf(ro.withRollout(n10, 50)) === 50 && ro.withRollout(n10, 50).split('rollout').length === 2 && ro.withRollout(n10, 100) === n0 && ro.rolloutOf(ro.withRollout(n10, 0)) === 0, 'the rollout line in a release\'s notes: none is everyone; set, changed, taken out at 100, and 0 pauses', n10)
  const twice = ro.withRevoked(ro.withRevoked(n10, 'abcd1234'), 'ef567890')
  ok(same(ro.revokedIn(twice), ['abcd1234', 'ef567890']) && twice.split('revoked').length === 2 && ro.shown(twice).trim() === 'Notes.', 'codes taken back go in one line, and the notes shown leave out every line GitHub hides', twice)

  const { privateKey: owner } = crypto.generateKeyPairSync('ed25519')
  const { privateKey: someone } = crypto.generateKeyPairSync('ed25519')
  const key = ea.publicOf(owner)
  const sam = ea.makeCode({ label: 'Sam', days: 30, privateKey: owner })
  const r = ea.readCode(sam, { key })
  ok(r.ok && r.for === 'Sam' && /^[0-9a-f]{8}$/.test(r.id) && Math.abs(Date.parse(r.until) - Date.now() - 30 * 24 * HOUR) < 60000 && Math.abs(Date.parse(r.made) - Date.now()) < 60000, 'an early-access code: who it\'s for, its id, when it was made and when it ends, signed with the owner\'s key', r)
  const [, details, sig] = sam.split('.')
  const longer = `ea1.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(details, 'base64url').toString('utf8')), until: 4102444800 })).toString('base64url')}.${sig}`
  const CODES = [
    ['signed with another key (forged)', ea.makeCode({ label: 'Sam', privateKey: someone }), {}, 'forged'],
    ['changed on the way (a later end)', longer, {}, 'forged'],
    ['cut short', sam.slice(0, 80), {}, 'malformed'],
    ['not a code', 'let me in', {}, 'malformed'],
    ['past its end', sam, { now: Date.now() + 31 * 24 * HOUR }, 'expired'],
    ['taken back', sam, { revoked: [r.id] }, 'revoked'],
    ['in a build with no key', sam, { key: '' }, 'none'],
  ]
  const why = CODES.map(([, c, o]) => ea.readCode(c, { key, ...o }).why)
  ok(same(why, CODES.map((x) => x[3])), 'a code that doesn\'t work says why', CODES.map(([what], i) => `${what}: ${why[i]}`))
  ok(ea.readCode(` ${sam.slice(0, 50)}\n${sam.slice(50)} `, { key }).ok && ea.readCode(ea.makeCode({ label: 'Lee', privateKey: owner }), { key }).until === null, 'pasted with spaces or a line break in it, it works; made without --days, it doesn\'t end')
  ok(!ea.labelOk('sam@example.com') && !ea.labelOk('') && !ea.labelOk('x'.repeat(33)) && ea.labelOk('Zoë K.'), 'who it\'s for: a first name or nickname, never an email')
  ok(ea.PUBLIC_KEY === '' || /^[A-Za-z0-9_-]{43}$/.test(ea.PUBLIC_KEY), 'the key built in is the public half of one (32 bytes), or none yet', ea.PUBLIC_KEY)
  const pre = { how: 'app', available: true, latest: '99.1.0-beta.2', prerelease: true, publishedAt: ago(30) }
  ok(same(au.releaseWhy({ u: { ...pre, channel: 'early' }, now: NOW }), []) && same(au.releaseWhy({ u: { ...pre, channel: 'stable' }, now: NOW }), ['prerelease']), 'by itself: a pre-release goes in on Early Access, which asked for them, and never on Stable')
}

// ---------- npm run release with a beta, and a release out a few computers at a time ----------
// In a repo of its own, with an origin on this computer (nothing reaches GitHub): the version
// decides, and --dry-run says who it goes to and pushes nothing.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-release-'))
  const repo = path.join(dir, 'repo')
  const origin = path.join(dir, 'origin.git')
  for (const f of ['scripts/release.js', 'scripts/check-private.js', 'shared/private.js', 'shared/version.js', 'shared/rollout.js']) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true })
    fs.copyFileSync(path.join(ROOT, f), path.join(repo, f))
  }
  fs.mkdirSync(path.join(repo, 'desktop'))
  const gitConfig = path.join(dir, 'gitconfig')
  fs.writeFileSync(gitConfig, '[user]\n\tname = Tester\n\temail = tester@example.com\n[init]\n\tdefaultBranch = main\n')
  const renv = { ...env, HOME: dir, USERPROFILE: dir, BRIDGE_HOME: path.join(dir, 'data'), GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' }
  const git = (...a) => spawnSync('git', a, { cwd: repo, env: renv, encoding: 'utf8' })
  spawnSync('git', ['init', '-q', '--bare', origin], { env: renv })
  git('init', '-q')
  git('remote', 'add', 'origin', origin)
  const version = (v, section) => {
    fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'bridge-ai', version: v, type: 'module' }, null, 2)}\n`)
    fs.writeFileSync(path.join(repo, 'desktop', 'package.json'), `${JSON.stringify({ name: 'bridge-ai-desktop', version: v, build: { mac: { minimumSystemVersion: '14.0' } } }, null, 2)}\n`)
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), `# Changelog\n\n## ${v}\n\n${section}\n\n## 3.12.0\n\nThe one before.\n`)
    git('add', '-A')
    git('commit', '-qm', `Bridge AI ${v}`)
    git('push', '-q', 'origin', 'HEAD:main')
  }
  const release = (args, more = {}) => { const x = spawnSync(process.execPath, [path.join(repo, 'scripts', 'release.js'), ...args], { cwd: repo, env: { ...renv, ...more }, encoding: 'utf8' }); return { status: x.status, out: `${x.stdout}${x.stderr}` } }
  version('99.1.0-beta.1', 'A beta: the new thing, to try.')
  let r = release(['--dry-run'])
  ok(r.status === 0 && /A pre-release, for Early Access/.test(r.out) && /never becomes the latest release, the website's download or Docker's latest \(only ghcr\.io\/sahil1\/bridge:99\.1\.0-beta\.1\)/.test(r.out) && /Dry run: nothing pushed\./.test(r.out), 'npm run release -- --dry-run, at 99.1.0-beta.1: a pre-release for Early Access, never the latest release, the website\'s download or Docker\'s latest', r.out)
  ok(/A beta: the new thing, to try\.\n\nThis is a pre-release, for testers/.test(r.out) && !git('ls-remote', '--tags', 'origin').stdout.trim(), 'its notes say what it is after its changes, and nothing is pushed', r.out)
  const notesAt = path.join(dir, 'notes.md')
  r = release(['--notes', notesAt], { GITHUB_REF_NAME: 'v99.1.0-beta.1' })
  const ci = r.status === 0 ? fs.readFileSync(notesAt, 'utf8') : ''
  ok(/This is a pre-release, for testers/.test(ci) && up.minMacOf(ci) === '14.0' && ro.rolloutOf(ci) === null, 'the notes CI publishes it with (as a pre-release, release.yml) say the same, with the macOS line', ci || r.out)
  version('99.1.0', 'Everyone gets the new thing.\n\n<!-- rollout: 10 -->')
  r = release(['--dry-run'])
  ok(r.status === 0 && /10% of computers on Stable are offered it at first/.test(r.out) && /npm run rollout -- 99\.1\.0 <percent>/.test(r.out) && !/pre-release/.test(r.out), 'a release whose CHANGELOG section has a rollout line: 10% of Stable at first, and how to widen it', r.out)
  ok(/Everyone gets the new thing\.\n\nThe Mac app/.test(r.out) && /<!-- macOS 14\.0 or later -->\n\n<!-- rollout: 10 -->\n/.test(r.out), 'its notes keep the line, last, where npm run rollout changes it', r.out)
  version('99.2.0', 'Everyone at once.')
  r = release(['--dry-run'])
  ok(r.status === 0 && /Everyone on Stable is offered it at once/.test(r.out), 'one with no rollout line: everyone at once, as before', r.out)
  version('99.3.0-nightly', 'Something.')
  r = release(['--dry-run'])
  ok(r.status !== 0 && /isn't a version Bridge AI is released as/.test(r.out), 'a version that\'s neither a release nor a beta is refused', r.out)
  fs.rmSync(dir, { recursive: true, force: true })
}

// ---------- npm run rollout and the code script, with the GitHub CLI stood in for ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-gh-'))
  const state = path.join(dir, 'releases.json')
  const ghJs = path.join(dir, 'gh.cjs')
  fs.writeFileSync(ghJs, `const fs = require('fs')
const all = JSON.parse(fs.readFileSync(process.env.GH_STATE, 'utf8'))
const [cmd, sub, ...rest] = process.argv.slice(2)
if (cmd !== 'release') { console.error('unknown command'); process.exit(1) }
if (sub === 'list') { console.log(JSON.stringify(all.filter((x) => !x.isDraft).slice(0, 1).map((x) => ({ tagName: x.tagName })))); process.exit(0) }
const r = all.find((x) => x.tagName === rest[0])
if (!r) { console.error('release not found'); process.exit(1) }
if (sub === 'view') console.log(JSON.stringify(r))
if (sub === 'edit') { r.body = fs.readFileSync(rest[rest.indexOf('--notes-file') + 1], 'utf8'); fs.writeFileSync(process.env.GH_STATE, JSON.stringify(all)) }
`)
  const n0 = 'Everyone gets the new thing.\n\n<!-- macOS 14.0 or later -->\n'
  fs.writeFileSync(state, JSON.stringify([{ tagName: 'v99.1.0', body: n0, isPrerelease: false, isDraft: false }, { tagName: 'v99.2.0-beta.1', body: 'A beta.\n', isPrerelease: true, isDraft: false }]))
  const gh = { BRIDGE_GH: ghJs, GH_STATE: state }
  const notesOf = (tag) => JSON.parse(fs.readFileSync(state, 'utf8')).find((x) => x.tagName === tag).body
  const rollout = (...a) => { const x = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'rollout.js'), ...a], { cwd: ROOT, env: { ...env, ...gh }, encoding: 'utf8' }); return { status: x.status, out: `${x.stdout}${x.stderr}`, notes: notesOf('v99.1.0') } }
  let r = rollout('99.1.0', '10')
  ok(r.status === 0 && ro.rolloutOf(r.notes) === 10 && r.notes.startsWith(n0.trimEnd()) && /now offered to 10% of computers on Stable/.test(r.out), 'npm run rollout -- 99.1.0 10: the release\'s notes on GitHub say 10%, and the rest stays as it was', r)
  r = rollout('99.1.0', '50', '--dry-run')
  ok(r.status === 0 && ro.rolloutOf(r.notes) === 10 && /Dry run: nothing changed/.test(r.out), '--dry-run shows what it would write and changes nothing', r.out)
  r = rollout('v99.1.0', '50')
  ok(r.status === 0 && ro.rolloutOf(r.notes) === 50 && r.notes.split('rollout').length === 2, '50: the line changed, still one', r.notes)
  r = rollout('99.1.0', '0')
  ok(r.status === 0 && ro.rolloutOf(r.notes) === 0 && /nobody \(paused\)/.test(r.out), '0: paused', r.out)
  r = rollout('99.1.0', '100')
  ok(r.status === 0 && r.notes === n0 && /now offered to everyone/.test(r.out), '100: everyone, and the line goes', r)
  r = rollout('99.1.0')
  ok(r.status === 0 && /offered to everyone\./.test(r.out), 'with no percentage, where it\'s at', r.out)
  r = rollout('99.1.0', '150')
  ok(r.status !== 0 && /a whole number from 0 to 100/.test(r.out) && r.notes === n0, 'a percentage over 100: refused, nothing changed', r.out)
  r = rollout('99.9.9', '10')
  ok(r.status !== 0 && /release not found/.test(r.out), 'a release GitHub doesn\'t have: GitHub\'s words', r.out)
  r = rollout('99.2.0-beta.1', '0')
  ok(r.status === 0 && ro.rolloutOf(notesOf('v99.2.0-beta.1')) === 0 && /pre-release \(Early Access only\)/.test(rollout('99.2.0-beta.1').out), 'a beta paused the same way (0 holds it back from Early Access)', notesOf('v99.2.0-beta.1'))

  // node scripts/early-access-code.js: the key pair once, a code per tester, taking one back.
  const keyAt = path.join(dir, 'keys', 'early-access-key.pem')
  const source = fs.readFileSync(path.join(ROOT, 'server', 'earlyaccess.js'), 'utf8')
  const codes = (a, more = {}) => { const x = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'early-access-code.js'), ...a], { cwd: ROOT, env: { ...env, BRIDGE_EARLY_ACCESS_PRIVATE_KEY: keyAt, ...more }, encoding: 'utf8' }); return { status: x.status, out: `${x.stdout}${x.stderr}` } }
  r = codes(['--new-key'])
  const pub = /export const PUBLIC_KEY = '([A-Za-z0-9_-]{43})'/.exec(r.out)?.[1]
  // The key's first line made of parts, so the repo's own check doesn't take this for a real one.
  ok(r.status === 0 && !!pub && fs.readFileSync(keyAt, 'utf8').startsWith(['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')) && (IS_WIN || (fs.statSync(keyAt).mode & 0o777) === 0o600) && fs.readFileSync(path.join(ROOT, 'server', 'earlyaccess.js'), 'utf8') === source, '--new-key: the private key in a file only you can read, and the public key printed to put in server/earlyaccess.js', r.out)
  r = codes(['--new-key'])
  ok(r.status !== 0 && /there's a key at/.test(r.out), 'run again, it keeps the key there (codes made with it would stop working)', r.out)
  const inRepo = path.join(OUT, 'early-access-key.pem')
  r = codes(['--new-key', '--key', inRepo])
  ok(r.status !== 0 && /inside this repo/.test(r.out) && !fs.existsSync(inRepo), 'and never makes one inside the repo', r.out)
  r = codes(['Sam', '--days', '30'], { BRIDGE_EARLY_ACCESS_KEY: pub })
  const made = /^ea1\.\S+$/m.exec(r.out)?.[0]
  const c = ea.readCode(made, { key: pub })
  ok(r.status === 0 && c.ok && c.for === 'Sam' && c.until && new RegExp(`--revoke ${c.id}`).test(r.out), 'a code for Sam, for 30 days: it checks out with the public key, and it says how to take it back', r.out)
  r = codes(['--check', made], { BRIDGE_EARLY_ACCESS_KEY: pub })
  ok(r.status === 0 && /For Sam \(id [0-9a-f]{8}\)/.test(r.out) && /It checks out/.test(r.out), '--check: who it\'s for, and that it checks out', r.out)
  r = codes(['Sam'], { BRIDGE_EARLY_ACCESS_KEY: ea.publicOf(crypto.generateKeyPairSync('ed25519').privateKey) })
  ok(r.status !== 0 && /isn't the one server\/earlyaccess\.js has/.test(r.out) && !/^ea1\./m.test(r.out), 'with a key that isn\'t the one built in: no code, so none is sent that wouldn\'t work', r.out)
  r = codes(['Kim'], { BRIDGE_EARLY_ACCESS_KEY: '' })
  ok(r.status === 0 && /^ea1\./m.test(r.out) && /No build takes it yet/.test(r.out), 'before any build has the key: the code, and that no build takes it yet', r.out)
  r = codes(['sam@example.com'], { BRIDGE_EARLY_ACCESS_KEY: pub })
  ok(r.status !== 0 && /can't be a code's name/.test(r.out), 'an email as the name: refused', r.out)
  r = codes(['--revoke', c.id], gh)
  ok(r.status === 0 && same(ro.revokedIn(notesOf('v99.1.0')), [c.id]) && /REVOKED in server\/earlyaccess\.js/.test(r.out), '--revoke: written in the newest release\'s notes, for computers on Early Access to read, and how to make it for good', r.out)
  fs.rmSync(dir, { recursive: true, force: true })
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
let ghc = null // and its list of releases, for the channels
try {
  const old = await kitOn('mac13', '13.6')
  const u = await old.api('/updates?refresh=1')
  ok(u.latest === '99.0.0' && u.available === false && u.held?.macos === '14' && u.held?.have === '13.6', 'a Mac on 13.6: 99.0.0 isn\'t offered, and the answer says it needs macOS 14', u)
  ok(u.latest === '99.0.0' && !/<!--/.test(u.notes || '') && /The Mac app needs macOS 14 or later\. Checksums/.test(u.notes || ''), 'the notes shown leave out the line GitHub hides', (u.notes || '').slice(-200))
  ok(!/a star on GitHub/.test(u.notes || '') && /Checksums \(SHA-256\) are in `SHA256SUMS\.txt`\.$/.test(u.notes || ''), 'and the star line, which is for GitHub\'s page, not the app\'s update notes', (u.notes || '').slice(-200))
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
    const star = p.locator('.st-body a', { hasText: 'Star Bridge AI on GitHub' })
    ok(await star.count() === 1 && await star.getAttribute('href') === 'https://github.com/sahil1/bridge' && await star.getAttribute('target') === '_blank', 'About & Updates: one plain link to star Bridge AI on GitHub')
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

  // ---------- Channels: the server ----------
  // GitHub stood in for with a list of releases (newest first) and its latest (the newest that isn't
  // a pre-release or a draft), and the owner's key a pair made here, its public half given to the
  // servers as the one built in (BRIDGE_EARLY_ACCESS_KEY). The desktop app on a Mac (BRIDGE_INSTALL_HOW).
  {
    const { privateKey: owner } = crypto.generateKeyPairSync('ed25519')
    const KEY = ea.publicOf(owner)
    const codeFor = (label, o = {}) => ea.makeCode({ label, privateKey: owner, ...o })
    const rel2 = (tag, o = {}) => ({ tag_name: tag, html_url: `https://github.com/sahil1/bridge/releases/tag/${tag}`, body: `${body}${o.rollout != null ? `\n<!-- rollout: ${o.rollout} -->\n` : ''}${o.revoked ? `\n<!-- revoked: ${o.revoked} -->\n` : ''}`, published_at: new Date(Date.now() - (o.age ?? 30) * HOUR).toISOString(), prerelease: !!o.pre, draft: !!o.draft })
    const hub = { list: [] }
    ghc = http.createServer((req, res) => {
      const at = new URL(req.url, 'http://x').pathname
      const out = at.endsWith('/releases/latest') ? hub.list.find((x) => !x.prerelease && !x.draft) : at.endsWith('/releases') ? hub.list : null
      res.writeHead(out ? 200 : 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(out || { message: 'Not Found' }))
    })
    const ghcPort = await freePort()
    await new Promise((r) => ghc.listen(ghcPort, '127.0.0.1', r))
    const chKit = async (name, { how = 'app', bucket, key = KEY, setUp = true } = {}) => {
      const k = await startKit(`updates-${name}`, { env: { BRIDGE_RELEASES_API: `http://127.0.0.1:${ghcPort}/repos/sahil1/bridge/releases/latest`, BRIDGE_INSTALL_HOW: how, BRIDGE_EARLY_ACCESS_KEY: key, BRIDGE_MACHINE: JSON.stringify({ platform: 'darwin', arch: 'arm64', os: '14.6', docker: how === 'docker' }) }, config: bucket != null ? { updates: { bucket } } : {} })
      kits.push(k)
      if (setUp) await k.api('/setup', { name: 'Tester' })
      return k
    }
    const refused = (p) => p.then((x) => ({ ok: true, x }), (e) => ({ error: e.message }))

    // A staged release on Stable: 99.0.0 out to 10%, this computer in bucket 37.
    hub.list = [rel2('v99.0.0', { rollout: 10 }), rel2('v98.0.0')]
    const st = await chKit('rollout', { bucket: 37 })
    let u = await st.api('/updates')
    ok(u.latest === '99.0.0' && u.rollout === 10 && u.bucket === 37 && u.available === false && u.channel === 'stable', 'Stable, 99.0.0 out to 10%: a computer in bucket 37 isn\'t offered it yet', u)
    let v = await st.api('/updates/auto')
    ok(same(v.why, ['none']) && v.release === false, 'and doesn\'t update to it by itself', v)
    u = await st.api('/updates?refresh=1')
    ok(u.available === true, 'Check now (asked by hand): offered all the same', u)
    ok((await st.api('/updates')).available === true, 'and still offered after, without asking again')
    await st.restart()
    ok((await st.api('/updates')).available === false, 'Bridge AI opened again: not offered until asked again')
    hub.list[0] = rel2('v99.0.0', { rollout: 50 })
    await st.restart()
    ok((await st.api('/updates')).available === true, 'raised to 50%: bucket 37 is offered it, without asking')
    hub.list[0] = rel2('v99.0.0', { rollout: 0 })
    u = await st.api('/updates?refresh=1')
    let e = await refused(st.api('/updates/install', {}))
    ok(u.available === false && u.rollout === 0 && /99\.0\.0 is paused for now/.test(e.error || ''), 'paused (0): not offered, not even asked for by hand, and Update refuses it', { u, e })
    hub.list[0] = rel2('v99.0.0')
    u = await st.api('/updates?refresh=1')
    ok(u.available === true && u.rollout === null, 'no rollout line (everyone): offered', u)
    hub.list[0] = rel2('v99.0.0', { rollout: 10 })
    await st.api('/settings', { updates: { bucket: 5 } }, 'PATCH')
    await st.restart()
    ok((await st.api('/updates')).available === true, 'at 10%, a computer in bucket 5 is offered it')

    // Early Access, on a computer in bucket 80: GitHub has a paused beta, a draft, two betas, the
    // release at 10% and one before.
    const sam = codeFor('Sam', { days: 30 })
    const samId = ea.readCode(sam, { key: KEY }).id
    const lee = codeFor('Lee')
    const leeId = ea.readCode(lee, { key: KEY }).id
    const LIST = () => [rel2('v99.3.0-beta.1', { pre: true, rollout: 0 }), rel2('v99.2.0', { draft: true }), rel2('v99.1.0-beta.2', { pre: true }), rel2('v99.1.0-beta.1', { pre: true, age: 60 }), rel2('v99.0.0', { rollout: 10 }), rel2('v98.0.0', { revoked: leeId })]
    hub.list = LIST()
    const ek = await chKit('early', { bucket: 80 })
    u = await ek.api('/updates')
    ok(u.channel === 'stable' && u.early?.offered === true && u.early.on === false && u.latest === '99.0.0' && u.available === false, 'before a code: Stable (GitHub\'s latest release, never a pre-release), with Early Access there to join', u)
    const { privateKey: someone } = crypto.generateKeyPairSync('ed25519')
    const [, part, sig] = sam.split('.')
    const WRONG = [
      ['that isn\'t a code', 'let me in', /isn't a whole early-access code/],
      ['cut short', sam.slice(0, 70), /isn't a whole early-access code/],
      ['made with another key', ea.makeCode({ label: 'Sam', privateKey: someone }), /doesn't check out/],
      ['changed on the way', `ea1.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(part, 'base64url').toString('utf8')), for: 'Max' })).toString('base64url')}.${sig}`, /doesn't check out/],
      ['that ended', codeFor('Kim', { days: 1, now: Date.now() - 3 * 24 * HOUR }), /That code, for Kim, ended on/],
      ['taken back in a release\'s notes', lee, /That code, for Lee, was taken back/],
    ]
    for (const [what, code, why] of WRONG) {
      e = await refused(ek.api('/updates/early', { code }))
      const kept = (await ek.api('/settings')).user.earlyAccess
      ok(why.test(e.error || '') && !kept && (await ek.api('/updates')).channel === 'stable', `a code ${what}: refused, saying why, and nothing kept`, { e, kept })
    }
    u = await ek.api('/updates/early', { code: sam })
    ok(u.channel === 'early' && u.early?.on === true && u.early.for === 'Sam' && u.early.id === samId && u.latest === '99.1.0-beta.2' && u.available === true && u.prerelease === true, 'Sam\'s code: Early Access, offered the newest pre-release (99.1.0-beta.2), not the draft (99.2.0) or the paused beta (99.3.0-beta.1)', u)
    ok(Math.abs(Date.parse(u.early.until) - Date.now() - 30 * 24 * HOUR) < 60000 && (await ek.api('/settings')).user.earlyAccess?.code === sam, 'it says when the code ends, and it\'s kept in the settings', u.early)
    v = await ek.api('/updates/auto')
    ok(v.release === true && !v.why.includes('prerelease'), 'on Early Access a pre-release goes in by itself too, once it\'s been out 4 hours', v)
    let pv = (await ek.api('/counts/preview')).report
    ok(pv.channel === 'early' && pv.tester === 'Sam' && pv.rollout === 80 && pv.app === current, 'what the usage stats say: Early Access, for Sam, in bucket 80, with the version', { channel: pv.channel, tester: pv.tester, rollout: pv.rollout })
    // Taken back in a release's notes after joining: Stable again, saying why.
    hub.list[5] = rel2('v98.0.0', { revoked: `${leeId} ${samId}` })
    u = await ek.api('/updates?refresh=1')
    ok(u.channel === 'stable' && u.early.on === false && u.early.problem === 'revoked' && u.latest === '99.0.0' && !u.prerelease, 'Sam\'s code taken back in a release\'s notes: back on Stable (99.0.0), saying why', u)
    pv = (await ek.api('/counts/preview')).report
    ok(pv.channel === 'stable' && pv.tester === null, 'and the usage stats say Stable, with no tester', { channel: pv.channel, tester: pv.tester })
    hub.list = LIST()
    ok((await ek.api('/updates?refresh=1')).channel === 'early', 'given back: Early Access again')
    // Leaving: Stable, and what's here stays (here 99.x on GitHub is newer; an older one isn't offered).
    u = await ek.api('/updates/early', undefined, 'DELETE')
    ok(u.channel === 'stable' && u.early.on === false && !u.early.problem && !(await ek.api('/settings')).user.earlyAccess, 'Leave Early Access: Stable, the code gone', u)
    hub.list = [rel2('v3.0.0')]
    u = await ek.api('/updates?refresh=1')
    e = await refused(ek.api('/updates/install', {}))
    ok(u.latest === '3.0.0' && u.available === false && /nothing to update to/.test(e.error || ''), `Stable's latest older than this version (${current}): not offered, and Update refuses to go back to it`, { u, e })
    hub.list = LIST()
    // A code that ended while kept.
    await ek.api('/settings', { earlyAccess: { code: codeFor('Kim', { days: 1, now: Date.now() - 3 * 24 * HOUR }) } }, 'PATCH')
    u = await ek.api('/updates?refresh=1')
    ok(u.channel === 'stable' && u.early.problem === 'expired' && u.early.for === 'Kim' && !!u.early.until, 'a kept code that has ended: Stable, saying it ended and when', u.early)
    await ek.api('/updates/early', undefined, 'DELETE')
    // Where Early Access isn't offered: Docker (by its image's tag), a build with no key. On Linux's
    // package, the command shown installs the pre-release by its tag.
    const dk = await chKit('early-docker', { how: 'docker' })
    u = await dk.api('/updates')
    e = await refused(dk.api('/updates/early', { code: sam }))
    ok(u.early?.offered === false && /Early Access is for the desktop app\. Bridge AI in Docker/.test(e.error || ''), 'Docker: not offered, and a code says why', { early: u.early, e })
    ok(Number.isInteger(u.bucket) && u.bucket >= 0 && u.bucket < 100 && (await dk.api('/settings')).user.updates?.bucket === u.bucket, 'a computer\'s bucket: picked at random the first time, and kept in its settings', u.bucket)
    await dk.restart()
    ok((await dk.api('/updates')).bucket === u.bucket, 'the same after Bridge AI opens again')
    const nk = await chKit('early-nokey', { key: '' })
    u = await nk.api('/updates')
    e = await refused(nk.api('/updates/early', { code: sam }))
    ok(u.early?.offered === false && /doesn't take early-access codes/.test(e.error || ''), 'a build with no key: Early Access not offered, and a code says so', { early: u.early, e })
    const lk = await chKit('early-linux', { how: 'app-linux' })
    u = await lk.api('/updates/early', { code: sam })
    ok(u.channel === 'early' && u.available && /install\.sh \| BRIDGE_VERSION=v99\.1\.0-beta\.2 sh$/.test(u.command || ''), 'Linux\'s package on Early Access: the command shown installs 99.1.0-beta.2 by its tag', u.command)

    // ---------- Channels: the page ----------
    // About & Updates in the desktop app: the quiet link, a wrong and an ended code saying why, Sam's
    // code (light, dark, a phone), leaving; a link with ?early= filling it in; a code that ended; and
    // where it can't work, no link at all. A staged release: Up to date, until Check now.
    const early = (p) => p.locator('.st-sec.ab-early')
    const join = async (p, code) => {
      await early(p).locator('input').fill(code)
      await early(p).locator('button', { hasText: 'Join' }).click()
    }
    const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.ab-early *')].every((x) => x.getBoundingClientRect().right <= window.innerWidth + 1))
    {
      const { ctx, p, errors } = await page(b, ek.url, { mode: 'light', theme: 'sky', before: desktop })
      await about(p)
      const ask = p.locator('.ab-early-ask button')
      ok(!!(await until(async () => (await ask.innerText().catch(() => '')) === 'Have an early-access code?', 10000)) && await early(p).count() === 0, 'About & Updates: only a quiet "Have an early-access code?"')
      await p.waitForTimeout(400) // Settings' fade-in
      await shot(p, `${tag}early-access-ask`)
      await ask.click()
      ok(await early(p).locator('h4').innerText().catch(() => '') === 'Early Access', 'it opens Early Access, to paste a code in')
      await join(p, 'let me in')
      const wrong = await until(async () => { const x = await early(p).locator('.ab-early-error').innerText().catch(() => ''); return /isn't a whole early-access code/.test(x) && x }, 8000)
      ok(!!wrong, 'a wrong code says why', wrong)
      await join(p, codeFor('Kim', { days: 1, now: Date.now() - 3 * 24 * HOUR }))
      const kimEnded = new Date(Date.now() - 2 * 24 * HOUR).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
      const ended = await until(async () => { const x = await early(p).locator('.ab-early-error').innerText().catch(() => ''); return x === `That code, for Kim, ended on ${kimEnded}. Ask for a new one.` && x }, 8000)
      ok(!!ended, 'one that ended says when, as the page writes dates', ended || await early(p).locator('.ab-early-error').innerText().catch(() => ''))
      await shot(p, `${tag}early-access-wrong`)
      await join(p, sam)
      const on = await until(async () => { const x = await early(p).innerText().catch(() => ''); return /On for Sam/.test(x) && /gets pre-releases of Bridge AI/.test(x) && /good until/.test(x) && x }, 10000)
      ok(!!on, 'Sam\'s code: on for Sam, getting pre-releases, good until when', on || await early(p).innerText().catch(() => ''))
      ok(!!(await until(async () => /99\.1\.0-beta\.2 is available/.test(await p.locator('.st-body').innerText().catch(() => '')), 8000)), 'and the version line offers 99.1.0-beta.2')
      await shot(p, `${tag}early-access-on`)
      ok(cut(errors).length === 0, 'no page errors', errors)
      await ctx.close()
    }
    for (const [what, o] of [['dark', { mode: 'dark', theme: 'midnight', before: desktop }], ['on a phone', { mode: 'light', theme: 'sky', phone: true }], ['on a phone, dark', { mode: 'dark', theme: 'midnight', phone: true }]]) {
      const { ctx, p, errors } = await page(b, ek.url, o)
      await about(p)
      const shown = await until(async () => /On for Sam/.test(await early(p).innerText().catch(() => '')), 10000)
      await early(p).scrollIntoViewIfNeeded().catch(() => {})
      ok(!!shown && await noOverflow(p), `Early Access ${what}: on for Sam, and nothing wider than the screen`)
      await shot(p, `${tag}early-access-on-${what.replace(/[^a-z]+/g, '-')}`)
      ok(cut(errors).length === 0, `${what}: no page errors`, errors)
      await ctx.close()
    }
    {
      const { ctx, p, errors } = await page(b, ek.url, { mode: 'light', theme: 'sky', before: desktop })
      await about(p)
      await until(async () => /On for Sam/.test(await early(p).innerText().catch(() => '')), 10000)
      await early(p).locator('button', { hasText: 'Leave Early Access' }).click()
      ok(!!(await until(async () => !(await early(p).count()) && await p.locator('.ab-early-ask').count() === 1, 8000)) && (await ek.api('/updates')).channel === 'stable', 'Leave Early Access: Stable again, and back to the quiet link')
      ok(cut(errors).length === 0, 'no page errors', errors)
      await ctx.close()
    }
    {
      // A link with the code in it (?early=), as sent to a tester.
      const { ctx, p, errors } = await page(b, `${ek.url}/?early=${encodeURIComponent(sam)}`, { mode: 'light', theme: 'sky' })
      const filled = await until(async () => (await early(p).locator('input').inputValue().catch(() => '')) === sam, 15000)
      ok(!!filled && !/early=/.test(await p.evaluate(() => location.href)), 'a link with ?early=<code>: About & Updates opens with the code filled in, and it\'s taken off the address', await p.evaluate(() => location.href))
      await early(p).locator('button', { hasText: 'Join' }).click()
      ok(!!(await until(async () => /On for Sam/.test(await early(p).innerText().catch(() => '')), 8000)), 'Join: on for Sam')
      ok(cut(errors).length === 0, 'no page errors', errors)
      await ctx.close()
    }
    {
      // The same link on a cold first load: a computer not set up yet, in a browser just started that
      // has never opened Bridge AI (no tour done, nothing kept). Settings opens more than once as the
      // page settles (setup's steps), and the code is still there, filled in, under setup.
      const fresh = await chKit('early-cold', { setUp: false })
      const kim = codeFor('Kim', { days: 30 })
      // (As a person's browser is: none of the test browser's stand-in microphone flags.)
      const cold = await (await import('playwright-core'))[which].launch()
      const ctx = await cold.newContext({ viewport: { width: 1440, height: 900 } })
      const p = await ctx.newPage()
      await p.goto(`${fresh.url}/?early=${encodeURIComponent(kim)}`)
      const filled = await until(async () => (await early(p).locator('input').inputValue().catch(() => '')) === kim, 15000)
      ok(!!filled && (await p.locator('.wiz').count()) === 1 && !/early=/.test(await p.evaluate(() => location.href)), 'a cold first load from a tester\'s link, before setup: the code kept and filled in, and taken off the address', { filled: !!filled, wizard: await p.locator('.wiz').count(), at: await p.evaluate(() => location.href) })
      await cold.close()
    }
    await ek.api('/settings', { earlyAccess: { code: codeFor('Kim', { days: 1, now: Date.now() - 3 * 24 * HOUR }) } }, 'PATCH')
    await ek.api('/updates?refresh=1')
    {
      const { ctx, p, errors } = await page(b, ek.url, { mode: 'dark', theme: 'midnight', before: desktop })
      await about(p)
      const said = await until(async () => { const x = await early(p).locator('.ab-early-problem').innerText().catch(() => ''); return /The early-access code for Kim ended on .+, so this computer is back on regular releases\./.test(x) && x }, 10000)
      ok(!!said && await early(p).locator('input').count() === 1 && await early(p).locator('button', { hasText: 'Remove the code' }).count() === 1, 'a code that ended: said, with a place for a new one and Remove the code', said || await early(p).innerText().catch(() => ''))
      await shot(p, `${tag}early-access-ended`)
      ok(cut(errors).length === 0, 'no page errors', errors)
      await ctx.close()
    }
    for (const [what, url] of [['a build with no key', nk.url], ['Docker', dk.url], ['from source', newer.url]]) {
      const { ctx, p } = await page(b, url, { mode: 'light', theme: 'sky', before: desktop })
      await about(p)
      const shown = await until(async () => /Check for new versions/.test(await p.locator('.modal.settings').innerText().catch(() => '')), 10000)
      ok(!!shown && await p.locator('.ab-early-ask').count() === 0 && await early(p).count() === 0, `${what}: no early-access link`)
      await ctx.close()
    }
    {
      // A tester's link opened on a build with no key: nothing about Early Access, the code dropped.
      const { ctx, p } = await page(b, `${nk.url}/?early=${encodeURIComponent(codeFor('Sam'))}`, { mode: 'light', theme: 'sky', before: desktop })
      const shown = await until(async () => /Check for new versions/.test(await p.locator('.modal.settings').innerText().catch(() => '')), 10000)
      await p.waitForTimeout(1000)
      const text = await p.locator('.modal.settings').innerText().catch(() => '')
      ok(!!shown && await early(p).count() === 0 && !/early-access|Early Access/i.test(text) && !/early=/.test(await p.evaluate(() => location.href)), 'a build with no key, opened from a tester\'s ?early= link: nothing about Early Access shows, and the code is taken off the address', text.slice(0, 400))
      await ctx.close()
    }
    {
      // The staged release, in a computer outside it: Up to date, until a person checks.
      hub.list = [rel2('v99.0.0', { rollout: 10 })]
      await st.api('/settings', { updates: { bucket: 37 } }, 'PATCH')
      await st.restart()
      const { ctx, p, errors } = await page(b, st.url, { mode: 'light', theme: 'sky', before: desktop })
      await about(p)
      const row = p.locator('.st-sec').first().locator('.st-row').first()
      ok(!!(await until(async () => /Up to date/.test(await row.innerText().catch(() => '')), 10000)) && await p.locator('.topbar .update-chip').count() === 0, 'a release out to 10%, this computer not in it: Up to date, and no Update in the top bar')
      await p.locator('.st-body button', { hasText: 'Check now' }).click()
      ok(!!(await until(async () => /99\.0\.0 is available/.test(await row.innerText().catch(() => '')), 8000)) && await p.locator('.st-body button', { hasText: 'Update to 99.0.0' }).count() === 1, 'Check now: 99.0.0 is available, with Update', await row.innerText().catch(() => ''))
      await shot(p, `${tag}early-access-staged-checked`)
      ok(cut(errors).length === 0, 'no page errors', errors)
      await ctx.close()
    }
  }
} finally {
  for (const k of kits) k.stop()
  srv.close()
  gh?.close()
  ghc?.close()
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
