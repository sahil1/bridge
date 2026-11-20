// Stand-in Claude Code for the Chief of Staff and the helpers it delegates to (chief-delegate):
// draws its screen as Claude Code does (working, done, or asking for permission), keeps its
// conversation in a transcript where Bridge AI reads Claude Code's, and takes typed messages.
//   claude --session-id <id>                 the Chief of Staff: waits for messages. Each one it's
//                                            sent goes in ~/chief-got.log ({ session, text }), and
//                                            it works on it a second before it's done again
//   claude --session-id <id> "<brief>"       a helper, by what its brief says:
//     [work <s>]                             works that many seconds (2 if not said), writes
//     [file <name>]                          <name> (result.md if not said) in its folder and ends
//                                            with a summary naming it
//     [hold <name>]                          works until ~/release-<name> is there, then as above
//     [ask]                                  first asks for permission to write the file; 1 goes ahead
//     [exit]                                 ends at once, as an agent that crashed or was closed
//                                            would, having said nothing
//                                            Each start goes in ~/helpers-started.log ({ args, cwd,
//                                            message, secrets: the names of any Slack token, or test Discord or Teams secret, in its
//                                            environment }). A follow-up typed in once it's done works a
//                                            second and ends "Followed up: <the message>".
//   claude ... "<a bot's brief>"             an answering agent (its brief marks off a question from
//                                            someone), as it was started; by what the question says:
//     [answer <text>]                        reads what's in its folder, then answers that
//     [noanswer]                             says NO ANSWER, and why
//     [notforme]                             says NOT FOR ME
//     [work <s>]                             takes that many seconds (2 if not said)
//     [then <s>]                             takes that many instead when its brief says it's
//                                            picking up after its time limit
//                                            and by what the bot's instructions say:
//     [sign <text>]                          ends every answer with it
//     [try-write <name>]                     tries to write <name> in its folder first: only when
//                                            --tools lets it Write and, under --permission-mode
//                                            dontAsk, --allowedTools allows it there (Edit(./**)),
//                                            else it says it couldn't
//     [try-run]                              tries to run a command (touch ran.txt): only when
//                                            --tools lets it use Bash
//     [try-read <path>]                      tries to read a file (each one it's given, a path in
//                                            its folder relative to it): one in its folder or a folder
//                                            --add-dir gave it is read; one outside them is refused
//                                            under --permission-mode dontAsk, as Claude Code
//                                            refuses what would have asked; and one a Read rule in
//                                            its settings denies (permissions.deny) is refused
//                                            Each try goes in ~/answer-tries.log ({ try, done, cwd;
//                                            a read's path, and rule: a Read rule refused it }).
//     [edit <name> <text>]                   writes <text> into <name> in its folder: only when
//                                            --tools lets it Edit and --allowedTools Edit(./**)
//                                            lets it there without asking (a bot's change, in its
//                                            own copy of a repository), else it says it couldn't
//     [edit-outside <path> <text>]           tries to write a file outside its folder: refused
//                                            under --permission-mode dontAsk (Edit(./**) is only
//                                            its folder)
//                                            Every edit first goes through the PreToolUse hooks its
//                                            --settings give (a file or JSON), as Claude Code runs
//                                            them: each matching command run with the tool call as
//                                            JSON on stdin; exit 2 refuses it (each, with its command,
//                                            in ~/hooks.log)
//     [edit-anywhere <path> <text>]          writes a file anywhere, as if your own settings allowed
//                                            every edit: only its hooks can stop it
//     [force-write <path> <text>]            writes <text> (\n a new line, \t a tab, \r a carriage
//                                            return, {{ and }} brackets)
//                                            to <path> in its folder, past its hooks and permissions,
//                                            as if its hook never ran
//     [edit-lines <path> <n>]                writes a file of n lines to <path> in its folder
//     [edit-many <n> <folder>]               writes n new files, <folder>/1.md … <folder>/<n>.md
//                                            (many/ if not said)
//     [delete <name>], [move <from> <to>]    deletes or moves a file with the delete_file or
//                                            move_file tool of its MCP server bridge_files (as
//                                            [make] calls bridge_outbox's): only when --allowedTools
//                                            lets it, else it says it couldn't
//     [hand <name>]                          answers HAND TO <name>, when its brief says it may hand
//                                            changes to files on (else it's ignored)
//     [make <name> <text>]                   saves <name> (with <text>, or a line saying what it
//                                            is) to send back, with the save_file tool of its MCP
//                                            server bridge_outbox (the server started as its
//                                            --mcp-config says, and asked as Claude Code asks one):
//                                            only with --strict-mcp-config and --allowedTools letting
//                                            it (mcp__bridge_outbox__save_file), else it says it couldn't
//     [make-exe <name>], [make-script <name>]   saves a Windows program (MZ…) or a script (#!…) so
//     [make-big <name> <MB>]                 saves a file that many MB big so
//     [make-early <name> <text>]             as [make], but at once, before it works (not again
//                                            once it's picked up after its time limit)
//     [attach <path>]                        attaches a file in its folders, as it is, with the
//                                            attach_file tool of bridge_outbox (as [make]: only with
//                                            mcp__bridge_outbox__attach_file allowed, else it says it
//                                            couldn't); one refused it doesn't mention, as the tool
//                                            says Bridge AI does
//     [attach-line <path>]                   ends with a line ATTACH: <path>, as an agent with no tool
//                                            for it would
//     [remember <text>]                      ends with REMEMBER: <text>
//     [remember-me <text>]                   ends with REMEMBER about <the asker>: <text>
//     [recall]                               says what its brief's memory gave it
//     [chart]                                reads the CSV attached (from the brief's list of files,
//                                            when it may read it) and sends back chart.svg
//     [long]                                 answers at length (over 5,000 characters)
//     [quote <name>]                         quotes <name> in its folder word for word
//     [agents]                               says what its brief says your agents are doing
//   claude ... "Your brief is in <file>. ..."   the brief in a file (Windows): read, when it may
//                                            read that file (its folder or one --add-dir gave it),
//                                            then taken as above
//                                            Before any of that, in a folder Claude Code doesn't trust
//                                            (~/.claude.json, the folder or one it's in), it asks
//                                            whether to, as Claude Code 2.1.3 draws it ("No, exit"
//                                            first, no numbers): Down and Enter trust it and go on,
//                                            Enter on No ends it. And by what the question says:
//     [signin]                               shows its sign-in screen instead, and stays there
//     [stuck]                                asks for permission to write a file, and stays there
//   claude --resume <id> --fork-session --session-id <new> "<brief>"   a copy of a conversation:
//                                            <id>'s, then the brief as above
//   --model <m>, --effort <level>, --permission-mode <mode>, --tools <list>, --add-dir <dirs...>,
//   --mcp-config <files...>, --disallowedTools <list>, --strict-mcp-config   taken, as Claude Code
//                                            takes them
//   --setting-sources <list>, --settings <file or JSON>   its settings, as Claude Code loads them:
//                                            your own (user: ~/.claude/settings.json) and its folder's
//                                            (project: .claude/settings.json; local:
//                                            .claude/settings.local.json), the ones the list names
//                                            (all three without it), and --settings always. What they
//                                            say holds: permissions.deny rules for Read refuse
//                                            [try-read] there, permissions.allow rules for Read (Read, or
//                                            Read(<path>) ending /** for all in it) let [try-read]
//                                            read outside its folders under dontAsk, as do the
//                                            folders permissions.additionalDirectories adds, unless
//                                            permissions.blockReadsOutsideWorkingDirectories says no;
//                                            the commands of their SessionStart hooks run as it
//                                            starts (its folder trusted), and their PreToolUse hooks
//                                            before each edit (above). The files it loaded go in its
//                                            line in ~/helpers-started.log (settings), with what
//                                            --settings gave it (given: the file's JSON as it read it)
//   claude --version                         2.1.312, or what ~/claude-version says
//   claude --resume <id> ... ["<turn>"]      a bot's session started again where it left off: its
//                                            conversation goes on in the same file, and the turn it's
//                                            given (if any) is answered as a typed one is. Each in
//                                            ~/resumes.log ({ id, cwd, args, message })
//   A bot's session's later turns, typed in (or "Your next message is in <file>. Read it first…"):
//   answered as its brief is, by what their question blocks say; an answer it asked another bot
//   for (----- answer from <bot> -----) is said back ("<bot> says: …"). And:
//     [push <title>]                         asks for a push with its request_push tool (bridge_session,
//                                            as [make] calls bridge_outbox's: only when --allowedTools
//                                            lets it), else says it couldn't
//     [hand-to <bot> <note>], [ask-bot <bot> <question>]   a Chief's hand_to and ask_bot, the same
//                                            way (ask-bot not again once the answer has come)
//     [run <command>]                        runs a command with Bash: only when --tools lets it and the
//                                            settings it loaded have sandbox.enabled, failIfUnavailable
//                                            and allowUnsandboxedCommands false; its PreToolUse hooks
//                                            (matcher Bash) first, as Claude Code runs them; nothing
//                                            is really run
//     [run-write <name> <text>]              a command that writes <name> in its folder, the same way
//                                            (as a command would: not through its edit hooks)
//     [fetch <host>]                         a command reaching <host>: only when its sandbox's
//                                            network.allowedDomains has it (strictAllowlist: else
//                                            refused)
//     Each in ~/answer-tries.log (run, run-write, fetch, push, hand, ask).
//   Esc while it works interrupts it: no answer, back at its prompt (each in ~/interrupts.log).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const args = process.argv.slice(2)
// (Its version: 2.1.312, or what ~/claude-version says, for a test of an older one.)
if (args.includes('--version')) {
  let v = '2.1.312'
  try { v = fs.readFileSync(path.join(os.homedir(), 'claude-version'), 'utf8').trim() || v } catch { /* none: its own */ }
  console.log(`${v} (Claude Code)`)
  process.exit(0)
}
// Signed in with a Max plan (BRIDGE_STANDIN_CLAUDE_PLAN: another, team say).
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: process.env.BRIDGE_STANDIN_CLAUDE_PLAN || 'max' })); process.exit(0) }
const WITH_VALUE = new Set(['--session-id', '--resume', '--model', '--permission-mode', '--effort', '--tools', '--setting-sources', '--settings'])
// (--allowedTools, like --add-dir, takes a list.)
const allowed = []
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
// --add-dir takes folders until the next flag; anything else that isn't a flag or a flag's value is
// the opening message.
const added = []
const configs = []
let message = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--add-dir') { while (args[i + 1] && !args[i + 1].startsWith('--')) added.push(args[++i]); continue }
  if (args[i] === '--mcp-config') { while (args[i + 1] && !args[i + 1].startsWith('--')) configs.push(args[++i]); continue }
  if (args[i] === '--disallowedTools') { while (args[i + 1] && !args[i + 1].startsWith('--')) i++; continue }
  if (args[i] === '--allowedTools') { while (args[i + 1] && !args[i + 1].startsWith('--')) allowed.push(args[++i]); continue }
  if (WITH_VALUE.has(args[i])) { i++; continue }
  if (!args[i].startsWith('--') && !message) message = args[i]
}
// The brief in a file it's pointed to: read when it may (its folder, or a folder --add-dir gave it).
const pointed = /^Your (?:brief|next message) is in (.+?\.md)\. Read it first/.exec(message)
if (pointed) {
  const f = pointed[1]
  const ok = [process.cwd(), ...added].some((d) => path.resolve(f).startsWith(path.resolve(d) + path.sep))
  try { if (ok) message = fs.readFileSync(f, 'utf8') } catch { /* not there */ }
}
const id = (args.includes('--fork-session') ? opt('--session-id') : opt('--resume')) || opt('--session-id') || `s-${process.pid}`
const home = os.homedir()
const note = (file, o) => fs.appendFileSync(path.join(home, file), JSON.stringify(o) + '\n')
// (Started again in its own conversation: a bot's session, after its pane was closed.)
if (opt('--resume') && !args.includes('--fork-session')) note('resumes.log', { id, cwd: process.cwd(), args, message })
// (And any Slack token it was given in its environment, by name: there should never be one.)
const secrets = Object.entries(process.env).filter(([, v]) => /^(xox[abp]|xapp)-|^dtest\.|^teams-secret/.test(String(v))).map(([k]) => k)
// Its settings: the sources --setting-sources names (all three without it), and --settings.
const sources = opt('--setting-sources') == null ? ['user', 'project', 'local'] : opt('--setting-sources').split(',').map((x) => x.trim())
const flagSettings = opt('--settings')
const loaded = [
  ...(sources.includes('user') ? [path.join(home, '.claude', 'settings.json')] : []),
  ...(sources.includes('project') ? [path.join(process.cwd(), '.claude', 'settings.json')] : []),
  ...(sources.includes('local') ? [path.join(process.cwd(), '.claude', 'settings.local.json')] : []),
  ...(flagSettings ? [flagSettings] : []),
].map((f) => { try { return { file: f, s: JSON.parse(f.trim().startsWith('{') ? f : fs.readFileSync(f, 'utf8')) } } catch { return null } }).filter(Boolean)
const readRules = loaded.flatMap((x) => x.s.permissions?.allow || []).map(String).filter((r) => /^Read(\(.*\))?$/.test(r))
const moreDirs = loaded.flatMap((x) => x.s.permissions?.additionalDirectories || []).map((d) => path.resolve(String(d).replace(/^~(?=$|[\\/])/, home)))
const blockOutside = loaded.some((x) => x.s.permissions?.blockReadsOutsideWorkingDirectories === true)
// (A Read rule: Read for anything, or Read(<path>): //<absolute>, ~/<in your home>, ending /** for all in it.)
const ruleAllows = (rule, p) => {
  const m = /^Read\((.*)\)$/.exec(rule)
  if (!m) return true
  let at = m[1].replace(/\\/g, '/')
  const all = at.endsWith('/**')
  if (all) at = at.slice(0, -3)
  at = at.startsWith('//') ? path.resolve(process.platform === 'win32' ? at.slice(2) : at.slice(1)) : at.startsWith('~/') || at === '~' ? path.join(home, at.slice(2)) : path.resolve(at)
  return p === at || (all && p.startsWith(at + path.sep))
}
// Their Read rules (permissions.deny, Read(//<absolute path pattern>), from each it loaded:
// --settings among them), as Claude Code holds a read to them: gitignore-style, ** any folders, *
// within a name, ? one character, [] a class.
const globRe = (g) => {
  let s = ''
  for (let i = 0; i < g.length; i++) {
    if (g.startsWith('/**/', i)) { s += '/(?:.*/)?'; i += 3; continue }
    if (g.startsWith('/**', i) && i + 3 === g.length) { s += '/.*'; i += 2; continue }
    const c = g[i]
    if (c === '*') s += '[^/]*'
    else if (c === '?') s += '[^/]'
    else if (c === '[' && g.indexOf(']', i) > i) { const j = g.indexOf(']', i); s += g.slice(i, j + 1); i = j } else s += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  return new RegExp(`^/${s}$`)
}
const denyRules = loaded.flatMap((x) => x.s.permissions?.deny || []).map((r) => /^Read\(\/\/(.+)\)$/.exec(String(r))?.[1]).filter(Boolean).map(globRe)
const denied = (p) => { const f = path.resolve(p).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:'); return denyRules.some((re) => re.test(f.startsWith('/') ? f : `/${f}`)) }
// (What --settings gave it, as it read it: the run's file goes once the run has, so it's kept here.)
const given = flagSettings ? loaded.findLast((x) => x.file === flagSettings)?.s || null : null
// (The names in its environment that hold a key, or set its temporary folder, git's settings or the
// credential scrub, with those values that aren't keys: what a bot's agent is started with.)
const envSaid = Object.fromEntries(Object.keys(process.env).filter((k) => /KEY|TOKEN|SECRET|PASSWORD|SCRUB|TMPDIR|GIT_CONFIG|SESSION_MARK/.test(k)).map((k) => [k, /KEY|TOKEN|SECRET|PASSWORD/.test(k) ? '(set)' : process.env[k]]))
if (message) note('helpers-started.log', { args, cwd: process.cwd(), message, secrets, settings: loaded.map((x) => x.file), given, env: envSaid, ...(pointed ? { briefFile: pointed[1] } : {}) })
// (On Windows, a run that changes files: whether it has Windows' backup and restore rights on, which
// make a file past any folder's access list, in ~/rights.log, each as whoami says it, beside the
// state of one everyone has on.)
if (message && process.platform === 'win32' && allowed.some((x) => /^Edit\(\.\/\*\*\)$/.test(x))) {
  const r = require('node:child_process').spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), ['/priv', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true })
  const rows = String(r.stdout || '').split(/\r?\n/).map((l) => l.trim().replace(/^"|"$/g, '').split('","'))
  const state = (n) => rows.find((c) => c[0] === n)?.[2] || null
  note('rights.log', { cwd: process.cwd(), backup: state('SeBackupPrivilege'), restore: state('SeRestorePrivilege'), on: state('SeChangeNotifyPrivilege') })
}
// Their SessionStart hooks' commands, run as it starts (once its folder is trusted, as Claude Code holds them till then).
const sessionStart = () => {
  for (const x of loaded) {
    for (const group of x.s.hooks?.SessionStart || []) {
      for (const hook of group.hooks || []) {
        if (hook.type === 'command' && hook.command) { try { require('node:child_process').execSync(hook.command, { stdio: 'ignore', timeout: 10000 }) } catch { /* it failed */ } }
      }
    }
  }
}
if (/\[exit\]/.test(message)) process.exit(0)

// Its conversation, where Bridge AI reads Claude Code's.
const project = path.join(home, '.claude', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'))
fs.mkdirSync(project, { recursive: true })
// A copy of another conversation (--fork-session): that one's lines first, under this one's id.
const forked = args.includes('--fork-session') && opt('--resume')
if (forked && forked !== id) {
  try {
    const was = fs.readFileSync(path.join(project, `${forked}.jsonl`), 'utf8').split('\n').filter(Boolean)
    fs.writeFileSync(path.join(project, `${id}.jsonl`), was.map((l) => JSON.stringify({ ...JSON.parse(l), sessionId: id })).join('\n') + '\n')
  } catch { /* nothing to copy */ }
}
const log = fs.openSync(path.join(project, `${id}.jsonl`), 'a')
// (Gone on with: its conversation carries on from its last message, as Claude Code's does.)
let prev = (() => { try { const l = fs.readFileSync(path.join(project, `${id}.jsonl`), 'utf8').trim().split('\n').pop(); return JSON.parse(l).uuid || null } catch { return null } })()
// (Its brief, as its conversation began: what a later turn goes on with, as the agent remembers it.)
const opening = (() => { try { const l = fs.readFileSync(path.join(project, `${id}.jsonl`), 'utf8').split('\n').find((x) => x.includes('"type":"user"')); const c = JSON.parse(l).message?.content; return typeof c === 'string' ? c : '' } catch { return '' } })() || message
const w = (o) => {
  const e = { sessionId: id, cwd: process.cwd(), uuid: `h-${Math.random().toString(36).slice(2)}`, parentUuid: prev, timestamp: new Date().toISOString(), ...o }
  prev = e.uuid
  fs.writeSync(log, JSON.stringify(e) + '\n')
}
const user = (text) => w({ type: 'user', message: { role: 'user', content: text } })
const reply = (text) => w({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const tool = (name, input) => w({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2, 8)}`, name, input }] } })

const rule = '─'.repeat(60)
let state = 'idle' // idle | working | asking | trust | signin
let pick = 0 // the trust screen's answer under the pointer: 0 No, 1 Yes
const trustRows = () => [' Accessing workspace:', '', ` ${process.cwd()}`, '', ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open', ' source project, or work from your team). If not, take a moment to review what\'s in this folder first.', '', ' Claude Code\'ll be able to read, edit, and execute files here.', '', ` ${pick === 0 ? '❯' : ' '} No, exit`, ` ${pick === 1 ? '❯' : ' '} Yes, I trust this folder`, '', ' Enter to confirm · Esc to cancel']
const signinRows = () => [' Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.', '', ' Select login method:', '', ' ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise', '', '   2. Anthropic Console account · API usage billing', '']
let said = 'Ready.'
let began = 0
const draw = () => {
  const head = state === 'trust' ? trustRows() : state === 'signin' ? signinRows() : state === 'asking'
    ? ['✻ Brewed for 2s', '', rule, ' Create file', '', `   ${file}`, '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, allow all edits during this session (shift+tab)', '   3. No, and tell Claude what to do differently (esc)']
    : [`⏺ ${said}`, '', state === 'working' ? `✻ Pondering… (${Math.round((Date.now() - began) / 1000)}s · esc to interrupt)` : '✻ Brewed for 3s', rule, '❯ \x1b[7m \x1b[27m', rule, '  ⏵⏵ auto mode on']
  process.stdout.write(`\x1b[2J\x1b[H${'\r\n'.repeat(Math.max(0, (process.stdout.rows || 24) - head.length - 1))}${head.join('\r\n')}`)
}
setInterval(() => { if (state === 'working') draw() }, 1000)

const secs = Number((/\[work (\d+)\]/.exec(message) || [])[1] || 2)
const file = (/\[file ([\w.-]+)\]/.exec(message) || [])[1] || 'result.md'
const hold = (/\[hold ([\w-]+)\]/.exec(message) || [])[1] || null

// A turn: working, then its answer and done. made: the file it writes first, if any.
function turn(text, answer, ms, made) {
  user(text)
  state = 'working'
  began = Date.now()
  draw()
  const finish = () => {
    if (made) {
      tool('Write', { file_path: path.join(process.cwd(), made), content: 'The work.' })
      fs.writeFileSync(path.join(process.cwd(), made), `# ${made}\n\nWhat the brief asked for.\n`)
    }
    said = answer
    reply(answer)
    state = 'idle'
    draw()
  }
  if (!hold || !made) return setTimeout(finish, ms)
  tool('Read', { file_path: 'notes.md' })
  const go = path.join(home, `release-${hold}`)
  const look = setInterval(() => { if (fs.existsSync(go)) { clearInterval(look); finish() } }, 200)
}

// Its PreToolUse hooks, from the settings it loaded (above: --settings, a file or JSON, among them),
// as Claude Code runs them: each one whose matcher takes the tool, with the tool call on stdin; exit
// 2 refuses it, its stderr the reason. One with args (exec form) is started as it is, with no shell;
// any other through a shell: sh on a Mac and Linux; on Windows Git Bash (CLAUDE_CODE_GIT_BASH_PATH,
// or the bash beside git on the PATH), else PowerShell, or PowerShell when its shell says so. None
// with disableAllHooks (as the last of them to say it has it: --settings over your own).
const hooks = (() => {
  const off = loaded.map((x) => x.s.disableAllHooks).filter((v) => typeof v === 'boolean').at(-1)
  return off === true ? [] : loaded.flatMap((x) => x.s.hooks?.PreToolUse || [])
})()
const gitBash = () => {
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) return process.env.CLAUDE_CODE_GIT_BASH_PATH
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    if (!d || !fs.existsSync(path.join(d, 'git.exe'))) continue
    const bash = path.join(d, '..', 'bin', 'bash.exe')
    if (fs.existsSync(bash)) return bash
  }
  return null
}
function hookRun(h, input) {
  const { spawnSync } = require('node:child_process')
  const o = { input, encoding: 'utf8', timeout: (h.timeout || 60) * 1000, windowsHide: true }
  if (Array.isArray(h.args)) return spawnSync(h.command, h.args.map(String), o)
  if (process.platform !== 'win32') return spawnSync('/bin/sh', ['-c', h.command], o)
  const bash = h.shell === 'powershell' ? null : gitBash()
  return bash ? spawnSync(bash, ['-c', h.command], o) : spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', h.command], o)
}
function preTool(name, input) {
  for (const m of hooks) {
    if (m.matcher && !new RegExp(`^(?:${m.matcher})$`).test(name)) continue
    for (const h of m.hooks || []) {
      if (h.type !== 'command') continue
      const r = hookRun(h, JSON.stringify({ hook_event_name: 'PreToolUse', session_id: id, cwd: process.cwd(), tool_name: name, tool_input: input }))
      const why = String(r.stderr || '').trim()
      // (Its command too, and its arguments: Claude Code may quote them back to the agent when it
      // refuses.)
      note('hooks.log', { tool: name, path: input.file_path || null, status: r.status, why: why.slice(0, 300), command: String(h.command).slice(0, 4000), ...(Array.isArray(h.args) ? { args: h.args.map(String) } : {}), ...(r.error ? { error: r.error.code || r.error.message } : {}) })
      if (r.status === 2) return { ok: false, why }
    }
  }
  return { ok: true }
}

// An answer for the Slack Bot: what it can do is what it was started with. (A session's later turns
// have no instructions of their own: its brief's hold.)
let firstTold = null
let timer = null
function answerTurn(text) {
  // (On Windows its lines come as one, joined by " · ": runtime/spawn.js forCommandLine. Every
  // question block its brief has, as one: what someone added while it worked is asked of it too.)
  const q = [...text.matchAll(/----- question from.*? -----(?:\n| · )([\s\S]*?)(?:\n| · )----- end of question -----/g)].map((m) => m[1]).join('\n')
  const told = (/----- instructions -----(?:\n| · )([\s\S]*?)(?:\n| · )----- end of instructions -----/.exec(text) || /----- instructions -----(?:\n| · )([\s\S]*?)(?:\n| · )----- end of instructions -----/.exec(opening) || [])[1] || firstTold || ''
  if (firstTold == null) firstTold = told
  const answered = (/----- answer from (.+?) -----(?:\n| · )([\s\S]*?)(?:\n| · )----- end of answer -----/.exec(text) || null)
  const sign = (/\[sign ([^\]]+)\]/.exec(told) || [])[1] || null
  const tools = opt('--tools')
  const can = (t) => tools == null || tools.split(',').map((x) => x.trim()).includes(t)
  const dontAsk = opt('--permission-mode') === 'dontAsk'
  const tried = (what, done, more = {}) => note('answer-tries.log', { try: what, done, cwd: process.cwd(), ...more })
  user(text)
  state = 'working'
  began = Date.now()
  draw()
  // (How long it takes is the question's to say: a [work] in the conversation around it isn't. Picked
  // up after its time limit, its brief says so, and [then] says how long it takes from there.)
  const again = /reached your time limit after/.test(text) && /\[then (\d+)\]/.exec(q)
  const wait = again ? Number(again[1]) : Number((/\[work (\d+)\]/.exec(q) || [])[1] || 2)
  // Files to send back: only through its MCP server bridge_outbox's save_file, as Claude Code would
  // call it, the server started as its config says and asked over stdin and stdout.
  const outboxServer = (() => { for (const c of configs) { try { const x = JSON.parse(fs.readFileSync(c, 'utf8')).mcpServers?.bridge_outbox; if (x) return x } catch { /* unreadable */ } } return null })()
  const mayMake = !!outboxServer && args.includes('--strict-mcp-config') && allowed.includes('mcp__bridge_outbox__save_file')
  const mayAttach = !!outboxServer && args.includes('--strict-mcp-config') && allowed.includes('mcp__bridge_outbox__attach_file')
  // Its session's own server (bridge_session): a push asked for, a Chief's hand_to and ask_bot.
  const sessionServer = (() => { for (const c of configs) { try { const x = JSON.parse(fs.readFileSync(c, 'utf8')).mcpServers?.bridge_session; if (x) return x } catch { /* unreadable */ } } return null })()
  const callSession = (name, input) => {
    if (!sessionServer || !args.includes('--strict-mcp-config') || !allowed.includes(`mcp__bridge_session__${name}`)) return { ok: false, text: 'I have no tool for it' }
    const asks = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.312' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: input } },
    ]
    const r = require('node:child_process').spawnSync(sessionServer.command, sessionServer.args || [], { input: asks.map((x) => JSON.stringify(x)).join('\n') + '\n', env: { ...process.env, ...(sessionServer.env || {}) }, encoding: 'utf8', timeout: 20000 })
    const said = String(r.stdout || '').split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).find((x) => x?.id === 2)
    tool(`mcp__bridge_session__${name}`, input)
    return { ok: !!said?.result && !said.result.isError, text: said?.result?.content?.[0]?.text || said?.error?.message || r.error?.message || 'no answer' }
  }
  // Its sandbox, as the settings it loaded have it (the last that says).
  const sandbox = loaded.map((x) => x.s.sandbox).filter(Boolean).at(-1) || null
  const sandboxed = !!sandbox && sandbox.enabled === true && sandbox.failIfUnavailable === true && sandbox.allowUnsandboxedCommands === false
  // (Run, in dontAsk, only by the sandbox's auto-allow or a Bash allow rule: code.claude.com/docs/en/sandboxing.)
  const allowedArg = (() => { const i = args.indexOf('--allowedTools'); return i >= 0 ? args.slice(i + 1).filter((x, k, a) => !a.slice(0, k + 1).some((y) => y.startsWith('--'))) : [] })()
  const mayRun = can('Bash') && sandboxed && (sandbox.autoAllowBashIfSandboxed === true || allowedArg.some((x) => /^Bash(\(|$)/.test(x)))
  // One of its tools called, as Claude Code calls one: { ok, text }.
  const callOutbox = (name, input) => {
    const asks = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.312' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: input } },
    ]
    const r = require('node:child_process').spawnSync(outboxServer.command, outboxServer.args || [], { input: asks.map((x) => JSON.stringify(x)).join('\n') + '\n', env: { ...process.env, ...(outboxServer.env || {}) }, encoding: 'utf8', timeout: 20000, maxBuffer: 1 << 20 })
    const said = String(r.stdout || '').split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).find((x) => x?.id === 2)
    return { ok: !!(said?.result && !said.result.isError), text: said?.result?.content?.[0]?.text || said?.error?.message || r.error?.message || 'no answer' }
  }
  const makeTo = (out) => (name, body) => {
    if (!mayMake) { tried('make', false); out.push(`I couldn't save ${name}: I have no tool for it.`); return }
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
    const r = callOutbox('save_file', { name, content: buf.toString('base64'), base64: true })
    tool('mcp__bridge_outbox__save_file', { name })
    tried('make', r.ok)
    out.push(r.ok ? `I made ${name}.` : `I couldn't save ${name}: ${r.text}.`)
  }
  const attachTo = (out) => (p) => {
    const name = path.basename(p)
    if (!mayAttach) { tried('attach', false); out.push(`I couldn't attach ${name}: I have no tool for it.`); return }
    const r = callOutbox('attach_file', { path: p })
    tool('mcp__bridge_outbox__attach_file', { path: p })
    tried('attach', r.ok)
    if (r.ok) out.push(`I attached ${name}.`)
    else if (!/no need to say it again/.test(r.text)) out.push(`I couldn't attach ${name}: ${r.text}`)
  }
  // ([make-early]: saved at once, before it works, so a run stopped at its time limit has saved it
  // already; not again once it's picked up.)
  const early = []
  if (!again) for (const m of q.matchAll(/\[make-early ([^\s\]]+)(?: ([^\]]+))?\]/g)) makeTo(early)(m[1], `${m[2] || `The ${m[1]} you asked for.`}\n`)
  timer = setTimeout(() => {
    timer = null
    const out = [...early]
    if (answered) out.push(`${answered[1]} says: ${answered[2].replace(/\n| · /g, ' ').trim()}`)
    for (const m of q.matchAll(/\[push ([^\]]+)\]/g)) { const r = callSession('request_push', { title: m[1].trim(), summary: 'What I changed.' }); tried('push', r.ok); out.push(r.ok ? `I asked to push "${m[1].trim()}".` : `I couldn't ask to push: ${r.text}.`) }
    for (const m of q.matchAll(/\[hand-to ([\w-]+)(?: ([^\]]+))?\]/g)) { const r = callSession('hand_to', { bot: m[1].replace(/-/g, ' '), note: m[2] || '' }); tried('hand', r.ok); out.push(r.ok ? `I've handed this to ${m[1].replace(/-/g, ' ')}.` : `I couldn't hand it on: ${r.text}.`) }
    if (!answered) for (const m of q.matchAll(/\[ask-bot ([\w-]+) ([^\]]+)\]/g)) { const r = callSession('ask_bot', { bot: m[1].replace(/-/g, ' '), question: m[2] }); tried('ask', r.ok); out.push(r.ok ? `I've asked ${m[1].replace(/-/g, ' ')}.` : `I couldn't ask it: ${r.text}.`) }
    // Commands: Bash, in its sandbox, its hooks first; nothing really run.
    const runs = [...q.matchAll(/\[run ([^\]]+)\]/g)].map((m) => ({ cmd: m[1], kind: 'run' }))
      .concat([...q.matchAll(/\[run-write ([\w./-]+) ([^\]]+)\]/g)].map((m) => ({ cmd: `printf '%s\\n' '${m[2]}' > ${m[1]}`, kind: 'run-write', name: m[1], body: m[2] })))
      .concat([...q.matchAll(/\[fetch ([\w.-]+)\]/g)].map((m) => ({ cmd: `curl -s https://${m[1]}/`, kind: 'fetch', host: m[1] })))
    for (const r of runs) {
      if (!mayRun) { tried(r.kind, false, { command: r.cmd, why: can('Bash') ? 'no sandbox' : 'no Bash' }); out.push(`I can't run commands here.`); continue }
      const h = preTool('Bash', { command: r.cmd })
      if (!h.ok) { tried(r.kind, false, { command: r.cmd, why: h.why.slice(0, 300) }); out.push(`I couldn't run it: ${h.why.split('\n')[0]}`); continue }
      tool('Bash', { command: r.cmd })
      if (r.kind === 'fetch') {
        const ok = (sandbox.network?.allowedDomains || []).some((d) => d === r.host || (d.startsWith('*.') && r.host.endsWith(d.slice(1))))
        tried('fetch', ok, { command: r.cmd, host: r.host })
        out.push(ok ? `I reached ${r.host}.` : `I couldn't reach ${r.host}: the sandbox refused it.`)
        continue
      }
      if (r.kind === 'run-write') {
        const f = path.resolve(process.cwd(), r.name)
        const deny = (sandbox.filesystem?.denyWrite || []).some((d) => f === d || f.startsWith(d + path.sep))
        if (deny) { tried('run-write', false, { command: r.cmd, why: 'sandbox' }); out.push(`I couldn't write ${r.name}: the sandbox refused it.`); continue }
        try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${r.body}\n`) } catch (e) { tried('run-write', false, { command: r.cmd, why: e.code }); out.push(`I couldn't write ${r.name}: ${e.code}.`); continue }
        tried('run-write', true, { command: r.cmd })
        out.push(`I ran a command that wrote ${r.name}.`)
        continue
      }
      tried('run', true, { command: r.cmd })
      out.push(`I ran ${r.cmd}.`)
    }
    for (const f of fs.readdirSync(process.cwd()).filter((x) => /\.(md|txt)$/.test(x)).slice(0, 3)) tool('Read', { file_path: path.join(process.cwd(), f) })
    const w = /\[try-write ([\w.-]+)\]/.exec(q)
    if (w) {
      // (Its folder isn't one it may write in without asking, unless it's allowed there: dontAsk refuses.)
      const mayHere = can('Write') && (!dontAsk || allowed.some((x) => /^Edit\(\.\/\*\*\)$/.test(x)))
      if (mayHere) { tool('Write', { file_path: path.join(process.cwd(), w[1]) }); fs.writeFileSync(path.join(process.cwd(), w[1]), 'Written.\n'); tried('write', true); out.push(`I wrote ${w[1]}.`) } else { tried('write', false); out.push(can('Write') ? `I can't write ${w[1]}: writing there was refused.` : `I can't write ${w[1]}: I have no tool that writes files.`) }
    }
    if (/\[try-run\]/.test(q)) {
      if (mayRun) { fs.writeFileSync(path.join(process.cwd(), 'ran.txt'), ''); tried('run', true); out.push('I ran it.') } else { tried('run', false); out.push('I can\'t run commands here.') }
    }
    for (const r of q.matchAll(/\[try-read ([^\]]+)\]/g)) {
      const want = path.resolve(r[1].replace(/^~/, home))
      const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }
      const here = [process.cwd(), ...added, ...moreDirs].some((d) => want.startsWith(d + path.sep) || real(want).startsWith(real(d) + path.sep))
      // (Outside them: refused under dontAsk unless an allow rule lets it, and always when blockReadsOutsideWorkingDirectories says so;
      // and anywhere, what a Read rule its settings deny.)
      const ruled = readRules.some((x) => ruleAllows(x, want) || ruleAllows(x, real(want)))
      if (!can('Read') || (!here && (blockOutside || (dontAsk && !ruled)))) { tried('read', false, { path: r[1] }); out.push(`I couldn't read ${r[1]}: reading outside my folders was refused.`) } else if (denied(want)) { tried('read', false, { path: r[1], rule: true }); out.push(`I couldn't read ${r[1]}: a rule in my settings refused it.`) } else { let c = ''; try { c = fs.readFileSync(want, 'utf8').trim() } catch { /* none */ } tool('Read', { file_path: want }); tried('read', true, { path: r[1] }); out.push(`It says: ${c}`) }
    }
    // Edits: only in its folder, and only when it was started able to (a bot's change), and only
    // what its hooks let through.
    const editsHere = can('Edit') && can('Write') && allowed.some((x) => /^Edit\(\.\/\*\*\)$/.test(x))
    const write = (f, body, label, kind) => {
      const h = preTool('Write', { file_path: f, content: body })
      if (!h.ok) { tried(kind, false); out.push(`I couldn't write ${label}: ${h.why.split('\n')[0]}`); return }
      // (One the file system refuses, as Claude Code's Write says: on Windows, git's hidden .git file.)
      try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body) } catch (e) { tried(kind, false); out.push(`I couldn't write ${label}: ${e.code || e.message}.`); return }
      tool('Write', { file_path: f })
      tried(kind, true)
      out.push(`I changed ${label}.`)
    }
    for (const m of q.matchAll(/\[edit ([\w./-]+) ([^\]]+)\]/g)) {
      const f = path.resolve(process.cwd(), m[1])
      if (editsHere && f.startsWith(process.cwd() + path.sep)) write(f, `${m[2]}\n`, m[1], 'edit')
      else { tried('edit', false); out.push(`I can't change ${m[1]} here.`) }
    }
    for (const m of q.matchAll(/\[edit-outside ([^\s\]]+) ([^\]]+)\]/g)) {
      const f = path.resolve(m[1].replace(/^~/, home))
      const inHere = f.startsWith(process.cwd() + path.sep)
      if (can('Edit') && (!dontAsk || (inHere && editsHere))) { fs.writeFileSync(f, `${m[2]}\n`); tried('edit-outside', true); out.push(`I wrote ${m[1]}.`) } else { tried('edit-outside', false); out.push(`I couldn't write ${m[1]}: that was refused.`) }
    }
    // (As if its hook never ran: written whatever its checks would say.)
    for (const m of q.matchAll(/\[force-write ([^\s\]]+) ([^\]]+)\]/g)) {
      const f = path.resolve(process.cwd(), m[1])
      try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${m[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\{\{/g, '[').replace(/\}\}/g, ']')}\n`); tried('force-write', true); out.push(`I wrote ${m[1]}.`) } catch (e) { tried('force-write', false); out.push(`I couldn't write ${m[1]}: ${e.code || e.message}.`) }
    }
    // (As if your own settings allowed every edit: its hooks are all that stand in the way.)
    for (const m of q.matchAll(/\[edit-anywhere ([^\s\]]+) ([^\]]+)\]/g)) write(path.resolve(process.cwd(), m[1].replace(/^~/, home)), `${m[2]}\n`, m[1], 'edit-anywhere')
    for (const m of q.matchAll(/\[edit-lines ([\w./-]+) (\d+)\]/g)) {
      const f = path.resolve(process.cwd(), m[1])
      if (editsHere && f.startsWith(process.cwd() + path.sep)) write(f, Array.from({ length: Number(m[2]) }, (_, i) => `row ${i}`).join('\n'), m[1], 'edit')
    }
    const many = /\[edit-many (\d+)(?: ([\w./-]+))?\]/.exec(q)
    if (many && editsHere) for (let i = 1; i <= Number(many[1]); i++) write(path.join(process.cwd(), many[2] || 'many', `${i}.md`), `File ${i}\n`, `${many[2] || 'many'}/${i}.md`, 'edit')
    // Deleting and moving: only with bridge_files's tools, as Claude Code calls an MCP server's.
    const fileTool = (tl, a) => {
      const srv = (() => { for (const c of configs) { try { const x = JSON.parse(fs.readFileSync(c, 'utf8')).mcpServers?.bridge_files; if (x) return x } catch { /* unreadable */ } } return null })()
      if (!srv || !args.includes('--strict-mcp-config') || !allowed.includes(`mcp__bridge_files__${tl}`)) return { ok: false, text: 'I have no tool for it' }
      const asks = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.312' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tl, arguments: a } },
      ]
      const r = require('node:child_process').spawnSync(srv.command, srv.args || [], { input: asks.map((x) => JSON.stringify(x)).join('\n') + '\n', env: { ...process.env, ...(srv.env || {}) }, encoding: 'utf8', timeout: 20000 })
      const said = String(r.stdout || '').split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).find((x) => x?.id === 2)
      tool(`mcp__bridge_files__${tl}`, a)
      return { ok: !!said?.result && !said.result.isError, text: said?.result?.content?.[0]?.text || said?.error?.message || 'no answer' }
    }
    for (const m of q.matchAll(/\[delete ([^\s\]]+)\]/g)) { const r = fileTool('delete_file', { path: m[1] }); tried('delete', r.ok); out.push(r.ok ? `I deleted ${m[1]}.` : `I couldn't delete ${m[1]}: ${r.text}.`) }
    for (const m of q.matchAll(/\[move ([^\s\]]+) ([^\s\]]+)\]/g)) { const r = fileTool('move_file', { from: m[1], to: m[2] }); tried('move', r.ok); out.push(r.ok ? `I moved ${m[1]} to ${m[2]}.` : `I couldn't move ${m[1]}: ${r.text}.`) }
    const make = makeTo(out)
    for (const m of q.matchAll(/\[make ([^\s\]]+)(?: ([^\]]+))?\]/g)) make(m[1], `${m[2] || `The ${m[1]} you asked for.`}\n`)
    for (const m of q.matchAll(/\[make-exe ([^\s\]]+)\]/g)) make(m[1], Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62, 1)]))
    for (const m of q.matchAll(/\[make-script ([^\s\]]+)\]/g)) make(m[1], '#!/bin/sh\necho hello\n')
    for (const m of q.matchAll(/\[make-big ([^\s\]]+) (\d+)\]/g)) make(m[1], Buffer.alloc(Number(m[2]) * 1024 * 1024, 65))
    const attach = attachTo(out)
    for (const m of q.matchAll(/\[attach ([^\]]+)\]/g)) attach(m[1].trim())
    const attachLines = [...q.matchAll(/\[attach-line ([^\]]+)\]/g)].map((m) => `ATTACH: ${m[1].trim()}`)
    const memo = (/----- memory -----(?:\n| · )([\s\S]*?)(?:\n| · )----- end of memory -----/.exec(text) || [])[1] || ''
    if (/\[recall\]/.test(q)) out.push(memo ? `I remember: ${memo.replace(/\n| · /g, ' ').trim()}` : 'I remember nothing.')
    if (/\[agents\]/.test(q)) out.push((/What .*?'s agents are doing now[^\n]*\n((?:- .*\n?)*)/.exec(text) || [])[1]?.trim().replace(/\n/g, ' ') || 'No agents said.')
    const quote = /\[quote ([\w./-]+)\]/.exec(q)
    if (quote) { const f = path.join(process.cwd(), quote[1]); try { const c = fs.readFileSync(f, 'utf8').replace(/^#.*$/m, '').trim(); tool('Read', { file_path: f }); out.push(`It says: "${c}"`) } catch { out.push('There is no such file.') } }
    const files = []
    if (/\[chart\]/.test(q)) {
      const csv = (/^- (\S+\.csv) \(/m.exec(text.replace(/ · /g, '\n')) || [])[1]
      const readable = csv && [process.cwd(), ...added].some((d) => path.resolve(csv).startsWith(path.resolve(d) + path.sep))
      let rows = []
      try { if (readable) { tool('Read', { file_path: csv }); rows = fs.readFileSync(csv, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')) } } catch { /* none */ }
      if (rows.length) {
        const bars = rows.map(([k, v], i) => `<rect x="${i * 30}" y="${100 - Number(v)}" width="20" height="${Number(v)}"><title>${k}</title></rect>`).join('')
        files.push(`FILE: chart.svg\n\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows.length * 30} 100">${bars}</svg>\n\`\`\``)
        out.push(`Here's the chart of ${rows.length} rows.`)
      } else out.push('I couldn\'t read the file.')
    }
    const remember = [...q.matchAll(/\[remember ([^\]]+)\]/g)].map((m) => `REMEMBER: ${m[1]}`).concat([...q.matchAll(/\[remember-me ([^\]]+)\]/g)].map((m) => `REMEMBER about ${(/----- question from (.*?) -----/.exec(text) || [])[1] || 'them'}: ${m[1]}`))
    const a = /\[answer ([^\]]+)\]/.exec(q)
    const long = /\[long\]/.test(q) ? `\n\n${Array.from({ length: 60 }, (_, i) => `Point ${i + 1}: the details of this part of the answer, said at some length.`).join('\n\n')}` : ''
    const hand = (/reply with HAND TO and that bot's name/.test(text) || /reply with HAND TO and that bot's name/.test(opening)) && /\[hand ([^\]]+)\]/.exec(q)
    const answer = hand ? `HAND TO ${hand[1]}` : /\[noanswer\]/.test(q) ? 'NO ANSWER\nNothing in this folder says.' : /\[notforme\]/.test(q) ? 'NOT FOR ME' : [[...out, a ? a[1] : 'Here is what I found.', ...(sign ? [sign] : [])].join(' ') + long, ...files, ...remember, ...(attachLines.length ? [attachLines.join('\n')] : [])].join('\n\n')
    said = answer
    reply(answer)
    state = 'idle'
    draw()
  }, wait * 1000)
}

function begin() {
  sessionStart()
  if (message && /----- question from/.test(message) && /\[signin\]/.test(message)) { state = 'signin'; draw() }
  else if (message && /----- question from/.test(message) && /\[stuck\]/.test(message)) { user(message); state = 'asking'; draw() }
  else if (message && /----- question from/.test(message)) answerTurn(message)
  else if (message && /\[ask\]/.test(message)) {
    user(message)
    state = 'asking'
    draw()
  } else if (message) turn(message, `I wrote ${file} in this folder.\n\nDone: the draft is in ${file}, ready for review.`, secs * 1000, file)
  else draw()
}
// Trusted, as Claude Code keeps it: the folder, or one it's in, in ~/.claude.json.
const CLAUDE_JSON = path.join(home, '.claude.json')
const readJson = () => { try { return JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')) } catch { return {} } }
function trusted() {
  const projects = readJson().projects || {}
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    if (projects[d]?.hasTrustDialogAccepted) return true
    if (path.dirname(d) === d) return false
  }
}
if (message && /----- question from/.test(message) && !trusted()) { state = 'trust'; draw() } else begin()

// What's typed: a key at a time, pastes bracketed, Enter sends.
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdout.write('\x1b[?2004h')
let box = ''
let pasting = false
// (A paste's end cut between two reads, as a terminal hands over a long one: its start kept for the
// next read.)
let carry = ''
const endCut = (t) => { for (let i = Math.max(0, t.length - 5); i < t.length; i++) if ('\x1b[201~'.startsWith(t.slice(i))) return i; return t.length }
process.stdin.on('data', (d) => {
  let s = carry + String(d)
  carry = ''
  if (state === 'trust') {
    for (const k of s.match(/\x1b\[[AB]|[\r\n]|\x1b|./g) || []) {
      if (k === '\x1b[B') pick = 1
      else if (k === '\x1b[A') pick = 0
      else if (k === '\x1b') process.exit(1)
      else if (k === '\r' || k === '\n') {
        if (!pick) process.exit(1)
        const j = readJson()
        j.projects = { ...(j.projects || {}), [process.cwd()]: { ...(j.projects?.[process.cwd()] || {}), hasTrustDialogAccepted: true } }
        fs.writeFileSync(CLAUDE_JSON, JSON.stringify(j, null, 2))
        note('trusted.log', { cwd: process.cwd() })
        state = 'idle'
        return begin()
      }
    }
    return draw()
  }
  if (state === 'signin') return
  if (state === 'asking') {
    if (s[0] === '1' || s[0] === '2') { state = 'idle'; turn('(allowed)', `I wrote ${file} in this folder.\n\nDone: the draft is in ${file}, ready for review.`, 1000, file) }
    return
  }
  while (s.length) {
    if (pasting) {
      const end = s.indexOf('\x1b[201~')
      if (end < 0) { const cut = endCut(s); box += s.slice(0, cut); carry = s.slice(cut); s = '' } else { box += s.slice(0, end); s = s.slice(end + 6); pasting = false }
    } else if (s.startsWith('\x1b[200~')) { pasting = true; s = s.slice(6) }
    else if (s.startsWith('\x1b[') || s.startsWith('\x1bO')) { const k = /^\x1b[[O][0-9;?]*[A-Za-z~]/.exec(s); s = s.slice(k ? k[0].length : 2) }
    else if (s[0] === '\x1b') {
      s = s.slice(1)
      // (Esc while it works: interrupted, as Claude Code is, back at its prompt with no answer.)
      if (state === 'working' && timer) { clearTimeout(timer); timer = null; user('[Request interrupted by user]'); said = 'Interrupted · What should Claude do instead?'; state = 'idle'; note('interrupts.log', { session: id, cwd: process.cwd() }); draw() }
    }
    else {
      const c = s[0]
      s = s.slice(1)
      if (c === '\r' || c === '\n') {
        let text = box.trim()
        box = ''
        if (!text) continue
        if (!message) note('chief-got.log', { session: id, text })
        // (A bot's session's next turn, or one pointed to in a file: answered as its brief was.)
        const next = /^Your next message is in (.+?\.md)\. Read it first/.exec(text)
        if (next) { try { if ([process.cwd(), ...added].some((d) => path.resolve(next[1]).startsWith(path.resolve(d) + path.sep))) text = fs.readFileSync(next[1], 'utf8') } catch { /* not there */ } }
        if (/----- question from/.test(text)) { note('turns.log', { session: id, cwd: process.cwd(), text }); answerTurn(text); continue }
        turn(text, message ? `Followed up: ${text.split('\n')[0]}` : 'Noted.', 1000, null)
      } else if (c === '\x7f' || c === '\b') box = Array.from(box).slice(0, -1).join('')
      else if (c >= ' ') box += c
    }
  }
})
setInterval(() => {}, 1 << 30)
