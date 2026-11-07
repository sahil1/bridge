// Messages on their way to an agent from a message box, kept on this device until your computer has
// them. Each has an id of its own (cid): when the connection drops before the answer comes (a phone
// on the move, the app sent to the background), it's sent again, and the computer, which has seen
// that id, answers as it did the first time rather than taking the message twice (server/index.js
// onlyOnce). One agent's messages go one after another, so they reach it in the order you sent them.
// Still here when the page opens again (it was closed or reloaded meanwhile): sent then. One older
// than the computer remembers ids for goes back in its agent's message box instead, so it neither
// goes twice nor is lost.
import { useSyncExternalStore } from 'react'
import { api, BASE } from './api.js'
import { t } from './i18n/index.js'

const KEY = `cc-sending${BASE}`
const OLD_MS = 20 * 60 * 1000 // the computer remembers an id for 30 minutes
const SHOWN_MS = { queue: 20000, steer: 20000, prompt: 120000 } // an answered one, until the fleet or the chat has it

const stored = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }
const store = (list) => { try { if (list.length) localStorage.setItem(KEY, JSON.stringify(list)); else localStorage.removeItem(KEY) } catch { /* private mode: this page only */ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const newCid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
// The connection failed, not the computer: no answer at all, or the relay saying it couldn't get one.
const lost = (e) => !e.status || e.status === 503

// What's on its way or just answered, for the chat to show: { cid, pane, way, text, at, answer? }.
let items = []
const landedIds = new Set() // listed by your computer (landed below)
const subs = new Set()
const tell = () => { items = [...items]; for (const fn of subs) fn() }
const put = (x) => { items = items.filter((y) => y.cid !== x.cid).concat(x); tell() }
const drop = (cid) => { items = items.filter((y) => y.cid !== cid); tell() }
const keep = (x) => store([...stored().filter((y) => y.cid !== x.cid), { cid: x.cid, pane: x.pane, way: x.way, text: x.text, at: x.at }])
const done = (cid) => store(stored().filter((y) => y.cid !== cid))

const lines = new Map() // pane -> its last message's sending
async function attempt(x) {
  for (let i = 0; ; i++) {
    try {
      const r = await api(`/agents/${encodeURIComponent(x.pane)}/${x.way}`, { method: 'POST', body: { text: x.text, cid: x.cid } })
      done(x.cid)
      // Kept by the phone for your computer while it's offline (the outbox shows it), or answered.
      if (r?.offline || landedIds.has(x.cid)) drop(x.cid)
      else { put({ ...x, answer: r, answeredAt: Date.now() }); setTimeout(() => drop(x.cid), SHOWN_MS[x.way] || 20000) }
      return r
    } catch (e) {
      if (!lost(e)) { done(x.cid); drop(x.cid); throw e }
      put({ ...x, waiting: true })
      await sleep([600, 1500, 3000, 6000][i] ?? 10000)
    }
  }
}

// What became of a message to `name`, by your computer's answer (never a guess): it went in, it's
// held for it until it's free (and where it is in line), or this phone keeps it until your
// computer is back.
export function sentTo(r, name) {
  if (r?.offline) return t('Waiting for your computer. It goes to {name} once it\'s back.', { name })
  if (!r?.queued) return t('Sent to {name}', { name })
  if (r.position > 1) return t('Queued for {name}, number {n} in line', { name, n: r.position })
  return r.position === 1 ? t('Queued for {name}, next in line', { name }) : t('Queued for {name}', { name })
}

// way: 'prompt' (typed in now, or held by the computer while the agent is busy), 'queue', or 'steer'
// (interrupt it, and this goes first). { cid, sent }: sent settles with the computer's answer, or
// fails with its refusal.
export function send(pane, way, text, cid = newCid()) {
  const x = { cid, pane, way, text, at: Date.now() }
  keep(x)
  put(x)
  const sent = (lines.get(pane) || Promise.resolve()).catch(() => {}).then(() => attempt(x))
  lines.set(pane, sent)
  sent.catch(() => {}).finally(() => { if (lines.get(pane) === sent) lines.delete(pane) })
  return { cid, sent }
}

// Your computer has it (its queue lists it, or it's gone to the agent): the chat shows it from
// there now, so not again from here once it's been sent or taken back.
export function landed(cids) {
  for (const c of cids) landedIds.add(c)
  const had = items.length
  items = items.filter((x) => !(x.answer && landedIds.has(x.cid)))
  if (items.length !== had) tell()
}

// One agent's messages on their way or just answered, oldest first.
const none = []
let byPane = new Map()
let byPaneOf = null
const forPane = (pane) => {
  if (byPaneOf !== items) {
    byPane = new Map()
    for (const x of items) byPane.set(x.pane, [...(byPane.get(x.pane) || []), x])
    byPaneOf = items
  }
  return byPane.get(pane) || none
}
export const useSending = (pane) => useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn) }, () => forPane(pane))

// What the last page left on its way: sent now (each agent's in order), or, too old to send safely,
// put back in its message box.
const draftKey = (pane) => `cc-draft-${pane}`
function backInBox(x) {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(x.pane))) || { text: '', files: [] }
    d.text = d.text.trim() ? `${x.text}\n\n${d.text}` : x.text
    localStorage.setItem(draftKey(x.pane), JSON.stringify(d))
  } catch { /* private mode */ }
}
export function resume() {
  const left = stored()
  if (!left.length) return
  for (const x of left.sort((a, b) => a.at - b.at)) {
    if (items.some((y) => y.cid === x.cid)) continue
    if (Date.now() - x.at > OLD_MS) { done(x.cid); backInBox(x); continue }
    put(x)
    const sent = (lines.get(x.pane) || Promise.resolve()).catch(() => {}).then(() => attempt(x))
    lines.set(x.pane, sent)
    // Refused now (the agent is gone, say): back in its message box rather than nowhere.
    sent.catch(() => backInBox(x))
  }
}
