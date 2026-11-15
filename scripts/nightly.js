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

// The notes: what it is, the changes since the last nightly (or the last release), as their commit
// messages, and the oldest macOS its Mac app opens on, as the release's notes say it
// (scripts/release.js), which the update check reads.
export function notesFor({ version, sha, since, changes, mac }) {
  const list = changes.length ? changes.slice(0, 60).map((c) => `- ${c}`).join('\n') + (changes.length > 60 ? `\n- …and ${changes.length - 60} more` : '') : '- Nothing new: built again.'
  return `A nightly build of main at ${sha.slice(0, 7)}, to try what's next. Bridge AI offers it only to computers on Nightly; Stable and Early Access never get it.\n\n## Since ${since}\n\n${list}\n\nThe Mac app needs macOS ${mac.replace(/\.0$/, '')} or later. Checksums (SHA-256) are in \`SHA256SUMS.txt\`.\n\n<!-- macOS ${mac} or later -->\n`
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
    const changes = git('log', '--no-merges', '--format=%s', ...(prev ? [`${prev}..HEAD`] : ['-30'])).split('\n').filter(Boolean)
    const mac = readJson(path.join('desktop', 'package.json')).build?.mac?.minimumSystemVersion
    if (!/^\d+(\.\d+)*$/.test(mac || '')) fail('desktop/package.json has no build.mac.minimumSystemVersion')
    fs.writeFileSync(a2, notesFor({ version: a1, sha: head, since: prev ? prev.replace(/^v/, '') : 'the last 30 changes', changes, mac }))
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
