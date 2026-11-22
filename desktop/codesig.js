// The Mac app's own code-signing requirement, from its own signature, and each program in its copy of
// Bridge AI (app-root: rootlist.js lists them without a hash, as signing changes their bytes) held to
// it: signed by the same Developer ID team, or, for a build signed with Bridge AI's own certificate,
// that certificate (its leaf's hash). An app signed ad hoc has no requirement to hold them to. main.js
// checks them with the copy, and hands the requirement to the server, which checks its signing helper
// against it before it trusts what the helper says (server/signhelper.js).
const { execFile, spawnSync } = require('node:child_process')

const CODESIGN = '/usr/bin/codesign'
function requirementOf(bundle, { platform = process.platform } = {}) {
  if (platform !== 'darwin' || !bundle) return null
  const d = spawnSync(CODESIGN, ['-d', '-r-', bundle], { encoding: 'utf8', timeout: 15000 })
  const leaf = /certificate leaf = H"([0-9a-fA-F]{40})"/.exec(`${d.stdout || ''}\n${d.stderr || ''}`)
  if (leaf) return `certificate leaf = H"${leaf[1].toLowerCase()}"`
  const v = spawnSync(CODESIGN, ['-d', '-vv', bundle], { encoding: 'utf8', timeout: 15000 })
  const team = /TeamIdentifier=([A-Z0-9]{10})\b/.exec(`${v.stdout || ''}\n${v.stderr || ''}`)
  return team ? `anchor apple generic and certificate leaf[subject.OU] = "${team[1]}"` : null
}
// Whether file is signed to req, and its signature holds (codesign --verify --strict).
const holds = (file, req) => new Promise((resolve) => execFile(CODESIGN, ['--verify', '--strict', '-R', `=${req}`, file], { timeout: 20000 }, (err) => resolve(!err)))
// The ones of files that aren't (n at a time).
async function failing(files, req, n = 8) {
  const bad = []
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < files.length) { const f = files[i++]; if (!(await holds(f, req))) bad.push(f) } }))
  return bad
}

module.exports = { requirementOf, holds, failing }
