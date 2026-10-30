// Slash commands an agent understands, for the composer's "/" menu: the harness's built-ins,
// your skills and commands (user, project, plugins), with argument choices where they help.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const CLAUDE = path.join(HOME, '.claude')

// mode: 'pick' = choose an argument from `args`; 'terminal' = opens an interactive screen in the
// agent, so the UI switches to the Terminal tab; 'fill' = put it in the box to finish and send.
const CLAUDE_BUILTINS = [
  { name: 'model', description: 'Switch model', mode: 'pick', terminal: true, args: [
    { value: 'claude-opus-5-5', label: 'Opus 5.5', description: 'Complex work and everyday tasks' },
    { value: 'claude-fable-5-1', label: 'Fable 5.1', description: 'Toughest challenges' },
    { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5', description: 'Efficient for simpler tasks' },
    { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest for quick answers' },
    { value: '', label: 'All models…', description: 'Open the full picker in the terminal' },
  ] },
  { name: 'effort', description: 'Set reasoning effort (picker has "this session only")', mode: 'terminal' },
  { name: 'clear', description: 'Start a fresh conversation (clears context)', mode: 'fill' },
  { name: 'compact', description: 'Summarize the conversation to free context', mode: 'fill', hint: 'optional focus, e.g. keep the API decisions' },
  { name: 'context', description: 'Show what is using the context window', mode: 'terminal' },
  { name: 'usage', description: 'Plan usage and limits', mode: 'terminal' },
  { name: 'cost', description: 'Token cost of this session', mode: 'terminal' },
  { name: 'resume', description: 'Resume an earlier conversation', mode: 'terminal' },
  { name: 'rewind', description: 'Roll back code and conversation to an earlier point', mode: 'terminal' },
  { name: 'review', description: 'Review a pull request', mode: 'fill', hint: 'PR number or URL' },
  { name: 'init', description: 'Write a CLAUDE.md for this project', mode: 'fill' },
  { name: 'memory', description: 'Edit memory files', mode: 'terminal' },
  { name: 'permissions', description: 'Allow and deny rules', mode: 'terminal' },
  { name: 'mcp', description: 'MCP servers and their status', mode: 'terminal' },
  { name: 'agents', description: 'Manage subagents', mode: 'terminal' },
  { name: 'config', description: 'Settings', mode: 'terminal' },
  { name: 'status', description: 'Version, model, account and connectivity', mode: 'terminal' },
  { name: 'export', description: 'Export the conversation', mode: 'terminal' },
  { name: 'doctor', description: 'Check the installation', mode: 'terminal' },
  { name: 'fast', description: 'Toggle fast mode', mode: 'fill' },
  { name: 'help', description: 'All commands', mode: 'terminal' },
]
const CODEX_BUILTINS = [
  { name: 'model', description: 'Choose model and reasoning effort', mode: 'terminal' },
  { name: 'approvals', description: 'What Codex may do without asking', mode: 'terminal' },
  { name: 'new', description: 'Start a new chat', mode: 'fill' },
  { name: 'compact', description: 'Summarize to free context', mode: 'fill' },
  { name: 'diff', description: 'Show the git diff', mode: 'terminal' },
  { name: 'status', description: 'Session configuration and token usage', mode: 'terminal' },
  { name: 'review', description: 'Review current changes', mode: 'fill' },
  { name: 'init', description: 'Write an AGENTS.md', mode: 'fill' },
  { name: 'mcp', description: 'MCP tools', mode: 'terminal' },
]

// A project's own commands are in its folder, often in Desktop or Documents, which macOS can hold
// a look into until you answer its permission prompt: read without blocking, so only this waits.
const exists = (p) => fs.promises.access(p).then(() => true, () => false)
const names = (dir) => fs.promises.readdir(dir).catch(() => []) // none when there's no such folder

async function frontmatter(file) {
  try {
    const head = (await fs.promises.readFile(file, 'utf8')).slice(0, 4000)
    const m = /^---\n([\s\S]*?)\n---/.exec(head)
    if (!m) return {}
    const out = {}
    for (const line of m[1].split('\n')) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line)
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
    }
    return out
  } catch { return {} }
}

async function scan(dir, source, prefix = '') {
  const skills = path.join(dir, 'skills')
  const commands = path.join(dir, 'commands')
  const [sk, cm] = await Promise.all([names(skills), names(commands)])
  const fromSkills = await Promise.all(sk.map(async (d) => {
    const f = path.join(skills, d, 'SKILL.md')
    if (!(await exists(f))) return null
    const fm = await frontmatter(f)
    if (fm['user-invocable'] === 'false') return null
    return { name: prefix + (fm.name || d), description: (fm.description || '').slice(0, 200), source, mode: 'fill' }
  }))
  const fromCommands = await Promise.all(cm.filter((f) => f.endsWith('.md')).map(async (f) => {
    const fm = await frontmatter(path.join(commands, f))
    return { name: prefix + f.slice(0, -3), description: (fm.description || '').slice(0, 200), source, mode: 'fill', hint: fm['argument-hint'] || null }
  }))
  return [...fromSkills.filter(Boolean), ...fromCommands]
}

async function plugins() {
  let installed = {}
  let enabled = null
  try { installed = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {} } catch { /* none */ }
  try { enabled = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'settings.json'), 'utf8')).enabledPlugins || null } catch { /* unknown */ }
  const out = []
  for (const [id, v] of Object.entries(installed)) {
    if (enabled && enabled[id] === false) continue
    const entry = Array.isArray(v) ? v[0] : v
    if (!entry?.installPath) continue
    out.push(scan(entry.installPath, 'plugin', `${id.split('@')[0]}:`))
  }
  return (await Promise.all(out)).flat()
}

let cache = { at: 0, key: '', value: null }
export async function list(kind = 'claude', cwd = '') {
  const key = `${kind}|${cwd}`
  if (cache.value && cache.key === key && Date.now() - cache.at < 30000) return cache.value
  let commands
  if (kind === 'codex') commands = CODEX_BUILTINS.map((c) => ({ ...c, source: 'built-in' }))
  else if (kind === 'claude') {
    const seen = new Set()
    const [project, skills, plugged] = await Promise.all([cwd ? scan(path.join(cwd, '.claude'), 'project') : [], scan(CLAUDE, 'skill'), plugins()])
    commands = [
      ...CLAUDE_BUILTINS.map((c) => ({ ...c, source: 'built-in' })),
      ...project,
      ...skills,
      ...plugged,
    ].filter((c) => { if (seen.has(c.name)) return false; seen.add(c.name); return true })
  } else commands = []
  const value = { kind, commands }
  cache = { at: Date.now(), key, value }
  return value
}
