// Routines: recurring jobs (a weekly report, a dependency check, /insights) with
// their last run worked out from evidence on disk, so nothing has to be logged by hand:
//   - slash commands and skills: the Claude Code transcripts in ~/.claude/projects
//   - file outputs: the newest matching file in a folder
// Definitions live in routines.json (editable from the UI); manual "done" marks and
// run history live in ~/.bridge-ai/cache/routines-log.json.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { execFile } from 'node:child_process'
import { dataFile, cacheFile } from './paths.js'

const DEFS = dataFile('routines.json')
const LOG = cacheFile('routines-log.json')
const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)
const DAY = 864e5

const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fallback } }
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n') }
const exists = (p) => fs.promises.access(p).then(() => true, () => false)

export const readDefs = () => readJSON(DEFS, { routines: [] }).routines || []
const writeDefs = (routines) => writeJSON(DEFS, { routines })
const readLog = () => readJSON(LOG, {})
const writeLog = (log) => writeJSON(LOG, log)

// ISO week (Monday start), for routines that look for files named like report-2026-W41.xlsx.
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const year = t.getUTCFullYear()
  return { year, week: Math.ceil(((t - Date.UTC(year, 0, 1)) / DAY + 1) / 7) }
}
const startOfWeek = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }

// "day" | "weekday" | "week" | "month" | "<n>d"
function periodDays(every) {
  if (every === 'day' || every === 'weekday') return 1
  if (every === 'week') return 7
  if (every === 'month') return 30
  const m = /^(\d+)([dw])$/.exec(every || '')
  return m ? Number(m[1]) * (m[2] === 'w' ? 7 : 1) : 7
}

// ---------- evidence: transcripts ----------
const rg = (args) => new Promise((resolve) => {
  execFile('rg', args, { maxBuffer: 8 * 1024 * 1024, timeout: 20000 }, (err, out) => resolve(err && !out ? '' : out))
})

// Real invocations only: a user turn that *is* the command, or a Skill tool call.
// (Transcripts that merely mention a command, like this project's own, don't count.)
function invocationTime(line, name) {
  let o
  try { o = JSON.parse(line) } catch { return null }
  const content = o.message?.content
  if (o.type === 'user') {
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('') : ''
    if (new RegExp(`^\\s*(<command-message>[^<]*</command-message>\\s*)?<command-name>/${name}</command-name>`).test(text)) return o.timestamp
  }
  if (o.type === 'assistant' && Array.isArray(content)) {
    if (content.some((c) => c.type === 'tool_use' && c.name === 'Skill' && (c.input?.skill === name || c.input?.skill?.endsWith(`:${name}`)))) return o.timestamp
  }
  return null
}

async function lastInvocation(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const listed = await rg(['-l', '--glob', '*.jsonl', '-e', `<command-name>/${esc}</command-name>`, '-e', `"skill":"([\\w-]+:)?${esc}"`, PROJECTS])
  const filesByAge = listed.split('\n').filter(Boolean)
    .map((f) => { try { return { f, m: fs.statSync(f).mtimeMs } } catch { return null } })
    .filter(Boolean).sort((a, b) => b.m - a.m)
  const runs = []
  for (const { f } of filesByAge.slice(0, 8)) {
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.includes(name)) continue
      const t = invocationTime(line, name)
      if (t) runs.push({ at: t, session: path.basename(f, '.jsonl'), project: path.basename(path.dirname(f)) })
    }
  }
  runs.sort((a, b) => (a.at < b.at ? 1 : -1))
  return { last: runs[0] || null, count: runs.length }
}

// ---------- evidence: files ----------
// Outputs often land in Documents or Desktop, which macOS can hold a look into until you answer
// its permission prompt: read without blocking, so only this list waits for it.
async function newestFile(dir, pattern) {
  let best = null
  const re = new RegExp(pattern)
  try {
    const names = (await fs.promises.readdir(expand(dir))).filter((name) => re.test(name))
    const stats = await Promise.all(names.map((name) => fs.promises.stat(path.join(expand(dir), name))))
    names.forEach((name, i) => { if (!best || stats[i].mtimeMs > best.m) best = { name, m: stats[i].mtimeMs } })
  } catch { return null }
  return best && { at: new Date(best.m).toISOString(), file: best.name }
}

async function latestWeekFile(dir, pattern) {
  const re = new RegExp(pattern)
  let best = null
  try {
    for (const name of await fs.promises.readdir(expand(dir))) {
      const m = /(\d{4})-W(\d{1,2})\b/.exec(name)
      if (!m || !re.test(name)) continue
      const key = Number(m[1]) * 100 + Number(m[2])
      if (!best || key > best.key) best = { key, name, week: Number(m[2]), year: Number(m[1]) }
    }
  } catch { return null }
  if (!best) return null
  // Report it as created on that week's Monday-ish: use the file's birth time when it falls in that week.
  const st = await fs.promises.stat(path.join(expand(dir), best.name))
  return { at: (st.birthtime || st.mtime).toISOString(), source: best.name, label: `W${best.week}` }
}

const fillWeek = (s) => {
  const { year, week } = isoWeek()
  return s.replaceAll('{week}', String(week).padStart(2, '0')).replaceAll('{year}', String(year))
}

// ---------- status ----------
async function statusOf(def, log) {
  const d = def.detect || {}
  const ev = []
  if (d.command) {
    const r = await lastInvocation(d.command)
    if (r.last) ev.push({ at: r.last.at, source: `/${d.command} in Claude Code`, count: r.count })
  }
  if (d.files && d.match?.includes('{week}')) {
    // Weekly files: the latest week by name (sync clients rewrite modified times).
    const f = await latestWeekFile(d.files, d.any || '-W\\d+')
    if (f) ev.push(f)
  } else if (d.files) {
    const f = await newestFile(d.files, d.any || d.match || '.')
    if (f) ev.push({ at: f.at, source: f.file })
  }
  for (const at of log[def.id]?.done || []) ev.push({ at, source: 'marked done' })
  ev.sort((a, b) => (a.at < b.at ? 1 : -1))
  const last = ev[0] || null

  const now = Date.now()
  let state
  let note = null
  if (d.files && d.match && d.match.includes('{week}')) {
    // Weekly outputs: done when this week's file exists.
    const thisWeek = await newestFile(d.files, fillWeek(d.match))
    const { week } = isoWeek()
    state = thisWeek ? 'ok' : 'due'
    note = thisWeek ? `W${week} is in place` : `W${week} not created yet${last?.label ? `, latest is ${last.label}` : ''}`
  } else if (!last) {
    state = 'never'
  } else {
    const age = (now - new Date(last.at)) / DAY
    const p = periodDays(def.every)
    const weekdayRest = def.every === 'weekday' && [0, 6].includes(new Date().getDay())
    state = weekdayRest || age < p ? 'ok' : age < p * 2 ? 'due' : 'overdue'
    if (def.every === 'week' && last && new Date(last.at) >= startOfWeek()) state = 'ok'
  }
  const runs = log[def.id]?.runs || []
  return { ...def, state, note, last, lastLaunch: runs[0] || null }
}

let cache = null
let cacheAt = 0
export async function list(force = false) {
  if (!force && cache && Date.now() - cacheAt < 60_000) return cache
  const log = readLog()
  const routines = await Promise.all(readDefs().map((d) => statusOf(d, log).catch((e) => ({ ...d, state: 'error', note: e.message }))))
  cache = { routines, week: isoWeek().week, fetchedAt: new Date().toISOString() }
  cacheAt = Date.now()
  return cache
}
export const invalidate = () => { cacheAt = 0 }

export function markDone(id) {
  const log = readLog()
  log[id] = { ...(log[id] || {}), done: [new Date().toISOString(), ...(log[id]?.done || [])].slice(0, 50) }
  writeLog(log)
  invalidate()
}

export function noteLaunch(id, paneId) {
  const log = readLog()
  log[id] = { ...(log[id] || {}), runs: [{ at: new Date().toISOString(), paneId }, ...(log[id]?.runs || [])].slice(0, 50) }
  writeLog(log)
  invalidate()
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'routine'

export async function add({ name, command, cwd, every, workspace, detail }) {
  name = String(name || '').trim()
  command = String(command || '').trim()
  if (!name || !command) throw new Error('A routine needs a name and a command')
  if (cwd && !(await exists(expand(cwd)))) throw new Error(`Folder not found: ${cwd}`)
  const defs = readDefs()
  let id = slug(name)
  while (defs.some((d) => d.id === id)) id += '-2'
  const cmd = /^\/([\w:-]+)/.exec(command)?.[1]
  const def = { id, name, detail: detail || '', every: every || 'week', cwd: cwd || '~', workspace: workspace || '', command, detect: cmd ? { command: cmd.split(':').pop() } : {} }
  writeDefs([...defs, def])
  invalidate()
  return def
}

export function update(id, patch) {
  const defs = readDefs()
  const i = defs.findIndex((d) => d.id === id)
  if (i < 0) throw new Error('No such routine')
  const allowed = ['name', 'detail', 'every', 'cwd', 'command', 'workspace']
  for (const k of allowed) if (patch[k] !== undefined) defs[i][k] = String(patch[k])
  writeDefs(defs)
  invalidate()
  return defs[i]
}

export function remove(id) {
  writeDefs(readDefs().filter((d) => d.id !== id))
  invalidate()
}

export const resolveCwd = (def) => expand(def.cwd || '~')

// ---------- Claude Code's own /insights report (insights.js links to it) ----------
const USAGE = path.join(os.homedir(), '.claude', 'usage-data')

export async function insightsFile() {
  const f = await newestFile(USAGE, '^report.*\\.html$')
  return f ? path.join(USAGE, f.file) : null
}
