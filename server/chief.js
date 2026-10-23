// The chief of staff's folder: built from the template in chief/ into the data folder, so its
// memory (playbook, ledger, task list) is yours and never lands in the repo. The instructions are
// written for every agent that might run it: CLAUDE.md (Claude Code), AGENTS.md (Codex, OpenCode,
// Amp and others) and GEMINI.md (Gemini CLI), and rewritten each time the server starts, so an
// update reaches folders made by an older version. Your playbook, ledger and task list are copied
// once (an older folder gets the ones it lacks) and never overwritten.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, dataFile, ensureDir } from './paths.js'

const TEMPLATE = path.join(ROOT, 'chief')

const copyIfMissing = (from, to, you) => { if (!fs.existsSync(to)) fs.writeFileSync(to, fs.readFileSync(from, 'utf8').replaceAll('{{name}}', you)) }

export function prepareChief(cfg = {}) {
  const dir = ensureDir(dataFile('chief'))
  ensureDir(path.join(dir, 'state'))
  ensureDir(path.join(dir, 'bin'))
  ensureDir(path.join(dir, '.claude'))
  ensureDir(path.join(dir, 'work')) // what it makes for its own tasks, a folder per task
  const you = String(cfg.name || '').trim() || 'the user'
  const body = fs.readFileSync(path.join(TEMPLATE, 'INSTRUCTIONS.md'), 'utf8').replaceAll('{{name}}', you)
  // Claude Code pulls the playbook in with an @import; other agents are told to read it.
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body.replace('{{playbook}}', '@state/playbook.md'))
  const plain = body.replace('{{playbook}}', 'Read `state/playbook.md` now, before anything else, and follow it.')
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), plain)
  fs.writeFileSync(path.join(dir, 'GEMINI.md'), plain)
  fs.copyFileSync(path.join(TEMPLATE, 'bin', 'bridge'), path.join(dir, 'bin', 'bridge'))
  try { fs.chmodSync(path.join(dir, 'bin', 'bridge'), 0o755) } catch { /* Windows */ }
  fs.copyFileSync(path.join(TEMPLATE, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.json'))
  copyIfMissing(path.join(TEMPLATE, 'state', 'playbook.md'), path.join(dir, 'state', 'playbook.md'), you)
  copyIfMissing(path.join(TEMPLATE, 'state', 'ledger.md'), path.join(dir, 'state', 'ledger.md'), you)
  copyIfMissing(path.join(TEMPLATE, 'state', 'tasks.md'), path.join(dir, 'state', 'tasks.md'), you)
  // The CLI reaches this server; tell it where if the port isn't the default.
  fs.writeFileSync(path.join(dir, 'bin', 'bridge.json'), JSON.stringify({ url: `http://127.0.0.1:${cfg.port || 7420}`, name: you }, null, 2))
  return dir
}
