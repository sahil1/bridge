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
import { IS_WIN, withNodeShim } from './paths.js'

const ESC_INTERRUPT = /esc to (interrupt|cancel)|ctrl\+c to (interrupt|cancel|stop)|press esc to stop/i

export const AGENTS = [
  {
    kind: 'claude', label: 'Claude Code', model: (m) => ['--model', m], models: ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'], install: { npm: '@anthropic-ai/claude-code' }, bin: ['claude'], herdr: 'claude', usage: 'claude',
    sessionId: 'assign',
    start: ({ sessionId, prompt }) => [...(sessionId ? ['--session-id', sessionId] : []), ...(prompt ? [prompt] : [])], promptArg: true,
    resume: (id) => ['--resume', id],
    busy: ESC_INTERRUPT,
    caps: { chat: true, subagents: true, commands: true, questions: true, inputBox: true },
  },
  {
    kind: 'codex', label: 'Codex', model: (m) => ['--model', m], models: [], install: { npm: '@openai/codex' }, bin: ['codex'], herdr: 'codex', usage: 'codex',
    sessionId: 'discover',
    start: ({ prompt }) => (prompt ? [prompt] : []), promptArg: true,
    resume: (id) => ['resume', id],
    busy: ESC_INTERRUPT,
    caps: { chat: true, commands: true },
  },
  { kind: 'gemini', label: 'Gemini CLI', install: { npm: '@google/gemini-cli' }, bin: ['gemini'], herdr: 'gemini', start: ({ prompt }) => (prompt ? ['-i', prompt] : []), promptArg: true, busy: ESC_INTERRUPT, caps: {} },
  { kind: 'grok', label: 'Grok', model: (m) => ['--model', m], models: [], install: { npm: '@vibe-kit/grok-cli' }, bin: ['grok'], herdr: 'grok', start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'cursor', label: 'Cursor Agent', model: (m) => ['--model', m], models: [], install: { unix: 'curl https://cursor.com/install -fsS | bash' }, bin: ['cursor-agent'], herdr: 'cursor', start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'copilot', label: 'GitHub Copilot CLI', install: { npm: '@github/copilot' }, bin: ['copilot'], start: () => [], busy: ESC_INTERRUPT, caps: {} },
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
let loginPathCache = null
export function loginPath() {
  if (IS_WIN) return Promise.resolve(process.env.PATH || '') // already includes the node fallback (paths.js)
  if (loginPathCache) return loginPathCache
  loginPathCache = new Promise((resolve) => {
    // Interactive login shell, like a terminal window, so PATH set in .zshrc/.bashrc (nvm, say) counts.
    execFile(process.env.SHELL || '/bin/sh', ['-lic', 'printf "%s" "$PATH"'], { timeout: 8000 }, (err, out) => resolve(err || !out ? process.env.PATH || '' : withNodeShim(out.trim().split('\n').pop())))
  })
  return loginPathCache
}

function which(bin, PATH) {
  return new Promise((resolve) => {
    const [cmd, args] = IS_WIN ? ['where', [bin]] : ['/bin/sh', ['-c', `command -v ${bin}`]]
    execFile(cmd, args, { timeout: 5000, env: { ...process.env, PATH } }, (err, out) => resolve(err ? null : out.trim().split(/\r?\n/)[0] || null))
  })
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

// The install command for this platform, as you'd type it in a terminal.
export function installCommand(kind) {
  const i = adapter(kind).install
  if (!i) return null
  if (i.npm) return `npm install -g ${i.npm}`
  return (IS_WIN ? i.win : i.unix) || null
}

// Every known agent with what the UI needs to show it (installed or not).
export async function catalog() {
  const have = new Map((await installed()).map((x) => [x.kind, x]))
  return AGENTS.map((a) => ({
    kind: a.kind, label: a.label, installed: have.has(a.kind), path: have.get(a.kind)?.path || null,
    caps: a.caps || {}, install: installCommand(a.kind), modelFlag: !!a.model, models: a.models || [],
  }))
}
export const clearInstalledCache = () => { installedCache = { at: 0, list: null } }
