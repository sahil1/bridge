// The tokens the other agents wrote in their own conversation logs (the ones otherlogs.js reads for
// Chat), by day and model, for the usage view (usageall.js). Agent by agent, as of the versions
// otherlogs.js names:
//   Gemini CLI: each answer ("type": "gemini") has tokens { input, output, cached, thoughts, tool,
//     total } and its model; an answer is written again as its tools finish, so the last one counts.
//   Qwen Code: each assistant entry has usageMetadata (the Gemini API's own counts) and its model.
//   GitHub Copilot CLI: a session's totals by model (modelMetrics) once it ends (session.shutdown);
//     until then each answer's tokens out only (assistant.message outputTokens).
//   Cursor Agent: no counts at all, so it says so.
// Only logs changed in the days asked for are read, without blocking (they're under your home
// folder), and each again only once it's changed.
import fs from 'node:fs'
import path from 'node:path'
import { ROOTS } from './otherlogs.js'

const MAX = 64 * 1024 * 1024 // the end of a longer log
const ymd = (t) => new Date(t).toLocaleDateString('en-CA')
const num = (x) => Number(x) || 0
const ls = (d) => fs.promises.readdir(d).catch(() => [])
const statOf = (f) => fs.promises.stat(f).catch(() => null)

async function readTail(file, size) {
  const fh = await fs.promises.open(file, 'r')
  try {
    const start = Math.max(0, size - MAX)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    const text = buf.toString('utf8')
    return start ? text.slice(text.indexOf('\n') + 1) : text
  } finally { await fh.close() }
}
const parseLines = (text, has) => text.split('\n').filter((l) => l && (!has || l.includes(has))).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

// What one log holds: [{ t, model, in, out, cached, outOnly? }], read again only when it's changed.
const seen = new Map() // file -> { mtimeMs, size, rows }
async function rowsOf(file, st, read) {
  const was = seen.get(file)
  if (was && was.mtimeMs === st.mtimeMs && was.size === st.size) return was.rows
  const rows = read(await readTail(file, st.size), file)
  seen.set(file, { mtimeMs: st.mtimeMs, size: st.size, rows })
  return rows
}

const gemini = (text, file) => {
  const records = file.endsWith('.json') ? (() => { try { return JSON.parse(text).messages || [] } catch { return [] } })() : parseLines(text, '"tokens"')
  const last = new Map()
  for (const r of records) if (r?.type === 'gemini' && r.tokens && r.id) last.set(r.id, r)
  return [...last.values()].map((r) => ({ t: r.timestamp, model: r.model || '', in: num(r.tokens.input), out: num(r.tokens.output) + num(r.tokens.thoughts), cached: num(r.tokens.cached) }))
}
const qwen = (text) => {
  const last = new Map()
  for (const e of parseLines(text, 'usageMetadata')) if (e.type === 'assistant' && e.usageMetadata && e.uuid) last.set(e.uuid, e)
  return [...last.values()].map((e) => { const u = e.usageMetadata; return { t: e.timestamp, model: e.model || '', in: num(u.promptTokenCount), out: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount), cached: num(u.cachedContentTokenCount) } })
}
const copilot = (text) => {
  const events = parseLines(text)
  const ends = events.filter((e) => e.type === 'session.shutdown' && e.data?.modelMetrics)
  if (ends.length) {
    return ends.flatMap((e) => Object.entries(e.data.modelMetrics).map(([model, m]) => ({ t: e.timestamp, model, in: num(m.usage?.inputTokens), out: num(m.usage?.outputTokens), cached: num(m.usage?.cacheReadTokens) })))
  }
  return events.filter((e) => e.type === 'assistant.message' && e.data?.outputTokens != null).map((e) => ({ t: e.timestamp, model: e.data.model || '', in: 0, out: num(e.data.outputTokens), cached: 0, outOnly: true }))
}

// Each agent's logs: the files to read under its root (with their mtime, for the range).
const FILES = {
  gemini: async (root) => (await Promise.all((await ls(root)).map(async (p) => (await ls(path.join(root, p, 'chats'))).filter((n) => /^session-.*\.jsonl?$/.test(n)).map((n) => path.join(root, p, 'chats', n))))).flat(),
  qwen: async (root) => (await Promise.all((await ls(root)).map(async (p) => (await ls(path.join(root, p, 'chats'))).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(root, p, 'chats', n))))).flat(),
  copilot: async (root) => (await ls(root)).map((id) => path.join(root, id, 'events.jsonl')),
  cursor: async (root) => (await Promise.all((await ls(root)).map(async (p) => (await ls(path.join(root, p, 'agent-transcripts'))).map((id) => path.join(root, p, 'agent-transcripts', id, `${id}.jsonl`))))).flat(),
}
const READ = { gemini, qwen, copilot, cursor: null }
export const KINDS = Object.keys(FILES)

// One agent since a time: { kind, logs (whether it has any), counts ('yes'; 'partial': some
// sessions say only what came out; 'none': its logs keep no counts; 'none-found': logs from those
// days with no counts in them, as an older version writes), rows: [[date, model, in, out,
// cached]], error }.
export async function tokens(kind, since) {
  const root = ROOTS[kind]()
  const out = { kind, logs: false, counts: READ[kind] ? 'yes' : 'none', rows: [], error: null }
  try {
    if (!(await statOf(root))) return out
    const files = await FILES[kind](root)
    const by = new Map()
    let read = 0
    for (const f of files) {
      const st = await statOf(f)
      if (!st?.isFile()) continue
      out.logs = true
      if (!READ[kind] || st.mtimeMs < since.getTime()) continue
      read++
      for (const r of await rowsOf(f, st, READ[kind])) {
        const at = Date.parse(r.t)
        if (!(at >= since.getTime())) continue
        if (r.outOnly) out.counts = 'partial'
        const k = `${ymd(at)}\u0000${r.model}`
        const x = by.get(k) || [ymd(at), r.model, 0, 0, 0]
        x[2] += r.in; x[3] += r.out; x[4] += r.cached
        by.set(k, x)
      }
    }
    out.rows = [...by.values()]
    if (read && !out.rows.length) out.counts = 'none-found'
  } catch (e) { out.error = e.message }
  return out
}
