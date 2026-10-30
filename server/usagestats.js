// Full usage history for the Stats view: every day since you started, split by model and by
// project, plus Claude Code's own activity counts (messages, sessions, tool calls, hours).
// Tokens and cost come from ccusage over the local logs; counts from ~/.claude/stats-cache.json.
// Every account is in it: each account's folder links to your usual one's logs (accounts.js), and
// the split by account comes from Insights, which knows which account each conversation was on.
// "all" is Claude Code and Codex together.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localBin, IS_WIN } from './paths.js'
import * as insights from './insights.js'
import * as accounts from './accounts.js'

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
const LABEL = { claude: 'Claude Code', codex: 'Codex' }

// Tokens and conversations by account over the last 30 days, for the agents shown. An agent with
// more than one account lists them all, an unused one at nothing, so none looks left out.
async function byAccount(kinds, force) {
  const st = await insights.scan({ force }).catch(() => null)
  const rows = (st?.value.accounts || []).filter((a) => kinds.includes(a.kind)).map(({ kind, agent, account, sessions, hours, tokens }) => ({ kind, agent, account, sessions, hours, tokens: tokens || 0 }))
  for (const g of accounts.groups()) {
    if (!kinds.includes(g.kind) || g.accounts.length < 2) continue
    for (const a of g.accounts) if (!rows.some((r) => r.kind === g.kind && r.account === a.label)) rows.push({ kind: g.kind, agent: g.label, account: a.label, sessions: 0, hours: 0, tokens: 0 })
  }
  return rows
}

export async function usageStats(provider = 'all', { force = false } = {}) {
  if (provider === 'all') return combined(force)
  if (!['claude', 'codex'].includes(provider)) return { supported: false }
  const value = await one(provider, force)
  return { ...value, accounts: await byAccount([provider], force) }
}

// Claude Code and Codex in one view: days added up, models and projects side by side.
const KEYS = ['cost', 'tokens', 'input', 'output', 'cacheRead', 'cacheWrite', 'messages', 'sessions', 'tools']
async function combined(force) {
  const got = (await Promise.allSettled(['claude', 'codex'].map((p) => one(p, force)))).map((r) => (r.status === 'fulfilled' ? r.value : null)).filter((v) => v?.supported && v.days.some((d) => d.tokens))
  if (!got.length) return { ...(await one('claude', force)), provider: 'all', accounts: await byAccount(['claude', 'codex'], force) }
  const days = new Map()
  const models = []
  const projects = []
  const cells = []
  for (const v of got) {
    const mi = v.models.map((m) => { const i = models.indexOf(m); return i < 0 ? models.push(m) - 1 : i })
    const pi = v.projects.map((p) => {
      const q = p.id === 'all' ? { id: `${v.provider}:all`, path: `${LABEL[v.provider]}, every folder`, name: LABEL[v.provider] } : p
      const i = projects.findIndex((x) => x.id === q.id)
      return i < 0 ? projects.push(q) - 1 : i
    })
    for (const c of v.cells) cells.push([c[0], pi[c[1]], mi[c[2]], c[3], c[4]])
    for (const d of v.days) {
      const x = days.get(d.date) || Object.fromEntries([['date', d.date], ...KEYS.map((k) => [k, 0])])
      for (const k of KEYS) x[k] += d[k] || 0
      days.set(d.date, x)
    }
  }
  const claude = got.find((v) => v.provider === 'claude')
  return {
    supported: true,
    provider: 'all',
    days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    models,
    projects,
    cells,
    hours: claude?.hours || null,
    tokensFrom: got.map((v) => v.tokensFrom).filter(Boolean).sort()[0] || null,
    totals: claude?.totals || null,
    agents: got.map((v) => v.provider),
    source: `ccusage over the ${got.map((v) => (v.provider === 'claude' ? '~/.claude' : '~/.codex')).join(' and ')} logs${claude?.totals ? "; messages and sessions from Claude Code's stats" : ''}`,
    fetchedAt: new Date().toISOString(),
    accounts: await byAccount(['claude', 'codex'], force),
  }
}

async function one(provider, force) {
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
      const cost = r.totalCost ?? r.costUSD ?? 0 // Claude's rows say totalCost, Codex's costUSD
      d.cost += cost
      d.tokens += r.totalTokens || 0
      d.input += r.inputTokens || 0
      d.output += (r.outputTokens || 0) + (r.reasoningOutputTokens || 0)
      d.cacheRead += r.cacheReadTokens || 0
      d.cacheWrite += r.cacheCreationTokens || 0
      // By model: Claude's as a list with each one's cost; Codex's as { model: counts }, with the
      // day's cost shared out by tokens.
      const parts = r.modelBreakdowns || Object.entries(r.models || {}).map(([modelName, m]) => ({ modelName, ...m, cost: r.totalTokens ? (cost * (m.totalTokens || 0)) / r.totalTokens : 0 }))
      for (const b of parts) {
        const t = b.totalTokens || (b.inputTokens || 0) + (b.outputTokens || 0) + (b.reasoningOutputTokens || 0) + (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0)
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
