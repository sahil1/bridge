// Node.js for what needs it on a computer that has none: signing in to Cloudflare (Cloudflare's own
// tool runs with npx) and agents that only come through npm. The official build from nodejs.org,
// checked against the checksums it publishes there, unpacked into Bridge AI's own folder
// (~/.bridge-ai/tools/node). No password, no Homebrew, nothing outside that folder. Bridge AI puts it
// at the end of the PATH it gives agents and tools (paths.js), so a Node of your own always wins.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { OWN_NODE, dataFile, ensureDir } from './paths.js'

const DIST = process.env.BRIDGE_NODE_DIST || 'https://nodejs.org/dist' // the tests point it at a stand-in
const OS = { darwin: 'darwin', linux: 'linux', win32: 'win' }[process.platform]
const CPU = { arm64: 'arm64', x64: 'x64' }[process.arch]
// Anything else (32-bit Windows, say): the app links to nodejs.org instead.
export const canInstall = !!(OS && CPU)

let job = null // { step: 'download' | 'check' | 'unpack', got, total, error }

// The version installed here, if any.
export function ours() {
  try { return JSON.parse(fs.readFileSync(path.join(OWN_NODE, 'bridge-ai.json'), 'utf8')).version || null } catch { return null }
}

export const progress = () => job && { step: job.step, percent: job.total ? Math.floor((job.got / job.total) * 100) : 0, error: job.error }

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 120_000 }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).trim().split('\n').pop())) : resolve(String(out).trim())))
})
const get = async (url, ms = 30_000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`nodejs.org answered ${res.status}`)
  return res
}

// Starts it and returns; progress() says how it's going. onDone runs once it's there.
export function install(onDone) {
  if (!canInstall) throw new Error('Install Node.js from nodejs.org on this computer, then try again.')
  if (job && !job.error) return
  job = { step: 'download', got: 0, total: 0, error: null }
  const tools = ensureDir(dataFile('tools'))
  const tmp = fs.mkdtempSync(path.join(tools, 'node-'))
  ;(async () => {
    try {
      // The newest long-term-support release with a build for this computer.
      const list = await (await get(`${DIST}/index.json`)).json()
      const want = OS === 'darwin' ? `osx-${CPU}-tar` : OS === 'win' ? `win-${CPU}-zip` : `linux-${CPU}`
      const rel = list.find((r) => r.lts && r.files?.includes(want))
      if (!rel) throw new Error('nodejs.org has no build for this computer')
      const name = `node-${rel.version}-${OS}-${CPU}.${OS === 'win' ? 'zip' : 'tar.gz'}`
      const sums = await (await get(`${DIST}/${rel.version}/SHASUMS256.txt`)).text()
      const sum = sums.split('\n').map((l) => l.trim().split(/\s+/)).find(([, f]) => f === name)?.[0]
      if (!sum) throw new Error('nodejs.org lists no checksum for it')

      const res = await get(`${DIST}/${rel.version}/${name}`, 30 * 60_000)
      job.total = Number(res.headers.get('content-length')) || 0
      const file = path.join(tmp, name)
      const out = fs.createWriteStream(file)
      const hash = crypto.createHash('sha256')
      for await (const chunk of res.body) {
        job.got += chunk.length
        hash.update(chunk)
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
      job.step = 'check'
      if (hash.digest('hex') !== sum) throw new Error('The download doesn\'t match the checksum nodejs.org publishes. Try again.')

      job.step = 'unpack'
      const dir = ensureDir(path.join(tmp, 'node'))
      // Windows' zip has node.exe, npm and npx at its top: they go in bin/, where the others have
      // theirs, so it's found the same way (paths.js). Windows' own tar unpacks a zip.
      if (OS === 'win') await run('tar', ['-xf', file, '-C', ensureDir(path.join(dir, 'bin')), '--strip-components=1'])
      else await run('tar', ['-xzf', file, '-C', dir, '--strip-components=1'])
      if (await run(path.join(dir, 'bin', OS === 'win' ? 'node.exe' : 'node'), ['--version']) !== rel.version) throw new Error('The Node.js it unpacked doesn\'t run')
      fs.writeFileSync(path.join(dir, 'bridge-ai.json'), JSON.stringify({ version: rel.version, from: `${DIST}/${rel.version}/${name}`, sha256: sum, at: Date.now() }))
      fs.rmSync(OWN_NODE, { recursive: true, force: true })
      fs.renameSync(dir, OWN_NODE)
      job = null
      onDone?.()
    } catch (e) {
      job.error = e.name === 'TimeoutError' ? 'nodejs.org didn\'t answer in time. Try again.' : /fetch failed|ENOTFOUND|ECONNREFUSED/.test(e.message) ? 'Can\'t reach nodejs.org. Check your internet connection and try again.' : e.message || 'Couldn\'t install Node.js'
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })()
}
