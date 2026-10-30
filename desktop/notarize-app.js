// After the Mac app is signed (electron-builder's afterSign): Apple notarizes it and the ticket is
// stapled on, before the .zip and the disk image are made from it. electron-builder would do this
// itself, but it fails the whole build when stapling can't reach Apple's server (error 68, a
// dropped connection), and a second build met the same: 3.6.0's release failed twice so. Here
// stapling gets several tries, as for the disk images (notarize-dmg.js), and an app notarized but
// not stapled still opens: Gatekeeper finds its ticket online. Only a Developer ID build is
// notarized, with the same settings (APPLE_API_KEY, _ID and _ISSUER on GitHub).
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { notaryLogin, notarize } = require('./notarize-dmg')

exports.default = async ({ electronPlatformName, appOutDir, packager }) => {
  if (electronPlatformName !== 'darwin') return
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
  const signed = /Authority=Developer ID Application/.test(spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' }).stderr || '')
  const login = signed && notaryLogin()
  if (!login) return console.log(`  • ${path.basename(app)} not notarized (${signed ? 'no notarization settings' : 'no Developer ID'})`)
  // Apple takes an app as a .zip of it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-notarize-'))
  try {
    const zip = path.join(dir, `${path.basename(app, '.app')}.zip`)
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip])
    await notarize(app, login, zip)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
