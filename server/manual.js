// Bridge AI's manual inside the app (shared/manual.md, made from README.md and the words in Settings
// by scripts/manual.js, and checked at each release): what Chief of Staff, your agents and your bots
// answer "how do I…" from, and what Help in ⌘K opens (the app has its own copy, in its build).
//   Chief of Staff: manual.md in its folder (chief/INSTRUCTIONS.md says when to read it).
//   Your agents: for-agents/manual.md in the data folder, a folder they're given to read without
//     asking (agentnote.js), beside what you mean by "that" (pointers.js).
//   A bot: the parts that answer a question about Bridge AI itself, in its brief (frontdesk.js), as
//     it can read nothing outside its own folders.
// Both copies are written as Bridge AI starts, when they differ from this version's.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './paths.js'
import { partsOf, search, excerpt } from '../shared/manualparse.js'
import { FOR_AGENTS } from './pointers.js'

export const SOURCE = path.join(ROOT, 'shared', 'manual.md')
export const AGENTS_FILE = path.join(FOR_AGENTS, 'manual.md')
let text = ''
let parts = []
let problem = null
function load() {
  try { text = fs.readFileSync(SOURCE, 'utf8'); parts = partsOf(text); problem = null } catch (e) { text = ''; parts = []; problem = `The manual couldn't be read (${e.code || e.message})` }
}
load()

export const problemNow = () => problem

// Its copies, for Chief of Staff (in its folder) and your agents. Written without blocking, each only
// when it differs.
export async function writeCopies(chiefDir) {
  if (!text) return
  for (const f of [AGENTS_FILE, chiefDir && path.join(chiefDir, 'manual.md')].filter(Boolean)) {
    try {
      await fs.promises.mkdir(path.dirname(f), { recursive: true })
      const was = await fs.promises.readFile(f, 'utf8').catch(() => null)
      if (was !== text) await fs.promises.writeFile(f, text)
    } catch { /* written as it next starts */ }
  }
}

// The parts that answer a question, for the agents' command (bin/bridge manual) and the API.
export const find = (q, n = 3) => search(parts, q, n).map(({ part, score }) => ({ id: part.id, title: part.title, path: part.path, setting: part.setting || null, text: excerpt(part, 2500), score: Math.round(score * 10) / 10 }))

// For a bot's brief: only for a question about Bridge AI itself (it names it), the best two parts,
// cut short. [] for anything else, so a bot answering about its own folders is given none of it.
export function forQuestion(question, { n = 2, max = 2400 } = {}) {
  if (!/\bbridge\b/i.test(String(question || ''))) return []
  const out = []
  let left = max
  for (const { part } of search(parts, question, n)) {
    if (left < 300) break
    const t = excerpt(part, Math.min(1400, left))
    out.push({ title: part.path.join(' › '), text: t })
    left -= t.length
  }
  return out
}

export function routes(app, wrap) {
  app.get('/api/manual/search', wrap((req) => ({ parts: find(String(req.query.q || ''), Math.min(10, Number(req.query.n) || 3)), problem })))
}
