// A file an agent named in its chat (html/roadmap.html, ~/notes.md, /full/path.png), found where it
// is. Agents name files from wherever they were working: a folder they cd'd into, or one they wrote
// to by its full path, so "html/roadmap.html" can be three folders below the agent's own. Looked for
// in turn: the path as written (from / or ~), in the agent's folder, in the folders its conversation
// worked in (transcripts.js usedPaths), then by a search below the agent's folder for a path ending
// in it. One found opens; several are offered to pick from; none says where it looked.
//
// Only ever inside the agent's folder, each one through files.safePath as every file route goes: a
// path outside it is said to be, never looked at. The search keeps out of node_modules, .git and a
// build's output, and out of a cloud drive and the folders macOS asks about (Desktop, Documents,
// Downloads, iCloud Drive, your Library) unless the agent's folder is in one; it follows no links,
// stops after a few seconds or SEARCH_DIRS folders, runs two at a time, and never holds up the server.
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safePath } from './files.js'
import { guardOf, cloudOf, tilde } from './explorer.js'
import { usedPaths } from './transcripts.js'

const HOME = os.homedir()
const IS_MAC = process.platform === 'darwin'
const MAX_FOUND = 12
const SEARCH_DIRS = 20000
const SEARCH_MS = 6000
// Folders a search below the agent's folder doesn't go into, unless the path asked for does.
const NOISE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '__pycache__', '.venv', 'venv', 'Pods', 'DerivedData', '.gradle', 'coverage'])
const PACKAGE = /\.(app|photoslibrary|musiclibrary|tvlibrary|xcodeproj|xcworkspace|bundle|framework)$/i
const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)
const slash = (p) => p.split(path.sep).join('/')

// What was written, as a path: no quotes or file://, no line number (src/app.js:12, #L12-L20), no
// ./ in front. dir: written as a folder (ending in /).
export function cleanPath(raw) {
  let s = String(raw || '').trim().replace(/^[`'"<(]+|[`'">)]+$/g, '').replace(/^file:\/\//i, '')
  try { if (/%[0-9a-f]{2}/i.test(s)) s = decodeURIComponent(s) } catch { /* as written */ }
  s = s.replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/i, '').replace(/(?::\d+){1,2}$/, '').replace(/[.,;]+$/, '')
  if (path.sep === '\\' && !/^[a-z]:/i.test(s) && !s.startsWith('\\\\')) s = s.replace(/\\/g, '/')
  const dir = /[\\/]$/.test(s) && s.length > 1
  s = s.replace(/^(\.\/)+/, '').replace(/[\\/]+$/, '') || (dir ? '/' : '')
  return { text: s, dir }
}

// One path, if it's there and inside the agent's folder: as the routes name it (relative, with /).
async function there(root, base, abs) {
  if (!within(abs, base)) return null
  try {
    const { real, realRoot, rel } = await safePath(root, path.relative(base, abs))
    const st = await fsp.stat(real)
    return { path: slash(rel), dir: st.isDirectory(), size: st.isDirectory() ? null : st.size, mtime: st.mtimeMs, real, top: real === realRoot }
  } catch { return null }
}

// The first of these that are there, each once, in the order asked.
async function firstThere(root, bases, list) {
  const out = []
  const seen = new Set()
  for (const abs of list) {
    if (out.length >= MAX_FOUND) break
    const base = bases.find((b) => within(abs, b))
    const f = base && await there(root, base, abs)
    if (f && !f.top && !seen.has(f.real)) { seen.add(f.real); out.push(f) }
  }
  return out
}

// Below the agent's folder, breadth first from the folders its conversation worked in and then
// from the top: every path ending in what was asked for. A folder macOS asks about, a cloud drive or
// your Library only when the agent's folder is in it already.
async function search(realRoot, lexRoot, seeds, want, { dir }) {
  const parts = want.split('/')
  const name = parts.at(-1)
  const named = new Set(parts.slice(0, -1))
  const asLex = (p) => path.join(lexRoot, path.relative(realRoot, p))
  const rootGuard = guardOf(realRoot) || guardOf(lexRoot)
  const rootClouds = new Set([cloudOf(realRoot), cloudOf(lexRoot)].filter(Boolean))
  const LIB = path.join(HOME, 'Library')
  const libRoot = IS_MAC && (within(realRoot, LIB) || within(lexRoot, LIB))
  const skipped = new Set()
  const keepOut = (full, n) => {
    if ((n.startsWith('.') || NOISE.has(n)) && !named.has(n)) return true
    if (PACKAGE.test(n)) return true
    for (const p of new Set([full, asLex(full)])) {
      const g = guardOf(p)
      if (g && g !== rootGuard) { skipped.add(g === 'volume' ? path.basename(p) : g); return true }
      const c = cloudOf(p)
      if (c && !rootClouds.has(c)) { skipped.add(path.basename(c)); return true }
      if (IS_MAC && !libRoot && within(p, LIB)) { skipped.add('Library'); return true }
    }
    return false
  }
  const found = []
  const seen = new Set()
  let queue = [...seeds.filter((s) => within(s, realRoot)), realRoot]
  let folders = 0
  let partial = false
  const until = Date.now() + SEARCH_MS
  const tail = `/${want}`
  while (queue.length) {
    if (Date.now() > until || folders >= SEARCH_DIRS) { partial = true; break }
    const next = []
    const batch = queue.splice(0, 48).filter((d) => !seen.has(d) && seen.add(d))
    await Promise.all(batch.map(async (d) => {
      folders++
      const ents = await Promise.race([fsp.readdir(d, { withFileTypes: true }), new Promise((r) => setTimeout(() => r(null), 3000))]).catch(() => null)
      if (!ents) return
      for (const e of ents) {
        const full = path.join(d, e.name)
        const isDir = e.isDirectory()
        if (e.name === name && isDir === dir && found.length < MAX_FOUND * 4 && `/${slash(path.relative(realRoot, full))}`.endsWith(tail)) found.push(full)
        if (isDir && !e.isSymbolicLink() && !keepOut(full, e.name)) next.push(full)
      }
    }))
    queue = queue.concat(next)
  }
  return { found: [...new Set(found)], folders, partial, skipped: [...skipped] }
}

// What was found for a path, kept a little while: Chat asks again for each picture it shows, and
// the Files tab when it opens what it couldn't find. Nothing found is looked for again sooner (the
// agent may be about to make it).
const kept = new Map() // root + session + path -> { at, p, none }
const KEEP_MS = 30000
const KEEP_NONE_MS = 10000
// Two searches at a time: a chat naming many pictures that aren't there any more asks for many.
let searching = 0
const waiting = []

// root: the agent's folder (index.js rootOf). agent: the agent ({ kind, sessionId, cwd }), or null
// (a plain terminal, or a place in Files): then there's no conversation to look in. Asked for by
// several at once (a picture in Chat and the Files tab), it's looked for once.
// { path, found: [{ path, dir, size, mtime }], how, outside, looked: { root, used, folders, partial, skipped } }
export function locate(root, agent, raw) {
  const key = `${root}\n${agent?.sessionId || ''}\n${raw}`
  const was = kept.get(key)
  if (was && Date.now() - was.at < (was.none ? KEEP_NONE_MS : KEEP_MS)) return was.p
  const x = { at: Date.now(), none: false }
  x.p = find(root, agent, raw).then((r) => { x.none = !r.found.length; return r })
  kept.set(key, x)
  if (kept.size > 400) kept.delete(kept.keys().next().value)
  x.p.catch(() => kept.delete(key))
  return x.p
}

async function find(root, agent, raw) {
  const { text, dir } = cleanPath(raw)
  const lexRoot = path.resolve(root)
  const { realRoot } = await safePath(root, '')
  const bases = [...new Set([lexRoot, realRoot])]
  const looked = { root: tilde(lexRoot), used: 0, folders: 0, partial: false, skipped: [] }
  const answer = (found, how, more = {}) => ({ path: raw, found: found.map(({ path: p, dir: d, size, mtime }) => ({ path: p, dir: d, size, mtime })), how, looked, ...more })
  if (!text) return answer([], null)
  const fixed = text === '~' || text.startsWith('~/') ? path.join(HOME, text.slice(1)) : path.isAbsolute(text) ? path.normalize(text) : null
  // Written in full: that path, if it's in the agent's folder; one outside it isn't looked at.
  if (fixed) {
    if (!bases.some((b) => within(fixed, b))) return answer([], null, { outside: tilde(fixed) })
    return answer(await firstThere(root, bases, [fixed]), 'path')
  }
  // In the agent's folder (a path up and out of it is turned away by safePath).
  const here = await firstThere(root, bases, [path.resolve(lexRoot, text)])
  if (here.length) return answer(here, 'folder')
  // Where its conversation worked: a file it named by its full path that ends in this, or this in a
  // folder it worked in; then in the folders those are in, up to the agent's.
  const want = slash(path.normalize(text)).replace(/^(\.\.\/)+/, '')
  const conv = agent?.sessionId ? usedPaths(agent) : { named: [], dirs: [] }
  const tail = `/${want}`
  const inRoot = (p) => bases.some((b) => within(p, b))
  const dirs = conv.dirs.filter(inRoot)
  looked.used = dirs.filter((d) => !bases.includes(d)).length
  const said = conv.named.filter((p) => inRoot(p) && slash(p).endsWith(tail))
  const near = await firstThere(root, bases, [...said, ...dirs.map((d) => path.resolve(d, text))])
  if (near.length) return answer(near, 'conversation')
  const ups = []
  for (const d of dirs) for (let u = path.dirname(d); inRoot(u) && !bases.includes(u) && u !== path.dirname(u); u = path.dirname(u)) ups.push(path.resolve(u, text))
  const above = await firstThere(root, bases, [...new Set(ups)].slice(0, 200))
  if (above.length) return answer(above, 'conversation')
  // Then a search below the agent's folder, from the folders it worked in first.
  const real = await Promise.all(dirs.slice(0, 40).map((d) => fsp.realpath(d).catch(() => null)))
  if (searching >= 2) await new Promise((r) => waiting.push(r))
  searching++
  let s
  try { s = await search(realRoot, lexRoot, real.filter(Boolean), want, { dir }) } finally { searching--; waiting.shift()?.() }
  Object.assign(looked, { folders: s.folders, partial: s.partial, skipped: s.skipped })
  const hits = await firstThere(root, [realRoot], s.found)
  // The newest first: what the agent just made, rather than an old copy elsewhere.
  hits.sort((a, b) => b.mtime - a.mtime || a.path.length - b.path.length)
  return answer(hits.slice(0, MAX_FOUND), hits.length ? 'search' : null)
}
