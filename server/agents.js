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
//   effort(lvl) arguments that set how hard it thinks, for that session only (low … max, as
//               src/recommended.js lists them); Recommended Settings passes them
//   access(lvl, { dirs })  arguments for how much it may do without asking: 'ask' (its default:
//               before edits and commands), 'edits' (changes files freely, asks before commands),
//               'full' (nothing asked), and 'read' (reads and answers, nothing else: a bot's answers,
//               frontdesk.js), and 'change' (a bot's change: edits only in its own folder, a copy of
//               the repository, nothing else: botchanges.js), with dirs the other folders it may read
//               besides its own. Only flags
//               from each CLI's docs; agents without it always ask, and can't answer read-only.
//   confined    'read' keeps it to its own folder too: anything that would ask is refused instead,
//               and reading outside its folder would ask
//   login       arguments that sign it in, in a terminal tab Bridge AI opens (Sign in buttons);
//               [] for Gemini CLI, which signs in when it starts (index.js preselects Google)
//   caps        chat: a transcript Bridge can render; subagents; commands: a "/" menu;
//               questions: Claude-style pickers become clickable cards; inputBox: Bridge can
//               see what's typed in its prompt and avoid merging messages
//   submit      how a message goes in, where it differs from the rest (pasted, Enter 120 ms later):
//               enterAfter, the wait before Enter, past the time the CLI takes an Enter as part of
//               what was pasted (its source names it below); bracketed: pasted as one bracketed
//               paste even before the terminal has seen the CLI ask for that (the built-in runtime,
//               not on Windows); box: which reader in promptsafe.js tells what's typed in its input
//               box ('draft': a ❯ or › line between two rules; 'codex'), so Bridge sees the message
//               leave the box once Enter is pressed, and says so when it doesn't (without one, it's
//               sent as is); shown: Enter waits until the message shows in that box, and a message
//               that never does is said to have gone nowhere.
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IS_WIN, withNodeShim, nodeShimDir, dataFile, brewInstall, writeFileAtomic } from './paths.js'
import { hiddenAgent } from './labs.js'

const ESC_INTERRUPT = /esc to (interrupt|cancel)|ctrl\+c to (interrupt|cancel|stop)|press esc to stop/i
// Claude Code's working line: a spinner and a word ending in "…" ("✻ Infusing…", "✶ Pondering… (12s)").
// Newer versions dropped the "esc to interrupt" text; the finished line ("✻ Brewed for 8s") has no "…".
const CLAUDE_BUSY = new RegExp(`${ESC_INTERRUPT.source}|^\\s*[✻✳✶✢✽·*]\\s+[A-Z][\\w'-]*…`, 'im')

// Claude Code's permission rule for edits in its own folder and all below it: Edit(./ then two
// stars). (Written in two, so nothing reading this file takes it for a comment.)
const EDIT_HERE = 'Edit(./' + '**)'
// A bot's MCP servers for one run (botmcp.js runFolder): a folder of the desk's among the folders it's
// given (front-desk/mcp/<run>/), with the servers' config (config.json) and which of their tools it
// may use (rules.json: { allow, deny }), and Claude Code's own settings for the run (rules.json
// settings: its settings.json, KEPT_SETTINGS below with the rest of the run's: its Read rules, kept
// from what's hidden or named as keys in its folders, and a change's hook that checks each path it
// writes, given with --settings: keptFlags). Never a folder it may read: it comes out of dirs, and the
// rest stay as they were. Its files gone (Bridge AI started again since), it gives none.
const MCP_RUNS = dataFile('front-desk', 'mcp')
// A bot's session that may run commands (bash in rules.json, botmcp.js runFolder) has Bash among its
// tools only while its settings file holds it in Claude Code's sandbox, closed (sandboxClosed): read
// here, from the file it starts with, so a session started again (after an idle close, or Bridge AI
// started again: runtime/builtin.js keeps its folders) has exactly what it had, and one whose file
// is gone or says otherwise has no Bash at all.
// (Its file also keeps from its commands every variable that holds a key (credentials.envVars, deny),
// GitHub out of the network whatever is allowed (deniedDomains), Apple Events off, your home folder
// and the computer's other people's and drives unreadable (permissions.blockReadsOutsideWorkingDirectories):
// botmcp.js sandboxOf, runFolder. No allow rule of Bridge AI's lets a command run: the sandbox's own
// auto-allow does, for a command in it (autoAllowBashIfSandboxed, which holds in dontAsk too:
// code.claude.com/docs/en/sandboxing, Auto-allow mode), so a command the sandbox doesn't hold,
// because of a policy of your organization's Bridge AI can't read, is refused by dontAsk.)
// Commands (Bash) in bot sessions: off in this version, for every bot, whatever its settings say, so
// no session's agent ever has Bash among its tools. A security review found that a session's commands
// could still reach outside its copy (its top made a link, a command left running racing Bridge AI's
// own work in it, git in a repository's copy) and, on Linux, read other processes' environments; a
// later version brings commands back whole. What they'd run in stays, behind this one switch: the
// sandbox (botmcp.js sandboxOf, sandboxClosed and bashProblem here), botguard.mjs's command checks,
// botsessions.js stopShells. BRIDGE_TEST_BOT_COMMANDS=1 turns them on for the tests of that code only
// (test/suites), and only in a test's kit (BRIDGE_FIX_DRYRUN, as BRIDGE_HOOK_EXEC and
// BRIDGE_TEST_CAPTURE_TOKEN are), so a variable exported in a shell or set with launchctl setenv can't
// turn them on in a real install; Bridge AI never sets either.
export const COMMANDS = process.env.BRIDGE_TEST_BOT_COMMANDS === '1' && process.env.BRIDGE_FIX_DRYRUN === '1'
export const COMMANDS_OFF = 'Commands in bot sessions come in a later version'
// The tools a session with Full Access may use without asking: all of Claude Code's own (an unknown
// name here is one this version hasn't got).
export const FULL_TOOLS = ['Bash', 'BashOutput', 'KillShell', 'PowerShell', 'Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'Agent']
export const sandboxClosed = (s) => {
  if (!COMMANDS) return false
  const x = s?.sandbox
  return !!x && x.enabled === true && x.failIfUnavailable === true && x.allowUnsandboxedCommands === false && x.autoAllowBashIfSandboxed === true
    && x.network?.strictAllowlist === true && Array.isArray(x.network?.allowedDomains) && x.filesystem?.disabled === false && !x.excludedCommands?.length
    && Array.isArray(x.filesystem?.denyRead) && x.filesystem.denyRead.length > 0
    && x.allowAppleEvents === false && (x.network?.deniedDomains || []).includes('github.com')
    && (x.credentials?.envVars || []).some((e) => e?.name === 'GITHUB_TOKEN' && e.mode === 'deny')
    && s.permissions?.blockReadsOutsideWorkingDirectories === true && !(s.permissions?.allow || []).some((r) => /^Bash(\(|$)/.test(String(r)))
    && (s.hooks?.PreToolUse || []).some((m) => /(^|\|)Bash(\||$)/.test(String(m.matcher || '')))
}
export function mcpOf(dirs = []) {
  const runs = (dirs || []).filter((d) => path.resolve(String(d)).startsWith(MCP_RUNS + path.sep))
  let mcp = null
  for (const d of runs) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(d, 'rules.json'), 'utf8'))
      const settings = r.settings && path.resolve(String(r.settings)) === path.join(d, 'settings.json') && fs.existsSync(path.join(d, 'settings.json')) ? path.join(d, 'settings.json') : null
      let bash = false
      if (r.bash === true && settings) { try { bash = sandboxClosed(JSON.parse(fs.readFileSync(settings, 'utf8'))) } catch { bash = false } }
      if (fs.existsSync(path.join(d, 'config.json'))) mcp = { config: path.join(d, 'config.json'), allow: (r.allow || []).map(String), deny: (r.deny || []).map(String), settings, bash, full: r.full === true && !!settings }
    } catch { /* gone: none */ }
  }
  return { dirs: (dirs || []).filter((d) => !runs.includes(d)), mcp }
}
// Its flags (allowed: with its own --allowedTools; a bot's change has put its tools in its own).
// Each takes a list, so another flag follows.
const mcpFlags = (m, { allowed = true } = {}) => (m
  ? ['--mcp-config', m.config, ...(allowed && m.allow.length ? ['--allowedTools', ...m.allow] : []), ...(m.deny.length ? ['--disallowedTools', ...m.deny] : [])]
  : [])
// A run kept to its folders (a bot's answer or change) works for someone other than you, in folders
// someone else may have written (a shared repository, a synced folder), and Bridge AI trusts them for
// it (delegate.js). So Claude Code loads only your own settings for it (--setting-sources user): none
// of a folder's own (.claude/settings.json, .claude/settings.local.json, .mcp.json, CLAUDE.md and its
// rules), whose allow rules, other folders, hooks or env would let it read more or run something here
// (code.claude.com/docs/en/permissions, What runs before you trust a folder). And Bridge AI's own
// settings for it in one file (--settings, a source of its own that --setting-sources doesn't leave
// out; Claude Code takes one, so it's given once): KEPT_SETTINGS, its file tools refusing a read
// outside its folders in any mode, whatever an allow rule says, yours too
// (permissions.blockReadsOutsideWorkingDirectories). A run with a folder of the desk's (botmcp.js
// runFolder) has its own file there, KEPT_SETTINGS with the rest of its settings (a change's hook);
// any other, KEPT_FILE, KEPT_SETTINGS alone. Your own hooks still run (herdr's, that say how it's
// doing, are among them).
export const KEPT_SETTINGS = { permissions: { blockReadsOutsideWorkingDirectories: true } }
export const KEPT_FILE = dataFile('front-desk', 'claude-settings.json')
const keptFlags = (m) => ['--setting-sources', 'user', '--settings', m?.settings || KEPT_FILE]
// The file, written as KEPT_SETTINGS has it (before a kept run starts, and as Bridge AI starts, for
// one started again then). Throws when it can't be.
export function writeKeptSettings() {
  const text = `${JSON.stringify(KEPT_SETTINGS, null, 2)}\n`
  try { if (fs.readFileSync(KEPT_FILE, 'utf8') === text) return KEPT_FILE } catch { /* not there yet */ }
  fs.mkdirSync(path.dirname(KEPT_FILE), { recursive: true })
  writeFileAtomic(KEPT_FILE, text)
  return KEPT_FILE
}

// An agent's models for the message box's menu (models.js), with the ones picked before. Claude
// Code's by its own short names, which follow the newest of each kind, and Fable 5.2 by name (its
// "fable" is Fable 5 in some sessions: code.claude.com/docs/en/model-config). Codex's, the ones its
// docs recommend (learn.chatgpt.com/docs/models, November 2026), GPT-6.2 Sol first.
const CODEX_MODELS = ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra', 'gpt-6-luna']

export const AGENTS = [
  {
    kind: 'claude', label: 'Claude Code', model: (m) => ['--model', m], models: ['opus', 'sonnet', 'haiku', 'claude-fable-5-2'],
    // --effort is for that session only: unlike /effort typed in it, it's never kept in Claude Code's settings.
    effort: (lvl) => ['--effort', lvl],
    // Its own /model (code.claude.com/docs/en/model-config): "default" clears the override.
    switchModel: { command: (m) => `/model ${m}`, dflt: 'default' }, install: { unix: 'curl -fsSL https://claude.ai/install.sh | bash', win: 'powershell -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"', npm: '@anthropic-ai/claude-code', brew: '--cask claude-code' }, bin: ['claude'], herdr: 'claude', usage: 'claude',
    sessionId: 'assign',
    start: ({ sessionId, prompt }) => [...(sessionId ? ['--session-id', sessionId] : []), ...(prompt ? [prompt] : [])], promptArg: true,
    resume: (id) => ['--resume', id],
    // read: its tools cut to Read, Grep and Glob (nothing that edits, runs a command, fetches a page
    // or starts a subagent), no MCP servers, and anything that would ask refused rather than asked
    // (dontAsk), which is what reading outside its folder would do. The other folders it may read
    // are working directories too (--add-dir), read without asking as its own is, and nothing
    // beyond them. --tools and --add-dir each take a list, so a flag follows each before anything
    // else can (the opening message would be read as a folder).
    // change: a bot's change (botchanges.js), in its own copy of a repository: Read, Grep and Glob,
    // and Edit and Write allowed without asking only inside its folder (an Edit rule for its folder
    // and all in it, which covers every tool that edits), anything else refused (dontAsk), so it
    // can't run a command, fetch a page or edit outside it; the other folders it may read added as
    // for read. A bot's change to files in its write folders (botwrite.js) is the same in a staging
    // copy of them, with the PreToolUse hook in its settings besides: it checks every path it writes,
    // and refuses one outside its copy, whatever your own settings allow.
    // Either way a bot's MCP servers, when it has some (mcpOf below): only those, --mcp-config with
    // --strict-mcp-config, and of their tools only the ones allowed for whoever asked (--allowedTools);
    // the rest refused by dontAsk, and named in --disallowedTools too where they're known. And only
    // your own settings and Bridge AI's for it, never its folders' own, Bridge AI's in one file given
    // once (keptFlags above: its run's own, else KEPT_FILE).
    access: (lvl, o = {}) => {
      if (lvl !== 'read' && lvl !== 'change' && lvl !== 'owner') return lvl === 'edits' ? ['--permission-mode', 'acceptEdits'] : lvl === 'full' ? ['--permission-mode', 'bypassPermissions'] : []
      const { dirs, mcp } = mcpOf(o.dirs)
      const add = dirs.length ? ['--add-dir', ...dirs] : []
      // A bot's session for you alone, its When You Ask: Full Access on (frontdesk.js): as your own
      // Claude Code in its folders, every tool of its own allowed (FULL_TOOLS, Bash among them, no
      // sandbox) and nothing asked (dontAsk: what isn't allowed, an ask rule of yours, a protected path,
      // a removal of a critical path, a question for you, is refused rather than waiting on a prompt
      // nobody sees), with its MCP servers and Bridge AI's tools for it, your own settings and its run's
      // file (its hooks: a push held for you, a copy of each file before an edit for Undo). Only for a
      // run whose file Bridge AI wrote for it so (rules.json full); else it only reads.
      if (lvl === 'owner') {
        if (!mcp?.full) return ['--tools', 'Read,Grep,Glob', ...add, ...mcpFlags(mcp), '--permission-mode', 'dontAsk', '--strict-mcp-config', ...keptFlags(mcp)]
        return ['--allowedTools', ...FULL_TOOLS, ...mcp.allow, ...add, ...mcpFlags(mcp, { allowed: false }), '--permission-mode', 'dontAsk', '--strict-mcp-config', ...keptFlags(mcp)]
      }
      // (A session's commands: Bash, only while its settings file keeps it in Claude Code's sandbox,
      // closed, sandboxClosed. Never allowed by a rule of ours: run by the sandbox's auto-allow, so
      // one it doesn't hold is refused (dontAsk).)
      const bash = mcp?.bash ? ',Bash' : ''
      return lvl === 'read' ? ['--tools', `Read,Grep,Glob${bash}`, ...add, ...mcpFlags(mcp), '--permission-mode', 'dontAsk', '--strict-mcp-config', ...keptFlags(mcp)]
        : ['--tools', `Read,Grep,Glob,Edit,Write${bash}`, '--allowedTools', EDIT_HERE, ...(mcp ? mcp.allow : []), ...add, ...mcpFlags(mcp, { allowed: false }), '--permission-mode', 'dontAsk', '--strict-mcp-config', ...keptFlags(mcp)]
    },
    confined: true,
    // A copy of a conversation under a new id (the original stays as it is).
    fork: (id, newId) => ['--resume', id, '--fork-session', ...(newId ? ['--session-id', newId] : [])],
    busy: CLAUDE_BUSY,
    // typeAhead: takes messages while it works (queues or folds them in itself), like typing in its
    // terminal. rewind: Bridge AI can edit a sent message through its Rewind list. btw: /btw side questions.
    // undo: that rewind can restore files too, so Chat offers "Undo this reply".
    caps: { chat: true, subagents: true, commands: true, questions: true, inputBox: true, typeAhead: true, rewind: true, undo: true, btw: true, fork: true },
    submit: { box: 'draft' },
  },
  {
    // Its installer ends by asking "Start Codex now? [y/N]", which waits forever in an install tab
    // nobody is looking at: CODEX_NON_INTERACTIVE says no.
    kind: 'codex', label: 'Codex', model: (m) => ['--model', m], models: CODEX_MODELS, install: { unix: 'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh', win: '$env:CODEX_NON_INTERACTIVE=\'1\'; powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', npm: '@openai/codex', brew: '--cask codex' }, bin: ['codex'], herdr: 'codex', usage: 'codex',
    sessionId: 'discover',
    start: ({ prompt }) => (prompt ? [prompt] : []), promptArg: true,
    resume: (id) => ['resume', id],
    // read: its read-only sandbox, never asking (what it runs can read anywhere, but write nothing
    // and reach no network), so it isn't confined to its folder, and needs no other folders named.
    access: (lvl) => (lvl === 'edits' ? ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'] : lvl === 'full' ? ['--dangerously-bypass-approvals-and-sandbox'] : lvl === 'read' ? ['--sandbox', 'read-only', '--ask-for-approval', 'never'] : []),
    fork: (id) => ['fork', id],
    busy: ESC_INTERRUPT,
    caps: { chat: true, commands: true, typeAhead: true, fork: true, rewind: true },
    // Codex takes an Enter it reads among a paste's keys (8 ms apart; 120 ms on from the last, the
    // wait Bridge AI had) as a newline, so a message could stay in its box unsent
    // (codex-rs/tui/src/bottom_pane/paste_burst.rs). A bracketed paste is one event to it whatever
    // its mode (its terminal library reads one either way), and Enter goes once the message shows.
    submit: { box: 'codex', shown: true, bracketed: true, enterAfter: 300 },
  },
  // Chat from their own logs (otherlogs.js): the session they start is found after launch.
  // Gemini CLI takes an Enter within 40 ms of a paste as a newline, and one within 30 ms of a key
  // (packages/cli/src/ui/components/InputPrompt.tsx, contexts/KeypressContext.tsx); the 40 ms end on
  // a timer, which runs late while it draws a long paste, so Enter waits longer.
  { kind: 'gemini', label: 'Gemini CLI', install: { npm: '@google/gemini-cli', brew: 'gemini-cli' }, bin: ['gemini'], herdr: 'gemini', start: ({ prompt }) => (prompt ? ['-i', prompt] : []), promptArg: true, busy: ESC_INTERRUPT, sessionId: 'discover', resume: (id) => ['--resume', id], access: (lvl) => (lvl === 'edits' ? ['--approval-mode', 'auto_edit'] : lvl === 'full' ? ['--approval-mode', 'yolo'] : []), login: [], caps: { chat: true }, submit: { enterAfter: 250 } },
  // Google's Antigravity CLI: what Google AI plans moved to when Gemini CLI stopped serving them (18
  // June 2026; Gemini CLI goes on for API keys and Code Assist licences). It signs in in the browser
  // the first time it starts. Its conversations aren't read into Chat yet, so it's a terminal.
  { kind: 'agy', label: 'Antigravity CLI', model: (m) => ['--model', m], models: [], install: { unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', win: 'powershell -ExecutionPolicy ByPass -c "irm https://antigravity.google/cli/install.ps1 | iex"' }, bin: ['agy'], start: ({ prompt }) => (prompt ? ['-i', prompt] : []), promptArg: true, busy: ESC_INTERRUPT, access: (lvl) => (lvl === 'edits' ? ['--mode', 'accept-edits'] : lvl === 'full' ? ['--dangerously-skip-permissions'] : []), caps: {} },
  { kind: 'grok', label: 'Grok', model: (m) => ['--model', m], models: [], install: { npm: '@vibe-kit/grok-cli' }, bin: ['grok'], herdr: 'grok', start: () => [], busy: ESC_INTERRUPT, caps: {} },
  { kind: 'cursor', label: 'Cursor Agent', model: (m) => ['--model', m], models: [], install: { unix: 'curl https://cursor.com/install -fsS | bash' }, bin: ['cursor-agent'], herdr: 'cursor', start: () => [], busy: ESC_INTERRUPT, sessionId: 'discover', resume: (id) => ['--resume', id], login: ['login'], caps: { chat: true } },
  { kind: 'copilot', label: 'GitHub Copilot CLI', install: { unix: 'curl -fsSL https://gh.io/copilot-install | bash', win: 'winget install GitHub.Copilot', npm: '@github/copilot', brew: 'copilot-cli' }, bin: ['copilot'], start: () => [], busy: ESC_INTERRUPT, sessionId: 'discover', resume: (id) => ['--resume', id], login: ['login'], caps: { chat: true } },
  // OpenCode puts a paste in its box only after looking whether it's a file's path, and an Enter
  // before then sends nothing (packages/tui/src/component/prompt/index.tsx, pasteInputText).
  { kind: 'opencode', label: 'OpenCode', model: (m) => ['--model', m], models: [], install: { npm: 'opencode-ai' }, bin: ['opencode'], start: () => [], busy: ESC_INTERRUPT, login: ['auth', 'login'], caps: {}, submit: { enterAfter: 300 } },
  { kind: 'amp', label: 'Amp', install: { npm: '@sourcegraph/amp' }, bin: ['amp'], start: () => [], busy: ESC_INTERRUPT, login: ['login'], caps: {} },
  // Qwen Code drops an Enter within 500 ms of a paste on Windows and on Node.js before 20
  // (packages/cli/src/ui/components/InputPrompt.tsx, its paste workaround).
  { kind: 'qwen', label: 'Qwen Code', install: { npm: '@qwen-code/qwen-code' }, bin: ['qwen'], start: ({ prompt }) => (prompt ? ['-i', prompt] : []), promptArg: true, busy: ESC_INTERRUPT, sessionId: 'discover', resume: (id) => ['--resume', id], caps: { chat: true }, submit: { enterAfter: 650 } },
  // Aider's /model switches its main model in place (aider.chat/docs/usage/commands.html). It asks
  // for bracketed paste only while its prompt waits, and a line break typed bare sends what's before
  // it (prompt_toolkit reads LF as Enter): so always bracketed, which prompt_toolkit reads either way.
  { kind: 'aider', label: 'Aider', model: (m) => ['--model', m], models: [], switchModel: { command: (m) => `/model ${m}` }, install: { unix: 'python3 -m pip install aider-install && aider-install', win: 'py -m pip install aider-install; aider-install' }, bin: ['aider'], start: () => [], busyFromOutput: true, caps: {}, submit: { bracketed: true } },
  { kind: 'goose', label: 'Goose', install: { unix: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash' }, bin: ['goose'], start: () => ['session'], busy: ESC_INTERRUPT, login: ['configure'], caps: {} },
  { kind: 'muse', label: 'Muse Code (Meta)', install: { unix: 'curl -fsSL https://dev.meta.ai/install.sh | bash' }, bin: ['muse'], start: () => [], busy: ESC_INTERRUPT, caps: {} },
  // Crush makes a long paste (over 10 lines) an attachment in the background, and an Enter before
  // it's there sends nothing (internal/ui/model/ui.go, handlePasteMsg).
  { kind: 'crush', label: 'Crush', install: { npm: '@charmland/crush' }, bin: ['crush'], start: () => [], busy: ESC_INTERRUPT, login: ['login'], caps: {}, submit: { enterAfter: 300 } },
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
  submit: { box: 'draft' },
}

const byKind = new Map(AGENTS.map((a) => [a.kind, a]))
export const adapter = (kind) => byKind.get(kind) || (kind === 'shell' ? SHELL : kind === 'chat' ? CHAT : { kind, label: kind, bin: [kind], start: () => [], busy: ESC_INTERRUPT, caps: {} })
export const caps = (kind) => adapter(kind).caps || {}
// Whether an agent can be started read-only (access 'read'), and whether that keeps it to its folder.
export const readOnly = (kind) => (adapter(kind).access?.('read')?.length ? { confined: !!adapter(kind).confined } : null)
// Whether a bot's change can be made by it: edits held to its own folder, nothing run.
export const canChange = (kind) => !!(adapter(kind).confined && adapter(kind).access?.('change')?.length)
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
let installedRound = 0 // a look started before clearInstalledCache() neither answers later callers nor is kept
const shown = (list) => list.filter((a) => !hiddenAgent(a.kind))
export function installed() {
  if (installedCache.list && Date.now() - installedCache.at < 60_000) return Promise.resolve(shown(installedCache.list))
  if (!installedInflight) {
    const round = installedRound
    const look = findInstalled(round).finally(() => { if (installedInflight === look) installedInflight = null })
    installedInflight = look
  }
  return installedInflight.then(shown)
}
async function findInstalled(round) {
  const PATH = await loginPath()
  const found = await Promise.all(AGENTS.map(async (a) => {
    for (const b of a.bin) { const p = await which(b, PATH); if (p) return { kind: a.kind, label: a.label, path: p, caps: a.caps, access: !!a.access, effort: !!a.effort, models: a.models || [] } }
    return null
  }))
  const list = found.filter(Boolean)
  if (round === installedRound) installedCache = { at: Date.now(), list }
  return list
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
    caps: a.caps || {}, install: installCommand(a.kind, tools), needs: installNeeds(a.kind, tools), modelFlag: !!a.model, models: a.models || [], access: !!a.access, effort: !!a.effort,
  }))
}
// Look again (an agent was just installed): a look already under way may have missed it.
export const clearInstalledCache = () => { installedCache = { at: 0, list: null }; installedInflight = null; installedRound++; versions.clear() }

// What version an agent's CLI says it is (`<program> --version`): '2.1.257', or null (not installed,
// or it didn't say). Kept until its program changes (an update replaces it), ten minutes pass or
// clearInstalledCache(); callers meanwhile share one look.
const versions = new Map() // kind -> { key, at, look }
export async function versionOf(kind) {
  const bin = (await installed()).find((x) => x.kind === kind)?.path
  if (!bin) return null
  const st = await fs.promises.stat(bin).catch(() => null)
  const key = [bin, await fs.promises.realpath(bin).catch(() => bin), st?.size, st?.mtimeMs].join('\n')
  const hit = versions.get(kind)
  if (hit && hit.key === key && Date.now() - hit.at < 10 * 60_000) return hit.look
  const PATH = await loginPath()
  // (Through cmd on Windows, for an npm install's claude.cmd.)
  const look = new Promise((resolve) => execFile(IS_WIN ? `"${bin}"` : bin, ['--version'], { timeout: 15_000, env: { ...process.env, PATH }, windowsHide: true, shell: IS_WIN }, (err, out) => resolve(err ? null : (/\b\d+\.\d+\.\d+\b/.exec(String(out)) || [])[0] || null)))
  versions.set(kind, { key, at: Date.now(), look })
  return look
}
const atLeast = (v, min) => { const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return true }

// The oldest CLI a run kept to its folders starts on, and how it's updated. Claude Code 2.1.257: the
// first whose file tools take blockReadsOutsideWorkingDirectories (KEPT_SETTINGS), and past the
// fixes to --setting-sources that matter here (2.1.69, a folder's skills found as it reads; 2.1.211,
// rules in its nested folders). Code.claude.com's changelog and settings reference say when each came.
export const KEPT_MIN = { claude: { version: '2.1.257', update: 'claude update' } }
// Why an agent can't be started kept to its folders here, or null: its CLI is older than that. (One
// whose version isn't known starts: a CLI too old for --setting-sources refuses it and ends at once,
// so it never runs without it.)
export async function keptProblem(kind) {
  const min = KEPT_MIN[kind]
  if (!min) return null
  const v = await versionOf(kind).catch(() => null)
  return v && !atLeast(v, min.version) ? `Bots need ${adapter(kind).label} ${min.version} or later: update it with ${min.update}` : null
}

// ---------- A bot's commands, in Claude Code's sandbox ----------
// A session may run commands (Bash) only in Claude Code's own sandbox (code.claude.com/docs/en/
// sandboxing: macOS Seatbelt, Linux and WSL2 bubblewrap; none on native Windows), closed: it refuses
// to start where the sandbox can't (sandbox.failIfUnavailable, 2.1.83), a command can't be retried
// outside it (allowUnsandboxedCommands false), no network but the domains you list
// (network.strictAllowlist, 2.1.219), sandboxed commands run without asking (autoAllowBashIfSandboxed,
// asked for since 2.1.325 made them ask), and a deny entry ending in / holds (2.1.224). The oldest
// Claude Code that has all of that is older than the one any bot's run needs (KEPT_MIN), so that's
// the one: BASH_MIN. Lists in settings merge across files (code.claude.com/docs/en/settings, Lists
// merge instead of overriding), so your own settings, or your organization's, that widen the sandbox
// for every session (commands run outside it, more domains, more folders to write or read, more
// working directories, its file isolation off) would widen a bot's too: then a bot has no commands,
// and says why. MANAGED is read as frontdesk.js reads it (a file; settings pushed some other way
// aren't seen here). BRIDGE_CLAUDE_MANAGED: another file to read as them (tests).
export const BASH_MIN = KEPT_MIN.claude.version
const MANAGED_SETTINGS = () => (process.env.BRIDGE_CLAUDE_MANAGED ? [process.env.BRIDGE_CLAUDE_MANAGED]
  : process.platform === 'darwin' ? ['/Library/Application Support/ClaudeCode/managed-settings.json']
    : IS_WIN ? ['C:\\ProgramData\\ClaudeCode\\managed-settings.json'] : ['/etc/claude-code/managed-settings.json'])
export const widens = (j, managed) => {
  const s = j?.sandbox || {}
  const n = s.network || {}
  const f = s.filesystem || {}
  if (s.excludedCommands?.length) return 'run some commands outside the sandbox (sandbox.excludedCommands)'
  if (n.allowedDomains?.length) return 'let every session reach more domains (sandbox.network.allowedDomains)'
  if (f.allowWrite?.length) return 'let every session write in more folders (sandbox.filesystem.allowWrite)'
  if (f.allowRead?.length) return 'let every session read more folders (sandbox.filesystem.allowRead)'
  if (n.allowUnixSockets?.length) return 'let every session reach more sockets (sandbox.network.allowUnixSockets)'
  if (j?.permissions?.additionalDirectories?.length) return 'give every session more working directories (permissions.additionalDirectories)'
  // (Allow rules a sandbox takes in: WebFetch(domain:…) ones into its domains, a bare * all of them;
  // Edit ones into the folders it may write: settings-reference, sandbox.filesystem.)
  const rules = (j?.permissions?.allow || []).map(String).filter((r) => /^(WebFetch|Edit|Write|MultiEdit|NotebookEdit)(\(|$)/.test(r.trim()))
  if (rules.length) return `allow ${rules.slice(0, 3).join(', ')} (permissions.allow), which a sandbox takes in as more domains or folders to write`
  // (Commands allowed by a rule of yours: they'd run even where a policy of your organization's that
  // Bridge AI can't read turns the sandbox off, where the sandbox's own auto-allow wouldn't.)
  const runs = (j?.permissions?.allow || []).map(String).filter((r) => /^Bash(\(|$)/.test(r.trim()))
  if (runs.length) return `allow ${runs.slice(0, 3).join(', ')} (permissions.allow), commands that would run even outside the sandbox`
  if (n.allowMachLookup?.length) return 'let every session reach more macOS services (sandbox.network.allowMachLookup)'
  if (n.httpProxyPort != null || n.socksProxyPort != null) return 'send every session\'s traffic through a proxy of your own, past the sandbox\'s domain lists (sandbox.network.httpProxyPort, socksProxyPort)'
  if (s.allowNestedUserNamespaces === true) return 'let every session make user namespaces, which leads out of the sandbox (sandbox.allowNestedUserNamespaces)'
  // (Variables for every session: any but a few that only turn something off or set a limit could
  // give its commands more, a key, a proxy, a shell prefix.)
  const vars = Object.keys(j?.env || {}).filter((k) => !/^(DISABLE_\w+|DO_NOT_TRACK|CLAUDE_CODE_DISABLE_\w+|CLAUDE_CODE_MAX_OUTPUT_TOKENS|MAX_THINKING_TOKENS|BASH_(DEFAULT|MAX)_TIMEOUT_MS|ANTHROPIC_(MODEL|SMALL_FAST_MODEL|DEFAULT_\w+_MODEL)|CLAUDE_CODE_EFFORT_LEVEL)$/.test(k))
  if (vars.length) return `set environment variables for every session (env: ${vars.slice(0, 4).join(', ')})`
  // (A switch your own settings set is overruled by a bot's own file; your organization's isn't.)
  if (managed && (s.enabled === false || s.allowUnsandboxedCommands === true || s.failIfUnavailable === false || f.disabled === true || n.allowAllUnixSockets === true || n.allowLocalBinding === true
    || s.allowAppleEvents === true || s.enableWeakerNestedSandbox === true || s.enableWeakerNetworkIsolation === true)) return 'change how the sandbox holds'
  return null
}
// Why a bot can't run commands here, or null: this system, its Claude Code, or settings of yours or
// your organization's. home: whose ~/.claude/settings.json (tests).
export async function bashProblem(kind = 'claude', { home = os.homedir() } = {}) {
  if (!COMMANDS) return COMMANDS_OFF
  if (kind !== 'claude') return 'Commands need Claude Code, which runs them in its sandbox'
  if (IS_WIN) return 'Claude Code has no sandbox on Windows, so a bot runs no commands here'
  const PATH = await loginPath()
  if (process.platform === 'darwin' && !fs.existsSync('/usr/bin/sandbox-exec')) return 'This Mac has no sandbox-exec, which Claude Code\'s sandbox runs commands in'
  if (process.platform === 'linux') {
    for (const b of ['bwrap', 'socat']) if (!(await which(b, PATH))) return `Claude Code's sandbox needs ${b === 'bwrap' ? 'bubblewrap (bwrap)' : 'socat'} on Linux, and it isn't installed`
  }
  const v = await versionOf(kind).catch(() => null)
  if (!v) return 'Claude Code\'s version couldn\'t be read, so its sandbox can\'t be relied on'
  if (!atLeast(v, BASH_MIN)) return `Commands need Claude Code ${BASH_MIN} or later, for its sandbox: update it with ${KEPT_MIN.claude.update}`
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
  // (Yours: in ~/.claude, or the folder CLAUDE_CONFIG_DIR names, which a bot's agent starts with too.)
  for (const f of [...new Set([path.join(home, '.claude', 'settings.json'), ...(process.env.CLAUDE_CONFIG_DIR ? [path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')] : [])])]) {
    const mine = widens(read(f), false)
    if (mine) return `Your Claude Code settings ${mine}, which a bot's commands would get too`
  }
  for (const f of MANAGED_SETTINGS()) {
    const why = widens(read(f), true)
    if (why) return `Your organization's Claude Code settings ${why}, which a bot's commands would get too`
  }
  return null
}
