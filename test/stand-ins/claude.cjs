// Stand-in Claude Code: writes a session log the way Claude Code does (a subagent, shells and a
// monitor running in the background, padding between them) and draws its footer, then waits.
//   claude --version
//   claude --session-id <id> [message]      the message "screen only" writes no subagent files:
//                                           only the footer shows its subagents; "idle" draws
//                                           it done working; "limit" and "weekly limit" end it
//                                           at a usage limit (the 5-hour one carries on by itself);
//                                           "table" ends it with a reply holding a wide table,
//                                           "diagram" with one holding a Mermaid flowchart
//   claude --resume <id> [...]              the same conversation again (on another account, say):
//                                           its log as it was, done working, its message box at
//                                           the bottom under the conversation; what's typed to it
//                                           goes in ~/claude-typed.log
//   CLAUDE_STAND_IN=fresh claude [...]      waiting for its first message, the same way, and its
//                                           arguments noted in ~/claude-started.log
//   claude auth status --json | login | logout
//                                           the sign-in of the config folder it's run for
//                                           (CLAUDE_CONFIG_DIR, else ~/.claude): signed in until
//                                           logged out. Each is noted in ~/claude-auth.log, with
//                                           CLAUDE_CONFIG_DIR as it was given (null: not given)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('2.1.312 (Claude Code)'); process.exit(0) }
if (args[0] === 'auth') {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const out = path.join(dir, 'stand-in-signed-out')
  fs.appendFileSync(path.join(os.homedir(), 'claude-auth.log'), JSON.stringify({ args, dir: process.env.CLAUDE_CONFIG_DIR || null }) + '\n')
  if (args[1] === 'logout') { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(out, ''); console.log('Successfully logged out from your Anthropic account.'); process.exit(0) }
  if (args[1] === 'login') { fs.rmSync(out, { force: true }); console.log('Login successful.'); process.exit(0) }
  const signedIn = !fs.existsSync(out)
  console.log(JSON.stringify({ loggedIn: signedIn, authMethod: signedIn ? 'claude.ai' : 'none', subscriptionType: signedIn ? 'max' : null }))
  process.exit(signedIn ? 0 : 1)
}
const WITH_VALUE = new Set(['--session-id', '--resume', '--model', '--permission-mode'])
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const message = args.find((a, i) => !a.startsWith('--') && !WITH_VALUE.has(args[i - 1])) || ''
const resumed = opt('--resume')
const id = opt('--session-id') || resumed
const screenOnly = message === 'screen only'
const rule = '─'.repeat(60)
// Its screen, as Claude Code draws it: working, with its footer, or done. low: at the bottom, as
// under a conversation it resumed.
const draw = (working, low = false) => {
  process.stdout.write((low ? '\r\n'.repeat(Math.max(0, (process.stdout.rows || 24) - 8)) : '') + [
    working ? '✻ Pondering… (12s · ↓ 2.1k tokens)' : '✻ Brewed for 8s',
    rule,
    '❯ \x1b[7m \x1b[27m', // its cursor, in an empty box
    rule,
    ...(working ? [
      `  ⏵⏵ auto mode on · ${screenOnly ? 1 : 2} shells, 1 monitor`,
      '  ⏺ main',
      '  ◯ Explore  Look for rounding in billing                    11m 2s · ↓ 28.0k tokens',
    ] : ['  ⏵⏵ auto mode on (shift+tab to cycle)']),
    '',
  ].join('\r\n'))
  setInterval(() => {}, 1 << 30)
}
if (resumed) {
  // What it's sent, written down: a Windows terminal doesn't show what a program hasn't read.
  process.stdin.on('data', (d) => fs.appendFileSync(path.join(os.homedir(), 'claude-typed.log'), d))
  return draw(false, true)
}
// CLAUDE_STAND_IN=fresh (the herdr test): a new Claude Code waiting for its first message, its
// message box at the bottom, reading what's typed a key at a time as Claude Code does (into
// ~/claude-typed.log), with how it was started in ~/claude-started.log.
if (process.env.CLAUDE_STAND_IN === 'fresh') {
  fs.appendFileSync(path.join(os.homedir(), 'claude-started.log'), JSON.stringify(args) + '\n')
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('data', (d) => fs.appendFileSync(path.join(os.homedir(), 'claude-typed.log'), d))
  return draw(false, true)
}

const project = path.join(os.homedir(), '.claude', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'))
const tasks = path.join(os.homedir(), 'claude-tmp', 'tasks')
fs.mkdirSync(path.join(project, id, 'subagents'), { recursive: true })
fs.mkdirSync(tasks, { recursive: true })
const log = fs.openSync(path.join(project, `${id}.jsonl`), 'w')
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString()
const w = (o) => fs.writeSync(log, JSON.stringify({ sessionId: id, cwd: process.cwd(), ...o }) + '\n')
const use = (minAgo, blocks) => w({ type: 'assistant', timestamp: at(minAgo), message: { role: 'assistant', content: blocks } })
const result = (minAgo, toolUseId, content, toolUseResult) => w({ type: 'user', timestamp: at(minAgo), toolUseResult, message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content }] } })
const notice = (minAgo, body) => w({ type: 'user', timestamp: at(minAgo), origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n${body}\n</task-notification>` } })
const started = (task) => `Command running in background with ID: ${task}. Output is being written to: ${path.join(tasks, `${task}.output`)}. You will be notified when it completes.`
// What newer versions log for every request they make: big lines that aren't the conversation.
const padding = (mb) => { const line = JSON.stringify({ type: 'api-request-blob', message: { role: 'system', content: [{ type: 'text', text: 'x'.repeat(256 * 1024) }] } }) + '\n'; for (let i = 0; i < mb * 4; i++) fs.writeSync(log, line) }

// Its screen first, so its footer is up before the log is done.
const limited = /limit$/.test(message)
draw(message !== 'idle' && message !== 'table' && message !== 'diagram' && !limited)

// Then the shells' output and the subagent's own files, so the log's last notice is the last thing written.
fs.writeFileSync(path.join(tasks, 'bsh0.output'), 'ready on :5173\n')
fs.writeFileSync(path.join(tasks, 'bsh1.output'), 'Running 12 tests\n\x1b[32m11 passed\x1b[0m\nProgress 50%\rProgress 100%\n')
fs.writeFileSync(path.join(tasks, 'bsh2.output'), 'built in 4.1s\n')
if (!screenOnly) {
  const sub = path.join(project, id, 'subagents')
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ description: 'Look for rounding', agentType: 'Explore', toolUseId: 'toolu_A1', requestShape: 'background' }))
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), [
    { type: 'user', timestamp: at(12), message: { role: 'user', content: 'Find every place money is rounded.' } },
    { type: 'assistant', timestamp: at(11), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'quantize' } }] } },
    { type: 'assistant', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'billing/invoices.py' } }] } },
    // A shell of its own, which the footer counts with the session's.
    { type: 'assistant', isSidechain: true, timestamp: at(1), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_H1', name: 'Bash', input: { command: 'pytest billing', description: 'Run the billing tests', run_in_background: true } }] } },
    { type: 'user', isSidechain: true, timestamp: at(1), toolUseResult: { backgroundTaskId: 'bsh3' }, message: { role: 'user', content: [{ tool_use_id: 'toolu_H1', type: 'tool_result', content: started('bsh3') }] } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n')
  fs.writeFileSync(path.join(tasks, 'bsh3.output'), 'collected 40 items\n')
}

w({ type: 'user', timestamp: at(30), message: { role: 'user', content: message || 'Check the billing code' } })
// An old shell nothing was heard from since (its session restarted): the footer counts one shell, the newer one.
use(30, [{ type: 'tool_use', id: 'toolu_S0', name: 'Bash', input: { command: 'npm run dev', description: 'Start the dev server', run_in_background: true } }])
result(30, 'toolu_S0', started('bsh0'), { backgroundTaskId: 'bsh0' })
padding(2)
use(12, [
  ...(screenOnly ? [] : [{ type: 'tool_use', id: 'toolu_A1', name: 'Agent', input: { description: 'Look for rounding', subagent_type: 'Explore', prompt: 'Find every place money is rounded.', run_in_background: true } }]),
  { type: 'tool_use', id: 'toolu_S1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests', run_in_background: true } },
  { type: 'tool_use', id: 'toolu_M1', name: 'Monitor', input: { command: 'watch-deploy', description: 'Watch the deploy', timeout_ms: 1800000 } },
])
if (!screenOnly) result(12, 'toolu_A1', [{ type: 'text', text: 'Async agent launched successfully. agentId: a1' }])
result(12, 'toolu_S1', started('bsh1'), { backgroundTaskId: 'bsh1' })
result(12, 'toolu_M1', 'Monitor started (task bmon1, expires in 30m unless the source ends first).', { taskId: 'bmon1', timeoutMs: 1800000, persistent: false })
padding(3)
// An image you pasted, far into the log.
w({ type: 'user', uuid: 'img-0001-abcd', timestamp: at(11), message: { role: 'user', content: [{ type: 'text', text: 'This screen' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' } }] } })
// Tool output that quotes a notice (a log being read, say) isn't one.
result(10, 'toolu_X', 'Here is a log line: <task-notification>\n<task-id>bsh1</task-id>\n<status>failed</status>\n</task-notification>')
use(9, [{ type: 'tool_use', id: 'toolu_S2', name: 'Bash', input: { command: 'npm run build', description: 'Build the app', run_in_background: true } }])
result(9, 'toolu_S2', started('bsh2'), { backgroundTaskId: 'bsh2' })
padding(2)
notice(6, '<task-id>bsh2</task-id>\n<tool-use-id>toolu_S2</tool-use-id>\n<status>completed</status>\n<summary>Background command "Build the app" completed (exit code 0)</summary>')
notice(5, '<task-id>bmon1</task-id>\n<summary>Monitor event: "Watch the deploy"</summary>\n<event>deploy 1 of 3 healthy\ndeploy 2 of 3 healthy</event>')
// A reply with a table as wide as a real one, too wide for a phone.
if (message === 'table') use(0, [{ type: 'text', text: 'Where each ticket stands:\n\n| Ticket | What changed | Who reviews it | Status |\n|---|---|---|---|\n| PLT-12) | The billing export rounds each line before it adds them up, so totals match the invoices | Priya Shah | Done |\n| PLT-15 | Refunds keep their original currency through the whole export | Dan Ruiz | In review |' }])
// A reply with a diagram in it, and the file it's also in.
if (message === 'diagram') use(0, [{ type: 'text', text: 'Here is the checkout flow, also in `flow.mmd`:\n\n```mermaid\nflowchart LR\n  Cart --> Pay[Payment] --> Done\n```' }])
// A usage limit, as Claude Code logs one: the error, then whether it carries on by itself at the reset.
if (limited) {
  const weekly = message === 'weekly limit'
  w({ type: 'assistant', timestamp: at(0), error: 'rate_limit', isApiErrorMessage: true, apiErrorStatus: 429, message: { role: 'assistant', content: [{ type: 'text', text: weekly ? 'You\'ve hit your weekly limit · resets Oct 29 at 5am (America/Los_Angeles)' : 'You\'ve hit your session limit · resets 3:10am (America/Los_Angeles)' }] } })
  if (!weekly) w({ type: 'system', subtype: 'informational', timestamp: at(0), content: 'Usage limit reached · continuing automatically at 3:10am · esc to cancel' })
}
fs.closeSync(log)
