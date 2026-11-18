// Stand-in Claude Code for a bot's answers with MCP servers, and a run watched as it goes
// (bots-setup): in front of helper-claude.cjs, which answers as it always does once this has done
// what a bot's question asks of it here:
//   [mcp <server> <tool>]   one of its MCP servers' tools, called as Claude Code would: only when
//                          --mcp-config gives it that server, with --strict-mcp-config, and
//                          --allowedTools lets it (the tool, or the whole server, mcp__<server>)
//                          and --disallowedTools doesn't refuse it; refused otherwise, as dontAsk
//                          refuses whatever would ask. Each try goes in ~/mcp-tries.log ({ server,
//                          tool, done, config: whether the config held the server's token, read:
//                          whether --add-dir let it read the config }), a call made in its
//                          conversation, and what came of them is its answer (unless the question
//                          says [answer …] itself).
//   [peek]                 reads the files in its folder as it starts (helper-claude reads them as
//                          it ends), so its run shows what it's reading meanwhile.
// And, as Claude Code on a computer where it can't answer: with ~/claude-signed-out there, `claude
// auth status` says it isn't signed in; with ~/claude-limited there, a bot's question is answered
// as Claude Code at its usage limit answers ("You've hit your usage limit · resets 5pm").
// --mcp-config and --disallowedTools are taken here, as helper-claude doesn't know them. Each start
// goes in ~/claude-args.log ({ args, cwd }) with its arguments as they came.
// HELPER_CLAUDE is where helper-claude.cjs is (the test puts it in).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const argv = process.argv
if (argv[2] === 'auth' && fs.existsSync(path.join(os.homedir(), 'claude-signed-out'))) { console.log(JSON.stringify({ loggedIn: false, authMethod: 'none' })); process.exit(0) }
// (Each start, with its arguments as they came, in ~/claude-args.log: { args, message }.)
fs.appendFileSync(path.join(os.homedir(), 'claude-args.log'), `${JSON.stringify({ args: argv.slice(2), cwd: process.cwd() })}\n`)
const take = (flag, list) => {
  const i = argv.indexOf(flag)
  if (i < 0) return list ? [] : null
  let j = i + 1
  const out = []
  while (argv[j] && !argv[j].startsWith('--')) { out.push(argv[j++]); if (!list) break }
  argv.splice(i, j - i)
  return list ? out : out[0] || null
}
const configs = take('--mcp-config', true)
const denied = take('--disallowedTools', true)
const listOf = (flag) => { const i = argv.indexOf(flag); const out = []; if (i >= 0) for (let j = i + 1; argv[j] && !argv[j].startsWith('--'); j++) out.push(argv[j]); return out }
const allowed = listOf('--allowedTools')
const added = listOf('--add-dir')
const strict = argv.includes('--strict-mcp-config')
const servers = {}
for (const c of configs) { try { Object.assign(servers, JSON.parse(fs.readFileSync(c, 'utf8')).mcpServers || {}) } catch { /* unreadable */ } }
const VALUE = new Set(['--session-id', '--resume', '--model', '--permission-mode', '--effort', '--tools'])
let at = -1
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--add-dir' || argv[i] === '--allowedTools') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) i++; continue }
  if (VALUE.has(argv[i])) { i++; continue }
  if (!argv[i].startsWith('--')) { at = i; break }
}
const message = at >= 0 ? argv[at] : ''
const q = (/----- question from.*? -----(?:\n| · )([\s\S]*?)(?:\n| · )----- end of question -----/.exec(message) || [])[1] || ''
const norm = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_')
const calls = []
const tries = []
for (const m of q.matchAll(/\[mcp ([\w.-]+) ([\w.-]+)\]/g)) {
  const [, server, tool] = m
  const rule = `mcp__${norm(server)}__${norm(tool)}`
  const done = strict && !!servers[server] && (allowed.includes(rule) || allowed.includes(`mcp__${norm(server)}`)) && !denied.includes(rule) && !denied.includes(`mcp__${norm(server)}`)
  const read = configs.some((c) => added.some((d) => path.resolve(c).startsWith(path.resolve(d) + path.sep)))
  fs.appendFileSync(path.join(os.homedir(), 'mcp-tries.log'), `${JSON.stringify({ server, tool, done, config: !!servers[server]?.env, read })}\n`)
  tries.push({ server, tool, done })
  if (done) calls.push(rule)
}
if (at >= 0 && q && fs.existsSync(path.join(os.homedir(), 'claude-limited'))) argv[at] = message.replace(/\[answer [^\]]*\]/g, '').replace(/----- end of question -----/, '[answer You\'ve hit your usage limit · resets 5pm]\n----- end of question -----')
else if (at >= 0 && (tries.length || /\[peek\]/.test(q))) {
  const said = tries.map((x) => (x.done ? `I used ${x.server}'s ${x.tool}.` : `${x.server}'s ${x.tool} was refused.`)).join(' ')
  argv[at] = message.replace(/\[mcp [\w.-]+ [\w.-]+\]/g, '').replace(/----- end of question -----/, (end) => (said && !/\[answer /.test(q) ? `[answer ${said}]\n${end}` : end))
}
require(HELPER_CLAUDE) // eslint-disable-line no-undef

// Its calls and what it reads first, in its conversation (as it was started: entries of their own,
// outside the turn's chain, which Bridge AI reads all the same).
if (at >= 0 && (calls.length || /\[peek\]/.test(q))) {
  const id = (() => { const i = argv.indexOf('--session-id'); return i >= 0 ? argv[i + 1] : null })()
  const file = path.join(os.homedir(), '.claude', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`)
  const line = (name, input) => `${JSON.stringify({ type: 'assistant', sessionId: id, cwd: process.cwd(), timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2, 8)}`, name, input }] } })}\n`
  if (/\[peek\]/.test(q)) for (const f of fs.readdirSync(process.cwd()).filter((x) => /\.(md|txt)$/.test(x)).slice(0, 2)) fs.appendFileSync(file, line('Read', { file_path: path.join(process.cwd(), f) }))
  for (const c of calls) fs.appendFileSync(file, line(c, {}))
}
