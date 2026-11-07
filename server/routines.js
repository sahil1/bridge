// Routines: recurring jobs (a weekly report, a dependency check, /insights) with
// their last run worked out from evidence on disk, so nothing has to be logged by hand:
//   - slash commands and skills: the Claude Code transcripts in ~/.claude/projects
//   - file outputs: the newest matching file in a folder
// Definitions live in routines.json (editable from the UI); manual "done" marks and
// run history live in ~/.bridge-ai/cache/routines-log.json.
//
// With Scheduled Routines on (a beta feature), a routine can also have a time (at, with days or a
// date: shared/schedule.js) and run by itself then (auto), on this computer: tick() starts each one
// whose time has come, once, and writes down what became of it, so a routine that didn't run says
// why. A run missed while Bridge AI wasn't running or the computer was asleep goes when it's back,
// up to 12 hours late; one missed by more is written down as missed. observe() follows each run's
// agent to its end and keeps what it said last. Without the beta feature, routines are as before.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { execFile } from 'node:child_process'
import { dataFile, cacheFile, writeFileAtomic } from './paths.js'
import { parse, tidy, next, lastDue, sentence } from '../shared/schedule.js'

const DEFS = dataFile('routines.json')
const LOG = cacheFile('routines-log.json')
const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)
const DAY = 864e5

const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fallback } }
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); writeFileAtomic(f, JSON.stringify(v, null, 2) + '\n') }
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
  const out = { ...def, state, note, last, lastLaunch: runs.find((r) => r.paneId) || null }
  return scheduled && scheduleOf(def) ? withSchedule(out, runs) : out
}

// ---------- Scheduled (Scheduled Routines on) ----------
let scheduled = false
export const scheduling = (on) => { if (on !== scheduled) { scheduled = !!on; invalidate() } }
// Its schedule, when it has a time: { every, at, days, date }.
export const scheduleOf = (def) => (def?.at && /^\d\d:\d\d$/.test(def.at) && def.every ? tidy(def) : null)
const ago = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })

// What a scheduled one says: its next runs, its last few runs with what became of each, and a state
// from those (a run that failed or was missed says so until the next one goes).
function withSchedule(r, runs) {
  const when = scheduleOf(r)
  const now = new Date()
  const upcoming = next(when, { from: now, since: r.since, n: 3 }).map((d) => d.toISOString())
  const lastRun = runs.find((x) => x.slot || x.paneId || x.error || x.missed) || null
  let { state, note } = r
  if (r.auto) {
    if (r.paused) { state = 'paused'; note = null } else if (lastRun?.error) { state = 'error'; note = `Didn't run ${ago(lastRun.slot || lastRun.at)}: ${lastRun.error}` } else if (lastRun?.missed) { state = 'missed'; note = `Missed ${ago(lastRun.slot)}: ${lastRun.why}` } else { state = 'ok'; note = null }
  } else {
    // Reminds you: due once its time has come with no run since.
    const due = lastDue(when, { now, since: r.since })
    state = due && !(r.last && new Date(r.last.at) >= due) ? 'due' : 'ok'
    note = null
  }
  return { ...r, when, state, note, next: upcoming, runs: runs.slice(0, 10), says: sentence(when) }
}

let cache = null
let cacheAt = 0
export async function list(force = false) {
  if (!force && cache && Date.now() - cacheAt < 60_000) return cache
  const log = readLog()
  const routines = await Promise.all(readDefs().map((d) => statusOf(d, log).catch((e) => ({ ...d, state: 'error', note: e.message }))))
  cache = { routines, week: isoWeek().week, fetchedAt: new Date().toISOString(), scheduled }
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

// A run: by hand (Run), by itself at its time (auto), or late (the computer was off or asleep then).
// { at, how, slot?, paneId?, error?, missed?, skipped?, why? }, the newest first.
function noteRun(id, run) {
  const log = readLog()
  log[id] = { ...(log[id] || {}), runs: [run, ...(log[id]?.runs || [])].slice(0, 50) }
  writeLog(log)
  if (run.paneId) following = true
  invalidate()
}
export const noteLaunch = (id, paneId, how = 'hand') => noteRun(id, { at: new Date().toISOString(), how, paneId })
export const noteFailed = (id, error, how = 'hand') => noteRun(id, { at: new Date().toISOString(), how, error })

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'routine'
const BETA = 'Scheduling a routine is a beta feature. Turn on Scheduled Routines in Settings › About & Updates › Beta Features.'

// A schedule as typed ("every weekday at 9"), read here too, so a routine is only ever saved with
// one this computer understands. The time it was set from is where every n days or weeks count from.
function scheduleFrom(text) {
  const r = parse(text)
  if (r.error) throw Object.assign(new Error(r.error), { status: 400 })
  return { ...r.when, days: r.when.days, date: r.when.date, schedule: String(text).trim().slice(0, 200), since: new Date().toISOString() }
}

// to: 'chief' sends it to the Chief of Staff instead of starting an agent in a folder.
export async function add({ name, command, cwd, every, workspace, detail, kind, to, schedule, auto }) {
  name = String(name || '').trim()
  command = String(command || '').trim()
  if (!name || !command) throw new Error('A routine needs a name and a command')
  if (schedule && !scheduled) throw Object.assign(new Error(BETA), { status: 400 })
  const chief = to === 'chief'
  if (!chief && cwd && !(await exists(expand(cwd)))) throw new Error(`Folder not found: ${cwd}`)
  const defs = readDefs()
  let id = slug(name)
  while (defs.some((d) => d.id === id)) id += '-2'
  const cmd = /^\/([\w:-]+)/.exec(command)?.[1]
  const def = { id, name, detail: detail || '', every: every || 'week', cwd: chief ? '' : cwd || '~', workspace: workspace || '', command, detect: cmd ? { command: cmd.split(':').pop() } : {} }
  if (kind && !chief) def.kind = String(kind).slice(0, 40)
  if (chief) def.to = 'chief'
  if (schedule) Object.assign(def, clean(scheduleFrom(schedule)), { auto: auto !== false })
  writeDefs([...defs, def])
  invalidate()
  return def
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null))

export function update(id, patch) {
  const defs = readDefs()
  const i = defs.findIndex((d) => d.id === id)
  if (i < 0) throw new Error('No such routine')
  const allowed = ['name', 'detail', 'every', 'cwd', 'command', 'workspace']
  for (const k of allowed) if (patch[k] !== undefined) defs[i][k] = String(patch[k])
  if ((patch.schedule !== undefined || patch.auto !== undefined || patch.paused !== undefined || patch.to !== undefined || patch.kind !== undefined) && !scheduled) throw Object.assign(new Error(BETA), { status: 400 })
  if (patch.kind !== undefined) { if (patch.kind) defs[i].kind = String(patch.kind).slice(0, 40); else delete defs[i].kind }
  if (patch.to !== undefined) { if (patch.to === 'chief') { defs[i].to = 'chief'; defs[i].cwd = '' } else delete defs[i].to }
  // A new schedule counts from now: a time earlier today isn't run straight away.
  if (patch.schedule !== undefined) {
    if (!patch.schedule) for (const k of ['at', 'days', 'date', 'schedule', 'since', 'auto', 'paused']) delete defs[i][k]
    else if (String(patch.schedule).trim() !== defs[i].schedule || !defs[i].at) { for (const k of ['days', 'date']) delete defs[i][k]; Object.assign(defs[i], clean(scheduleFrom(patch.schedule))) }
  }
  if (patch.auto !== undefined) defs[i].auto = !!patch.auto
  // Paused, then resumed: from now, so what came meanwhile isn't run all at once.
  if (patch.paused !== undefined) { if (patch.paused) defs[i].paused = true; else if (defs[i].paused) { delete defs[i].paused; defs[i].since = new Date().toISOString() } }
  writeDefs(defs)
  invalidate()
  return defs[i]
}

// ---------- Running at its time ----------
// Up to this late it still goes (the computer was asleep at 9 and woke at 9:40): the run says so.
const LATE_MAX = 12 * 3600e3
let ticking = false
// start(def): starts it ({ paneId }) or throws why it can't. live(paneId): its agent, if it's there.
// told(def, run): a run that didn't go, for a notification. on: Scheduled Routines is on; off, each
// time that comes is written down as skipped, so none is run all at once when it's turned on again.
export async function tick({ start, live = () => null, told = () => {}, on = true, slack = 90_000 } = {}) {
  if (ticking) return
  ticking = true
  try {
    for (const def of readDefs()) {
      const when = scheduleOf(def)
      if (!when || !def.auto || def.paused) continue
      const now = new Date()
      const due = lastDue(when, { now, since: def.since })
      if (!due) continue
      const log = readLog()
      const was = log[def.id]?.slot
      if (was && new Date(was) >= due) continue
      // Its time is taken before it starts, so a crash halfway never runs it twice.
      log[def.id] = { ...(log[def.id] || {}), slot: due.toISOString() }
      writeLog(log)
      const late = now - due
      const run = { at: now.toISOString(), slot: due.toISOString(), how: late > slack ? 'late' : 'auto' }
      if (!on) { noteRun(def.id, { ...run, skipped: true, why: 'Scheduled Routines was off in Beta Features' }); continue }
      if (late > LATE_MAX) {
        const missed = { ...run, missed: true, why: 'Bridge AI wasn\'t running then, or this computer was asleep' }
        noteRun(def.id, missed)
        told(def, missed)
        continue
      }
      // The last run's agent still at it: this one is left out rather than started beside it. (The
      // Chief of Staff takes it in its turn instead.)
      const prev = (log[def.id].runs || []).find((r) => r.paneId)
      const a = def.to !== 'chief' && prev && !prev.ended ? live(prev.paneId) : null
      if (a && (a.status === 'working' || a.status === 'blocked')) {
        noteRun(def.id, { ...run, skipped: true, why: `Its last run, from ${ago(prev.at)}, was still ${a.status === 'blocked' ? 'waiting on you' : 'working'}` })
        continue
      }
      try {
        const out = await start(def)
        noteRun(def.id, { ...run, paneId: out?.paneId || null })
      } catch (e) {
        const failed = { ...run, error: e.message }
        noteRun(def.id, failed)
        told(def, failed)
      }
    }
  } finally { ticking = false }
}

// Each run's agent followed to its end: what it said last once it's done, that it waits on you while
// it does, or that it was closed before it finished. agents: the fleet's; said(a): its last words.
const worked = new Set()
let following = null // whether a run's agent is still being followed (null: not looked yet)
export function observe(agents = [], { said = () => null } = {}) {
  if (following === false) return
  const log = readLog()
  let changed = false
  following = false
  for (const l of Object.values(log)) {
    const r = (l.runs || []).find((x) => x.paneId)
    if (!r || r.ended) continue
    following = true
    const a = agents.find((x) => x.paneId === r.paneId)
    if (!a) {
      if (Date.now() - Date.parse(r.at) > 60_000) { r.ended = { at: new Date().toISOString(), closed: true }; changed = true }
      continue
    }
    if (a.status === 'working') worked.add(r.paneId)
    const waiting = a.status === 'blocked'
    if (!!r.waiting !== waiting) { r.waiting = waiting || undefined; changed = true }
    if (a.status === 'done' || (a.status === 'idle' && worked.has(r.paneId))) {
      let words = null
      try { words = said(a) } catch { /* its log can't be read */ }
      r.ended = { at: new Date().toISOString(), ...(words ? { said: String(words).slice(0, 300) } : {}) }
      delete r.waiting
      worked.delete(r.paneId)
      changed = true
    }
  }
  if (changed) { writeLog(log); invalidate() }
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
