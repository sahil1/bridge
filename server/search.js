// Search every agent conversation on this computer (Claude Code and Codex keep them as JSONL
// files), for "which agent did X?". Only what you and the agents said is matched, not tool
// output. Uses ripgrep when it's installed (fast, even over gigabytes), else reads the most
// recent files directly.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { loginPath } from './agents.js'
import { IS_WIN } from './paths.js'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude', 'projects')
const CODEX = path.join(HOME, '.codex', 'sessions')
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/

// What a log line says, if it's a message from you or the agent: { role, text, ts, cwd? }.
function messageOf(kind, line) {
  let e
  try { e = JSON.parse(line) } catch { return null }
  if (kind === 'claude') {
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isMeta || e.isSidechain || e.isCompactSummary) return null
    const c = e.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : ''
    if (!text.trim() || /^<(system-reminder|command-|local-command|task-notification)/.test(text.trim())) return null
    return { role: e.type, text, ts: e.timestamp, cwd: e.cwd }
  }
  const p = e.payload || {}
  if (e.type === 'session_meta') return { meta: true, cwd: p.cwd, id: p.id }
  if (e.type !== 'response_item' || p.type !== 'message' || (p.role !== 'user' && p.role !== 'assistant')) return null
  const text = (p.content || []).map((x) => x.text || '').join('').trim()
  if (!text || text.startsWith('<environment_context>') || text.startsWith('<user_instructions>')) return null
  return { role: p.role, text, ts: e.timestamp }
}

const kindOf = (file) => (file.startsWith(CODEX) ? 'codex' : 'claude')

// The session behind a file: id, folder, and its first message from you (a title).
const metaCache = new Map()
function sessionMeta(file) {
  let st
  try { st = fs.statSync(file) } catch { return null }
  const hit = metaCache.get(file)
  if (hit && hit.mtime === st.mtimeMs) return hit.meta
  const kind = kindOf(file)
  let head = ''
  try { const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(Math.min(st.size, 512 * 1024)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd); head = buf.toString('utf8') } catch { /* unreadable */ }
  let cwd = null
  let title = null
  let id = kind === 'claude' ? path.basename(file, '.jsonl') : file.match(UUID)?.[1]
  for (const line of head.split('\n')) {
    const m = messageOf(kind, line)
    if (!m) continue
    if (m.meta) { cwd = m.cwd || cwd; id = m.id || id; continue }
    cwd = cwd || m.cwd || null
    if (!title && m.role === 'user') title = m.text.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (title && cwd) break
  }
  const meta = { kind, sessionId: id, cwd, title, modified: st.mtimeMs }
  metaCache.set(file, { mtime: st.mtimeMs, meta })
  return meta
}

function snippet(text, q) {
  const flat = text.replace(/\s+/g, ' ')
  const i = flat.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return null
  const start = Math.max(0, i - 70)
  return { text: `${start ? '…' : ''}${flat.slice(start, i + q.length + 110)}${i + q.length + 110 < flat.length ? '…' : ''}`, at: i - start + (start ? 1 : 0) }
}

// Matching lines as [file, line] from ripgrep; null if it isn't installed.
async function viaRipgrep(q) {
  const PATH = await loginPath().catch(() => process.env.PATH)
  const roots = [CLAUDE, CODEX].filter((r) => fs.existsSync(r))
  if (!roots.length) return []
  return new Promise((resolve) => {
    const out = []
    let p
    try {
      p = spawn(IS_WIN ? 'rg.exe' : 'rg', ['--json', '-i', '-F', '-m', '6', '-e', q, '--glob', '*.jsonl', '--glob', '!**/subagents/**', ...roots], { env: { ...process.env, PATH }, windowsHide: true })
    } catch { return resolve(null) }
    const timer = setTimeout(() => p.kill(), 15000)
    p.on('error', () => { clearTimeout(timer); resolve(null) })
    readline.createInterface({ input: p.stdout }).on('line', (l) => {
      if (!l.includes('"type":"match"')) return
      try { const j = JSON.parse(l); out.push([j.data.path.text, j.data.lines.text]) } catch { /* odd bytes */ }
    })
    p.on('close', () => { clearTimeout(timer); resolve(out) })
  })
}

// Without ripgrep: the 300 most recent conversation files.
async function viaNode(q) {
  const files = []
  const walk = (dir, depth) => {
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory() && depth < 4 && e.name !== 'subagents') walk(p, depth + 1)
      else if (e.name.endsWith('.jsonl')) { try { files.push([p, fs.statSync(p).mtimeMs]) } catch { /* gone */ } }
    }
  }
  walk(CLAUDE, 0); walk(CODEX, 0)
  const out = []
  const needle = q.toLowerCase()
  for (const [f] of files.sort((a, b) => b[1] - a[1]).slice(0, 300)) {
    const rl = readline.createInterface({ input: fs.createReadStream(f) })
    let n = 0
    for await (const line of rl) if (line.toLowerCase().includes(needle)) { out.push([f, line]); if (++n >= 6) { rl.close(); break } }
  }
  return out
}

// Up to `limit` conversations that mention q, most recent first, each with up to 3 snippets.
export async function search(q, { limit = 30 } = {}) {
  q = String(q || '').trim()
  if (q.length < 2) return { results: [] }
  const lines = (await viaRipgrep(q)) ?? (await viaNode(q))
  const bySession = new Map()
  for (const [file, line] of lines) {
    const kind = kindOf(file)
    const m = messageOf(kind, line)
    if (!m || m.meta) continue
    const s = snippet(m.text, q)
    if (!s) continue // matched in tool output or metadata, not the conversation
    if (!bySession.has(file)) bySession.set(file, { hits: [], last: 0, cwd: null })
    const g = bySession.get(file)
    g.cwd = g.cwd || m.cwd || null
    if (g.hits.length < 3) g.hits.push({ role: m.role, ts: m.ts, ...s })
    g.last = Math.max(g.last, Date.parse(m.ts) || 0)
  }
  const results = []
  for (const [file, g] of bySession) {
    const meta = sessionMeta(file)
    if (!meta?.sessionId) continue
    results.push({ ...meta, cwd: meta.cwd || g.cwd, title: meta.title || g.hits[0].text.replace(/^…/, '').slice(0, 120), hits: g.hits, last: g.last || meta.modified })
  }
  results.sort((a, b) => b.last - a.last)
  return { results: results.slice(0, limit), total: results.length }
}
