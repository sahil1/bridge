// Puts the relay together as one module for Cloudflare: worker.js plus the phone page's files.
// Bridge AI uploads it when you connect Cloudflare; `node relay/build.js out.js` writes it for
// trying it locally with `wrangler dev`.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '..')
const TEXT = ['index.html', 'shell.js', 'sw.js', 'link.js', 'manifest.webmanifest']
const ICONS = ['icon-512.png', 'apple-touch-icon.png', 'mark.svg']

export function bundle() {
  const files = {}
  for (const f of TEXT) files[f] = { text: fs.readFileSync(path.join(DIR, 'web', f), 'utf8') }
  for (const f of ICONS) {
    const p = [path.join(ROOT, 'dist', f), path.join(ROOT, 'public', f)].find((x) => fs.existsSync(x))
    if (p) files[f] = f.endsWith('.svg') ? { text: fs.readFileSync(p, 'utf8') } : { b64: fs.readFileSync(p).toString('base64') }
  }
  const worker = fs.readFileSync(path.join(DIR, 'worker.js'), 'utf8')
  // The build is a hash of what goes in, so Bridge AI can tell when your relay needs updating.
  const build = crypto.createHash('sha256').update(worker).update(JSON.stringify(files)).digest('hex').slice(0, 12)
  return { build, code: `const FILES = ${JSON.stringify(files)}\nconst RELAY_BUILD = ${JSON.stringify(build)}\n${worker}` }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || path.join(DIR, 'dist', 'worker.js')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const { build, code } = bundle()
  fs.writeFileSync(out, code)
  console.log(`${out} (build ${build}, ${(code.length / 1024).toFixed(0)} KB)`)
}
