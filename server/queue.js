// Messages typed while an agent is busy. The server holds them (so closing the phone
// doesn't lose them) and delivers each one when its agent next goes idle: in the order they were
// sent, one at a time, each exactly once and as it was written. Until it goes, one can be changed
// or taken back.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { cacheFile, writeFileAtomic } from './paths.js'
import { paneKey, inView, paneOfKey, adopt } from './scope.js'

const FILE = cacheFile('queue.json')
let q = {}
try { q = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { q = {} }
// Being typed in when the server stopped: it goes again (its agent may not have got it).
for (const list of Object.values(q)) for (const x of list || []) delete x.sending
const save = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomic(FILE, JSON.stringify(q, null, 2)) }
// Filed per herdr session (scope.js): only the session in view's messages show and go out.
const ours = () => { if (adopt(q)) save(); return Object.keys(q).filter(inView) }

// What's waiting, by pane: { id, text, at, now?, cid?, sending?, editing? } each, first to go first.
export const all = () => Object.fromEntries(ours().map((k) => [paneOfKey(k), q[k]]))
export const size = () => ours().reduce((n, k) => n + q[k].length, 0)

// Delivered lately, by pane: the app shows each as sent until the agent's chat has it, so a
// message never drops out of sight between leaving the queue and showing in the chat.
const SENT_MS = 3 * 60 * 1000
const sent = new Map() // pane key -> [{ id, cid, text, at }]
export function delivered() {
  const now = Date.now()
  const out = {}
  for (const [k, list] of sent) {
    const fresh = list.filter((x) => now - Date.parse(x.at) < SENT_MS)
    if (fresh.length) sent.set(k, fresh)
    else sent.delete(k)
    if (fresh.length && inView(k)) out[paneOfKey(k)] = fresh.map(({ id, cid, text, at }) => ({ id, ...(cid ? { cid } : {}), text, at }))
  }
  return out
}

// What the app sent under its own id (cid) and what came of it, for a while: a phone whose
// connection dropped before the answer came sends it again, and gets the same answer rather than
// the message going twice.
const ONCE_MS = 30 * 60 * 1000
const once = new Map() // cid -> { at, result }
export function recall(cid) {
  if (!cid) return null
  for (const [k, v] of once) if (Date.now() - v.at > ONCE_MS) once.delete(k)
  return once.get(cid)?.result || null
}
export function remember(cid, result) { if (cid) once.set(String(cid), { at: Date.now(), result }) }

// { now: true } puts it first and sends it as soon as the agent is back at its prompt: "send now",
// after the agent was interrupted. cid: the app's own id for it (see once), so it's held only once.
export function add(paneId, text, { now = false, cid = null } = {}) {
  ours()
  const k = paneKey(paneId)
  if (cid) {
    const had = (q[k] || []).find((x) => x.cid === cid) || (sent.get(k) || []).find((x) => x.cid === cid)
    if (had) return had
  }
  const item = { id: crypto.randomBytes(4).toString('hex'), text, at: new Date().toISOString(), ...(now ? { now: true } : {}), ...(cid ? { cid: String(cid).slice(0, 80) } : {}) }
  q[k] = now ? [item, ...(q[k] || [])] : [...(q[k] || []), item]
  save()
  return item
}

// Where a held message is in its agent's line (1: it goes next), or null once it's gone.
export function placeOf(paneId, id) {
  const i = (q[paneKey(paneId)] || []).findIndex((x) => x.id === id)
  return i < 0 ? null : i + 1
}

const gone = (k, id) => Object.assign(new Error((sent.get(k) || []).some((x) => x.id === id) ? 'Already sent: the agent has it.' : 'That message is no longer waiting.'), { code: 'gone' })
const going = () => Object.assign(new Error("It's going to the agent now."), { code: 'sending' })

// Taken back before it went. Refused once it's being typed in or has gone.
export function remove(paneId, id) {
  ours()
  const k = paneKey(paneId)
  const it = (q[k] || []).find((x) => x.id === id)
  if (!it) throw gone(k, id)
  if (it.sending) throw going()
  q[k] = q[k].filter((x) => x.id !== id)
  if (!q[k].length) delete q[k]
  save()
}

// Changed before it went: { text } puts the new words in its place; { editing: true } holds this
// agent's messages while you change it (for two minutes at most), { editing: false } lets them go.
const EDIT_MS = 2 * 60 * 1000
export function edit(paneId, id, { text, editing } = {}) {
  ours()
  const k = paneKey(paneId)
  const it = (q[k] || []).find((x) => x.id === id)
  if (!it) throw gone(k, id)
  if (it.sending) throw going()
  if (typeof text === 'string') {
    if (!text.trim()) throw new Error('Empty message')
    it.text = text.trim()
    delete it.editing
  } else if (editing) it.editing = new Date(Date.now() + EDIT_MS).toISOString()
  else delete it.editing
  save()
  return it
}

// A dialog, menu or question on screen means the agent isn't really at its prompt,
// even when herdr reports it idle/done (e.g. Claude's one-time "Teach auto mode" form).
// eslint-disable-next-line no-control-regex
const plain = (ansi) => String(ansi || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
const MODAL = /(enter to (continue|confirm|select|submit)|esc to (cancel|go back|exit|close)|do you want to|\(y\/n\)|\[y\/n\]|press enter|❯\s*\d+\.|to change · |allow .* \?|trust this folder)/i
export function looksBusy(screen) {
  const tail = plain(screen).split('\n').filter((l) => l.trim()).slice(-14).join('\n')
  return MODAL.test(tail)
}

const readySince = new Map()
// A pane missing from the fleet since when: given a while to come back (the server starting while
// its agents reopen, a terminal starting again) before what waits for it is let go.
const missing = new Map()
const MISSING_MS = 2 * 60 * 1000

// Send the oldest queued message to each agent that has been ready for a few seconds
// and has no dialog up. One per agent per pass: the agent goes busy again and the next
// one waits its turn.
export async function deliver(agents, prompt, readScreen) {
  let changed = false
  const live = new Set(agents.map((a) => a.paneId))
  for (const k of ours()) {
    const paneId = paneOfKey(k)
    if (!live.has(paneId)) {
      readySince.delete(k)
      if (!missing.has(k)) missing.set(k, Date.now())
      else if (Date.now() - missing.get(k) > MISSING_MS) {
        console.log(`Agent ${paneId} is gone; dropping the ${q[k].length} message(s) queued for it`)
        delete q[k]; missing.delete(k); changed = true
      }
      continue
    }
    missing.delete(k)
    const a = agents.find((x) => x.paneId === paneId)
    // A question Codex asked shows it as needing you (asks.js); a message can still go in.
    if (!['idle', 'done'].includes(a.asking?.status || a.status)) { readySince.delete(k); continue }
    const next = q[k][0]
    // Being changed: it (and so what's after it) waits until you're done, or two minutes.
    if (!next || next.sending || (next.editing && Date.parse(next.editing) > Date.now())) continue
    if (!readySince.has(k)) readySince.set(k, Date.now())
    if (Date.now() - readySince.get(k) < (next.now ? 400 : 3000)) continue
    try { if (looksBusy(await readScreen(paneId))) continue } catch { continue }
    // Taken out by its id once it's in, not by putting back what was there before: a message added,
    // changed or taken back while this one was being typed in stays as it is now.
    next.sending = true
    try {
      await prompt(paneId, next.text, a)
      q[k] = (q[k] || []).filter((x) => x.id !== next.id)
      if (!q[k].length) delete q[k]
      sent.set(k, [...(sent.get(k) || []), { id: next.id, cid: next.cid, text: next.text, at: new Date().toISOString() }])
      readySince.delete(k)
      a.status = 'working'
      changed = true
    } catch { /* try again next pass */ } finally { delete next.sending }
  }
  if (changed) save()
  return changed
}
