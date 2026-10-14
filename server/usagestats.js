// Full usage history for the Stats view: every day since you started, split by model and by
// project, plus Claude Code's own activity counts (messages, sessions, tool calls, hours).
// Tokens and cost come from ccusage over the local logs; counts from ~/.claude/stats-cache.json.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localBin, IS_WIN } from './paths.js'

const BIN = localBin('ccusage')
const HOME = os.homedir()
const ymd = (d) => d.toLocaleDateString('en-CA')

function ccusage(args) {
  return new Promise((resolve, reject) => {
    execFile(BIN, [...args, '--json', '--offline'], { shell: IS_WIN, timeout: 120000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err)
      try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) }
    })
  })
}

// ccusage names projects by their log folder ("-Users-me-Desktop-x"); the logs record the real cwd.
const names = new Map()
function projectPath(id) {
  if (names.has(id)) return names.get(id)
  let cwd = null
  const dir = path.join(HOME, '.claude', 'projects', id)
  try {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).slice(0, 5)) {
      const fd = fs.openSync(path.join(dir, f), 'r')
      const buf = Buffer.alloc(64 * 1024)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      fs.closeSync(fd)
      const m = /"cwd":"([^"]+)"/.exec(buf.toString('utf8', 0, n))
      if (m) { cwd = m[1]; break }
    }
  } catch { /* folder gone */ }
  if (!cwd) cwd = id.replace(/^-/, '/').replace(/-/g, '/')
  names.set(id, cwd)
  return cwd
}
const tilde = (p) => (p === HOME ? '~' : p.startsWith(HOME + '/') ? `~${p.slice(HOME.length)}` : p)

// Anthropic model ids to short names; others pass through.
export const modelName = (m) => {
  const x = /claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)/.exec(m) || /claude-(\d+)-(\d+)-(opus|sonnet|haiku)/.exec(m)
  if (!x) { const y = /^claude-(opus|sonnet|haiku|fable)-(\d+)$/.exec(m); return y ? `${y[1][0].toUpperCase()}${y[1].slice(1)} ${y[2]}` : m }
  return /^\d/.test(x[1]) ? `${x[3][0].toUpperCase()}${x[3].slice(1)} ${x[1]}.${x[2]}` : `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}`
}

function readStatsCache() {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'stats-cache.json'), 'utf8')) } catch { return null }
}

const cache = new Map()

export async function usageStats(provider = 'claude', { force = false } = {}) {
  if (!['claude', 'codex'].includes(provider)) return { supported: false }
  const hit = cache.get(provider)
  if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value

  const sc = provider === 'claude' ? readStatsCache() : null
  const first = sc?.firstSessionDate ? new Date(sc.firstSessionDate) : new Date(Date.now() - 365 * 864e5)
  const since = ymd(first).replaceAll('-', '')

  // By project and model, per day. Codex has no per-project split, so it falls back to one bucket.
  let raw = await ccusage([provider, 'daily', '--since', since, '--instances', '--breakdown']).catch(() => null)
  let projectsRaw = raw?.projects
  if (!projectsRaw) {
    raw = await ccusage([provider, 'daily', '--since', since, '--breakdown'])
    projectsRaw = { all: raw.daily || [] }
  }

  const days = new Map()
  const day = (date) => {
    if (!days.has(date)) days.set(date, { date, cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0, sessions: 0, tools: 0 })
    return days.get(date)
  }
  // cells: [date, project index, model index, tokens, cost] so the page can filter any way.
  const models = []
  const mIdx = (m) => { let i = models.indexOf(m); if (i < 0) { models.push(m); i = models.length - 1 } return i }
  const projects = []
  const cells = []
  for (const [id, rows] of Object.entries(projectsRaw)) {
    const p = id === 'all' ? null : projectPath(id)
    const pi = projects.push({ id, path: p ? tilde(p) : 'All', name: p ? path.basename(p) || p : 'All' }) - 1
    for (const r of rows) {
      const d = day(r.date)
      d.cost += r.totalCost || 0
      d.tokens += r.totalTokens || 0
      d.input += r.inputTokens || 0
      d.output += (r.outputTokens || 0) + (r.reasoningOutputTokens || 0)
      d.cacheRead += r.cacheReadTokens || 0
      d.cacheWrite += r.cacheCreationTokens || 0
      for (const b of r.modelBreakdowns || []) {
        const t = (b.inputTokens || 0) + (b.outputTokens || 0) + (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0)
        if (t || b.cost) cells.push([r.date, pi, mIdx(modelName(b.modelName)), t, +(b.cost || 0).toFixed(4)])
      }
    }
  }
  for (const a of sc?.dailyActivity || []) {
    const d = day(a.date)
    d.messages = a.messageCount || 0
    d.sessions = a.sessionCount || 0
    d.tools = a.toolCallCount || 0
  }

  // One row per day from the first to today, zeros where nothing happened.
  const out = []
  const start = new Date(`${[...days.keys()].sort()[0] || ymd(first)}T12:00`)
  for (let d = start; ymd(d) <= ymd(new Date()); d = new Date(d.getTime() + 864e5)) out.push(days.get(ymd(d)) || day(ymd(d)))

  const value = {
    supported: true,
    provider,
    days: out,
    models,
    projects,
    cells,
    hours: sc?.hourCounts || null,
    tokensFrom: out.find((d) => d.tokens)?.date || null,
    totals: sc ? { sessions: sc.totalSessions, messages: sc.totalMessages, firstSessionDate: sc.firstSessionDate, longestSession: sc.longestSession, countsThrough: sc.lastComputedDate } : null,
    source: provider === 'claude' ? 'ccusage over ~/.claude logs; messages and sessions from Claude Code\'s stats' : 'ccusage over ~/.codex logs',
    fetchedAt: new Date().toISOString(),
  }
  cache.set(provider, { at: Date.now(), value })
  return value
}
