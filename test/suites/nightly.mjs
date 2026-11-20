// Nightly builds of main, for anyone who picks them (scripts/nightly.js, nightly.yml, the Nightly
// channel in server/updates.js). The version: what main is heading for, the day and the run,
// after that version's betas and before its release candidates and the version itself, and never a
// version Stable or Early Access take. The script: the version for main as it is, stamped into both
// package.json files (nothing else in them changed), notes with the changes since the last nightly
// and the macOS line the update check reads, and the nightlies to delete past the newest 7. The
// notes, from a nightly's commits with their files (test/fixtures/nightly-commits.json): only what
// a person using Bridge AI would notice (no commit that only touches the tests, CI or the docs, nor
// one said to be about them, a merge, the revert of one, or a commit taken back in the same
// nightly), a line for each part of Bridge AI (the words before a subject's colon, however it's
// said), its first line short and at most 3 under it, Fixes last, at most 8 lines, the commit it was
// built from in a line GitHub hides, and a plain first line; a revert's own revert (Reapply "…")
// left out too. And first from the pull requests merged since the last nightly
// (test/fixtures/nightly-pulls.json: main's merges, their commits, and the pull requests' titles,
// bodies and files): an integration pull request by the lines its body lists (#252, #255, #257), not
// its title; a feature pull request by its title; one about the tests or CI left out by its title or
// files; one titled with its branch by its commits; a commit made on main as it is; each pull
// request once; and the commits again when there's no pull request or GitHub can't say. The
// workflows: nightly.yml builds main through release.yml, which publishes it as a pre-release, never
// GitHub's latest, and leaves the Android app, the regular Publish and the tag check alone. The
// rules: Stable and Early Access are never offered a nightly; Nightly is offered the newest of
// everything at once, a staged release too, and moves on to the release when it's out; it updates
// by itself like Early Access. A server in the desktop app on a Mac (stood in for), with GitHub's
// releases a stand-in: Nightly switched on from the computer itself, never through the relay (nor
// off); on, it's offered the nightly; Docker and a clone are told why not; Stable picked goes back
// to Stable, the version here kept. The page: About & Updates' Update Channel with Nightly picked,
// the nightly offered, and Stable picked there.
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
const { shown } = await import('../../shared/rollout.js')

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

// ---------- the notes ----------
const COMMITS = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'nightly-commits.json'), 'utf8'))
const notes = nj.notesFor({ version: N, sha: 'abcdef1234567', since: '3.20.1-nightly.20261115.56', changes: COMMITS, mac: '14.0' })
const listed = notes.split('\n\nOnly computers')[0]
const bullets = notes.split('\n').filter((l) => /^- /.test(l))
const under = notes.split('\n').filter((l) => /^ {2}- /.test(l))
ok(notes.startsWith('Nightly build of 16 November 2026, for trying what\'s next.\n\n## Since 3.20.1-nightly.20261115.56\n\n- **') && !/nightly build of main|abcdef1/i.test(listed), 'its notes start plainly: the day it was built and since which nightly, no commit named', notes)
ok(/^<!-- main at abcdef1 -->$/m.test(notes) && !/abcdef1/.test(shown(notes)) && up.minMacOf(notes) === '14.0' && /Only computers on the Nightly update channel are offered it\. The Mac app needs macOS 14 or later\. Checksums \(SHA-256\) are in `SHA256SUMS\.txt`\./.test(notes), 'the commit it was built from in a line GitHub hides; who\'s offered it, and the macOS line the update check reads', notes.slice(-300))
ok(!/\b(Tests?|CI|Docs|Merge|Revert)\b|\.mjs|\.md\b|~\\|phone-parity|remote-screen|README|pull request/.test(listed), 'nothing of the tests, CI, the docs, a merge or a merge taken back; no file or test named', listed)
const labels = bullets.map((l) => l.match(/^- \*\*(.+?):\*\* \S/)?.[1])
ok(labels.every(Boolean) && same(labels, ['Bots', 'Which Devices May Connect', 'Meetings', 'Back Up & Move', 'Phone', 'Fixes']), 'a line for each part of Bridge AI, "- **Label:** …", the busiest first and Fixes last', labels)
ok(!/covers everything|per use case|files bots make/i.test(notes) && /^- \*\*Which Devices May Connect:\*\* An unticked device can't use that computer at all\.$/m.test(notes), 'a part said another way is that part ("Which Devices May Connect covers everything", "Bots per use case", "Back Up & Move, and files bots make"), saying what changed', bullets)
ok(/^- \*\*Bots:\*\* A run at its time limit asks you whether it may carry on, instead of failing\.$/m.test(notes) && bullets.every((l) => l.replace(/^- \*\*.+?:\*\* /, '').length <= 90), 'each part\'s first line short and standing on its own', bullets)
ok(under.length > 0 && under.every((l) => /^ {2}- [A-Z].*\.$/.test(l)) && notes.split(/\n(?=- )/).every((g) => (g.match(/^ {2}- /gm) || []).length <= 3), 'the rest under it, at most 3, each a sentence', under)
ok(/^- \*\*Fixes:\*\* Studio's sheet keeps its column widths after a reload\.$/m.test(notes), 'Fixes: what was fixed', bullets)
ok(nj.seen({ subject: 'Bots: a stand-in that answers slower', files: ['test/stand-ins/slack.mjs', 'test/suites/slack-bot.mjs'] }) === false && nj.seen({ subject: 'Bots: answers in threads', files: ['server/bots.js', 'test/suites/slack-bot.mjs'] }) === true && nj.seen({ subject: 'Bots in the release notes', files: ['CHANGELOG.md', 'scripts/release.js', '.github/workflows/release.yml'] }) === false, 'told by its files too: a commit only touching the tests, CI, the docs and the release scripts is left out, whatever its subject says')
const back = nj.grouped([{ subject: 'Revert "Bots: answer in DMs"', files: ['server/bots.js'] }, { subject: 'Bots: answer in DMs', files: ['server/bots.js'] }, { subject: 'Meetings: a title for each one', files: ['server/meetings.js'] }])
ok(same(back.map((g) => g.label), ['Meetings']), 'a commit and its revert in the same nightly: neither listed', back)
const parts = ['Bots', 'Meetings', 'Studio', 'Phone', 'Settings', 'Share Links', 'Remote Screen', 'Calendar', 'Mail', 'Chat', 'Tabs', 'Relays']
const wide = nj.notesFor({ version: N, sha: 'abcdef1234567', since: '3.20.0', mac: '14.0', changes: [...parts.map((p, i) => ({ subject: `${p}: change number ${i} that people see here`, files: ['src/App.jsx'] })), { subject: 'Fix: a sheet keeps its widths', files: ['src/components/studio/xlsx.js'] }] })
const wideBullets = wide.split('\n').filter((l) => /^- /.test(l))
ok(wideBullets.length === nj.MAX_GROUPS && /^- \*\*Fixes:\*\*/.test(wideBullets.at(-1)) && /^- Smaller changes to [^\n]+ and Bots\.$/.test(wideBullets.at(-2)), `at most ${nj.MAX_GROUPS} lines: past that, the parts left named in one, and Fixes always listed`, wideBullets)
const quiet = nj.notesFor({ version: N, sha: 'abcdef1234567', since: '3.20.0', mac: '14.0', changes: COMMITS.filter((c) => /^(Tests|CI|Docs):/.test(c.subject)) })
ok(/^- Nothing you'd notice: only the tests and how Bridge AI is built changed\.$/m.test(quiet) && /^- Nothing new: built again\.$/m.test(nj.notesFor({ version: N, sha: 'abcdef1234567', since: '3.20.0', mac: '14.0', changes: [] })), 'only tests changed, or nothing at all: said so')
ok(same(nj.grouped(['Bots: answer in threads you started', 'Tests: slack-bot waits longer']).map((g) => g.label), ['Bots']), 'subjects alone (no files known): told by the subject')
const reapplied = nj.grouped([{ subject: 'Reapply "Merge remote-tracking branch \'origin/bots-write\' into nightly-next-3"', files: ['server/botwrite.js', 'server/frontdesk.js'] }, { subject: 'Bots: a file in a bot\'s folders goes with its answer as it is, PDFs and documents too', files: ['server/botattach.js'] }])
ok(same(reapplied.map((g) => g.label), ['Bots']) && !/Reapply|Other/.test(JSON.stringify(reapplied)) && nj.seen({ subject: 'Reapply "Bots: answer in DMs"', files: ['server/bots.js'] }) === false, 'a revert\'s own revert (Reapply "…") left out, as a merge is', reapplied)

// ---------- the notes, from the pull requests ----------
const PULLS = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'nightly-pulls.json'), 'utf8'))
const listedIn258 = nj.listedIn(PULLS.pulls['258'].body)
ok(same(listedIn258.map((x) => x.number), [252, 255, 257, 250, 256]) && listedIn258[0].text.startsWith('Bots that change files: Edits Files') && nj.listedIn('- #246: meetings Merge into one')[0]?.text === 'meetings Merge into one', 'an integration pull request\'s body: the pull requests it lists, a line each ("- #252 …"), never a note in brackets or a line naming none', listedIn258)
const pulled = nj.fromPulls(PULLS.log, PULLS.pulls)
const prNotes = nj.notesFor({ version: '3.21.1-nightly.20261120.18', sha: '281d5eef1234567', since: '3.21.1-nightly.20261119.17', changes: pulled, mac: '14.0' })
const prListed = prNotes.split('\n\nOnly computers')[0]
const prLabels = prNotes.split('\n').filter((l) => /^- /.test(l)).map((l) => l.match(/^- \*\*(.+?):\*\* \S/)?.[1])
ok(same(prLabels, ['Bots', 'Meetings', 'Remote Screen', 'Update card', 'Phone']), 'from the pull requests merged since the last nightly: a line for each part, "- **Label:** …", the busiest first', prNotes)
ok(/^- \*\*Bots:\*\* Edits Files in Its Folders, approvals bound to the exact change, held kinds, Undo\.$/m.test(prNotes) && /^ {2}- Bots attach files from their folders\.$/m.test(prNotes) && /^ {2}- Bot runs load only your own Claude Code settings, never a folder's own\.$/m.test(prNotes), 'an integration pull request: the lines its body lists under their part ("Bots that change files: …", "Bots attach …", "Bot runs …" are all Bots), the first listed first, each cut at a clause', prListed)
ok(!/Next nightly|Combines|#\d|hook|Reapply|Merge|\bTests?\b|\bCI\b|PowerShell|held up|floating card|setting-sources/.test(prListed), 'nothing from its own title, nor its commits\' steps; no pull request\'s number, no flag; a pull request only about the tests or CI left out by its title or its files, merged itself or listed in another', prListed)
ok(/^- \*\*Remote Screen:\*\* Remote Screen starts every time, or says why with the fix\.$/m.test(prNotes), 'a feature pull request: its title to its first clause, under the name in capitals it starts with', prListed)
ok(/^- \*\*Update card:\*\* Nightly notes a person would notice, and a calmer update card\.$/m.test(prNotes), 'a title naming no part: the one part its commits a person would notice name', prListed)
ok(/^- \*\*Meetings:\*\* A title for each one from its calendar event\.$/m.test(prNotes) && /^ {2}- A meeting set by hand/m.test(prNotes) && /^- \*\*Phone:\*\* Scan QR code reads a pairing link from a picture too\.$/m.test(prNotes), 'one titled with its branch\'s name: by its commits; a commit made on main itself: as it is', prListed)
ok(prNotes.startsWith('Nightly build of 20 November 2026, for trying what\'s next.\n\n## Since 3.21.1-nightly.20261119.17\n\n- **Bots:**') && /^<!-- main at 281d5ee -->$/m.test(prNotes) && !/281d5ee/.test(shown(prNotes)) && up.minMacOf(prNotes) === '14.0' && /Only computers on the Nightly update channel are offered it\. The Mac app needs macOS 14 or later\./.test(prNotes), 'its first line, the commit it was built from and the macOS line the update check reads as before', prNotes.slice(-300))
const own255 = { title: 'Bots: a file in a bot\'s folders goes with its answer as it is, PDFs and documents too', branch: 'bots-attach', body: '', files: PULLS.pulls['255'].files }
const once = nj.fromPulls([{ subject: 'Merge pull request #258 from sahil1/nightly-next-4' }, { subject: 'Merge pull request #255 from sahil1/bots-attach' }], { ...PULLS.pulls, 255: own255 })
ok(once.filter((c) => c.pull === 255).length === 1 && once.find((c) => c.pull === 255).subject === own255.title, 'a pull request merged itself, then listed in another: once, by its own title', once)
ok(nj.fromPulls([{ subject: 'Bots: answer in DMs', files: ['server/bots.js'] }], {}) === null && nj.fromPulls(PULLS.log, { ...PULLS.pulls, 251: undefined }) === null, 'no pull request merged (only commits made on main), or one GitHub couldn\'t give: none, so the notes go by the commits')

// ---------- the workflows ----------
// With \n between lines on Windows too, where git checks them out with \r\n.
const yml = (f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8').replace(/\r\n/g, '\n')
const nightlyYml = yml('nightly.yml')
const releaseYml = yml('release.yml')
ok(/schedule:\s*\n\s*- cron: '17 10 \* \* \*'/.test(nightlyYml) && /workflow_dispatch:/.test(nightlyYml) && /node scripts\/nightly\.js changed/.test(nightlyYml) && /uses: \.\/\.github\/workflows\/release\.yml/.test(nightlyYml) && /nightly: \$\{\{ needs\.plan\.outputs\.version \}\}/.test(nightlyYml), 'nightly.yml: each night (or by hand), when main changed, builds main through release.yml at the nightly version')
ok(/refs\/heads\/main/.test(nightlyYml) && /secrets: inherit/.test(nightlyYml), 'from main only, with the signing secrets (the Mac app signed and notarized like a release)')
ok(/workflow_call:\s*\n\s*inputs:\s*\n\s*nightly:/.test(releaseYml) && /node scripts\/nightly\.js stamp "\$NIGHTLY"/.test(releaseYml) && /node scripts\/nightly\.js notes "\$NIGHTLY" notes\.md/.test(releaseYml), 'release.yml takes it: the version stamped in the build only, and its own notes')
ok(/- name: The nightly's version\n\s*if: inputs\.nightly\n\s*shell: bash\n/.test(releaseYml), 'the version stamped in bash on Windows too, where PowerShell reads "$NIGHTLY" as its own (empty) variable')
ok(/gh release create "v\$NIGHTLY" --target "\$GITHUB_SHA" [^\n]*--prerelease --latest=false/.test(releaseYml) && /nightly\.js older 7/.test(releaseYml) && /--cleanup-tag/.test(releaseYml), 'published as a pre-release, never GitHub\'s latest, and only the newest 7 kept')
ok(/name: Publish\n\s*if: \$\{\{ !inputs\.nightly \}\}/.test(releaseYml) && /android:\n\s*name: Android\n\s*needs: test\n\s*if: \$\{\{ !inputs\.nightly \}\}/.test(releaseYml) && /if: startsWith\(github\.ref, 'refs\/tags\/v'\)\n\s*run: \|\n\s*git fetch --no-tags origin main/.test(releaseYml), 'and the regular Publish, the Android app and the tag check are as before, left out of a nightly')
ok(/merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/.test(releaseYml.split('A nightly is of main')[1] || ''), 'a nightly is checked to be of main too')
const publishing = releaseYml.split('\n  release:\n')[1] || ''
ok(/permissions:\n(\s+[\w-]+: \w+\n)*\s+pull-requests: read\n/.test(publishing) && /- name: Notes and checksums\n\s*env:\n(\s+\w+: [^\n]+\n)*\s+GH_TOKEN: \$\{\{ github\.token \}\}\n/.test(publishing) && /permissions:\n(\s+[\w-]+: \w+\n)*\s+pull-requests: read\n/.test(nightlyYml.split('\n  release:\n')[1] || ''), 'its notes read the pull requests with the workflow\'s token (pull-requests: read, which nightly.yml gives it too)')

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
const fresh = { ...pre, publishedAt: new Date(NOW - 10 * 60e3).toISOString() }
ok(same(au.releaseWhy({ u: { ...fresh, channel: 'nightly' }, now: NOW }), []) && same(au.releaseWhy({ u: { ...fresh, channel: 'early' }, now: NOW }), ['young']), 'a nightly out ten minutes goes in without the wait a beta or release has')
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
  ok(u.built && 'at' in u.built && 'commit' in u.built, 'and it says when this build was made and from which commit (none from a clone)', u.built)
  const relayed = await refused(fetch(`${k.url}/api/updates/nightly`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-relay': '1' }, body: '{}' }).then(async (r) => { if (!r.ok) throw Object.assign(new Error((await r.json()).error), { status: r.status }); return r.json() }))
  ok(relayed.status >= 400 && /on the computer itself/.test(relayed.error || '') && (await k.api('/updates')).channel === 'stable', 'Nightly can\'t be switched on through the relay (a phone, another computer)', relayed)
  u = await k.api('/updates/nightly', {})
  ok(u.channel === 'nightly' && u.nightly?.on === true && u.latest === '99.1.0-nightly.20261116.7' && u.available === true && u.prerelease === true, 'switched on from the computer itself: on Nightly, offered the nightly', u)
  ok(JSON.parse(fs.readFileSync(path.join(k.data, 'config.json'), 'utf8')).updates?.nightly === true, 'kept in the settings (updates.nightly)')
  const off = await fetch(`${k.url}/api/updates/nightly`, { method: 'DELETE', headers: { 'x-bridge-relay': '1' } }).then((r) => r.status)
  ok(off >= 400 && (await k.api('/updates')).channel === 'nightly', 'nor switched off through the relay', off)
  const v = await k.api('/updates/auto')
  ok(!v.why.includes('prerelease'), 'and it goes in by itself while you\'re away, as Early Access\'s do', v)

  // The page: About & Updates with Nightly on.
  ;({ b } = await browser())
  const { p } = await page(b, k.url)
  await p.locator('.topbar .search-btn').waitFor({ timeout: 15000 }).catch(() => {})
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
  const sec = p.locator('.ab-channel')
  const on = (id) => sec.locator(`.ab-channel-pick.on[data-channel="${id}"]`)
  const shown = await until(async () => (await on('nightly').count()) === 1 && /A build of main each day it changes/.test(await sec.innerText()), 10000)
  ok(!!shown, 'About & Updates: the Update Channel with Nightly picked', await p.locator('.st-body').innerText().catch(() => ''))
  ok(/99\.1\.0-nightly\.20261116\.7 is available \(Nightly build\)/.test(await p.locator('.st-body').innerText()) && /^Nightly/.test(await p.locator('.ab-build').innerText()), 'and the nightly offered there, said to be one, with this computer on Nightly', await p.locator('.st-body').innerText())
  await sec.locator('.ab-channel-pick[data-channel="stable"]').click()
  ok(!!(await until(async () => (await on('stable').count()) === 1 && (await k.api('/updates')).channel === 'stable', 10000)), 'Stable picked there: Stable marked')
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
