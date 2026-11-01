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

// ---------- The server, with GitHub's releases stood in for ----------
const body = `${notes}`
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
} finally {
  for (const k of kits) k.stop()
  srv.close()
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
