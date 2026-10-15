// Messages typed while an agent is busy. The server holds them (so closing the phone
// doesn't lose them) and delivers each one when its agent next goes idle.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { cacheFile } from './paths.js'

const FILE = cacheFile('queue.json')
let q = {}
try { q = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { q = {} }
const save = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(q, null, 2)) }

export const all = () => q
export const size = () => Object.values(q).reduce((n, l) => n + l.length, 0)

// { now: true } puts it first and sends it as soon as the agent is back at its prompt: "send now",
// after the agent was interrupted.
export function add(paneId, text, { now = false } = {}) {
  const item = { id: crypto.randomBytes(4).toString('hex'), text, at: new Date().toISOString(), ...(now ? { now: true } : {}) }
  q[paneId] = now ? [item, ...(q[paneId] || [])] : [...(q[paneId] || []), item]
  save()
  return item
}

export function remove(paneId, id) {
  q[paneId] = (q[paneId] || []).filter((x) => x.id !== id)
  if (!q[paneId].length) delete q[paneId]
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
  for (const paneId of Object.keys(q)) {
    if (!live.has(paneId)) { delete q[paneId]; readySince.delete(paneId); changed = true; continue } // pane closed
    const a = agents.find((x) => x.paneId === paneId)
    if (!['idle', 'done'].includes(a.status)) { readySince.delete(paneId); continue }
    if (!readySince.has(paneId)) readySince.set(paneId, Date.now())
    if (Date.now() - readySince.get(paneId) < (q[paneId][0]?.now ? 400 : 3000)) continue
    try { if (looksBusy(await readScreen(paneId))) continue } catch { continue }
    const [next, ...rest] = q[paneId]
    try {
      await prompt(paneId, next.text, a)
      if (rest.length) q[paneId] = rest
      else delete q[paneId]
      readySince.delete(paneId)
      a.status = 'working'
      changed = true
    } catch { /* try again next pass */ }
  }
  if (changed) save()
  return changed
}
