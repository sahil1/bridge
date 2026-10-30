// What a Claude session has going on beside the conversation, read from Claude's own logs.
// - Subagents (the Agent tool):
//     <project>/<session>/subagents/agent-<id>.jsonl      their full transcript
//     <project>/<session>/subagents/agent-<id>.meta.json  description, type, the tool call that started it
//   A background one ends with a <task-notification> in the main transcript naming its tool call; a
//   foreground one with that call's tool_result.
// - Shells left running (Bash with run_in_background) and monitors (Monitor), the session's own and
//   its subagents' (each in its own transcript): the call, its result (the task id, and the file a
//   shell's output goes to), and a <task-notification> when a shell ends or a monitor has news. A
//   monitor says nothing when it stops, so the terminal's own footer ("4 shells, 2 monitors", its
//   subagents' included), when it's on screen, settles which are still running.
// A transcript can pass 500 MB, so it's read in pieces (logread.js): all of it the first time, then
// only what's been added.
import fs from 'node:fs'
import path from 'node:path'
import { readAdded, readSlice, tailLines } from './logread.js'

const RECENT_MS = 3 * 3600 * 1000 // finished ones stay listed this long
const MAX = 12
const scans = new Map() // transcript -> what's been read of it (see scan)
const counts = new Map() // subagent file -> { offset, carry, n }
const briefs = new Map() // subagent file -> { text, ts }
const recents = new Map() // subagent file -> { size, steps }

const firstLine = (s) => String(s || '').split('\n')[0].slice(0, 160)

// --- Reading a transcript ------------------------------------------------------------------

const NOTE = /<task-notification>([\s\S]*?)<\/task-notification>/g
const RESULT = /"tool_use_id":"(toolu_\w+)","type":"tool_result","content":\[\{"type":"text","text":"(.{0,40})/g
const CALLS = /"name":"(?:Bash|Monitor|TaskStop)"|"backgroundTaskId"|"timeoutMs"/

// A notice the session was sent: as its own message, or queued while it was busy. (The same text
// also turns up inside the requests it logs, and in tool output that quotes it; those are skipped.)
function noticeText(e) {
  if (e.type === 'attachment') return typeof e.attachment?.prompt === 'string' ? e.attachment.prompt : ''
  if (e.type !== 'user') return ''
  const c = e.message?.content
  return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : ''
}

function notices(c, text) {
  for (let m; (m = NOTE.exec(text));) {
    const b = m[1]
    const id = /<task-id>(\w+)<\/task-id>/.exec(b)?.[1]
    if (!id) continue
    const use = /<tool-use-id>(\w+)<\/tool-use-id>/.exec(b)?.[1]
    const status = /<status>(\w+)<\/status>/.exec(b)?.[1]
    if (status) { c.ends.set(id, status); if (use) c.ends.set(use, status) }
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(b)?.[1]
    if (summary && status) c.notes.set(id, summary.trim().slice(0, 600))
    const event = /<event>([\s\S]*?)<\/event>/.exec(b)?.[1]
    if (event) c.events.set(id, event.trim().slice(-3000))
  }
}

function take(c, text) {
  // Foreground agents end with their tool call's result (background ones get an "Async agent launched" result first).
  for (let m; (m = RESULT.exec(text));) if (!/^Async agent launched/.test(m[2]) && !c.ends.has(m[1])) c.ends.set(m[1], 'completed')
  const anyNote = text.includes('<task-notification>')
  if (!anyNote && !CALLS.test(text)) return
  for (const line of text.split('\n')) {
    const note = anyNote && line.includes('<task-notification>')
    if (!note && !CALLS.test(line)) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (note) notices(c, noticeText(e))
    if ((e.type !== 'assistant' && e.type !== 'user') || !Array.isArray(e.message?.content)) continue
    for (const b of e.message.content) {
      if (e.type === 'assistant' && b.type === 'tool_use') {
        const i = b.input || {}
        const call = { title: i.description || firstLine(i.command), command: String(i.command || '').slice(0, 2000), ts: e.timestamp }
        if (b.name === 'Monitor') c.calls.set(b.id, { ...call, kind: 'monitor', timeoutMs: i.timeout_ms, persistent: !!i.persistent })
        else if (b.name === 'Bash') {
          // A command you background yourself (Ctrl+B) wasn't started in the background, so keep the last few.
          c.calls.set(b.id, { ...call, kind: 'shell', bg: !!i.run_in_background })
          if (!i.run_in_background) { c.plain.push(b.id); if (c.plain.length > 200) c.calls.delete(c.plain.shift()) }
        } else if (b.name === 'TaskStop' && (i.task_id || i.shell_id)) c.stops.add(i.task_id || i.shell_id)
      } else if (e.type === 'user' && b.type === 'tool_result' && c.calls.has(b.tool_use_id)) {
        const call = c.calls.get(b.tool_use_id)
        const r = e.toolUseResult || {}
        const said = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join('')
        const id = r.backgroundTaskId || r.taskId || /with ID: (\w+)/.exec(said)?.[1] || /Monitor started \(task (\w+)/.exec(said)?.[1]
        if (!id || (call.kind === 'shell' && !call.bg && !r.backgroundTaskId)) continue
        const out = /Output is being written to: (\S+?\.output)\b/.exec(said)?.[1] || null
        c.tasks.set(id, { ...call, id, use: b.tool_use_id, out, timeoutMs: r.timeoutMs ?? call.timeoutMs, persistent: r.persistent ?? call.persistent })
      }
    }
  }
}

const fresh = () => ({ offset: 0, carry: Buffer.alloc(0), ends: new Map(), notes: new Map(), events: new Map(), calls: new Map(), plain: [], tasks: new Map(), stops: new Set(), busy: null })

// Brings what's known of a transcript (the session's, or a subagent's) up to date. One read at a
// time per file.
async function scan(file) {
  for (let b; (b = scans.get(file)?.busy);) await b.catch(() => {})
  const { size } = await fs.promises.stat(file)
  let c = scans.get(file)
  if (c?.busy) return scan(file)
  if (!c || size < c.offset) { c = fresh(); scans.set(file, c) }
  if (size > c.offset) {
    c.busy = readAdded(c, file, size, (text) => take(c, text)).finally(() => { c.busy = null })
    await c.busy
  }
  return c
}

// --- Subagents -------------------------------------------------------------------------------

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

async function brief(file) {
  if (briefs.has(file)) return briefs.get(file)
  let b = { text: '', ts: null }
  try {
    const first = (await readSlice(file, 0, 256 * 1024)).split('\n')[0]
    const e = JSON.parse(first)
    const c = e.message?.content
    const t = typeof c === 'string' ? c : (c || []).find((x) => x.type === 'text')?.text
    b = { text: String(t || '').slice(0, 1200), ts: e.timestamp }
    briefs.set(file, b)
  } catch { /* still being written */ }
  return b
}

async function toolCount(file, size) {
  let st = counts.get(file)
  if (!st || size < st.offset) { st = { offset: 0, carry: Buffer.alloc(0), n: 0 }; counts.set(file, st) }
  if (size > st.offset) await readAdded(st, file, size, (text) => { st.n += (text.match(/"type":"tool_use"/g) || []).length })
  return st.n
}

async function recentSteps(file, size) {
  const hit = recents.get(file)
  if (hit?.size === size) return hit.steps
  const s = steps(await tailLines(file, size, 400 * 1024))
  recents.set(file, { size, steps: s })
  return s
}

async function subagents(mainFile, ends, now) {
  const dir = path.join(mainFile.replace(/\.jsonl$/, ''), 'subagents')
  let names
  try { names = await fs.promises.readdir(dir) } catch { return [] }
  const all = (await Promise.all(names.filter((n) => n.endsWith('.meta.json')).map(async (n) => {
    const id = n.replace(/\.meta\.json$/, '')
    const file = path.join(dir, `${id}.jsonl`)
    try { return { id, file, meta: path.join(dir, n), st: await fs.promises.stat(file) } } catch { return null }
  }))).filter(Boolean)

  const items = []
  for (const { id, file, meta: metaFile, st } of all.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)) {
    if (now - st.mtimeMs > RECENT_MS) break // sorted newest first: the rest are older still
    let meta = {}
    try { meta = JSON.parse(await fs.promises.readFile(metaFile, 'utf8')) } catch { /* partial write */ }
    const end = ends.get(id.replace(/^agent-/, '')) || (meta.toolUseId && ends.get(meta.toolUseId))
    let status = end ? (end === 'completed' ? 'done' : end) : 'running'
    // No word from the session but nothing written for a while: it isn't running any more.
    if (status === 'running' && now - st.mtimeMs > 20 * 60 * 1000) status = 'stopped'
    const recent = await recentSteps(file, st.size)
    const result = status !== 'running' ? [...recent].reverse().find((s) => s.kind === 'text')?.text || null : null
    const b = await brief(file)
    items.push({ file, item: {
      id,
      description: meta.description || 'Subagent',
      type: meta.agentType || 'agent',
      background: meta.requestShape === 'background',
      status,
      startedAt: b.ts,
      updatedAt: new Date(st.mtimeMs).toISOString(),
      tools: await toolCount(file, st.size),
      brief: b.text,
      steps: recent.slice(-12).map((s) => (s.kind === 'text' ? { ...s, text: s.text.slice(0, 600) } : s)),
      result: result && result.slice(0, 4000),
    } })
    if (items.length >= MAX) break
  }
  return items // [{ file, item }]
}

// --- Shells and monitors ---------------------------------------------------------------------

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]/g
// The end of a shell's output file, as the lines a terminal would show (a progress bar's \r rewrites its line).
async function outputOf(file) {
  // Only Claude's own output files: <somewhere>/tasks/<id>.output
  if (!file || !path.isAbsolute(file) || path.basename(path.dirname(file)) !== 'tasks' || !/^\w+\.output$/.test(path.basename(file))) return null
  try {
    const st = await fs.promises.stat(file)
    const text = (await tailLines(file, st.size, 16 * 1024)).join('\n').replace(ANSI, '')
    const lines = text.split('\n').map((l) => l.split('\r').filter(Boolean).pop() || '').map((l) => l.trimEnd())
    while (lines.length && !lines.at(-1)) lines.pop()
    return { mtimeMs: st.mtimeMs, lines: lines.slice(-40).map((l) => l.slice(0, 400)) }
  } catch { return null }
}

// Claude Code's footer, when it's on screen: "⏵⏵ auto mode on · 1 shell, 2 monitors", then a row
// per subagent under "⏺ main" ("◯ Explore  Count meeting test checks   13s · ↓ 28.0k tokens").
export function footerOf(screen) {
  const lines = String(screen || '').replace(ANSI, '').split('\n').map((l) => l.replace(/\r$/, ''))
  while (lines.length && !lines.at(-1).trim()) lines.pop() // the terminal's empty rows below it
  lines.splice(0, lines.length - 30)
  const mode = lines.findLast((l) => /⏵⏵|\b\d+ (?:shells?|monitors?)\b|\? for shortcuts/.test(l))
  const n = (re) => (mode ? Number(re.exec(mode)?.[1] || 0) : null)
  const rows = []
  const main = lines.findIndex((l) => /^\s*⏺ main\s*$/.test(l))
  if (main >= 0) {
    for (const l of lines.slice(main + 1)) {
      const m = /^\s*[◯●◉○]\s+(\S+(?: \S+)?)\s{2,}(.+?)(?:\s{2,}(\d[\dhms ]*?)\s*·\s*[↓↑]\s*(\S+) tokens)?\s*$/.exec(l)
      if (!m) break
      rows.push({ type: m[1], doing: m[2], elapsed: m[3] || null, tokens: m[4] || null })
    }
  }
  return { shells: n(/(\d+) shells?\b/), monitors: n(/(\d+) monitors?\b/), rows }
}

// Shells and monitors from one transcript (c, from scan), with what's known of each.
async function tasksOf(c, now, by) {
  const out = []
  for (const t of c.tasks.values()) {
    const end = c.ends.get(t.id) || c.ends.get(t.use)
    const started = Date.parse(t.ts) || now
    const o = t.kind === 'shell' ? await outputOf(t.out) : null
    const last = Math.max(started, o?.mtimeMs || 0)
    let status = end ? (end === 'completed' ? 'done' : end) : c.stops.has(t.id) ? 'stopped' : 'running'
    if (status === 'running' && t.kind === 'monitor' && t.timeoutMs && !t.persistent && now > started + t.timeoutMs) status = 'ended'
    out.push({ t, o, c, by, started, status, last, open: !end && !c.stops.has(t.id) })
  }
  return out
}

// All of them: the footer counts what's running now, so the newest that many are, and older ones
// nothing was heard from have stopped. Without a footer, ones quiet for hours have.
function settle(all, foot, now) {
  all.sort((a, b) => b.started - a.started)
  for (const kind of ['shell', 'monitor']) {
    const count = kind === 'shell' ? foot.shells : foot.monitors
    const open = all.filter((x) => x.t.kind === kind && x.open)
    if (count != null) open.forEach((x, i) => { x.status = i < count ? 'running' : 'ended' })
    else open.forEach((x) => { if (x.status === 'running' && now - x.last > RECENT_MS) x.status = 'ended' })
  }
  return all
    .filter((x) => x.status === 'running' || now - x.last < RECENT_MS)
    .slice(0, MAX)
    .map(({ t, o, c, by, status, last }) => ({
      id: t.id,
      kind: t.kind,
      description: t.title || (t.kind === 'shell' ? 'Shell' : 'Monitor'),
      command: t.command,
      by, // the subagent that started it, if one did
      status,
      startedAt: t.ts,
      updatedAt: new Date(last).toISOString(),
      summary: c.notes.get(t.id) || null,
      output: o?.lines || null,
      event: t.kind === 'monitor' ? c.events.get(t.id)?.slice(-1500) || null : null,
    }))
}

// mainFile: the session's own transcript (or null); screen: its terminal's last lines.
export async function listSubagents(mainFile, screen = '') {
  const now = Date.now()
  const foot = footerOf(screen)
  let items = []
  let tasks = []
  if (mainFile) {
    const c = await scan(mainFile)
    const subs = await subagents(mainFile, c.ends, now)
    items = subs.map((s) => s.item)
    const theirs = await Promise.all(subs.map(async ({ file, item }) => tasksOf(await scan(file), now, item.description).catch(() => [])))
    tasks = settle([...(await tasksOf(c, now, null)), ...theirs.flat()], foot, now)
  }
  // Running in the terminal but not in its logs (a Claude Code that keeps them somewhere new): the
  // footer's rows, so you still see what each one is doing.
  if (!items.some((i) => i.status === 'running') && foot.rows.length) {
    items = [...foot.rows.map((r, i) => ({ id: `screen-${i}`, description: r.doing, type: r.type, status: 'running', fromScreen: true, elapsed: r.elapsed, tokens: r.tokens, steps: [], tools: 0 })), ...items]
  }
  const order = { running: 0, failed: 1, killed: 1, stopped: 2, ended: 2, done: 3 }
  items.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || (b.startedAt || '').localeCompare(a.startedAt || ''))
  tasks.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || (b.startedAt || '').localeCompare(a.startedAt || ''))
  return { items, tasks, running: items.filter((i) => i.status === 'running').length + tasks.filter((t) => t.status === 'running').length }
}
