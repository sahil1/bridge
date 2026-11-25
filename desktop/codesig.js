// The Mac app's own code-signing requirement, from its own signature, and each program in its copy of
// Bridge AI (app-root: rootlist.js lists them without a hash, as signing changes their bytes) held to
// it: signed by the same Developer ID team, or, for a build signed with Bridge AI's own certificate,
// that certificate (its leaf's hash). An app signed ad hoc has no requirement to hold them to. main.js
// checks them with the copy, and hands the requirement to the server, which checks its signing helper
// against it before it trusts what the helper says (server/signhelper.js).
const { execFile, spawnSync } = require('node:child_process')

const CODESIGN = '/usr/bin/codesign'
// bundle: the app's path, or a pid (main.js asks with its own: the app as it runs).
function requirementOf(bundle, { platform = process.platform } = {}) {
  if (platform !== 'darwin' || !bundle) return null
  const d = spawnSync(CODESIGN, ['-d', '-r-', bundle], { encoding: 'utf8', timeout: 15000 })
  const leaf = /certificate leaf = H"([0-9a-fA-F]{40})"/.exec(`${d.stdout || ''}\n${d.stderr || ''}`)
  if (leaf) return `certificate leaf = H"${leaf[1].toLowerCase()}"`
  const v = spawnSync(CODESIGN, ['-d', '-vv', bundle], { encoding: 'utf8', timeout: 15000 })
  const team = /TeamIdentifier=([A-Z0-9]{10})\b/.exec(`${v.stdout || ''}\n${v.stderr || ''}`)
  return team ? `anchor apple generic and certificate leaf[subject.OU] = "${team[1]}"` : null
}
// One check of file against req (codesign --verify --strict): 'ok'; 'bad' when codesign says so (its
// exit status 1, the signature doesn't hold, or 3, it isn't signed to req); 'unsure' for anything else
// (no answer in time, codesign killed or not started), which says nothing about the file. Right after
// an update macOS is often still looking the new app over, and codesign can take far longer than
// usual then: a slow answer is never taken for a changed file (it kept a computer no one was at from
// starting its server at all).
const BAD = new Set([1, 3])
const once = (file, req, timeout, run = execFile) => new Promise((resolve) => run(CODESIGN, ['--verify', '--strict', '-R', `=${req}`, file], { timeout }, (err) => resolve(!err ? 'ok' : BAD.has(err.code) && !err.killed ? 'bad' : 'unsure')))
// Whether file is signed to req, and its signature holds: an unsure answer asked again, with longer to
// answer each time (WAITS); still unsure after those, it's taken as not holding.
const WAITS = [20000, 60000, 180000]
async function holds(file, req, { waits = WAITS, run = execFile } = {}) {
  for (const t of waits) {
    const v = await once(file, req, t, run)
    if (v !== 'unsure') return v === 'ok'
  }
  return false
}
// The ones of files that aren't (n at a time).
async function failing(files, req, n = 8, opts = {}) {
  const bad = []
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < files.length) { const f = files[i++]; if (!(await holds(f, req, opts))) bad.push(f) } }))
  return bad
}

module.exports = { requirementOf, holds, failing }
