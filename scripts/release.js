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
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1) }
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).version
const version = read('package.json')
const tag = `v${version}`
if (read('desktop/package.json') !== version) fail(`desktop/package.json is ${read('desktop/package.json')} but package.json is ${version}; set both`)

// The notes end with the oldest macOS the Mac app opens on, in words and as a line GitHub doesn't
// show, which the update check reads (server/updates.js), so a Mac that can't open this version
// isn't offered it. With the Android app in the release (CI passes --android when it was built and
// signed), they say how to install it too.
function notesFor(v, { android = false } = {}) {
  const log = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  const m = log.match(new RegExp(`^## ${v.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))
  if (!m || !m[1].trim()) fail(`CHANGELOG.md has no section "## ${v}"`)
  const mac = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).build?.mac?.minimumSystemVersion
  if (!/^\d+(\.\d+)*$/.test(mac || '')) fail('desktop/package.json has no build.mac.minimumSystemVersion')
  const apk = android ? 'The Android app is `Bridge-AI-android.apk`: open it on your phone to install it, or to update the one you have. It isn\'t on Google Play yet.\n\n' : ''
  return `${m[1].trim().replace(/^### /gm, '## ')}\n\n${apk}The Mac app needs macOS ${mac.replace(/\.0$/, '')} or later. Checksums (SHA-256) are in \`SHA256SUMS.txt\`.\n\n<!-- macOS ${mac} or later -->\n`
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

console.log(`Bridge AI ${version}: tag ${tag} on main at ${main.slice(0, 7)}\n\nNotes:\n\n${notes}`)
if (args.includes('--dry-run')) { console.log('Dry run: nothing pushed.'); process.exit(0) }
git('tag', '-a', tag, '-m', `Bridge AI ${version}`, main)
git('push', 'origin', tag)
const repo = git('remote', 'get-url', 'origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
console.log(`Pushed ${tag}. GitHub is building macOS, Windows and Linux now, and the Android app (about 15 minutes):\n  ${repo}/actions\nThe release appears at ${repo}/releases when all three desktop builds pass.`)
