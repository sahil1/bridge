// The chief of staff's own task list: standalone work it does itself (hand-offs to other agents
// stay in its ledger). Kept as markdown in its folder, state/tasks.md, so it reads fine anywhere,
// and changed only through here: the chief's `bridge task` commands and the Tasks panel both come
// this way, so they share one format. One line per item, its details indented under it:
//   - [ ] Draft the offsite agenda <!-- id:4 status:doing added:2026-10-22 -->
//   - [x] Compare the CRM quotes <!-- id:3 added:2026-10-20 done:2026-10-21 -->
//     Outcome: HubSpot is cheapest for 10 seats; only Salesforce has SSO.
//     File: work/crm-quotes/comparison.md
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './paths.js'

export const STATUSES = ['open', 'doing', 'waiting', 'done']
const ITEM = /^\s*- \[( |x|X)\] (.*?)\s*(?:<!--(.*?)-->)?\s*$/
const DETAIL = /^\s+(Outcome|File|Link|Needs):\s*(.*)$/i
const KEEP_DONE = 40
const today = () => new Date().toLocaleDateString('en-CA')
const oneLine = (s, n) => String(s ?? '').replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim().slice(0, n)
const RANK = { waiting: 0, doing: 1, open: 2 }

// dir: the chief's folder. you(): the name its instructions use, for a list made from scratch.
export function makeTasks(dir, you = () => 'the user') {
  const FILE = path.join(dir, 'state', 'tasks.md')
  const blank = () => {
    try { return fs.readFileSync(path.join(ROOT, 'chief', 'state', 'tasks.md'), 'utf8').replaceAll('{{name}}', you()) } catch { return '# Tasks\n' }
  }

  function read() {
    let text
    try { text = fs.readFileSync(FILE, 'utf8') } catch { text = blank() }
    const lines = text.split('\n')
    // The intro is everything above the first section or item; it's kept as written.
    const cut = lines.findIndex((l) => /^##\s/.test(l) || ITEM.test(l))
    const head = (cut < 0 ? lines : lines.slice(0, cut)).join('\n').trimEnd()
    const items = []
    for (const l of cut < 0 ? [] : lines.slice(cut)) {
      const m = ITEM.exec(l)
      if (m) {
        const meta = Object.fromEntries((m[3] || '').trim().split(/\s+/).filter(Boolean).map((kv) => kv.split(/:(.*)/s).slice(0, 2)))
        const status = m[1] !== ' ' ? 'done' : RANK[meta.status] != null ? meta.status : 'open'
        items.push({ id: meta.id ? String(meta.id) : null, title: m[2].trim(), status, added: meta.added || null, done: status === 'done' ? meta.done || null : null, from: meta.from || null, outcome: null, link: null, needs: null })
        continue
      }
      const d = DETAIL.exec(l)
      const it = items.at(-1)
      if (d && it) {
        const k = d[1].toLowerCase()
        if (k === 'outcome') it.outcome = d[2].trim() || null
        else if (k === 'needs') it.needs = d[2].trim() || null
        else it.link = d[2].trim() || null
      }
    }
    // A line written by hand gets the next number.
    let next = Math.max(0, ...items.map((x) => Number(x.id) || 0)) + 1
    for (const it of items) if (!it.id || !/^\d+$/.test(it.id)) Object.assign(it, { id: String(next++), added: it.added || today() })
    return { head, items }
  }

  function format(it) {
    const meta = [`id:${it.id}`, it.status !== 'done' && it.status !== 'open' && `status:${it.status}`, it.added && `added:${it.added}`, it.done && `done:${it.done}`, it.from && `from:${it.from}`].filter(Boolean).join(' ')
    const out = [`- [${it.status === 'done' ? 'x' : ' '}] ${it.title} <!-- ${meta} -->`]
    if (it.status === 'waiting' && it.needs) out.push(`  Needs: ${it.needs}`)
    if (it.status === 'done' && it.outcome) out.push(`  Outcome: ${it.outcome}`)
    if (it.link) out.push(`  ${/^https?:\/\//i.test(it.link) ? 'Link' : 'File'}: ${it.link}`)
    return out
  }

  // Open items newest first, then done ones, most recently finished first (the oldest drop off).
  const ordered = (items) => [
    ...items.filter((x) => x.status !== 'done').sort((a, b) => Number(b.id) - Number(a.id)),
    ...items.filter((x) => x.status === 'done').sort((a, b) => String(b.done || '').localeCompare(String(a.done || '')) || Number(b.id) - Number(a.id)).slice(0, KEEP_DONE),
  ]

  function write(head, items) {
    const all = ordered(items)
    const open = all.filter((x) => x.status !== 'done')
    const done = all.filter((x) => x.status === 'done')
    const text = [head || blank().split('\n## ')[0].trimEnd(), '', '## Open', '', ...open.flatMap(format), ...(open.length ? [''] : []), '## Done', '', ...done.flatMap(format), ''].join('\n')
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, text.replace(/\n{3,}/g, '\n\n'))
  }

  // A file the chief made: inside its folder it's kept relative to it (work/...), so the app can
  // open it in Files; anything else as given.
  function cleanLink(v) {
    const s = oneLine(v, 600)
    if (!s) return null
    if (/^https?:\/\//i.test(s)) return s
    const abs = path.isAbsolute(s) ? path.resolve(s) : null
    if (abs && (abs === path.resolve(dir) || abs.startsWith(path.resolve(dir) + path.sep))) return path.relative(dir, abs).split(path.sep).join('/') || '.'
    return s
  }

  const find = (items, id) => {
    const want = String(id ?? '').replace(/^#/, '').trim()
    const it = items.find((x) => x.id === want)
    if (!it) throw new Error(`No task ${want || '(no number)'} on the list`)
    return it
  }

  return {
    file: FILE,
    list() {
      const { items } = read()
      const open = items.filter((x) => x.status !== 'done').sort((a, b) => RANK[a.status] - RANK[b.status] || Number(b.id) - Number(a.id))
      return { items: [...open, ...ordered(items).filter((x) => x.status === 'done')], file: FILE, dir }
    },
    add(title, { status = 'open', from = null, link = null } = {}) {
      const t = oneLine(title, 200)
      if (!t) throw new Error('Say what the task is')
      if (!STATUSES.includes(status) || status === 'done' || status === 'waiting') status = 'open'
      const { head, items } = read()
      const it = { id: String(Math.max(0, ...items.map((x) => Number(x.id) || 0)) + 1), title: t, status, added: today(), done: null, from: from ? oneLine(from, 20).replace(/\s/g, '') : null, outcome: null, link: cleanLink(link), needs: null }
      write(head, [...items, it])
      return it
    },
    update(id, patch = {}) {
      const { head, items } = read()
      const it = find(items, id)
      if (patch.title !== undefined) it.title = oneLine(patch.title, 200) || it.title
      if (patch.status !== undefined) {
        if (!STATUSES.includes(patch.status)) throw new Error(`Status is one of ${STATUSES.join(', ')}`)
        if (patch.status === 'done' && it.status !== 'done') it.done = today()
        if (patch.status !== 'done') { it.done = null; it.outcome = null }
        if (patch.status !== 'waiting') it.needs = null
        it.status = patch.status
      }
      if (patch.needs !== undefined) it.needs = oneLine(patch.needs, 300) || null
      if (patch.outcome !== undefined) it.outcome = oneLine(patch.outcome, 400) || null
      if (patch.link !== undefined) it.link = cleanLink(patch.link)
      write(head, items)
      return it
    },
  }
}
