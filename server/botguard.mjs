// Claude Code's PreToolUse hook for a bot's run that changes files (botwrite.js, frontdesk.js): every
// path a tool that writes is given (Edit, Write, MultiEdit, NotebookEdit) is checked before anything
// is written, and refused unless it's inside the run's staging copy: an absolute path (or one from the
// run's folder), no .. in it, git's own files never, no link anywhere on the way, and inside the copy
// as it really is. Refused: exit 2, why on stderr, which Claude Code gives back to the agent. A tool
// call it can't read a path from is refused too.
//
// It's a lock of its own, beside Claude Code's permissions (edits allowed in its folder only, anything
// else refused: agents.js access 'change'), so settings of yours that allow edits anywhere don't let
// a bot's run write outside its copy; and Bridge AI checks every path again when it takes what
// changed and when it makes it (botwrite.js). Given to the run in its settings (botmcp.js runFolder),
// with disableAllHooks off. node botguard.mjs <copy>
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] ? path.resolve(process.argv[2]) : null
const no = (why) => { process.stderr.write(`Refused: ${why}. You can only change files in your own copy, ${root}.\n`); process.exit(2) }
const realRoot = (() => { try { return fs.realpathSync(root) } catch { return null } })()

function check(p, cwd) {
  if (typeof p !== 'string' || !p || p.includes('\0')) no('that isn\'t a path')
  if (/^~(?=$|[\\/])/.test(p)) no('a path from your home folder is outside your copy')
  const abs = path.isAbsolute(p) ? p : path.join(cwd || root, p)
  if (abs.split(/[\\/]+/).includes('..')) no(`${p} has .. in it`)
  const norm = path.resolve(abs)
  const under = [root, realRoot].filter(Boolean).find((r) => norm === r || norm.startsWith(r + path.sep))
  if (!under) no(`${p} is outside your copy`)
  if (norm === under) no(`${p} is your copy's own folder, not a file in it`)
  if (path.relative(under, norm).split(path.sep).some((x) => x.toLowerCase() === '.git')) no(`${p} is git's own`)
  // Each part below the copy that's there: a folder, never a link (nor the file itself a link).
  let at = under
  for (const x of path.relative(under, norm).split(path.sep).filter(Boolean)) {
    at = path.join(at, x)
    let st
    try { st = fs.lstatSync(at) } catch { break }
    if (st.isSymbolicLink()) no(`${path.relative(under, at)} is a link`)
  }
  // And where it really is, the part that's there followed to its real path.
  let real = norm
  const rest = []
  for (;;) {
    try { real = path.join(fs.realpathSync(real), ...rest.reverse()); break } catch { const up = path.dirname(real); if (up === real) break; rest.push(path.basename(real)); real = up }
  }
  if (!realRoot || (real !== realRoot && !real.startsWith(realRoot + path.sep))) no(`${p} is outside your copy`)
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { input += d; if (input.length > 4 * 1024 * 1024) no('that\'s too much to check') })
process.stdin.on('end', () => {
  if (!root || !realRoot) no('this run has no copy to write in')
  let j
  try { j = JSON.parse(input) } catch { no('its tool call couldn\'t be read') }
  const x = j?.tool_input || {}
  const paths = [x.file_path, x.notebook_path, x.path, ...(Array.isArray(x.edits) ? x.edits.map((e) => e?.file_path) : [])].filter((v) => v !== undefined)
  if (!paths.length) no(`${j?.tool_name || 'that tool'} wasn't given a path to check`)
  for (const p of paths) check(p, j?.cwd)
  process.exit(0)
})
