// Your projects: the folders you work in, so starting work is "what should we build in <project>?"
// and not a folder dialog. Setup offers the ones your agents already know, read from Claude Code's
// and Codex's own logs (~/.claude/projects, ~/.codex/sessions): each log says the folder it ran in.
// Nothing is copied: their conversations stay where they are, and History opens them again.
//
// Suggested (ticked in setup): a git repo with at least 3 conversations, the last in the past 30
// days, which is what T3 Code ticks too. Left out: your home folder, temporary folders, Downloads,
// apps' own folders in Library, Bridge AI's own, and copies an agent made to work on its own branch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DATA, dataFile, expand } from './paths.js'

const HOME = os.homedir()
const CLAUDE = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'projects')
const CODEX = () => path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'sessions')
const FILE = dataFile('projects.json')
const MAX_FILES = 5000 // per agent, newest first

// The first `"cwd":"..."` in the first part of a log.
function cwdOf(file, bytes = 64 * 1024) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const n = fs.readSync(fd, buf, 0, bytes, 0)
    const m = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(buf.subarray(0, n).toString('utf8'))
    return m ? JSON.parse(`"${m[1]}"`) : null
  } catch { return null } finally { if (fd != null) try { fs.closeSync(fd) } catch { /* closed */ } }
}

const skip = (p) => {
  const r = path.resolve(p)
  // Temporary folders, unless your home folder is in one (a sandbox, a test machine).
  const under = (p, t) => p === t || p.startsWith(t + path.sep)
  const tmp = [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map((x) => path.resolve(x)).filter((t) => !under(HOME, t))
  return r === HOME || r === path.dirname(HOME) || r === '/' || tmp.some((t) => under(r, t)) ||
    r === path.join(HOME, 'Downloads') || r.startsWith(path.join(HOME, 'Downloads') + path.sep) ||
    r.startsWith(path.join(HOME, 'Library') + path.sep) || // apps' own folders (Claude's scratch spaces)
    r === path.resolve(DATA) || r.startsWith(path.resolve(DATA) + path.sep) || r.includes(`${path.sep}.t3${path.sep}`)
}

// Its git remote ("owner/name" on GitHub and the like), or null; and whether it's a copy made for a branch.
function gitOf(dir) {
  const g = path.join(dir, '.git')
  let st
  try { st = fs.statSync(g) } catch { return { git: false } }
  if (st.isFile()) return { git: true, linked: true } // a worktree: its .git is a pointer to the real repo
  let conf = ''
  try { conf = fs.readFileSync(path.join(g, 'config'), 'utf8') } catch { return { git: true } }
  const m = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(conf) || /\[remote "[^"]+"\][^[]*?url\s*=\s*(\S+)/.exec(conf)
  if (!m) return { git: true }
  const url = m[1]
  const n = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  return { git: true, remote: url, name: n ? `${n[1]}/${n[2]}` : null }
}

function claudeLogs(add) {
  let dirs = []
  try { dirs = fs.readdirSync(CLAUDE()) } catch { return }
  const files = []
  for (const d of dirs) {
    let names = []
    try { names = fs.readdirSync(path.join(CLAUDE(), d)) } catch { continue }
    for (const n of names) {
      if (!n.endsWith('.jsonl') || n.startsWith('agent-')) continue
      const f = path.join(CLAUDE(), d, n)
      try { files.push({ f, d, t: fs.statSync(f).mtimeMs }) } catch { /* gone */ }
    }
  }
  files.sort((a, b) => b.t - a.t)
  // One folder per log directory, read from its newest log (they all ran in the same place).
  const cwd = new Map()
  for (const x of files.slice(0, MAX_FILES)) {
    if (!cwd.has(x.d)) cwd.set(x.d, cwdOf(x.f))
    const c = cwd.get(x.d)
    if (c) add(c, 'claude', x.t)
  }
}

function codexLogs(add) {
  const files = []
  const walk = (dir, depth) => {
    let names = []
    try { names = fs.readdirSync(dir) } catch { return }
    for (const n of names.sort().reverse()) {
      if (files.length >= MAX_FILES) return
      const p = path.join(dir, n)
      if (depth < 3) walk(p, depth + 1)
      else if (/^rollout-.*\.jsonl$/.test(n)) { try { files.push({ f: p, t: fs.statSync(p).mtimeMs }) } catch { /* gone */ } }
    }
  }
  walk(CODEX(), 0)
  for (const x of files) {
    const c = cwdOf(x.f, 16 * 1024)
    if (c) add(c, 'codex', x.t)
  }
}

// ---------- Reading your folders, outside the server ----------
// Your projects are often in Desktop or Documents, which macOS guards: the first read there waits
// for you to answer "Allow access?", however long that takes. So everything that looks inside a
// project folder runs in a small helper process, and the server only waits for it so long. (Not a
// worker thread: the server couldn't quit while one waits.) A job: { scan } reads the logs,
// { paths } checks those folders (there, a folder, git, its name).
function inspect({ scan: doScan = false, paths = [] }) {
  const out = { found: null, info: {} }
  if (doScan) {
    const by = new Map()
    const add = (cwd, kind, t) => {
      const p = path.resolve(cwd)
      if (skip(p)) return
      const e = by.get(p) || { path: p, kinds: {}, count: 0, last: 0 }
      e.kinds[kind] = (e.kinds[kind] || 0) + 1
      e.count++
      e.last = Math.max(e.last, t)
      by.set(p, e)
    }
    claudeLogs(add)
    codexLogs(add)
    const month = Date.now() - 30 * 864e5
    out.found = []
    for (const e of by.values()) {
      if (!fs.existsSync(e.path)) continue
      const g = gitOf(e.path)
      if (g.linked) continue
      out.found.push({ ...e, git: !!g.git, remote: g.remote || null, name: g.name || path.basename(e.path), suggested: !!g.git && e.count >= 3 && e.last >= month })
    }
    out.found.sort((a, b) => b.last - a.last)
  }
  for (const p of paths) {
    let st = null, gone = false
    try { st = fs.statSync(p) } catch (e) { gone = e.code === 'ENOENT' } // not allowed: still there
    const g = st?.isDirectory() ? gitOf(p) : {}
    out.info[p] = { exists: st ? true : gone ? false : null, dir: st ? st.isDirectory() : null, git: !!g.git, linked: !!g.linked, name: g.name || null }
  }
  return out
}
if (process.env.BRIDGE_PROJECTS_JOB === '1' && process.send) process.once('message', (job) => process.send(inspect(job), () => process.exit(0)))

// One helper at a time; what it finds is kept (scan for 5 minutes, folder checks until the next).
// One still waiting after 10 minutes, or when the server quits, is stopped.
let cache = { at: 0, found: null, info: {} }
let busy = Promise.resolve()
const helpers = new Set()
process.once('exit', () => { for (const h of helpers) try { h.kill('SIGKILL') } catch { /* gone */ } })
function work(job) {
  const run = busy.then(() => new Promise((resolve, reject) => {
    const h = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, BRIDGE_PROJECTS_JOB: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    helpers.add(h)
    const limit = setTimeout(() => h.kill('SIGKILL'), 10 * 60_000)
    limit.unref?.()
    const done = () => { helpers.delete(h); clearTimeout(limit) }
    h.once('message', (r) => { done(); resolve(r) })
    h.once('error', (e) => { done(); reject(e) })
    h.once('exit', (code) => { done(); reject(new Error(`The folder check stopped (${code})`)) })
    h.send(job)
    h.unref()
    h.channel?.unref?.()
  })).then((r) => {
    cache = { at: r.found ? Date.now() : cache.at, found: r.found || cache.found, info: { ...cache.info, ...r.info } }
    return r
  })
  busy = run.catch(() => {})
  return run
}
const within = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms).unref?.())])
const stale = () => !cache.found || Date.now() - cache.at > 5 * 60 * 1000

// Every folder your agents worked in, newest first: { path, name, remote, git, kinds: { claude, codex }, count, last, suggested }.
export async function scan({ fresh = false, wait = 60_000 } = {}) {
  if (fresh || stale()) await within(work({ scan: true, paths: load().map((p) => p.path) }), wait, null)
  return cache.found || []
}

// ---------- The ones you keep ----------
const load = () => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d.projects) ? d.projects : [] } catch { return [] } }
const save = (list) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, `${JSON.stringify({ projects: list }, null, 2)}\n`) }

// Set up before there was a project list (2.8 and earlier): it starts with the ones setup would
// have ticked, once, a moment after the server starts or when it's first needed. After that it's
// yours. Setup always saves a list, even an empty one, so "Don't import" stays that way.
let upgrade = false, seeding = null
export function upgrading() {
  if (fs.existsSync(FILE)) return
  upgrade = true
  setTimeout(seeded, 3000).unref?.()
}
function seeded() {
  if (!upgrade) return Promise.resolve()
  seeding ||= scan().then((found) => {
    if (!fs.existsSync(FILE)) save(found.filter((x) => x.suggested).map((x) => ({ path: x.path, name: x.name, addedAt: new Date().toISOString() })))
  }).catch(() => {}).finally(() => { upgrade = false })
  return seeding
}

// Your projects with what's known of each: newest work first, then the rest by name. Answers within
// a moment with what's known; a check that has to wait (for "Allow access?") finishes on its own.
export async function list() {
  await within(seeded(), 1500, null)
  if (stale()) await within(scan(), 1500, null)
  const seen = new Map((cache.found || []).map((x) => [x.path, x]))
  return load().filter((p) => cache.info[p.path]?.exists !== false).map((p) => {
    const s = seen.get(p.path), i = cache.info[p.path]
    return { path: p.path, name: s?.name || i?.name || p.name || path.basename(p.path), short: p.path.replace(HOME, '~'), git: s?.git ?? i?.git ?? false, count: s?.count || 0, last: Math.max(s?.last || 0, p.used || 0), kinds: s?.kinds || {} }
  }).sort((a, b) => (b.last - a.last) || a.name.localeCompare(b.name))
}

export async function add(paths) {
  await seeded()
  const have = load()
  const want = [].concat(paths || []).map((raw) => [raw, path.resolve(expand(String(raw || '')))]).filter(([, p]) => p && !skip(p) && !have.some((x) => x.path === p))
  // Folders the scan found are known to be there; others are checked (briefly).
  const known = new Map((cache.found || []).map((x) => [x.path, x]))
  const check = want.map(([, p]) => p).filter((p) => !known.has(p))
  if (check.length) await within(work({ paths: check }), 5000, null)
  for (const [raw, p] of want) {
    const i = cache.info[p]
    if (!known.has(p) && i && i.dir === false) throw new Error(`Not a folder: ${raw}`)
    if (!known.has(p) && i?.exists === false) throw new Error(`No such folder: ${raw}`)
    have.push({ path: p, name: known.get(p)?.name || i?.name || path.basename(p), addedAt: new Date().toISOString() })
  }
  save(have)
  return list()
}

export async function remove(p) { await seeded(); save(load().filter((x) => x.path !== path.resolve(expand(String(p))))); return list() }

// Work just started in a folder: it goes to the top (and becomes a project if it wasn't one). Its
// git name comes with the next check.
export async function used(dir) {
  await seeded()
  const p = path.resolve(expand(String(dir || '')))
  if (skip(p)) return
  const have = load()
  const x = have.find((y) => y.path === p)
  if (x) x.used = Date.now()
  else { have.push({ path: p, addedAt: new Date().toISOString(), used: Date.now() }); work({ paths: [p] }).catch(() => {}) }
  try { save(have) } catch { /* read-only disk */ }
}
