// A bot's trace (Bots, a beta feature: frontdesk.js): everything it sees and does, kept on this
// computer as it happens, so all of its activity can be looked up, followed thread by thread and
// exported. It's the record itself, not a copy: the front desk's questions, Needs You's drafts and
// Settings › Bots › Activity are all read from it.
//
// One event per thing that happens (received, refused, context, run.started, run.read,
// run.finished, draft, draft.edited, sent, discarded, posted.failed, reaction, message.changed,
// message.deleted, settings.changed, connection, trace.deleted), each a line of JSON: when, which
// bot and whose, Slack's team, channel, thread_ts and ts, the person, and the event's own fields.
// Never a token.
//
// Kept as JSON Lines, one file a month (bots/<id>/trace/2026-11.jsonl), readable by you only
// (0600), and only ever added to. Each line carries the hash of the line before it (prev), and the
// newest line's hash is kept beside them (head), so a line changed, added or taken out shows:
// check() walks the chain and says where it breaks. Older months go whole once they're past the
// time you keep it for (prune), and that is itself an event; the chain then starts at the oldest
// line kept.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './paths.js'

// How long it's kept, by the setting's value (days; null: for good).
export const KEEP = { '90d': 90, '1y': 365, forever: null }
export const keepOf = (v) => (Object.hasOwn(KEEP, v) ? v : '1y')
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const MONTH = /^(\d{4})-(\d{2})\.jsonl$/

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
    for (const f of months().reverse()) { const l = linesOf(f); if (l.length) { last = sha(l.at(-1)); break } }
    return last
  }

  // An event added: its line written at the end of this month's file, then the head.
  function append(type, fields = {}) {
    const prev = newest()
    const e = { at: new Date().toISOString(), type, ...base(), ...fields, prev }
    const line = JSON.stringify(e)
    fs.mkdirSync(tdir, { recursive: true, mode: 0o700 })
    const file = path.join(tdir, `${e.at.slice(0, 7)}.jsonl`)
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 })
    last = sha(line)
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
    for (const f of files) {
      const all = linesOf(f)
      for (let i = 0; i < all.length && !broken; i++) {
        let e
        try { e = JSON.parse(all[i]) } catch { broken = { file: f, line: i + 1, why: 'not a record' }; break }
        if (prev === undefined && e.prev != null) first = { file: f, line: i + 1, why: 'the lines before it are missing' }
        if (prev !== undefined && e.prev !== prev) broken = { file: f, line: i + 1, why: e.prev == null ? 'the line before it is missing' : 'the line before it was changed or taken out' }
        if (e.type === 'trace.deleted') pruned = true
        since ||= e.at
        prev = sha(all[i])
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
    checked = { sig, out: { ok: !broken, events: n, since, files: files.length, broken } }
    return checked.out
  }

  // Months wholly older than `days` ago, deleted (null: kept for good). What went, for the event.
  function prune(days) {
    if (days == null) return []
    const cut = new Date(Date.now() - days * 86400000)
    const gone = []
    for (const f of months()) {
      const [, y, m] = MONTH.exec(f)
      if (new Date(Date.UTC(Number(y), Number(m), 1)) > cut) continue
      try { fs.rmSync(path.join(tdir, f), { force: true }); gone.push(f.replace(/\.jsonl$/, '')) } catch { /* left for next time */ }
    }
    if (gone.length) { last = undefined; checked = { sig: null, out: null } }
    return gone
  }

  return { append, events, lines, check, prune, dir: tdir }
}

// ---------- Export ----------
// For an audit: the events as CSV (one row each) or Markdown (each conversation, its events in
// order). JSON Lines is the record's own lines (lines() above).
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
// The words an event carries, whichever field holds them.
export const wordsOf = (e) => e.text ?? e.after ?? e.why ?? e.error ?? (e.messages ? e.messages.map((m) => `${m.person?.name || m.person?.id || '?'}: ${m.text}`).join(' | ') : e.files ? e.files.map((x) => x.what).join(', ') : e.name ? `${e.removed ? 'removed' : 'added'} :${e.name}:` : e.setting ? `${e.setting}: ${JSON.stringify(e.old)} → ${JSON.stringify(e.new)}` : e.what || '')
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
