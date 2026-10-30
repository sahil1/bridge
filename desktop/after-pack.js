// After the Mac app is put together and before it's signed: the Helper, which the server runs on
// (main.js), gets the app's reasons for asking for your calendars, the mic and a call's sound. macOS
// takes the reason from the app a question comes from and turns one down without asking when that
// app gives none, so this keeps a question from the server's helpers (bridgecal, calltap) answerable
// whichever of the two macOS counts it as.
// The other chip's packages go too (stage.js put both chips' in for the two Mac apps: sherpa-onnx,
// ccusage), so each app carries only the binaries it runs: any package that says it's for macOS on
// one chip, and not this app's.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function otherChips(dir, arch) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.name.startsWith('@')) { otherChips(p, arch); continue }
    let pkg = null
    try { pkg = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')) } catch { /* not a package */ }
    if (pkg?.os?.includes('darwin') && pkg.cpu?.length && !pkg.cpu.includes(arch)) { fs.rmSync(p, { recursive: true, force: true }); continue }
    otherChips(path.join(p, 'node_modules'), arch)
  }
}

exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'darwin') return
  const name = ctx.packager.appInfo.productFilename
  const arch = require('electron-builder').Arch[ctx.arch]
  otherChips(path.join(ctx.appOutDir, `${name}.app`, 'Contents', 'Resources', 'app-root', 'node_modules'), arch)
  const plist = path.join(ctx.appOutDir, `${name}.app`, 'Contents', 'Frameworks', `${name} Helper.app`, 'Contents', 'Info.plist')
  const reasons = Object.entries(ctx.packager.config.mac?.extendInfo || {}).filter(([k]) => /UsageDescription$/.test(k))
  for (const [k, v] of reasons) execFileSync('plutil', ['-replace', k, '-string', String(v), plist])
}
