// What each answer from a model Bridge AI calls itself took (chatmodels.js reply(), consult.js): one
// line per answer, appended in the data folder's usage/ folder, a file a month
// (answers-2026-11.jsonl). A line: when, the route and model ("openai", "gpt-5"; "cli", "claude"
// for a sign-in's one-shot mode), the model the provider says answered when that's another name,
// which part of Bridge AI asked (feature), tokens in (everything read, cached included) and out, the
// cached and cache-written part, and the seconds it took. in and out are null when the answer
// doesn't say. It stays on this computer: the usage counts sent (counts.js) never read it.
// Kept for this month and the twelve before; a month's file stops at MAX (and says so) so nothing
// can grow it without bound. Appends are queued and never awaited by an answer, and a failure is
// kept to be shown (status()), not thrown.
import fs from 'node:fs'
import path from 'node:path'
import { dataFile } from './paths.js'

export const FEATURES = ['chat', 'meetings', 'assist', 'board', 'dictation', 'voice-edit', 'insights', 'pr', 'consult', 'mail']
const DIR = () => dataFile('usage')
const MONTHS = 13
const MAX = Number(process.env.BRIDGE_USAGE_LOG_MAX) || 32 * 1024 * 1024
const monthOf = (d) => d.toLocaleDateString('en-CA').slice(0, 7) // local YYYY-MM
const fileOf = (m) => path.join(DIR(), `answers-${m}.jsonl`)
const NAME = /^answers-(\d{4}-\d{2})\.jsonl$/

// ---------- What an answer says it took ----------
const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x))
// { in, out, cached, written, model, cost } from a provider's answer, or null when it doesn't say:
// OpenAI-style usage (prompt_tokens, completion_tokens; OpenRouter adds its cost), Anthropic's
// (input_tokens without the cache, so the cache is added), Bedrock Converse's, Ollama's
// prompt_eval_count and eval_count, LM Studio's stats and llama-server's timings.
export function usageOf(j) {
  if (!j || typeof j !== 'object') return null
  const u = j.usage
  if (u && (u.prompt_tokens != null || u.completion_tokens != null)) {
    return { in: num(u.prompt_tokens), out: num(u.completion_tokens), cached: num(u.prompt_tokens_details?.cached_tokens ?? j.timings?.cache_n) || 0, written: 0, model: j.model || null, ...(typeof u.cost === 'number' ? { cost: u.cost } : {}) }
  }
  if (u && (u.input_tokens != null || u.output_tokens != null)) {
    const cached = num(u.cache_read_input_tokens) || 0, written = num(u.cache_creation_input_tokens) || 0
    return { in: (num(u.input_tokens) || 0) + cached + written, out: num(u.output_tokens), cached, written, model: j.model || null }
  }
  if (u && (u.inputTokens != null || u.outputTokens != null)) {
    const cached = num(u.cacheReadInputTokens) || 0, written = num(u.cacheWriteInputTokens) || 0
    return { in: (num(u.inputTokens) || 0) + cached + written, out: num(u.outputTokens), cached, written, model: null }
  }
  if (j.prompt_eval_count != null || j.eval_count != null) return { in: num(j.prompt_eval_count) || 0, out: num(j.eval_count) || 0, cached: 0, written: 0, model: j.model || null }
  if (j.stats && (j.stats.input_tokens != null || j.stats.total_output_tokens != null)) return { in: num(j.stats.input_tokens) || 0, out: num(j.stats.total_output_tokens) || 0, cached: 0, written: 0, model: null }
  const tm = j.timings
  if (tm && (tm.prompt_n != null || tm.predicted_n != null)) return { in: (num(tm.prompt_n) || 0) + (num(tm.cache_n) || 0), out: num(tm.predicted_n) || 0, cached: num(tm.cache_n) || 0, written: 0, model: null }
  return null
}

// ---------- Writing ----------
let queue = Promise.resolve()
const state = { error: null, errorAt: null, full: null, tidied: null }
const sizes = new Map() // month -> bytes, once looked at
let made = false

// One answer: id is the model as chatmodels.js names it ("openai:gpt-5", "cli:claude"), usage what
// usageOf() read (or null), ms how long it took.
export function record({ id, feature, usage, ms }) {
  const [route, ...rest] = String(id || '').split(':')
  const model = rest.join(':')
  if (!route) return
  const line = {
    t: new Date().toISOString(), route, model, feature: FEATURES.includes(feature) ? feature : 'other',
    in: usage?.in ?? null, out: usage?.out ?? null,
    ...(usage?.cached ? { cached: usage.cached } : {}), ...(usage?.written ? { written: usage.written } : {}),
    ...(usage?.model && usage.model !== model ? { served: String(usage.model).slice(0, 120) } : {}),
    ...(typeof usage?.cost === 'number' ? { cost: usage.cost } : {}),
    s: Math.round(ms || 0) / 1000,
  }
  queue = queue.then(() => append(line)).catch((e) => { state.error = e.message; state.errorAt = new Date().toISOString() })
}

async function append(line) {
  const m = monthOf(new Date(line.t))
  if (!made) { await fs.promises.mkdir(DIR(), { recursive: true }); made = true }
  if (state.tidied !== m) await tidy()
  if (!sizes.has(m)) sizes.set(m, await fs.promises.stat(fileOf(m)).then((s) => s.size, () => 0))
  const text = `${JSON.stringify(line)}\n`
  if (sizes.get(m) + text.length > MAX) { if (state.full?.month !== m) state.full = { month: m, since: line.t }; return }
  await fs.promises.appendFile(fileOf(m), text, { mode: 0o600 })
  sizes.set(m, sizes.get(m) + Buffer.byteLength(text))
  state.error = null
}

// Months older than the ones kept, taken out: at the start, and when a new month begins.
export async function tidy(now = new Date()) {
  const keep = new Set()
  for (let i = 0; i < MONTHS; i++) keep.add(monthOf(new Date(now.getFullYear(), now.getMonth() - i, 15)))
  const names = await fs.promises.readdir(DIR()).catch(() => [])
  for (const n of names) {
    const x = NAME.exec(n)
    if (x && !keep.has(x[1])) { await fs.promises.rm(path.join(DIR(), n), { force: true }).catch(() => {}); sizes.delete(x[1]); cache.delete(n) }
  }
  state.tidied = monthOf(now)
}

// Written so far (tests, and before the usage view reads).
export const flushed = () => queue

// How the recording is going: the last failure to write, and a month that filled up.
export const status = () => ({ error: state.error, errorAt: state.errorAt, full: state.full, max: MAX, months: MONTHS })

// ---------- Reading ----------
// Each file's lines read so far, kept with its size: what's added since is read next time.
const cache = new Map() // name -> { size, rows }
async function readFile(name) {
  const file = path.join(DIR(), name)
  const st = await fs.promises.stat(file).catch(() => null)
  if (!st) { cache.delete(name); return [] }
  let c = cache.get(name)
  if (!c || st.size < c.size) c = { size: 0, rows: [], carry: '' }
  if (st.size > c.size) {
    const fh = await fs.promises.open(file, 'r')
    try {
      const buf = Buffer.alloc(st.size - c.size)
      await fh.read(buf, 0, buf.length, c.size)
      const parts = (c.carry + buf.toString('utf8')).split('\n')
      c.carry = parts.pop() // a line still being written
      for (const l of parts) { if (!l) continue; try { c.rows.push(JSON.parse(l)) } catch { /* not a line */ } }
    } finally { await fh.close() }
    c.size = st.size
  }
  cache.set(name, c)
  return c.rows
}

// Every answer since a time, oldest first.
export async function since(from) {
  const first = monthOf(from)
  const names = (await fs.promises.readdir(DIR()).catch(() => [])).filter((n) => NAME.exec(n)?.[1] >= first).sort()
  const out = []
  const at = from.toISOString()
  for (const n of names) for (const r of await readFile(n)) if (r.t >= at) out.push(r)
  return out
}
