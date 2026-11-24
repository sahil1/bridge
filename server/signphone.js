// Sign on Phone (Studio's signing pad): the pad on this computer asks your phone for the ink. The
// phone, through your relay as everything else it does here, gets a notification and a pad over its
// whole screen with Use and Cancel; what it draws comes back to the pad that asked, to look at and
// keep there. No new service: the request reaches the phone on its live feed (/api/events, event:
// sign) and as a push notification (push.js), and the answer is a request the phone makes, as any.
//   Who can get one, and answer it: only your own phones paired with this computer (not another
//   computer), kept (not New), and let in (Which Devices May Connect): checked when it's asked and
//   again when it's answered, by the device the relay says the answer came from.
//   Each request is for one signature or one set of initials, from one pad: it ends after 2 minutes,
//   or when either side cancels, or once it's answered. Its id and nonce are random and only sent
//   to the phones it's for; an answer for one that has ended, or a second answer, is refused.
//   Only the pad that asked follows it, cancels it and gets the ink: with a key given to it alone
//   (pad), not only by being the same kind of asker; a new request never ends another pad's. Both
//   screens show the same short code, so you can see the phone is answering the pad in front of
//   you. Asks are limited (a few a minute, a few waiting at once), so a phone isn't flooded with
//   notifications.
// What comes back is strokes (points as a share of the phone's pad), never a picture: the pad here
// draws them in its own ink, and nothing is kept until you keep it there.
import crypto from 'node:crypto'
import { limiterBy } from './signhelper.js'

// (BRIDGE_SIGN_PHONE_MS: shorter, for the tests that see one run out.)
const MS = Math.max(3000, Number(process.env.BRIDGE_SIGN_PHONE_MS) || 2 * 60_000)
const KEEP_ENDED = 10 * 60_000 // ended ones are remembered a while, to say so
const MAX_POINTS = 20000
const MAX_WAITING = 3 // waiting at once from one asker
const MAX_ALL = 20 // kept at all (waiting and ended)
// Each asker its own (your window, each phone), so one using up its own leaves the others theirs.
const asks = limiterBy(10, 60_000) // a minute
const pushes = limiterBy(4, 60_000) // notifications sent, a minute (more asks show on the phone's feed only)
const code = () => String(crypto.randomInt(0, 10000)).padStart(4, '0')
const reqs = new Map() // id -> { id, nonce, what, doc, asker, askerName, targets, until, state, strokes, by, at, waiters }
const err = (message, status, code) => Object.assign(new Error(message), { status, code })
let helpers = { phones: () => [], admits: () => false, tell: () => {}, notify: async () => {}, computer: () => 'your computer' }
export const setHelpers = (h) => { helpers = { ...helpers, ...h } }

const shownTo = (r) => ({ id: r.id, nonce: r.nonce, what: r.what, doc: r.doc, from: r.askerName, computer: helpers.computer(), until: r.until, state: r.state, code: r.code })
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y) }
const sweep = () => {
  for (const r of reqs.values()) {
    if (r.state === 'waiting' && r.until <= Date.now()) end(r, 'expired')
    if (r.state !== 'waiting' && Date.now() - r.at > KEEP_ENDED) reqs.delete(r.id)
  }
}
setInterval(sweep, 5000).unref()
function end(r, state, extra = {}) {
  if (r.state !== 'waiting') return
  Object.assign(r, { state, at: Date.now(), ...extra })
  clearTimeout(r.timer)
  for (const w of r.waiters.splice(0)) w()
  helpers.tell(r.targets)
}

// The phones a pad here can ask: [{ id, name, connected }], those it could reach now (connected, or
// one push wakes) only.
export const phones = () => helpers.phones().filter((p) => helpers.admits(p.id) && (p.connected || p.push))

// Asked by the pad (asker: who it is, signauth.who; askerName: its device's name), for what
// ('signature' or 'initials') and the document it's for (its name, said on the phone). to: one phone
// by id, or all that can be asked.
export async function ask({ asker, askerName, what = 'signature', doc = '', to = null }) {
  sweep()
  if (!['signature', 'initials'].includes(what)) throw err('Only a signature or initials', 400)
  const can = phones().filter((p) => (!to || p.id === to) && p.id !== asker.replace(/^d:/, ''))
  if (!can.length) throw err('No phone of yours can be asked now. Open Bridge AI on your phone (paired with this computer, and let in under Which Devices May Connect), then try again.', 409, 'no-phone')
  if ([...reqs.values()].filter((x) => x.asker === asker && x.state === 'waiting').length >= MAX_WAITING) throw err('Your phone is being asked already. Cancel that first, or wait for it.', 429, 'busy')
  if (!asks(asker)) throw err('Your phone was asked too often just now. Wait a minute and try again.', 429, 'too-often')
  if (reqs.size >= MAX_ALL) { const old = [...reqs.values()].find((x) => x.state !== 'waiting'); if (old) reqs.delete(old.id); else throw err('Too many requests waiting', 429, 'busy') }
  const r = { id: crypto.randomBytes(18).toString('base64url'), nonce: crypto.randomBytes(18).toString('base64url'), pad: crypto.randomBytes(24).toString('base64url'), code: code(), what, doc: String(doc || '').slice(0, 120), asker, askerName: String(askerName || '').slice(0, 60), targets: can.map((p) => p.id), until: Date.now() + MS, state: 'waiting', strokes: null, by: null, at: Date.now(), waiters: [] }
  r.timer = setTimeout(() => end(r, 'expired'), MS)
  r.timer.unref?.()
  reqs.set(r.id, r)
  helpers.tell(r.targets)
  if (pushes(asker)) await helpers.notify(r, shownTo(r)).catch(() => {})
  return { id: r.id, pad: r.pad, code: r.code, until: r.until, to: can.map((p) => ({ id: p.id, name: p.name })) }
}

// For the phone: the ones waiting for it (its live feed), and one by id (a notification tapped).
export const waitingFor = (device) => { sweep(); return device && helpers.admits(device) ? [...reqs.values()].filter((r) => r.state === 'waiting' && r.targets.includes(device)).map(shownTo) : [] }
function forPhone(id, device) {
  sweep()
  const r = reqs.get(String(id || ''))
  // The same answer for one that never was and one that isn't this device's.
  if (!r || !device || !r.targets.includes(device)) throw err('There\'s no such request to sign', 404, 'gone')
  if (!helpers.admits(device)) throw err('This device isn\'t let in here any more', 403, 'notLetIn')
  return r
}
export const one = (id, device) => shownTo(forPhone(id, device))

// The phone's answer: its strokes ({ w, h, strokes: [[[x, y, w], …], …] }), for that request, with
// its nonce, once.
export function answer(id, device, { nonce, ink } = {}) {
  const r = forPhone(id, device)
  if (r.state !== 'waiting') throw err(r.state === 'answered' ? 'This was signed already' : r.state === 'expired' ? 'This request ran out of time' : 'This request was cancelled', 409, r.state)
  const n = Buffer.from(String(nonce || '')), want = Buffer.from(r.nonce)
  if (n.length !== want.length || !crypto.timingSafeEqual(n, want)) throw err('This answer isn\'t for this request', 409, 'nonce')
  end(r, 'answered', { strokes: cleanInk(ink), by: device })
  return { ok: true }
}
// Cancelled on the phone, or by the pad that asked (its key).
export function cancel(id, { device = null, asker = null, pad = null } = {}) {
  sweep()
  const r = reqs.get(String(id || ''))
  if (!r || (device ? !r.targets.includes(device) : r.asker !== asker || !same(r.pad, pad))) throw err('There\'s no such request to sign', 404, 'gone')
  end(r, 'cancelled', { by: device ? 'phone' : 'computer' })
  return { ok: true }
}

// For the pad that asked (its key): how it stands, waiting up to wait ms for it to change.
export async function state(id, asker, pad, wait = 0) {
  sweep()
  const r = reqs.get(String(id || ''))
  if (!r || r.asker !== asker || !same(r.pad, pad)) throw err('There\'s no such request to sign', 404, 'gone')
  if (r.state === 'waiting' && wait > 0) await new Promise((resolve) => { const t = setTimeout(resolve, Math.min(wait, 25000)); r.waiters.push(() => { clearTimeout(t); resolve() }) })
  const out = { id: r.id, state: r.state, until: r.until, by: r.by ? helpers.phones().find((p) => p.id === r.by)?.name || null : null, cancelledBy: r.state === 'cancelled' ? r.by : null }
  // The ink goes to the pad once, and is forgotten here.
  if (r.state === 'answered' && r.strokes) { out.ink = r.strokes; r.strokes = null }
  return out
}

// Strokes as the phone sent them, checked: numbers in range, sizes kept.
function cleanInk(ink) {
  const w = Number(ink?.w), h = Number(ink?.h)
  if (!(w > 20 && w < 10000 && h > 20 && h < 10000) || !Array.isArray(ink?.strokes)) throw err('That isn\'t a signature', 400, 'ink')
  let n = 0
  const strokes = []
  for (const s of ink.strokes.slice(0, 200)) {
    if (!Array.isArray(s)) continue
    const pts = []
    for (const p of s) {
      if (++n > MAX_POINTS) break
      if (!Array.isArray(p)) continue
      const [x, y, pw] = p.map(Number)
      if ([x, y].every((v) => Number.isFinite(v) && v >= -0.05 && v <= 1.05)) pts.push([x, y, Number.isFinite(pw) ? Math.max(0.2, Math.min(12, pw)) : 2])
    }
    if (pts.length) strokes.push(pts)
  }
  if (!strokes.length) throw err('That isn\'t a signature: nothing was drawn', 400, 'ink')
  return { w: Math.round(w), h: Math.round(h), strokes }
}
// For the tests: none left.
export const reset = () => { for (const r of reqs.values()) clearTimeout(r.timer); reqs.clear() }
