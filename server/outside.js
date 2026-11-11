// What other apps ask of you through Bridge AI's MCP server (mcptools.js), waiting in Needs You
// until you answer: a change they suggest to a whiteboard or a file (Keep or Discard), and a
// message for one of your agents (Send or Don't send). Nothing they ask is done before that. And
// every call they make, for Settings › MCP Servers' recent calls: which app, what, and how it went.
//
// Kept in the data folder: outside.json (the asks: every one still waiting, and the latest 100
// answered) and mcp-calls.json (the latest 200 calls).
import fs from 'node:fs'
import crypto from 'node:crypto'
import { dataFile, writeFileAtomic } from './paths.js'

const ASKS = dataFile('outside.json')
const CALLS = dataFile('mcp-calls.json')
const KEEP_DONE = 100
const KEEP_CALLS = 200
const read = (f, d) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j === 'object' ? j : d } catch { return d } }

// apply(item): does what a kept suggestion or an approved send says (mcptools.js), or throws why not.
export function make({ apply }) {
  let asks = read(ASKS, { items: [] }).items || []
  let calls = read(CALLS, { calls: [] }).calls || []
  const save = () => writeFileAtomic(ASKS, JSON.stringify({ items: asks }), { mode: 0o600 })
  const saveCalls = () => writeFileAtomic(CALLS, JSON.stringify({ calls }), { mode: 0o600 })

  // kind: 'suggestion' | 'send'. client: { name, version, via }. target: what it's about ({ type:
  // 'board' | 'file' | 'agent', ... }). summary: the app's one line. change: what keeping it does.
  function add(kind, { client, target, summary, change }) {
    const item = { id: crypto.randomBytes(9).toString('base64url'), kind, at: new Date().toISOString(), client, target, summary: String(summary || '').slice(0, 300), change, status: 'waiting' }
    asks.push(item)
    const done = asks.filter((x) => x.status !== 'waiting')
    if (done.length > KEEP_DONE) { const drop = new Set(done.slice(0, done.length - KEEP_DONE).map((x) => x.id)); asks = asks.filter((x) => !drop.has(x.id)) }
    save()
    return item
  }
  const get = (id) => asks.find((x) => x.id === String(id || '')) || null
  const waiting = () => asks.filter((x) => x.status === 'waiting')

  // Your answer: keep (a suggestion) or send (a message), or discard / don't send. An ask answered
  // already, or one that can't be done now (the file changed since, the agent's gone), says so; one
  // that couldn't stays waiting, to discard.
  const busy = new Set()
  async function decide(id, yes) {
    const item = get(id)
    if (!item) throw Object.assign(new Error('That isn\'t waiting any more'), { status: 404 })
    if (item.status !== 'waiting') return { item, already: true }
    if (busy.has(item.id)) throw Object.assign(new Error('Already being done'), { status: 409 })
    if (!yes) {
      Object.assign(item, { status: item.kind === 'send' ? 'not sent' : 'discarded', decidedAt: new Date().toISOString() })
      save()
      return { item }
    }
    busy.add(item.id)
    try {
      const note = await apply(item)
      Object.assign(item, { status: item.kind === 'send' ? 'sent' : 'kept', decidedAt: new Date().toISOString(), ...(note ? { note } : {}) })
      delete item.problem
      save()
      return { item }
    } catch (e) {
      item.problem = String(e.message || e).slice(0, 300)
      save()
      throw Object.assign(new Error(item.problem), { status: e.status || 409 })
    } finally { busy.delete(item.id) }
  }

  // A call: { client, tool, what, ok, error, ms }.
  function log(entry) {
    calls.push({ at: new Date().toISOString(), ...entry, what: String(entry.what || '').slice(0, 200), ...(entry.error ? { error: String(entry.error).slice(0, 300) } : {}) })
    if (calls.length > KEEP_CALLS) calls = calls.slice(-KEEP_CALLS)
    saveCalls()
  }
  const recent = (n = 30) => calls.slice(-n).reverse()
  // Each app that called, with its last call and how many.
  function clients() {
    const by = new Map()
    for (const c of calls) {
      const k = c.client?.name || 'an MCP client'
      const was = by.get(k) || { name: k, calls: 0, errors: 0 }
      by.set(k, { ...was, calls: was.calls + 1, errors: was.errors + (c.ok ? 0 : 1), last: c.at, via: c.client?.via || was.via })
    }
    return [...by.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)))
  }
  return { add, get, waiting, decide, log, recent, clients }
}
