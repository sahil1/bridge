// Ideas backlog kept as a plain markdown checklist (~/.bridge-ai/ideas.md) so it reads and
// edits fine in any notes app or editor too. Metadata rides in a trailing HTML comment, hidden in reading view:
//   - [ ] Web push to the phone #dashboard <!-- id:k3x9 added:2026-10-05 sent:2026-10-06 -->
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataFile, writeFileAtomic } from './paths.js'

const FILE = dataFile('ideas.md')
const today = () => new Date().toLocaleDateString('en-CA')
const HEADER = `# Ideas\n\nThings to pick up in free time. Managed from Bridge AI (Today › Ideas); editing here is fine too.\n\n`

const LINE = /^(\s*)- \[( |x|X)\] (.*?)\s*(?:<!--(.*?)-->)?\s*$/

function parse() {
  let text = ''
  try { text = fs.readFileSync(FILE, 'utf8') } catch { return { lines: [], items: [] } }
  const lines = text.split('\n')
  const items = []
  lines.forEach((l, i) => {
    const m = LINE.exec(l)
    if (!m) return
    const meta = Object.fromEntries((m[4] || '').trim().split(/\s+/).filter(Boolean).map((kv) => kv.split(/:(.*)/s).slice(0, 2)))
    const body = m[3]
    const tags = [...body.matchAll(/(^|\s)#([\w/-]+)/g)].map((t) => t[2])
    items.push({
      line: i, id: meta.id || `L${i}`, done: m[2] !== ' ',
      text: body.replace(/(^|\s)#[\w/-]+/g, '').trim(), raw: body, tags,
      added: meta.added || null, sent: meta.sent || null, doneAt: meta.done || null,
    })
  })
  return { lines, items }
}

function format(it) {
  const meta = [`id:${it.id}`, it.added && `added:${it.added}`, it.sent && `sent:${it.sent}`, it.doneAt && `done:${it.doneAt}`].filter(Boolean).join(' ')
  const tags = it.tags.length ? ' ' + it.tags.map((t) => `#${t}`).join(' ') : ''
  return `- [${it.done ? 'x' : ' '}] ${it.text}${tags} <!-- ${meta} -->`
}

function save(lines) { writeFileAtomic(FILE, lines.join('\n')) }

export function list() {
  return { items: parse().items, file: FILE }
}

export function add(raw) {
  const body = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!body) throw new Error('Empty idea')
  const tags = [...body.matchAll(/(^|\s)#([\w/-]+)/g)].map((t) => t[2])
  const it = { id: crypto.randomBytes(3).toString('hex'), done: false, text: body.replace(/(^|\s)#[\w/-]+/g, '').trim(), tags, added: today() }
  if (!fs.existsSync(FILE)) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, HEADER) }
  const { lines } = parse()
  // New ideas go on top of the list (just under the intro).
  const first = lines.findIndex((l) => LINE.test(l))
  if (first < 0) { if (lines.at(-1) === '') lines.pop(); lines.push(format(it), '') } else lines.splice(first, 0, format(it))
  save(lines)
  return it
}

export function update(id, patch) {
  const { lines, items } = parse()
  const it = items.find((x) => x.id === id)
  if (!it) throw new Error('No such idea')
  if (patch.text !== undefined) {
    const body = String(patch.text).trim()
    it.tags = [...body.matchAll(/(^|\s)#([\w/-]+)/g)].map((t) => t[2])
    it.text = body.replace(/(^|\s)#[\w/-]+/g, '').trim()
  }
  if (patch.done !== undefined) { it.done = !!patch.done; it.doneAt = it.done ? today() : null }
  if (patch.sent) it.sent = today()
  if (it.id.startsWith('L')) it.id = crypto.randomBytes(3).toString('hex') // hand-written line gets a stable id
  lines[it.line] = format(it)
  save(lines)
  return it
}

export function remove(id) {
  const { lines, items } = parse()
  const it = items.find((x) => x.id === id)
  if (!it) throw new Error('No such idea')
  lines.splice(it.line, 1)
  save(lines)
}
