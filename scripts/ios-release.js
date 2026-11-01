#!/usr/bin/env node
// The iPhone app, archived and uploaded to App Store Connect for TestFlight and App Review:
//   npm run mobile:ios:release                 check, build, archive, upload
//   npm run mobile:ios:release -- --check      only check it's ready to (Xcode, XcodeGen, a sign-in)
//   npm run mobile:ios:release -- --unsigned   archive with no signing and stop, to see it builds;
//                                              nothing is signed or uploaded
// It signs in as the Apple account in Xcode › Settings › Accounts, or, with ASC_KEY_ID,
// ASC_ISSUER_ID and ASC_KEY_PATH (an App Store Connect API key's .p8 file) set, with that key, so
// no one has to be signed in to Xcode. Xcode makes the certificates and profiles it needs
// (-allowProvisioningUpdates). The steps around it are in mobile/README.md › Releasing to the App Store.
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IOS = path.join(ROOT, 'mobile', 'ios')
const OUT = path.join(IOS, 'build', 'release')
// The App Store takes apps built with nothing older.
export const MIN_XCODE = 26
// The XcodeGen release CI uses (.github/workflows/test.yml), fetched when there's none on the PATH.
export const XCODEGEN = {
  url: 'https://github.com/yonaskolb/XcodeGen/releases/download/2.46.0/xcodegen.zip',
  sha256: '4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806',
}

// ---------- What it does, as data (test/suites/ios-app.mjs checks these) ----------

// The team and the version, from project.yml: the team set on each target, and the one version.
export function project(yml = fs.readFileSync(path.join(IOS, 'project.yml'), 'utf8')) {
  const targets = {}
  for (const block of (yml.split(/^targets:\s*$/m)[1] || '').split(/^ {2}(?=\w[\w-]*:\s*$)/m).slice(1)) {
    const name = block.match(/^([\w-]+):/)[1]
    targets[name] = { team: block.match(/^\s+DEVELOPMENT_TEAM:\s*"?([A-Z0-9]*)"?\s*$/m)?.[1] || '', style: block.match(/^\s+CODE_SIGN_STYLE:\s*(\w+)/m)?.[1] || '' }
  }
  return { version: yml.match(/^\s+MARKETING_VERSION:\s*"?([\d.]+)"?/m)?.[1] || '', targets }
}

// A build number higher than any before it: the time in UTC, as the date and the time of day
// (20261101.143005), so each upload of the same version is newer than the last, even a minute later,
// and a clock change can't take it back. Apple takes up to three numbers with dots.
export function buildNumber(at = new Date()) {
  const d = at.getUTCFullYear() * 10000 + (at.getUTCMonth() + 1) * 100 + at.getUTCDate()
  const t = at.getUTCHours() * 10000 + at.getUTCMinutes() * 100 + at.getUTCSeconds()
  return `${d}.${t}`
}

// An App Store Connect API key, when one is set, as xcodebuild's arguments. Part of one is a mistake.
export function apiKey(env = process.env) {
  const { ASC_KEY_ID: id, ASC_ISSUER_ID: issuer } = env
  const file = env.ASC_KEY_PATH || (id ? path.join(os.homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${id}.p8`) : '')
  if (!id && !issuer && !env.ASC_KEY_PATH) return null
  const missing = [!id && 'ASC_KEY_ID', !issuer && 'ASC_ISSUER_ID', !(file && fs.existsSync(file)) && (env.ASC_KEY_PATH ? `the .p8 file at ASC_KEY_PATH (${file})` : 'ASC_KEY_PATH (the .p8 file)')].filter(Boolean)
  if (missing.length) return { error: `an App Store Connect API key needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH; ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing` }
  return { args: ['-authenticationKeyPath', file, '-authenticationKeyID', id, '-authenticationKeyIssuerID', issuer], file }
}

// How it's sent: to App Store Connect, signed by the team, with Xcode making what it needs. The
// build number is the one set at archive time, so what's printed is what's uploaded.
export function exportOptions(team) {
  const entries = { method: 'app-store-connect', destination: 'upload', teamID: team, signingStyle: 'automatic', uploadSymbols: true, manageAppVersionAndBuildNumber: false }
  const value = (v) => (typeof v === 'boolean' ? `<${v}/>` : `<string>${v}</string>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(entries).map(([k, v]) => `\t<key>${k}</key>\n\t${value(v)}`).join('\n')}
</dict>
</plist>
`
}

// xcodebuild's two steps. --unsigned archives for any iPhone with no signing, to see it builds.
export function commands({ build, archive, options, exportPath, auth = [], unsigned = false }) {
  const signing = unsigned ? ['CODE_SIGNING_ALLOWED=NO'] : ['-allowProvisioningUpdates', ...auth]
  return {
    archive: ['archive', '-project', path.join(IOS, 'BridgeAI.xcodeproj'), '-scheme', 'BridgeAI', '-configuration', 'Release',
      '-destination', 'generic/platform=iOS', '-archivePath', archive, ...signing, `CURRENT_PROJECT_VERSION=${build}`],
    upload: ['-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', exportPath, '-allowProvisioningUpdates', ...auth],
  }
}

// The Apple accounts signed in to Xcode, and their teams: [{ teamID, teamName, free }].
export function xcodeTeams(byAccount) {
  return Object.values(byAccount || {}).flat().map((t) => ({ teamID: t.teamID, teamName: t.teamName, free: !!t.isFreeProvisioningTeam }))
}

// ---------- Running it ----------

const say = (s) => console.log(s)
const fail = (msg) => { console.error(`\nmobile:ios:release: ${msg}`); process.exit(1) }
const quiet = (cmd, args, env) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })

// Xcode itself: DEVELOPER_DIR when it's set, else the one selected, else /Applications/Xcode.app.
// The selected one is never changed.
function xcode() {
  const dirs = [process.env.DEVELOPER_DIR, (() => { try { return quiet('/usr/bin/xcode-select', ['-p']).trim() } catch { return '' } })(), '/Applications/Xcode.app/Contents/Developer']
  const dir = dirs.find((d) => d && fs.existsSync(path.join(d, 'usr', 'bin', 'xcodebuild')))
  if (!dir) fail('Xcode isn\'t installed. Get it from the Mac App Store (it\'s free), open it once, then run this again.')
  const env = { ...process.env, DEVELOPER_DIR: dir }
  const version = quiet('xcodebuild', ['-version'], env).match(/Xcode (\d+)(\.[\d.]+)?/)
  if (!version || Number(version[1]) < MIN_XCODE) fail(`this is Xcode ${version?.[1] || '?'}${version?.[2] || ''} (${dir}); the App Store takes apps from Xcode ${MIN_XCODE} or later. Update it from the Mac App Store.`)
  if (!/iphoneos\d/.test(quiet('xcodebuild', ['-showsdks'], env))) fail('Xcode has no iOS platform yet. In Xcode › Settings › Components, get iOS (or run: xcodebuild -downloadPlatform iOS), then run this again.')
  return { dir, env, version: `${version[1]}${version[2] || ''}` }
}

// XcodeGen: on the PATH (brew install xcodegen), or the release CI uses, fetched once and checked.
async function xcodegen(env) {
  try { return quiet('/usr/bin/which', ['xcodegen'], env).trim() } catch {}
  const dir = path.join(IOS, 'build', 'tools')
  const bin = path.join(dir, 'xcodegen', 'bin', 'xcodegen')
  if (fs.existsSync(bin)) return bin
  say(`Getting XcodeGen, once (${XCODEGEN.url})...`)
  const res = await fetch(XCODEGEN.url)
  if (!res.ok) fail(`couldn't download XcodeGen (HTTP ${res.status}). Install it with: brew install xcodegen`)
  const zip = Buffer.from(await res.arrayBuffer())
  if (crypto.createHash('sha256').update(zip).digest('hex') !== XCODEGEN.sha256) fail('the XcodeGen download isn\'t the one expected (its checksum differs). Install it with: brew install xcodegen')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'xcodegen.zip'), zip)
  execFileSync('/usr/bin/ditto', ['-x', '-k', path.join(dir, 'xcodegen.zip'), dir])
  return bin
}

// Who signs: the API key, or an Apple account in Xcode that's on the project's team.
function signer(team, key) {
  if (key) return `the App Store Connect API key ${process.env.ASC_KEY_ID}`
  let teams = []
  try { teams = xcodeTeams(JSON.parse(execFileSync('/bin/sh', ['-c', 'defaults export com.apple.dt.Xcode - | plutil -extract IDEProvisioningTeamByIdentifier json -o - -'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))) } catch {}
  const how = 'Open Xcode › Settings › Accounts, click + › Apple Account and sign in with the Apple ID of the Apple Developer account, then run this again. (Or use an App Store Connect API key: mobile/README.md says how.)'
  if (!teams.length) fail(`no Apple account is signed in to Xcode. ${how}`)
  const ours = teams.find((t) => t.teamID === team)
  if (!ours) fail(`the Apple account${teams.length > 1 ? 's' : ''} in Xcode ${teams.length > 1 ? 'aren\'t' : 'isn\'t'} on team ${team}, which signs Bridge AI (${teams.map((t) => t.teamID).join(', ')}). ${how}`)
  if (ours.free) fail(`team ${team} is a free (Personal Team) account here; uploading needs the Apple Developer Program membership. ${how}`)
  return `${ours.teamName} (${team}), signed in to Xcode`
}

function run(cmd, args, env, what) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  fs.mkdirSync(OUT, { recursive: true })
  const log = path.join(OUT, `${what.replace(/\W+/g, '-')}.log`)
  fs.writeFileSync(log, out)
  if (r.status !== 0) {
    const errors = [...new Set(out.split('\n').filter((l) => /error:|\berror\b.*:/i.test(l)).map((l) => l.trim()))].slice(-8)
    console.error(errors.join('\n'))
    // What Apple usually says the first time, and what to do.
    if (/no devices|has no devices/i.test(out)) fail(`${what} failed: the team has no iPhone registered for Xcode's development profile. Connect your iPhone to this Mac once (USB, or Xcode › Window › Devices and Simulators), then run this again. The whole output is in ${log}`)
    if (/No suitable application records|application record|Could not find app|app record/i.test(out)) fail(`${what} failed: App Store Connect has no app for dev.bridge-ai.phone yet. Make it first (My Apps › + › New App), then run this again. The whole output is in ${log}`)
    if (/required agreement|agreement is missing|has expired.*agreement|agreement.*not.*accepted/i.test(out)) fail(`${what} failed: Apple has an agreement waiting. Accept it in App Store Connect (Business) or on developer.apple.com (Account), then run this again. The whole output is in ${log}`)
    if (/cloud signing permission|not permitted to (create|access)|insufficient (permissions|privileges)|NOT_AUTHORIZED|FORBIDDEN/i.test(out)) fail(`${what} failed: this Apple ID or API key can't make the distribution certificate. It needs the Account Holder or Admin role (an API key with Admin access). The whole output is in ${log}`)
    if (/higher version than that of the previously approved|train.*closed|Invalid Pre-Release Train|is not available for this version/i.test(out)) fail(`${what} failed: version ${project().version} is already approved or in review. Raise MARKETING_VERSION in mobile/ios/project.yml, then run this again. The whole output is in ${log}`)
    if (/bundle version must be higher|CFBundleVersion.*(higher|previously)|redundant binary upload/i.test(out)) fail(`${what} failed: App Store Connect already has this build number; run this again for a new one. The whole output is in ${log}`)
    fail(`${what} failed. The whole output is in ${log}`)
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const unsigned = args.includes('--unsigned')
  if (process.platform !== 'darwin') fail('the iPhone app is built on a Mac, with Xcode.')
  const { version, targets } = project()
  const team = targets.BridgeAI?.team
  if (!team || Object.values(targets).some((t) => t.team !== team || t.style !== 'Automatic')) fail('mobile/ios/project.yml should give every target the same DEVELOPMENT_TEAM, with CODE_SIGN_STYLE Automatic.')
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  const key = apiKey()
  if (key?.error) fail(key.error)

  const x = xcode()
  say(`Xcode ${x.version} (${x.dir})`)
  const gen = await xcodegen(x.env)
  say(`XcodeGen: ${gen}`)
  if (!unsigned) say(`Signing as ${signer(team, key)}`)
  if (version !== pkg) say(`Note: the iPhone app is version ${version} (mobile/ios/project.yml) and package.json is ${pkg}. That's fine for a phone-only update; raise MARKETING_VERSION for a new App Store version.`)
  if (check) return say(`\nReady to archive and upload Bridge AI ${version}: npm run mobile:ios:release`)

  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'vite'))) fail('the repo\'s dependencies aren\'t installed: npm ci, then run this again.')
  say('\nBuilding the demo and Cloud Agents (bundled in the app)...')
  const npm = (script, out) => run('npm', ['run', '--silent', script, '--', '--outDir', path.join(IOS, 'build', 'bundled', out), '--emptyOutDir', '--logLevel', 'warn'], x.env, script)
  npm('demo:build', 'demo')
  npm('cloud:build', 'cloud')
  say('Making the Xcode project...')
  run(gen, ['generate', '--spec', path.join(IOS, 'project.yml'), '--project', IOS, '--quiet'], x.env, 'xcodegen')

  const build = buildNumber()
  const day = new Date().toISOString().slice(0, 10)
  // Where Xcode keeps its own archives, so it's in Window › Organizer too.
  const archive = unsigned ? path.join(OUT, `Bridge AI ${version} (${build}) unsigned.xcarchive`) : path.join(os.homedir(), 'Library', 'Developer', 'Xcode', 'Archives', day, `Bridge AI ${version} (${build}).xcarchive`)
  const options = path.join(OUT, 'ExportOptions.plist')
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(options, exportOptions(team))
  const cmds = commands({ build, archive, options, exportPath: path.join(OUT, 'upload'), auth: key?.args, unsigned })

  say(`Archiving Bridge AI ${version} (${build}) for iPhone and iPad, in Release${unsigned ? ', unsigned' : ''}. A few minutes...`)
  run('xcodebuild', cmds.archive, x.env, 'archive')
  say(`Archived: ${archive}`)
  if (unsigned) return say('\nIt builds. Nothing was signed or uploaded (--unsigned).')

  say('Uploading to App Store Connect (Xcode signs it for the App Store first)...')
  run('xcodebuild', cmds.upload, x.env, 'upload')
  say(`
Uploaded Bridge AI ${version} (${build}) to App Store Connect.

Next:
  1. In 5 to 30 minutes it's processed. Apple emails the account, and it shows in
     https://appstoreconnect.apple.com/apps › Bridge AI › TestFlight.
  2. TestFlight › Internal Testing: add yourself, then install it with the TestFlight app on your iPhone.
  3. When it's good: Distribution › the ${version} version › Build › pick ${build}, then Add for Review.

The archive is in Xcode › Window › Organizer too. What's left is in mobile/README.md › Releasing to the App Store.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => fail(e.stack || String(e)))
