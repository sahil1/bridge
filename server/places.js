// Folder facts for the UI: git branch and uncommitted count per working directory,
// directory completion for the "new agent" folder picker, and installed agent CLIs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

const sh = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, out) => resolve(err ? null : out))
})

const gitCache = new Map()
export async function gitSummary(cwds) {
  const out = {}
  await Promise.all([...new Set(cwds.filter(Boolean))].map(async (cwd) => {
    const hit = gitCache.get(cwd)
    if (hit && Date.now() - hit.at < 10_000) { out[cwd] = hit.v; return }
    const branch = (await sh('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']))?.trim() || null
    let v = null
    if (branch) {
      const st = await sh('git', ['-C', cwd, 'status', '--porcelain'])
      const root = (await sh('git', ['-C', cwd, 'rev-parse', '--show-toplevel']))?.trim()
      v = { branch, dirty: st ? st.split('\n').filter(Boolean).length : 0, root }
    }
    gitCache.set(cwd, { at: Date.now(), v })
    out[cwd] = v
  }))
  return out
}

const HOME = os.homedir()
const expand = (p) => (p?.startsWith('~') ? path.join(HOME, p.slice(1)) : p)
// Never a blocking call on your folders: macOS can hold the first look into Desktop or Documents
// until you answer its permission prompt, and only the request that asked should wait for that.
const isDir = (p) => fs.promises.stat(p).then((st) => st.isDirectory(), () => false)

// Directory completion inside the home folder: "~/Desk" -> ~/Desktop, "~/Desktop/" -> its folders.
export async function completeDir(input) {
  const raw = String(input || '~/').trim() || '~/'
  const full = path.resolve(expand(raw.startsWith('/') || raw.startsWith('~') ? raw : `~/${raw}`))
  if (full !== HOME && !full.startsWith(HOME + path.sep)) return { dirs: [] }
  const endsSlash = /\/$/.test(raw)
  const dir = endsSlash ? full : path.dirname(full)
  const prefix = endsSlash ? '' : path.basename(full).toLowerCase()
  const [ents, exists] = await Promise.all([fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []), isDir(full)]) // [] when not a folder
  const names = ents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && d.name.toLowerCase().startsWith(prefix))
    .map((d) => d.name).sort().slice(0, 30)
  const tilde = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p)
  return { exists, path: tilde(full), dirs: names.map((n) => tilde(path.join(dir, n)) + '/') }
}

export const resolveDir = async (p) => {
  const full = path.resolve(expand(String(p || '~')))
  if (full !== HOME && !full.startsWith(HOME + path.sep)) throw new Error('Pick a folder inside your home folder')
  if (!(await isDir(full))) throw new Error(`Folder not found: ${p}`)
  return full
}
