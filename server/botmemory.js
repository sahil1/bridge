// What a bot remembers (Bots, a beta feature: frontdesk.js), in bots/<id>/memory.json, readable by
// you only. Three kinds: the bot's own (anything), each channel's, and each person's (their role,
// what they prefer, what they asked before). Learnings come from its answers (a REMEMBER: line its
// agent adds), from your edits to its drafts, and from someone saying "remember that…"; each is
// proposed, and kept only once you keep it (unless you said they're kept straight away). You see,
// edit and delete every item in Settings › Bots › Memory; only kept ones are given with a question,
// and only the bot's, that channel's and that person's. Someone's !forget me deletes theirs.
//
// An item: { id, kind: 'bot' | 'channel' | 'person', of (the channel's or person's Slack id), ofName,
//   text, source: 'remember' | 'edit' | 'asked' | 'owner' | 'import', from: { q, conv, person },
//   state: 'proposed' | 'kept', at, keptAt, by }
import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './paths.js'

export const TEXT_MAX = 500
const MAX_ITEMS = 2000
const KINDS = ['bot', 'channel', 'person']
const SOURCES = ['remember', 'edit', 'asked', 'owner', 'import']
const clean = (s, n) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

export function makeMemory(dir) {
  const FILE = path.join(dir, 'memory.json')
  let data = null
  let problem = null
  // (A file that's there but can't be read is said, in the record of each run it would have been
  // given to, and set aside before anything is written over it.)
  const load = () => {
    if (data) return data
    try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); data = { next: Number(j.next) || 1, items: Array.isArray(j.items) ? j.items : [] }; problem = null } catch (e) { data = { next: 1, items: [] }; problem = e.code === 'ENOENT' ? null : `memory.json couldn't be read (${e.code || e.message})` }
    return data
  }
  const save = () => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (problem) { try { fs.renameSync(FILE, path.join(dir, `memory.broken-${Date.now()}.json`)) } catch { /* gone already */ } problem = null }
    writeFileAtomic(FILE, JSON.stringify(load(), null, 2), { mode: 0o600 })
  }
  const find = (id) => load().items.find((x) => x.id === String(id)) || null

  // A new item: proposed, or kept at once (keep). One with the same words about the same one, kept
  // or waiting, isn't added twice: that one back.
  function add({ kind = 'bot', of = null, ofName = null, text, source = 'owner', from = null, keep = false, by = null } = {}) {
    const k = KINDS.includes(kind) ? kind : 'bot'
    const t = clean(text, TEXT_MAX)
    if (!t) throw new Error('Say what to remember')
    if (k !== 'bot' && !of) throw new Error(k === 'channel' ? 'Say which channel it\'s about' : 'Say who it\'s about')
    const d = load()
    const same = d.items.find((x) => x.kind === k && (x.of || null) === (k === 'bot' ? null : String(of)) && x.text.toLowerCase() === t.toLowerCase())
    if (same) return { item: same, added: false }
    if (d.items.length >= MAX_ITEMS) throw new Error(`It remembers ${MAX_ITEMS} things already: delete some first`)
    const now = new Date().toISOString()
    const item = { id: `m${d.next++}`, kind: k, of: k === 'bot' ? null : String(of), ofName: k === 'bot' ? null : clean(ofName, 80) || null, text: t, source: SOURCES.includes(source) ? source : 'owner', from: from || null, state: keep ? 'kept' : 'proposed', at: now, ...(keep ? { keptAt: now, by } : {}) }
    d.items.push(item)
    save()
    return { item, added: true }
  }
  function keep(id, by = null) {
    const x = find(id)
    if (!x) throw Object.assign(new Error('That isn\'t in its memory any more'), { status: 404 })
    if (x.state === 'kept') return { item: x, changed: false }
    Object.assign(x, { state: 'kept', keptAt: new Date().toISOString(), by })
    save()
    return { item: x, changed: true }
  }
  function edit(id, text, by = null) {
    const x = find(id)
    if (!x) throw Object.assign(new Error('That isn\'t in its memory any more'), { status: 404 })
    const t = clean(text, TEXT_MAX)
    if (!t) throw new Error('Say what to remember, or delete it')
    const before = x.text
    if (t === before) return { item: x, before, changed: false }
    Object.assign(x, { text: t, editedAt: new Date().toISOString(), by })
    save()
    return { item: x, before, changed: true }
  }
  function remove(id) {
    const d = load()
    const x = find(id)
    if (!x) throw Object.assign(new Error('That isn\'t in its memory any more'), { status: 404 })
    d.items = d.items.filter((y) => y !== x)
    save()
    return x
  }
  // A person's items, all gone (their !forget me): what went.
  function forgetPerson(personId) {
    const d = load()
    const gone = d.items.filter((x) => x.kind === 'person' && x.of === String(personId))
    if (gone.length) { d.items = d.items.filter((x) => !gone.includes(x)); save() }
    return gone
  }
  // What's given with a question: kept items only, the bot's, this channel's and this person's.
  const given = ({ channel = null, person = null } = {}) => load().items.filter((x) => x.state === 'kept' && (x.kind === 'bot' || (x.kind === 'channel' && x.of === channel) || (x.kind === 'person' && x.of === person)))
  const ofPerson = (personId, { kept = true } = {}) => load().items.filter((x) => x.kind === 'person' && x.of === String(personId) && (!kept || x.state === 'kept'))
  return { list: () => [...load().items], get: find, add, keep, edit, remove, forgetPerson, given, ofPerson, problem: () => { load(); return problem }, file: FILE, reset: () => { data = null } }
}
