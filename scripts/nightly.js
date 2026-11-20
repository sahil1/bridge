#!/usr/bin/env node
// Nightly builds of main, for the owner's own computers (.github/workflows/nightly.yml runs this).
// A nightly is a pre-release, 3.20.1-nightly.20261116.57 (shared/version.js NIGHTLY_VERSION): the
// version main is heading for, the day and the run. Only a computer on Nightly is offered one
// (server/updates.js); Stable and Early Access never are, and GitHub's latest release, the website's
// download and Docker's tags stay on regular releases. The version is set in the build's own copy of
// package.json only, so main gets no commit for it.
//   node scripts/nightly.js version [--date 20261116] [--run 57]   the version for this commit
//   node scripts/nightly.js changed      exits 1 when this commit already has a nightly
//   node scripts/nightly.js since [tag]  the last nightly before this commit, else the last release
//                                        (not tag, the one being made): what its notes and tests go from
//   node scripts/nightly.js stamp <version>          set it in package.json and desktop/package.json
//   node scripts/nightly.js notes <version> <file>   its notes: what changed since the last nightly
//   node scripts/nightly.js older <keep>             of the tags on stdin, the nightlies past the
//                                                    newest <keep>, to delete
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compare, isPre, isNightly, NIGHTLY_VERSION, RELEASE_VERSION } from '../shared/version.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
const fail = (msg) => { console.error(`nightly: ${msg}`); process.exit(1) }

// What main is heading for: its version when that isn't out yet (a release being prepared, or a
// beta's version), else the next patch after it. tags: the repo's release tags (v3.20.0, …).
export function nextOf(version, tags = []) {
  const [core] = String(version).split('-')
  if (isPre(version) || !tags.includes(`v${version}`)) return core
  const [a, b, c] = core.split('.').map(Number)
  return `${a}.${b}.${c + 1}`
}
export const nightlyOf = (version, tags, { date, run }) => `${nextOf(version, tags)}-nightly.${date}.${run}`
export const today = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '')

// Of these tags, the nightlies, newest first.
export const nightlies = (tags) => tags.filter((t) => isNightly(t)).sort((x, y) => compare(y, x))
// The nightlies to delete, keeping the newest `keep`.
export const older = (tags, keep) => nightlies(tags).slice(keep)

// The version in a package.json's text, changed where it stands (the rest of the file as it was).
export function stamped(text, version) {
  const out = text.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`)
  if (out === text && !text.includes(`"version": "${version}"`)) throw new Error('no "version" in it')
  return out
}

// ---------- the notes ----------
// A nightly's notes say what a person using Bridge AI would notice since the last one: a line for
// each part of Bridge AI that changed, as the update card in the top bar shows them
// (src/components/UpdateChip.jsx: each "- **Label:** sentence", its label and first sentence), and
// GitHub's page in full. Left out: a commit that only touches what nobody using Bridge AI sees (the
// tests, CI, the docs, the scripts only a release, a test or a maintainer runs, the website, the
// usage stats server); one whose subject says it's about them (Tests:, Tests on …, CI:, Docs:, a
// test's own name, as remote-screen: …); a merge, or the revert of one; a release's own version and
// notes (3.21.0: …); a dependency's bump; and a commit taken back in the same nightly, with its revert.
// (The Chief of Staff's own .md files are what it does, so they count.)
const UNSEEN = [
  /^test\//, /^\.github\//, /^\.githooks\//, /^docs?\//, /^(?!chief\/).*\.md$/i, /^(LICENSE|NOTICE)$/, /^site\//, /^counts\//,
  /^scripts\/(nightly|release|rollout|ship|smoke|signing|ios-release|android-key|check-private|freeze-check|install-hooks|tcc-sim|cloud-mocks|i18n)\.\w+$/,
]
const BEHIND = /^(tests?\b|ci\b|docs?\b|merge\b|revert "merge\b|bump\b|v?\d+\.\d+\.\d+\b)/i
const SUITE = /^[a-z0-9]+(-[a-z0-9]+)+(,\s*[a-z0-9]+(-[a-z0-9]+)+)*:/
const REVERT = /^Revert "(.+)"$/
// Whether a person using Bridge AI would notice a commit ({ subject, files }; files null when unknown).
export const seen = ({ subject, files }) => !BEHIND.test(subject) && !SUITE.test(subject) &&
  (!files?.length || files.some((f) => !UNSEEN.some((r) => r.test(f))))

// How many parts of Bridge AI a nightly's notes list, and how many lines each gets (its first, and
// the rest under it).
export const MAX_GROUPS = 8
export const MAX_POINTS = 4 // its first line and at most 3 under it
const LONG = 110 // a line longer than this is cut down

// The part of Bridge AI a subject is about: the words before its first colon (Bots: …, Share
// Links: …), without a note in brackets (Slack Bot (beta)). None when that's more than a few words.
const labelOf = (subject) => {
  const m = subject.match(/^([^:]{2,48}):\s+(.+)$/)
  const label = m?.[1].replace(/\s*\([^)]*\)\s*$/, '').trim()
  return m && label.split(/\s+/).length <= 6 ? { label, text: m[2] } : { label: null, text: subject }
}
// A clause about the tests or the code rather than Bridge AI: a test, a file's name, a path, a
// commit's hash.
const CODE = /\b(tests?|suites?|CI|stand-ins?|flaky)\b|\b[\w-]+\.(m?js|cjs|jsx?|tsx?|json|md|css|ya?ml|swift|kt|sh|ps1|html)\b|[~\\]|\b(?=[a-f]*\d)[0-9a-f]{7,40}\b/
// What a subject says, as a line a person reads: its first clause that isn't about the code, without
// code marks or a note in brackets about the code, cut down when it's long, starting with a capital
// and ending with a full stop. Empty when nothing's left.
export function plain(text) {
  let s = String(text).replace(/`/g, '').replace(/\s*\(([^)]*)\)/g, (m, inner) => (CODE.test(inner) ? '' : m))
  s = (s.split(/;\s+/).map((x) => x.trim()).find((x) => x && !CODE.test(x)) || '').replace(/^(and|also)\s+/i, '').replace(/[\s,:;.]+$/, '')
  if (s.length > LONG) s = s.replace(/\s*\([^)]*\)/g, '')
  if (s.length > LONG) { const at = s.lastIndexOf(', ', LONG); s = at > 40 ? s.slice(0, at) : `${s.slice(0, s.lastIndexOf(' ', LONG - 1))}…` }
  if (!s) return ''
  s = s[0].toUpperCase() + s.slice(1)
  return /[.!?…]$/.test(s) ? s : `${s}.`
}
const FIX = /^fix(es|ed)?\b|\bfix(es|ed)?$/i
// A line that leans on what came before it ("Says so next to …") isn't a part's first.
const LEANS = /^(says|it|its|it's|this|that|they|them|also|and)\b/i

// The commits a nightly lists, as parts of Bridge AI: [{ label, points }], the part with the most
// changes first, then Other (commits naming no part), then Fixes. changes: [{ subject, files }]
// newest first, as git log gives them, or subjects alone.
export function grouped(changes) {
  const all = changes.map((c) => (typeof c === 'string' ? { subject: c, files: null } : c)).map((c) => ({ ...c, subject: String(c.subject || '').trim() })).filter((c) => c.subject)
  // A commit and its revert, both in this nightly: neither happened.
  const subjects = new Set(all.map((c) => c.subject))
  const reverted = new Set(all.map((c) => c.subject.match(REVERT)?.[1]).filter((s) => s && subjects.has(s)))
  const items = all.filter((c) => seen(c) && !reverted.has(c.subject) && !reverted.has(c.subject.match(REVERT)?.[1])).reverse().map((c) => {
    const back = c.subject.match(REVERT)?.[1]
    const { label, text } = labelOf(back || c.subject)
    return { label, text: back ? `taken back for now: ${text}` : text, fix: FIX.test(label || '') || FIX.test(text) }
  })
  // One part, however it's said: "Bots per use case: …" and "Bots, complete: …" are Bots (what's
  // after the colon says the change), and a subject with no colon that starts with a part's name
  // ("Back Up & Move, and files bots make") is that part.
  const named = [...new Set(items.map((x) => x.label).filter((l) => l && !FIX.test(l)))].sort((a, b) => a.length - b.length)
  for (const x of items) {
    const said = x.label || x.text
    const part = named.find((n) => said !== n && said.startsWith(n) && /^[\s,'’(]/.test(said.slice(n.length)))
    if (!part) continue
    if (!x.label) x.text = x.text.slice(part.length).replace(/^[\s,:]+/, '')
    x.label = part
  }
  const groups = new Map()
  for (const x of items) {
    const label = x.fix ? 'Fixes' : x.label || 'Other'
    const point = plain(x.fix && x.label && !FIX.test(x.label) ? `${x.label}: ${x.text}` : x.text)
    if (!groups.has(label)) groups.set(label, { label, count: 0, points: [] })
    const g = groups.get(label)
    g.count++
    // Three words or fewer says nothing of its own: the commit naming the part.
    if (point.split(/\s+/).length > 3 && !g.points.includes(point)) g.points.push(point)
  }
  const last = (g) => (g.label === 'Fixes' ? 2 : g.label === 'Other' ? 1 : 0)
  return [...groups.values()].filter((g) => g.points.length)
    .sort((a, b) => last(a) - last(b) || b.count - a.count)
    .map((g) => ({ label: g.label, points: firstOf(g.points).slice(0, MAX_POINTS) }))
}
// A part's points, its first the one the update card shows (in two lines at most, so a short one): the
// oldest that's short and stands on its own (a part's first commit is usually what it is), else the
// shortest that stands on its own; the rest oldest first.
const SHORT = 80
function firstOf(points) {
  const alone = points.filter((p) => !LEANS.test(p))
  const lead = alone.find((p) => p.length <= SHORT) || [...alone].sort((a, b) => a.length - b.length)[0] || points[0]
  return [lead, ...points.filter((p) => p !== lead)]
}

// The day a nightly was built, from its version: 3.21.1-nightly.20261119.16 is 19 November 2026.
const dayOf = (version) => {
  const m = String(version).match(/-nightly\.(\d{4})(\d{2})(\d{2})\./)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null
}

// The notes: what it is, what's new since the last nightly (or the last release), a line for each
// part of Bridge AI with its other changes under it, who's offered it, and the oldest macOS its Mac
// app opens on, as the release's notes say it (scripts/release.js), which the update check reads.
// The commit it was built from is in a line GitHub doesn't show, to find it again. At most
// MAX_GROUPS lines: past that, the last names the parts left; Fixes is always listed.
export function notesFor({ version, sha, since, changes, mac }) {
  const groups = grouped(changes)
  const fixes = groups.filter((g) => g.label === 'Fixes')
  const parts = groups.filter((g) => g.label !== 'Fixes')
  const fit = parts.length + fixes.length > MAX_GROUPS ? MAX_GROUPS - fixes.length - 1 : parts.length
  const listed = [...parts.slice(0, fit), ...fixes]
  const rest = parts.slice(fit).map((g) => g.label)
  const names = rest.filter((l) => l !== 'Other')
  const lines = listed.map((g) => [`- **${g.label}:** ${g.points[0]}`, ...g.points.slice(1).map((p) => `  - ${p}`)].join('\n'))
  if (rest.length) lines.splice(fit, 0, names.length ? `- Smaller changes to ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}${names.length < rest.length ? ', and others' : ''}.` : '- Smaller changes besides.')
  const list = lines.length ? lines.join('\n') : changes.length ? '- Nothing you\'d notice: only the tests and how Bridge AI is built changed.' : '- Nothing new: built again.'
  const day = dayOf(version)
  return `Nightly build${day ? ` of ${day}` : ''}, for trying what's next.\n\n## ${since ? `Since ${since}` : 'The last 30 changes'}\n\n${list}\n\nOnly computers on the Nightly update channel are offered it. The Mac app needs macOS ${mac.replace(/\.0$/, '')} or later. Checksums (SHA-256) are in \`SHA256SUMS.txt\`.\n\n<!-- main at ${sha.slice(0, 7)} -->\n<!-- macOS ${mac} or later -->\n`
}

// The commits since a tag (or the last 30), newest first, each its subject and the files it
// changed: what a nightly's notes are made from.
export function changesSince(prev) {
  const out = git('log', '--no-merges', '--name-only', '--format=%x1e%s', ...(prev ? [`${prev}..HEAD`] : ['-30']))
  return out.split('\x1e').map((r) => r.split('\n').map((l) => l.trim()).filter(Boolean)).filter((r) => r.length).map(([subject, ...files]) => ({ subject, files }))
}

const tagsHere = () => git('tag', '-l', 'v*').split('\n').filter(Boolean)
// The last nightly on main before this commit (not `self`, the one being made), else the last
// release, else null: what a nightly's notes list the changes since, and its tests test.
function sinceHere(self = null) {
  const tags = tagsHere()
  const head = git('rev-parse', 'HEAD')
  const isAncestor = (t) => { try { git('merge-base', '--is-ancestor', t, head); return true } catch { return false } }
  return nightlies(tags).find((t) => t !== self && isAncestor(t)) ||
    tags.filter((t) => t !== self && RELEASE_VERSION.test(t.replace(/^v/, '')) && isAncestor(t)).sort((x, y) => compare(y, x))[0] || null
}
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'))

function main(args) {
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
  const [cmd, a1, a2] = args
  if (cmd === 'version') {
    const date = opt('--date') || today()
    const run = opt('--run') || process.env.GITHUB_RUN_NUMBER || '0'
    if (!/^\d{8}$/.test(date) || !/^\d+$/.test(run)) fail('--date is YYYYMMDD and --run a number')
    const v = readJson('package.json').version
    if (!RELEASE_VERSION.test(v)) fail(`package.json's version ${v} isn't one Bridge AI is released as`)
    return console.log(nightlyOf(v, tagsHere(), { date, run }))
  }
  if (cmd === 'changed') {
    const last = nightlies(tagsHere())[0]
    if (last && git('rev-list', '-n', '1', last) === git('rev-parse', 'HEAD')) { console.log(`Nothing new on main since ${last}.`); process.exit(1) }
    return console.log(last ? `Main has moved on since ${last}.` : 'No nightly yet.')
  }
  if (cmd === 'stamp') {
    if (!NIGHTLY_VERSION.test(a1 || '')) fail(`${a1 || '(none)'} isn't a nightly version, like 3.20.1-nightly.20261116.57`)
    for (const f of ['package.json', path.join('desktop', 'package.json')]) {
      const file = path.join(ROOT, f)
      fs.writeFileSync(file, stamped(fs.readFileSync(file, 'utf8'), a1))
    }
    return console.log(`package.json and desktop/package.json say ${a1}`)
  }
  if (cmd === 'since') return console.log(sinceHere(a1 || null) || '')
  if (cmd === 'notes') {
    if (!NIGHTLY_VERSION.test(a1 || '') || !a2) fail('notes <version> <file>')
    const head = git('rev-parse', 'HEAD')
    const prev = sinceHere(`v${a1}`)
    const changes = changesSince(prev)
    const mac = readJson(path.join('desktop', 'package.json')).build?.mac?.minimumSystemVersion
    if (!/^\d+(\.\d+)*$/.test(mac || '')) fail('desktop/package.json has no build.mac.minimumSystemVersion')
    fs.writeFileSync(a2, notesFor({ version: a1, sha: head, since: prev ? prev.replace(/^v/, '') : null, changes, mac }))
    return console.log(`Wrote notes for v${a1} to ${a2}`)
  }
  if (cmd === 'older') {
    const keep = Number(a1)
    if (!Number.isInteger(keep) || keep < 1) fail('older <keep>: how many nightlies to keep, 1 or more')
    const tags = fs.readFileSync(0, 'utf8').split(/\s+/).filter(Boolean)
    for (const t of older(tags, keep)) console.log(t)
    return
  }
  fail('version | changed | since | stamp <version> | notes <version> <file> | older <keep>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
