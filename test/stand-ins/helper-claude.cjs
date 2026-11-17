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
//                                            and by what the bot's instructions say:
//     [sign <text>]                          ends every answer with it
//     [try-write <name>]                     tries to write <name> in its folder first: only when
//                                            --tools lets it Write, else it says it couldn't
//     [try-run]                              tries to run a command (touch ran.txt): only when
//                                            --tools lets it use Bash
//     [try-read <path>]                      tries to read a file: one in its folder or a folder
//                                            --add-dir gave it is read; one outside them is refused
//                                            under --permission-mode dontAsk, as Claude Code
//                                            refuses what would have asked
//                                            Each try goes in ~/answer-tries.log ({ try, done }).
//     [edit <name> <text>]                   writes <text> into <name> in its folder: only when
//                                            --tools lets it Edit and --allowedTools Edit(./**)
//                                            lets it there without asking (a bot's change, in its
//                                            own copy of a repository), else it says it couldn't
//     [edit-outside <path> <text>]           tries to write a file outside its folder: refused
//                                            under --permission-mode dontAsk (Edit(./**) is only
//                                            its folder)
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
//   claude --resume <id> --fork-session --session-id <new> "<brief>"   a copy of a conversation:
//                                            <id>'s, then the brief as above
//   --model <m>, --effort <level>, --permission-mode <mode>, --tools <list>, --add-dir <dirs...>,
//   --strict-mcp-config                      taken, as Claude Code takes them
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('2.1.312 (Claude Code)'); process.exit(0) }
// Signed in with a Max plan (BRIDGE_STANDIN_CLAUDE_PLAN: another, team say).
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: process.env.BRIDGE_STANDIN_CLAUDE_PLAN || 'max' })); process.exit(0) }
const WITH_VALUE = new Set(['--session-id', '--resume', '--model', '--permission-mode', '--effort', '--tools'])
// (--allowedTools, like --add-dir, takes a list.)
const allowed = []
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
// --add-dir takes folders until the next flag; anything else that isn't a flag or a flag's value is
// the opening message.
const added = []
let message = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--add-dir') { while (args[i + 1] && !args[i + 1].startsWith('--')) added.push(args[++i]); continue }
  if (args[i] === '--allowedTools') { while (args[i + 1] && !args[i + 1].startsWith('--')) allowed.push(args[++i]); continue }
  if (WITH_VALUE.has(args[i])) { i++; continue }
  if (!args[i].startsWith('--') && !message) message = args[i]
}
// The brief in a file it's pointed to: read when it may (its folder, or a folder --add-dir gave it).
const pointed = /^Your brief is in (.+?\.md)\. Read it first/.exec(message)
if (pointed) {
  const f = pointed[1]
  const ok = [process.cwd(), ...added].some((d) => path.resolve(f).startsWith(path.resolve(d) + path.sep))
  try { if (ok) message = fs.readFileSync(f, 'utf8') } catch { /* not there */ }
}
const id = opt('--session-id') || opt('--resume') || `s-${process.pid}`
const home = os.homedir()
const note = (file, o) => fs.appendFileSync(path.join(home, file), JSON.stringify(o) + '\n')
// (And any Slack token it was given in its environment, by name: there should never be one.)
const secrets = Object.entries(process.env).filter(([, v]) => /^(xox[abp]|xapp)-|^dtest\.|^teams-secret/.test(String(v))).map(([k]) => k)
if (message) note('helpers-started.log', { args, cwd: process.cwd(), message, secrets, ...(pointed ? { briefFile: pointed[1] } : {}) })
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
let prev = null
const w = (o) => {
  const e = { sessionId: id, cwd: process.cwd(), uuid: `h-${Math.random().toString(36).slice(2)}`, parentUuid: prev, timestamp: new Date().toISOString(), ...o }
  prev = e.uuid
  fs.writeSync(log, JSON.stringify(e) + '\n')
}
const user = (text) => w({ type: 'user', message: { role: 'user', content: text } })
const reply = (text) => w({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const tool = (name, input) => w({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2, 8)}`, name, input }] } })

const rule = '─'.repeat(60)
let state = 'idle' // idle | working | asking
let said = 'Ready.'
let began = 0
const draw = () => {
  const head = state === 'asking'
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

// An answer for the Slack Bot: what it can do is what it was started with.
function answerTurn(text) {
  // (On Windows its lines come as one, joined by " · ": runtime/spawn.js forCommandLine.)
  const q = (/----- question from.*? -----(?:\n| · )([\s\S]*?)(?:\n| · )----- end of question -----/.exec(text) || [])[1] || ''
  const told = (/----- instructions -----(?:\n| · )([\s\S]*?)(?:\n| · )----- end of instructions -----/.exec(text) || [])[1] || ''
  const sign = (/\[sign ([^\]]+)\]/.exec(told) || [])[1] || null
  const tools = opt('--tools')
  const can = (t) => tools == null || tools.split(',').map((x) => x.trim()).includes(t)
  const dontAsk = opt('--permission-mode') === 'dontAsk'
  const tried = (what, done) => note('answer-tries.log', { try: what, done, cwd: process.cwd() })
  user(text)
  state = 'working'
  began = Date.now()
  draw()
  // (How long it takes is the question's to say: a [work] in the conversation around it isn't.)
  const wait = Number((/\[work (\d+)\]/.exec(q) || [])[1] || 2)
  setTimeout(() => {
    const out = []
    for (const f of fs.readdirSync(process.cwd()).filter((x) => /\.(md|txt)$/.test(x)).slice(0, 3)) tool('Read', { file_path: path.join(process.cwd(), f) })
    const w = /\[try-write ([\w.-]+)\]/.exec(q)
    if (w) {
      if (can('Write')) { tool('Write', { file_path: path.join(process.cwd(), w[1]) }); fs.writeFileSync(path.join(process.cwd(), w[1]), 'Written.\n'); tried('write', true); out.push(`I wrote ${w[1]}.`) } else { tried('write', false); out.push(`I can't write ${w[1]}: I have no tool that writes files.`) }
    }
    if (/\[try-run\]/.test(q)) {
      if (can('Bash')) { fs.writeFileSync(path.join(process.cwd(), 'ran.txt'), ''); tried('run', true); out.push('I ran it.') } else { tried('run', false); out.push('I can\'t run commands here.') }
    }
    const r = /\[try-read ([^\]]+)\]/.exec(q)
    if (r) {
      const want = path.resolve(r[1].replace(/^~/, home))
      const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }
      const here = [process.cwd(), ...added].some((d) => want.startsWith(d + path.sep) || real(want).startsWith(real(d) + path.sep))
      if (!can('Read') || (!here && dontAsk)) { tried('read', false); out.push(`I couldn't read ${r[1]}: reading outside my folders was refused.`) } else { let c = ''; try { c = fs.readFileSync(want, 'utf8').trim() } catch { /* none */ } tool('Read', { file_path: want }); tried('read', true); out.push(`It says: ${c}`) }
    }
    // Edits: only in its folder, and only when it was started able to (a bot's change).
    const editsHere = can('Edit') && can('Write') && allowed.some((x) => /^Edit\(\.\/\*\*\)$/.test(x))
    for (const m of q.matchAll(/\[edit ([\w./-]+) ([^\]]+)\]/g)) {
      const f = path.resolve(process.cwd(), m[1])
      if (editsHere && f.startsWith(process.cwd() + path.sep)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${m[2]}\n`); tool('Edit', { file_path: f }); tried('edit', true); out.push(`I changed ${m[1]}.`) } else { tried('edit', false); out.push(`I can't change ${m[1]} here.`) }
    }
    for (const m of q.matchAll(/\[edit-outside ([^\s\]]+) ([^\]]+)\]/g)) {
      const f = path.resolve(m[1].replace(/^~/, home))
      const inHere = f.startsWith(process.cwd() + path.sep)
      if (can('Edit') && (!dontAsk || (inHere && editsHere))) { fs.writeFileSync(f, `${m[2]}\n`); tried('edit-outside', true); out.push(`I wrote ${m[1]}.`) } else { tried('edit-outside', false); out.push(`I couldn't write ${m[1]}: that was refused.`) }
    }
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
    const answer = /\[noanswer\]/.test(q) ? 'NO ANSWER\nNothing in this folder says.' : /\[notforme\]/.test(q) ? 'NOT FOR ME' : [[...out, a ? a[1] : 'Here is what I found.', ...(sign ? [sign] : [])].join(' ') + long, ...files, ...remember].join('\n\n')
    said = answer
    reply(answer)
    state = 'idle'
    draw()
  }, wait * 1000)
}

if (message && /----- question from/.test(message)) answerTurn(message)
else if (message && /\[ask\]/.test(message)) {
  user(message)
  state = 'asking'
  draw()
} else if (message) turn(message, `I wrote ${file} in this folder.\n\nDone: the draft is in ${file}, ready for review.`, secs * 1000, file)
else draw()

// What's typed: a key at a time, pastes bracketed, Enter sends.
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdout.write('\x1b[?2004h')
let box = ''
let pasting = false
process.stdin.on('data', (d) => {
  let s = String(d)
  if (state === 'asking') {
    if (s[0] === '1' || s[0] === '2') { state = 'idle'; turn('(allowed)', `I wrote ${file} in this folder.\n\nDone: the draft is in ${file}, ready for review.`, 1000, file) }
    return
  }
  while (s.length) {
    if (pasting) {
      const end = s.indexOf('\x1b[201~')
      if (end < 0) { box += s; s = '' } else { box += s.slice(0, end); s = s.slice(end + 6); pasting = false }
    } else if (s.startsWith('\x1b[200~')) { pasting = true; s = s.slice(6) }
    else if (s.startsWith('\x1b[') || s.startsWith('\x1bO')) { const k = /^\x1b[[O][0-9;?]*[A-Za-z~]/.exec(s); s = s.slice(k ? k[0].length : 2) }
    else if (s[0] === '\x1b') s = s.slice(1)
    else {
      const c = s[0]
      s = s.slice(1)
      if (c === '\r' || c === '\n') {
        const text = box.trim()
        box = ''
        if (!text) continue
        if (!message) note('chief-got.log', { session: id, text })
        turn(text, message ? `Followed up: ${text.split('\n')[0]}` : 'Noted.', 1000, null)
      } else if (c === '\x7f' || c === '\b') box = Array.from(box).slice(0, -1).join('')
      else if (c >= ' ') box += c
    }
  }
})
setInterval(() => {}, 1 << 30)
