// The names dictation spells the way they're written (shared/dictation/clean.js does the spelling,
// in the page): your agents, the agents and models Bridge AI knows, your projects, the branches your
// agents are on, and meeting memory (its names first, and how they've been misheard). Read from what
// the server already has; a git repo is only asked for its branches where looking can't bring up a
// macOS question (projects.mayLook), and never with a blocking call.
import path from 'node:path'
import { execFile } from 'node:child_process'
import { AGENTS } from './agents.js'
import { mayLook } from './projects.js'
import * as memory from './meetmemory.js'

// The words every Bridge AI has: its agents and the models they run.
const KNOWN = ['Bridge AI', 'Chief of Staff', 'Claude Code', 'Codex', 'Gemini', 'Copilot', 'GitHub', 'OpenCode', 'Cursor', 'Grok', 'Qwen', 'DeepSeek', 'Kimi', 'Ollama', 'LM Studio', 'OpenAI', 'Anthropic', 'Opus', 'Sonnet', 'Haiku', 'worktree', 'herdr', 'npm', 'pnpm', 'TypeScript', 'JavaScript', 'README']

const branches = new Map() // repo folder -> { at, list }
const git = (cwd, args) => new Promise((resolve) => execFile('git', ['-C', cwd, ...args], { timeout: 2000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out))))
async function branchesOf(cwd) {
  const hit = branches.get(cwd)
  if (hit && Date.now() - hit.at < 60_000) return hit.list
  const list = mayLook(cwd) ? (await git(cwd, ['for-each-ref', '--count=30', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'])).split('\n').map((s) => s.trim()).filter(Boolean) : []
  branches.set(cwd, { at: Date.now(), list })
  return list
}

// The same names for the speech engine to listen for (Parakeet's hotwords, voice.js): what was
// found last, at once, looked for again in the background when it's over a minute old, so a
// transcription never waits for a look at the projects or their branches. Not a plain lowercase
// word (a branch called main, a folder called billing): listening harder for those would only get
// in the way. sources() gives { fleet, projects } (index.js).
const nameLike = (t) => /[\p{Lu}\p{N}_-]/u.test(t) || /\s/.test(t)
let hinted = { at: 0, terms: [], busy: false }
export function hints(sources) {
  if (!hinted.busy && Date.now() - hinted.at > 60_000) {
    hinted.busy = true
    Promise.resolve().then(sources).then(words).then((w) => { hinted = { at: Date.now(), terms: w.terms.filter(nameLike), busy: false } }, () => { hinted = { ...hinted, at: Date.now(), busy: false } })
  }
  return hinted.terms
}

// { terms: [...], heard: [[heard, term]] }. fleet: the server's fleet; projects: projects.list().
export async function words({ fleet, projects = [] } = {}) {
  const terms = []
  const add = (t) => { const s = String(t || '').trim(); if (s && s.length <= 60 && !/^\d+$/.test(s)) terms.push(s) }
  const mem = memory.list()
  for (const t of mem) add(t.term)
  const agents = (fleet?.agents || []).filter((a) => !a.shellTab)
  // A title that's a sentence (a session's summary) isn't a name.
  for (const a of agents) for (const t of [a.title, a.tab, a.workspace]) if (t && String(t).split(/\s+/).length <= 3) add(t)
  for (const a of agents) { if (a.worktree?.branch) add(a.worktree.branch); if (a.worktree?.repo) add(path.basename(a.worktree.repo)); if (a.cwd) add(path.basename(a.cwd)) }
  const cwds = [...new Set(agents.map((a) => a.cwd).filter(Boolean))].slice(0, 12)
  for (const list of await Promise.all(cwds.map(branchesOf))) list.forEach(add)
  for (const p of projects.slice(0, 200)) add(p.name)
  for (const a of Object.values(AGENTS)) add(a.label)
  KNOWN.forEach(add)
  return { terms: [...new Set(terms)].slice(0, 3000), heard: mem.flatMap((t) => t.heard.map((h) => [h, t.term])) }
}

// ---------- Edit by voice ----------
// Select text in another app, hold the dictation key, say what to change: the text and what you said
// go to the model you picked in Settings › Voice (dictation.editModel), and its answer is pasted in
// the selection's place (src/dictation/Hud.jsx). Only that model sees them: one on this computer
// (Ollama, LM Studio) keeps them here; any other is labelled, where it's picked, as sending them out.
// reply: chatmodels.js reply.
const EDIT_SYSTEM = "You rewrite text as the user asks. You get the text and an instruction they said aloud, so the instruction may have speech-to-text slips. Answer with the rewritten text only: no quotes around it, no notes, no Markdown the text didn't have. Keep the text's language unless the instruction asks for another. If the instruction doesn't ask for a change to the text, answer with the text as it was."
export const EDIT_MAX = 20000
export async function edit({ text, instruction, model, reply }) {
  const t = String(text || '')
  const said = String(instruction || '').trim()
  if (!t.trim()) throw new Error('Nothing was selected to change')
  if (!said) throw new Error('Nothing was said about what to change')
  if (t.length > EDIT_MAX) throw new Error('That\'s more text than edit by voice takes (20,000 characters)')
  if (!model) throw new Error('Pick the model that rewrites it, in Settings › Voice › Dictation')
  const r = await reply(model, [{ role: 'user', text: `Instruction: ${said.slice(0, 2000)}\n\nText:\n${t}` }], { system: EDIT_SYSTEM })
  let out = String(r?.text || '').trim()
  // What models put around an answer anyway: a code fence, and quotes the text didn't have.
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(out)
  if (fenced) out = fenced[1].trim()
  if (/^["“'][\s\S]*["”']$/.test(out) && !/^["“']/.test(t.trim())) out = out.slice(1, -1).trim()
  if (!out) throw new Error('The model sent back nothing')
  return { text: out }
}
