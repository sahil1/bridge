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

// The first message of an agent started by a hand-off (handoff.js): in Chat, a line saying where
// it came from, with the handover itself folded under it, rather than a wall of text from you.
export const HANDOVER = /^\[Bridge AI handover from ([^\]\n]{1,60})\]\s*/
const handover = (text, ts) => {
  const m = HANDOVER.exec(text)
  return m && { role: 'event', status: 'completed', text: `Handed over from ${m[1]}`, summary: text.slice(m[0].length).slice(0, 40000), handover: m[1], ts }
}

// A model switch (/model, typed anywhere): Claude Code logs the command, then what it said, as
// local command entries (type "system" in newer versions, "user" in older ones).
// eslint-disable-next-line no-control-regex
const noAnsi = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
const entryText = (e) => (typeof e.content === 'string' ? e.content : typeof e.message?.content === 'string' ? e.message.content : '')
const MODEL_CMD = /<command-name>\/model<\/command-name>/
const LOCAL_OUT = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/
// { arg } for the /model command entry, { said } for its output, null for anything else.
function modelStep(e) {
  if (e.isSidechain) return null
  const t = entryText(e)
  if (!t) return null
  if (MODEL_CMD.test(t)) return { arg: (/<command-args>([^<]*)<\/command-args>/.exec(t)?.[1] || '').trim() }
  if (/<command-name>/.test(t)) return { other: true }
  const out = LOCAL_OUT.exec(t)
  return out ? { said: noAnsi(out[1]).trim() } : null
}
const SET_MODEL = /^(set model to|kept model as)\b/i

function claudeMessages(entries) {
  const out = []
  const calls = new Map() // edit call id -> { m: its message, b: the call }, for the count its result brings
  // Each message keeps its entry's id, so pages of older messages join up without repeats.
  let cur = null
  let k = 0
  let modelCmd = false // the last local command was /model: its output says how the switch went
  const add = (m) => out.push(cur ? { ...m, id: `${cur}:${k++}` } : m)
  for (const e of entries) {
    cur = e.uuid || null
    k = 0
    const step = modelStep(e)
    if (step?.arg != null || step?.other) modelCmd = step.arg != null
    if (step?.arg != null) continue
    if (step?.said != null) {
      // "Set model to Sonnet 4.5": a line in the chat, like Claude's own terminal shows it.
      if (modelCmd || SET_MODEL.test(step.said)) add({ role: 'event', status: /^set model/i.test(step.said) ? 'completed' : SET_MODEL.test(step.said) ? '' : 'failed', text: step.said.split('\n')[0].replace(/`/g, '').slice(0, 200), ts: e.timestamp })
      modelCmd = false
      continue
    }
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
      add((e.type === 'user' && handover(content, ts)) || { role: e.type, text: content, ts })
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
        add((e.type === 'user' && handover(b.text, ts)) || { role: e.type, text: b.text, ts })
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
// Codex's async messages (a question asked while it works, or a note to you) are logged only as
// events, not as messages. Shown as what it said; the question's tool call adds nothing to that.
const ASYNC_TOOLS = new Set(['request_user_input_async', 'send_message_to_user_async'])
const asyncText = (it) => (it.questions?.length
  ? it.questions.map((q) => [`**${String(q.title || '').trim()}**`, ...(q.options || []).map((o) => `- ${o}`)].join('\n')).join('\n\n')
  : (it.content || []).map((c) => c.text || '').join('').trim())
// Your answer from Codex's own question editor, as the question and what you said.
function replyText(text) {
  const m = REPLY.exec(text)
  if (!m) return null
  try { return JSON.parse(m[1].trim()).map((r) => `> ${String(r.question || '').trim()}\n\n${String(r.answer || '').trim()}`).join('\n\n') } catch { return null }
}
function codexMessages(entries) {
  const out = []
  const calls = new Map() // apply_patch call id -> its message
  for (const e of entries) {
    const p = e.payload || {}
    if (e.type === 'response_item' && p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      let text = (p.content || []).map((c) => c.text || '').join('').trim()
      if (p.role === 'user') text = replyText(text) || text
      if (!text || text.startsWith('<environment_context>') || text.startsWith('<user_instructions>')) continue
      out.push((p.role === 'user' && handover(text, e.timestamp)) || { role: p.role, text, ts: e.timestamp })
    } else if (e.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'AgentMessage' && p.item.delivery === 'async') {
      const text = asyncText(p.item)
      if (text) out.push({ role: 'assistant', text, ts: e.timestamp, ...(p.item.questions?.length && { asked: true }) })
    } else if (e.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call') && ASYNC_TOOLS.has(p.name)) {
      continue
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

// The model an agent is on, from the end of its transcript: the model of its latest reply
// (reply), its latest /model and what Claude Code said to it (set: { arg, said, ok, model, at }),
// and the latest one that worked (switched).
// Codex logs the model of each turn (turn_context). Reads a small tail only.
export function modelOf({ kind, sessionId, cwd }) {
  if (!sessionId || (kind !== 'claude' && kind !== 'codex')) return null
  const file = locate(kind, sessionId, cwd)
  if (!file) return null
  const entries = parseLines(tailLines(file, 512 * 1024).filter((l) => l.includes('model') || l.includes('local-command')))
  let reply = null
  let set = null
  let switched = null
  let cmd = null
  for (const e of entries) {
    if (kind === 'codex') {
      if (e.type === 'turn_context' && e.payload?.model) reply = { model: String(e.payload.model), at: e.timestamp || null }
      continue
    }
    if (e.type === 'assistant' && !e.isSidechain && e.message?.model && e.message.model !== '<synthetic>') reply = { model: e.message.model, at: e.timestamp || null }
    const step = modelStep(e)
    if (step?.other) cmd = null
    else if (step?.arg != null) cmd = { arg: step.arg, at: e.timestamp || null }
    else if (step?.said != null && (cmd || SET_MODEL.test(step.said))) {
      // The model id it names, as in "Set model to Opus 5.5 (claude-opus-5-5)", else what was asked for.
      const id = /\((claude-[\w.[\]-]+)\)/.exec(step.said)?.[1] || null
      set = { arg: cmd?.arg || null, said: step.said.split('\n')[0].replace(/`/g, '').slice(0, 200), ok: /^set model to\b/i.test(step.said), model: id || cmd?.arg || null, at: e.timestamp || null }
      if (set.ok) switched = set
      cmd = null
    }
  }
  return { reply, set, switched }
}

// Codex's questions asked while it works (its request_user_input_async tool, Codex 0.160+): it
// logs each as an async agent message with { title, options } and carries on. Its terminal folds
// them into "1 question, ⇧← to answer" and drops them when the turn ends, answered or not, so
// they're read from the log. One is open until you answer it (a reply naming it, from Codex's own
// editor) or send any other message, which is when Codex drops them too. working: its turn is
// still running. The log is read on from where the last look stopped.
export const REPLY = /<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/
const askState = new Map() // file -> { size, state }
const ASK_LINE = /"delivery":"async"|"task_started"|"task_complete"|"turn_aborted"|"role":"user"/
export function asksOf({ kind, sessionId, cwd }) {
  if (kind !== 'codex' || !sessionId) return null
  const file = locate(kind, sessionId, cwd)
  if (!file) return null
  let size
  try { size = fs.statSync(file).size } catch { return null }
  let c = askState.get(file)
  if (!c || size < c.size) c = { size: 0, state: { open: [], working: false } }
  if (size > c.size) {
    // From the tail the first time, then only what was added (whole lines; a partial one waits).
    const from = c.size || Math.max(0, size - TAIL_BYTES)
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size - from)
    try { fs.readSync(fd, buf, 0, buf.length, from) } finally { fs.closeSync(fd) }
    const end = buf.lastIndexOf(10)
    if (end >= 0) {
      let lines = buf.subarray(0, end).toString('utf8').split('\n')
      if (!c.size && from > 0) lines = lines.slice(1)
      for (const line of lines) if (ASK_LINE.test(line)) { try { askStep(c.state, JSON.parse(line)) } catch { /* not JSON */ } }
      c = { size: from + end + 1, state: c.state }
    }
    askState.set(file, c)
  }
  const s = c.state
  return { open: s.open.map((q) => ({ ...q, options: [...q.options] })), working: s.working }
}
function askStep(s, e) {
  const p = e.payload || {}
  if (e.type === 'event_msg') {
    if (p.type === 'task_started') s.working = true
    else if (p.type === 'task_complete' || p.type === 'turn_aborted') s.working = false
    const it = p.item
    if (p.type === 'item_completed' && it?.type === 'AgentMessage' && it.delivery === 'async' && Array.isArray(it.questions)) {
      it.questions.forEach((q, index) => {
        const title = String(q?.title || '').trim()
        if (title && !s.open.some((o) => o.id === it.id && o.index === index)) s.open.push({ id: String(it.id || ''), index, title: title.slice(0, 4000), options: (Array.isArray(q.options) ? q.options : []).map(String).filter((o) => o.trim()).slice(0, 32), at: e.timestamp || null })
      })
    }
  } else if (e.type === 'response_item' && p.type === 'message' && p.role === 'user') {
    const text = (p.content || []).map((x) => x.text || '').join('').trim()
    const reply = REPLY.exec(text)
    if (reply) {
      // [{ answer, question, questionItemId }]: the id is ["request_user_input_async", message id, index]
      // (or, from older clients, the message id alone).
      let replies = []
      try { replies = JSON.parse(reply[1].trim()) } catch { /* unreadable: leave them open */ }
      for (const r of Array.isArray(replies) ? replies : []) {
        let qid = r?.questionItemId
        try { qid = JSON.parse(qid) } catch { /* a plain message id */ }
        s.open = s.open.filter((o) => !(Array.isArray(qid) ? o.id === qid[1] && o.index === qid[2] : o.id === qid))
      }
    } else if (text && !text.startsWith('<')) s.open = [] // anything you say (not Codex's own context)
  }
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

// The start of a conversation, for a handover (handoff.js): its first messages from the top of the
// file (the 3 MB tail Chat reads can miss them in a long one). Reads the first 1 MB only.
export function opening({ kind, sessionId, cwd }) {
  const file = sessionId && (kind === 'claude' || kind === 'codex') && locate(kind, sessionId, cwd)
  if (!file) return []
  const fd = fs.openSync(file, 'r')
  let text
  try {
    const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 1024 * 1024))
    fs.readSync(fd, buf, 0, buf.length, 0)
    text = buf.toString('utf8')
  } finally { fs.closeSync(fd) }
  const lines = text.split('\n')
  if (lines.length > 1) lines.pop() // likely cut short
  const entries = parseLines(lines.filter(Boolean))
  return kind === 'claude' ? claudeMessages(entries.filter((e) => !e.isSidechain)) : codexMessages(entries)
}

// The agent's own to-do list as it last left it: Claude Code's TodoWrite (or its newer TaskCreate
// and TaskUpdate), Codex's update_plan. [{ text, status: pending|in_progress|completed }] or null.
export function planOf({ kind, sessionId, cwd }) {
  const file = sessionId && (kind === 'claude' || kind === 'codex') && locate(kind, sessionId, cwd)
  if (!file) return null
  const lines = readTail(file).lines.filter((l) => /TodoWrite|TaskCreate|TaskUpdate|update_plan/.test(l))
  let plan = null
  const tasks = new Map() // TaskCreate numbers its tasks in order, from 1
  for (const e of parseLines(lines)) {
    if (kind === 'codex') {
      const p = e.payload || {}
      if (p.type !== 'function_call' || p.name !== 'update_plan') continue
      try { const a = JSON.parse(p.arguments || '{}'); if (Array.isArray(a.plan)) plan = a.plan.map((x) => ({ text: String(x.step || ''), status: String(x.status || 'pending') })) } catch { /* not JSON */ }
      continue
    }
    if (e.type !== 'assistant' || e.isSidechain || !Array.isArray(e.message?.content)) continue
    for (const b of e.message.content) {
      if (b.type !== 'tool_use') continue
      if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) { plan = b.input.todos.map((x) => ({ text: String(x.content || ''), status: String(x.status || 'pending') })); tasks.clear() }
      else if (b.name === 'TaskCreate') tasks.set(String(tasks.size + 1), { text: String(b.input?.subject || b.input?.description || ''), status: 'pending' })
      else if (b.name === 'TaskUpdate' && tasks.has(String(b.input?.taskId))) {
        const t = tasks.get(String(b.input.taskId))
        if (b.input.status === 'deleted') tasks.delete(String(b.input.taskId)); else if (b.input.status) t.status = String(b.input.status)
      }
    }
    if (tasks.size) plan = [...tasks.values()]
  }
  return plan?.filter((x) => x.text) || null
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
