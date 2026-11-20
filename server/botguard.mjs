// Claude Code's PreToolUse hook for a bot's run that changes files (botwrite.js, botchanges.js,
// frontdesk.js): every path a tool that writes is given (Edit, Write, MultiEdit, NotebookEdit) is
// checked before anything is written, and refused unless it's inside the run's copy: an absolute path
// (or one from the run's folder), no .. in it, git's own folder by no name (.git, GIT~1, .git. …), no
// link anywhere on the way, inside the copy as it really is, and never Claude Code's own project files
// at its top (.claude/, .mcp.json, and for a copy of folders, anything but those folders' own copies:
// --part). Refused: exit 2, why on stderr, which Claude Code gives back to the agent. A tool call it
// can't read a path from is refused too.
//
// Each path it lets through is written to the run's log (--log) as an HMAC, with a key of the run's
// own read from a file (--key, beside the log in the run's own folder, which the agent can neither
// read nor write; never on its command line, which Claude Code may quote back to the agent): Bridge
// AI takes only what's there (botwrite.js guardCheck), so a hook that couldn't run lets nothing
// through.
//
// It's a lock of its own, beside Claude Code's permissions (edits allowed in its folder only, anything
// else refused: agents.js access 'change'), so settings of yours that allow edits anywhere don't let
// a bot's run write outside its copy; and Bridge AI checks every path again when it takes what
// changed and when it makes it (botwrite.js). Given to the run in its settings (botmcp.js runFolder),
// with disableAllHooks off. node botguard.mjs <copy> [--part <name>]… [--log <file> --key <file>]
//
// A bot's session that may run commands (Bash, in Claude Code's sandbox: botmcp.js sandboxOf) has it
// on Bash too, with nothing to write in when it only reads (--bash-only, no copy): a command that
// would push, open a pull request or reach GitHub, or change where git pushes (git push, gh, hub, git
// remote, git config, git credential, a fetch of github.com) is refused, saying that pushing waits for
// you (--who: your name) and, for a session with a copy of a repository (--push), that it asks with
// its request_push tool. The sandbox has no network for it anyway, and nothing to write .git in: this
// says why, and holds where a domain you allowed would reach GitHub. Each command it lets through is
// written to the log as well ('b'), so a file a command changed in the copy, which no edit tool wrote
// and so isn't in the log, is held for you rather than refused (botwrite.js collect).
// node botguard.mjs --bash-only --log <file> --key <file> [--who <name>] [--push]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const argv = process.argv.slice(2)
const bashOnly = argv[0] === '--bash-only'
const root = argv[0] && !bashOnly ? path.resolve(argv[0]) : null
const parts = []
let log = null
let keyFile = null
let who = 'the owner'
let push = false
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--part' && argv[i + 1]) parts.push(argv[++i])
  else if (argv[i] === '--log' && argv[i + 1]) log = argv[++i]
  else if (argv[i] === '--key' && argv[i + 1]) keyFile = argv[++i]
  else if (argv[i] === '--who' && argv[i + 1]) who = argv[++i]
  else if (argv[i] === '--push') push = true
}
const no = (why) => { process.stderr.write(`Refused: ${why}. ${root ? `You can only change files in your own copy, ${root}.` : 'You can only read here.'}\n`); process.exit(2) }
// A command that would push or reach GitHub, or change where git sends things: refused, by its words
// (a shell's, so each part after ; && || | $( or a backtick is looked at as a command of its own).
// Advice, not the boundary: a shell can spell a command a hundred ways a word match won't see. What
// holds is the session's sandbox (botmcp.js sandboxOf): no network but the domains you allowed and
// never GitHub (deniedDomains), no key or token in its environment (credentials, the scrub), none of
// your files outside its folders to push with (your SSH keys and git credentials unreadable); a push
// you approve is made by Bridge AI itself (botchanges.js publish), as the commit you were shown.
const PUSHES = [
  [/(^|[\s;&|(`/]|\$\()git(\s+-[cC]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+(push|send-pack|send-email|request-pull)\b/, 'it pushes'],
  // (And any command with both words in it, however it's put together: $(echo git) push.)
  [/\bgit\b[\s\S]*\b(push|send-pack)\b|\b(push|send-pack)\b[\s\S]*\bgit\b/i, 'it pushes'],
  [/(^|[\s;&|(`/]|\$\()git(\s+-[cC]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+(remote|config|credential|credential-\w+)\b/, 'it changes where git sends things, or its settings'],
  [/(^|[\s;&|(`/]|\$\()(gh|hub|glab)(\s|$|;|&|\|)/, 'it runs GitHub\'s command line'],
  [/(^|[\s;&|(`/]|\$\()(curl|wget|http|https|xh|aria2c|nc|ncat|socat|ssh|scp|sftp|rsync|python\d?|node|perl|ruby)\b[^\n]*\b(github\.com|githubusercontent\.com|api\.github\.com|github\.dev|ghcr\.io)\b/i, 'it reaches GitHub'],
]
function command(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim() || cmd.includes('\0')) no('that isn\'t a command')
  if (cmd.length > 100000) no('that command is too long to check')
  // (Line breaks, a backslash at a line's end, and quotes don't hide a word: read without them too.)
  const plain = cmd.replace(/\\\r?\n/g, ' ').replace(/['"]/g, '')
  for (const [re, why] of PUSHES) {
    if (re.test(cmd) || re.test(plain)) {
      process.stderr.write(`Refused: ${why}. Pushing, pull requests and GitHub wait for ${who}: ${push ? 'call your request_push tool with a title and a short summary, and they\'re asked once this turn ends' : 'nothing here can push'}.\n`)
      process.exit(2)
    }
  }
}
// (That it ran at all, written down first with the run's key, whatever it then says: so a run whose
// hook never ran is told from one whose hook refused everything, botwrite.js guardCheck. It lets
// nothing through.)
if (log && keyFile) {
  let k = ''
  try { k = fs.readFileSync(keyFile, 'utf8').trim() } catch { /* none: nothing written */ }
  if (/^[0-9a-f]{64}$/.test(k)) { try { fs.appendFileSync(log, `${crypto.createHmac('sha256', k).update('ran\n').digest('hex')}\n`, { mode: 0o600 }) } catch { /* said below, when it lets anything through */ } }
}
// (Its real path as the system names it, as each path's below is: on Windows the long name, and the
// case it has on disk.)
const realRoot = (() => { try { return fs.realpathSync.native(root) } catch { return null } })()
// (A path's case, on Windows, where it doesn't matter, for finding which copy it's given in; where it
// really is, below, then decides, by the names the file system has.)
const fold = (s) => (process.platform === 'win32' ? String(s).toLowerCase() : String(s))
// (git's own folder by any name a file system gives it, as git refuses them: botwrite.js gitLike.)
const gitLike = (name) => { const n = String(name || '').toLowerCase().replace(/:.*$/, '').replace(/[. ]+$/, ''); return n === '.git' || /^git~\d+$/.test(n) }
// (Claude Code's own, at the top of the folder it runs in, by any name a file system gives it: a
// trailing dot or space, a stream, or a short name such as CLAUDE~1 or MCP~1.JSO, as gitLike; and on
// the real path, where Windows gives any short name its long one. Only CLAUDE.md spelled as it is may
// be changed, in a repository's copy.)
const ownName = (name) => String(name || '').toLowerCase().replace(/:.*$/, '').replace(/[. ]+$/, '')
const OWN = /^(\.claude|\.mcp\.json|claude\.md|claude\.local\.md)$/
const own = (name) => OWN.test(ownName(name)) || /^(claude|mcp)[^~]{0,6}~\d/i.test(name)
// (The top of a path in the copy, from it: Claude Code's own, or for a copy of folders, not one of
// their copies, refused.)
const top = (p, rel) => {
  if (own(rel[0]) && (parts.length || rel.length > 1 || rel[0].toLowerCase() !== 'claude.md')) no(`${p} is Claude Code's own, not part of your copy`)
  if (parts.length && (rel.length < 2 || !parts.includes(rel[0]))) no(`${p} isn't in a copy of one of your folders (${parts.join(', ')})`)
}
const allowed = []

function check(p, cwd) {
  if (typeof p !== 'string' || !p || p.includes('\0')) no('that isn\'t a path')
  if (/^~(?=$|[\\/])/.test(p)) no('a path from your home folder is outside your copy')
  const abs = path.isAbsolute(p) ? p : path.join(cwd || root, p)
  if (abs.split(/[\\/]+/).includes('..')) no(`${p} has .. in it`)
  const norm = path.resolve(abs)
  const under = [root, realRoot].filter(Boolean).find((r) => fold(norm) === fold(r) || fold(norm).startsWith(fold(r) + path.sep))
  if (!under) no(`${p} is outside your copy`)
  if (fold(norm) === fold(under)) no(`${p} is your copy's own folder, not a file in it`)
  const rel = path.relative(under, norm).split(path.sep)
  if (rel.some(gitLike)) no(`${p} is git's own`)
  top(p, rel)
  // Each part below the copy that's there: a folder, never a link (nor the file itself a link).
  let at = under
  for (const x of rel) {
    at = path.join(at, x)
    let st
    try { st = fs.lstatSync(at) } catch { break }
    if (st.isSymbolicLink()) no(`${path.relative(under, at)} is a link`)
  }
  // And where it really is, the part that's there followed to its real path (the system's own, so a
  // short name is its long one).
  let real = norm
  const rest = []
  for (;;) {
    try { real = path.join(fs.realpathSync.native(real), ...rest.reverse()); break } catch { const up = path.dirname(real); if (up === real) break; rest.push(path.basename(real)); real = up }
  }
  if (!realRoot || (real !== realRoot && !real.startsWith(realRoot + path.sep))) no(`${p} is outside your copy`)
  const realRel = path.relative(realRoot, real).split(path.sep)
  if (realRel.some(gitLike)) no(`${p} is git's own`)
  top(p, realRel)
  allowed.push(real)
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { input += d; if (input.length > 4 * 1024 * 1024) no('that\'s too much to check') })
process.stdin.on('end', () => {
  let j
  try { j = JSON.parse(input) } catch { no('its tool call couldn\'t be read') }
  const x = j?.tool_input || {}
  // (A command: its words checked, and that one ran written down, as below.)
  if (j?.tool_name === 'Bash') {
    command(x.command)
    if (log) {
      let key = ''
      try { key = fs.readFileSync(keyFile, 'utf8').trim() } catch { /* none */ }
      if (!/^[0-9a-f]{64}$/.test(key)) no('its checks have no key to write them down with')
      try { fs.appendFileSync(log, `${crypto.createHmac('sha256', key).update('b\n').digest('hex')}\n`, { mode: 0o600 }) } catch { no('its checks couldn\'t be written down') }
    }
    process.exit(0)
  }
  if (!root || !realRoot) no('this run has no copy to write in')
  const paths = [x.file_path, x.notebook_path, x.path, ...(Array.isArray(x.edits) ? x.edits.map((e) => e?.file_path) : [])].filter((v) => v !== undefined)
  if (!paths.length) no(`${j?.tool_name || 'that tool'} wasn't given a path to check`)
  for (const p of paths) check(p, j?.cwd)
  // (What it let through, for Bridge AI to take: a log it can't write, it lets nothing through.)
  if (log) {
    // (From its file alone: none, nothing is let through.)
    let key = ''
    try { key = fs.readFileSync(keyFile, 'utf8').trim() } catch { /* none */ }
    if (!/^[0-9a-f]{64}$/.test(key)) no('its checks have no key to write them down with')
    try { fs.appendFileSync(log, allowed.map((p) => `${crypto.createHmac('sha256', key).update(`w\n${p}`).digest('hex')}\n`).join(''), { mode: 0o600 }) } catch { no('its checks couldn\'t be written down') }
  }
  process.exit(0)
})
