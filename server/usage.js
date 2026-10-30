// Local spend and token history per provider, from the agents' own logs.
// Cost and tokens: ccusage (offline pricing table). Active time: transcript timestamps.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localBin, IS_WIN } from './paths.js'
import { readAdded } from './logread.js'

const BIN = localBin('ccusage')
const HOME = os.homedir()
const GAP_MS = 5 * 60 * 1000 // gaps longer than this don't count as active time

const ymd = (d) => d.toLocaleDateString('en-CA') // local YYYY-MM-DD
const compact = (d) => ymd(d).replaceAll('-', '')

function ccusage(args) {
  return new Promise((resolve, reject) => {
    execFile(BIN, [...args, '--json', '--offline'], { shell: IS_WIN, timeout: 90000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err)
      try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) }
    })
  })
}

function normalizeDay(d) {
  const tokens = d.totalTokens ?? 0
  const cacheRead = d.cacheReadTokens ?? 0
  return {
    date: d.date || d.period,
    cost: d.totalCost ?? d.costUSD ?? 0,
    tokens,
    input: d.inputTokens ?? 0,
    output: (d.outputTokens ?? 0) + (d.reasoningOutputTokens ?? 0),
    cacheRead,
    cacheWrite: d.cacheCreationTokens ?? 0,
    models: d.modelsUsed || Object.keys(d.models || {}),
  }
}

// Fill missing days with zeros so the chart has one bar per day.
function fillDays(rows, days) {
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]))
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = ymd(d)
    out.push(byDate[key] || { date: key, cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: [] })
  }
  return out
}

// Active minutes per local day from event timestamps in recently touched logs. A log is read in
// pieces (one can pass 500 MB), all of it the first time, then only what's been added.
const stampsOf = new Map() // log -> { offset, carry, stamps }
async function activeMinutes(provider, sinceDays = 2) {
  const root = provider === 'claude' ? path.join(HOME, '.claude', 'projects') : path.join(HOME, '.codex', 'sessions')
  if (!fs.existsSync(root)) return {}
  const cutoff = Date.now() - sinceDays * 864e5
  const stamps = []
  const re = /"timestamp":"([^"]+)"/
  const walk = async (dir, depth) => {
    let names = []
    try { names = await fs.promises.readdir(dir) } catch { return }
    for (const name of names) {
      const p = path.join(dir, name)
      let st
      try { st = await fs.promises.stat(p) } catch { continue }
      if (st.isDirectory()) { if (depth < 4) await walk(p, depth + 1); continue }
      if (!name.endsWith('.jsonl')) continue
      if (st.mtimeMs < cutoff) { stampsOf.delete(p); continue }
      let s = stampsOf.get(p)
      if (!s || st.size < s.offset) { s = { offset: 0, carry: Buffer.alloc(0), stamps: [] }; stampsOf.set(p, s) }
      if (st.size > s.offset) {
        await readAdded(s, p, st.size, (text) => {
          for (const line of text.split('\n')) {
            const m = re.exec(line)
            if (m) { const t = Date.parse(m[1]); if (t >= cutoff) s.stamps.push(t) }
          }
        }).catch(() => {})
      }
      s.stamps = s.stamps.filter((t) => t >= cutoff)
      for (const t of s.stamps) stamps.push(t) // (spreading a long list overflows the stack)
    }
  }
  await walk(root, 0)
  stamps.sort((a, b) => a - b)
  const perDay = {}
  for (let i = 1; i < stamps.length; i++) {
    const gap = stamps[i] - stamps[i - 1]
    if (gap > 0 && gap <= GAP_MS) {
      const key = ymd(new Date(stamps[i]))
      perDay[key] = (perDay[key] || 0) + gap
    }
  }
  return Object.fromEntries(Object.entries(perDay).map(([k, ms]) => [k, Math.round(ms / 60000)]))
}

const SUPPORTED = new Set(['claude', 'codex'])
const cache = new Map()

export async function usage(provider, { days = 30, ttlMs = 5 * 60 * 1000 } = {}) {
  if (!SUPPORTED.has(provider)) return { supported: false }
  const hit = cache.get(provider)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value
  const since = new Date()
  since.setDate(since.getDate() - (days - 1))
  const raw = await ccusage([provider, 'daily', '--since', compact(since)])
  const rows = (raw.daily || raw || []).map(normalizeDay)
  const daily = fillDays(rows, days)
  const today = daily.at(-1)
  const yesterday = daily.at(-2)
  const active = await activeMinutes(provider)
  const value = {
    supported: true,
    provider,
    days,
    daily,
    today: { ...today, activeMinutes: active[today.date] || 0 },
    yesterday: { ...yesterday, activeMinutes: active[yesterday.date] || 0 },
    total: {
      cost: daily.reduce((s, d) => s + d.cost, 0),
      tokens: daily.reduce((s, d) => s + d.tokens, 0),
    },
    source: 'ccusage (local logs, offline pricing)',
    fetchedAt: new Date().toISOString(),
  }
  cache.set(provider, { at: Date.now(), value })
  return value
}
