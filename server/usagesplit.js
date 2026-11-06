// Which account each day's Claude Code and Codex use was on, for Usage's daily bars and today's
// cost, split by account. Every account of an agent writes to one history (accounts.js links each
// account's folder to your usual one's logs), and a conversation's log doesn't say which account
// ran it. What does say:
//   Bridge AI's record (accounts.js runs()): each conversation seen live in a pane it started on
//     an account, from when to when, and each one-off answer it asked an agent for (a meeting's
//     notes, a question); and the account it last started each conversation on, without when;
//   each Claude Code account's own folder: Claude Code makes session-env/<conversation> in it the
//     first time a conversation runs on that account, one started in a terminal too.
// A five-minute stretch of a conversation goes to an account when only that one can have run it:
// seen live on it then, or the one account known to have started it by then. That second part
// needs every account's runs on record, terminal ones too, so it's for Claude Code where its
// folders keep them; Codex's keep nothing of the kind, so its stretches count only where Bridge AI
// saw them. The rest is Not known, never guessed. The day's cost and tokens stay ccusage's (usage.js): each account gets its
// part of each model's, by its own requests in the logs, so the parts add up to the day.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readAdded } from './logread.js'
import { priceOf } from './prices.js'
import * as accounts from './accounts.js'

const STEP = 5 * 60 * 1000
const SLACK = 60 * 1000 // between two looks at the agents, and a run starting before the first
const ymd = (t) => new Date(t).toLocaleDateString('en-CA')
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/
// A model as both ccusage and the logs name it, without the date some names end in.
const norm = (m) => String(m || '').toLowerCase().replace(/-\d{8}$/, '')

// ---------- The logs ----------
// Where each kind keeps them: Claude Code under projects/ (subagents' logs in a folder per
// conversation), as ccusage reads them, also ~/.config/claude; Codex under sessions/YYYY/MM/DD.
function roots(kind) {
  const home = accounts.folders(kind)[0]?.dir
  if (!home) return []
  const all = kind === 'claude' ? [path.join(home, 'projects'), path.join(os.homedir(), '.config', 'claude', 'projects')] : [path.join(home, 'sessions')]
  const out = new Map()
  for (const r of all) { try { const real = fs.realpathSync(r); if (!out.has(real)) out.set(real, r) } catch { /* none */ } }
  return [...out.values()]
}
function logsOf(kind, since) {
  const out = []
  const walk = (dir, depth) => {
    let names = []
    try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of names) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); continue }
      if (!e.name.endsWith('.jsonl')) continue
      try { const st = fs.statSync(p); if (st.mtimeMs >= since) out.push({ file: p, size: st.size }) } catch { /* gone */ }
    }
  }
  for (const r of roots(kind)) walk(r, 0)
  return out
}

// Each log read so far: where it stopped, and its requests by conversation, model and five
// minutes: [tokens, read from the cache, what they cost at the model's price]. What's added to a
// log is read next time; one that's gone, or out of the days shown, is let go.
const state = { claude: new Map(), codex: new Map() }
const add = (st, sid, model, t, tokens, cache, cost) => {
  const k = `${sid}\t${model}\t${Math.floor(t / STEP)}`
  const c = st.cells.get(k)
  if (c) { c[0] += tokens; c[1] += cache; c[2] += cost } else st.cells.set(k, [tokens, cache, cost])
}

// Claude Code logs each reply once per part, with the same usage: counted once.
function claudeLine(st, line) {
  if (!line.includes('"type":"assistant"') || !line.includes('"usage":{')) return
  let e
  try { e = JSON.parse(line) } catch { return }
  const m = e?.type === 'assistant' ? e.message : null
  if (!m?.usage || !m.model || m.model === '<synthetic>') return
  const key = m.id ? `${m.id}:${e.requestId || ''}` : null
  if (key) {
    if (st.seen.has(key)) return
    st.seen.add(key)
    if (st.seen.size > 2000) st.seen.delete(st.seen.values().next().value) // a reply's parts come together
  }
  const t = Date.parse(e.timestamp)
  if (!Number.isFinite(t)) return
  const u = m.usage
  const inp = u.input_tokens || 0, out = u.output_tokens || 0, read = u.cache_read_input_tokens || 0, wrote = u.cache_creation_input_tokens || 0
  const hour = Math.min(wrote, u.cache_creation?.ephemeral_1h_input_tokens || 0)
  // Anthropic's prices: a quarter more than reading for what's written to the cache (twice for an
  // hour's), a tenth for what's read from it. A model with no price here keeps those shares.
  const p = priceOf('anthropic', m.model) || { in: 1, out: 5, cached: 0.1 }
  add(st, e.sessionId || st.sid, m.model, t, inp + out + read + wrote, read, inp * p.in + out * p.out + read * p.cached + (wrote - hour) * p.in * 1.25 + hour * p.in * 2)
}
// Codex: a token_count event per request, its model from the turn it's in. One said again with
// the same total (when its rate limits are updated) is counted once.
function codexLine(st, line) {
  if (line.includes('"turn_context"')) {
    try { const e = JSON.parse(line); if (e.type === 'turn_context' && e.payload?.model) st.model = e.payload.model } catch { /* not a line */ }
    return
  }
  if (!line.includes('"token_count"')) return
  let e
  try { e = JSON.parse(line) } catch { return }
  const info = e?.type === 'event_msg' && e.payload?.type === 'token_count' ? e.payload.info : null
  const u = info?.last_token_usage
  if (!u) return
  const total = info.total_token_usage?.total_tokens
  if (total != null && total === st.total) return
  st.total = total
  const t = Date.parse(e.timestamp)
  if (!Number.isFinite(t)) return
  const inp = u.input_tokens || 0, cached = Math.min(inp, u.cached_input_tokens || 0), out = u.output_tokens || 0
  const p = priceOf('openai', st.model) || { in: 1, out: 8, cached: 0.1 }
  add(st, st.sid, st.model || '', t, u.total_tokens || inp + out, cached, (inp - cached) * p.in + cached * p.cached + out * p.out)
}

async function read(kind, since) {
  const files = state[kind]
  const want = logsOf(kind, since)
  const keep = new Set(want.map((f) => f.file))
  for (const f of files.keys()) if (!keep.has(f)) files.delete(f)
  const line = kind === 'claude' ? claudeLine : codexLine
  for (const f of want) {
    let st = files.get(f.file)
    if (!st || f.size < st.offset) {
      st = { offset: 0, carry: Buffer.alloc(0), cells: new Map(), seen: new Set(), sid: UUID.exec(f.file)?.[1] || path.basename(f.file, '.jsonl'), model: null, total: null }
      files.set(f.file, st)
    }
    if (f.size > st.offset) await readAdded(st, f.file, f.size, (text) => { for (const l of text.split('\n')) if (l) line(st, l) }).catch(() => {})
  }
  return [...files.values()]
}

// ---------- Which account ran each conversation ----------
// Each Claude Code account's session-env folder: the conversations that ran on it, and when each
// first did (when its folder there was made). Two accounts whose folders are one (a link) say
// nothing about either.
function folderRuns(kind) {
  const out = new Map() // conversation -> [[account, first]]
  if (kind !== 'claude') return out
  const dirs = new Map() // real folder -> [{ id, dir }]
  for (const { id, dir } of accounts.folders(kind)) {
    const env = path.join(dir, 'session-env')
    try { const real = fs.realpathSync(env); dirs.set(real, [...(dirs.get(real) || []), { id, env }]) } catch { /* none */ }
  }
  for (const list of dirs.values()) {
    if (list.length !== 1) continue
    const { id, env } = list[0]
    let names = []
    try { names = fs.readdirSync(env) } catch { continue }
    for (const n of names) {
      let st
      try { st = fs.statSync(path.join(env, n)) } catch { continue }
      if (!st.isDirectory()) continue
      const made = st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs
      out.set(n, [...(out.get(n) || []), [id, made]])
    }
  }
  return out
}

// What's known of one conversation: the stretches it was seen on an account, and each account
// known to have run it with when it first did (null: when isn't known). all: every run of it is
// on record, so the one account known to have started it by a time is the one that ran it then.
// Only where the folders keep runs: Claude Code's, and only once your usual folder has
// session-env (an older Claude Code doesn't make it).
function knownOf(kind) {
  const { runs, sessions } = accounts.runs()
  const env = folderRuns(kind)
  const usual = accounts.folders(kind)[0]?.dir
  const all = kind === 'claude' && !!usual && fs.existsSync(path.join(usual, 'session-env'))
  const mine = (id) => typeof id === 'string' && id.startsWith(`${kind}-`)
  return (sid) => {
    const spans = (runs[sid] || []).filter((s) => mine(s[0]))
    const firsts = new Map()
    const first = (id, t) => { if (!firsts.has(id) || (t != null && (firsts.get(id) == null || t < firsts.get(id)))) firsts.set(id, t) }
    for (const [id, from] of spans) first(id, from)
    for (const [id, t] of env.get(sid) || []) first(id, t)
    if (mine(sessions[sid]) && !firsts.has(sessions[sid])) first(sessions[sid], null)
    return { spans, firsts, all }
  }
}

// The account that ran a conversation from b0 to b1, or null when that isn't known: the one it
// was seen live on then; else, with every run on record, the one account known to have started it
// by then. Seen on two at once, or two that could have: not known.
function whoRan({ spans, firsts, all }, b0, b1) {
  const on = new Set(spans.filter(([, from, to]) => from - SLACK < b1 && to + SLACK > b0).map(([id]) => id))
  if (on.size) return on.size === 1 ? [...on][0] : null
  if (!all) return null
  const could = [...firsts].filter(([, f]) => f == null || f < b1).map(([id]) => id)
  return could.length === 1 ? could[0] : null
}

// ---------- The split ----------
// days: usage.js's, each with its models (byModel: [[model, cost, tokens, cache]]). Each day gets
// by: { account: [cost, tokens, cache] } with '?' for what isn't known; and the accounts in it.
export async function split(kind, days) {
  if (!days.length) return { accounts: [] }
  const from = new Date(`${days[0].date}T00:00`).getTime()
  const logs = await read(kind, from - 864e5)
  const known = knownOf(kind)
  const evs = new Map()
  const mine = new Map() // date -> model -> account ('?') -> [tokens, cache, cost]
  for (const st of logs) {
    for (const [k, c] of st.cells) {
      const [sid, model, b] = k.split('\t')
      const b0 = Number(b) * STEP
      if (b0 + STEP <= from) continue
      if (!evs.has(sid)) evs.set(sid, known(sid))
      const who = whoRan(evs.get(sid), b0, b0 + STEP) || '?'
      const date = ymd(b0)
      const byModel = mine.get(date) || mine.set(date, new Map()).get(date)
      const m = norm(model)
      const byWho = byModel.get(m) || byModel.set(m, new Map()).get(m)
      const x = byWho.get(who) || byWho.set(who, [0, 0, 0]).get(who)
      x[0] += c[0]; x[1] += c[1]; x[2] += c[2]
    }
  }
  const used = new Set()
  const ours = new Set(accounts.folders(kind).map((f) => f.id)) // one since removed: not known
  for (const d of days) {
    const by = {}
    const put = (who, cost, tokens, cache) => {
      const x = by[who] || (by[who] = [0, 0, 0])
      x[0] += cost; x[1] += tokens; x[2] += cache
    }
    const day = mine.get(d.date) || new Map()
    // Each model's cost, tokens and cache read, shared out by each account's part of it in the
    // logs. Without ccusage's models (an older one): the day's, by each account's part of all of it.
    const parts = d.byModel?.length ? d.byModel : [[null, d.cost, d.tokens, d.cacheRead]]
    for (const [model, cost, tokens, cache] of parts) {
      const who = model == null ? merged(day) : day.get(norm(model)) || new Map()
      const sum = [0, 1, 2].map((i) => [...who.values()].reduce((s, x) => s + x[i], 0))
      for (const [id, x] of who) {
        if (id === '?' || !ours.has(id)) continue
        put(id, sum[2] ? (cost * x[2]) / sum[2] : 0, sum[0] ? (tokens * x[0]) / sum[0] : 0, sum[1] ? (cache * x[1]) / sum[1] : 0)
        used.add(id)
      }
    }
    // Not known: whatever of the day isn't an account's (rounding aside).
    const got = [0, 1, 2].map((i) => Object.values(by).reduce((s, x) => s + x[i], 0))
    const rest = [d.cost - got[0], d.tokens - got[1], d.cacheRead - got[2]].map((v) => Math.max(0, v))
    if (rest.some((v) => v > 1e-9)) by['?'] = rest
    d.by = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, [Math.round(v[0] * 1e4) / 1e4, Math.round(v[1]), Math.round(v[2])]]))
  }
  // Every account listed for the kind, and any other one Bridge AI knows that has some of it.
  const listed = (accounts.groups().find((g) => g.kind === kind)?.accounts || []).map((a) => a.id)
  const ids = [...listed, ...accounts.folders(kind).map((f) => f.id).filter((id) => !listed.includes(id) && used.has(id))]
  return { accounts: ids.map((id) => ({ id, label: accounts.nameOf(kind, id), color: accounts.colorOf(kind, id), listed: listed.includes(id) })) }
}
const merged = (byModel) => {
  const out = new Map()
  for (const who of byModel.values()) for (const [id, x] of who) { const y = out.get(id) || out.set(id, [0, 0, 0]).get(id); y[0] += x[0]; y[1] += x[1]; y[2] += x[2] }
  return out
}
