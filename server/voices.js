// Who said what in a room. With your mic alone (no call's sound, so every line is "You"), the
// people around the table are told apart by their voices, on this computer: each line of the
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
// voices.json ({ line: { key: speaker }, names: { speaker: { name, guess, me } }, speakers, at }).
// Remembering voices for next time is yours to turn on (Settings › Meetings, off to start with):
// then a speaker you name is kept as one embedding with their name in <data>/meetings/voices.json,
// on this computer only, and Forget voices removes them all.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DATA, writeFileAtomic } from './paths.js'
import { tool } from './fixes.js'
import * as speech from './speech.js'
import * as asr from './asr.js'
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
// Told apart by itself once it ends: a room, with the model here and it turned on (or used once).
export const wanted = (lines) => cfg.meetings?.roomVoices === true && speech.have(speech.VOICE) && isRoom(lines)

// The lines grouped again (after each new one while it records, or all at once after), with the
// names given before kept by speaker, and a speaker you named in another meeting known again by
// voice when remembering is on.
function regroup(id, lines) {
  const embs = embeddings(id)
  const items = lines.filter((l) => l.src === 'you' && embs.get(keyOf(l))?.v).map((l) => ({ key: keyOf(l), v: embs.get(keyOf(l)).v, s: embs.get(keyOf(l)).s, t0: l.t0 }))
  const g = group(items)
  const was = of(id) || {}
  // A speaker keeps the name it had: the old speaker most of its lines were.
  const names = {}
  for (const [n] of Object.entries(g.centroids)) {
    const votes = {}
    for (const [k, m] of Object.entries(g.line)) if (String(m) === n && was.line?.[k] != null) votes[was.line[k]] = (votes[was.line[k]] || 0) + 1
    const old = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (old && was.names?.[old] && !Object.values(names).includes(was.names[old])) names[n] = was.names[old]
  }
  if (cfg.meetings?.rememberVoices === true) {
    const known = readJSON(KNOWN(), { voices: [] }).voices
    for (const [n, c] of Object.entries(g.centroids)) {
      if (names[n]) continue
      let best = null
      for (const k of known) { const s = cos(dec(k.v), c); if (s >= SAME_KNOWN && (!best || s > best.s)) best = { k, s } }
      if (best && !Object.values(names).some((x) => x.name === best.k.name || (x.me && best.k.me))) names[n] = best.k.me ? { me: true, byVoice: true } : { name: best.k.name, guess: true, byVoice: true }
    }
  }
  const out = { speakers: g.speakers, line: g.line, names, at: new Date().toISOString(), model: speech.VOICE.id }
  save(id, out)
  return out
}

// ---------- While it records ----------
// One line just transcribed, in a room meeting, on a computer that can spare the cores, once the
// model is here and you've turned it on (or used it once): its voice, and the speakers again.
const chains = new Map() // id -> promise: one meeting's lines in order
export async function heard(id, line, pcm, lines) {
  if (cfg.meetings?.roomVoices !== true || !speech.have(speech.VOICE)) return
  if (!isRoom(lines) || !(await fit()).ok || !fitted.live) return
  const run = (chains.get(id) || Promise.resolve()).then(async () => {
    const v = await embed(pcm).catch(() => null)
    keep(id, keyOf(line), v, pcm.length / RATE)
    regroup(id, lines.concat(line))
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
async function fromRecording(id, todo, onLine) {
  const d = dirOf(id)
  const files = (await fs.promises.readdir(d)).filter((f) => /^audio-you(-\d+)?\.(ogg|wav)$/.test(f)).sort((a, b) => partOf(a) - partOf(b))
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
  if (!isRoom(lines)) throw new Error('This meeting has the call\'s sound, so it already says who was on the call (Them). Telling voices apart is for a room with your mic only.')
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
      // Used once, so room meetings from now on get their speakers by themselves (Settings ›
      // Meetings turns it off).
      if (cfg.meetings?.roomVoices == null) await setting({ roomVoices: true })
      const done = embeddings(id)
      const todo = lines.filter((l) => l.src === 'you' && l.text && !done.has(keyOf(l)))
      let n = 0
      if (todo.length) await fromRecording(id, todo, async (l, pcm) => { keep(id, keyOf(l), pcm.length >= RATE / 2 ? await embed(pcm).catch(() => null) : null, pcm.length / RATE); w.percent = Math.round((++n / todo.length) * 100) })
      return regroup(id, lines)
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
  if (cfg.meetings?.rememberVoices === true && !guess && (me || clean)) remember(id, Number(n), me ? { me: true } : { name: clean })
  return { ok: true, names }
}
// Kept by voice: the speaker's lines' embeddings averaged with what's known of them already.
function remember(id, n, who) {
  const v = of(id)
  const embs = embeddings(id)
  const mine = Object.entries(v.line || {}).filter(([, m]) => m === n).map(([k]) => embs.get(k)).filter((x) => x?.v && x.s >= LONG)
  if (!mine.length) return
  const c = norm(mine.reduce((acc, x) => { for (let i = 0; i < acc.length; i++) acc[i] += x.v[i]; return acc }, new Float32Array(mine[0].v.length)))
  const all = readJSON(KNOWN(), { voices: [] }).voices.filter((k) => (who.me ? !k.me : k.name !== who.name))
  const was = readJSON(KNOWN(), { voices: [] }).voices.find((k) => (who.me ? k.me : k.name === who.name))
  const v2 = was ? norm(Float32Array.from(c, (x, i) => x + dec(was.v)[i])) : c
  all.push({ ...(who.me ? { me: true, name: null } : { name: who.name }), v: enc(v2), meetings: [...new Set([...(was?.meetings || []), id])].slice(-20), at: new Date().toISOString() })
  fs.mkdirSync(DIR, { recursive: true })
  writeFileAtomic(KNOWN(), JSON.stringify({ model: speech.VOICE.id, voices: all }, null, 2), { mode: 0o600 })
}
export const known = () => readJSON(KNOWN(), { voices: [] }).voices.map((k) => ({ name: k.name || null, me: !!k.me, meetings: (k.meetings || []).length, at: k.at }))
export function forget() { fs.rmSync(KNOWN(), { force: true }); return { ok: true } }

// For Settings and a meeting's page: whether it's offered here and why not, the model, a download
// going, and what's remembered.
let setting = async () => {}
export const setSaver = (fn) => { setting = fn }
export async function status() {
  const f = await fit()
  return { offered: f.ok, why: f.why, live: f.live, have: speech.have(speech.VOICE), mb: speech.VOICE.mb, license: speech.VOICE.license, by: speech.VOICE.by, label: speech.VOICE.label, downloading: speech.downloading(speech.VOICE.id), on: cfg.meetings?.roomVoices === true, remember: cfg.meetings?.rememberVoices === true, known: known().length }
}
