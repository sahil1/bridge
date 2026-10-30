// Chat for agents beyond Claude Code and Codex, from the conversation logs they write themselves:
// Gemini CLI, Qwen Code, GitHub Copilot CLI and Cursor Agent. For each: where its log for a folder
// is, the session it started after a time (agents.js sessionId 'discover': no new flags, so an
// older version still starts), and its messages in the shape Chat shows (transcripts.js).
// Formats as of Gemini CLI 0.64, Qwen Code 0.25, Copilot CLI 1.0.63 and Cursor Agent 2026.10.01,
// read from their published source. OpenCode, Crush and Goose keep theirs in SQLite and Amp on its
// servers, so they stay terminal only. A log this can't read shows nothing, never an error.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { claudeEdit } from './edits.js'

const HOME = os.homedir()
const MAX = 8 * 1024 * 1024 // the end of a long log is what Chat shows
const changesOf = (edits) => edits.filter((e) => e.path).map(({ path: p, add, del }) => ({ path: p, add, del }))
const born = (f) => { try { const st = fs.statSync(f); return st.birthtimeMs || st.mtimeMs } catch { return 0 } }
const list = (dir) => { try { return fs.readdirSync(dir) } catch { return [] } }
function readLines(file) {
  const { size } = fs.statSync(file)
  const start = Math.max(0, size - MAX)
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(size - start)
  fs.readSync(fd, buf, 0, buf.length, start)
  fs.closeSync(fd)
  const lines = buf.toString('utf8').split('\n')
  if (start > 0) lines.shift() // cut mid-line
  const out = []
  for (const l of lines) { if (!l) continue; try { out.push(JSON.parse(l)) } catch { /* partial */ } }
  return out
}
const firstLine = (file) => {
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(16384)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    return JSON.parse(buf.toString('utf8', 0, n).split('\n')[0])
  } catch { return null }
}
const hintOf = (a = {}) => String(a.command || a.description || a.file_path || a.filePath || a.path || a.pattern || a.query || a.url || a.dir_path || '').split('\n')[0].slice(0, 140)
const tool = (name, args, ts, edits) => ({ role: 'tool', tool: name, hint: hintOf(args), ...(edits?.length && { changes: changesOf(edits) }), ts })
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('') : '').trim()

// ---------- Gemini CLI ----------
// <home>/.gemini/tmp/<project>/chats/session-<time>-<id first 8>.jsonl: a metadata line, then
// messages; a message is written again as its tools finish (the last one counts), and $rewindTo
// drops a message and everything after it. Older versions: one JSON file per session.
const geminiRoot = () => path.join(process.env.GEMINI_CLI_HOME || HOME, '.gemini')
function geminiDirs(cwd) {
  const tmp = path.join(geminiRoot(), 'tmp')
  let mapped = null
  try { mapped = JSON.parse(fs.readFileSync(path.join(geminiRoot(), 'projects.json'), 'utf8')).projects?.[path.resolve(cwd)] } catch { /* none */ }
  const hash = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex') // older versions
  const named = [mapped, hash].filter(Boolean).map((d) => path.join(tmp, d, 'chats'))
  return named.some((d) => fs.existsSync(d)) ? named : list(tmp).map((d) => path.join(tmp, d, 'chats'))
}
const geminiId = (f) => (f.endsWith('.json') ? (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).sessionId } catch { return null } })() : firstLine(f)?.sessionId)
function geminiRead(file) {
  let records
  if (file.endsWith('.json')) { try { records = JSON.parse(fs.readFileSync(file, 'utf8')).messages || [] } catch { return [] } } else records = readLines(file)
  const order = []
  const byId = new Map()
  for (const r of records) {
    if (r?.$rewindTo) { const i = order.indexOf(r.$rewindTo); if (i >= 0) for (const id of order.splice(i)) byId.delete(id); continue }
    if (!r?.id || !r.type) continue
    if (!byId.has(r.id)) order.push(r.id)
    byId.set(r.id, r)
  }
  const out = []
  for (const id of order) {
    const r = byId.get(id)
    if (r.type === 'user') { const t = textOf(r.content); if (t) out.push({ role: 'user', text: t, ts: r.timestamp }) }
    else if (r.type === 'gemini') {
      const t = textOf(r.content)
      if (t) out.push({ role: 'assistant', text: t, ts: r.timestamp })
      for (const c of r.toolCalls || []) {
        const a = c.args || {}
        const ok = c.status === 'success'
        const edit = ok && (c.name === 'replace' ? claudeEdit('Edit', a) : c.name === 'write_file' ? claudeEdit('Write', a, typeof c.resultDisplay?.originalContent === 'string' ? { originalFile: c.resultDisplay.originalContent } : null) : null)
        out.push(tool(c.name, a, r.timestamp, edit ? [edit] : null))
      }
    }
  }
  return out
}
const gemini = {
  discover(cwd, since) {
    const files = geminiDirs(cwd).flatMap((d) => list(d).filter((n) => /^session-.*\.jsonl?$/.test(n)).map((n) => path.join(d, n))).filter((f) => born(f) >= since - 5000).sort((a, b) => born(a) - born(b))
    for (const f of files) { const id = geminiId(f); if (id) return id }
    return null
  },
  locate(id, cwd) {
    for (const d of geminiDirs(cwd)) for (const n of list(d)) if (n.includes(`-${id.slice(0, 8)}.json`) && geminiId(path.join(d, n)) === id) return path.join(d, n)
    return null
  },
  read: geminiRead,
}

// ---------- Qwen Code ----------
// ~/.qwen/projects/<cwd, every non-alphanumeric a "-">/chats/<session id>.jsonl: entries linked by
// uuid and parentUuid, as Claude Code does; the conversation is the chain back from the last one.
const qwenDir = (cwd) => path.join(process.env.QWEN_RUNTIME_DIR || process.env.QWEN_HOME || path.join(HOME, '.qwen'), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'), 'chats')
function qwenRead(file) {
  const all = readLines(file)
  const byUuid = new Map(all.filter((e) => e.uuid).map((e) => [e.uuid, e]))
  const chain = []
  for (let e = [...all].reverse().find((x) => x.uuid), n = 0; e && n < 100000; e = byUuid.get(e.parentUuid), n++) chain.push(e)
  chain.reverse()
  const failed = new Set(chain.filter((e) => e.type === 'tool_result' && e.toolCallResult && e.toolCallResult.status !== 'success').map((e) => e.toolCallResult.callId))
  const out = []
  for (const e of chain) {
    const parts = e.message?.parts || []
    if (e.type === 'user') { const t = textOf(parts); if (t) out.push({ role: 'user', text: t, ts: e.timestamp }) }
    else if (e.type === 'assistant') {
      const t = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
      if (t) out.push({ role: 'assistant', text: t, ts: e.timestamp })
      for (const p of parts) {
        const c = p.functionCall
        if (!c?.name) continue
        const a = c.args || {}
        const edit = !failed.has(c.id) && (c.name === 'edit' ? claudeEdit('Edit', a) : c.name === 'write_file' ? claudeEdit('Write', a) : null)
        out.push(tool(c.name, a, e.timestamp, edit ? [edit] : null))
      }
    }
  }
  return out
}
const qwen = {
  discover(cwd, since) {
    const d = qwenDir(cwd)
    const f = list(d).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(d, n)).filter((x) => born(x) >= since - 5000).sort((a, b) => born(a) - born(b))[0]
    return f ? path.basename(f, '.jsonl') : null
  },
  locate(id, cwd) { const f = path.join(qwenDir(cwd), `${id}.jsonl`); return fs.existsSync(f) ? f : null },
  read: qwenRead,
}

// ---------- GitHub Copilot CLI ----------
// ~/.copilot/session-state/<id>/events.jsonl: { type, data, timestamp } events; the first says
// where it started (session.start, data.context.cwd).
const copilotDir = () => path.join(process.env.COPILOT_HOME || path.join(HOME, '.copilot'), 'session-state')
function copilotRead(file) {
  const events = readLines(file)
  const failed = new Set(events.filter((e) => e.type === 'tool.execution_complete' && e.data?.success === false).map((e) => e.data.toolCallId))
  const out = []
  for (const e of events) {
    const d = e.data || {}
    if (e.type === 'user.message') { const t = String(d.content || '').trim(); if (t) out.push({ role: 'user', text: t, ts: e.timestamp }) }
    else if (e.type === 'assistant.message') {
      const t = String(d.content || '').trim()
      if (t) out.push({ role: 'assistant', text: t, ts: e.timestamp })
      for (const c of d.toolRequests || []) {
        const a = c.arguments && typeof c.arguments === 'object' ? c.arguments : {}
        const ok = !failed.has(c.toolCallId)
        const edit = ok && (c.name === 'edit' || (c.name === 'str_replace_editor' && a.command === 'str_replace')
          ? claudeEdit('Edit', { file_path: a.path, old_string: a.old_str, new_string: a.new_str })
          : c.name === 'create' || (c.name === 'str_replace_editor' && a.command === 'create') ? claudeEdit('Write', { file_path: a.path, content: a.file_text }) : null)
        out.push(tool(c.name, a, e.timestamp, edit ? [edit] : null))
      }
    }
  }
  return out
}
const copilot = {
  discover(cwd, since) {
    const root = copilotDir()
    const found = list(root).map((id) => ({ id, f: path.join(root, id, 'events.jsonl') })).filter((x) => born(x.f) >= since - 5000).sort((a, b) => born(a.f) - born(b.f))
    for (const x of found) {
      const first = firstLine(x.f)
      const where = first?.data?.context?.cwd
      if (!where || path.resolve(where) === path.resolve(cwd)) return first?.data?.sessionId || x.id
    }
    return null
  },
  locate(id) { const f = path.join(copilotDir(), id, 'events.jsonl'); return /^[\w-]{8,64}$/.test(id) && fs.existsSync(f) ? f : null },
  read: copilotRead,
}

// ---------- Cursor Agent ----------
// ~/.cursor/projects/<cwd as a slug>/agent-transcripts/<chat id>/<chat id>.jsonl: { role, message }
// lines, with no times or tool results (so its edits show as calls, without counts).
const cursorDir = (cwd) => path.join(process.env.CURSOR_DATA_DIR || path.join(HOME, '.cursor'), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, ''), 'agent-transcripts')
function cursorRead(file) {
  const out = []
  for (const e of readLines(file)) {
    const content = e.message?.content
    if (e.role === 'user') { const t = textOf(content).replace(/<\/?user_query>/g, '').trim(); if (t) out.push({ role: 'user', text: t }) }
    else if (e.role === 'assistant') {
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: textOf(content) }]
      const t = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim()
      if (t) out.push({ role: 'assistant', text: t })
      for (const b of blocks) if (b.type === 'tool_use' && b.name) out.push(tool(b.name, b.input || {}, undefined, null))
    }
  }
  return out
}
const cursor = {
  discover(cwd, since) {
    const d = cursorDir(cwd)
    const x = list(d).map((id) => ({ id, f: path.join(d, id, `${id}.jsonl`) })).filter((y) => born(y.f) >= since - 5000).sort((a, b) => born(a.f) - born(b.f))[0]
    return x?.id || null
  },
  locate(id, cwd) { const f = path.join(cursorDir(cwd), id, `${id}.jsonl`); return /^[\w-]{8,64}$/.test(id) && fs.existsSync(f) ? f : null },
  read: cursorRead,
}

export const OTHER = { gemini, qwen, copilot, cursor }
