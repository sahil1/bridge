// After the Mac build (electron-builder's afterAllArtifactBuild): the disk images get the app's
// Developer ID signature, then Apple notarizes them and the ticket is stapled on, like the app inside.
// A .dmg is what people download, and Apple's advice is to notarize what they download: Gatekeeper
// then checks the image itself as it opens, even offline, instead of rejecting it ("no usable
// signature") and relying on the app inside. Notarized with the same settings electron-builder
// notarizes the app with (APPLE_API_KEY, _ID and _ISSUER on GitHub; APPLE_KEYCHAIN_PROFILE on a Mac).
// Without a Developer ID they're left as they are: a self-signed image is no better than none.
const { execFile, execFileSync } = require('node:child_process')
const path = require('node:path')
const { promisify } = require('node:util')
const { withIdentity } = require('./sign')

const run = promisify(execFile)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// notarytool's sign-in, from electron-builder's own settings.
function notaryLogin() {
  const e = process.env
  if (e.APPLE_API_KEY && e.APPLE_API_KEY_ID && e.APPLE_API_ISSUER) return ['--key', e.APPLE_API_KEY, '--key-id', e.APPLE_API_KEY_ID, '--issuer', e.APPLE_API_ISSUER]
  if (e.APPLE_ID && e.APPLE_APP_SPECIFIC_PASSWORD && e.APPLE_TEAM_ID) return ['--apple-id', e.APPLE_ID, '--password', e.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', e.APPLE_TEAM_ID]
  if (e.APPLE_KEYCHAIN_PROFILE) return ['--keychain-profile', e.APPLE_KEYCHAIN_PROFILE, ...(e.APPLE_KEYCHAIN ? ['--keychain', e.APPLE_KEYCHAIN] : [])]
  return null
}

// Notarized, then the ticket stapled on. submit: what goes to Apple when it isn't the file itself
// (an app goes as a .zip of it: notarize-app.js).
async function notarize(dmg, login, submit = dmg) {
  const name = path.basename(dmg)
  console.log(`  • notarizing ${name}`)
  // (Its own error, not the command's: that would show the sign-in.)
  const r = await run('xcrun', ['notarytool', 'submit', submit, ...login, '--wait', '--output-format', 'json'], { maxBuffer: 1 << 20 })
    .then(({ stdout }) => JSON.parse(stdout), (e) => { throw new Error(`notarytool couldn't notarize ${name}: ${String(e.stdout || e.stderr || '').trim().slice(-1000)}`) })
  if (r.status !== 'Accepted') throw new Error(`Apple didn't notarize ${name} (${r.status}); see why with: xcrun notarytool log ${r.id}`)
  // Stapling fetches the ticket from Apple, whose server drops the connection now and then (error 68)
  // and is back a minute later, so it gets several tries over a few minutes. Still unstapled, the
  // image is notarized all the same: Gatekeeper finds the ticket online. Not worth failing a release.
  for (let i = 1; i <= 5; i++) {
    try {
      execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'pipe' })
      console.log(`  • ${name} notarized and stapled`)
      return
    } catch { if (i < 5) await sleep(i * 20000) }
  }
  console.log(`::warning::${name} is notarized, but its ticket couldn't be stapled (Apple's server didn't answer); Gatekeeper will look it up online`)
}
exports.notaryLogin = notaryLogin
exports.notarize = notarize

exports.default = async ({ artifactPaths }) => {
  const dmgs = artifactPaths.filter((f) => f.endsWith('.dmg'))
  if (!dmgs.length) return []
  const signed = await withIdentity(async ({ kind, hash, name, keychain }) => {
    if (kind !== 'developer-id') return false
    for (const dmg of dmgs) {
      console.log(`  • signing ${path.basename(dmg)} with ${name}`)
      execFileSync('codesign', ['--sign', hash, '--timestamp', ...(keychain ? ['--keychain', keychain] : []), dmg], { stdio: 'inherit' })
    }
    return true
  })
  const login = signed && notaryLogin()
  if (!login) {
    console.log(`  • disk images not notarized (${signed ? 'no notarization settings' : 'no Developer ID'})`)
    return []
  }
  // Both at once: each is a few minutes of waiting on Apple.
  await Promise.all(dmgs.map((dmg) => notarize(dmg, login)))
  return []
}
