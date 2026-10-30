// Signs the Mac app (electron-builder's mac.sign) the best way this computer can:
//   A Developer ID Application certificate (Apple's, from a paid developer account): what Apple
//     notarizes, so the app opens with no warning. Signed with the hardened runtime, the entitlements
//     in entitlements.mac.plist and Apple's secure timestamp; electron-builder then notarizes it when
//     it's told how (APPLE_KEYCHAIN_PROFILE on a Mac, APPLE_API_KEY, _ID and _ISSUER on GitHub).
//   Bridge AI's own self-signed certificate (scripts/signing.js makes one). macOS remembers what you
//     allowed (the mic, Calendar, your folders, the call's sound) by the app's signature. Ad hoc, that
//     changes with every build, so each update asks again; signed with the same certificate every
//     time, it doesn't. macOS doesn't need to trust it for this, only to see the same one.
//   Ad hoc, as before, with neither (someone else building it).
// Only a Developer ID build gets the hardened runtime: without a team the app couldn't load its own
// Electron framework under it.
//
// Where the certificate comes from, first found: BRIDGE_SIGN_P12 (the .p12, base64) and
// BRIDGE_SIGN_PASSWORD (GitHub Actions), a Developer ID in your login keychain (Xcode › Settings ›
// Accounts › Manage Certificates makes one), or ~/.bridge-ai-signing/bridge-ai.p12 with its password
// in your login keychain.
//
// A .p12 goes in a keychain of its own for the build, on your keychain list only while signing (older
// macOS's codesign looks there even when told which keychain), then it's deleted. There's nothing
// to allow.
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const LOCAL = path.join(os.homedir(), '.bridge-ai-signing', 'bridge-ai.p12')
const SERVICE = 'Bridge AI signing'
const DEVELOPER_ID = /\b([0-9A-F]{40}) "(Developer ID Application: [^"]+)"/
const security = (...args) => execFileSync('/usr/bin/security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function given() {
  return process.env.BRIDGE_SIGN_P12 ? { p12: Buffer.from(process.env.BRIDGE_SIGN_P12, 'base64'), password: process.env.BRIDGE_SIGN_PASSWORD || '' } : null
}
function local() {
  if (!fs.existsSync(LOCAL)) return null
  try { return { p12: fs.readFileSync(LOCAL), password: security('find-generic-password', '-s', SERVICE, '-a', 'p12', '-w').trim() } } catch { return null }
}
// A Developer ID in the keychains macOS searches (valid ones: not expired), or in the build's own
// keychain (by name: its chain needn't be checkable there): { hash, name }, or null.
function developerId(keychain) {
  try {
    const m = DEVELOPER_ID.exec(security('find-identity', ...(keychain ? ['-p', 'codesigning', keychain] : ['-v', '-p', 'codesigning'])))
    return m ? { hash: m[1], name: m[2] } : null
  } catch { return null }
}

module.exports = async function sign(opts) {
  const { signAsync } = await import('@electron/osx-sign')
  const per = opts.optionsForFile
  // Each file's options from electron-builder (the hardened runtime, the entitlements), plus these.
  const withEach = (extra) => (file) => ({ ...(per ? per(file) : {}), ...extra })
  const fromEnv = given()
  const dev = fromEnv ? null : developerId()
  if (dev) {
    console.log(`  • signing with ${dev.name}`)
    return signAsync({ ...opts, identity: dev.hash })
  }
  const cert = fromEnv || local()
  if (!cert) {
    console.log('  • signing ad hoc (no Bridge AI certificate here: node scripts/signing.js create makes one)')
    return signAsync({ ...opts, optionsForFile: withEach({ hardenedRuntime: false }) })
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sign-'))
  const keychain = path.join(tmp, 'sign.keychain-db')
  const pass = crypto.randomBytes(16).toString('hex')
  const listed = security('list-keychains', '-d', 'user').split('\n').map((l) => l.trim().replace(/^"|"$/g, '')).filter(Boolean)
  let added = false
  try {
    fs.writeFileSync(path.join(tmp, 'cert.p12'), cert.p12, { mode: 0o600 })
    security('create-keychain', '-p', pass, keychain)
    security('set-keychain-settings', keychain) // no locking mid-build
    security('unlock-keychain', '-p', pass, keychain)
    security('import', path.join(tmp, 'cert.p12'), '-k', keychain, '-P', cert.password, '-T', '/usr/bin/codesign')
    security('set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', pass, keychain)
    security('list-keychains', '-d', 'user', '-s', keychain, ...listed)
    added = true
    const certDev = developerId(keychain)
    if (certDev) {
      console.log(`  • signing with ${certDev.name}`)
      await signAsync({ ...opts, identity: certDev.hash, keychain })
      return
    }
    const hash = /\b([0-9A-F]{40})\b/.exec(security('find-identity', '-p', 'codesigning', keychain))?.[1]
    if (!hash) throw new Error('the Bridge AI certificate has no code signing identity')
    console.log(`  • signing with the Bridge AI certificate ${hash.slice(0, 8)}…`)
    // A self-signed certificate isn't one macOS trusts, so osx-sign is told not to check. No secure
    // timestamp either: that's Apple's server, over the network, and nothing here needs one.
    await signAsync({ ...opts, identity: hash, identityValidation: false, keychain, optionsForFile: withEach({ hardenedRuntime: false, timestamp: 'none' }) })
  } finally {
    if (added) try { security('list-keychains', '-d', 'user', '-s', ...listed) } catch { /* left as it was */ }
    try { security('delete-keychain', keychain) } catch { /* never made */ }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
