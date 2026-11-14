// Who said what, by voice. In a room (your mic alone, so every line is "You"), the people around
// the table; on a call, the people on it (its sound is one for everyone, so every line of theirs is
// "Them"). They're told apart by their voices, on this computer: each line of the
// transcript gets a speaker embedding (a few hundred numbers for how a voice sounds) from a small
// model, 3D-Speaker's ERes2Net, run by sherpa-onnx in the speech engine's own process (asr.js), and
// lines that sound alike are grouped as Speaker 1, Speaker 2... You name a speaker once, from who
// was invited or yourself, and every line of theirs takes the name; or the notes model names them
// from what's said, as it does for a call.
//
// The model (26 MB) is downloaded the first time you ask for it (Who spoke, on a room meeting),
// with its progress on the meeting, never at setup; after that, room meetings get their speakers
// as they record when the computer has the cores to spare, else once they end. Only what can run
// here is offered (fit()): where sherpa-onnx runs, with 2 GB of memory or more.
//
// Kept in each meeting's folder: voices.jsonl (a line's embedding, as it's worked out) and
// voices.json ({ line: { key: speaker }, names: { speaker: { name, guess, me } }, speakers, at,
// src: you | them | both, side: { speaker: you | them } with both }).
// Remembering other people's voices for next time is yours to turn on (Settings › Voice & Meetings, off to
// start with): then a speaker you name is kept as one embedding with their name in
// <data>/meetings/voices.json, on this computer only, and Forget voices removes them all. Your own
// voice is learned by itself (unless that's turned off), from your mic on calls when it heard one
// voice there, so a room knows which voice is you. Your mic hearing several (a room on the call),
// it's learned only from the one that already sounds like you, else not at all.
//
// On a call, the voices are told apart once it ends, by themselves when the model is here (or it
// downloads, once, after a call with more than one other person), and while it records where the
// computer can spare the cores. A room on a call (people around you, on your mic with you) has its
// voices told apart too, with rooms turned on: each side's on its own, numbered together in the
// order they first spoke (src both). Your mic hearing one voice leaves its lines as You; a voice on
// your mic that sounds like one on the call is the call through your speakers, and stays unmarked.
// Where the call's video showed who was talking (sights.js, a beta feature), that goes too: a voice
// seen as two people at different places is two speakers, and two voices seen as one person are one.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DATA, writeFileAtomic } from './paths.js'
import { tool } from './fixes.js'
import * as speech from './speech.js'
import * as asr from './asr.js'
import * as sights from './sights.js'
import { machine } from './machine.js'

let cfg = {}
export const configure = (c) => { cfg = c || {} }
const RATE = 16000
const DIR = path.join(DATA, 'meetings')
const KNOWN = () => path.join(DIR, 'voices.json')
const dirOf = (id) => {
  if (!/^[\w-]+$/.test(String(id || ''))) throw new Error('No such meeting')
  return path.join(DIR, id)
}
const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }

// Two lines are one voice from this cosine similarity up; a speaker you named is known again from
// SAME_KNOWN. Lines shorter than LONG seconds say too little on their own: they join the speaker
// they sound most like, or stay unmarked.
// On voices made with macOS's say, the model put one voice's lines at 0.87 to 0.91 and different
// people at 0.52 at most.
const SAME = Number(process.env.BRIDGE_VOICES_SAME) || 0.65
const SAME_KNOWN = 0.7
const LONG = 1.5

// ---------- What this computer can do ----------
// fitVoices(machine, probe): { ok, why, live }. live: told apart while it records (four cores or
// more, so Parakeet keeps up); else once the meeting ends. Pure, so tests can ask about any computer.
export function fitVoices(m, { probe = null } = {}) {
  const r = speech.fitRuntime('sherpa', m, { probe })
  if (!r.ok) return { ok: false, why: r.why, live: false }
  if (m.memGB && m.memGB < speech.VOICE.memGB) return { ok: false, why: `Telling voices apart needs ${speech.VOICE.memGB} GB of memory; this computer has ${m.memGB} GB`, live: false }
  return { ok: true, why: null, live: !m.cores || m.cores >= 4 }
}
let fitted = null // { at, ok, why, live }
async function fit() {
  if (fitted && Date.now() - fitted.at < 10_000) return fitted
  const m = await machine()
  const probe = speech.fitRuntime('sherpa', m).ok ? await asr.probe() : null
  fitted = { at: Date.now(), ...fitVoices(m, { probe }) }
  return fitted
}

// ---------- Embeddings ----------
const enc = (v) => Buffer.from(new Float32Array(v).buffer).toString('base64')
const dec = (s) => { const b = Buffer.from(String(s || ''), 'base64'); return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)) }
const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n) }
const cos = (a, b) => { let s = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i]; return s }
const model = () => ({ key: 'voices', file: path.join(speech.dirOf(speech.VOICE), speech.filesOf(speech.VOICE)[0].name) })
const threads = () => Math.max(1, Math.min(2, Math.floor(os.cpus().length / 4)))
// A line's voice, from its sound (16 kHz mono PCM): normalized, or null when it's too short to say.
async function embed(pcm) {
  const r = await asr.embed(model(), pcm, { threads: threads() })
  return r.v?.length ? norm(r.v) : null
}
const embFile = (id) => path.join(dirOf(id), 'voices.jsonl')
const embeddings = (id) => {
  const out = new Map()
  for (const l of (() => { try { return fs.readFileSync(embFile(id), 'utf8').split('\n') } catch { return [] } })()) {
    try { const x = JSON.parse(l); out.set(x.key, { key: x.key, v: x.v ? dec(x.v) : null, s: x.s }) } catch { /* a line cut short */ }
  }
  return out
}
const keep = (id, key, v, s) => fs.appendFileSync(embFile(id), `${JSON.stringify({ key, v: v ? enc(v) : null, s: Math.round(s * 100) / 100 })}\n`)

// ---------- Grouping lines by voice ----------
// Lines that sound alike, as speakers numbered from 1 in the order they first spoke. Long lines
// make the groups (each joins the closest group from SAME up, else starts one; then each is moved to
// the group it's closest to, twice; groups that sound alike merge); a short one joins the closest
// group from a little under SAME, else stays unmarked. A group of one line under 3 seconds is
// dropped (a cough, a word from someone passing): its line joins the closest group, or stays unmarked.
// items: [{ key, v, s, t0 }] -> { line: { key: n }, centroids: { n: Float32Array }, speakers }
export function group(items, same = SAME) {
  const long = items.filter((x) => x.v && x.s >= LONG)
  let gs = []
  const centroid = (g) => norm(g.members.reduce((acc, x) => { for (let i = 0; i < acc.length; i++) acc[i] += x.v[i]; return acc }, new Float32Array(g.members[0].v.length)))
  for (const x of [...long].sort((a, b) => b.s - a.s)) {
    let best = null
    for (const g of gs) { const c = cos(g.c, x.v); if (c >= same && (!best || c > best.c)) best = { g, c } }
    if (best) { best.g.members.push(x); best.g.c = centroid(best.g) } else gs.push({ members: [x], c: x.v })
  }
  for (let pass = 0; pass < 2 && gs.length > 1; pass++) {
    const next = gs.map((g) => ({ members: [], c: g.c }))
    for (const x of long) { let bi = 0; for (let i = 1; i < gs.length; i++) if (cos(gs[i].c, x.v) > cos(gs[bi].c, x.v)) bi = i; next[bi].members.push(x) }
    gs = next.filter((g) => g.members.length).map((g) => ({ ...g, c: centroid(g) }))
  }
  for (let merged = true; merged && gs.length > 1;) {
    merged = false
    for (let i = 0; i < gs.length && !merged; i++) for (let j = i + 1; j < gs.length && !merged; j++) {
      if (cos(gs[i].c, gs[j].c) >= same) { gs[i].members.push(...gs[j].members); gs[i].c = centroid(gs[i]); gs.splice(j, 1); merged = true }
    }
  }
  gs = gs.filter((g) => g.members.length > 1 || g.members[0].s >= 2 * LONG || gs.length === 1)
  const line = {}
  const centroids = {}
  // Numbered in the order they first spoke.
  gs.sort((a, b) => Math.min(...a.members.map((x) => x.t0)) - Math.min(...b.members.map((x) => x.t0)))
  gs.forEach((g, i) => { centroids[i + 1] = g.c; for (const x of g.members) line[x.key] = i + 1 })
  for (const x of items.filter((y) => y.v && line[y.key] == null)) {
    let best = null
    gs.forEach((g, i) => { const c = cos(g.c, x.v); if (c >= same - 0.1 && (!best || c > best.c)) best = { n: i + 1, c } })
    if (best) line[x.key] = best.n
  }
  return { line, centroids, speakers: gs.length }
}

// ---------- A meeting's speakers ----------
const fileOf = (id) => path.join(dirOf(id), 'voices.json')
export const of = (id) => readJSON(fileOf(id), null)
const save = (id, v) => writeFileAtomic(fileOf(id), JSON.stringify(v, null, 2))
const keyOf = (l) => `${l.src}:${l.t0}`
// A room: your mic only, and nobody heard from a call.
export const isRoom = (lines) => lines.some((l) => l.src === 'you' && l.text) && !lines.some((l) => l.src === 'them' && l.text)
// The side whose voices are told apart: your mic's in a room, the call's on a call.
export const sideOf = (lines) => (lines.some((l) => l.src === 'them' && l.text) ? 'them' : 'you')
const callsOn = () => cfg.meetings?.callVoices !== false
const roomsOn = () => cfg.meetings?.roomVoices === true
// Every side told apart: your mic in a room; on a call the call's (unless that's off) and your mic's
// too with rooms on, for a room on the call. asked: Who spoke on a call, which tells the call's apart
// even with both off.
export const sidesOf = (lines, { asked = false } = {}) => {
  if (sideOf(lines) === 'you') return ['you']
  const s = [callsOn() && 'them', roomsOn() && 'you'].filter(Boolean)
  return s.length || !asked ? s : ['them']
}
// Told apart by itself once it ends: a room, with the model here and it turned on (or used once);
// a call, unless that's turned off, with the model here, or with more than one other person on it
// (guests: how many were invited besides you, null when nobody knows), when it downloads first; a
// room on a call, with rooms on and the model here.
export const wanted = (lines, { guests = null } = {}) => (isRoom(lines)
  ? roomsOn() && speech.have(speech.VOICE)
  : sideOf(lines) === 'them' && ((callsOn() && (speech.have(speech.VOICE) || guests == null || guests >= 2)) || (roomsOn() && speech.have(speech.VOICE))))

// One side's lines grouped by voice: [{ src, keys, c, first }], a group to a speaker.
const t0Of = (k) => Number(k.slice(k.indexOf(':') + 1))
function groupsOf(src, lines, embs) {
  const items = lines.filter((l) => l.src === src && embs.get(keyOf(l))?.v).map((l) => ({ key: keyOf(l), v: embs.get(keyOf(l)).v, s: embs.get(keyOf(l)).s, t0: l.t0 }))
  const g = group(items)
  return Object.entries(g.centroids).map(([n, c]) => {
    const keys = Object.entries(g.line).filter(([, m]) => String(m) === n).map(([k]) => k)
    return { src, keys, c, first: Math.min(...keys.map(t0Of)) }
  })
}
// A group's middle and first line again, once lines have moved: from its long lines, else all.
function redo(g, embs) {
  const vs = g.keys.map((k) => embs.get(k)).filter((x) => x?.v)
  const long = vs.filter((x) => x.s >= LONG)
  return { ...g, c: mean((long.length ? long : vs).map((x) => x.v)), first: Math.min(...g.keys.map(t0Of)) }
}
// What the call's video showed (sights.js): seen: { key: { who } }, the face seen talking as each line
// was said. A voice seen as two people, the second at least SEEN_LINES lines and a third of what was
// seen of it, is two speakers; two voices seen as the same person, most of what was seen of each,
// are one.
const SEEN_LINES = 3
function bySight(gs, seen, embs) {
  if (!seen.size || !gs.length) return gs
  const tally = (g) => {
    const v = new Map()
    for (const k of g.keys) { const s = seen.get(k); if (s) v.set(s.who, (v.get(s.who) || 0) + 1) }
    const t = [...v.entries()].sort((a, b) => b[1] - a[1])
    return { t, all: t.reduce((n, [, c]) => n + c, 0) }
  }
  const out = []
  for (const g of gs) {
    const { t, all } = tally(g)
    if (t.length < 2 || t[1][1] < SEEN_LINES || t[1][1] * 3 < all) { out.push(g); continue }
    const two = new Set(g.keys.filter((k) => seen.get(k)?.who === t[1][0]))
    out.push(redo({ ...g, keys: g.keys.filter((k) => !two.has(k)) }, embs), redo({ ...g, keys: [...two] }, embs))
  }
  const main = (g) => { const { t, all } = tally(g); return t[0] && t[0][1] >= SEEN_LINES && t[0][1] >= all * 0.7 ? t[0][0] : null }
  for (let merged = true; merged && out.length > 1;) {
    merged = false
    for (let i = 0; i < out.length && !merged; i++) for (let j = i + 1; j < out.length && !merged; j++) {
      const w = main(out[i])
      if (w && w === main(out[j])) { out[i] = redo({ ...out[i], keys: [...out[i].keys, ...out[j].keys] }, embs); out.splice(j, 1); merged = true }
    }
  }
  return out
}

// The lines grouped again (after each new one while it records, or all at once after), with the
// names given before kept by speaker, and a speaker you named in another meeting known again by
// voice when remembering is on. Each side on its own (sidesOf), then numbered together in the order
// they first spoke. asked: Who spoke, which tells a call's voices apart even with that turned off.
function regroup(id, lines, { asked = false } = {}) {
  const embs = embeddings(id)
  const sides = sidesOf(lines, { asked })
  const seen = sights.seen(id, lines)
  const parts = sides.map((src) => ({ src, gs: bySight(groupsOf(src, lines, embs), seen, embs) }))
  const call = parts.find((p) => p.src === 'them'), mic = parts.find((p) => p.src === 'you')
  // On a call, a voice on your mic that sounds like one on the call is the call through your speakers.
  if (call && mic) mic.gs = mic.gs.filter((g) => !call.gs.some((h) => cos(g.c, h.c) >= SAME))
  // With both sides, a side is told apart from two voices up: one on your mic is You, one on the call Them.
  const told = parts.length > 1 ? parts.filter((p) => p.gs.length >= 2) : parts
  const src = told.length > 1 || (told[0]?.src === 'you' && sideOf(lines) === 'them') ? 'both' : told[0]?.src || sides[0] || sideOf(lines)
  const all = told.flatMap((p) => p.gs).sort((a, b) => a.first - b.first)
  const line = {}, centroids = {}, side = {}
  all.forEach((g, i) => { centroids[i + 1] = g.c; side[i + 1] = g.src; for (const k of g.keys) line[k] = i + 1 })
  const was = of(id) || {}
  // A speaker keeps the name it had: the old speaker most of its lines were.
  const names = {}
  for (const [n] of Object.entries(centroids)) {
    const votes = {}
    for (const [k, m] of Object.entries(line)) if (String(m) === n && was.line?.[k] != null) votes[was.line[k]] = (votes[was.line[k]] || 0) + 1
    const old = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (old && was.names?.[old] && !Object.values(names).includes(was.names[old])) names[n] = was.names[old]
  }
  // Voices known from before: yours (learned from calls), on your mic, and the people you named
  // once when remembering is on. Your voice isn't looked for among the call's: you're on the mic.
  const known = readJSON(KNOWN(), { voices: [] }).voices.filter((k) => (k.me ? cfg.meetings?.learnVoice !== false : cfg.meetings?.rememberVoices === true))
  for (const [n, c] of Object.entries(centroids)) {
    if (names[n]) continue
    let best = null
    for (const k of known) { if (k.me && side[n] !== 'you') continue; const s = cos(dec(k.v), c); if (s >= SAME_KNOWN && (!best || s > best.s)) best = { k, s } }
    if (best && !Object.values(names).some((x) => x.name === best.k.name || (x.me && best.k.me))) names[n] = best.k.me ? { me: true, byVoice: true } : { name: best.k.name, guess: true, byVoice: true }
  }
  const out = { src, speakers: all.length, line, names, ...(src === 'both' ? { side } : {}), at: new Date().toISOString(), model: speech.VOICE.id }
  save(id, out)
  return out
}

// ---------- While it records ----------
// One line just transcribed, on a computer that can spare the cores, once the model is here: in a
// room, once you've turned it on (or used it once); on a call, the call's lines, unless that's off,
// and your mic's with rooms on.
// Its voice, and the speakers again.
const chains = new Map() // id -> promise: one meeting's lines in order
export async function heard(id, line, pcm, lines) {
  if (!speech.have(speech.VOICE)) return
  const all = lines.concat(line)
  const room = isRoom(all)
  if (room ? !roomsOn() : !sidesOf(all).includes(line.src)) return
  if (!(await fit()).ok || !fitted.live) return
  const run = (chains.get(id) || Promise.resolve()).then(async () => {
    const v = await embed(pcm).catch(() => null)
    keep(id, keyOf(line), v, pcm.length / RATE)
    regroup(id, all)
  }).catch(() => {})
  chains.set(id, run)
  return run
}

// ---------- After, or on request ----------
// Who spoke, on a room meeting: the model first (downloaded now if it isn't here, with progress
// in working(id)), then each line not done yet heard again from the recording, then the speakers.
const work = new Map() // id -> { state: downloading | listening, percent, error }
export const working = (id) => {
  const w = work.get(id)
  if (!w) return null
  if (w.state === 'downloading') { const d = speech.downloading(speech.VOICE.id); return { ...w, percent: d?.percent ?? w.percent, error: d?.error || w.error } }
  return w
}
const partOf = (f) => Number(/-(\d+)\.\w+$/.exec(f)?.[1] || 1)
// The lines' sound from the recording (audio-you.ogg or .wav, and its later parts), read once,
// in order, a line at a time: what's kept in memory is never much more than the line being heard.
async function fromRecording(id, todo, onLine, src = 'you') {
  const d = dirOf(id)
  const files = (await fs.promises.readdir(d)).filter((f) => new RegExp(`^audio-${src}(-\\d+)?\\.(ogg|wav)$`).test(f)).sort((a, b) => partOf(a) - partOf(b))
  if (!files.length) throw new Error('This meeting has no recording to hear the voices in')
  const ff = files.some((f) => f.endsWith('.ogg')) ? await tool('ffmpeg') : null
  if (files.some((f) => f.endsWith('.ogg')) && !ff) throw new Error('Telling voices apart in this recording needs ffmpeg, which reads it. Install it with Homebrew: brew install ffmpeg')
  const queue = [...todo].sort((a, b) => a.t0 - b.t0)
  let offset = 0 // samples before this file
  let held = { from: 0, data: new Int16Array(0) } // the samples kept: from where the next line starts
  for (const f of files) {
    if (!queue.length) break
    const stream = f.endsWith('.wav') ? fs.createReadStream(path.join(d, f), { start: 44 }) : spawn(ff, ['-hide_banner', '-loglevel', 'error', '-i', path.join(d, f), '-f', 's16le', '-ar', String(RATE), '-ac', '1', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] }).stdout
    let rest = null
    let read = 0
    for await (const b of stream) {
      const buf = rest ? Buffer.concat([rest, b]) : b
      const even = buf.length - (buf.length % 2)
      rest = even < buf.length ? buf.subarray(even) : null
      const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + even))
      const at = offset + read
      read += pcm.length
      const all = new Int16Array(held.data.length + pcm.length)
      all.set(held.data)
      all.set(pcm, held.data.length)
      held = { from: held.data.length ? held.from : at, data: all }
      // Every line that's whole now: its sound, then what's before the next one goes.
      while (queue.length && Math.round(queue[0].t1 * RATE) <= offset + read) {
        const l = queue.shift()
        const a = Math.max(0, Math.round(l.t0 * RATE) - held.from), z = Math.min(held.data.length, Math.round(l.t1 * RATE) - held.from)
        await onLine(l, held.data.slice(a, Math.max(a, z)))
      }
      const keepFrom = queue.length ? Math.round(queue[0].t0 * RATE) : offset + read
      if (keepFrom > held.from) { const cut = Math.min(held.data.length, keepFrom - held.from); held = { from: held.from + cut, data: held.data.slice(cut) } }
    }
    offset += read
  }
  // The recording ended before a line did (a clock a little out): what there is of it.
  for (const l of queue) { const a = Math.max(0, Math.round(l.t0 * RATE) - held.from); await onLine(l, held.data.slice(a)) }
}

// Tell the voices apart in a meeting. lines: its transcript (meetings.transcript, raw). Resolves
// with voices.json once done; starts the model's download first if it isn't here.
export async function tell(id, lines) {
  if (work.has(id) && !work.get(id).error) return { working: working(id) }
  const f = await fit()
  if (!f.ok) throw new Error(f.why || 'Telling voices apart can\'t run on this computer')
  const sides = sidesOf(lines, { asked: true })
  const w = { state: speech.have(speech.VOICE) ? 'listening' : 'downloading', percent: 0, error: null }
  work.set(id, w)
  w.done = (async () => {
    try {
      if (!speech.have(speech.VOICE)) {
        speech.fetchModel(speech.VOICE.id)
        await speech.downloaded(speech.VOICE.id)
        if (!speech.have(speech.VOICE)) throw new Error(speech.downloading(speech.VOICE.id)?.error || 'The voice model didn\'t download. Try again.')
        w.state = 'listening'
      }
      // Used once in a room, so room meetings from now on get their speakers by themselves
      // (Settings › Voice & Meetings turns it off).
      if (sideOf(lines) === 'you' && cfg.meetings?.roomVoices == null) await setting({ roomVoices: true })
      const done = embeddings(id)
      const todo = lines.filter((l) => sides.includes(l.src) && l.text && !done.has(keyOf(l)))
      let n = 0
      for (const src of sides) {
        const mine = todo.filter((l) => l.src === src)
        if (mine.length) await fromRecording(id, mine, async (l, pcm) => { keep(id, keyOf(l), pcm.length >= RATE / 2 ? await embed(pcm).catch(() => null) : null, pcm.length / RATE); w.percent = Math.round((++n / todo.length) * 100) }, src)
      }
      return regroup(id, lines, { asked: true })
    } catch (e) { w.error = e.message; throw e } finally { if (!w.error) work.delete(id); else setTimeout(() => { if (work.get(id) === w) work.delete(id) }, 60_000).unref?.() }
  })()
  w.done.catch(() => {})
  return { working: working(id) }
}
export const wait = (id) => work.get(id)?.done || Promise.resolve(of(id))

// ---------- Names ----------
// Name a speaker once (every line of theirs takes it): a name, or me (it's you), or null (back to
// Speaker n). guess: worked out by the notes model, not by you. A name you give is kept by voice
// for next time when remembering is on.
export async function name(id, n, { name: who = null, me = false, guess = false } = {}) {
  const v = of(id)
  if (!v || !v.speakers || !(Number(n) >= 1 && Number(n) <= v.speakers)) throw new Error('No such speaker in this meeting')
  const names = { ...(v.names || {}) }
  const clean = String(who || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (me) { for (const k of Object.keys(names)) if (names[k]?.me) delete names[k]; names[n] = guess ? { me: true, guess: true } : { me: true } }
  else if (clean) names[n] = guess ? { name: clean, guess: true } : { name: clean }
  else delete names[n]
  save(id, { ...v, names })
  if (!guess && (me ? cfg.meetings?.learnVoice !== false || cfg.meetings?.rememberVoices === true : clean && cfg.meetings?.rememberVoices === true)) remember(id, Number(n), me ? { me: true } : { name: clean })
  return { ok: true, names }
}
const mean = (vs) => norm(vs.reduce((acc, v) => { for (let i = 0; i < acc.length; i++) acc[i] += v[i]; return acc }, new Float32Array(vs[0].length)))
// Kept by voice: the speaker's lines' embeddings averaged with what's known of them already.
function remember(id, n, who) {
  const v = of(id)
  const embs = embeddings(id)
  const mine = Object.entries(v.line || {}).filter(([, m]) => m === n).map(([k]) => embs.get(k)).filter((x) => x?.v && x.s >= LONG)
  if (mine.length) keepKnown(id, who, mean(mine.map((x) => x.v)))
}
function keepKnown(id, who, c) {
  const all = readJSON(KNOWN(), { voices: [] }).voices.filter((k) => (who.me ? !k.me : k.name !== who.name))
  const was = readJSON(KNOWN(), { voices: [] }).voices.find((k) => (who.me ? k.me : k.name === who.name))
  const v2 = was ? norm(Float32Array.from(c, (x, i) => x + dec(was.v)[i])) : c
  all.push({ ...(who.me ? { me: true, name: null } : { name: who.name }), v: enc(v2), meetings: [...new Set([...(was?.meetings || []), id])].slice(-20), at: new Date().toISOString() })
  fs.mkdirSync(DIR, { recursive: true })
  writeFileAtomic(KNOWN(), JSON.stringify({ model: speech.VOICE.id, voices: all }, null, 2), { mode: 0o600 })
}

// ---------- Your voice ----------
// Learned from your mic on a call, once it ends, with the model here: every line on your mic is
// yours (the call's sound is apart), so your longest lines are heard again and averaged with what's
// known of you. Kept as you in voices.json, on this computer only (Settings › Voice & Meetings turns it
// off; Forget voices removes it), so a room knows which of its voices is you, with nobody naming it.
// Lines that don't sound like the rest (someone beside you, the call through your speakers) are
// left out. lines: the meeting's transcript, with your mic's echoes of the call taken out.
const MINE = 12
export async function learnMe(id, lines) {
  if (cfg.meetings?.learnVoice === false || !speech.have(speech.VOICE) || sideOf(lines) !== 'them') return null
  if (!(await fit()).ok) return null
  const mine = lines.filter((l) => l.src === 'you' && l.text && l.t1 - l.t0 >= 2 * LONG).sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0)).slice(0, MINE).sort((a, b) => a.t0 - b.t0)
  if (mine.length < 3) return null
  const heard = []
  await fromRecording(id, mine, async (l, pcm) => { const v = pcm.length >= RATE ? await embed(pcm).catch(() => null) : null; if (v) heard.push({ key: keyOf(l), v, s: l.t1 - l.t0, t0: l.t0 }) }, 'you')
  // More than one voice on your mic (a room on the call): only the one that sounds like you already,
  // else nothing, so someone beside you never becomes you.
  const g = group(heard)
  const big = Object.keys(g.centroids).filter((n) => Object.values(g.line).filter((m) => String(m) === n).length >= 2)
  let vs = heard.map((x) => x.v)
  if (big.length > 1) {
    const was = readJSON(KNOWN(), { voices: [] }).voices.find((k) => k.me)
    const best = was && big.map((n) => ({ n, s: cos(dec(was.v), g.centroids[n]) })).sort((a, b) => b.s - a.s)[0]
    if (!best || best.s < SAME_KNOWN) return { ok: false, several: true }
    vs = heard.filter((x) => String(g.line[x.key]) === best.n).map((x) => x.v)
  }
  if (vs.length < 3) return null
  const c = mean(vs)
  const alike = vs.filter((v) => cos(v, c) >= SAME)
  if (alike.length < 3) return null
  keepKnown(id, { me: true }, mean(alike))
  return { ok: true, lines: alike.length }
}
export const known = () => readJSON(KNOWN(), { voices: [] }).voices.map((k) => ({ name: k.name || null, me: !!k.me, meetings: (k.meetings || []).length, at: k.at }))
export function forget() { fs.rmSync(KNOWN(), { force: true }); return { ok: true } }

// For Settings and a meeting's page: whether it's offered here and why not, the model, a download
// going, and what's remembered.
let setting = async () => {}
export const setSaver = (fn) => { setting = fn }
export async function status() {
  const f = await fit()
  return { offered: f.ok, why: f.why, live: f.live, have: speech.have(speech.VOICE), mb: speech.VOICE.mb, license: speech.VOICE.license, by: speech.VOICE.by, label: speech.VOICE.label, downloading: speech.downloading(speech.VOICE.id), on: cfg.meetings?.roomVoices === true, calls: callsOn(), learn: cfg.meetings?.learnVoice !== false, mine: known().some((k) => k.me), remember: cfg.meetings?.rememberVoices === true, known: known().length }
}
