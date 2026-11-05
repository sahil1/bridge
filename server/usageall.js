// One usage view across every provider (the trial usage-everywhere): tokens by provider and model,
// by day and by the part of Bridge AI that used them, from what each source on this computer keeps:
//   Claude Code and Codex: ccusage over their logs (usagestats.js, the Stats view's own history);
//   Gemini CLI, Qwen Code, GitHub Copilot CLI and Cursor Agent: their own logs (agenttokens.js);
//   every model Bridge AI calls itself, a line per answer (usagelog.js), with the cost where a key's
//     price is known (prices.js) and the time it took when it ran on this computer.
// Bridge AI's one-shot runs through Claude Code and Codex are in those agents' logs too, so they're
// taken out of the agent's own work for their feature, never counted twice. A source that can't be
// read, or keeps no counts, says so (counts, error) rather than showing nothing. Nothing here is
// sent anywhere: the usage counts (counts.js) don't read it.
import { installed, adapter } from './agents.js'
import { history, modelName } from './usagestats.js'
import * as agentTokens from './agenttokens.js'
import * as usagelog from './usagelog.js'
import { routeInfo } from './chatmodels.js'
import { costOf, priced, AS_OF } from './prices.js'

const ymd = (d) => new Date(d).toLocaleDateString('en-CA')
// What went wrong, in its last words (a command's own error, not the command line it ran).
const said = (e) => String(e?.message || e || '').trim().split('\n').filter(Boolean).pop()?.slice(0, 200) || 'unknown error'
const LOCAL = /^(ollama|lmstudio|bridge)$/
const RANGES = [7, 30, 90]

// { days, from, to, sources, rows, features, log, pricesAsOf }. rows: [date, source, model, feature,
// tokens, in, out, cost, seconds, answers]; in and out null where only the total is known, tokens
// null where nothing says, cost null without a price, seconds only for models on this computer,
// answers only for Bridge AI's own. feature 'agents': an agent's own work, from its logs.
export async function everywhere({ days = 30, force = false } = {}) {
  const n = RANGES.includes(Number(days)) ? Number(days) : 30
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (n - 1))
  const from = ymd(start)
  const have = new Set((await installed().catch(() => [])).map((a) => a.kind))
  const [lines, ccs, others] = await Promise.all([
    usagelog.flushed().then(() => usagelog.since(start)),
    Promise.all(['claude', 'codex'].map((k) => history(k, { force }).then((v) => ({ kind: k, v }), (e) => ({ kind: k, error: said(e) })))),
    Promise.all(agentTokens.KINDS.map((k) => agentTokens.tokens(k, start))),
  ])
  const sources = new Map()
  const source = (id, more) => { if (!sources.has(id)) sources.set(id, { id, counts: 'yes', uncounted: 0, unpriced: 0, error: null, ...more }); return sources.get(id) }
  const agent = (kind) => source(`cli:${kind}`, { label: adapter(kind).label, via: 'agent', kind })
  const rows = []

  // Claude Code and Codex: their days by model, all their own work to start with.
  const own = new Map() // `${source}|${date}|${model}` -> row
  for (const { kind, v, error } of ccs) {
    if (error) { if (have.has(kind)) agent(kind).error = error; continue }
    const cells = (v?.cells || []).filter((c) => c[0] >= from)
    if (!have.has(kind) && !cells.length) continue
    const s = agent(kind)
    if (!v?.supported) { s.counts = 'none'; continue }
    for (const [date, , mi, tok] of cells) {
      const key = `${s.id}|${date}|${v.models[mi]}`
      let r = own.get(key)
      if (!r) { r = [date, s.id, v.models[mi], 'agents', 0, null, null, null, null, null]; own.set(key, r); rows.push(r) }
      r[4] += tok
    }
  }
  // The other agents, from their own logs.
  for (const o of others) {
    if (!o.logs && !have.has(o.kind) && !o.error) continue
    const s = agent(o.kind)
    s.counts = o.counts
    s.error = o.error && said(o.error)
    for (const [date, model, i, out] of o.rows) rows.push([date, s.id, model || '', 'agents', i + out, i, out, null, null, null])
  }
  // Bridge AI's own answers.
  for (const l of lines) {
    const date = ymd(l.t)
    const counted = l.in != null || l.out != null
    const tok = counted ? (l.in || 0) + (l.out || 0) : null
    if (l.route === 'cli') {
      const s = agent(l.model)
      if (!counted) s.uncounted++
      let model = l.served ? modelName(l.served) : ''
      // What the agent's own logs have of it, moved to its feature (the biggest model that day when
      // the run didn't say which, as Codex's doesn't).
      if (counted) {
        const mine = [...own.values()].filter((r) => r[1] === s.id && r[0] === date && r[4] > 0)
        const hit = mine.find((r) => r[2] === model) || mine.sort((a, b) => b[4] - a[4])[0]
        if (hit) { hit[4] -= Math.min(hit[4], tok); model ||= hit[2] }
      }
      rows.push([date, s.id, model, l.feature, tok, l.in, l.out, null, null, 1])
      continue
    }
    const info = routeInfo(l.route)
    const s = source(l.route, { label: info.label, via: info.via })
    if (!counted) s.uncounted++
    const model = modelName(l.model)
    let cost = null
    if (info.via === 'key' && counted) {
      cost = costOf(l.route, l.served || l.model, l)
      if (cost == null && priced(l.route)) s.unpriced++
    }
    rows.push([date, s.id, model, l.feature, tok, l.in, l.out, cost, LOCAL.test(l.route) ? l.s || 0 : null, 1])
  }
  // A source with answers and none of them counted: it doesn't say (a sign-in's one-shot mode).
  for (const s of sources.values()) {
    const mine = rows.filter((r) => r[1] === s.id)
    if (s.counts === 'yes' && mine.length && mine.every((r) => r[4] == null)) s.counts = 'none'
  }
  return {
    days: n, from, to: ymd(new Date()),
    sources: [...sources.values()],
    rows: rows.filter((r) => r[4] !== 0 || r[9]),
    features: usagelog.FEATURES,
    log: usagelog.status(),
    pricesAsOf: AS_OF,
    fetchedAt: new Date().toISOString(),
  }
}
