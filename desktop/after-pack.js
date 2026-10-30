// After the Mac app is put together and before it's signed: the Helper, which the server runs on
// (main.js), gets the app's reasons for asking for your calendars, the mic and a call's sound. macOS
// takes the reason from the app a question comes from and turns one down without asking when that
// app gives none, so this keeps a question from the server's helpers (bridgecal, calltap) answerable
// whichever of the two macOS counts it as.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'darwin') return
  const name = ctx.packager.appInfo.productFilename
  const plist = path.join(ctx.appOutDir, `${name}.app`, 'Contents', 'Frameworks', `${name} Helper.app`, 'Contents', 'Info.plist')
  const reasons = Object.entries(ctx.packager.config.mac?.extendInfo || {}).filter(([k]) => /UsageDescription$/.test(k))
  for (const [k, v] of reasons) execFileSync('plutil', ['-replace', k, '-string', String(v), plist])
}
