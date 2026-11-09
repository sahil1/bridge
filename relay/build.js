// Puts the relay together as one module for Cloudflare: worker.js plus the phone page's files.
// Bridge AI uploads it when you connect Cloudflare; `node relay/build.js out.js` writes it for
// trying it locally with `wrangler dev`.
//
// `node relay/build.js --page <folder>` writes the phone page's files alone, as the relay serves
// them, into a folder: the Android app's build carries that copy (mobile/android), so the page it
// runs never comes from a relay.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
export const TEXT = ['index.html', 'shell.js', 'sw.js', 'link.js', 'offline.js', 'manifest.webmanifest']
const ICONS = ['icon-512.png', 'apple-touch-icon.png', 'mark.svg']
// The Bridge AI version these files are from, which the relay says at /_relay/health, so a computer
// can check the page it serves against that version's (server/relaycheck.js).
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

// The service worker can't import modules in every browser, so it gets link.js as a plain script
// too (for answering a notification's buttons): self.bridgeLink.
export function linkSw(link) {
  const names = [...link.matchAll(/^export (?:async )?(?:const|function|class) (\w+)/gm)].map((m) => m[1])
  return `self.bridgeLink = (() => {\n${link.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} }\n})()\n`
}

// The page's files, as the relay serves them: { name: { text } | { b64 } }.
export function pageFiles() {
  const files = {}
  for (const f of TEXT) files[f] = { text: fs.readFileSync(path.join(DIR, 'web', f), 'utf8') }
  files['link-sw.js'] = { text: linkSw(files['link.js'].text) }
  for (const f of ICONS) {
    const p = [path.join(ROOT, 'dist', f), path.join(ROOT, 'public', f)].find((x) => fs.existsSync(x))
    if (p) files[f] = f.endsWith('.svg') ? { text: fs.readFileSync(p, 'utf8') } : { b64: fs.readFileSync(p).toString('base64') }
  }
  return files
}

export function bundle() {
  const files = pageFiles()
  const worker = fs.readFileSync(path.join(DIR, 'worker.js'), 'utf8')
  // The build is a hash of what goes in, so Bridge AI can tell when your relay needs updating. (The
  // version isn't in it: a release that doesn't change the relay doesn't make yours update.)
  const build = crypto.createHash('sha256').update(worker).update(JSON.stringify(files)).digest('hex').slice(0, 12)
  return { build, version: VERSION, code: `const FILES = ${JSON.stringify(files)}\nconst RELAY_BUILD = ${JSON.stringify(build)}\nconst RELAY_VERSION = ${JSON.stringify(VERSION)}\n${worker}` }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--page') {
    const out = process.argv[3]
    if (!out) throw new Error('Usage: node relay/build.js --page <folder>')
    fs.rmSync(out, { recursive: true, force: true })
    fs.mkdirSync(out, { recursive: true })
    const files = pageFiles()
    for (const [name, f] of Object.entries(files)) fs.writeFileSync(path.join(out, name), f.b64 ? Buffer.from(f.b64, 'base64') : f.text)
    console.log(`${out} (the phone page, ${Object.keys(files).length} files, Bridge AI ${VERSION})`)
  } else {
    const out = process.argv[2] || path.join(DIR, 'dist', 'worker.js')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const { build, code } = bundle()
    fs.writeFileSync(out, code)
    console.log(`${out} (build ${build}, ${(code.length / 1024).toFixed(0)} KB)`)
  }
}
