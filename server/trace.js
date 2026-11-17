// A bot's trace (Bots, a beta feature: frontdesk.js): everything it sees and does, kept on this
// computer as it happens, so all of its activity can be looked up, followed thread by thread and
// exported. It's the record itself, not a copy: the front desk's questions, Needs You's drafts and
// Settings › Bots › Activity are all read from it.
//
// One event per thing that happens (received, refused, queued, context, run.started, run.read,
// run.finished, draft, draft.edited, approval.asked, sent, discarded, posted.failed, reaction,
// status, file.uploaded, message.changed, message.deleted, memory.proposed, memory.kept,
// memory.edited, memory.deleted, change.proposed, change.approved, change.failed, pr.opened,
// forgotten, settings.changed, connection, trace.deleted), each a line of JSON: when, which bot and
// whose, Slack's team, channel, thread_ts and ts, the person, and the event's own fields. Never a
// token.
//
// Kept as JSON Lines, one file a month (bots/<id>/trace/2026-11.jsonl), readable by you only
// (0600), and only ever added to. Each line carries the hash of the line before it (prev), and the
// newest line's hash is kept beside them (head), so a line changed, added or taken out shows:
// check() walks the chain and says where it breaks. Older months go whole once they're past the
// time you keep it for (prune), and that is itself an event; the chain then starts at the oldest
// line kept.
//
// What a line's hash covers: everything in it, with each of the words people wrote (a text, the
// before and after of an edit, a message read as context, a memory's words) taken as their own
// hash. So someone's words can be blanked when they say !forget me (forget(): the words gone, their
// hash kept beside them in `blanked`) and the chain still holds, while the record that an exchange
// happened, when and with whom, stays as it was, and anything else changed in the line still shows.
// (Lines written before this, without v: 2, are hashed whole; one of those blanked keeps the hash it
// had in `was`, which then stands for it.)
//
// Beside the lines, files the events point to: each answering agent's transcript (runs/) and the
// diff of each change (changes/), in a folder a month, readable by you only, gzipped once they're a
// month old, and deleted with their month.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { writeFileAtomic } from './paths.js'

// How long it's kept, by the setting's value (days; null: for good).
export const KEEP = { '90d': 90, '1y': 365, forever: null }
export const keepOf = (v) => (Object.hasOwn(KEEP, v) ? v : '1y')
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const MONTH = /^(\d{4})-(\d{2})\.jsonl$/
const BESIDE = ['runs', 'changes'] // the files the events point to, a folder a month in each
const GZIP_DAYS = 30

// ---------- What a line's hash covers ----------
// The paths of the words people wrote in an event: its text, before and after; each message read as
// context and each pinned one; a memory's item.
export function wordPaths(e) {
  const out = []
  for (const k of ['text', 'before', 'after']) if (typeof e[k] === 'string') out.push(k)
  for (const k of ['messages', 'pins']) if (Array.isArray(e[k])) e[k].forEach((m, i) => { if (typeof m?.text === 'string') out.push(`${k}.${i}.text`) })
  if (e.item && typeof e.item.text === 'string') out.push('item.text')
  return out
}
const getAt = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o)
const setAt = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => (x == null ? x : x[k]), o); if (t != null) t[last] = v }
// The line as its hash sees it: each of the words as its own hash, the ones blanked by the hash
// kept for them.
function digestOf(e) {
  const d = JSON.parse(JSON.stringify(e))
  const blanked = d.blanked || {}
  delete d.blanked
  delete d.was
  for (const p of wordPaths(d)) setAt(d, p, `#${sha(getAt(d, p))}`)
  for (const [p, h] of Object.entries(blanked)) setAt(d, p, `#${h}`)
  return JSON.stringify(d)
}
// A line's hash: of its digest (v: 2), or of the line itself (older lines; `was` once blanked).
export function hashOfLine(raw, e = null) {
  let x = e
  if (!x) { try { x = JSON.parse(raw) } catch { return sha(raw) } }
  if (x?.v === 2) return sha(digestOf(x))
  return x?.was || sha(raw)
}

// dir: the bot's own folder. base(): what every event carries besides its own (the bot, its owner,
// the workspace).
export function makeTrace(dir, base = () => ({})) {
  const tdir = path.join(dir, 'trace')
  const HEAD = path.join(tdir, 'head')
  const months = () => { try { return fs.readdirSync(tdir).filter((f) => MONTH.test(f)).sort() } catch { return [] } }
  const linesOf = (f) => { try { return fs.readFileSync(path.join(tdir, f), 'utf8').split('\n').filter(Boolean) } catch { return [] } }
  // The newest line's hash, from the file (what's there is what the next line follows).
  let last
  const newest = () => {
    if (last !== undefined) return last
    last = null
    for (const f of months().reverse()) { const l = linesOf(f); if (l.length) { last = hashOfLine(l.at(-1)); break } }
    return last
  }

  // An event added: its line written at the end of this month's file, then the head.
  function append(type, fields = {}) {
    const prev = newest()
    const e = { at: new Date().toISOString(), type, v: 2, ...base(), ...fields, prev }
    const line = JSON.stringify(e)
    fs.mkdirSync(tdir, { recursive: true, mode: 0o700 })
    const file = path.join(tdir, `${e.at.slice(0, 7)}.jsonl`)
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 })
    last = hashOfLine(line, e)
    try { writeFileAtomic(HEAD, last, { mode: 0o600 }) } catch { /* the chain still says it */ }
    return e
  }

  // Every event, oldest first; from/to (ISO times) narrow it, a month's file read only when it can
  // hold some. A line that isn't JSON is skipped here (check() says so).
  function events({ from = null, to = null } = {}) {
    const out = []
    for (const f of months()) {
      const [, y, m] = MONTH.exec(f)
      const start = `${y}-${m}-01T00:00:00.000Z`
      const end = new Date(Date.UTC(Number(y), Number(m), 1)).toISOString()
      if ((from && end <= from) || (to && start > to)) continue
      for (const l of linesOf(f)) {
        let e
        try { e = JSON.parse(l) } catch { continue }
        if ((from && e.at < from) || (to && e.at > to)) continue
        out.push(e)
      }
    }
    return out
  }
  // The lines as written, for an export of the record itself.
  function lines({ from = null, to = null, keep = () => true } = {}) {
    const out = []
    for (const f of months()) for (const l of linesOf(f)) {
      let e
      try { e = JSON.parse(l) } catch { continue }
      if ((from && e.at < from) || (to && e.at > to) || !keep(e)) continue
      out.push(l)
    }
    return out
  }

  // Whether the chain holds: each line JSON, each one's prev the hash of the one before (across
  // months), and the newest the head kept beside them. The first line kept is taken as it is (the
  // one before it went with a month that was deleted). Remembered until a file changes.
  let checked = { sig: null, out: null }
  function check() {
    const files = months()
    const sig = files.map((f) => { try { const s = fs.statSync(path.join(tdir, f)); return `${f}:${s.size}:${s.mtimeMs}` } catch { return f } }).join('|') + (() => { try { return `|${fs.readFileSync(HEAD, 'utf8')}` } catch { return '' } })()
    if (checked.sig === sig) return checked.out
    let prev
    let n = 0
    let since = null
    let broken = null
    let first = null // where the first line kept is, when it follows one that isn't there
    let pruned = false // a month was deleted for its age, which explains that
    let blanked = 0
    for (const f of files) {
      const all = linesOf(f)
      for (let i = 0; i < all.length && !broken; i++) {
        let e
        try { e = JSON.parse(all[i]) } catch { broken = { file: f, line: i + 1, why: 'not a record' }; break }
        if (prev === undefined && e.prev != null) first = { file: f, line: i + 1, why: 'the lines before it are missing' }
        if (prev !== undefined && e.prev !== prev) broken = { file: f, line: i + 1, why: e.prev == null ? 'the line before it is missing' : 'the line before it was changed or taken out' }
        if (e.type === 'trace.deleted') pruned = true
        if (e.blanked) blanked++
        since ||= e.at
        prev = hashOfLine(all[i], e)
        n++
      }
      if (broken) break
    }
    if (!broken && first && !pruned) broken = first
    if (!broken && prev) {
      let head = null
      try { head = fs.readFileSync(HEAD, 'utf8').trim() } catch { /* none: nothing to compare */ }
      if (head && head !== prev) broken = { file: files.at(-1), line: linesOf(files.at(-1)).length, why: 'the newest line was changed, or lines were added or taken out at the end' }
    }
    checked = { sig, out: { ok: !broken, events: n, since, files: files.length, broken, blanked } }
    return checked.out
  }

  // Someone's words blanked where they're in it (!forget me): pick(e) gives the paths of the words to
  // blank in an event ([] for none). Each is set to null and its hash kept in `blanked`, so the chain
  // holds; a month's file is written whole again, as it was but for those. How many events changed.
  function forget(pick) {
    let n = 0
    for (const f of months()) {
      const all = linesOf(f)
      let changed = false
      const out = all.map((raw) => {
        let e
        try { e = JSON.parse(raw) } catch { return raw }
        const paths = (pick(e) || []).filter((p) => typeof getAt(e, p) === 'string')
        if (!paths.length) return raw
        if (e.v !== 2 && !e.was) e.was = sha(raw)
        e.blanked = { ...(e.blanked || {}) }
        for (const p of paths) { e.blanked[p] = sha(getAt(e, p)); setAt(e, p, null) }
        changed = true
        n++
        return JSON.stringify(e)
      })
      if (changed) writeFileAtomic(path.join(tdir, f), `${out.join('\n')}\n`, { mode: 0o600 })
    }
    if (n) checked = { sig: null, out: null }
    return n
  }

  // ---------- Files beside it ----------
  // A file kept beside the record (kind: runs or changes), in this month's folder: its path from the
  // trace folder, for the event that points to it.
  function keep(kind, name, content) {
    if (!BESIDE.includes(kind)) throw new Error(`No such kind of file: ${kind}`)
    const month = new Date().toISOString().slice(0, 7)
    const d = path.join(tdir, kind, month)
    fs.mkdirSync(d, { recursive: true, mode: 0o700 })
    const safe = String(name).replace(/[^\w.-]+/g, '-').slice(0, 120)
    writeFileAtomic(path.join(d, safe), content, { mode: 0o600 })
    return `${kind}/${month}/${safe}`
  }
  const inside = (rel) => { const p = path.resolve(tdir, String(rel || '')); return BESIDE.some((k) => p.startsWith(path.join(tdir, k) + path.sep)) ? p : null }
  // Its words back (gunzipped when it's been gzipped since), or null.
  function readKept(rel) {
    const p = inside(rel)
    if (!p) return null
    try { return fs.readFileSync(p) } catch { /* gzipped, perhaps */ }
    try { return zlib.gunzipSync(fs.readFileSync(`${p}.gz`)) } catch { return null }
  }
  function dropKept(rel) {
    const p = inside(rel)
    if (!p) return false
    let gone = false
    for (const f of [p, `${p}.gz`]) { try { fs.rmSync(f); gone = true } catch { /* not there */ } }
    return gone
  }
  // Those a month old, gzipped (the file's name stays, with .gz after it).
  function gzipOld() {
    const cut = Date.now() - GZIP_DAYS * 86400000
    let n = 0
    for (const kind of BESIDE) {
      let ms = []
      try { ms = fs.readdirSync(path.join(tdir, kind)) } catch { continue }
      for (const m of ms) {
        let fs2 = []
        try { fs2 = fs.readdirSync(path.join(tdir, kind, m)) } catch { continue }
        for (const f of fs2.filter((x) => !x.endsWith('.gz'))) {
          const p = path.join(tdir, kind, m, f)
          try {
            if (fs.statSync(p).mtimeMs > cut) continue
            writeFileAtomic(`${p}.gz`, zlib.gzipSync(fs.readFileSync(p)), { mode: 0o600 })
            fs.rmSync(p)
            n++
          } catch { /* next time */ }
        }
      }
    }
    return n
  }
  const dropMonth = (month) => { for (const kind of BESIDE) fs.rmSync(path.join(tdir, kind, month), { recursive: true, force: true }) }

  // Months wholly older than `days` ago, deleted (null: kept for good), with the files beside them.
  // What went, for the event.
  function prune(days) {
    if (days == null) return []
    const cut = new Date(Date.now() - days * 86400000)
    const gone = []
    for (const f of months()) {
      const [, y, m] = MONTH.exec(f)
      if (new Date(Date.UTC(Number(y), Number(m), 1)) > cut) continue
      try { fs.rmSync(path.join(tdir, f), { force: true }); dropMonth(f.replace(/\.jsonl$/, '')); gone.push(f.replace(/\.jsonl$/, '')) } catch { /* left for next time */ }
    }
    if (gone.length) { last = undefined; checked = { sig: null, out: null } }
    return gone
  }

  // Every month deleted (a bot's activity history, deleted when you said so): what went. The next
  // line starts the chain again.
  function clear() {
    const gone = months().map((f) => f.replace(/\.jsonl$/, ''))
    for (const f of months()) fs.rmSync(path.join(tdir, f), { force: true })
    for (const kind of BESIDE) fs.rmSync(path.join(tdir, kind), { recursive: true, force: true })
    fs.rmSync(HEAD, { force: true })
    last = undefined
    checked = { sig: null, out: null }
    return gone
  }

  return { append, events, lines, check, prune, clear, forget, keep, readKept, dropKept, gzipOld, dir: tdir }
}

// ---------- Export ----------
// For an audit: the events as CSV (one row each) or Markdown (each conversation, its events in
// order). JSON Lines is the record's own lines (lines() above).
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
// The words an event carries, whichever field holds them.
// (Words blanked by !forget me read as such.)
const FORGOTTEN = '(forgotten)'
export const wordsOf = (e) => (e.blanked?.text || e.blanked?.after ? FORGOTTEN : null) ?? e.text ?? e.after ?? e.item?.text ?? (e.blanked?.['item.text'] ? FORGOTTEN : null) ?? e.why ?? e.error ?? e.url ?? (e.messages ? e.messages.map((m) => `${m.person?.name || m.person?.id || '?'}: ${m.text ?? FORGOTTEN}`).join(' | ') : e.files ? e.files.map((x) => x.what || x.name).join(', ') : e.name ? `${e.removed ? 'removed' : 'added'} :${e.name}:` : e.setting ? `${e.setting}: ${JSON.stringify(e.old)} → ${JSON.stringify(e.new)}` : e.branch || e.what || e.command || '')
export function toCsv(events) {
  const head = ['at', 'type', 'conversation', 'question', 'channel', 'thread_ts', 'ts', 'person_id', 'person', 'words']
  return [head.join(','), ...events.map((e) => [e.at, e.type, e.conv, e.q, e.channel, e.thread_ts, e.ts, e.person?.id, e.person?.name, wordsOf(e)].map(csvCell).join(','))].join('\r\n') + '\r\n'
}
export function toMarkdown(events, { bot = '', where = (e) => e.where || e.channel || '' } = {}) {
  const by = new Map()
  for (const e of events) { const k = e.conv || '(the bot itself)'; if (!by.has(k)) by.set(k, []); by.get(k).push(e) }
  const out = [`# ${bot || 'Bot'}: activity`, '']
  for (const [k, list] of by) {
    const first = list.find((x) => x.type === 'received') || list[0]
    out.push(`## ${first.conv ? `${where(first) || 'Slack'}, ${first.at.slice(0, 16).replace('T', ' ')} UTC` : 'Connection and settings'}`, '', first.conv ? `Conversation \`${k}\`` : '', '')
    for (const e of list) {
      const words = String(wordsOf(e)).replace(/\s+/g, ' ').trim()
      out.push(`- ${e.at.slice(11, 19)} **${e.type}**${e.person?.name ? ` (${e.person.name})` : ''}${words ? `: ${words.length > 600 ? `${words.slice(0, 599)}…` : words}` : ''}`)
    }
    out.push('')
  }
  return out.join('\n')
}
