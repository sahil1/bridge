// Nightly builds of main, for the owner's own computers (scripts/nightly.js, nightly.yml, the
// Nightly channel in server/updates.js). The version: what main is heading for, the day and the run,
// after that version's betas and before its release candidates and the version itself, and never a
// version Stable or Early Access take. The script: the version for main as it is, stamped into both
// package.json files (nothing else in them changed), notes with the changes since the last nightly
// and the macOS line the update check reads, and the nightlies to delete past the newest 7. The
// workflows: nightly.yml builds main through release.yml, which publishes it as a pre-release, never
// GitHub's latest, and leaves the Android app, the regular Publish and the tag check alone. The
// rules: Stable and Early Access are never offered a nightly; Nightly is offered the newest of
// everything at once, a staged release too, and moves on to the release when it's out; it updates
// by itself like Early Access. A server in the desktop app on a Mac (stood in for), with GitHub's
// releases a stand-in: Nightly switched on from the computer itself, never through the relay; on,
// it's offered the nightly; Docker and a clone are told why not; Leave Nightly goes back to Stable,
// the version here kept. The page: About & Updates shows Nightly only once it's on, with Leave
// Nightly, and the early-access link not at all then.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { checks, startKit, freePort, browser, page, until, ROOT, OUT } from '../lib/harness.mjs'

const { ok, done } = checks('nightly')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const ver = await import('../../shared/version.js')
const nj = await import('../../scripts/nightly.js')
const au = await import('../../shared/autoupdate.js')
const counts = await import('../../counts/worker.js')
process.env.BRIDGE_HOME = path.join(OUT, 'kits', `nightly-unit-${process.pid}`)
const up = await import('../../server/updates.js')

// ---------- the version ----------
const N = '3.20.1-nightly.20261116.57'
ok(ver.NIGHTLY_VERSION.test(N) && ver.isNightly(`v${N}`) && ver.isPre(N), 'a nightly\'s version: 3.20.1-nightly.20261116.57, a pre-release')
ok(!ver.RELEASE_VERSION.test(N), 'and not one Bridge AI is released as, so npm run release, Stable and Early Access never take one')
ok(ver.newer(N, '3.20.0') && ver.newer('3.20.1', N) && ver.newer(N, '3.20.1-beta.2') && ver.newer('3.20.1-rc.1', N), 'after 3.20.0 and 3.20.1\'s betas, before its release candidates and 3.20.1 itself')
ok(ver.newer('3.20.1-nightly.20261117.1', N) && ver.newer('3.20.1-nightly.20261116.58', N), 'the next day\'s, or the next run\'s, is newer')

// ---------- the script ----------
ok(nj.nextOf('3.20.0', ['v3.19.0', 'v3.20.0']) === '3.20.1', 'main on 3.20.0, released: the nightly is of 3.20.1')
ok(nj.nextOf('3.21.0', ['v3.20.0']) === '3.21.0', 'main on 3.21.0, being prepared and not released: of 3.21.0, so the release passes it')
ok(nj.nextOf('3.21.0-beta.2', ['v3.21.0-beta.2']) === '3.21.0', 'main on a beta: of the version it\'s a beta of')
ok(nj.nightlyOf('3.20.0', ['v3.20.0'], { date: '20261116', run: '57' }) === N && /^\d{8}$/.test(nj.today()), 'with the day and the run: 3.20.1-nightly.20261116.57')
const tags = ['v3.20.0', 'v3.20.1-nightly.20261110.1', 'v3.20.1-nightly.20261111.2', 'v3.21.0-beta.1', 'v3.20.1-nightly.20261112.3', 'v3.21.0-nightly.20261120.9']
ok(same(nj.older(tags, 2), ['v3.20.1-nightly.20261111.2', 'v3.20.1-nightly.20261110.1']), 'to delete: the nightlies past the newest two, never a release or a beta', nj.older(tags, 2))
const pkg = '{\n  "name": "bridge-ai",\n  "version": "3.20.0",\n  "dependencies": {\n    "x": "1.0.0"\n  }\n}\n'
const st = nj.stamped(pkg, N)
ok(st === pkg.replace('"version": "3.20.0"', `"version": "${N}"`), 'stamped: the version changed where it stands, the rest of package.json as it was', st)
const notes = nj.notesFor({ version: N, sha: 'abcdef1234567', since: '3.20.0', changes: ['A fix', 'A feature'], mac: '14.0' })
ok(/^A nightly build of main at abcdef1/.test(notes) && /offers it only to computers on Nightly/.test(notes) && /## Since 3\.20\.0\n\n- A fix\n- A feature/.test(notes) && up.minMacOf(notes) === '14.0', 'its notes: what it is, the changes since the last one, and the macOS line the update check reads', notes)
const many = nj.notesFor({ version: N, sha: 'abcdef1234567', since: '3.20.0', changes: Array.from({ length: 75 }, (_, i) => `Change ${i}`), mac: '14.0' })
ok((many.match(/^- Change/gm) || []).length === 60 && /…and 15 more/.test(many), 'at most 60 changes listed, and how many more')

// ---------- the workflows ----------
const yml = (f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8')
const nightlyYml = yml('nightly.yml')
const releaseYml = yml('release.yml')
ok(/schedule:\s*\n\s*- cron: '17 10 \* \* \*'/.test(nightlyYml) && /workflow_dispatch:/.test(nightlyYml) && /node scripts\/nightly\.js changed/.test(nightlyYml) && /uses: \.\/\.github\/workflows\/release\.yml/.test(nightlyYml) && /nightly: \$\{\{ needs\.plan\.outputs\.version \}\}/.test(nightlyYml), 'nightly.yml: each night (or by hand), when main changed, builds main through release.yml at the nightly version')
ok(/refs\/heads\/main/.test(nightlyYml) && /secrets: inherit/.test(nightlyYml), 'from main only, with the signing secrets (the Mac app signed and notarized like a release)')
ok(/workflow_call:\s*\n\s*inputs:\s*\n\s*nightly:/.test(releaseYml) && /node scripts\/nightly\.js stamp "\$NIGHTLY"/.test(releaseYml) && /node scripts\/nightly\.js notes "\$NIGHTLY" notes\.md/.test(releaseYml), 'release.yml takes it: the version stamped in the build only, and its own notes')
ok(/gh release create "v\$NIGHTLY" --target "\$GITHUB_SHA" [^\n]*--prerelease --latest=false/.test(releaseYml) && /nightly\.js older 7/.test(releaseYml) && /--cleanup-tag/.test(releaseYml), 'published as a pre-release, never GitHub\'s latest, and only the newest 7 kept')
ok(/name: Publish\n\s*if: \$\{\{ !inputs\.nightly \}\}/.test(releaseYml) && /android:\n\s*name: Android\n\s*needs: test\n\s*if: \$\{\{ !inputs\.nightly \}\}/.test(releaseYml) && /if: startsWith\(github\.ref, 'refs\/tags\/v'\)\n\s*run: \|\n\s*git fetch --no-tags origin main/.test(releaseYml), 'and the regular Publish, the Android app and the tag check are as before, left out of a nightly')
ok(/merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/.test(releaseYml.split('A nightly is of main')[1] || ''), 'a nightly is checked to be of main too')

// ---------- the rules ----------
const R = (tag, o = {}) => ({ tag_name: tag, prerelease: !!o.pre, draft: false, body: `Notes\n${o.rollout != null ? `<!-- rollout: ${o.rollout} -->\n` : ''}` })
const LIST = [R(`v${N}`, { pre: true }), R('v3.21.0-beta.1', { pre: true }), R('v3.20.0'), R('v3.20.1-nightly.20261115.50', { pre: true })]
ok(up.newestOf(LIST)?.tag_name === 'v3.20.0' && up.newestOf(LIST, { early: true })?.tag_name === 'v3.21.0-beta.1', 'Stable is never offered a nightly, nor Early Access', [up.newestOf(LIST)?.tag_name, up.newestOf(LIST, { early: true })?.tag_name])
ok(up.newestOf([R(`v${N}`, { pre: true }), R('v3.20.0')], { nightly: true })?.tag_name === `v${N}`, 'Nightly: the newest nightly')
ok(up.newestOf([R(`v${N}`, { pre: true }), R('v3.20.1')], { nightly: true })?.tag_name === 'v3.20.1', 'and the release once it\'s out, which is newer')
ok(up.offered({ current: '3.20.0', latest: N, channel: 'nightly' }) && up.offered({ current: N, latest: '3.20.1', channel: 'nightly', bucket: 80, rollout: 10 }) && !up.offered({ current: N, latest: '3.20.0', channel: 'nightly' }), 'offered at once on Nightly, a staged release too, and never an older version')
const NOW = Date.parse('2026-11-16T15:00:00Z')
const pre = { how: 'app', available: true, latest: N, prerelease: true, publishedAt: new Date(NOW - 5 * 3600e3).toISOString() }
ok(same(au.releaseWhy({ u: { ...pre, channel: 'nightly' }, now: NOW }), []) && same(au.releaseWhy({ u: { ...pre, channel: 'stable' }, now: NOW }), ['prerelease']), 'by itself while you\'re away: on Nightly a nightly goes in; on Stable it never would')
ok(counts.channelOf({ channel: 'nightly' }).channel === 'nightly' && counts.channelOf({ channel: 'weird' }).channel === 'other', 'the stats server keeps Nightly apart')

// ---------- a server ----------
const hub = { list: [] }
const rel = (tag, o = {}) => ({ tag_name: tag, html_url: `https://github.com/sahil1/bridge/releases/tag/${tag}`, prerelease: !!o.pre, draft: false, body: 'Notes\n\n<!-- macOS 14.0 or later -->\n', published_at: new Date(Date.now() - 8 * 3600e3).toISOString() })
const gh = http.createServer((req, res) => {
  const at = new URL(req.url, 'http://x').pathname
  const out = at.endsWith('/releases/latest') ? hub.list.find((x) => !x.prerelease) : at.endsWith('/releases') ? hub.list : null
  res.writeHead(out ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(out || { message: 'Not Found' }))
})
const ghPort = await freePort()
await new Promise((r) => gh.listen(ghPort, '127.0.0.1', r))
const kits = []
const kitAs = async (name, how) => {
  const k = await startKit(`nightly-${name}`, { env: { BRIDGE_RELEASES_API: `http://127.0.0.1:${ghPort}/repos/sahil1/bridge/releases/latest`, BRIDGE_INSTALL_HOW: how, BRIDGE_MACHINE: JSON.stringify({ platform: 'darwin', arch: 'arm64', os: '15.5', docker: false }) } })
  kits.push(k)
  await k.api('/setup', { name: 'Tester' })
  return k
}
const refused = (p) => p.then((x) => ({ ok: true, x }), (e) => ({ error: e.message, status: e.status }))
let b = null
try {
  hub.list = [rel('v99.1.0-nightly.20261116.7', { pre: true }), rel('v99.0.0')]
  const k = await kitAs('app', 'app')
  let u = await k.api('/updates?refresh=1')
  ok(u.channel === 'stable' && u.latest === '99.0.0' && u.nightly?.on === false, 'Stable to start with: offered the release, not the nightly', u)
  const relayed = await refused(fetch(`${k.url}/api/updates/nightly`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-relay': '1' }, body: '{}' }).then(async (r) => { if (!r.ok) throw Object.assign(new Error((await r.json()).error), { status: r.status }); return r.json() }))
  ok(relayed.status >= 400 && /on the computer itself/.test(relayed.error || '') && (await k.api('/updates')).channel === 'stable', 'Nightly can\'t be switched on through the relay (a phone, another computer)', relayed)
  u = await k.api('/updates/nightly', {})
  ok(u.channel === 'nightly' && u.nightly?.on === true && u.latest === '99.1.0-nightly.20261116.7' && u.available === true && u.prerelease === true, 'switched on from the computer itself: on Nightly, offered the nightly', u)
  ok(JSON.parse(fs.readFileSync(path.join(k.data, 'config.json'), 'utf8')).updates?.nightly === true, 'kept in the settings (updates.nightly)')
  const v = await k.api('/updates/auto')
  ok(!v.why.includes('prerelease'), 'and it goes in by itself while you\'re away, as Early Access\'s do', v)

  // The page: About & Updates with Nightly on.
  ;({ b } = await browser())
  const { p } = await page(b, k.url)
  await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
  const sec = p.locator('.ab-nightly')
  const shown = await until(async () => /Nightly/.test(await sec.innerText().catch(() => '')) && /a build of main each morning/.test(await sec.innerText()), 10000)
  ok(!!shown && await sec.locator('button', { hasText: 'Leave Nightly' }).count() === 1 && await p.locator('.ab-early-ask').count() === 0, 'About & Updates: Nightly, on, with Leave Nightly, and no early-access link', await p.locator('.st-body').innerText().catch(() => ''))
  ok(/99\.1\.0-nightly\.20261116\.7 is available/.test(await p.locator('.st-body').innerText()), 'and the nightly offered there')
  await sec.locator('button', { hasText: 'Leave Nightly' }).click()
  ok(!!(await until(async () => (await sec.count()) === 0, 10000)), 'Leave Nightly: the section goes')
  u = await k.api('/updates')
  ok(u.channel === 'stable' && u.nightly?.on === false && u.latest === '99.0.0', 'back on Stable, offered the release again', u)
  await p.close()

  // Docker and a clone: told why not.
  const d = await kitAs('docker', 'docker')
  const e1 = await refused(d.api('/updates/nightly', {}))
  ok(/Docker updates by its image's tag/.test(e1.error || ''), 'in Docker: refused, saying why', e1)
  const s = await kitAs('source', 'source')
  const e2 = await refused(s.api('/updates/nightly', {}))
  ok(/from a clone updates with git pull/.test(e2.error || ''), 'from a clone: refused, saying why', e2)
  // Switched on by hand in the settings where it can't work: Stable, and About & Updates says why.
  await s.api('/settings', { updates: { nightly: true } }, 'PATCH')
  u = await s.api('/updates?refresh=1')
  ok(u.channel === 'stable' && u.nightly?.on === false && u.nightly?.problem === 'source' && u.latest === '99.0.0', 'set in a clone\'s settings anyway: still Stable, and why', u)
} finally {
  await b?.close().catch(() => {})
  for (const k of kits) k.stop()
  gh.close()
}

process.exit(done().fail ? 1 : 0)
