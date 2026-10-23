// Questions Codex asks while it works (transcripts.js asksOf): the agent shows as needing you,
// with a card in Chat to answer them. The answer goes in as a message, each question quoted with
// your answer under it, the way Codex itself words an answer it kept for you. Codex takes a
// message while it works, so this doesn't wait for its turn to end.
import path from 'node:path'
import { asksOf } from './transcripts.js'

// Codex's terminal title: "<thread> | <folder>", with "[ ! ] Action Required | " in front while
// something waits on you. The folder is shown beside the name already.
const ACTION = /^\[ ! \] Action Required(?: \| )?/
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The question in one plain line, for a notification or the Terminal tab (Codex writes Markdown).
const flat = (t) => t.split('\n').map((l) => l.trim()).find(Boolean)?.replace(/\*\*|__|`/g, '').replace(/^#+\s*/, '').slice(0, 200) || ''

// Called on each agent as the fleet is built (index.js fleetView), before its name is settled.
export function decorate(a) {
  if (a.title) a.title = a.title.replace(ACTION, '')
  if (a.kind !== 'codex') return
  const folder = path.basename(a.cwd || '')
  if (a.title && folder) a.title = a.title.replace(new RegExp(` \\| ${escapeRe(folder)}$`), '')
  if (!a.sessionId) return
  let q = null
  try { q = asksOf(a) } catch { return }
  if (!q?.open.length) return
  // status: what it's doing meanwhile, for what goes by that (the message queue).
  a.asking = { count: q.open.length, title: flat(q.open[0].title), working: a.status === 'working', status: a.status }
  a.status = 'blocked'
}

// What a notification says for it (notify.js), or null.
export const askText = (a) => (a?.asking ? a.asking.title : null)

const quote = (s) => s.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')
export const answerText = (pairs) => pairs.map(({ title, answer }) => `${quote(title)}\n\n${answer}`).join('\n\n')

export function routes(app, { wrap, findAgent, sendPrompt }) {
  app.get('/api/agents/:pane/asks', wrap(async (req) => {
    const a = await findAgent(req.params.pane)
    const q = a.kind === 'codex' ? asksOf(a) : null
    return { questions: q?.open || [], working: !!q?.working }
  }))

  // { answers: [{ id, index, answer }] }: every question still open, in one message.
  app.post('/api/agents/:pane/asks', wrap(async (req) => {
    const a = await findAgent(req.params.pane)
    if (a.kind !== 'codex') throw new Error('Only Codex asks questions this way')
    const open = asksOf(a)?.open || []
    const given = Array.isArray(req.body?.answers) ? req.body.answers : []
    const pairs = []
    for (const g of given) {
      const q = open.find((o) => o.id === g?.id && o.index === Number(g?.index))
      const answer = String(g?.answer || '').trim()
      if (!q) throw Object.assign(new Error('That question was already answered or dropped. Look at the chat for where things stand.'), { code: 'answered' })
      if (!answer) throw new Error('Pick an answer or type one')
      if (answer.length > 8000) throw new Error('That answer is too long (8,000 characters at most)')
      pairs.push({ title: q.title, answer, at: open.indexOf(q) })
    }
    if (!pairs.length) throw new Error('Pick an answer or type one')
    pairs.sort((x, y) => x.at - y.at)
    const text = answerText(pairs)
    return { ...(await sendPrompt(req.params.pane, text, a)), text, left: open.length - pairs.length }
  }))
}
