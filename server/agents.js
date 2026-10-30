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
//   models      suggestions shown in Settings and the message box's model menu (any model the CLI
//               accepts can be typed)
//   switchModel switch a running agent's model in place, from the message box: { command(m), the
//               command typed into it; dflt: the name that goes back to its default }. Without it,
//               an agent with model() and resume() restarts on the new model, same conversation.
//   install     how to install it ({ npm } package, or a { unix, win } shell command)
//   access(lvl) arguments for how much it may do without asking: 'ask' (its default: before edits
//               and commands), 'edits' (changes files freely, asks before commands), 'full' (nothing
//               asked). Only flags from each CLI's docs; agents without it always ask.
//   login       arguments that sign it in, in a terminal tab Bridge AI opens (Sign in buttons);
//               [] for Gemini CLI, which signs in when it starts (index.js preselects Google)
//   caps        chat: a transcript Bridge can render; subagents; commands: a "/" menu;
//               questions: Claude-style pickers become clickable cards; inputBox: Bridge can
//               see what's typed in its prompt and avoid merging messages
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IS_WIN, withNodeShim, nodeShimDir, dataFile, brewInstall } from './paths.js'
import { hiddenAgent } from './labs.js'

const ESC_INTERRUPT = /esc to (interrupt|cancel)|ctrl\+c to (interrupt|cancel|stop)|press esc to stop/i
// Claude Code's working line: a spinner and a word ending in "…" ("✻ Infusing…", "✶ Pondering… (12s)").
// Newer versions dropped the "esc to interrupt" text; the finished line ("✻ Brewed for 8s") has no "…".
const CLAUDE_BUSY = new RegExp(`${ESC_INTERRUPT.source}|^\\s*[✻✳✶✢✽·*]\\s+[A-Z][\\w'-]*…`, 'im')

export const AGENTS = [
  {
    kind: 'claude', label: 'Claude Code', model: (m) => ['--model', m], models: ['opus', 'sonnet', 'haiku', 'claude-fable-5-1'],
    // Its own /model (code.claude.com/docs/en/model-config): "default" clears the override.
    switchModel: { command: (m) => `/model ${m}`, dflt: 'default' }, install: { unix: 'curl -fsSL https://claude.ai/install.sh | bash', win: 'powershell -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"', npm: '@anthropic-ai/claude-code', brew: '--cask claude-code' }, bin: ['claude'], herdr: 'claude', usage: 'claude',
    sessionId: 'assign',
    start: ({ sessionId, prompt }) => [...(sessionId ? ['--session-id', sessionId] : []), ...(prompt ? [prompt] : [])], promptArg: true,
    resume: (id) => ['--resume', id],
    access: (lvl) => (lvl === 'edits' ? ['--permission-mode', 'acceptEdits'] : lvl === 'full' ? ['--permission-mode', 'bypassPermissions'] : []),
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
    access: (lvl) => (lvl === 'edits' ? ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'] : lvl === 'full' ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
    fork: (id) => ['fork', id],
    busy: ESC_INTERRUPT,
    caps: { chat: true, commands: true, typeAhead: true, fork: true, rewind: true },
  },
  // Chat from their own logs (otherlogs.js): the session they start is found after launch.
  { kind: 'gemini', label: 'Gemini CLI', install: { npm: '@google/gemini-cli', brew: 'gemini-cli' }, bin: ['gemini'], herdr: 'gemini', start: ({ prompt }) => (prompt ? ['-i', prompt] : []), promptArg: true, busy: ESC_INTERRUPT, sessionId: 'discover', resume: (id) => ['--resume', id], access: (lvl) => (lvl === 'edits' ? ['--approval-mode', 'auto_edit'] : lvl === 'full' ? ['--approval-mode', 'yolo'] : []), login: [], caps: { chat: true } },
  { kind: 'grok', label: 'Grok', model: (m) => ['--model', m], models: [], install: { npm: '@vibe-kit/grok-cli' }, bin: ['grok'], herdr: 'grok', start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'cursor', label: 'Cursor Agent', model: (m) => ['--model', m], models: [], install: { unix: 'curl https://cursor.com/install -fsS | bash' }, bin: ['cursor-agent'], herdr: 'cursor', start: () => [], busy: ESC_INTERRUPT, sessionId: 'discover', resume: (id) => ['--resume', id], login: ['login'], caps: { chat: true } },
  { kind: 'copilot', label: 'GitHub Copilot CLI', install: { unix: 'curl -fsSL https://gh.io/copilot-install | bash', win: 'winget install GitHub.Copilot', npm: '@github/copilot', brew: 'copilot-cli' }, bin: ['copilot'], start: () => [], busy: ESC_INTERRUPT, sessionId: 'discover', resume: (id) => ['--resume', id], login: ['login'], caps: { chat: true } },
  { kind: 'opencode', label: 'OpenCode', model: (m) => ['--model', m], models: [], install: { npm: 'opencode-ai' }, bin: ['opencode'], start: () => [], busy: ESC_INTERRUPT, login: ['auth', 'login'], caps: {} },
  { kind: 'amp', label: 'Amp', install: { npm: '@sourcegraph/amp' }, bin: ['amp'], start: () => [], busy: ESC_INTERRUPT, login: ['login'], caps: {} },
  { kind: 'qwen', label: 'Qwen Code', install: { npm: '@qwen-code/qwen-code' }, bin: ['qwen'], start: ({ prompt }) => (prompt ? ['-i', prompt] : []), promptArg: true, busy: ESC_INTERRUPT, sessionId: 'discover', resume: (id) => ['--resume', id], caps: { chat: true } },
  // Aider's /model switches its main model in place (aider.chat/docs/usage/commands.html).
  { kind: 'aider', label: 'Aider', model: (m) => ['--model', m], models: [], switchModel: { command: (m) => `/model ${m}` }, install: { unix: 'python3 -m pip install aider-install && aider-install', win: 'py -m pip install aider-install; aider-install' }, bin: ['aider'], start: () => [], busyFromOutput: true, caps: {} },
  { kind: 'goose', label: 'Goose', install: { unix: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash' }, bin: ['goose'], start: () => ['session'], busy: ESC_INTERRUPT, login: ['configure'], caps: {} },
  { kind: 'muse', label: 'Muse Code (Meta)', install: { unix: 'curl -fsSL https://dev.meta.ai/install.sh | bash' }, bin: ['muse'], start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'crush', label: 'Crush', install: { npm: '@charmland/crush' }, bin: ['crush'], start: () => [], busy: ESC_INTERRUPT, login: ['login'], caps: {} },
]

// Plain shells (dev servers, editors) use the same machinery with no agent features.
export const SHELL = { kind: 'shell', label: 'Shell', bin: [], start: () => [], caps: {} }

// Bridge AI's own chat (chatagent.js): any model you can reach, through a sign-in, an API key or a
// model server on this computer. Nothing to install, so it isn't in AGENTS (or in the lists of
// agents that are installed); it runs on the same Node as the server. Plain chats only: it has no
// tools. The model comes in BRIDGE_CHAT_MODEL (launch env), since it's chosen in the chat.
const CHAT_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'chatagent.js')
const chatNode = () => (nodeShimDir() ? path.join(nodeShimDir(), IS_WIN ? 'node.cmd' : 'node') : process.execPath)
export const CHAT = {
  kind: 'chat', label: 'Any model', builtin: true, get bin() { return [chatNode()] },
  sessionId: 'assign', promptArg: true,
  start: ({ sessionId, prompt }) => [CHAT_JS, '--session-id', sessionId, ...(prompt ? [prompt] : [])],
  resume: (id) => [CHAT_JS, '--resume', id],
  switchModel: { command: (m) => `/model ${m}` }, // models from chatmodels.js; it says "Set model to …"
  busy: ESC_INTERRUPT,
  caps: { chat: true, inputBox: true, typeAhead: true },
}

const byKind = new Map(AGENTS.map((a) => [a.kind, a]))
export const adapter = (kind) => byKind.get(kind) || (kind === 'shell' ? SHELL : kind === 'chat' ? CHAT : { kind, label: kind, bin: [kind], start: () => [], busy: ESC_INTERRUPT, caps: {} })
export const caps = (kind) => adapter(kind).caps || {}
export const newSessionId = () => crypto.randomUUID()

// Your login shell's PATH: apps opened from the Dock or a launcher get a bare one, and agent
// CLIs usually live in ~/.local/bin, Homebrew or npm's global folder.
const USUAL_DIRS = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
let loginPathCache = null
// BRIDGE_PATH, when set, is used instead: only those folders, no login shell (tests use it so
// agents installed on the computer running them are never found).
export function loginPath() {
  if (process.env.BRIDGE_PATH) return Promise.resolve(withNodeShim(process.env.BRIDGE_PATH))
  // Windows: its PATH as it is, and Node.js once Bridge AI has installed it (paths.js), even since it started.
  if (IS_WIN) return Promise.resolve(withNodeShim(process.env.PATH || ''))
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

// Ask the login shell again (Node.js was just installed, say).
export const forgetLoginPath = () => { loginPathCache = null }

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
// arrive while a check is running share it. Qwen Code only when Show more models is on.
let installedCache = { at: 0, list: null }
let installedInflight = null
const shown = (list) => list.filter((a) => !hiddenAgent(a.kind))
export function installed() {
  if (installedCache.list && Date.now() - installedCache.at < 60_000) return Promise.resolve(shown(installedCache.list))
  return (installedInflight ||= findInstalled().finally(() => { installedInflight = null })).then(shown)
}
async function findInstalled() {
  const PATH = await loginPath()
  const found = await Promise.all(AGENTS.map(async (a) => {
    for (const b of a.bin) { const p = await which(b, PATH); if (p) return { kind: a.kind, label: a.label, path: p, caps: a.caps, access: !!a.access, models: a.models || [] } }
    return null
  }))
  installedCache = { at: Date.now(), list: found.filter(Boolean) }
  return installedCache.list
}

// The install command for this platform, as you'd type it in a terminal. The agent's own installer
// when it has one (it needs nothing else, which matters on a new Mac with no Node), else npm when
// you have it, else Homebrew when you have it, else npm (which then says what's missing).
// have: { npm, brew, npmPrefix } from installTools(); brew is its path.
export function installCommand(kind, have = { npm: true }) {
  const i = adapter(kind).install
  if (!i) return null
  const own = IS_WIN ? i.win : i.unix
  if (own) return own
  if (i.npm && have.npm) return npmInstall(i.npm, have)
  if (i.brew && have.brew) return brewInstall(have.brew, i.brew)
  return i.npm ? npmInstall(i.npm, have) : null
}
// npm the way that works on this computer: with Bridge AI's own download cache (npm's shared one,
// ~/.npm, can hold files you can't change, left by an earlier `sudo npm`), and, when npm's global
// folder needs an administrator (Node.js from nodejs.org's Mac installer, or a Linux package),
// into your own ~/.local instead, whose bin folder Bridge AI looks in.
export const NPM_CACHE = dataFile('npm-cache')
const shellQuote = (s) => (IS_WIN ? `'${String(s).replace(/'/g, "''")}'` : /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)
const npmInstall = (pkg, have) => `npm install -g --cache ${shellQuote(NPM_CACHE)}${have.npmPrefix ? ` --prefix ${shellQuote(have.npmPrefix)}` : ''} ${pkg}`

// What an install needs that isn't here: an agent's own installer needs nothing; one that only
// comes through npm needs Node.js (or Homebrew, when it has a formula and you have Homebrew).
export function installNeeds(kind, have = { npm: true }) {
  const i = adapter(kind).install
  if (!i || (IS_WIN ? i.win : i.unix)) return null
  if ((i.npm && have.npm) || (i.brew && have.brew)) return null
  return i.npm ? 'Node.js' : null
}

// What there is to install with here. Homebrew is looked for where it puts itself too, since a new
// install isn't on the PATH until your shell profile says so. npmPrefix: where npm installs go when
// its own global folder needs an administrator (macOS and Linux; on Windows it's yours already).
export async function installTools() {
  const PATH = await loginPath()
  const [npm, brew] = await Promise.all([which('npm', PATH), IS_WIN ? null : which('brew', process.env.BRIDGE_PATH ? PATH : [PATH, '/opt/homebrew/bin', '/usr/local/bin'].join(path.delimiter))])
  return { npm: !!npm, brew, npmPrefix: npm && !IS_WIN && !(await npmGlobalWritable(npm, PATH)) ? path.join(os.homedir(), '.local') : null }
}
let prefixCache = { at: 0, key: '', ok: true }
async function npmGlobalWritable(npm, PATH) {
  if (prefixCache.key === npm && Date.now() - prefixCache.at < 5 * 60_000) return prefixCache.ok
  const prefix = await new Promise((resolve) => execFile(npm, ['prefix', '-g'], { timeout: 15000, env: { ...process.env, PATH }, windowsHide: true }, (err, out) => resolve(err ? '' : String(out).trim().split('\n').pop())))
  // Where it would write: lib/node_modules and bin under the prefix (or the prefix, before they exist).
  const can = async (d) => fs.promises.access(d, fs.constants.W_OK).then(() => true, (e) => (e.code === 'ENOENT' ? null : false))
  let ok = true
  if (prefix && path.isAbsolute(prefix)) {
    const lib = await can(path.join(prefix, 'lib', 'node_modules'))
    ok = lib ?? (await can(prefix)) ?? false
  }
  prefixCache = { at: Date.now(), key: npm, ok }
  return ok
}

// Every known agent with what the UI needs to show it (installed or not).
export async function catalog() {
  const [list, tools] = await Promise.all([installed(), installTools()])
  const have = new Map(list.map((x) => [x.kind, x]))
  return AGENTS.filter((a) => !hiddenAgent(a.kind)).map((a) => ({
    kind: a.kind, label: a.label, installed: have.has(a.kind), path: have.get(a.kind)?.path || null,
    caps: a.caps || {}, install: installCommand(a.kind, tools), needs: installNeeds(a.kind, tools), modelFlag: !!a.model, models: a.models || [], access: !!a.access,
  }))
}
export const clearInstalledCache = () => { installedCache = { at: 0, list: null } }
