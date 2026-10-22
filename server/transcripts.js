// Turn an agent's on-disk transcript into chat messages.
// Claude Code: ~/.claude/projects/<cwd slug>/<session>.jsonl
// Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*-<session>.jsonl
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { CLAUDE_EDITS, claudeEdit, codexPatch, codexFailed } from './edits.js'

const HOME = os.homedir()
const TAIL_BYTES = 3 * 1024 * 1024
const pathCache = new Map()

function claudeFile(sessionId, cwd) {
  const root = path.join(HOME, '.claude', 'projects')
  const direct = path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`)
  if (fs.existsSync(direct)) return direct
  // The agent may have changed directory after starting; scan project dirs. A Claude Code that has
  // never saved a session has no projects folder yet: no transcript, not an error.
  let dirs = []
  try { dirs = fs.readdirSync(root) } catch { return null }
  for (const dir of dirs) {
    const p = path.join(root, dir, `${sessionId}.jsonl`)
    if (fs.existsSync(p)) return p
  }
  return null
}

// After you edit or rewind a message, Codex carries on in a new file named
// rollout-<time>-<old id>_<new id>.jsonl. Follow those to the newest, so Chat shows the
// conversation as it stands (also when you rewound in Codex's own terminal).
function codexFile(sessionId, depth = 0) {
  const key = `codex-exact:${sessionId}`
  let p = pathCache.get(key)
  if (!p || !fs.existsSync(p)) { p = codexFileExact(sessionId); if (p) pathCache.set(key, p) }
  if (!p || depth > 8) return p
  let next = null
  for (const dir of new Set([path.dirname(p), ...[0, 1].map((n) => { const d = new Date(Date.now() - n * 864e5); return path.join(HOME, '.codex', 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')) })])) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const n of names) {
      if (!n.endsWith('.jsonl') || !n.includes(`${sessionId}_`)) continue
      const t = fs.statSync(path.join(dir, n)).mtimeMs
      if (!next || t > next.t) next = { t, id: n.slice(n.indexOf(`${sessionId}_`) + sessionId.length + 1, -6) }
    }
  }
  return next?.id ? codexFile(next.id, depth + 1) || p : p
}

function codexFileExact(sessionId) {
  const root = path.join(HOME, '.codex', 'sessions')
  if (!fs.existsSync(root)) return null
  const walk = (dir, depth) => {
    for (const name of fs.readdirSync(dir).sort().reverse()) {
      const p = path.join(dir, name)
      if (depth < 3) {
        if (fs.statSync(p).isDirectory()) {
          const hit = walk(p, depth + 1)
          if (hit) return hit
        }
      } else if (name.endsWith(`${sessionId}.jsonl`)) {
        return p
      }
    }
    return null
  }
  return walk(root, 0)
}

export function locate(kind, sessionId, cwd) {
  if (kind === 'codex') return codexFile(sessionId) // checks for newer forks each time (cached underneath)
  const key = `${kind}:${sessionId}`
  const cached = pathCache.get(key)
  if (cached && fs.existsSync(cached)) return cached
  const file = kind === 'claude' ? claudeFile(sessionId, cwd) : null
  if (file) pathCache.set(key, file)
  return file
}

// The end of the file, as whole lines; `start` is where the first whole line begins.
function readTail(file, bytes = TAIL_BYTES) {
  const { size } = fs.statSync(file)
  let start = Math.max(0, size - bytes)
  const fd = fs.openSync(file, 'r')
  let buf = Buffer.alloc(size - start)
  fs.readSync(fd, buf, 0, buf.length, start)
  fs.closeSync(fd)
  if (start > 0) { const nl = buf.indexOf(10); buf = nl < 0 ? Buffer.alloc(0) : buf.subarray(nl + 1); start = nl < 0 ? size : start + nl + 1 } // the first line is likely partial
  return { lines: buf.toString('utf8').split('\n').filter(Boolean), start }
}
const tailLines = (file, bytes) => readTail(file, bytes).lines

function toolLabel(block) {
  const input = block.input || {}
  const hint = input.description || input.command || input.file_path || input.pattern || input.url || input.prompt || ''
  return { tool: block.name, hint: String(hint).split('\n')[0].slice(0, 140) }
}

// Only the conversation as it stands. Claude never deletes from its log: after a rewind (an
// edited message) the old turns stay in the file, and each entry points at its parent. So start
// at the newest entry and follow the parents back; entries off that path were rewound away.
// A /compact starts a new chain. Its first entry (the compact boundary) points back to the old one:
// older Claude versions with logicalParentUuid, newer ones through the messages it kept from before
// (compactMetadata.preservedMessages), which sit just before the boundary. So the walk goes back by
// place in the file, to the latest of those it finds, and on through every compaction. Each
// message is kept once, where it first appeared. `frontier` lists the ids to look for further back
// in the file (null at the start of the conversation). `leaf`: start there instead (after an undo,
// see markUndone; '' when it went back to before the first message).
const backTo = (e) => (e.parentUuid ? [e.parentUuid] : [e.logicalParentUuid, ...(e.compactMetadata?.preservedMessages?.allUuids || e.compactMetadata?.preservedMessages?.uuids || []), e.compactMetadata?.preservedSegment?.headUuid].filter(Boolean))
function activeBranch(entries, leaf) {
  if (leaf === '') return { kept: [], frontier: null }
  const at = new Map() // uuid -> indexes, ascending
  entries.forEach((e, i) => { if (e.uuid && !e.isSidechain) { if (!at.has(e.uuid)) at.set(e.uuid, []); at.get(e.uuid).push(i) } })
  let i = leaf ? (at.get(leaf) || []).at(-1) ?? -1 : entries.findLastIndex((e) => e.uuid && !e.isSidechain)
  if (i < 0) return leaf ? { kept: [], frontier: [leaf] } : { kept: entries, frontier: null }
  const keep = new Set()
  let frontier = null
  for (;;) {
    keep.add(i)
    const e = entries[i]
    const ids = backTo(e)
    frontier = ids.length ? ids : null
    if (!frontier) break
    const prev = Math.max(-1, ...ids.flatMap((u) => (at.get(u) || []).filter((j) => j < i)))
    if (prev < 0) break // further back than this part of the file
    i = prev
  }
  const seen = new Set()
  return { kept: entries.filter((e, j) => !e.uuid || (keep.has(j) && !seen.has(e.uuid) && seen.add(e.uuid))), frontier }
}

const parseLines = (lines) => { const out = []; for (const line of lines) { try { out.push(JSON.parse(line)) } catch { /* partial line */ } } return out }
function parseClaude(lines, sessionId) { const entries = parseLines(lines); return claudeMessages(activeBranch(entries, leafOf(sessionId, entries)).kept) }

// A tool message that edits files carries its call id and { path, add, del } per file (edits.js).
const changesOf = (edits) => edits.map(({ path, add, del }) => ({ path, add, del }))

function claudeMessages(entries) {
  const out = []
  const calls = new Map() // edit call id -> { m: its message, b: the call }, for the count its result brings
  // Each message keeps its entry's id, so pages of older messages join up without repeats.
  let cur = null
  let k = 0
  const add = (m) => out.push(cur ? { ...m, id: `${cur}:${k++}` } : m)
  for (const e of entries) {
    cur = e.uuid || null
    k = 0
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isMeta || e.isSidechain) continue
    // Claude's summary of earlier turns (after /compact or "summarize"): a note, not your message.
    if (e.isCompactSummary) {
      const c = e.message?.content
      const summary = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.text || '').join('\n') : ''
      add({ role: 'event', status: 'completed', text: 'Earlier conversation summarized', summary: summary.slice(0, 40000), ts: e.timestamp })
      continue
    }
    const content = e.message?.content
    const ts = e.timestamp
    if (typeof content === 'string') {
      if (e.type === 'user' && /^<(command-|local-command|system-reminder)/.test(content.trim())) continue
      // Claude's own "background task finished" notice: a short event line, not a message from you.
      if (e.type === 'user' && /^<task-notification>/.test(content.trim())) {
        const tag = (t) => (new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(content) || [])[1]?.trim()
        add({ role: 'event', status: tag('status') || '', text: tag('summary') || 'A background task finished', ts })
        continue
      }
      add({ role: e.type, text: content, ts })
      continue
    }
    if (!Array.isArray(content)) continue
    // Images you pasted into the agent: kept in its log, served back by imageFrom().
    const images = e.type === 'user' && e.uuid ? content.map((b, i) => (b.type === 'image' ? { uuid: e.uuid, i } : null)).filter(Boolean) : []
    if (images.length) {
      const text = content.filter((b) => b.type === 'text' && b.text?.trim() && !/^<(system-reminder|command-)/.test(b.text.trim())).map((b) => b.text).join('\n\n')
      add({ role: 'user', text, images, ts })
      continue
    }
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) {
        if (e.type === 'user' && /^<(system-reminder|command-)/.test(b.text.trim())) continue
        add({ role: e.type, text: b.text, ts })
      } else if (b.type === 'tool_use') {
        const edit = CLAUDE_EDITS.has(b.name) && claudeEdit(b.name, b.input)
        add({ role: 'tool', ...toolLabel(b), ...(edit && { call: b.id, changes: changesOf([edit]) }), ts })
        if (edit) calls.set(b.id, { m: out.at(-1), b })
      } else if (b.type === 'tool_result' && calls.has(b.tool_use_id)) {
        // The edit ran: count what Claude applied, or nothing if it failed or you said no.
        const { m, b: call } = calls.get(b.tool_use_id)
        m.changes = b.is_error ? [] : changesOf([claudeEdit(call.name, call.input, typeof e.toolUseResult === 'object' ? e.toolUseResult : null)])
      }
    }
  }
  return out
}

function parseCodex(lines) { return codexMessages(parseLines(lines)) }
function codexMessages(entries) {
  const out = []
  const calls = new Map() // apply_patch call id -> its message
  for (const e of entries) {
    const p = e.payload || {}
    if (e.type === 'response_item' && p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = (p.content || []).map((c) => c.text || '').join('').trim()
      if (!text || text.startsWith('<environment_context>') || text.startsWith('<user_instructions>')) continue
      out.push({ role: p.role, text, ts: e.timestamp })
    } else if (e.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
      const patch = codexPatch(p)
      let hint = patch ? patch.map((f) => f.path).join(', ') : typeof p.input === 'string' ? p.input.split('\n')[0] : ''
      if (!patch && p.type === 'function_call') { try { const a = JSON.parse(p.arguments); hint = Array.isArray(a.command) ? a.command.join(' ') : a.command || '' } catch { /* keep empty */ } }
      out.push({ role: 'tool', tool: p.name, hint: String(hint).slice(0, 140), ...(patch?.length && { call: p.call_id, changes: changesOf(patch) }), ts: e.timestamp })
      if (patch?.length) calls.set(p.call_id, out.at(-1))
    } else if (e.type === 'response_item' && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && calls.has(p.call_id) && codexFailed(p.output)) {
      calls.get(p.call_id).changes = [] // the patch didn't apply
    }
  }
  return out
}

// Everything in the last 3 MB: no cap on the count, so nothing falls between this and the older pages.
export function transcript({ kind, sessionId, cwd }, limit = 2000) {
  if (!sessionId) return { supported: false, messages: [] }
  const file = locate(kind, sessionId, cwd)
  if (!file) return { supported: false, messages: [] }
  const { lines, start } = readTail(file)
  if (kind !== 'claude') return { supported: true, messages: parseCodex(lines).slice(-limit), more: start > 0 ? { before: start } : null }
  const entries = parseLines(lines)
  const { kept, frontier } = activeBranch(entries, leafOf(sessionId, entries))
  const messages = claudeMessages(kept)
  // More before this: the file goes back further, and the conversation does too.
  return { supported: true, messages: messages.slice(-limit), more: start > 0 && frontier ? { before: start, after: frontier.join(',') } : null }
}

// Older messages, before what Chat has (`before`: a place in the file; `after`: for Claude, the
// entry the conversation continues back from). Reads backwards a few MB at a time until it has
// about `want` messages, or 64 MB, or the start. Agent logs can run to hundreds of MB, mostly tool
// output and pictures, so the whole file is never read at once.
const CHUNK = 4 * 1024 * 1024
export function earlier({ kind, sessionId, cwd }, before, after, want = 60) {
  const file = sessionId && locate(kind, sessionId, cwd)
  if (!file) return { messages: [], more: null }
  const fd = fs.openSync(file, 'r')
  try {
    let end = Math.min(Number(before) || 0, fs.fstatSync(fd).size)
    let carry = Buffer.alloc(0) // the start of a line whose rest is in the chunk read before
    let lineStart = end
    let frontier = kind === 'claude' && after ? String(after).split(',').filter(Boolean) : null
    let pos = end // the walk's place in the file: the next entry is before it
    const at = new Map() // uuid -> [{ off, e }]
    const kept = [] // { off, e }
    let read = 0
    while (end > 0 && read < 64 * 1024 * 1024) {
      const start = Math.max(0, end - CHUNK)
      const chunk = Buffer.alloc(end - start)
      fs.readSync(fd, chunk, 0, chunk.length, start)
      read += chunk.length
      let data = Buffer.concat([chunk, carry])
      let base = start
      if (start > 0) { const nl = data.indexOf(10); carry = data.subarray(0, nl < 0 ? data.length : nl); data = nl < 0 ? Buffer.alloc(0) : data.subarray(nl + 1); base = nl < 0 ? end : start + nl + 1 } else carry = Buffer.alloc(0)
      lineStart = base
      end = start
      // Each line with where it starts in the file.
      let off = base
      for (const line of data.toString('utf8').split('\n')) {
        const here = off
        off += Buffer.byteLength(line) + 1
        if (!line) continue
        let e
        try { e = JSON.parse(line) } catch { continue }
        if (kind !== 'claude') { kept.push({ off: here, e }); continue }
        if (!e.uuid || e.isSidechain) continue
        if (!at.has(e.uuid)) at.set(e.uuid, [])
        at.get(e.uuid).push({ off: here, e })
      }
      if (kind === 'claude') {
        while (frontier) {
          const prev = frontier.flatMap((u) => at.get(u) || []).filter((x) => x.off < pos).sort((x, y) => y.off - x.off)[0]
          if (!prev) break
          kept.push(prev)
          pos = prev.off
          const ids = backTo(prev.e)
          frontier = ids.length ? ids : null
        }
        if (!frontier) break
      }
      const n = list().filter((m) => m.role === 'user' || m.role === 'assistant').length
      if (n >= want) break
    }
    function list() {
      const seen = new Set()
      const es = [...kept].sort((x, y) => x.off - y.off).map((x) => x.e).filter((e) => !e.uuid || (!seen.has(e.uuid) && seen.add(e.uuid)))
      return kind === 'claude' ? claudeMessages(es) : codexMessages(es)
    }
    const more = lineStart > 0 && (kind !== 'claude' || frontier) ? { before: lineStart, ...(frontier ? { after: frontier.join(',') } : {}) } : null
    return { messages: list(), more }
  } finally { fs.closeSync(fd) }
}

// The entries that mention any of `ids`, from the end of the file back a few MB at a time; a chunk
// that mentions none is skipped unparsed. done() is asked between chunks, so every match in a
// chunk is seen (a call's result comes after the call, further down the same chunk).
function scanBack(file, ids, each, done) {
  const needles = ids.map((id) => Buffer.from(`"${id}"`))
  const fd = fs.openSync(file, 'r')
  try {
    let end = fs.fstatSync(fd).size
    let carry = Buffer.alloc(0)
    while (end > 0 && !done()) {
      const start = Math.max(0, end - CHUNK)
      const chunk = Buffer.alloc(end - start)
      fs.readSync(fd, chunk, 0, chunk.length, start)
      let data = Buffer.concat([chunk, carry])
      if (start > 0) { const nl = data.indexOf(10); carry = data.subarray(0, nl < 0 ? data.length : nl); data = nl < 0 ? Buffer.alloc(0) : data.subarray(nl + 1) } else carry = Buffer.alloc(0)
      end = start
      if (!needles.some((n) => data.indexOf(n) >= 0)) continue
      for (const line of data.toString('utf8').split('\n')) {
        if (!ids.some((id) => line.includes(`"${id}"`))) continue
        let e
        try { e = JSON.parse(line) } catch { continue }
        each(e)
      }
    }
  } finally { fs.closeSync(fd) }
}

// What one reply changed, for Chat: the diffs of its edit calls (ids from the tool messages),
// merged per file in the order they were made. Stops once it has passed every call, so a recent
// reply is quick in a log of hundreds of MB.
const MAX_DIFF_LINES = 1500
export function replyDiffs({ kind, sessionId, cwd }, ids) {
  const file = sessionId && locate(kind, sessionId, cwd)
  const want = [...new Set(ids)].filter((id) => /^[\w-]{4,100}$/.test(id)).slice(0, 500)
  if (!file || !want.length) return { files: [] }
  const call = new Map() // id -> the call (Claude) or its patch (Codex)
  const failed = new Set()
  const result = new Map() // Claude: id -> toolUseResult
  scanBack(file, want, (e) => {
    if (kind === 'claude') {
      // Only the conversation's own entries: newer Claude versions also log each API request
      // (api-request-blob), with copies of the calls and results.
      if (e.type !== 'assistant' && e.type !== 'user') return
      for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (b.type === 'tool_use' && want.includes(b.id)) call.set(b.id, CLAUDE_EDITS.has(b.name) ? { name: b.name, input: b.input } : null)
        else if (b.type === 'tool_result' && want.includes(b.tool_use_id)) { if (b.is_error) failed.add(b.tool_use_id); else if (typeof e.toolUseResult === 'object') result.set(b.tool_use_id, e.toolUseResult) }
      }
    } else {
      const p = e.payload || {}
      if (want.includes(p.call_id) && (p.type === 'function_call' || p.type === 'custom_tool_call')) call.set(p.call_id, codexPatch(p) || [])
      else if (want.includes(p.call_id) && /_output$/.test(p.type || '') && codexFailed(p.output)) failed.add(p.call_id)
    }
  }, () => call.size >= want.length)
  const files = new Map()
  for (const id of want) {
    const c = call.get(id)
    if (!c || failed.has(id)) continue
    for (const ed of kind === 'claude' ? [claudeEdit(c.name, c.input, result.get(id))] : c) {
      if (!ed.path) continue
      const f = files.get(ed.path) || files.set(ed.path, { path: ed.path, add: 0, del: 0, lines: [], cut: 0 }).get(ed.path)
      f.add += ed.add
      f.del += ed.del
      const room = Math.max(0, MAX_DIFF_LINES - f.lines.length)
      f.lines.push(...ed.lines.slice(0, room))
      f.cut += Math.max(0, ed.lines.length - room)
    }
  }
  return { files: [...files.values()] }
}

// After Undo this reply, Claude has gone back to just before your message (by its entry id), but
// it writes nothing to its log until you send the next one. So remember where it went back to,
// and until the log moves on, the conversation ends there. In memory only: after a restart Claude
// itself resumes from its newest entry again.
const undone = new Map() // sessionId -> { leaf: the entry it went back to ('' for none), newest: the newest entry then }
export function markUndone({ kind, sessionId, cwd }, uuid) {
  const file = kind === 'claude' && sessionId && /^[\w-]{8,64}$/.test(uuid) && locate(kind, sessionId, cwd)
  if (!file) return
  const tail = parseLines(readTail(file).lines)
  const newest = tail.findLast((e) => e.uuid && !e.isSidechain)?.uuid
  let msg = tail.find((e) => e.uuid === uuid)
  if (!msg) scanBack(file, [uuid], (e) => { if (e.uuid === uuid) msg = e }, () => !!msg)
  if (msg && newest) undone.set(sessionId, { leaf: msg.parentUuid || msg.logicalParentUuid || '', newest })
}
function leafOf(sessionId, entries) {
  const u = undone.get(sessionId)
  if (!u) return undefined
  if (entries.findLast((e) => e.uuid && !e.isSidechain)?.uuid === u.newest) return u.leaf
  undone.delete(sessionId) // the log has moved on and says where the conversation is
  return undefined
}

// Last thing the agent said, for board tiles. Reads a small tail only.
export function preview({ kind, sessionId, cwd }) {
  if (!sessionId || (kind !== 'claude' && kind !== 'codex')) return null
  const file = locate(kind, sessionId, cwd)
  if (!file) return null
  const lines = tailLines(file, 256 * 1024)
  const msgs = kind === 'claude' ? parseClaude(lines, sessionId) : parseCodex(lines)
  const last = [...msgs].reverse().find((m) => m.role === 'assistant' || m.role === 'user')
  const lastTool = msgs.at(-1)?.role === 'tool' ? msgs.at(-1) : null
  if (!last && !lastTool) return null
  return {
    text: last ? last.text.replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) : '',
    role: last?.role || null,
    tool: lastTool ? `${lastTool.tool}${lastTool.hint ? `: ${lastTool.hint}` : ''}` : null,
    ts: msgs.at(-1)?.ts || null,
  }
}

// The session an agent started after `since` in `cwd`, for agents that name their own session
// (Codex writes ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, cwd in the first line).
export function discoverSession(kind, cwd, since) {
  if (kind !== 'codex') return null
  const root = path.join(HOME, '.codex', 'sessions')
  const days = [new Date(), new Date(Date.now() - 864e5)].map((d) => path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')))
  for (const dir of days) {
    let names = []
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')) } catch { continue }
    const fresh = names.map((n) => ({ n, f: path.join(dir, n) })).map((x) => ({ ...x, t: fs.statSync(x.f).birthtimeMs || fs.statSync(x.f).mtimeMs }))
      .filter((x) => x.t >= since - 5000).sort((a, b) => a.t - b.t)
    for (const x of fresh) {
      let first = ''
      try { const fd = fs.openSync(x.f, 'r'); const buf = Buffer.alloc(8192); const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd); first = buf.toString('utf8', 0, n).split('\n')[0] } catch { continue }
      let meta = null
      try { meta = JSON.parse(first) } catch { /* not json */ }
      const fileCwd = meta?.payload?.cwd || meta?.cwd
      if (fileCwd && path.resolve(fileCwd) !== path.resolve(cwd)) continue
      const id = meta?.payload?.id || x.n.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1]
      if (id) return id
    }
  }
  return null
}

// One image from a Claude transcript (an image you pasted), by its entry and block: { type, data }.
export function imageFrom({ kind, sessionId, cwd }, uuid, index) {
  if (kind !== 'claude' || !sessionId || !/^[\w-]{8,64}$/.test(uuid)) return null
  const file = locate(kind, sessionId, cwd)
  if (!file) return null
  // The entry's line holds the image as base64; find it without parsing every line.
  const needle = `"uuid":"${uuid}"`
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes(needle)) continue
    try {
      const b = JSON.parse(line).message?.content?.[index]
      if (b?.type === 'image' && b.source?.type === 'base64' && /^image\/(png|jpeg|gif|webp)$/.test(b.source.media_type)) return { type: b.source.media_type, data: Buffer.from(b.source.data, 'base64') }
    } catch { /* not this one */ }
  }
  return null
}
