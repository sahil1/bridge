// After the Mac build (electron-builder's afterAllArtifactBuild): the disk images get the app's
// Developer ID signature, then Apple notarizes them and the ticket is stapled on, like the app inside.
// A .dmg is what people download, and Apple's advice is to notarize what they download: Gatekeeper
// then checks the image itself as it opens, even offline, instead of rejecting it ("no usable
// signature") and relying on the app inside. Notarized with the same settings electron-builder
// notarizes the app with (APPLE_API_KEY, _ID and _ISSUER on GitHub; APPLE_KEYCHAIN_PROFILE on a Mac).
// Without a Developer ID they're left as they are: a self-signed image is no better than none.
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { withIdentity } = require('./sign')

function notaryLogin() {
  const e = process.env
  if (e.APPLE_API_KEY && e.APPLE_API_KEY_ID && e.APPLE_API_ISSUER) return { appleApiKey: e.APPLE_API_KEY, appleApiKeyId: e.APPLE_API_KEY_ID, appleApiIssuer: e.APPLE_API_ISSUER }
  if (e.APPLE_ID && e.APPLE_APP_SPECIFIC_PASSWORD && e.APPLE_TEAM_ID) return { appleId: e.APPLE_ID, appleIdPassword: e.APPLE_APP_SPECIFIC_PASSWORD, teamId: e.APPLE_TEAM_ID }
  if (e.APPLE_KEYCHAIN_PROFILE) return { keychainProfile: e.APPLE_KEYCHAIN_PROFILE, ...(e.APPLE_KEYCHAIN ? { keychain: e.APPLE_KEYCHAIN } : {}) }
  return null
}

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
  const { notarize } = await import('@electron/notarize')
  // Both at once: each is a few minutes of waiting on Apple. Stapling is retried (a dropped connection).
  await Promise.all(dmgs.map(async (dmg) => {
    console.log(`  • notarizing ${path.basename(dmg)}`)
    await notarize({ appPath: dmg, ...login })
    console.log(`  • ${path.basename(dmg)} notarized and stapled`)
  }))
  return []
}
