// Folder facts for the UI: git branch and uncommitted count per working directory,
// directory completion for the "new agent" folder picker, installed agent CLIs, and the folders you
// picked for Files (Places).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { gitReady } from './gitready.js'
import { dataFile, ensureDir, writeFileAtomic } from './paths.js'

const sh = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, ...opts }, (err, out) => resolve(err ? null : out))
})

const gitCache = new Map()
export async function gitSummary(cwds) {
  const out = {}
  await Promise.all([...new Set(cwds.filter(Boolean))].map(async (cwd) => {
    const hit = gitCache.get(cwd)
    if (hit && Date.now() - hit.at < 10_000) { out[cwd] = hit.v; return }
    if (!(await gitReady())) { out[cwd] = null; return }
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
// Never a blocking call on your folders (fs.promises below): macOS can hold the first look into
// Desktop or Documents until you answer its permission prompt, and only the request that asked
// should wait for that.

// Directory completion inside the home folder: "~/Desk" -> ~/Desktop, "~/Desktop/" -> its folders.
export async function completeDir(input) {
  const raw = String(input || '~/').trim() || '~/'
  const full = path.resolve(expand(raw.startsWith('/') || raw.startsWith('~') ? raw : `~/${raw}`))
  if (full !== HOME && !full.startsWith(HOME + path.sep)) return { dirs: [] }
  const endsSlash = /\/$/.test(raw)
  const dir = endsSlash ? full : path.dirname(full)
  const prefix = endsSlash ? '' : path.basename(full).toLowerCase()
  const [ents, st] = await Promise.all([fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []), fs.promises.stat(full).catch((e) => e)]) // [] when not a folder
  const exists = !!st?.isDirectory?.()
  // denied: macOS said no to the folder it's in (Desktop, Documents...); the app offers to allow it.
  const denied = st?.code === 'EPERM'
  const names = ents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && d.name.toLowerCase().startsWith(prefix))
    .map((d) => d.name).sort().slice(0, 30)
  const tilde = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p)
  return { exists, denied, path: tilde(full), dirs: names.map((n) => tilde(path.join(dir, n)) + '/') }
}

export const resolveDir = async (p) => {
  const full = path.resolve(expand(String(p || '~')))
  if (full !== HOME && !full.startsWith(HOME + path.sep)) throw new Error('Pick a folder inside your home folder')
  const st = await fs.promises.stat(full).catch((e) => e)
  // macOS said no to Desktop, Documents or Downloads (EPERM): the app offers to allow it.
  if (st?.code === 'EPERM') throw Object.assign(new Error(`macOS hasn't let Bridge AI into ${p}`), { code: 'EPERM' })
  if (!st?.isDirectory?.()) throw new Error(`Folder not found: ${p}`)
  return full
}

// ---------- Places: folders you picked, in Files ----------
// Folders outside any agent's that you added to Files, with the system's folder picker in the
// desktop app (or, in a browser on this computer, from its folders as you type them). On a Mac,
// picking a folder there is your say-so, so macOS usually asks nothing more. Nothing in your folders
// is read until you add one, and then only that one, when you open it. Kept in
// ~/.bridge-ai/places.json: each one's path and name, and nothing about what's in it.
const PICKED = dataFile('places.json')
let picked = null
const loadPicked = () => (picked ||= (() => {
  try { const d = JSON.parse(fs.readFileSync(PICKED, 'utf8')); return Array.isArray(d.places) ? d.places.filter((x) => x?.id && x.path) : [] } catch { return [] }
})())
const savePicked = () => { ensureDir(path.dirname(PICKED)); writeFileAtomic(PICKED, JSON.stringify({ places: picked }, null, 2), { mode: 0o600 }) }
const tilde = (p) => (p === HOME || p.startsWith(HOME + path.sep) ? `~${p.slice(HOME.length)}` : p)
const shown = (x) => ({ id: x.id, name: x.name, path: tilde(x.path), addedAt: x.addedAt })
export const pickedPlaces = () => loadPicked().map(shown)
export const placeOf = (id) => loadPicked().find((x) => x.id === id) || null
// A folder you picked, or one inside it: Bridge AI may look there without macOS asking again.
export const inPicked = (p) => { const r = path.resolve(p); return loadPicked().some((x) => r === x.path || r.startsWith(x.path + path.sep)) }

// A folder you picked: its full path (as the picker gave it), looked at once to see it's a folder.
export async function addPlace(p) {
  const full = path.resolve(expand(String(p || '').trim()))
  if (!String(p || '').trim() || full === path.parse(full).root) throw new Error('Pick a folder')
  const st = await fs.promises.stat(full).catch((e) => e)
  if (st?.code === 'EPERM' || st?.code === 'EACCES') throw Object.assign(new Error(`macOS hasn't let Bridge AI into ${tilde(full)}`), { code: 'EPERM' })
  if (!st?.isDirectory?.()) throw new Error(`Folder not found: ${tilde(full)}`)
  const list = loadPicked()
  const had = list.find((x) => x.path === full)
  if (had) return { place: shown(had), places: pickedPlaces() }
  if (list.length >= 30) throw new Error('Files keeps 30 places at most. Take one out first.')
  const place = { id: randomBytes(4).toString('hex'), path: full, name: path.basename(full) || full, addedAt: new Date().toISOString() }
  picked = [...list, place]
  savePicked()
  return { place: shown(place), places: pickedPlaces() }
}
// Taken out of Files: forgotten here, the folder itself untouched.
export function removePlace(id) {
  picked = loadPicked().filter((x) => x.id !== id)
  savePicked()
  return { places: pickedPlaces() }
}
