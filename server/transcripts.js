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

function codexFile(sessionId) {
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
  const key = `${kind}:${sessionId}`
  const cached = pathCache.get(key)
  if (cached && fs.existsSync(cached)) return cached
  const file = kind === 'claude' ? claudeFile(sessionId, cwd) : kind === 'codex' ? codexFile(sessionId) : null
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

function parseClaude(lines) {
  const out = []
  for (const line of lines) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isMeta || e.isSidechain) continue
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
