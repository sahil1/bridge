#!/usr/bin/env node
// llama.cpp's llama-server (MIT), the runtime of the local model built into Bridge AI (server/llm.js),
// fetched at build time, never at run time: one pinned release, each file checked against the
// SHA-256 GitHub gives for it, and only what llama-server needs kept. Not in git: 13 to 41 MB a
// platform, and the Mac builds are only ad hoc signed, so the app signs them with its own identity
// (desktop/sign.js signs every binary in the app).
//   node scripts/llama.js <dir>                 this computer's build(s) into <dir>/<platform>-<arch>
//   node scripts/llama.js <dir> darwin-arm64 …  those builds
//   node scripts/llama.js <dir> --app           every build the desktop app made here carries (stage.js)
// Each folder gets build.json: the build, what it needs to run (macOS version, glibc) and its GPU path,
// which server/llm.js reads to decide where the local model is offered.
// The Linux and Windows builds load their processor and Vulkan parts when they start, so the Vulkan
// build runs on any computer, with the GPU where Vulkan is there. Windows on Arm gets its own Arm
// build beside the x64 one (the x64 app starts it there). Linux on Arm's needs glibc 2.38.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD = 'b11960' // llama.cpp 0.8.0, 28 October 2026
const URL = (asset) => `https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}/${asset}`
// From the release's own assets (GitHub's digest for each). macOS: what the binary's LC_BUILD_VERSION
// says; glibc: the newest GLIBC_ version its files ask for. gpu: what it can use.
export const BUILDS = {
  'darwin-arm64': { asset: `llama-${BUILD}-bin-macos-arm64.tar.gz`, sha256: '58e5a5e1d7c2bf66cedd9c29e0323f3e570660a70a1e2156d32eed08f4cc1e3c', macos: '13.3', gpu: 'metal' },
  // Metal is off in upstream's Intel build (on Intel and AMD Mac GPUs it gives wrong answers): the processor only.
  'darwin-x64': { asset: `llama-${BUILD}-bin-macos-x64.tar.gz`, sha256: 'd1e6c9ddcaed9a3b1bb8f3d946bdb3481c7b919357a4029dcb747762397f1da5', macos: '13.3', gpu: null },
  'win32-x64': { asset: `llama-${BUILD}-bin-win-vulkan-x64.zip`, sha256: 'bac6914b5e83523eb008c6789eaa12669f93fbc196c3b9e8237b6672323b33e9', gpu: 'vulkan' },
  'win32-arm64': { asset: `llama-${BUILD}-bin-win-cpu-arm64.zip`, sha256: '77349357c38da235bb0eed37bcc5ecf3efef21bb5dc42c2269589c0e71cfa00f', gpu: null },
  'linux-x64': { asset: `llama-${BUILD}-bin-ubuntu-vulkan-x64.tar.gz`, sha256: '164199e978304bb32a8a6c24b8efa015528ddf286821596eab676c90b375feac', glibc: '2.34', gpu: 'vulkan' },
  'linux-arm64': { asset: `llama-${BUILD}-bin-ubuntu-arm64.tar.gz`, sha256: '0065ecfbffe8a790bb0d28059a3320cdc8f723b7f3f248cdc8bfc04790927715', glibc: '2.38', gpu: null },
}
// What a desktop build puts in: the Mac app has both chips (after-pack.js keeps each app's own), the
// Windows app its x64 build and the Arm one, the Linux app x64.
export const FOR_APP = { darwin: ['darwin-arm64', 'darwin-x64'], win32: ['win32-x64', 'win32-arm64'], linux: ['linux-x64'] }

// What llama-server needs of a release's files: itself, its own library, the libraries under the names
// it links to (a link followed, so each is there once), the processor and GPU parts loaded at start,
// and the licences. Not the other tools.
export function wanted(name, isLink) {
  if (/^LICENSE/.test(name)) return true
  if (/^llama-server(\.exe)?$/.test(name)) return true
  if (/^(lib)?llama-server-impl\.(dylib|so|dll)$/.test(name)) return true
  // The other tools' libraries, and the other programs (llama, llama-cli, ggml-rpc-server, ...).
  if (/-impl\.(dylib|so|dll)$/.test(name)) return false
  if (!/\.(dylib|so|dll)$|\.so\.\d+(\.\d+)*$/.test(name)) return false
  if (/\.dll$/.test(name)) return true
  // The versioned files themselves (libfoo.0.28.0.dylib, libfoo.so.0.8.0) go in under the names
  // linked to: libfoo.0.dylib, libfoo.so.0, links to them, followed.
  if (/\.\d+\.\d+\.\d+\.dylib$/.test(name) || /\.so\.\d+\.\d+\.\d+$/.test(name)) return false
  if (/\.\d+\.dylib$/.test(name)) return isLink
  if (/\.so\.\d+$/.test(name)) return isLink
  // libggml-cpu-haswell.so, libggml-vulkan.so: real files, loaded by name.
  if (/\.so$/.test(name) || /\.dylib$/.test(name)) return !isLink
  return false
}

// llama.cpp's licence, as its Mac and Linux builds carry it; its Windows builds leave it out, and
// it goes with every copy.
const LICENSE = `MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function download(url, file) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}

// One build into dir/<key>, from cache when it's there and still matches.
export async function fetchBuild(key, dir, cache) {
  const b = BUILDS[key]
  if (!b) throw new Error(`No llama-server build for ${key}`)
  fs.mkdirSync(cache, { recursive: true })
  const archive = path.join(cache, b.asset)
  if (!fs.existsSync(archive) || sha(archive) !== b.sha256) {
    console.log(`Downloading ${b.asset}...`)
    await download(URL(b.asset), archive)
  }
  if (sha(archive) !== b.sha256) { fs.rmSync(archive, { force: true }); throw new Error(`${b.asset} doesn't match its SHA-256, so it was thrown away`) }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-llama-'))
  try {
    // tar unpacks both: Windows 10 and later have bsdtar, which reads zip files too (Windows' own,
    // not a GNU tar that came with Git for Windows, which doesn't).
    const winTar = process.platform === 'win32' && path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const x = spawnSync(winTar && fs.existsSync(winTar) ? winTar : 'tar', ['-xf', archive, '-C', tmp], { stdio: 'inherit' })
    if (x.status) throw new Error(`Couldn't unpack ${b.asset}`)
    const top = fs.readdirSync(tmp).length === 1 && fs.statSync(path.join(tmp, fs.readdirSync(tmp)[0])).isDirectory() ? path.join(tmp, fs.readdirSync(tmp)[0]) : tmp
    const out = path.join(dir, key)
    fs.rmSync(out, { recursive: true, force: true })
    fs.mkdirSync(out, { recursive: true })
    const kept = []
    for (const e of fs.readdirSync(top, { withFileTypes: true })) {
      if (!wanted(e.name, e.isSymbolicLink())) continue
      fs.copyFileSync(fs.realpathSync(path.join(top, e.name)), path.join(out, e.name))
      if (!/\.(dll|txt)$|^LICENSE/.test(e.name)) fs.chmodSync(path.join(out, e.name), 0o755)
      kept.push(e.name)
    }
    if (!kept.some((n) => /^llama-server(\.exe)?$/.test(n))) throw new Error(`${b.asset} has no llama-server`)
    if (!kept.includes('LICENSE')) fs.writeFileSync(path.join(out, 'LICENSE'), LICENSE)
    fs.writeFileSync(path.join(out, 'build.json'), `${JSON.stringify({ build: BUILD, asset: b.asset, macos: b.macos || null, glibc: b.glibc || null, gpu: b.gpu }, null, 2)}\n`)
    const mb = kept.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0) / 1e6
    console.log(`llama-server ${BUILD} for ${key}: ${kept.length} files, ${Math.round(mb)} MB`)
    return out
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, ...keys] = process.argv.slice(2)
  if (!dir) { console.error('Usage: node scripts/llama.js <dir> [platform-arch ... | --app]'); process.exit(2) }
  const cache = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'build', 'llama-cache')
  // --app: every build the desktop app made on this computer carries.
  const list = keys[0] === '--app' ? FOR_APP[process.platform] || [] : keys.length ? keys : [`${process.platform}-${process.arch}`]
  try { for (const k of list) await fetchBuild(k, path.resolve(dir), cache) } catch (e) { console.error(e.message); process.exit(1) }
}
