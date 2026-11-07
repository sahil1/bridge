#!/usr/bin/env node
// Start a release: npm run release
//
// Checks that nothing personal is in the repo (scripts/check-private.js), that main has your code, the version in package.json has a CHANGELOG.md section, and its
// tag doesn't exist yet, then pushes the tag (v<version>). GitHub Actions (.github/workflows/
// release.yml) then builds the app on macOS, Windows and Linux, smoke-tests each build, and
// publishes the release with that changelog section as the notes.
//   npm run release -- --dry-run          check everything, push nothing
//   node scripts/release.js --notes FILE  write this version's notes to FILE (used by CI;
//                                         --android when the Android app is in the release)
// A pre-release version (3.13.0-beta.1, -rc.1, -alpha.1 in both package.json files) is a beta for
// Early Access: GitHub marks it a pre-release, so it's never the latest release, the website's
// download or Docker's latest, and only computers on Early Access are offered it. A release that
// goes out a few computers at a time says so in its CHANGELOG section, <!-- rollout: 10 -->, and
// npm run rollout -- <version> <percent> moves it on (scripts/rollout.js, CONTRIBUTING.md).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_VERSION, isPre } from '../shared/version.js'
import { rolloutOf, withRollout } from '../shared/rollout.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1) }
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).version
const version = read('package.json')
const tag = `v${version}`
if (read('desktop/package.json') !== version) fail(`desktop/package.json is ${read('desktop/package.json')} but package.json is ${version}; set both`)
if (!RELEASE_VERSION.test(version)) fail(`${version} isn't a version Bridge AI is released as: 3.13.0 for everyone, or 3.13.0-beta.1 (-rc.1, -alpha.1) for Early Access`)
const beta = isPre(version)

// The notes end with the oldest macOS the Mac app opens on, in words and as a line GitHub doesn't
// show, which the update check reads (server/updates.js), so a Mac that can't open this version
// isn't offered it. With the Android app in the release (CI passes --android when it was built and
// signed), they say how to install it too. A line asking for a star goes last, where people read
// release notes on GitHub; the app's own update notes leave it out (server/updates.js).
// A pre-release's notes say what it is, after its changes (GitHub marks it too); one that starts
// part way out (a rollout line in its CHANGELOG section) keeps that line, last, where npm run
// rollout changes it.
const STAR = 'If Bridge AI is useful to you, a star on GitHub helps other people find it.'
const EARLY = 'This is a pre-release, for testers: Bridge AI offers it only to computers on Early Access (Settings › About & Updates), and everyone else stays on the latest regular release.'
function notesFor(v, { android = false } = {}) {
  const log = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  const m = log.match(new RegExp(`^## ${v.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))
  if (!m || !m[1].trim()) fail(`CHANGELOG.md has no section "## ${v}"`)
  const mac = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).build?.mac?.minimumSystemVersion
  if (!/^\d+(\.\d+)*$/.test(mac || '')) fail('desktop/package.json has no build.mac.minimumSystemVersion')
  const rollout = rolloutOf(m[1])
  const section = withRollout(m[1], 100).trim()
  if (!section) fail(`CHANGELOG.md's section "## ${v}" has only its rollout line; say what's in it`)
  const apk = android ? 'The Android app is `Bridge-AI-android.apk`: open it on your phone to install it, or to update the one you have. It isn\'t on Google Play yet.\n\n' : ''
  const notes = `${section.replace(/^### /gm, '## ')}\n\n${apk}${isPre(v) ? `${EARLY}\n\n` : ''}The Mac app needs macOS ${mac.replace(/\.0$/, '')} or later. Checksums (SHA-256) are in \`SHA256SUMS.txt\`.\n\n${STAR}\n\n<!-- macOS ${mac} or later -->\n`
  return rollout == null ? notes : withRollout(notes, rollout)
}

// CI: write the notes, after checking the tag that started the build matches package.json.
const notesFile = opt('--notes')
if (notesFile) {
  const ref = process.env.GITHUB_REF_NAME
  if (ref && ref !== tag) fail(`the tag is ${ref} but package.json says ${version}`)
  fs.writeFileSync(notesFile, notesFor(version, { android: args.includes('--android') }))
  console.log(`Wrote notes for ${tag} to ${notesFile}`)
  process.exit(0)
}

// Local: check, then push the tag.
const notes = notesFor(version)
try { execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-private.js')], { stdio: 'inherit' }) } catch { fail('personal data found in the repo (above); remove it before releasing') }
if (git('status', '--porcelain', '--untracked-files=no')) fail('you have uncommitted changes; commit them first')
git('fetch', '-q', 'origin', 'main', '--tags')
const head = git('rev-parse', 'HEAD')
const main = git('rev-parse', 'origin/main')
if (head !== main) fail(`your checkout (${head.slice(0, 7)}) isn't what's on origin/main (${main.slice(0, 7)}). Merge and push to main, then check out main.`)
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) fail(`${tag} already exists on GitHub. Bump the version in package.json and desktop/package.json for a new release.`)

// Who it goes to, said before anything is pushed.
const rollout = rolloutOf(notes)
const goesTo = beta
  ? `A pre-release, for Early Access: GitHub marks it so, and it never becomes the latest release, the website's download or Docker's latest (only ghcr.io/sahil1/bridge:${version}). Only computers on Early Access are offered it${rollout === 0 ? ', and none yet: its rollout line pauses it' : ''}.`
  : rollout == null ? 'Everyone on Stable is offered it at once (no rollout line in its CHANGELOG section).'
    : rollout === 0 ? 'Paused: its rollout line is 0, so nobody is offered it until npm run rollout raises it.'
      : `${rollout}% of computers on Stable are offered it at first (and anyone who checks by hand), Early Access all of them. Widen it with npm run rollout -- ${version} <percent>.`
console.log(`Bridge AI ${version}: tag ${tag} on main at ${main.slice(0, 7)}\n\n${goesTo}\n\nNotes:\n\n${notes}`)
if (args.includes('--dry-run')) { console.log('Dry run: nothing pushed.'); process.exit(0) }
git('tag', '-a', tag, '-m', `Bridge AI ${version}`, main)
git('push', 'origin', tag)
const repo = git('remote', 'get-url', 'origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
console.log(`Pushed ${tag}. GitHub is building macOS, Windows and Linux now, and the Android app (about 15 minutes):\n  ${repo}/actions\nThe ${beta ? 'pre-release' : 'release'} appears at ${repo}/releases when all three desktop builds pass.`)
