// Subagents a Claude session started (the Agent tool), read from Claude's own logs:
//   <project>/<session>/subagents/agent-<id>.jsonl   their full transcript
//   <project>/<session>/subagents/agent-<id>.meta.json   description, type, the tool call that started it
// Whether one has finished comes from the main transcript: a background agent ends with a
// <task-notification> naming its tool call; a foreground one with that call's tool_result.
import fs from 'node:fs'
import path from 'node:path'

const RECENT_MS = 3 * 3600 * 1000 // finished ones stay listed this long
const MAX = 12
const countCache = new Map()
const endCache = new Map() // main file -> { offset, ends: Map(id -> status) }

// How each subagent ended, read incrementally from the main transcript so a long session
// costs one full read, then only what's new. Keys are both the agent id and its tool call id.
function endings(mainFile) {
  const size = fs.statSync(mainFile).size
  let c = endCache.get(mainFile)
  if (!c || size < c.offset) c = { offset: 0, ends: new Map(), carry: '' }
  if (size > c.offset) {
    const chunk = c.carry + readSlice(mainFile, c.offset, size - c.offset)
    const cut = chunk.lastIndexOf('\n')
    const text = cut < 0 ? '' : chunk.slice(0, cut)
    c.carry = cut < 0 ? chunk : chunk.slice(cut + 1)
    c.offset = size
    const re = /<task-id>(\w+)<\/task-id>(?:\\n|\s)*<tool-use-id>(\w+)<\/tool-use-id>[\s\S]{0,800}?<status>(\w+)<\/status>/g
    for (let m; (m = re.exec(text));) { c.ends.set(m[1], m[3]); c.ends.set(m[2], m[3]) }
    // Foreground agents end with their tool call's result (background ones get an "Async agent launched" result first).
    const tr = /"tool_use_id":"(toolu_\w+)","type":"tool_result","content":\[\{"type":"text","text":"(.{0,40})/g
    for (let m; (m = tr.exec(text));) if (!/^Async agent launched/.test(m[2]) && !c.ends.has(m[1])) c.ends.set(m[1], 'completed')
  }
  endCache.set(mainFile, c)
  return c.ends
}

function readSlice(file, start, len) {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(len)
  const n = fs.readSync(fd, buf, 0, len, start)
  fs.closeSync(fd)
  return buf.toString('utf8', 0, n)
}
const tail = (file, size, bytes) => { const start = Math.max(0, size - bytes); const s = readSlice(file, start, size - start).split('\n'); if (start) s.shift(); return s.filter(Boolean) }

function hintOf(b) {
  const i = b.input || {}
  const h = i.description || i.command || i.file_path || i.pattern || i.url || i.prompt || i.query || ''
  return String(h).split('\n')[0].slice(0, 160)
}

// Recent steps: tool calls and what it said, newest last.
function steps(lines) {
  const out = []
  for (const line of lines) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type !== 'assistant') continue
    for (const b of e.message?.content || []) {
      if (b.type === 'tool_use') out.push({ kind: 'tool', tool: b.name, hint: hintOf(b), ts: e.timestamp })
      else if (b.type === 'text' && b.text?.trim()) out.push({ kind: 'text', text: b.text.trim(), ts: e.timestamp })
    }
  }
  return out
}

function brief(file) {
  try {
    const first = readSlice(file, 0, 256 * 1024).split('\n')[0]
    const e = JSON.parse(first)
    const c = e.message?.content
    const t = typeof c === 'string' ? c : (c || []).find((b) => b.type === 'text')?.text
    return { text: String(t || '').slice(0, 1200), ts: e.timestamp }
  } catch { return { text: '', ts: null } }
}

function toolCount(file, size) {
  const hit = countCache.get(file)
  if (hit && hit.size === size) return hit.n
  const n = (fs.readFileSync(file, 'utf8').match(/"type":"tool_use"/g) || []).length
  countCache.set(file, { size, n })
  return n
}

// mainFile: the session's own transcript.
export function listSubagents(mainFile) {
  if (!mainFile) return { items: [] }
  const dir = path.join(mainFile.replace(/\.jsonl$/, ''), 'subagents')
  if (!fs.existsSync(dir)) return { items: [] }
  const ends = endings(mainFile)

  const now = Date.now()
  const all = fs.readdirSync(dir).filter((n) => n.endsWith('.meta.json')).map((n) => {
    const id = n.replace(/\.meta\.json$/, '')
    const file = path.join(dir, `${id}.jsonl`)
    let meta = {}
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) } catch { /* partial write */ }
    let st
    try { st = fs.statSync(file) } catch { return null }
    return { id, file, meta, st }
  }).filter(Boolean)

  const items = []
  for (const { id, file, meta, st } of all.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)) {
    const end = ends.get(id.replace(/^agent-/, '')) || (meta.toolUseId && ends.get(meta.toolUseId))
    let status = end ? (end === 'completed' ? 'done' : end) : 'running'
    let result = null
    // No word from the session but nothing written for a while: it isn't running any more.
    if (status === 'running' && now - st.mtimeMs > 20 * 60 * 1000) status = 'stopped'
    if (status !== 'running' && now - st.mtimeMs > RECENT_MS) continue
    const recent = steps(tail(file, st.size, 400 * 1024))
    if (status !== 'running') result = [...recent].reverse().find((s) => s.kind === 'text')?.text || null
    const b = brief(file)
    items.push({
      id,
      description: meta.description || 'Subagent',
      type: meta.agentType || 'agent',
      background: meta.requestShape === 'background',
      status,
      startedAt: b.ts,
      updatedAt: new Date(st.mtimeMs).toISOString(),
      tools: toolCount(file, st.size),
      brief: b.text,
      steps: recent.slice(-12).map((s) => (s.kind === 'text' ? { ...s, text: s.text.slice(0, 600) } : s)),
      result: result && result.slice(0, 4000),
    })
    if (items.length >= MAX) break
  }
  const order = { running: 0, failed: 1, killed: 1, stopped: 2, done: 3 }
  items.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || (b.startedAt || '').localeCompare(a.startedAt || ''))
  return { items, running: items.filter((i) => i.status === 'running').length }
}
