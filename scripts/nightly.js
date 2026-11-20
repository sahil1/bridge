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
//   node scripts/nightly.js notes <version> <file> [--at <commit>]
//                                        its notes: what changed since the last nightly, by the
//                                        pull requests merged (gh), else the commits; --at for a
//                                        commit other than this one (a nightly already out)
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
// GitHub's page in full. They're made from the pull requests merged into main since then, whose
// titles are written for people (fromPulls), else from the commits. Left out: a pull request or
// commit that only touches what nobody using Bridge AI sees (the tests, CI, the docs, the scripts
// only a release, a test or a maintainer runs, the website, the usage stats server); one whose title
// or subject says it's about them (Tests:, Tests on …, CI:, Docs:, a test's own name, as
// remote-screen: …); a merge, the revert of one, or a revert's own revert (Reapply "…"); a
// release's own version and notes (3.21.0: …); a dependency's bump; and a change taken back in the
// same nightly, with its revert. (The Chief of Staff's own .md files are what it does, so they count.)
const UNSEEN = [
  /^test\//, /^\.github\//, /^\.githooks\//, /^docs?\//, /^(?!chief\/).*\.md$/i, /^(LICENSE|NOTICE)$/, /^site\//, /^counts\//,
  /^scripts\/(nightly|release|rollout|ship|smoke|signing|ios-release|android-key|check-private|freeze-check|install-hooks|tcc-sim|cloud-mocks|i18n)\.\w+$/,
]
const BEHIND = /^(tests?\b|ci\b|docs?\b|merge\b|revert "merge\b|reapply\b|bump\b|v?\d+\.\d+\.\d+\b)/i
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
// The name a label or a sentence starts with, in capitals as Bridge AI's parts are named ("Bots that
// change files" is Bots, "Remote Screen starts every time" Remote Screen, "Back Up & Move, and …"
// Back Up & Move, "Studio's sheet" Studio), unless it's a word any sentence starts with (A, The, Each).
const TITLED = /^[A-Z][\w-]*(?:\s+(?:[A-Z][\w-]*|&(?=\s+[A-Z])))*/
const ANY = /^(a|an|the|each|every|all|any|some|no|one|this|that|these|those|it|its|your|you|we|our|when|if|now|new|more|only|also|and|but|or|not|with|without|in|on|at|for|from|to|by|after|before|what|which|who|how|why|nothing)$/i
const headOf = (s) => {
  const h = s?.match(TITLED)?.[0]
  return h && !ANY.test(h) && !FIX.test(h) ? h : null
}
const words = (s) => s.split(/\s+/).length
// How much of what a change says is a part's name, or the name said in the singular ("Bot runs …" is
// Bots), whatever its first letter; 0 when it doesn't start with it.
const startOf = (said, n) => {
  const s = said ? said[0].toUpperCase() + said.slice(1) : ''
  for (const m of n.endsWith('s') ? [n, n.slice(0, -1)] : [n]) if (s === m || (s.startsWith(m) && /^[\s,'’(]/.test(s.slice(m.length)))) return m.length
  return 0
}
// A clause about the tests or the code rather than Bridge AI: a test, a file's name, a path, a
// commit's hash, a command's flag, a pull request's number.
const CODE = /\b(tests?|suites?|CI|stand-ins?|flaky)\b|\b[\w-]+\.(m?js|cjs|jsx?|tsx?|json|md|css|ya?ml|swift|kt|sh|ps1|html)\b|[~\\]|\b(?=[a-f]*\d)[0-9a-f]{7,40}\b|(^|[\s(])--[a-z]|#\d+\b/
// A line split where `at` matches, never inside brackets: into its clauses (at "; " or between
// sentences) or its pieces (at ", ").
const CLAUSE = /^(?:;\s+|([.!?])\s+(?=[A-Z]))/
const COMMA = /^,\s+/
function outside(s, at) {
  const out = []
  let depth = 0
  let from = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth = Math.max(0, depth - 1)
    else if (!depth && /[;.!?,]/.test(s[i])) {
      const m = s.slice(i).match(at)
      if (m) { out.push(s.slice(from, i + (m[1] || '').length)); from = i + m[0].length; i = from - 1 }
    }
  }
  out.push(s.slice(from))
  return out.map((x) => x.trim()).filter(Boolean)
}
// A line cut down to `max`: at its last comma that leaves enough of it, else after its first clause,
// else at a word, with "…".
function cut(s, max) {
  if (s.length <= max) return s
  const at = s.lastIndexOf(', ', max)
  if (at > 40) return s.slice(0, at)
  const first = s.indexOf(', ')
  return first >= 20 && first <= max ? s.slice(0, first) : `${s.slice(0, s.lastIndexOf(' ', max - 1))}…`
}
// What a subject says first: its first clause that isn't about the code (less any piece after its
// first that is: "…, test fixes"), without code marks or a note in brackets about the code.
function clauseOf(text) {
  const s = String(text).replace(/`/g, '').replace(/\s*\(([^)]*)\)/g, (m, inner) => (CODE.test(inner) ? '' : m))
  const first = outside(s, CLAUSE).find((x) => !CODE.test(outside(x, COMMA)[0])) || ''
  return outside(first, COMMA).filter((p, i) => !i || !CODE.test(p)).join(', ').replace(/^(and|also)\s+/i, '').replace(/[\s,:;.]+$/, '')
}
// What a subject says, as a line a person reads: its first clause (clauseOf), cut down when it's
// longer than `max`, starting with a capital and ending with a full stop. Empty when nothing's left.
export function plain(text, max = LONG) {
  let s = clauseOf(text)
  if (s.length > max) s = s.replace(/\s*\([^)]*\)/g, '')
  s = cut(s, max)
  if (!s) return ''
  s = s[0].toUpperCase() + s.slice(1)
  return /[.!?…]$/.test(s) ? s : `${s}.`
}
const FIX = /^fix(es|ed)?\b|\bfix(es|ed)$/i
// A line that leans on what came before it ("Says so next to …") isn't a part's first.
const LEANS = /^(says|it|its|it's|this|that|they|them|also|and)\b/i

// The changes a nightly lists, as parts of Bridge AI: [{ label, points }], the part with the most
// changes first, then Other (changes naming no part), then Fixes. changes: [{ subject, files, pull,
// parts, only }] newest first, as git log gives them (pull: the pull request it's from, parts: the
// parts its commits name, only: the one they all name; fromPulls), or subjects alone.
export function grouped(changes) {
  const all = changes.map((c) => (typeof c === 'string' ? { subject: c, files: null } : c)).map((c) => ({ ...c, subject: String(c.subject || '').trim() })).filter((c) => c.subject)
  // A change and its revert, both in this nightly: neither happened.
  const subjects = new Set(all.map((c) => c.subject))
  const reverted = new Set(all.map((c) => c.subject.match(REVERT)?.[1]).filter((s) => s && subjects.has(s)))
  const items = all.filter((c) => seen(c) && !reverted.has(c.subject) && !reverted.has(c.subject.match(REVERT)?.[1])).reverse().map((c) => {
    const back = c.subject.match(REVERT)?.[1]
    const { label, text } = labelOf(back || c.subject)
    const fix = FIX.test(label || '') || FIX.test(clauseOf(text))
    return { label, text: back ? `taken back for now: ${text}` : text, head: headOf(label || text), pull: c.pull || null, parts: c.parts || [], only: c.only || null, fix }
  })
  // One part, however it's said: "Bots per use case: …", "Bots, complete: …" and "Bots that change
  // files: …" are Bots (what's after the colon says the change), and so are a subject with no colon
  // that starts with its name ("Back Up & Move, and files bots make", "Bots attach files …") and one
  // naming it in the singular ("Bot runs …"). A name in capitals two changes start with is a part
  // even when neither says it alone, and so is one a pull request's own commits name; a longer name
  // in capitals is a part of its own (Remote Screen isn't Remote). A pull request whose title names
  // none is the one part its commits name, if they name only one.
  const belongs = (x, n) => startOf(x.label || x.text, n) > 0 && !(x.head && words(x.head) > words(n))
  const labels = items.map((x) => x.label).filter((l) => l && !FIX.test(l))
  const heads = [...new Set(items.map((x) => x.head).filter(Boolean))].filter((h) => new Set(items.filter((x) => belongs(x, h)).map((x) => x.label || x.text)).size > 1)
  const named = [...new Set([...labels, ...heads])]
  for (const x of items) {
    const said = x.label || x.text
    const part = [...new Set([...named, ...x.parts])].sort((a, b) => a.length - b.length).find((n) => said !== n && belongs(x, n)) ||
      (x.label ? null : x.head && words(x.head) > 1 ? x.head : x.only)
    if (!part) continue
    // Its name as a heading ("Back Up & Move, and …", "Back Up & Move (a sealed file …), and …") goes,
    // what its brackets say kept; a sentence about it ("Bots attach files …") stays whole.
    const m = x.label ? null : x.text.slice(startOf(x.text, part)).match(/^\s*(?:\(([^)]*)\))?\s*[,:]\s*(.*)$/)
    if (m) x.text = m[1] ? `${m[1]}, ${m[2]}` : m[2]
    x.label = part
  }
  const groups = new Map()
  for (const x of items) {
    const label = x.fix ? 'Fixes' : x.label || 'Other'
    const raw = x.fix && x.label && !FIX.test(x.label) && !startOf(x.text, x.label) ? `${x.label}: ${x.text}` : x.text
    const point = { text: plain(raw), raw, pull: x.pull }
    if (!groups.has(label)) groups.set(label, { label, count: 0, points: [] })
    const g = groups.get(label)
    g.count++
    // Three words or fewer says nothing of its own: the commit naming the part.
    if (point.text.split(/\s+/).length > 3 && !g.points.some((p) => p.text === point.text)) g.points.push(point)
  }
  const last = (g) => (g.label === 'Fixes' ? 2 : g.label === 'Other' ? 1 : 0)
  return [...groups.values()].filter((g) => g.points.length)
    .sort((a, b) => last(a) - last(b) || b.count - a.count)
    .map((g) => ({ label: g.label, points: firstOf(g.points).slice(0, MAX_POINTS) }))
}
// A part's points, its first the one the update card shows (in two lines at most, so a short one).
// From pull requests: the first merged (or listed first) that stands on its own, cut down to fit.
// From commits: the oldest that's short and stands on its own (a part's first commit is usually
// what it is), else the shortest that stands on its own. The rest oldest first.
const SHORT = 80
const LEAD = 90
function firstOf(points) {
  const alone = points.filter((p) => !LEANS.test(p.text))
  const pulled = alone.find((p) => p.pull)
  const lead = pulled || alone.find((p) => p.text.length <= SHORT) || [...alone].sort((a, b) => a.text.length - b.text.length)[0] || points[0]
  return [pulled ? plain(lead.raw, LEAD) : lead.text, ...points.filter((p) => p !== lead).map((p) => p.text)]
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

// ---------- from the pull requests ----------
// Each pull request merged into main is a merge commit on main's own line (its first parents),
// "Merge pull request #258 from …", and its title says the change for people ("Share Links: a secure
// link to a file, …"), where its commits are the steps. One putting several together for a nightly
// lists them in its body, a line each ("- #252 Bots that change files: …"): those lines are what it
// brings, not its own title. One titled with its branch's name (gh pr create --fill, for a branch of
// several commits) says nothing of its own: its commits do.
const MERGED = /^Merge pull request #(\d+) from /
const LISTED = /^\s*[-*]\s+#(\d+)\b[\s:–—-]*(\S.*)$/
// The pull requests a body lists: [{ number, text }].
export const listedIn = (body) => String(body || '').split(/\r?\n/).map((l) => l.match(LISTED)).filter(Boolean).map((m) => ({ number: Number(m[1]), text: m[2].trim() }))
const branchy = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// What a nightly's notes are made from, by the pull requests merged since the last one. log: main's
// first parents since then, newest first, each { subject, commits }, commits being what it brought,
// newest first, { subject, files } (a merge's branch, or a commit made on main itself); pulls: each
// pull request by its number, { title, body, files, branch } (one only listed in another's body may
// have its files alone). Newest first, as grouped takes them, each { subject, files, pull, parts,
// only }; a pull request once, even when another lists it too. Null when none of them is a pull
// request, or one couldn't be read: then the notes go by the commits.
export function fromPulls(log, pulls) {
  if (!log.some((c) => MERGED.test(c.subject))) return null
  const out = []
  const done = new Set()
  for (const c of [...log].reverse()) {
    const n = Number(c.subject.match(MERGED)?.[1] || 0)
    const pr = n ? pulls[n] : null
    if (n && !pr?.title) return null
    if (!n || branchy(pr.title) === branchy(pr.branch)) {
      if (!done.has(n)) out.push(...[...(c.commits || [c])].reverse())
    } else {
      // The parts its commits a person would notice name ("Bots: …"), for a title that starts with
      // one but says no more ("Bots in the sidebar, …"); and its title's part when it names none and
      // they name only one (Bots on Windows being Bots).
      const parts = [...new Set((c.commits || []).filter(seen).map((k) => labelOf(k.subject).label).filter((l) => l && !FIX.test(l)))]
      const roots = parts.filter((p) => !parts.some((q) => q !== p && startOf(p, q)))
      const listed = listedIn(pr.body)
      for (const { number, text } of listed.length ? listed : [{ number: n, text: pr.title }]) {
        if (done.has(number)) continue
        done.add(number)
        out.push({ subject: text, files: pulls[number]?.files || null, pull: number, parts, only: !listed.length && roots.length === 1 ? roots[0] : null })
      }
    }
    if (n) done.add(n)
  }
  return out.reverse()
}

// The repository on GitHub: the workflow's, else origin's.
function repoHere() {
  if (/^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY || '')) return process.env.GITHUB_REPOSITORY
  try { return git('remote', 'get-url', 'origin').match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1] || null } catch { return null }
}
const gh = (...a) => execFileSync('gh', a, { cwd: ROOT, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
// A pull request as GitHub has it (gh, with the workflow's token in CI): the files it changed, and
// unless only those are asked for, its title, body and branch.
function pullOf(repo, n, filesOnly = false) {
  const files = gh('api', '--paginate', `repos/${repo}/pulls/${n}/files?per_page=100`, '--jq', '.[].filename').split('\n').filter(Boolean)
  if (filesOnly) return { files }
  const { title, body, head } = JSON.parse(gh('api', `repos/${repo}/pulls/${n}`))
  return { title, body: body || '', branch: head?.ref || '', files }
}
// The changes since a tag by its pull requests (fromPulls), or null, saying why, for the commits.
function pullsSince(prev, head) {
  if (!prev) return null
  const log = git('log', '--first-parent', '--format=%H%x1f%s', `${prev}..${head}`).split('\n').filter(Boolean).map((l) => { const [sha, subject] = l.split('\x1f'); return { sha, subject } })
  const merged = [...new Set(log.map((c) => Number(c.subject.match(MERGED)?.[1] || 0)).filter(Boolean))]
  if (!merged.length) { console.error(`nightly: no pull request merged into main since ${prev}, so the notes go by the commits`); return null }
  const pulls = {}
  try {
    const repo = repoHere()
    if (!repo) throw new Error('no GitHub repository for this checkout')
    for (const n of merged) pulls[n] = pullOf(repo, n)
    for (const { number } of merged.flatMap((n) => listedIn(pulls[n].body))) {
      if (!pulls[number]) try { pulls[number] = pullOf(repo, number, true) } catch { /* its line goes by its words alone */ }
    }
  } catch (e) {
    console.error(`nightly: couldn't read the pull requests from GitHub (${String(e.stderr || e.message).trim().split('\n')[0]}), so the notes go by the commits`)
    return null
  }
  for (const c of log) c.commits = commitsIn(`${c.sha}^1..${c.sha}`)
  return fromPulls(log, pulls)
}

// The commits in a range, newest first, each its subject and the files it changed.
const commitsIn = (...range) => git('log', '--no-merges', '--name-only', '--format=%x1e%s', ...range)
  .split('\x1e').map((r) => r.split('\n').map((l) => l.trim()).filter(Boolean)).filter((r) => r.length).map(([subject, ...files]) => ({ subject, files }))
// The commits since a tag (or the last 30): what a nightly's notes are made from when there's no
// pull request to go by.
export const changesSince = (prev, head = 'HEAD') => commitsIn(...(prev ? [`${prev}..${head}`] : ['-30', head]))

const tagsHere = () => git('tag', '-l', 'v*').split('\n').filter(Boolean)
// The last nightly on main before this commit (not `self`, the one being made), else the last
// release, else null: what a nightly's notes list the changes since, and its tests test.
function sinceHere(self = null, head = git('rev-parse', 'HEAD')) {
  const tags = tagsHere()
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
    if (!NIGHTLY_VERSION.test(a1 || '') || !a2) fail('notes <version> <file> [--at <commit>]')
    const head = git('rev-parse', `${opt('--at') || 'HEAD'}^{commit}`)
    const prev = sinceHere(`v${a1}`, head)
    const pulled = pullsSince(prev, head)
    const changes = pulled || changesSince(prev, head)
    const mac = readJson(path.join('desktop', 'package.json')).build?.mac?.minimumSystemVersion
    if (!/^\d+(\.\d+)*$/.test(mac || '')) fail('desktop/package.json has no build.mac.minimumSystemVersion')
    fs.writeFileSync(a2, notesFor({ version: a1, sha: head, since: prev ? prev.replace(/^v/, '') : null, changes, mac }))
    return console.log(`Wrote notes for v${a1} to ${a2}, from the ${pulled ? 'pull requests' : 'commits'} since ${prev || 'the last 30'}`)
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
