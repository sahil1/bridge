// Live words while you talk: what you've said so far, shown while dictation listens (the pill, the
// message box's recording bar) and under a meeting's transcript while someone is still talking.
// The page sends the sound as it comes, half a second at a time; this turns it into words with the
// same speech model and engine as the finished text (Parakeet, on this computer: speech.js,
// asr.js), so there's nothing more to download and nothing leaves the computer. The finished text
// is still the whole recording heard at once (voice.js), so it's as good as it was; these words are
// a preview of it.
//
// Parakeet hears a whole piece of sound at a time, not word by word, so the sound is heard again as
// it grows: from the last pause to now. At a pause (half a second of quiet after speech), or after
// 14 seconds without one, the words up to there are kept and not heard again, so each pass stays
// short however long you talk.
//
// Fit the machine: only where a dictation would use a sherpa-onnx model that's downloaded (not the
// Mac's own speech, not Whisper), and only where this computer keeps up. Each pass is timed; when
// hearing takes more than half as long as the sound itself (an older Intel Mac, a slow Windows
// laptop; one pass over 80% says so at once), live words stop for that dictation and for the next
// week on this computer, said once in Settings, and the words come when you let go, as before.
import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './paths.js'
import * as speech from './speech.js'

const RATE = 16000
const FRAME = 480 // 30 ms
// Hearing takes more than this share of the sound's length: too slow to keep up.
const SLOW = 0.5
const SLOW_FOR = 7 * 864e5
const MAX_SECONDS = 5 * 60

// ---------- How fast this computer hears, per model ----------
const SPEED = () => path.join(CACHE, 'livewords.json')
let speed = null // { [model id]: { rtf, slow, at } }
async function speeds() {
  if (speed) return speed
  try { speed = JSON.parse(await fs.promises.readFile(SPEED(), 'utf8')) } catch { speed = {} }
  return speed
}
async function noteSpeed(id, rtf, slow) {
  const s = await speeds()
  s[id] = { rtf: Math.round(rtf * 1000) / 1000, slow, at: Date.now() }
  try {
    await fs.promises.mkdir(CACHE, { recursive: true })
    const tmp = `${SPEED()}.${process.pid}.tmp`
    await fs.promises.writeFile(tmp, JSON.stringify(s))
    await fs.promises.rename(tmp, SPEED())
  } catch { /* kept in memory */ }
}
const tooSlow = (s, id) => !!s[id]?.slow && Date.now() - s[id].at < SLOW_FOR

// Whether live words can work here: { can, why }. why: 'off' (turned off in Settings), 'slow',
// or what speech.liveModel says ('apple', 'whisper', 'cant', 'model').
export async function status(cfg) {
  const lm = await speech.liveModel(cfg)
  const s = await speeds()
  const off = cfg?.dictation?.liveWords === false
  if (!lm.model) return { can: false, why: lm.why, off }
  if (tooSlow(s, lm.model.id)) return { can: false, why: 'slow', off, rtf: s[lm.model.id].rtf }
  return { can: !off, why: off ? 'off' : null, off, model: lm.model.label }
}

// ---------- Finding pauses ----------
// The levels of a stretch of samples, 30 ms at a time, and which are speech (above the quiet of the
// room, tracked as it goes, as meetings.js does).
function frames(pcm, from, to) {
  const out = []
  let floor = 0.003
  for (let i = from; i + FRAME <= to; i += FRAME) {
    let sum = 0
    for (let j = i; j < i + FRAME; j++) sum += (pcm[j] / 32768) ** 2
    const level = Math.sqrt(sum / FRAME)
    floor = level < floor ? level * 0.1 + floor * 0.9 : floor * 1.0005
    out.push({ at: i, level, speech: level > Math.max(0.008, floor * 3) })
  }
  return out
}
// Where to keep the words up to: the middle of the last pause (half a second of quiet after a
// second of speech) that ends a moment before now; else, after 14 seconds, the quietest moment in
// the last six; else null.
export function keepTo(pcm, from, to) {
  const f = frames(pcm, from, to)
  let voiced = 0
  let quiet = 0
  let best = null
  for (let i = 0; i < f.length; i++) {
    if (f[i].speech) { if (quiet >= 16 && voiced >= 30 && i < f.length - 5) best = f[i - Math.floor(quiet / 2)].at; voiced++; quiet = 0 } else quiet++
  }
  // Still quiet at the end, long enough after speech: up to the middle of that quiet.
  if (quiet >= 16 && voiced >= 30) best = f[f.length - Math.floor(quiet / 2)].at
  if (best) return best
  if (to - from < 14 * RATE) return null
  let at = f.length - 1
  for (let i = Math.max(0, f.length - 200); i < f.length; i++) if (f[i].level < f[at].level) at = i
  return f[at].at + FRAME
}

// ---------- A dictation's live words ----------
// sid -> { buf, n, cut, kept: [], tail, heardTo, busy, slow, ended, at, model, words, runs }
const sessions = new Map()
setInterval(() => { for (const [k, s] of sessions) if (Date.now() - s.at > 60_000) sessions.delete(k) }, 30_000).unref?.()
const textOf = (s) => [...s.kept, s.tail].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

// A piece of sound from a dictation (16-bit PCM, any length): what's been heard so far, at once
// (the next piece brings what's heard meanwhile). { live, text } or { live: false, why }.
export async function feed(sid, buf, { cfg, words = [] } = {}) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(sid || ''))) throw Object.assign(new Error('No such dictation'), { status: 400 })
  let s = sessions.get(sid)
  if (!s) {
    const st = await status(cfg)
    if (!st.can) return { live: false, why: st.why }
    const lm = await speech.liveModel(cfg)
    s = { buf: new Int16Array(RATE * 8), n: 0, cut: 0, kept: [], tail: '', heardTo: 0, busy: false, slow: false, ended: false, at: Date.now(), model: lm.model, words, runs: [] }
    sessions.set(sid, s)
  }
  s.at = Date.now()
  if (s.slow) return { live: false, why: 'slow' }
  const even = buf.length - (buf.length % 2)
  const add = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + even))
  if (s.n + add.length > s.buf.length) {
    if (s.n + add.length > MAX_SECONDS * RATE) return { live: false, why: 'long', text: textOf(s) }
    const bigger = new Int16Array(Math.max(s.buf.length * 2, s.n + add.length))
    bigger.set(s.buf.subarray(0, s.n))
    s.buf = bigger
  }
  s.buf.set(add, s.n)
  s.n += add.length
  hear(s)
  return { live: true, text: textOf(s) }
}
// Done (let go, Esc, or gone): nothing more is heard for it.
export function end(sid) {
  const s = sessions.get(sid)
  if (s) { s.ended = true; sessions.delete(sid) }
  return { ok: true }
}

// One pass: the sound since the last pause heard again, or the words up to a new pause kept. Then
// again while there's more than half a second not heard yet.
async function hear(s) {
  if (s.busy || s.ended || s.slow || s.n - s.heardTo < RATE / 2) return
  s.busy = true
  try {
    const to = s.n
    const keep = keepTo(s.buf, s.cut, to)
    const end = keep && keep > s.cut ? keep : to
    const pcm = s.buf.slice(s.cut, end)
    const r = await speech.decodeLive(s.model, pcm, s.words)
    if (s.ended) return
    if (keep && keep > s.cut) { if (r.text) s.kept.push(r.text); s.tail = ''; s.cut = keep; s.heardTo = keep } else { s.tail = r.text; s.heardTo = to }
    // How fast, on pieces long enough to tell: one far too slow, or two too slow on average, and
    // it stops.
    const secs = pcm.length / RATE
    if (secs >= 1) {
      const now = r.ms / 1000 / secs
      s.runs.push(now)
      const recent = s.runs.slice(-3)
      const rtf = recent.reduce((a, b) => a + b, 0) / recent.length
      if (now > SLOW * 1.6 || (s.runs.length >= 2 && rtf > SLOW)) { s.slow = true; noteSpeed(s.model.id, Math.max(rtf, now), true) } else if (s.runs.length === 3) noteSpeed(s.model.id, rtf, false)
    }
  } catch { s.slow = true } finally { s.busy = false }
  if (!s.slow && !s.ended) setImmediate(() => hear(s))
}

// ---------- A meeting's ----------
// The words in the stretch someone is still saying (meetings.js asks, at most every second and a
// half, while nothing else is being transcribed): its text, or null when live words can't work.
export async function stretch(pcm, { cfg, words = [] } = {}) {
  const st = await status(cfg)
  if (!st.can) return null
  const lm = await speech.liveModel(cfg)
  const r = await speech.decodeLive(lm.model, pcm, words)
  const secs = pcm.length / RATE
  if (secs >= 1.5 && r.ms / 1000 / secs > SLOW) { await noteSpeed(lm.model.id, r.ms / 1000 / secs, true); return null }
  return r.text
}
