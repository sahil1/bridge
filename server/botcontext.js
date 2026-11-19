// Each person's running context with a bot (Bots, a beta feature: frontdesk.js), in
// bots/<id>/people.json, readable by you only: a short account of their earlier conversations with
// it, so it can pick up where they left off. Each exchange is that person's own words and the
// answer it sent them, cut short, and nothing else (never someone else's words, never what it read
// to answer), and the account is that person's alone: given with a question only when they ask, and
// only when every word being answered is theirs, so it's never in an answer for anyone else. What
// was said in a direct message, or in a private channel, is given only in their direct messages or
// in that same place, so it can't come out where others would read it.
//
// It follows the bot's memory setting: off, nothing is kept or given; "once you approve", each
// exchange waits until you keep it (in Bridge AI, on the person's row of the bot's Conversations,
// where you can also forget all of it at once); straight away, it's kept as it happens. Someone's
// !forget me forgets theirs too. It's bounded (the latest exchanges, a few thousand characters a
// person, a few hundred people), and it stays with you: it isn't in a bot's export (only your own
// backup, sealed with your passphrase, and a Move to your own computer carry it: backup.js), nor
// shown anywhere but to you.
//
//   { v: 1, people: { <person id>: { name, at, kept: [exchange], proposed: [exchange] } } }
//   exchange: { q, conv, at, where: { kind, id, name, private }, asked, answered }
import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './paths.js'

const ASKED_MAX = 280 // their words, in an exchange
const ANSWERED_MAX = 400 // its answer
const PERSON_MAX = 4000 // a person's kept exchanges, all told, in characters
const EXCHANGES = 12 // kept, and waiting, a person
const PEOPLE = 500
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t }
const sizeOf = (x) => x.asked.length + x.answered.length + 40
// The latest exchanges that fit, oldest first.
const fit = (list) => {
  const out = []
  let n = 0
  for (const x of [...list].reverse()) { if (out.length >= EXCHANGES || n + sizeOf(x) > PERSON_MAX) break; out.unshift(x); n += sizeOf(x) }
  return out
}

export function makeContext(dir) {
  const FILE = path.join(dir, 'people.json')
  let data = null
  let problem = null
  // (A file that's there but can't be read is said, and set aside before anything is written over it.)
  const load = () => {
    if (data) return data
    try {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      data = { v: 1, people: j && typeof j.people === 'object' && j.people ? j.people : {} }
      problem = null
    } catch (e) {
      data = { v: 1, people: {} }
      problem = e.code === 'ENOENT' ? null : `people.json couldn't be read (${e.code || e.message})`
    }
    return data
  }
  const save = () => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (problem) { try { fs.renameSync(FILE, path.join(dir, `people.broken-${Date.now()}.json`)) } catch { /* gone already */ } problem = null }
    writeFileAtomic(FILE, JSON.stringify(load(), null, 1), { mode: 0o600 })
  }
  const one = (pid) => load().people[String(pid)] || null

  // An exchange with them, kept (keep) or waiting for you. Their name as they're known now.
  function add(person, x, { keep = false } = {}) {
    const pid = String(person?.id || '')
    if (!pid) return null
    const d = load()
    const p = d.people[pid] || { name: null, at: null, kept: [], proposed: [] }
    const ex = { q: String(x.q || ''), conv: String(x.conv || ''), at: x.at || new Date().toISOString(), where: x.where || null, asked: clip(x.asked, ASKED_MAX), answered: clip(x.answered, ANSWERED_MAX) }
    if (!ex.asked && !ex.answered) return null
    if ([...p.kept, ...p.proposed].some((y) => y.q && y.q === ex.q)) return null
    if (keep) p.kept = fit([...p.kept, ex])
    else p.proposed = [...p.proposed, ex].slice(-EXCHANGES)
    Object.assign(p, { name: clip(person.name, 80) || p.name, at: ex.at })
    d.people[pid] = p
    // (The people least lately heard from go first, past the most it keeps.)
    const ids = Object.keys(d.people)
    if (ids.length > PEOPLE) for (const id of ids.sort((a, b) => String(d.people[a].at).localeCompare(String(d.people[b].at))).slice(0, ids.length - PEOPLE)) delete d.people[id]
    save()
    return { state: keep ? 'kept' : 'proposed', exchange: ex }
  }
  // What waited for you, kept (or let go): how many.
  function keep(pid) {
    const p = one(pid)
    if (!p?.proposed.length) return 0
    const n = p.proposed.length
    p.kept = fit([...p.kept, ...p.proposed].sort((a, b) => String(a.at).localeCompare(String(b.at))))
    p.proposed = []
    save()
    return n
  }
  function drop(pid) {
    const p = one(pid)
    if (!p?.proposed.length) return 0
    const n = p.proposed.length
    p.proposed = []
    save()
    return n
  }
  // All of theirs, gone: { kept, proposed } (how many of each).
  function forget(pid) {
    const p = one(pid)
    if (!p) return { kept: 0, proposed: 0 }
    delete load().people[String(pid)]
    save()
    return { kept: p.kept.length, proposed: p.proposed.length }
  }
  // What's given with a question of theirs asked at `place`: what you've kept, less the conversation
  // it's part of (that's given as its own turns); in a channel, only what was said where others could
  // read it anyway, or there.
  function given(pid, { place = null, conv = null } = {}) {
    const p = one(pid)
    if (!p) return []
    const dm = place?.kind === 'dm'
    return p.kept.filter((x) => x.conv !== conv && (dm || !x.where?.private || x.where.id === place?.id))
  }
  return {
    add, keep, drop, forget, given,
    of: (pid) => { const p = one(pid); return p ? { id: String(pid), name: p.name, at: p.at, kept: [...p.kept], proposed: [...p.proposed] } : null },
    list: () => Object.entries(load().people).map(([id, p]) => ({ id, name: p.name, at: p.at, kept: p.kept.length, proposed: p.proposed.length })),
    // Why it couldn't be read, when it couldn't (null when it could, or isn't there yet).
    problem: () => { load(); return problem },
    file: FILE,
    reset: () => { data = null },
  }
}
