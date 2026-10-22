// Messages your phone sent while this computer was offline. Each one waited as a sealed note (see
// notes in relay/web/link.js): in your relay, or on the phone when the relay is older. Your
// computer takes them when it's back (relay.js), and each is opened here, checked, and sent on
// through this server the way the phone's own request would have been; the phone gets a receipt,
// sealed for it, saying what became of it.
//
// - Only paired phones: a note names the phone that sealed it (its key), which must be one you
//   paired and haven't removed, and only that phone could have sealed it for this computer.
// - Each note once: its id is kept after it's acted on, and a note older than it may wait (7 days,
//   with a day either way for the phone's clock) is refused, so one handed over again, or changed
//   on the way, never does anything. Ids are kept for as long as a note could still be accepted.
// - Only what a phone can leave: a message to an agent (sent, or held for when it's free, as
//   usual), or the answer to a question an agent is asking, if it's still the same question.
//
// Kept in ~/.bridge-ai/relay-inbox.json: each id, when, from which phone, and what became of it.
import fs from 'node:fs'
import path from 'node:path'
import { dataFile, ensureDir } from './paths.js'
import { parseScreen } from '../src/components/questionParse.js'
import { openNote, sealNote, unb64u, NOTE_DAYS } from '../relay/web/link.js'

const FILE = dataFile('relay-inbox.json')
const DAY = 24 * 3600 * 1000
const MAX_AGE = (NOTE_DAYS + 1) * DAY
const KEEP = (NOTE_DAYS + 2) * DAY
const SAY = /^\/api\/agents\/([^/]+)\/(prompt|queue)$/
const ANSWER = /^\/api\/panes\/([^/]+)\/input$/

let seen = null // id -> { at, device, ok, why, text, held, done }
function load() {
  if (seen) return seen
  try { seen = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { seen = {} }
  return seen
}
function save() {
  const now = Date.now()
  for (const [id, s] of Object.entries(seen)) if (now - s.at > KEEP) delete seen[id]
  ensureDir(path.dirname(FILE))
  fs.writeFileSync(FILE, JSON.stringify(seen), { mode: 0o600 })
}
const inflight = new Map() // id -> Promise of the outcome

// What the phone shows when it didn't go through.
const WHY = {
  'not-paired': 'this phone isn\'t paired with your computer anymore',
  expired: 'it waited more than 7 days',
  clock: 'the phone\'s clock is more than a day off',
  gone: 'the agent was closed',
  question: 'the question had already been answered or changed',
  'not-allowed': 'your computer only takes messages and answers while it\'s away',
  unsure: 'Bridge AI stopped while sending it. Check the agent',
}
const fail = (why, text) => ({ ok: false, why, text: text || WHY[why] || why })

// One note. `host` is this computer's key, `devices` the paired phones, `base` this server, and
// `from` (a phone's device id) when it came over that phone's own link rather than the relay.
// Returns { id, ok, why?, text?, held?, device?, receipt? }; a note that doesn't open (not a paired
// phone's, or changed on the way) gets no receipt: the relay could otherwise use it to say a
// message failed when it didn't.
export async function receive(note, { host, devices, base, from }) {
  const id = typeof note?.id === 'string' && /^[\w-]{22}$/.test(note.id) ? note.id : null
  if (!id || typeof note.d !== 'string') return { id, ok: false, why: 'bad' }
  const device = (devices || []).find((d) => d.key === note.d)
  let d
  try { d = unb64u(note.d) } catch { return { id, ok: false, why: 'bad' } }
  if (d.byteLength !== 65) return { id, ok: false, why: 'bad' }
  let plain
  try { plain = JSON.parse(new TextDecoder().decode(await openNote(host, d, note, 'up'))) } catch {
    console.warn(`relay: a message from a phone didn't open (changed on the way, or not for this computer); dropped ${id}`)
    return { id, ok: false, why: 'bad' }
  }
  const paired = device && (!from || from === device.id)
  if (!paired) console.warn(`relay: a message from a phone that isn't paired with this computer (any more) was refused: ${id}`)
  const outcome = paired ? await once(id, note, device, plain, base) : fail('not-paired')
  return { id, ...outcome, device: device?.id, receipt: await sealNote(host, d, JSON.stringify({ ...outcome, at: Date.now() }), 'down', { id }) }
}

// The id is checked, and marked, before anything is sent: a second copy waits for the first one's
// outcome and is never sent itself.
async function once(id, note, device, plain, base) {
  if (inflight.has(id)) return inflight.get(id)
  const s = load()[id]
  if (s) {
    console.log(`relay: message ${id} from a phone came again; not sent again`)
    return s.done ? pick(s) : fail('unsure')
  }
  const now = Date.now()
  if (now - note.at > MAX_AGE) return fail('expired')
  if (note.at - now > DAY) return fail('clock')
  seen[id] = { at: note.at, device: device.id, done: false }
  save()
  const p = deliver(plain, device, base).catch((e) => fail('error', e.message)).then((r) => {
    console.log(`relay: a message from ${device.name || 'a phone'} ${r.ok ? 'was delivered' : `wasn't delivered: ${r.text}`}`)
    seen[id] = { ...seen[id], ...r, done: true }
    save()
    inflight.delete(id)
    return pick(seen[id])
  })
  inflight.set(id, p)
  return p
}
const pick = ({ ok, why, text, held }) => (ok ? { ok, ...(held ? { held } : {}) } : { ok, why, text })

// Through this server, as the phone: the same routes, with the phone's own device id.
async function deliver(plain, device, base) {
  const call = async (m, u, body) => {
    const res = await fetch(new URL(u, base), { method: m, headers: { 'content-type': 'application/json', 'x-bridge-relay': device.id }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  }
  const u = String(plain?.u || '')
  const say = SAY.exec(u)
  const answer = ANSWER.exec(u)
  if (plain?.m !== 'POST' || (!say && !answer)) return fail('not-allowed')
  const pane = decodeURIComponent((say || answer)[1])
  // Right after Bridge AI starts, its agents may still be coming back (and showing their questions).
  let agent = null
  for (let i = 0; i < 8; i++) {
    const fleet = await call('GET', '/api/fleet')
    agent = fleet.json?.agents?.find((a) => a.paneId === pane) || null
    if ((agent && (say || agent.status === 'blocked')) || process.uptime() > 30) break
    await new Promise((r) => setTimeout(r, 3000))
  }
  if (!agent) return fail('gone')
  let r
  if (say) {
    const text = String(plain.b?.text || '').trim()
    if (!text) return fail('error', 'it was empty')
    // As the phone does: a busy agent that can't take messages while it works holds it until it's free.
    const route = agent.status === 'working' && !agent.caps?.typeAhead ? 'queue' : 'prompt'
    r = await call('POST', `/api/agents/${encodeURIComponent(pane)}/${route}`, { text })
    if (r.status < 300) return { ok: true, ...(route === 'queue' || r.json?.queued ? { held: true } : {}) }
  } else {
    // An answer: only to the question the phone saw, if it's still the one on screen.
    const want = plain.b?.expect
    const steps = Array.isArray(plain.b?.steps) ? plain.b.steps : null
    if (!want || !steps || agent.status !== 'blocked') return fail('question')
    const screen = await call('GET', `/api/agents/${encodeURIComponent(pane)}/screen?lines=60`)
    if (!sameQuestion(parseScreen(screen.json?.ansi), want)) return fail('question')
    r = await call('POST', `/api/panes/${encodeURIComponent(pane)}/input`, { steps })
    if (r.status < 300) return { ok: true }
  }
  return /^No (agent|pane)/.test(r.json?.error || '') ? fail('gone') : fail('error', r.json?.error || `your computer answered ${r.status}`)
}

// The question as Question.jsx shows it (src/components/questionParse.js, on both sides).
const sameQuestion = (q, want) => !!q && JSON.stringify([q.title || '', q.ask || [], q.options.map((o) => o.label)]) === JSON.stringify([want.title || '', want.ask || [], want.options || []])
