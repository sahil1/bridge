// After the Mac app is put together and before it's signed: the Helper, which the server runs on
// (main.js), gets the app's reasons for asking for your calendars, the mic and a call's sound. macOS
// takes the reason from the app a question comes from and turns one down without asking when that
// app gives none, so this keeps a question from the server's helpers (bridgecal, calltap) answerable
// whichever of the two macOS counts it as.
// The other chip's sherpa-onnx package goes too (stage.js put both in for the two Mac apps), so each
// app carries only the speech engine it runs.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'darwin') return
  const name = ctx.packager.appInfo.productFilename
  const arch = require('electron-builder').Arch[ctx.arch]
  const modules = path.join(ctx.appOutDir, `${name}.app`, 'Contents', 'Resources', 'app-root', 'node_modules')
  for (const other of ['arm64', 'x64'].filter((a) => a !== arch)) fs.rmSync(path.join(modules, `sherpa-onnx-darwin-${other}`), { recursive: true, force: true })
  const plist = path.join(ctx.appOutDir, `${name}.app`, 'Contents', 'Frameworks', `${name} Helper.app`, 'Contents', 'Info.plist')
  const reasons = Object.entries(ctx.packager.config.mac?.extendInfo || {}).filter(([k]) => /UsageDescription$/.test(k))
  for (const [k, v] of reasons) execFileSync('plutil', ['-replace', k, '-string', String(v), plist])
}
