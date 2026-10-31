#!/usr/bin/env node
// Builds the meeting helpers into native/bin, or the folder given, each one file for Apple silicon
// and Intel Macs: calltap (the call's sound, native/calltap.swift), callwatch (which apps are on
// a call, native/callwatch.swift), bridgeocr (the text on a captured screen or in a PDF linked to
// a meeting, native/bridgeocr.swift), bridgespeech (speech to text on the Mac itself, with Apple's
// transcriber, native/bridgespeech.swift), bridgecal (asks macOS for your calendars,
// native/bridgecal.swift) and bridgekeys (the dictation key held down in any app, and pasting what you said there,
// native/bridgekeys.swift). Needs Xcode's command line tools (xcode-select --install). Elsewhere, or
// without them, meetings record your mic only, don't notice calls, and use what's on a screen or in
// a PDF as pictures and links only, and the dictation key from other apps is tapped, not held. bridgespeech needs the macOS 26 SDK (Xcode 26) to build; with an
// older one it's left out and meetings use whisper.cpp or a service.
//   node scripts/calltap.js [out-dir] [--only name]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const out = path.resolve(process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--only') || path.join(ROOT, 'native', 'bin'))
const strict = process.argv.includes('--strict')
if (process.platform !== 'darwin') { console.log('calltap: macOS only, skipped'); process.exit(0) }
fs.mkdirSync(out, { recursive: true })
let failed = false
// [name, oldest macOS it runs on, extra swiftc flags, optional (its build failing isn't a failure)]
const TOOLS = [['calltap', '14.2'], ['callwatch', '14.0'], ['bridgeocr', '13.0'], ['bridgespeech', '13.0', ['-parse-as-library'], true], ['bridgecal', '13.0'], ['bridgekeys', '13.0']]
for (const [name, macos, flags = [], optional = false] of TOOLS.filter(([n]) => !only || n === only)) {
  const src = path.join(ROOT, 'native', `${name}.swift`)
  const parts = []
  for (const arch of ['arm64', 'x86_64']) {
    const file = path.join(out, `${name}-${arch}`)
    const r = spawnSync('swiftc', ['-O', ...flags, '-target', `${arch}-apple-macos${macos}`, src, '-o', file], { stdio: optional ? ['ignore', 'inherit', 'pipe'] : 'inherit' })
    if (r.status !== 0) { console.warn(`${name}: couldn't build for ${arch}${optional ? ' (needs the macOS 26 SDK; left out)' : ''}`); if (!optional) failed = true; break }
    parts.push(file)
  }
  if (parts.length === 2) {
    const r = spawnSync('lipo', ['-create', '-output', path.join(out, name), ...parts], { stdio: 'inherit' })
    if (r.status !== 0) { console.warn(`${name}: lipo failed`); failed = true } else console.log(`${name}: built ${path.join(out, name)}`)
  }
  for (const p of parts) fs.rmSync(p, { force: true })
}
if (failed) { console.warn('calltap: meetings will record your mic only, or not notice calls'); process.exit(strict ? 1 : 0) }
