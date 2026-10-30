// Agents you closed, kept so you can find them and pick up where they left off. Closing a tab
// ends its terminal, but Claude Code and Codex keep the conversation on disk, so it can be
// resumed with its full history. Stored in <data>/archive.json, newest first.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { dataFile, ensureDir, DATA } from './paths.js'

const FILE = dataFile('archive.json')
const MAX = 400

function load() { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d) ? d : [] } catch { return [] } }
function save(list) { ensureDir(DATA); fs.writeFileSync(FILE, JSON.stringify(list.slice(0, MAX), null, 2) + '\n', { mode: 0o600 }) }

export const all = () => load()
export const find = (id) => load().find((x) => x.id === id) || null

// An agent that's closing: { kind, sessionId, cwd, label, workspace, preview }. One entry per
// session (closing it again moves it back to the top).
export function add(a) {
  if (!a?.sessionId || !a.kind) return null
  const list = load().filter((x) => x.sessionId !== a.sessionId)
  const item = {
    id: crypto.randomBytes(5).toString('hex'), kind: a.kind, sessionId: a.sessionId, cwd: a.cwd,
    label: String(a.label || '').slice(0, 120), workspace: String(a.workspace || '').slice(0, 120),
    preview: String(a.preview || '').slice(0, 300), closedAt: new Date().toISOString(),
  }
  save([item, ...list])
  return item
}

export function remove(id) { save(load().filter((x) => x.id !== id)) }
export function removeSession(sessionId) { const list = load(); const next = list.filter((x) => x.sessionId !== sessionId); if (next.length !== list.length) save(next) }
