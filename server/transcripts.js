// Turn an agent's on-disk transcript into chat messages.
// Claude Code: ~/.claude/projects/<cwd slug>/<session>.jsonl
// Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*-<session>.jsonl
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const TAIL_BYTES = 3 * 1024 * 1024
const pathCache = new Map()

function claudeFile(sessionId, cwd) {
  const root = path.join(HOME, '.claude', 'projects')
  const direct = path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`)
  if (fs.existsSync(direct)) return direct
  // The agent may have changed directory after starting; scan project dirs.
  for (const dir of fs.readdirSync(root)) {
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

function tailLines(file, bytes = TAIL_BYTES) {
  const { size } = fs.statSync(file)
  const start = Math.max(0, size - bytes)
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(size - start)
  fs.readSync(fd, buf, 0, buf.length, start)
  fs.closeSync(fd)
  const lines = buf.toString('utf8').split('\n')
  if (start > 0) lines.shift() // first line is likely partial
  return lines.filter(Boolean)
}

function toolLabel(block) {
  const input = block.input || {}
  const hint = input.description || input.command || input.file_path || input.pattern || input.url || input.prompt || ''
  return { tool: block.name, hint: String(hint).split('\n')[0].slice(0, 140) }
}

// Only the conversation as it stands. Claude never deletes from its log: after a rewind (an
// edited message) the old turns stay in the file, and each entry points at its parent. So start
// at the newest entry and follow the parents back; entries off that path were rewound away.
function activeBranch(entries) {
  const byId = new Map()
  for (const e of entries) if (e.uuid && !e.isSidechain) byId.set(e.uuid, e)
  const tip = entries.findLast((e) => e.uuid && !e.isSidechain)
  if (!tip) return entries
  const keep = new Set()
  for (let e = tip; e && !keep.has(e.uuid); e = byId.get(e.parentUuid || e.logicalParentUuid)) keep.add(e.uuid)
  return entries.filter((e) => !e.uuid || keep.has(e.uuid))
}

function parseClaude(lines) {
  const out = []
  const entries = []
  for (const line of lines) { try { entries.push(JSON.parse(line)) } catch { /* partial line */ } }
  for (const e of activeBranch(entries)) {
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isMeta || e.isSidechain) continue
    // Claude's summary of earlier turns (after /compact or "summarize"): a note, not your message.
    if (e.isCompactSummary) { out.push({ role: 'event', status: 'completed', text: 'Earlier conversation summarized', ts: e.timestamp }); continue }
    const content = e.message?.content
    const ts = e.timestamp
    if (typeof content === 'string') {
      if (e.type === 'user' && /^<(command-|local-command|system-reminder)/.test(content.trim())) continue
      // Claude's own "background task finished" notice: a short event line, not a message from you.
      if (e.type === 'user' && /^<task-notification>/.test(content.trim())) {
        const tag = (t) => (new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(content) || [])[1]?.trim()
        out.push({ role: 'event', status: tag('status') || '', text: tag('summary') || 'A background task finished', ts })
        continue
      }
      out.push({ role: e.type, text: content, ts })
      continue
    }
    if (!Array.isArray(content)) continue
    // Images you pasted into the agent: kept in its log, served back by imageFrom().
    const images = e.type === 'user' && e.uuid ? content.map((b, i) => (b.type === 'image' ? { uuid: e.uuid, i } : null)).filter(Boolean) : []
    if (images.length) {
      const text = content.filter((b) => b.type === 'text' && b.text?.trim() && !/^<(system-reminder|command-)/.test(b.text.trim())).map((b) => b.text).join('\n\n')
      out.push({ role: 'user', text, images, ts })
      continue
    }
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) {
        if (e.type === 'user' && /^<(system-reminder|command-)/.test(b.text.trim())) continue
        out.push({ role: e.type, text: b.text, ts })
      } else if (b.type === 'tool_use') {
        out.push({ role: 'tool', ...toolLabel(b), ts })
      }
    }
  }
  return out
}

function parseCodex(lines) {
  const out = []
  for (const line of lines) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    const p = e.payload || {}
    if (e.type === 'response_item' && p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = (p.content || []).map((c) => c.text || '').join('').trim()
      if (!text || text.startsWith('<environment_context>') || text.startsWith('<user_instructions>')) continue
      out.push({ role: p.role, text, ts: e.timestamp })
    } else if (e.type === 'response_item' && p.type === 'function_call') {
      let hint = ''
      try { const a = JSON.parse(p.arguments); hint = Array.isArray(a.command) ? a.command.join(' ') : a.command || '' } catch { /* keep empty */ }
      out.push({ role: 'tool', tool: p.name, hint: String(hint).slice(0, 140), ts: e.timestamp })
    }
  }
  return out
}

export function transcript({ kind, sessionId, cwd }, limit = 150) {
  if (!sessionId) return { supported: false, messages: [] }
  const file = locate(kind, sessionId, cwd)
  if (!file) return { supported: false, messages: [] }
  const lines = tailLines(file)
  const messages = kind === 'claude' ? parseClaude(lines) : parseCodex(lines)
  return { supported: true, messages: messages.slice(-limit) }
}

// Last thing the agent said, for board tiles. Reads a small tail only.
export function preview({ kind, sessionId, cwd }) {
  if (!sessionId || (kind !== 'claude' && kind !== 'codex')) return null
  const file = locate(kind, sessionId, cwd)
  if (!file) return null
  const lines = tailLines(file, 256 * 1024)
  const msgs = kind === 'claude' ? parseClaude(lines) : parseCodex(lines)
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
