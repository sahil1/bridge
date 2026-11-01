// What the App Store asks of the iPhone app (mobile/ios), checked from its files on any platform:
// its privacy manifest says no tracking and no data collected (as mobile/README.md answers App
// Privacy), and gives an approved reason for each kind of required reason API the app's own code
// uses, and the widget's; iOS's question for the microphone says what it's for (dictation, voice
// notes, meetings) and so does PRIVACY.md; the start screen links to the privacy policy; and its
// pairing steps name a Settings section and a button the computer has. And what sends it to the App
// Store (npm run mobile:ios:release, scripts/ios-release.js): export compliance answered in
// Info.plist, both targets signed by the team, the upload's options, a build number that only goes up,
// and an App Store Connect API key in place of an Xcode sign-in. The app itself is built for the iPhone
// Simulator in CI (.github/workflows/test.yml), where Xcode is.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checks, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('ios-app')
const IOS = path.join(ROOT, 'mobile', 'ios')
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8')
const exists = (...p) => fs.existsSync(path.join(...p))

// An XML property list as plain values (dict, array, string, integer, true, false).
function plist(xml) {
  const toks = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, '').match(/<[^>]+>|[^<]+/g).map((x) => x.trim()).filter(Boolean)
  let i = 0
  const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const text = (tag) => { if (toks[i] === `</${tag}>`) { i++; return '' } const v = unxml(toks[i++]); i++; return v }
  const value = () => {
    const t = toks[i++]
    if (t === '<dict>') { const o = {}; while (toks[i] !== '</dict>') { i++; const k = unxml(toks[i++]); i++; o[k] = value() } i++; return o }
    if (t === '<dict/>') return {}
    if (t === '<array>') { const a = []; while (toks[i] !== '</array>') a.push(value()); i++; return a }
    if (t === '<array/>') return []
    if (t === '<true/>') return true
    if (t === '<false/>') return false
    if (t === '<string>') return text('string')
    if (t === '<string/>') return ''
    if (t === '<integer>') return Number(text('integer'))
    throw new Error(`unexpected ${t}`)
  }
  if (toks[i] === '<plist version="1.0">') i++
  return value()
}

// Apple's required reason APIs (developer.apple.com, "Describing use of required reason API"): what
// in Swift uses each kind, and the reasons Apple accepts for it.
const KINDS = {
  NSPrivacyAccessedAPICategoryUserDefaults: { uses: /\bUserDefaults\b|@AppStorage/, reasons: ['CA92.1', '1C8F.1', 'C56D.1', 'AC6B.1'] },
  NSPrivacyAccessedAPICategoryFileTimestamp: { uses: /\b(creationDate|modificationDate|contentModificationDate|fileModificationDate|creationDateKey|contentModificationDateKey|attributesOfItem|getattrlist|fstat|lstat)\b|\bstat\(/, reasons: ['DDA9.1', 'C617.1', '3B52.1', '0A2A.1'] },
  NSPrivacyAccessedAPICategorySystemBootTime: { uses: /\b(systemUptime|mach_absolute_time)\b/, reasons: ['35F9.1', '8FFB.1', '3D61.1'] },
  NSPrivacyAccessedAPICategoryDiskSpace: { uses: /\b(volumeAvailableCapacity\w*|volumeTotalCapacity\w*|systemFreeSize|systemSize|statfs|statvfs|fstatfs|fstatvfs)\b/, reasons: ['85F4.1', 'E174.1', '7D9E.1', 'B728.1'] },
  NSPrivacyAccessedAPICategoryActiveKeyboards: { uses: /\bactiveInputModes\b/, reasons: ['3EC4.1', '54BD.1'] },
}
const swift = (...dirs) => dirs.flatMap((d) => fs.readdirSync(path.join(IOS, d)).filter((f) => f.endsWith('.swift')).map((f) => read(IOS, d, f).replace(/\/\/.*$/gm, ''))).join('\n')
const used = (code) => Object.keys(KINDS).filter((k) => KINDS[k].uses.test(code))

try {
  // ---------- The privacy manifest ----------
  const at = path.join(IOS, 'BridgeAI', 'PrivacyInfo.xcprivacy')
  ok(fs.existsSync(at), 'the app has a privacy manifest (BridgeAI/PrivacyInfo.xcprivacy), in its own folder so the build puts it in the app')
  const m = fs.existsSync(at) ? plist(fs.readFileSync(at, 'utf8')) : {}
  ok(m.NSPrivacyTracking === false && Array.isArray(m.NSPrivacyTrackingDomains) && !m.NSPrivacyTrackingDomains.length, 'it says the app doesn\'t track, with no tracking domains', m)
  ok(Array.isArray(m.NSPrivacyCollectedDataTypes) && !m.NSPrivacyCollectedDataTypes.length, 'and collects no data, as mobile/README.md answers App Privacy (Data Not Collected)', m.NSPrivacyCollectedDataTypes)
  const reasons = (x) => Object.fromEntries((x.NSPrivacyAccessedAPITypes || []).map((d) => [d.NSPrivacyAccessedAPIType, d.NSPrivacyAccessedAPITypeReasons || []]))
  const fits = (code, declared) => code.every((k) => declared[k]?.length && declared[k].every((r) => KINDS[k].reasons.includes(r))) && Object.keys(declared).every((k) => code.includes(k))
  // The app (UserDefaults: which computer is showing), and the widget, a bundle of its own, which
  // would need a manifest of its own for any it used (it uses none).
  const app = used(swift('BridgeAI', 'Shared'))
  const declared = reasons(m)
  const widget = used(swift('Widgets', 'Shared'))
  const wAt = path.join(IOS, 'Widgets', 'PrivacyInfo.xcprivacy')
  const wDeclared = fs.existsSync(wAt) ? reasons(plist(fs.readFileSync(wAt, 'utf8'))) : {}
  ok(app.includes('NSPrivacyAccessedAPICategoryUserDefaults') && fits(app, declared) && fits(widget, wDeclared),
    `each kind of required reason API the app's code uses (${app.map((k) => k.replace('NSPrivacyAccessedAPICategory', '')).join(', ')}) has an approved reason in its manifest, and only those; the widget's (${widget.length ? widget.join(', ') : 'none'}) in its own`, { app, declared, widget, wDeclared })

  // ---------- What iOS says when it asks ----------
  const info = plist(read(IOS, 'BridgeAI', 'Info.plist'))
  const mic = info.NSMicrophoneUsageDescription || ''
  ok(/\bAVCaptureDevice\b/.test(swift('BridgeAI')) && /pairing code/i.test(info.NSCameraUsageDescription || '') && /dictat/i.test(mic) && /voice note/i.test(mic) && /meeting/i.test(mic),
    'iOS\'s questions say what each is for: the camera the pairing code (the scanner), the microphone all three things that record on the phone (dictation, voice notes, meetings)', { camera: info.NSCameraUsageDescription, mic })
  ok(/computer/i.test(mic) && /encrypted/i.test(mic), 'and says where the sound goes: end-to-end encrypted to your computer', mic)
  const phoneApps = read(ROOT, 'PRIVACY.md').split('## The phone apps')[1]?.split('\n## ')[0] || ''
  const micLine = phoneApps.split('\n- ').find((l) => /^\*\*Microphone\*\*/.test(l)) || ''
  ok(/dictat/i.test(micLine) && /voice note/i.test(micLine) && /meeting/i.test(micLine), 'PRIVACY.md\'s phone apps say the same of the microphone', micLine)

  // ---------- The start screen (relay/web, which the app serves) ----------
  const page = read(ROOT, 'relay', 'web', 'index.html')
  const pair = page.split('<section id="pair"')[1]?.split('</section>')[0] || ''
  ok(/<a [^>]*href="https:\/\/github\.com\/sahil1\/bridge\/blob\/main\/PRIVACY\.md"/.test(pair) && exists(ROOT, 'PRIVACY.md'), 'the first screen links to the privacy policy (App Review 5.1.1: in the app, easy to find)')
  const section = /Settings › ([^<]+)<\/b>/.exec(pair)?.[1]
  const button = /click <b>([^<]+)<\/b>/.exec(pair)?.[1]
  const sections = [...read(ROOT, 'src', 'components', 'Settings.jsx').matchAll(/label: tx\('([^']+)'\)/g)].map((x) => x[1])
  ok(!!section && sections.includes(section.replace(/&amp;/g, '&')), `its pairing steps name a Settings section the computer has (${section})`, sections)
  ok(!!button && read(ROOT, 'src', 'components', 'settings', 'Relay.jsx').includes(`t('${button}')`), `and the button there (${button})`)

  // ---------- Sending it to the App Store (npm run mobile:ios:release) ----------
  // Export compliance answered once, in Info.plist: the app uses only iOS's own encryption
  // (mobile/README.md › Export compliance), so App Store Connect doesn't ask at each upload.
  ok(info.ITSAppUsesNonExemptEncryption === false, 'Info.plist answers export compliance: ITSAppUsesNonExemptEncryption is false (only the encryption within iOS)', info.ITSAppUsesNonExemptEncryption)
  const rel = exists(ROOT, 'scripts', 'ios-release.js') ? await import(pathToFileURL(path.join(ROOT, 'scripts', 'ios-release.js')).href) : null
  ok(!!rel, 'scripts/ios-release.js is there, and loads without running (it only runs as a command)')
  const pkg = JSON.parse(read(ROOT, 'package.json'))
  ok(pkg.scripts['mobile:ios:release'] === 'node scripts/ios-release.js', 'npm run mobile:ios:release runs it', pkg.scripts['mobile:ios:release'])
  // Without the script, a stand-in whose answers fail each check below, rather than skip them.
  const R = rel || { project: () => ({ version: '', targets: {} }), exportOptions: () => '<plist version="1.0"><dict/></plist>', commands: () => ({ archive: [], upload: [] }), buildNumber: () => '', apiKey: () => undefined, xcodeTeams: () => [], XCODEGEN: {} }
  // Both targets signed by the project's team, with Xcode making the certificates and profiles.
  const { version, targets } = R.project(read(IOS, 'project.yml'))
  ok(Object.keys(targets).sort().join() === 'BridgeAI,Widgets' && Object.values(targets).every((t) => /^[A-Z0-9]{10}$/.test(t.team) && t.team === targets.BridgeAI?.team && t.style === 'Automatic'),
    `project.yml gives the app and the widget the same team (${targets.BridgeAI?.team}), with Automatic signing`, targets)
  ok(version === read(IOS, 'project.yml').match(/MARKETING_VERSION: "([\d.]+)"/)?.[1], `and the release reads its version (${version})`)
  // Uploaded to App Store Connect, signed by that team.
  const opts = plist(R.exportOptions(targets.BridgeAI?.team))
  ok(opts.method === 'app-store-connect' && opts.destination === 'upload' && opts.teamID === targets.BridgeAI?.team && opts.signingStyle === 'automatic' && opts.manageAppVersionAndBuildNumber === false,
    'its ExportOptions.plist uploads to App Store Connect (method app-store-connect, destination upload), signed by the team, automatically, with the build number it set', opts)
  const c = R.commands({ build: '20261101.143005', archive: '/a.xcarchive', options: '/o.plist', exportPath: '/up' })
  ok(c.archive[0] === 'archive' && c.archive.includes('-allowProvisioningUpdates') && c.archive.join(' ').includes('-destination generic/platform=iOS') && c.archive.includes('-configuration') && c.archive.includes('CURRENT_PROJECT_VERSION=20261101.143005') && !c.archive.includes('CODE_SIGNING_ALLOWED=NO'),
    'it archives Release for any iPhone, with the build number, letting Xcode make what signing needs', c.archive)
  ok(c.upload[0] === '-exportArchive' && c.upload.includes('-allowProvisioningUpdates') && c.upload[c.upload.indexOf('-exportOptionsPlist') + 1] === '/o.plist', 'and uploads the archive with those options', c.upload)
  const u = R.commands({ build: '1.1', archive: '/a', options: '/o', exportPath: '/up', unsigned: true })
  ok(u.archive.includes('CODE_SIGNING_ALLOWED=NO') && !u.archive.includes('-allowProvisioningUpdates'), '--unsigned archives with no signing and no Apple account, to see it builds', u.archive)
  // Each upload's build number is higher than the last: later is higher, a second later, the
  // next day, the next year; all digits and dots, at most three numbers, as Apple takes.
  const times = ['2026-11-01T09:05:00Z', '2026-11-01T09:05:01Z', '2026-11-01T23:59:59Z', '2026-11-02T00:00:00Z', '2026-12-31T23:59:59Z', '2027-01-01T00:00:00Z']
  const nums = times.map((t) => R.buildNumber(new Date(t)))
  const higher = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) > (x[i] || 0); return false }
  ok(nums.every((n) => /^\d+(\.\d+){0,2}$/.test(n) && n.length <= 18) && nums.slice(1).every((n, i) => higher(nums[i], n)), 'each build number is higher than the one before, even a second later or across a new day or year', nums)
  // An App Store Connect API key in place of the Xcode sign-in: all three parts or a clear refusal.
  const p8 = path.join(ROOT, 'package.json') // a file that exists, standing in for the .p8
  const key = R.apiKey({ ASC_KEY_ID: 'ABC123DEFG', ASC_ISSUER_ID: '00000000-1111-2222-3333-444444444444', ASC_KEY_PATH: p8 })
  const partial = R.apiKey({ ASC_KEY_ID: 'ABC123DEFG' })
  ok(R.apiKey({}) === null && key?.args?.join(' ') === `-authenticationKeyPath ${p8} -authenticationKeyID ABC123DEFG -authenticationKeyIssuerID 00000000-1111-2222-3333-444444444444` && /ASC_ISSUER_ID/.test(partial?.error || ''),
    'with ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH it signs in with that API key; with none, as Xcode\'s account; with part of one, it says what\'s missing', { key, partial })
  const k = R.commands({ build: '1', archive: '/a', options: '/o', exportPath: '/up', auth: key?.args })
  ok(['archive', 'upload'].every((s) => c[s] && k[s].join(' ').includes((key?.args || ['no key']).join(' '))), 'and passes the key to both steps')
  ok(R.xcodeTeams({ 'A-1': [{ teamID: 'K6QK66LQDM', teamName: 'T', isFreeProvisioningTeam: false }], 'B-2': [{ teamID: 'X', teamName: 'P', isFreeProvisioningTeam: true }] }).map((t) => `${t.teamID}:${t.free}`).join() === 'K6QK66LQDM:false,X:true', 'it reads which teams the Apple accounts in Xcode are on, and which are free (Personal Team)')
  // XcodeGen, fetched when there's none: the release CI builds with, checked by the same checksum.
  const ci = read(ROOT, '.github', 'workflows', 'test.yml')
  ok(ci.includes(`XCODEGEN_URL: ${R.XCODEGEN.url}`) && ci.includes(`XCODEGEN_SHA256: ${R.XCODEGEN.sha256}`), 'the XcodeGen it fetches is the release CI pins, with the same checksum', R.XCODEGEN)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
}
process.exit(done().fail ? 1 : 0)
