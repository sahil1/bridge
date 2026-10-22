// "@" file references in the message box: find files and folders under an agent's working
// folder, the way Claude Code's own @ picker does. Git repos use git's file list (so ignored
// files stay out); other folders are walked with a cap. Lists are cached briefly per folder.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

const HOME = os.homedir()
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', '.cache'])
const MAX_FILES = 40000
const cache = new Map()
// Agents often work in Desktop or Documents, which macOS can hold a look into until you answer
// its permission prompt: nothing here blocks, so only this request waits for it.
const exists = (p) => fs.promises.access(p).then(() => true, () => false)
const readdir = (dir) => fs.promises.readdir(dir, { withFileTypes: true })

const gitFiles = (cwd) => new Promise((resolve) => {
  execFile('git', ['-C', cwd, 'ls-files', '-co', '--exclude-standard', '-z'], { timeout: 8000, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
    resolve(err ? null : out.split('\0').filter(Boolean).slice(0, MAX_FILES))
  })
})

async function walk(cwd) {
  const out = []
  const stack = ['']
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop()
    let ents = []
    try { ents = await readdir(path.join(cwd, rel)) } catch { continue }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (p.split('/').length < 8) stack.push(p) } else out.push(p)
    }
  }
  return out
}

// Repos kept inside another repo (often ignored by it, like a code repo inside a notes vault) are
// otherwise invisible; list their files too, one or two folders down.
function nestedRepos(cwd) {
  const look = async (rel, depth) => {
    let ents = []
    try { ents = await readdir(path.join(cwd, rel)) } catch { return [] }
    const dirs = ents.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => (rel ? `${rel}/${e.name}` : e.name))
    return (await Promise.all(dirs.map(async (p) => ((await exists(path.join(cwd, p, '.git'))) ? [p] : depth < 2 ? look(p, depth + 1) : [])))).flat()
  }
  return look('', 1)
}

async function index(cwd) {
  const hit = cache.get(cwd)
  if (hit && Date.now() - hit.at < 30_000) return hit.v
  let files = await gitFiles(cwd)
  if (files) {
    const have = new Set(files)
    for (const sub of await nestedRepos(cwd)) {
      if (files.length >= MAX_FILES) break
      for (const f of (await gitFiles(path.join(cwd, sub))) || []) { const p = `${sub}/${f}`; if (!have.has(p)) files.push(p) }
    }
  } else files = await walk(cwd)
  const dirs = new Set()
  for (const f of files) {
    let i = f.lastIndexOf('/')
    while (i > 0) { const d = f.slice(0, i); if (dirs.has(d)) break; dirs.add(d); i = d.lastIndexOf('/') }
  }
  const v = [...[...dirs].map((d) => ({ path: `${d}/`, dir: true })), ...files.map((f) => ({ path: f, dir: false }))]
  cache.set(cwd, { at: Date.now(), v })
  return v
}

// Lower is better; 9 means no match. Name matches beat path matches; then a loose in-order match.
function rank(p, q) {
  const lp = p.toLowerCase()
  const name = lp.replace(/\/$/, '').split('/').pop()
  if (name.startsWith(q)) return 0
  if (name.includes(q)) return 1
  if (lp.startsWith(q)) return 1.5
  if (lp.includes(q)) return 2
  let i = 0
  for (const c of lp) if (c === q[i]) i++
  return i === q.length ? 3 : 9
}

const tilde = (p) => (p === HOME ? '~/' : p.startsWith(HOME + path.sep) ? `~${p.slice(HOME.length)}/` : `${p}/`)
const byName = (a, b) => (b.dir - a.dir) || a.path.localeCompare(b.path)
const up = (to) => ({ path: to, dir: true, label: '..', hint: 'Up one level' })

// Paths outside the agent's folder ("~/…" or "/…") browse one level at a time, within home.
// "~/Desk" matches names starting with (then containing) "desk".
async function listDir(q) {
  if (q === '~') q = '~/'
  const full = q.startsWith('~') ? path.join(HOME, q.slice(1)) : q
  const endsSlash = q.endsWith('/')
  const dir = path.resolve(endsSlash ? full : path.dirname(full))
  if (dir !== HOME && !dir.startsWith(HOME + path.sep)) return []
  const prefix = endsSlash ? '' : path.basename(full).toLowerCase()
  const shown = endsSlash ? q : q.slice(0, q.length - path.basename(full).length)
  let ents = []
  try { ents = await readdir(dir) } catch { return [] }
  const items = ents
    .filter((e) => e.name.toLowerCase().includes(prefix) && (prefix.startsWith('.') || !e.name.startsWith('.')))
    .map((e) => ({ path: `${shown}${e.name}${e.isDirectory() ? '/' : ''}`, dir: e.isDirectory(), r: e.name.toLowerCase().startsWith(prefix) ? 0 : 1 }))
    .sort((a, b) => a.r - b.r || byName(a, b))
    .slice(0, 80)
    .map(({ r, ...e }) => e)
  if (endsSlash && dir !== HOME) items.unshift(up(tilde(path.dirname(dir))))
  return items
}

// Shortcuts shown under the current folder when you've only typed "@".
const PLACES = [['~/', 'Home'], ['~/Desktop/', 'Desktop'], ['~/Documents/', 'Documents'], ['~/Downloads/', 'Downloads']]

export async function search(cwd, query) {
  const q = String(query || '').trim()
  if (q.startsWith('/') || q.startsWith('~')) return { items: await listDir(q) }
  if (!cwd || !(await exists(cwd))) return { items: [] }
  const all = await index(cwd)
  if (!q) {
    // Nothing typed yet: this folder's top level, a way up, then the usual places.
    const top = all.filter((e) => !e.path.replace(/\/$/, '').includes('/')).sort(byName).slice(0, 60)
    const there = await Promise.all(PLACES.map(([p]) => exists(path.join(HOME, p.slice(1)))))
    const places = PLACES.filter(([p], i) => there[i] && path.join(HOME, p.slice(1)).replace(/\/$/, '') !== cwd)
      .map(([p, label]) => ({ path: p, dir: true, label, hint: p, place: true }))
    const parent = cwd !== HOME && cwd.startsWith(HOME + path.sep) ? [up(tilde(path.dirname(cwd)))] : []
    return { items: [...top, ...parent, ...places], total: all.length }
  }
  // "folder/" lists what is directly inside it, with a way back up.
  if (q.endsWith('/')) {
    const inside = all.filter((e) => e.path.startsWith(q) && e.path !== q && !e.path.slice(q.length).replace(/\/$/, '').includes('/'))
    if (inside.length) {
      const parent = q.replace(/[^/]+\/$/, '')
      return { items: [up(parent), ...inside.sort(byName).slice(0, 80)], total: all.length }
    }
  }
  const lq = q.toLowerCase()
  const items = []
  for (const e of all) { const r = rank(e.path, lq); if (r < 9) items.push({ ...e, r }) }
  items.sort((a, b) => a.r - b.r || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return { items: items.slice(0, 50).map(({ r, ...e }) => e), total: all.length }
}
