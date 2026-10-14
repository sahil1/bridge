#!/usr/bin/env node
// Publish a GitHub release of the Mac app: npm run release
//
// Uses the version in package.json, the installers `npm run desktop:dist` built in desktop/dist,
// and that version's section of CHANGELOG.md as the notes. Checks first that the installers are
// that version, the code is committed and pushed, and the tag doesn't exist yet.
//   npm run release -- --dry-run    check everything and print what would be published
//   npm run release -- --draft      create the release as a draft to look over before publishing
// Needs the GitHub CLI (gh), signed in with access to the repo.
import { spawnSync, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'desktop', 'dist')
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const DRAFT = args.includes('--draft')
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1) }
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const tag = `v${version}`

// The files install.sh and the "latest" download links expect, by these exact names.
const FILES = ['Bridge-AI-mac-arm64.zip', 'Bridge-AI-mac-x64.zip', 'Bridge-AI-mac-arm64.dmg', 'Bridge-AI-mac-x64.dmg']
for (const f of FILES) if (!fs.existsSync(path.join(DIST, f))) fail(`desktop/dist/${f} is missing. Build first: npm run desktop:dist`)
for (const dir of ['mac-arm64', 'mac']) {
  const plist = path.join(DIST, dir, 'Bridge AI.app', 'Contents', 'Info.plist')
  const built = fs.existsSync(plist) ? (fs.readFileSync(plist, 'utf8').match(/CFBundleShortVersionString<\/key>\s*<string>([^<]+)/) || [])[1] : null
  if (built !== version) fail(`desktop/dist has version ${built || 'unknown'}, package.json says ${version}. Rebuild: npm run desktop:dist`)
}

// Notes: this version's section of CHANGELOG.md.
const log = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
const m = log.match(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))
if (!m || !m[1].trim()) fail(`CHANGELOG.md has no section "## ${version}"`)
const notes = `${m[1].trim().replace(/^### /gm, '## ')}\n\nChecksums (SHA-256) are in \`SHA256SUMS.txt\`.\n`

// The release points at main, so main must have this code.
if (git('status', '--porcelain', '--untracked-files=no')) fail('you have uncommitted changes; commit them first')
git('fetch', '-q', 'origin', 'main')
const head = git('rev-parse', 'HEAD')
const main = git('rev-parse', 'origin/main')
if (head !== main) fail(`your checkout (${head.slice(0, 7)}) isn't what's on origin/main (${main.slice(0, 7)}). Merge and push to main first.`)
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) fail(`${tag} already exists on GitHub. Bump the version in package.json for a new release.`)

const sums = FILES.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(DIST, f))).digest('hex')}  ${f}`).join('\n') + '\n'
fs.writeFileSync(path.join(DIST, 'SHA256SUMS.txt'), sums)
fs.writeFileSync(path.join(DIST, 'release-notes.md'), notes)

const ghArgs = ['release', 'create', tag, '--target', 'main', '--title', `Bridge AI ${version}`, '--notes-file', 'release-notes.md', ...(DRAFT ? ['--draft'] : []), ...FILES, 'SHA256SUMS.txt']
console.log(`Bridge AI ${version} (${tag}, main at ${main.slice(0, 7)})`)
for (const f of FILES) console.log(`  ${f}  ${(fs.statSync(path.join(DIST, f)).size / 1e6).toFixed(0)} MB`)
if (DRY) {
  console.log(`\nNotes:\n\n${notes}\nWould run (in desktop/dist): gh ${ghArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
  process.exit(0)
}
const r = spawnSync('gh', ghArgs, { cwd: DIST, stdio: 'inherit' })
process.exit(r.status ?? 1)
