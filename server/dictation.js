// The names dictation spells the way they're written (shared/dictation/clean.js does the spelling,
// in the page): your agents, the agents and models Bridge AI knows, your projects, the branches your
// agents are on, and meeting memory (its names first, and how they've been misheard). Read from what
// the server already has; a git repo is only asked for its branches where looking can't bring up a
// macOS question (projects.mayLook), and never with a blocking call.
import path from 'node:path'
import { execFile } from 'node:child_process'
import { AGENTS } from './agents.js'
import { mayLook } from './projects.js'
import * as memory from './meetmemory.js'

// The words every Bridge AI has: its agents and the models they run.
const KNOWN = ['Bridge AI', 'Chief of Staff', 'Claude Code', 'Codex', 'Gemini', 'Copilot', 'GitHub', 'OpenCode', 'Cursor', 'Grok', 'Qwen', 'DeepSeek', 'Kimi', 'Ollama', 'LM Studio', 'OpenAI', 'Anthropic', 'Opus', 'Sonnet', 'Haiku', 'worktree', 'herdr', 'npm', 'pnpm', 'TypeScript', 'JavaScript', 'README']

const branches = new Map() // repo folder -> { at, list }
const git = (cwd, args) => new Promise((resolve) => execFile('git', ['-C', cwd, ...args], { timeout: 2000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out))))
async function branchesOf(cwd) {
  const hit = branches.get(cwd)
  if (hit && Date.now() - hit.at < 60_000) return hit.list
  const list = mayLook(cwd) ? (await git(cwd, ['for-each-ref', '--count=30', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'])).split('\n').map((s) => s.trim()).filter(Boolean) : []
  branches.set(cwd, { at: Date.now(), list })
  return list
}

// { terms: [...], heard: [[heard, term]] }. fleet: the server's fleet; projects: projects.list().
export async function words({ fleet, projects = [] } = {}) {
  const terms = []
  const add = (t) => { const s = String(t || '').trim(); if (s && s.length <= 60 && !/^\d+$/.test(s)) terms.push(s) }
  const mem = memory.list()
  for (const t of mem) add(t.term)
  const agents = (fleet?.agents || []).filter((a) => !a.shellTab)
  // A title that's a sentence (a session's summary) isn't a name.
  for (const a of agents) for (const t of [a.title, a.tab, a.workspace]) if (t && String(t).split(/\s+/).length <= 3) add(t)
  for (const a of agents) { if (a.worktree?.branch) add(a.worktree.branch); if (a.worktree?.repo) add(path.basename(a.worktree.repo)); if (a.cwd) add(path.basename(a.cwd)) }
  const cwds = [...new Set(agents.map((a) => a.cwd).filter(Boolean))].slice(0, 12)
  for (const list of await Promise.all(cwds.map(branchesOf))) list.forEach(add)
  for (const p of projects.slice(0, 200)) add(p.name)
  for (const a of Object.values(AGENTS)) add(a.label)
  KNOWN.forEach(add)
  return { terms: [...new Set(terms)].slice(0, 3000), heard: mem.flatMap((t) => t.heard.map((h) => [h, t.term])) }
}
