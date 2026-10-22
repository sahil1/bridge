// Every agent CLI Bridge AI knows, in one place. To add one, add an entry here: how to start it,
// how to tell from its screen that it's busy, and (optionally) where it keeps transcripts.
// Everything else (chat view, subagents, slash commands, the question card) switches on from
// the capabilities listed, and degrades to the terminal view for agents without them.
//
//   kind        id used in config and the API
//   label       shown in the UI
//   bin         the program to look for on PATH (first match wins)
//   start(o)    arguments for a fresh session; o = { sessionId, prompt }. Set promptArg: true when
//               start() puts the opening prompt on the command line; otherwise Bridge types it in
//               once the agent is up.
//   resume(id)  arguments to reopen a session after a restart (built-in runtime)
//   sessionId   'assign': Bridge picks the id and passes it in start(); 'discover': read it from
//               the newest transcript file after launch (see transcripts.js)
//   busy        screen text that means it's working (checked on the last lines)
//   busyFromOutput  no such text: treat steady output you didn't type as working (built-in runtime)
//   herdr       herdr's own name for this agent, when herdr can start and track it natively
//   model(m)    arguments that pick a model (from your settings: agents.<kind>.model)
//   models      suggestions shown in Settings (you can type any model the CLI accepts)
//   install     how to install it ({ npm } package, or a { unix, win } shell command)
//   caps        chat: a transcript Bridge can render; subagents; commands: a "/" menu;
//               questions: Claude-style pickers become clickable cards; inputBox: Bridge can
//               see what's typed in its prompt and avoid merging messages
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IS_WIN, withNodeShim, nodeShimDir } from './paths.js'

const ESC_INTERRUPT = /esc to (interrupt|cancel)|ctrl\+c to (interrupt|cancel|stop)|press esc to stop/i
// Claude Code's working line: a spinner and a word ending in "…" ("✻ Infusing…", "✶ Pondering… (12s)").
// Newer versions dropped the "esc to interrupt" text; the finished line ("✻ Brewed for 8s") has no "…".
const CLAUDE_BUSY = new RegExp(`${ESC_INTERRUPT.source}|^\\s*[✻✳✶✢✽·*]\\s+[A-Z][\\w'-]*…`, 'im')

export const AGENTS = [
  {
    kind: 'claude', label: 'Claude Code', model: (m) => ['--model', m], models: ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'], install: { unix: 'curl -fsSL https://claude.ai/install.sh | bash', win: 'powershell -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"', npm: '@anthropic-ai/claude-code', brew: '--cask claude-code' }, bin: ['claude'], herdr: 'claude', usage: 'claude',
    sessionId: 'assign',
    start: ({ sessionId, prompt }) => [...(sessionId ? ['--session-id', sessionId] : []), ...(prompt ? [prompt] : [])], promptArg: true,
    resume: (id) => ['--resume', id],
    // A copy of a conversation under a new id (the original stays as it is).
    fork: (id, newId) => ['--resume', id, '--fork-session', ...(newId ? ['--session-id', newId] : [])],
    busy: CLAUDE_BUSY,
    // typeAhead: takes messages while it works (queues or folds them in itself), like typing in its
    // terminal. rewind: Bridge AI can edit a sent message through its Rewind list. btw: /btw side questions.
    // undo: that rewind can restore files too, so Chat offers "Undo this reply".
    caps: { chat: true, subagents: true, commands: true, questions: true, inputBox: true, typeAhead: true, rewind: true, undo: true, btw: true, fork: true },
  },
  {
    kind: 'codex', label: 'Codex', model: (m) => ['--model', m], models: [], install: { unix: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', win: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', npm: '@openai/codex', brew: '--cask codex' }, bin: ['codex'], herdr: 'codex', usage: 'codex',
    sessionId: 'discover',
    start: ({ prompt }) => (prompt ? [prompt] : []), promptArg: true,
    resume: (id) => ['resume', id],
    fork: (id) => ['fork', id],
    busy: ESC_INTERRUPT,
    caps: { chat: true, commands: true, typeAhead: true, fork: true, rewind: true },
  },
  { kind: 'gemini', label: 'Gemini CLI', install: { npm: '@google/gemini-cli', brew: 'gemini-cli' }, bin: ['gemini'], herdr: 'gemini', start: ({ prompt }) => (prompt ? ['-i', prompt] : []), promptArg: true, busy: ESC_INTERRUPT, caps: {} },
  { kind: 'grok', label: 'Grok', model: (m) => ['--model', m], models: [], install: { npm: '@vibe-kit/grok-cli' }, bin: ['grok'], herdr: 'grok', start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'cursor', label: 'Cursor Agent', model: (m) => ['--model', m], models: [], install: { unix: 'curl https://cursor.com/install -fsS | bash' }, bin: ['cursor-agent'], herdr: 'cursor', start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'copilot', label: 'GitHub Copilot CLI', install: { unix: 'curl -fsSL https://gh.io/copilot-install | bash', win: 'winget install GitHub.Copilot', npm: '@github/copilot', brew: 'copilot-cli' }, bin: ['copilot'], start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'opencode', label: 'OpenCode', model: (m) => ['--model', m], models: [], install: { npm: 'opencode-ai' }, bin: ['opencode'], start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'amp', label: 'Amp', install: { npm: '@sourcegraph/amp' }, bin: ['amp'], start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'qwen', label: 'Qwen Code', install: { npm: '@qwen-code/qwen-code' }, bin: ['qwen'], start: ({ prompt }) => (prompt ? ['-i', prompt] : []), promptArg: true, busy: ESC_INTERRUPT, caps: {} },
  { kind: 'aider', label: 'Aider', model: (m) => ['--model', m], models: [], install: { unix: 'python3 -m pip install aider-install && aider-install', win: 'py -m pip install aider-install; aider-install' }, bin: ['aider'], start: () => [], busyFromOutput: true, caps: {} },
  { kind: 'goose', label: 'Goose', install: { unix: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash' }, bin: ['goose'], start: () => ['session'], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'muse', label: 'Muse Code (Meta)', install: { unix: 'curl -fsSL https://dev.meta.ai/install.sh | bash' }, bin: ['muse'], start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'crush', label: 'Crush', install: { npm: '@charmland/crush' }, bin: ['crush'], start: () => [], busy: ESC_INTERRUPT, caps: {} },
]

// Plain shells (dev servers, editors) use the same machinery with no agent features.
export const SHELL = { kind: 'shell', label: 'Shell', bin: [], start: () => [], caps: {} }

const byKind = new Map(AGENTS.map((a) => [a.kind, a]))
export const adapter = (kind) => byKind.get(kind) || (kind === 'shell' ? SHELL : { kind, label: kind, bin: [kind], start: () => [], busy: ESC_INTERRUPT, caps: {} })
export const caps = (kind) => adapter(kind).caps || {}
export const newSessionId = () => crypto.randomUUID()

// Your login shell's PATH: apps opened from the Dock or a launcher get a bare one, and agent
// CLIs usually live in ~/.local/bin, Homebrew or npm's global folder.
const USUAL_DIRS = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
let loginPathCache = null
export function loginPath() {
  if (IS_WIN) return Promise.resolve(process.env.PATH || '') // already includes the node fallback (paths.js)
  if (loginPathCache) return loginPathCache
  loginPathCache = new Promise((resolve) => {
    // Interactive login shell, like a terminal window, so PATH set in .zshrc/.bashrc (nvm, say) counts.
    execFile(process.env.SHELL || '/bin/sh', ['-lic', 'printf "%s" "$PATH"'], { timeout: 8000 }, (err, out) => {
      // Plus the usual folders: agents' own installers put them in ~/.local/bin, which a new Mac's
      // shell doesn't list until you add it.
      if (!err && out) return resolve(withNodeShim([...new Set([...out.trim().split('\n').pop().split(path.delimiter), ...USUAL_DIRS])].join(path.delimiter)))
      // Started at login, the shell can be too slow to answer while the Mac is still busy (after an
      // update, say). Use the usual folders for now and ask again in a minute, rather than miss
      // herdr and your agents until Bridge AI restarts.
      setTimeout(() => { loginPathCache = null }, 60_000).unref()
      const bare = String(process.env.PATH || '').split(path.delimiter).filter((d) => d && d !== nodeShimDir())
      resolve(withNodeShim([...bare, ...USUAL_DIRS].join(path.delimiter)))
    })
  })
  return loginPathCache
}

// Find a program on PATH the way a shell would, by looking in each folder: no process to start,
// which matters on Windows where starting `where` 13 times took seconds. On Windows only real
// program types count (PATHEXT: .exe, .cmd, ...), so npm's extension-less shell shims are skipped.
// Never blocking: a PATH folder can be in Desktop or Documents, which macOS can hold a look into
// until you answer its permission prompt.
const EXTS = IS_WIN ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
export async function which(bin, PATH) {
  for (const dir of String(PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of EXTS) {
      const p = path.join(dir, bin + ext)
      try {
        if (!(await fs.promises.stat(p)).isFile()) continue
        if (!IS_WIN) await fs.promises.access(p, fs.constants.X_OK)
        return p
      } catch { /* not here */ }
    }
  }
  return null
}

// Which agents are installed, with the program each one runs. Cached for a minute; callers that
// arrive while a check is running share it.
let installedCache = { at: 0, list: null }
let installedInflight = null
export function installed() {
  if (installedCache.list && Date.now() - installedCache.at < 60_000) return Promise.resolve(installedCache.list)
  return (installedInflight ||= findInstalled().finally(() => { installedInflight = null }))
}
async function findInstalled() {
  const PATH = await loginPath()
  const found = await Promise.all(AGENTS.map(async (a) => {
    for (const b of a.bin) { const p = await which(b, PATH); if (p) return { kind: a.kind, label: a.label, path: p, caps: a.caps } }
    return null
  }))
  installedCache = { at: Date.now(), list: found.filter(Boolean) }
  return installedCache.list
}

// The install command for this platform, as you'd type it in a terminal. The agent's own installer
// when it has one (it needs nothing else, which matters on a new Mac with no Node), else npm when
// you have it, else Homebrew when you have it, else npm (which then says what's missing).
// have: { npm, brew } from installTools(); brew is its path.
export function installCommand(kind, have = { npm: true }) {
  const i = adapter(kind).install
  if (!i) return null
  const own = IS_WIN ? i.win : i.unix
  if (own) return own
  if (i.npm && have.npm) return `npm install -g ${i.npm}`
  if (i.brew && have.brew) return `${have.brew} install ${i.brew}`
  return i.npm ? `npm install -g ${i.npm}` : null
}

// What there is to install with here. Homebrew is looked for where it puts itself too, since a new
// install isn't on the PATH until your shell profile says so.
export async function installTools() {
  const PATH = await loginPath()
  const [npm, brew] = await Promise.all([which('npm', PATH), IS_WIN ? null : which('brew', [PATH, '/opt/homebrew/bin', '/usr/local/bin'].join(path.delimiter))])
  return { npm: !!npm, brew }
}

// Every known agent with what the UI needs to show it (installed or not).
export async function catalog() {
  const [list, tools] = await Promise.all([installed(), installTools()])
  const have = new Map(list.map((x) => [x.kind, x]))
  return AGENTS.map((a) => ({
    kind: a.kind, label: a.label, installed: have.has(a.kind), path: have.get(a.kind)?.path || null,
    caps: a.caps || {}, install: installCommand(a.kind, tools), modelFlag: !!a.model, models: a.models || [],
  }))
}
export const clearInstalledCache = () => { installedCache = { at: 0, list: null } }
