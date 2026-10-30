// Messages typed while an agent is busy. The server holds them (so closing the phone
// doesn't lose them) and delivers each one when its agent next goes idle.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { cacheFile, writeFileAtomic } from './paths.js'
import { paneKey, inView, paneOfKey, adopt } from './scope.js'

const FILE = cacheFile('queue.json')
let q = {}
try { q = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { q = {} }
const save = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomic(FILE, JSON.stringify(q, null, 2)) }
// Filed per herdr session (scope.js): only the session in view's messages show and go out.
const ours = () => { if (adopt(q)) save(); return Object.keys(q).filter(inView) }

export const all = () => Object.fromEntries(ours().map((k) => [paneOfKey(k), q[k]]))
export const size = () => ours().reduce((n, k) => n + q[k].length, 0)

// { now: true } puts it first and sends it as soon as the agent is back at its prompt: "send now",
// after the agent was interrupted.
export function add(paneId, text, { now = false } = {}) {
  const item = { id: crypto.randomBytes(4).toString('hex'), text, at: new Date().toISOString(), ...(now ? { now: true } : {}) }
  ours()
  const k = paneKey(paneId)
  q[k] = now ? [item, ...(q[k] || [])] : [...(q[k] || []), item]
  save()
  return item
}

export function remove(paneId, id) {
  ours()
  const k = paneKey(paneId)
  q[k] = (q[k] || []).filter((x) => x.id !== id)
  if (!q[k].length) delete q[k]
  save()
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

// Send the oldest queued message to each agent that has been ready for a few seconds
// and has no dialog up. One per agent per pass: the agent goes busy again and the next
// one waits its turn.
export async function deliver(agents, prompt, readScreen) {
  let changed = false
  const live = new Set(agents.map((a) => a.paneId))
  for (const k of ours()) {
    const paneId = paneOfKey(k)
    if (!live.has(paneId)) { delete q[k]; readySince.delete(k); changed = true; continue } // pane closed
    const a = agents.find((x) => x.paneId === paneId)
    // A question Codex asked shows it as needing you (asks.js); a message can still go in.
    if (!['idle', 'done'].includes(a.asking?.status || a.status)) { readySince.delete(k); continue }
    if (!readySince.has(k)) readySince.set(k, Date.now())
    if (Date.now() - readySince.get(k) < (q[k][0]?.now ? 400 : 3000)) continue
    try { if (looksBusy(await readScreen(paneId))) continue } catch { continue }
    const [next, ...rest] = q[k]
    try {
      await prompt(paneId, next.text, a)
      if (rest.length) q[k] = rest
      else delete q[k]
      readySince.delete(k)
      a.status = 'working'
      changed = true
    } catch { /* try again next pass */ }
  }
  if (changed) save()
  return changed
}
