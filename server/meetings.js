// Meeting notes, like Granola: record a meeting (your mic, and in the desktop app the call's sound
// too), see the transcript as it goes, jot your own notes beside it, then have any model turn them
// into a summary with decisions and action items, saved as Markdown where you keep notes.
//
// Audio comes in short pieces of 16 kHz mono 16-bit PCM per source: "you" (the mic) and "them"
// (the call). Quiet stretches are skipped by a cheap level check, so silence is never transcribed,
// and each spoken stretch goes to the speech engine you picked (speech.js), on this computer or a
// service. Two sources means the transcript says who spoke, You or Them, without guessing voices.
//
// Each meeting is a folder in <data>/meetings/<id>: meeting.json, transcript.jsonl (a line per
// stretch, appended as they come), notes.md (yours), summary.md, and the audio: Opus through
// ffmpeg (about 11 MB an hour per source), or WAV without it. captures/ holds pictures of what was
// on the screen (or pasted into your notes); the files and links that go with a meeting are kept
// as links in meeting.json, read from where they are when the notes are written.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { spawn, execFile } from 'node:child_process'
import { DATA, ROOT, IS_MAC, IS_WIN, expand, writeFileAtomic } from './paths.js'
import { tool } from './fixes.js'
import * as speech from './speech.js'
import * as memory from './meetmemory.js'
import * as doctext from './doctext.js'
import { canOpen } from './files.js'
import { mayLook, noteAsked } from './projects.js'

const DIR = path.join(DATA, 'meetings')
const RATE = 16000
const SOURCES = ['you', 'them']
let cfg = {}
export const configure = (c) => { cfg = c || {} }

const dirOf = (id) => {
  if (!/^[\w-]+$/.test(String(id || ''))) throw new Error('No such meeting')
  return path.join(DIR, id)
}
const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const readText = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
function meta(id) {
  const m = readJSON(path.join(dirOf(id), 'meeting.json'))
  if (!m) throw new Error('No such meeting')
  return m
}
function saveMeta(m) {
  fs.mkdirSync(dirOf(m.id), { recursive: true })
  const f = path.join(dirOf(m.id), 'meeting.json')
  writeFileAtomic(f, JSON.stringify(m, null, 2))
  return m
}
const patchMeta = (id, p) => saveMeta({ ...meta(id), ...p })

// ---------- The transcript ----------
function lines(id) {
  return readText(path.join(dirOf(id), 'transcript.jsonl')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
// Your mic hears the call too when you're not on headphones, so a line of yours that says what
// Them said at the same moment is that echo, and left out (kept in the file).
const words = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])
function echo(a, b) {
  const x = words(a.text), y = words(b.text)
  if (x.size < 3) return [...x].every((w) => y.has(w)) && x.size > 0
  let same = 0
  for (const w of x) if (y.has(w)) same++
  return same / x.size >= 0.6
}
// A line of yours with your words and the call's (you both talked in that stretch) keeps only
// yours: a run of four or more words that Them said around then, three words at a time, is cut.
// The two hear the same words a little differently, so a few words between two such runs go too,
// and so does a scrap of four words or fewer left beside a cut (the rest of a sentence of theirs
// heard another way). What's left, or null when that's nothing worth a line.
const tokens = (s) => [...String(s).matchAll(/[\p{L}\p{N}']+/gu)].map((x) => ({ w: x[0].toLowerCase(), at: x.index }))
const SCRAP = 4
function unecho(text, near) {
  const you = tokens(text)
  if (you.length < 4) return text
  const grams = new Set()
  const ws = near.flatMap((t) => tokens(t.text).map((x) => x.w))
  for (let i = 0; i + 2 < ws.length; i++) grams.add(`${ws[i]} ${ws[i + 1]} ${ws[i + 2]}`)
  const hit = you.map(() => false)
  for (let i = 0; i + 2 < you.length; i++) if (grams.has(`${you[i].w} ${you[i + 1].w} ${you[i + 2].w}`)) hit[i] = hit[i + 1] = hit[i + 2] = true
  // Runs of hits, joined across a gap of up to two words, or up to four between two runs of four.
  const runs = []
  for (let i = 0; i < you.length; i++) {
    if (!hit[i]) continue
    let j = i
    while (j + 1 < you.length && hit[j + 1]) j++
    const last = runs[runs.length - 1]
    const gap = last ? i - last.b - 1 : Infinity
    if (gap <= 2 || (gap <= SCRAP && last.n >= 4 && j - i + 1 >= 4)) { last.b = j; last.n += j - i + 1 } else runs.push({ a: i, b: j, n: j - i + 1 })
    i = j
  }
  const cut = runs.filter((r) => r.n >= 4)
  if (!cut.length) return text
  // The pieces between the cuts, each without a scrap beside a cut: the start of one up to its
  // first full stop, the end of one after its last.
  const bounds = [0, ...cut.flatMap((r) => [you[r.a].at, r.b + 1 < you.length ? you[r.b + 1].at : text.length]), text.length]
  const count = (x) => tokens(x).length
  const out = []
  for (let k = 0; k < bounds.length; k += 2) {
    let piece = text.slice(bounds[k], bounds[k + 1])
    if (k > 0) { const lead = /^[^.?!]*(?:[.?!]+\s*|$)/.exec(piece)[0]; if (count(lead) <= SCRAP) piece = piece.slice(lead.length) }
    if (k + 2 < bounds.length) { const i = piece.search(/[.?!][^.?!]*$/); const trail = i < 0 ? piece : piece.slice(i + 1); if (count(trail) <= SCRAP) piece = i < 0 ? '' : piece.slice(0, i + 1) }
    out.push(piece)
  }
  const left = out.join(' ').replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').replace(/([,;:])(?:\s*[,.;:])+/g, '$1').replace(/^[\s,.;:-]+/, '').replace(/[\s,;:-]+$/, '').trim()
  return count(left) >= 2 ? left : null
}
// The transcript as shown: names fixed from meeting memory, and your own edits on top. Both sit
// beside transcript.jsonl (which only ever gets added to), so what was heard stays and an edit
// can be undone: a line edited or fixed says what was heard.
const keyOf = (l) => `${l.src}:${l.t0}`
const editsOf = (id) => readJSON(path.join(dirOf(id), 'edits.json'), {})
// Who said a line, when it's known: { key: { name, guess } }. guess: named by a model (nameSpeakers),
// not by you. name null: Them, as you put it back (in a call with one other person, who it'd be).
const namesOf = (id) => readJSON(path.join(dirOf(id), 'speakers.json'), {})
// The transcript cleaned up by a model once the meeting ended (cleanup): { fix: { key: text },
// drop: [key], model, at }.
const cleanedOf = (id) => readJSON(path.join(dirOf(id), 'cleaned.json'), null)
// clean: with that cleanup (false: as heard, for the next one). dropped: with the lines it left
// out, marked, for the page to show on request.
export function transcript(id, { raw = false, clean = true, dropped = false } = {}) {
  // Without lines of only an engine's notes ("[END]"), kept by versions before 3.0.9.
  const all = lines(id).filter((l) => !l.text || speech.spoken(l.text)).sort((a, b) => a.t0 - b.t0)
  const them = all.filter((l) => l.src === 'them' && l.text)
  const kept = []
  for (const l of all) {
    const near = l.src === 'you' && l.text ? them.filter((t) => t.t1 > l.t0 - 5 && t.t0 < l.t1 + 5) : []
    if (!near.length) { kept.push(l); continue }
    // Their words cut out first; then what's left that's still mostly theirs (heard a little
    // differently) is left out whole.
    const text = unecho(l.text, near)
    if (!text || near.some((t) => t.t1 > l.t0 - 2 && t.t0 < l.t1 + 2 && echo({ text }, t))) continue
    kept.push(text === l.text ? l : { ...l, text, heard: l.text, trimmed: true })
  }
  if (raw) return kept
  const edits = editsOf(id)
  const names = namesOf(id)
  const c = clean ? cleanedOf(id) : null
  const drop = new Set(c?.drop || [])
  let one = null
  try { one = onlyGuest(meta(id)) } catch { /* gone */ }
  const out = []
  for (const l of kept) {
    const k = keyOf(l)
    const s = names[k]
    const n = s ? (s.name ? { name: s.name, guess: !!s.guess } : {}) : one && l.src === 'them' ? { name: one, guess: true } : {}
    const heard = l.heard ?? l.text
    if (edits[k] != null) { out.push({ ...l, key: k, ...n, text: edits[k], edited: true, heard }); continue }
    if (drop.has(k)) { if (dropped) out.push({ ...l, key: k, ...n, dropped: true, heard }); continue }
    const fixed = c?.fix?.[k]
    const t = memory.fix(fixed ?? l.text)
    out.push(t === l.text ? { ...l, key: k, ...n } : { ...l, key: k, ...n, text: t, heard, ...(fixed != null ? { cleaned: true } : { fixed: true }) })
  }
  return out
}
const clock = (s) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const ss = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}` }
export const who = (src) => (src === 'them' ? 'Them' : 'You')
const speaker = (l, label = who) => l.name || label(l.src)
// The lines with a heading where each section starts: [{ head: section }, line, line, ...]. A
// section with nothing said in it still gets its heading.
function bySection(said, sections = []) {
  const out = []
  let s = -1
  for (const l of said) {
    while (s + 1 < sections.length && l.t0 >= sections[s + 1].t - 0.5) out.push({ head: sections[++s] })
    out.push(l)
  }
  while (s + 1 < sections.length) out.push({ head: sections[++s] })
  return out
}
// As text for a model or a file: "[12:04] You: ...", runs of one speaker joined, and a heading
// where each section starts.
export function transcriptText(id) {
  const out = []
  for (const l of bySection(transcript(id).filter((x) => x.text), meta(id).sections)) {
    const last = out[out.length - 1]
    if (!l.head && last && !last.head && last.src === l.src && speaker(last) === speaker(l) && l.t0 - last.t1 < 4) { last.text += ` ${l.text}`; last.t1 = l.t1 } else out.push({ ...l })
  }
  return out.map((l) => (l.head ? `\n## ${l.head.title} (from ${clock(l.head.t)})\n` : `[${clock(l.t0)}] ${speaker(l)}: ${l.text}`)).join('\n').trim()
}
// Your notes without the section headings nothing was written under (New section adds one each
// time, for you to write under), for a model or a file.
export function filled(notes, sections = []) {
  const names = new Set((sections || []).map((x) => x.title))
  const text = String(notes || '')
  if (!names.size) return text.trim()
  return text.split(/(?=^## )/m).filter((part) => { const h = /^## ([^\n]*)\s*$/.exec(part); return !(h && names.has(h[1].trim())) }).join('').trim()
}

// ---------- Recording ----------
// Per meeting and source while recording: the speech finder, and the audio file being written.
const live = new Map() // id -> { sources: { you: Source, them: Source }, seq }

// Finds the spoken stretches in a stream of samples: 30 ms frames, each loud enough above the
// room's own noise (tracked as it goes) counts as speech. A stretch ends after 0.7 s of quiet, or
// at 25 s so the transcript keeps up in a long monologue (cut at its quietest frame near the end).
const FRAME = 480
class Finder {
  constructor(onStretch) { this.on = onStretch; this.frames = []; this.at = 0; this.floor = 0.003; this.voiced = 0; this.quiet = 0; this.pre = []; this.rest = null }
  // Pieces come in any size: the call's sound about 10 ms at a time (one Core Audio callback, less
  // than a frame), so what doesn't fill a frame waits for the next piece instead of being dropped.
  push(samples) {
    if (this.rest) {
      const all = new Int16Array(this.rest.length + samples.length)
      all.set(this.rest)
      all.set(samples, this.rest.length)
      samples = all
      this.rest = null
    }
    let i = 0
    for (; i + FRAME <= samples.length; i += FRAME) this.frame(samples.subarray(i, i + FRAME))
    if (i < samples.length) this.rest = Int16Array.from(samples.subarray(i))
  }
  frame(f) {
    let sum = 0
    for (let i = 0; i < f.length; i++) sum += (f[i] / 32768) ** 2
    const level = Math.sqrt(sum / f.length)
    this.floor = level < this.floor ? level * 0.1 + this.floor * 0.9 : this.floor * 1.0005
    const speech = level > Math.max(0.008, this.floor * 3)
    const t = this.at
    this.at += f.length
    const copy = Int16Array.from(f)
    if (!this.frames.length) {
      this.pre.push({ f: copy, t, level })
      if (this.pre.length > 10) this.pre.shift() // 300 ms before speech starts
      if (!speech) return
      this.frames = this.pre
      this.pre = []
      this.voiced = 0
    } else this.frames.push({ f: copy, t, level })
    if (speech) { this.voiced++; this.quiet = 0 } else this.quiet++
    const long = this.frames.length * FRAME / RATE
    if ((this.quiet >= 23 && long >= 1.5) || (this.quiet >= 40)) this.cut(this.frames.length)
    else if (long >= 25) {
      // The quietest frame in the last 3 seconds.
      let at = this.frames.length - 1
      for (let i = this.frames.length - 100; i < this.frames.length; i++) if (this.frames[i].level < this.frames[at].level) at = i
      this.cut(at + 1)
    }
  }
  cut(n) {
    const part = this.frames.slice(0, n)
    this.frames = this.frames.slice(n)
    if (!this.frames.length) this.quiet = 0
    if (this.voiced >= 10) {
      const pcm = new Int16Array(part.length * FRAME)
      part.forEach((p, i) => pcm.set(p.f, i * FRAME))
      this.on({ t0: part[0].t / RATE, t1: (part[part.length - 1].t + FRAME) / RATE, pcm })
    }
    this.voiced = this.frames.filter((x) => x.level > Math.max(0.008, this.floor * 3)).length
  }
  flush() { if (this.frames.length) this.cut(this.frames.length) }
}

// The recording itself, kept as Opus when ffmpeg is here (it encodes as it goes, using next to
// nothing), else as raw samples turned into a WAV at the end.
async function writer(id, src) {
  const ff = await tool('ffmpeg')
  const base = path.join(dirOf(id), `audio-${src}`)
  let n = 1
  while (fs.existsSync(`${base}${n > 1 ? `-${n}` : ''}.ogg`) || fs.existsSync(`${base}${n > 1 ? `-${n}` : ''}.wav`)) n++
  const file = `${base}${n > 1 ? `-${n}` : ''}`
  if (ff) {
    const p = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', `${file}.ogg`], { stdio: ['pipe', 'ignore', 'ignore'] })
    p.on('error', () => {})
    p.stdin.on('error', () => {})
    return { write: (b) => p.stdin.write(b), end: () => new Promise((r) => { p.on('close', r); p.stdin.end() }) }
  }
  const raw = fs.openSync(`${file}.pcm`, 'a')
  return {
    write: (b) => fs.writeSync(raw, b),
    end: async () => { fs.closeSync(raw); const pcm = fs.readFileSync(`${file}.pcm`); fs.writeFileSync(`${file}.wav`, wav(pcm)); fs.rmSync(`${file}.pcm`, { force: true }) },
  }
}

export function wav(pcm) {
  const b = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + b.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24)
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(b.length, 40)
  return Buffer.concat([h, b])
}

// ---------- The call's sound ----------
// On a Mac (14.2 and later), native/calltap records what the Mac plays: a Core Audio tap, which
// macOS asks you to allow once (System Audio Recording), with no screen recording. Its output is the
// "them" source. Elsewhere, or without it, a meeting records your mic only (which still hears a
// call on speakers).
const taps = new Map() // id -> process
// BRIDGE_CALLTAP: another program in its place (tests use a stand-in, so nothing asks macOS).
export const tapBin = () => { const f = process.env.BRIDGE_CALLTAP || path.join(ROOT, 'native', 'bin', 'calltap'); return (IS_MAC || process.env.BRIDGE_CALLTAP) && fs.existsSync(f) ? f : null }
function listen(id) {
  const bin = tapBin()
  if (!bin) return IS_MAC ? 'This copy of Bridge AI can\'t record a call\'s sound, so your mic records the meeting.' : 'Recording a call\'s sound is on the Mac for now, so your mic records the meeting.'
  const p = spawn(bin, ['--rate', String(RATE)], { stdio: ['ignore', 'pipe', 'pipe'] })
  taps.set(id, p)
  let rest = null
  p.stdout.on('data', (b) => {
    const buf = rest ? Buffer.concat([rest, b]) : b
    const even = buf.length - (buf.length % 2)
    rest = even < buf.length ? buf.subarray(even) : null
    if (even) audio(id, 'them', buf.subarray(0, even)).catch(() => {})
  })
  let err = ''
  p.stderr.on('data', (b) => { err = (err + b).slice(-1000) })
  p.on('error', () => {})
  p.on('exit', (code) => {
    taps.delete(id)
    const m = readJSON(path.join(DIR, id, 'meeting.json'))
    const said = err.match(/error: (.+)/)?.[1]
    if (m && code && (m.status === 'recording' || m.status === 'paused')) saveMeta({ ...m, call: 'off', callError: said ? `The call's sound stopped: ${said}` : 'The call\'s sound stopped.' })
  })
  return null
}
function unlisten(id) { const p = taps.get(id); taps.delete(id); if (p) try { p.kill('SIGTERM') } catch { /* gone */ } }

// ---------- Transcribing, one stretch at a time ----------
// A queue for every meeting: local engines take one stretch at a time (two at once would only
// fight over the same chip), services a few. A stretch that fails is tried again twice, then kept
// as a WAV in the meeting's folder (pending/) for Try again.
const queue = []
const running = [] // the jobs being transcribed now
function enqueue(job) { queue.push(job); pump() }
function pump() {
  const max = speech.parallel(cfg)
  while (running.length < max && queue.length) {
    const job = queue.shift()
    running.push(job)
    run(job).finally(() => { running.splice(running.indexOf(job), 1); pump(); settle(job.id) })
  }
}
async function run(job) {
  const m = readJSON(path.join(dirOf(job.id), 'meeting.json'))
  if (!m) return
  try {
    // The meeting's title and people help the engine spell names right, and the last thing said
    // helps it carry a sentence across two stretches.
    // Meeting memory adds the names that come up in your meetings, yours first. The hint is kept
    // short so the last thing said still fits.
    // Words only: an engine's "[END]" there led it to write "[END]" for everything after.
    const before = lines(job.id).filter((l) => l.src === job.src && speech.spoken(l.text)).slice(-2).map((l) => memory.fix(speech.spoken(l.text))).join(' ').slice(-200)
    // The names in the files that go with it (a resume, a deck) too: fileTerms.
    const hint = [m.title, ...(m.event?.attendees || []).slice(0, 12), cfg.meetings?.vocabulary, m.fileTerms, memory.hint(200)].filter(Boolean).join(', ').slice(0, 440)
    // An engine that takes names to listen for rather than a prompt (Parakeet) gets them one by one.
    const words = [...(m.event?.attendees || []).slice(0, 12), ...String(cfg.meetings?.vocabulary || '').split(','), ...String(m.fileTerms || '').split(',')]
    const r = await speech.transcribe(wav(job.pcm), { cfg: job.cfg || cfg, language: job.language || m.language || cfg.meetings?.language, prompt: [hint, before].filter(Boolean).join('. '), words })
    const text = speech.spoken(r.text)
    if (text && !/^(thank you\.?|thanks for watching!?|you)$/i.test(text)) { append(job.id, { src: job.src, t0: round(job.t0), t1: round(job.t1), text, engine: r.engine }); if (!job.retry) assistSoon(job.id) }
    if (job.retry) fs.rmSync(job.retry, { force: true })
  } catch (e) {
    job.tries = (job.tries || 0) + 1
    if (job.tries < 3 && !e.fatal) { setTimeout(() => enqueue(job), 2000 * job.tries); return }
    const dir = path.join(dirOf(job.id), 'pending')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${round(job.t0)}-${job.src}-${round(job.t1)}.wav`)
    if (!job.retry) fs.writeFileSync(file, wav(job.pcm))
    patchMeta(job.id, { error: e.message })
  }
}
const round = (s) => Math.round(s * 100) / 100
function append(id, line) { fs.appendFileSync(path.join(dirOf(id), 'transcript.jsonl'), `${JSON.stringify(line)}\n`) }
const waiting = (id) => [...queue, ...running].filter((j) => j.id === id).length
// Recording stopped and every stretch is in: the meeting is done, its transcript cleaned up and
// then summarized, each when you have it happen by itself (Settings › Meetings).
function settle(id) {
  const m = readJSON(path.join(DIR, id, 'meeting.json'))
  if (!m || m.status !== 'transcribing' || waiting(id) || decoding.has(id)) return
  saveMeta({ ...m, status: 'done', ...(m.again ? { again: { ...m.again, done: new Date().toISOString() } } : {}) })
  // Cleaning up goes to the notes model too: by itself only when the summary does, unless you've
  // turned it on (someone who keeps the transcript from a model until they ask isn't surprised).
  const clean = (cfg.meetings?.cleanup ?? cfg.meetings?.autoSummary !== false) && transcript(id).filter((l) => l.text).length >= 3
  const sum = cfg.meetings?.autoSummary !== false
  if (!clean && !sum) return
  ;(async () => {
    if (clean) await cleanup(id).catch(() => {})
    if (sum && transcriptText(id)) await summarize(id).catch(() => {})
  })()
}

// ---------- The meeting's life ----------
export function list() {
  let ids = []
  try { ids = fs.readdirSync(DIR) } catch { return [] }
  return ids.map((id) => readJSON(path.join(DIR, id, 'meeting.json'))).filter(Boolean)
    .map((m) => ({ ...m, hasSummary: fs.existsSync(path.join(DIR, m.id, 'summary.md')) }))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
}

// The kind of meeting its name says it is, when it says: "Interview - Priya Shah", "Daily standup",
// "Dan / Priya 1:1". One you pick (setKind) stays, whatever it's called.
export function kindOf(title) {
  const s = String(title || '')
  return /\binterview|\bscreening\b|\bcandidate\b/i.test(s) ? 'interview'
    : /\bstand-?ups?\b|\bdaily scrum\b/i.test(s) ? 'standup'
      : /(^|[^\d:/-])1\s*[:/]\s*1(?![\d:/])|\bone[- ]on[- ]one\b/i.test(s) ? 'one_on_one'
        : /\bbrainstorm/i.test(s) ? 'brainstorm' : 'general'
}
const guessKind = (m, title) => (m.kindPicked || (m.kind && m.kind !== 'general') ? {} : { kind: kindOf(title) })

// event: the calendar event it's for ({ title, start, end, attendees }), when there's one.
// kind: the kind of meeting (KINDS), for the summary; else the kind its name says. The call's sound
// is recorded too unless it's turned off (Settings › Meetings) or this one asks not to. AI Assist is
// on when you have it on for every meeting.
export function start({ title, event, language, kind, call = true, callApps = [] } = {}) {
  const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`
  const name = String(title || event?.title || 'Meeting').slice(0, 200)
  saveMeta({
    id, title: name, event: event ? { title: event.title, start: event.start, end: event.end, attendees: (event.attendees || []).slice(0, 50) } : null,
    links: inviteLinks(event),
    startedAt: new Date().toISOString(), endedAt: null, status: 'recording', language: language || null, kind: KINDS[kind] ? kind : kindOf(`${name} ${event?.title || ''}`), ...(KINDS[kind] ? { kindPicked: true } : {}), seconds: 0, call: 'off',
    callApps: [...new Set([].concat(callApps || []).map(String))].slice(0, 5),
    assist: cfg.meetings?.assist === true,
  })
  const why = call && cfg.meetings?.callAudio !== false ? listen(id) : 'Recording the call\'s sound is off (Settings › Meetings).'
  speech.prepare(cfg)
  return patchMeta(id, why ? { call: 'off', callWhy: why } : { call: 'on' })
}

// A piece of audio from one source. seq: its number from that source, so one sent twice (a
// retry after a dropped connection) isn't counted twice.
export async function audio(id, src, buf, seq) {
  if (!SOURCES.includes(src)) throw new Error('Unknown source')
  const m = meta(id)
  if (m.status !== 'recording') return { status: m.status }
  let l = live.get(id)
  if (!l) live.set(id, (l = { sources: {} }))
  let s = l.sources[src]
  if (!s) {
    s = l.sources[src] = { seq: -1, samples: 0, out: null, finder: new Finder((st) => enqueue({ id, src, ...st })) }
    s.out = writer(id, src)
  }
  if (seq != null && Number(seq) <= s.seq) return { status: m.status, dup: true }
  if (seq != null) s.seq = Number(seq)
  const even = buf.length - (buf.length % 2)
  const samples = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + even))
  s.finder.push(samples)
  if (s.finder.frames.length && s.finder.voiced >= 5) { s.talkingAt = Date.now(); s.stretch = s.finder.frames[0].t }
  s.samples += samples.length
  let peak = 0
  for (let i = 0; i < samples.length; i += 8) { const v = Math.abs(samples[i]); if (v > peak) peak = v }
  s.level = peak / 32768
  if (peak >= HEARD) s.heard = Date.now()
  ;(await s.out).write(Buffer.from(samples.buffer))
  const seconds = Math.max(...Object.values(l.sources).map((x) => x.samples)) / RATE
  if (seconds - (m.seconds || 0) >= 5) patchMeta(id, { seconds: Math.round(seconds) })
  return { status: 'recording' }
}

// Real sound, about -60 dB and up: a call's sound macOS hasn't let Bridge AI hear isn't always
// all zeros (one was a few steps off zero for a whole 2-hour call), and that isn't a call.
const HEARD = 33
// The call has been silent since it started, while it records: nothing played, or macOS hasn't let
// Bridge AI hear it yet (System Audio Recording). BRIDGE_CALL_QUIET_MS: how long before it says so.
const QUIET_AFTER = Number(process.env.BRIDGE_CALL_QUIET_MS) || 30_000
// Someone on the call is talking now, while it records: the stretch of speech in its sound (where it
// started, a new number when someone starts again), or null.
export const talking = (id) => { const s = live.get(id)?.sources.them; return s && Date.now() - (s.talkingAt || 0) < 2000 ? s.stretch : null }
export function callQuiet(id) {
  const l = live.get(id)
  const m = readJSON(path.join(DIR, id, 'meeting.json'))
  return !!l && !!m && m.call === 'on' && Date.now() - Date.parse(m.startedAt) > QUIET_AFTER && !l.sources.them?.heard
}

export function pause(id) { return patchMeta(id, { status: meta(id).status === 'recording' ? 'paused' : meta(id).status }) }
export function resume(id) { return patchMeta(id, { status: meta(id).status === 'paused' ? 'recording' : meta(id).status }) }

export async function stop(id) {
  const m = meta(id)
  if (m.status !== 'recording' && m.status !== 'paused') return m
  unlisten(id)
  clearTimeout(stopping.get(id)); stopping.delete(id)
  clearTimeout(assistLater.get(id)); assistLater.delete(id)
  const l = live.get(id)
  live.delete(id)
  const seconds = l ? Math.max(0, ...Object.values(l.sources).map((x) => x.samples)) / RATE : m.seconds
  saveMeta({ ...m, status: 'transcribing', endedAt: new Date().toISOString(), seconds: Math.round(seconds || 0) })
  for (const s of Object.values(l?.sources || {})) { s.finder.flush(); (await s.out).end().catch(() => {}) }
  settle(id)
  return meta(id)
}

// The call a meeting is on (calls.js), noted when it starts recording or when one starts during it.
// When that call ends, the meeting says so and the app asks whether to stop; unless you keep it
// going (or the call comes back), it stops by itself two minutes later (Settings › Meetings).
const AUTO_STOP_MS = Number(process.env.BRIDGE_AUTO_STOP_MS || 120_000)
const stopping = new Map() // id -> timer
const recordingNow = () => list().filter((m) => m.status === 'recording' || m.status === 'paused')
export function callStarted(app) {
  for (const m of recordingNow()) {
    clearTimeout(stopping.get(m.id)); stopping.delete(m.id)
    patchMeta(m.id, { callApps: [...new Set([...(m.callApps || []), app])], callEnded: null, callEndedApp: null })
  }
}
// still: the apps on a call now. A meeting on two (Zoom, and Meet in a browser) ends with the last.
export function callEnded(app, still = []) {
  for (const m of recordingNow().filter((x) => (x.callApps || []).includes(app) && !x.callApps.some((a) => still.includes(a)))) {
    patchMeta(m.id, { callEnded: new Date().toISOString(), callEndedApp: app, stopsAt: cfg.meetings?.autoStop !== false ? new Date(Date.now() + AUTO_STOP_MS).toISOString() : null })
    if (cfg.meetings?.autoStop === false) continue
    clearTimeout(stopping.get(m.id))
    stopping.set(m.id, setTimeout(() => {
      stopping.delete(m.id)
      const x = meta(m.id)
      if (x.callEnded && (x.status === 'recording' || x.status === 'paused')) stop(m.id).catch(() => {})
    }, AUTO_STOP_MS))
  }
}
// "Keep recording": the call ended, but the meeting goes on.
export function keep(id) {
  clearTimeout(stopping.get(id)); stopping.delete(id)
  return patchMeta(id, { callEnded: null, callEndedApp: null, stopsAt: null })
}

// A recording left open when the app closed: what was transcribed stays; it's marked stopped.
export function recover() {
  for (const m of list()) {
    if (m.status === 'recording' || m.status === 'paused' || m.status === 'transcribing') saveMeta({ ...m, status: 'done', endedAt: m.endedAt || m.startedAt })
    // A summary that was waiting to be tried again still is.
    if (m.summaryRetryAt && !fs.existsSync(path.join(DIR, m.id, 'summary.md'))) {
      later.set(m.id, setTimeout(() => { later.delete(m.id); summarize(m.id, { again: true }).catch(() => {}) }, Math.max(5000, Date.parse(m.summaryRetryAt) - Date.now())))
    }
  }
}

// ---------- Transcribing again ----------
// From the meeting's own audio, with another engine, model or language (Transcribe again), when
// the first try missed or misheard a lot. The transcript it had is kept beside it
// (transcript-<time>.jsonl) and your line edits stay. The audio is read only as fast as the engine
// keeps up, so a long meeting doesn't fill memory.
const decoding = new Map() // id -> { done, total } in seconds of audio
const partOf = (f) => Number(/-(\d+)\.\w+$/.exec(f)?.[1] || 1)
export async function retranscribe(id, { engine, localModel, language } = {}) {
  const m = meta(id)
  if (m.status === 'recording' || m.status === 'paused') throw new Error('Still recording')
  if (decoding.has(id) || waiting(id)) throw new Error('It\'s being transcribed already')
  const d = dirOf(id)
  const files = fs.readdirSync(d).filter((f) => /^audio-(you|them)(-\d+)?\.(ogg|wav)$/.test(f)).sort((a, b) => partOf(a) - partOf(b))
  if (!files.length) throw new Error('This meeting has no audio to transcribe again')
  const ff = await tool('ffmpeg')
  if (files.some((f) => f.endsWith('.ogg')) && !ff) throw new Error('Transcribing again needs ffmpeg, which reads the recording. Install it with Homebrew: brew install ffmpeg')
  if (localModel && !speech.MODELS.some((x) => x.id === localModel)) throw new Error('No such speech model')
  if (engine && !['local', 'apple'].includes(engine) && !speech.SERVICES[engine]) throw new Error('No such speech engine')
  const c = { ...cfg, meetings: { ...(cfg.meetings || {}), ...(engine ? { engine } : {}), ...(localModel ? { localModel } : {}) } }
  const st = await speech.status(c)
  if (st.engine === 'local') {
    const lm = st.local.models.find((x) => x.id === st.local.model)
    if (lm?.runtime === 'whisper' && !st.local.program) throw new Error(`${lm.label} needs whisper.cpp. Install it in Settings › Voice, or pick Parakeet there.`)
    if (!lm?.have) throw new Error(`Download ${lm?.label || 'that speech model'} first, in Settings › Voice.`)
  } else if (st.engine === 'apple') {
    if (!st.apple.available) throw new Error(`The Mac's own speech isn't available here (${st.apple.why || 'it needs macOS 26 or later'}). Pick another engine in Settings › Meetings.`)
  } else if (!st.services.find((x) => x.id === st.engine)?.ready) throw new Error('That service needs its key first, in Settings › Model Providers.')
  const old = path.join(d, 'transcript.jsonl')
  if (fs.existsSync(old)) fs.renameSync(old, path.join(d, `transcript-${Date.now()}.jsonl`))
  fs.rmSync(path.join(d, 'pending'), { recursive: true, force: true })
  fs.rmSync(path.join(d, 'cleaned.json'), { force: true }) // it was of the lines heard before
  const sources = [...new Set(files.map((f) => f.split('-')[1].split('.')[0]))]
  decoding.set(id, { done: 0, total: Math.max(1, (m.seconds || 0) * sources.length) })
  saveMeta({ ...m, status: 'transcribing', error: null, cleanedAt: null, again: { engine: st.engine, model: st.engine === 'local' ? st.local.model : null, language: language || null, at: new Date().toISOString(), done: null } })
  speech.prepare(c)
  ;(async () => {
    try {
      for (const src of sources) {
        let offset = 0
        for (const f of files.filter((x) => x.startsWith(`audio-${src}`))) offset += await feed(id, src, path.join(d, f), offset, { cfg: c, language })
      }
    } catch (e) { try { patchMeta(id, { error: e.message }) } catch { /* gone */ } } finally { decoding.delete(id); settle(id) }
  })()
  return get(id)
}
// One audio file through the speech finder into the queue. Resolves with its length in seconds.
async function feed(id, src, file, offset, opts) {
  const finder = new Finder((st) => enqueue({ id, src, t0: round(offset + st.t0), t1: round(offset + st.t1), pcm: st.pcm, ...opts }))
  const stream = file.endsWith('.wav')
    ? fs.createReadStream(file, { start: 44 })
    : spawn(await tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 's16le', '-ar', String(RATE), '-ac', '1', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] }).stdout
  let samples = 0
  let rest = null
  await new Promise((resolve, reject) => {
    stream.on('data', (b) => {
      const buf = rest ? Buffer.concat([rest, b]) : b
      const even = buf.length - (buf.length % 2)
      rest = even < buf.length ? buf.subarray(even) : null
      const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + even))
      finder.push(pcm)
      samples += pcm.length
      const p = decoding.get(id)
      if (p) p.done += pcm.length / RATE
      // Wait while the engine has plenty to do.
      if (waiting(id) > 8) {
        stream.pause()
        const t = setInterval(() => { if (waiting(id) < 4) { clearInterval(t); stream.resume() } }, 300)
      }
    })
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  finder.flush()
  return samples / RATE
}

export function get(id) {
  const m = meta(id)
  const d = dirOf(id)
  let pending = []
  try { pending = fs.readdirSync(path.join(d, 'pending')).filter((f) => f.endsWith('.wav')) } catch { /* none */ }
  // While it records: each source's level, and whether the call has been silent since it started.
  const l = live.get(id)
  const levels = l ? Object.fromEntries(Object.entries(l.sources).map(([k, s]) => [k, s.level || 0])) : null
  const quiet = callQuiet(id)
  const dec = decoding.get(id)
  const progress = dec ? Math.min(99, Math.round((dec.done / dec.total) * 100)) : null
  const links = (m.links || []).map((l) => (l.kind === 'file' ? { ...l, exists: fs.existsSync(l.path), readable: doctext.readable(l.path) } : l))
  const help = assistOf(id)
  // me: your name (Settings › General), for your lines.
  return { ...m, links, captures: m.captures || [], canRead: !!doctext.ocrBin(), me: String(cfg.name || '').trim() || null, levels, callQuiet: quiet, transcript: transcript(id, { dropped: true }), notes: readText(path.join(d, 'notes.md')), summary: readText(path.join(d, 'summary.md')), waiting: waiting(id), pending: pending.length, saved: m.saved || null, progress, assistItems: help.items.filter((x) => x.state !== 'dismissed').slice(-20), assistError: help.error || null, assisting: assisting.has(id) }
}

export function setKind(id, kind) { return patchMeta(id, { kind: KINDS[kind] ? kind : 'general', kindPicked: true }) }
// When it was (fixed by hand: recorded late, or on the wrong day). Its end moves with it, and saved
// notes move to the folder for the new date.
export function setStart(id, when) {
  const m = meta(id)
  const t = Date.parse(when)
  if (!Number.isFinite(t) || t < Date.parse('2000-01-01') || t > Date.now() + 366 * 86400e3) throw new Error('That isn\'t a date and time')
  const shift = t - Date.parse(m.startedAt)
  const p = patchMeta(id, { startedAt: new Date(t).toISOString(), ...(m.endedAt ? { endedAt: new Date(Date.parse(m.endedAt) + shift).toISOString() } : {}) })
  resave(id, 500)
  return p
}
// Who was there (or invited): names, as you'd write them. Who said what is worked out again with
// them, at the next summary.
export function setPeople(id, people) {
  const m = meta(id)
  const list = [...new Set([].concat(people || []).map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 50).map((x) => x.slice(0, 80))
  const p = patchMeta(id, { event: { ...(m.event || { title: m.title, start: m.startedAt, end: m.endedAt }), attendees: list }, namedAt: null })
  resave(id, 2000)
  return p
}
// The notes folder, opened (made first, if it isn't there yet).
export async function openFolder() {
  const f = folder()
  await fs.promises.mkdir(f, { recursive: true })
  const bin = IS_MAC ? 'open' : IS_WIN ? 'explorer.exe' : 'xdg-open'
  if (process.env.BRIDGE_FIX_DRYRUN) return { ok: true, dry: [bin, f] }
  return new Promise((resolve) => { execFile(bin, [f], { timeout: 10000 }, () => resolve({ ok: true })) })
}
// The saved notes in Finder.
export function revealSaved(id) {
  const m = meta(id)
  if (!m.saved || !fs.existsSync(m.saved)) throw new Error(m.saved ? 'The saved notes aren\'t where they were. Save it again.' : 'Not saved yet')
  const [bin, args] = IS_MAC ? ['open', ['-R', m.saved]] : IS_WIN ? ['explorer.exe', [`/select,${m.saved}`]] : ['xdg-open', [path.dirname(m.saved)]]
  if (process.env.BRIDGE_FIX_DRYRUN) return { ok: true, dry: [bin, ...args] }
  return new Promise((resolve) => { execFile(bin, args, { timeout: 10000 }, () => resolve({ ok: true })) })
}
export function rename(id, title) { const was = meta(id); const name = String(title || '').trim().slice(0, 200) || was.title; const m = patchMeta(id, { title: name, ...guessKind(was, name) }); resave(id, 500); return m }
// base: the notes the page last had. A note added meanwhile somewhere else (the floating card, the
// top bar) is kept: it's added to the end of what the page sends.
export function setNotes(id, text, base) {
  meta(id)
  const f = path.join(dirOf(id), 'notes.md')
  let next = String(text || '')
  const now = readText(f)
  if (typeof base === 'string' && now !== base && now.startsWith(base)) next += now.slice(base.length)
  writeFileAtomic(f, next)
  resave(id, 5000)
  return { ok: true, notes: next }
}
// Where a meeting that's recording is now, in seconds (null when it isn't recording).
function nowIn(id, m) {
  if (m.status !== 'recording' && m.status !== 'paused') return null
  const l = live.get(id)
  return l ? Math.max(0, ...Object.values(l.sources).map((x) => x.samples)) / RATE : (Date.now() - Date.parse(m.startedAt)) / 1000
}
// How far into the meeting that's recording, for the menu bar (desktop/main.js).
export const elapsed = (id) => { try { const m = meta(id); return nowIn(id, m) ?? m.seconds ?? 0 } catch { return null } }
// A thought added while it records (from the floating card, the top bar), at the meeting's time;
// or at, a time in the meeting (a note on a line of the transcript).
export function quickNote(id, text, at = null) {
  const m = meta(id)
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 2000)
  if (!t) throw new Error('Write something first')
  const when = Number.isFinite(Number(at)) && at !== null && Number(at) >= 0 ? Number(at) : nowIn(id, m) ?? m.seconds ?? 0
  const f = path.join(dirOf(id), 'notes.md')
  const now = readText(f)
  writeFileAtomic(f, `${now}${now && !now.endsWith('\n') ? '\n' : ''}- [${clock(when)}] ${t}\n`)
  resave(id, 5000)
  return { ok: true, notes: readText(f) }
}

// ---------- Sections ----------
// A recording in parts, like laps on a stopwatch or the parts of a long talk: New section starts
// the next one where the recording is now. The transcript, your notes and the summary get a heading
// for each. What came before the first is "Section 1", unless it was right at the start.
const clean = (s, n = 120) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
export function section(id, title) {
  const m = meta(id)
  const at = nowIn(id, m)
  if (at == null) throw new Error('A new section starts where the recording is. Start recording first.')
  const was = m.sections || []
  // A second click straight after the first is the same section.
  if (was.length && at - was[was.length - 1].t < 2) return { ok: true, sections: was }
  const list = was.length || at < 5 ? [...was] : [{ t: 0, title: 'Section 1' }]
  const s = { t: list.length ? Math.round(at * 10) / 10 : 0, title: clean(title) || `Section ${list.length + 1}` }
  list.push(s)
  patchMeta(id, { sections: list })
  // A heading in your notes, to write under.
  const f = path.join(dirOf(id), 'notes.md')
  const now = readText(f)
  writeFileAtomic(f, `${now}${now.trim() ? `${now.endsWith('\n') ? '' : '\n'}\n` : ''}## ${s.title}\n`)
  resave(id, 5000)
  return { ok: true, sections: list, section: s }
}
// Its heading in your notes changes with it (the first one with its old name).
function heading(id, from, to) {
  const f = path.join(dirOf(id), 'notes.md')
  const now = readText(f)
  const re = new RegExp(`^## ${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\n?`, 'm')
  if (re.test(now)) writeFileAtomic(f, now.replace(re, to == null ? '' : `## ${to}\n`))
}
export function renameSection(id, i, title) {
  const m = meta(id)
  const list = [...(m.sections || [])]
  const s = list[Number(i)]
  const name = clean(title)
  if (!s) throw new Error('No such section')
  if (!name || name === s.title) return { ok: true, sections: list }
  heading(id, s.title, name)
  list[Number(i)] = { ...s, title: name }
  patchMeta(id, { sections: list })
  resave(id, 2000)
  return { ok: true, sections: list }
}
// Gone: what was said in it belongs to the section before. Its heading leaves your notes; what you
// wrote under it stays.
export function removeSection(id, i) {
  const m = meta(id)
  const list = [...(m.sections || [])]
  const s = list[Number(i)]
  if (!s) throw new Error('No such section')
  heading(id, s.title, null)
  list.splice(Number(i), 1)
  patchMeta(id, { sections: list.length === 1 && list[0].t === 0 && /^Section 1$/.test(list[0].title) ? [] : list })
  resave(id, 2000)
  return { ok: true, sections: meta(id).sections }
}

// ---------- Folders and the archive ----------
// A folder to keep meetings in (a name; none: the list by day). Archived: out of the way, and left
// out of search and of questions about your meetings, until it's taken out again.
export function setFolder(id, name) {
  const f = clean(name, 60)
  return patchMeta(id, { folder: f || null })
}
export function archive(id, on = true) {
  const m = meta(id)
  if (on && (m.status === 'recording' || m.status === 'paused')) throw new Error('Still recording')
  return patchMeta(id, { archived: !!on, archivedAt: on ? new Date().toISOString() : null })
}

// ---------- Who said it ----------
// A line's speaker, by you: name (null: back to You or Them). all: every line from that side
// that you haven't named yourself.
export function setSpeaker(id, key, name, { all = false } = {}) {
  meta(id)
  const l = lines(id).find((x) => keyOf(x) === key)
  if (!l) throw new Error('No such line in the transcript')
  const n = clean(name, 80)
  const names = namesOf(id)
  const keys = all ? lines(id).filter((x) => x.src === l.src && (keyOf(x) === key || !names[keyOf(x)] || names[keyOf(x)].guess)).map(keyOf) : [key]
  const back = l.src === 'them' && onlyGuest(meta(id)) // Them stays Them, not the one person invited
  for (const k of keys) { if (n && n !== who(l.src)) names[k] = { name: n }; else if (back) names[k] = { name: null }; else delete names[k] }
  writeFileAtomic(path.join(dirOf(id), 'speakers.json'), JSON.stringify(names, null, 2))
  resave(id, 2000)
  return { ok: true, named: keys.length }
}
// One person written two ways: "Priya Shah", "priya.shah", "shah.priya2", "priya.s" or "priya" (an
// address, as a calendar lists someone without a name). "Priya Patel" is someone else.
const nameParts = (s) => String(s).toLowerCase().replace(/\d+/g, '').split(/[\s.@_-]+/).filter(Boolean)
const sameName = (a, b) => {
  const x = nameParts(a), y = nameParts(b)
  if (!x.length || !y.length) return false
  if ([...x].sort().join(' ') === [...y].sort().join(' ')) return true
  return x[0] === y[0] && (x.length === 1 || y.length === 1 || x[1][0] === y[1][0])
}
// Who was invited besides you (Settings › General › Your name), and the one person when that's all
// there is: a call with one other person, so they said what the call did.
const guests = (m) => { const me = String(cfg.name || '').trim(); return (m.event?.attendees || []).filter((p) => !me || !sameName(p, me)) }
const asWritten = (p) => (/^[a-z0-9._-]+$/.test(p) && /[._-]/.test(p) ? nameParts(p).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : p)
function onlyGuest(m) { const g = guests(m); return g.length === 1 ? asWritten(g[0]) : null }
// The call is one sound for everyone on it, so who said each of Them's lines is worked out by a
// model: from what's said (names used, a question put to someone and answered, who presents what),
// the words on the screen at the time (a video call shows names on its tiles, and a look at it
// while someone on the call talked shows who that was: glance) and who was invited. A line it
// can't place stays Them; the ones you named yourself are left as they are.
export async function nameSpeakers(id, { model } = {}) {
  const m = meta(id)
  const use = model || m.summaryModelPick || cfg.meetings?.model || await helpers.pickModel()
  if (!use) throw noModel()
  const said = transcript(id).filter((l) => l.text)
  if (!said.some((l) => l.src === 'them')) throw new Error('Nobody on the call was heard in this meeting')
  const me = String(cfg.name || '').trim()
  const people = guests(m)
  const screens = [...(m.captures || []).filter((c) => c.text).map((c) => ({ t: c.t, screen: c.text.replace(/\s+/g, ' ').slice(0, 300) })),
    ...glances(id).map((g) => ({ t: g.t, screen: g.text.slice(0, 500), talking: true }))]
  const byN = new Map()
  const rows = [...said, ...screens].sort((a, b) => (a.t0 ?? a.t) - (b.t0 ?? b.t)).map((x) => {
    if (x.screen) return `    [${clock(x.t)}] On the screen${x.talking ? ' as Them talked' : ''}: ${x.screen}`
    if (x.src !== 'them') return `    [${clock(x.t0)}] You: ${x.text}`
    byN.set(byN.size + 1, x.key)
    return `${byN.size}. [${clock(x.t0)}] Them: ${x.text}`
  })
  const mem = memory.about(`${m.title}\n${people.join('\n')}\n${said.map((l) => l.text).join('\n')}`)
  const about = [`Meeting: ${m.title}`, people.length ? `Invited, besides You: ${people.join(', ')}` : 'There is no list of who was invited, but the meeting\'s name may say who it was with.', me ? `"You" is ${me}, who recorded it.` : '"You" is the person who recorded it.'].join('\n')
  const ask = [about, mem ? `\n${mem}` : '', '',
    '"Them" is everyone else on the call: they share one sound, so the transcript doesn\'t say which of them spoke. Say who said each numbered Them line, from what was said (names used, introductions, a question put to someone and their answer, who presents what), the words on the screen at the time and who was invited.',
    'The screen is the call\'s window, read as text. Video calls show names on their tiles; the one talking is often the big tile, or named in a label like "Talking: Priya Shah" or "Priya Shah is presenting"; captions show who said what ("Priya Shah" and then their words). Match those words and names to the lines said at that time.',
    'Use names the way they were invited or said. When you can\'t tell, use null: a wrong name is worse than none. Never name You.',
    'Answer with one JSON object and nothing else, from line number to name, like {"1": "Priya Shah", "2": null}.'].join('\n')
  const got = {}
  let used = use
  for (const part of pieces(rows.join('\n'), budget(use) - ask.length - 2000)) {
    const r = await replyAny(used, [{ role: 'user', text: `${ask}\n\nTranscript:\n${part}` }], { system: 'You work out who said what in a meeting transcript. You are careful and say null when unsure.' })
    used = r.model
    const j = /\{[\s\S]*\}/.exec(String(r.text || ''))
    try { Object.assign(got, JSON.parse(j ? j[0] : '{}')) } catch { /* not JSON: nothing from this part */ }
  }
  const names = namesOf(id)
  for (const [k, v] of Object.entries(names)) if (v.guess) delete names[k]
  let n = 0
  for (const [num, name] of Object.entries(got)) {
    const key = byN.get(Number(num))
    const v = typeof name === 'string' ? clean(name, 80) : ''
    if (!key || !v || /^(them|you|null|unknown)$/i.test(v) || (me && sameName(v, me)) || (names[key] && !names[key].guess)) continue
    names[key] = { name: v, guess: true }
    n++
  }
  writeFileAtomic(path.join(dirOf(id), 'speakers.json'), JSON.stringify(names, null, 2))
  patchMeta(id, { namedAt: new Date().toISOString(), namedModel: used })
  resave(id, 2000)
  return { ok: true, named: n, of: byN.size, model: used }
}

// ---------- Cleaning up the transcript ----------
// Speech to text mishears names and jargon, cuts a word in two where a stretch ends, and makes up
// words in a pause ("Thanks for watching"). Once the meeting ends, a model reads the transcript with
// what the meeting is about (its name and people, the files that go with it, meeting memory) and
// says which lines to fix and which nobody said. Its fixes sit beside transcript.jsonl in
// cleaned.json, like your edits: a line it fixed says what was heard, Undo puts one back, and your
// own edits come first. A fix that reads like a rewrite (other words, or many more or fewer) isn't
// taken, and only a short line, or one of yours that repeats the call, is left out.
const nearby = (l, said, s = 10) => said.filter((t) => t.src !== l.src && t.t1 > l.t0 - s && t.t0 < l.t1 + s)
function close(heard, fixed) {
  const a = tokens(heard).map((x) => x.w), b = tokens(fixed).map((x) => x.w)
  if (!b.length || b.length > a.length * 1.5 + 3 || b.length < a.length * 0.6 - 2) return false
  const have = new Set(a)
  return a.length <= 4 || b.filter((w) => have.has(w)).length >= b.length * 0.5
}
function droppable(l, said) {
  const ws = tokens(l.text).map((x) => x.w)
  if (ws.length <= 8) return true
  if (l.src !== 'you') return false
  const them = new Set(nearby(l, said).flatMap((t) => tokens(t.text).map((x) => x.w)))
  return ws.filter((w) => them.has(w)).length >= ws.length * 0.6
}
const cleaning = new Map() // id -> promise
export function cleanup(id, { model } = {}) {
  if (cleaning.has(id)) return cleaning.get(id)
  const p = (async () => {
    const m = meta(id)
    if (m.status === 'recording' || m.status === 'paused') throw new Error('Still recording')
    const use = model || m.summaryModelPick || cfg.meetings?.model || await helpers.pickModel()
    if (!use) throw noModel()
    const said = transcript(id, { clean: false }).filter((l) => l.text)
    if (!said.length) throw new Error('Nothing was transcribed yet')
    patchMeta(id, { cleaning: true, cleanError: null })
    const me = String(cfg.name || '').trim()
    const people = guests(m)
    const byN = new Map()
    const rows = said.map((l) => { byN.set(byN.size + 1, l); return `${byN.size}. [${clock(l.t0)}] ${speaker(l)}: ${l.text}` })
    const mem = memory.about(`${m.title}\n${people.join('\n')}\n${said.map((l) => l.text).join('\n')}`)
    const more = await extras(id, { ...m, captures: [] }, 30_000)
    const ask = [
      `Meeting: ${m.title}`, people.length ? `Invited, besides You: ${people.join(', ')}` : '', me ? `"You" is ${me}, who recorded it (their microphone). "Them" is the call.` : '"You" is the person who recorded it (their microphone). "Them" is the call.',
      mem ? `\n${mem}` : '', more ? `\n${more}` : '', '',
      'This transcript was made by speech to text, a stretch of speech at a time, and it makes mistakes. Fix them, line by line:',
      '- Words and names it misheard. Spell names, companies, products and jargon the way the invite, the files, meeting memory or the rest of the meeting do. Fix a word only when the sound of it and the context make clear what was said.',
      '- A word split in two or two run together ("spreadsheet" heard as "spre adsheet"), and a word cut where one line ends and the next begins.',
      '- Leave how people talk alone: their grammar, fillers, false starts and repeats stay. Don\'t reword, shorten, summarize or add anything.',
      'And say which lines nobody said, to leave out:',
      '- Words speech to text makes up in a pause, out of place with what\'s around them: "Thanks for watching", "Please subscribe", "Subtitles by the community".',
      '- A You line that only repeats what Them said just before or after (the microphone heard the call).',
      'Answer with one JSON object and nothing else, with only the lines that change: {"fix": {"12": "the line as it should be"}, "drop": [7, 30]}. {"fix": {}, "drop": []} when there\'s nothing to do.',
    ].filter((x) => x !== '').join('\n')
    const got = { fix: {}, drop: [] }
    let used = use
    for (const part of pieces(rows.join('\n'), Math.max(8000, Math.min(60_000, budget(use) - ask.length - 2000)))) {
      const r = await replyAny(used, [{ role: 'user', text: `${ask}\n\nTranscript:\n${part}` }], { system: 'You correct speech-to-text transcripts. You change only what was clearly misheard, and say so with JSON.' })
      used = r.model
      const j = /\{[\s\S]*\}/.exec(String(r.text || ''))
      try { const o = JSON.parse(j ? j[0] : '{}'); Object.assign(got.fix, o.fix && typeof o.fix === 'object' ? o.fix : {}); got.drop.push(...[].concat(o.drop || [])) } catch { /* not JSON: nothing from this part */ }
    }
    const out = { fix: {}, drop: [], model: used, at: new Date().toISOString() }
    for (const [num, text] of Object.entries(got.fix)) {
      const l = byN.get(Number(num))
      const v = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 5000) : ''
      if (l && !l.edited && v && v !== l.text && close(l.text, v)) out.fix[l.key] = v
    }
    for (const num of got.drop) {
      const l = byN.get(Number(num))
      if (l && !l.edited && droppable(l, said)) { out.drop.push(l.key); delete out.fix[l.key] }
    }
    writeFileAtomic(path.join(dirOf(id), 'cleaned.json'), JSON.stringify(out, null, 1))
    patchMeta(id, { cleaning: false, cleanedAt: out.at, cleanedModel: used, cleanError: null })
    resave(id, 2000)
    return { ok: true, fixed: Object.keys(out.fix).length, dropped: out.drop.length, of: said.length, model: used }
  })().catch((e) => { try { patchMeta(id, { cleaning: false, cleanError: e.message }) } catch { /* gone */ } throw e }).finally(() => cleaning.delete(id))
  cleaning.set(id, p)
  return p
}
// Back to as heard: one line (key), or the whole cleanup.
export function uncleanLine(id, key) {
  meta(id)
  const f = path.join(dirOf(id), 'cleaned.json')
  const c = readJSON(f, null)
  if (!c) return { ok: true }
  if (key == null) { fs.rmSync(f, { force: true }); patchMeta(id, { cleanedAt: null, cleanedModel: null }) } else {
    delete c.fix?.[key]
    c.drop = (c.drop || []).filter((k) => k !== key)
    writeFileAtomic(f, JSON.stringify(c, null, 1))
  }
  resave(id, 2000)
  return { ok: true }
}

// The calendar event a meeting was for, picked afterwards (when it was recorded without one): its
// people, its time and its links. The name too, while it's still the one it started with. Who said
// what is worked out again with its people, at the next summary.
export function setEvent(id, event) {
  const m = meta(id)
  if (!event?.title) throw new Error('No event')
  const ev = { title: clean(event.title, 200), start: event.start || null, end: event.end || null, attendees: [].concat(event.attendees || []).map((x) => clean(x, 80)).filter(Boolean).slice(0, 50) }
  const plain = /^(Meeting|.+ call), /.test(m.title) || m.title === 'Meeting'
  const have = new Set((m.links || []).map((l) => l.url || l.path))
  const p = patchMeta(id, { event: ev, namedAt: null, ...(plain ? { title: ev.title } : {}), ...guessKind(m, `${plain ? ev.title : m.title} ${ev.title}`), links: [...(m.links || []), ...inviteLinks(event).filter((l) => !have.has(l.url || l.path))] })
  resave(id, 1000)
  return p
}

// One line of the transcript, as you'd have it (by its key, "src:t0"). Back to what was heard:
// text null.
export function editLine(id, key, text) {
  meta(id)
  const l = lines(id).find((x) => keyOf(x) === key)
  if (!l) throw new Error('No such line in the transcript')
  const edits = editsOf(id)
  const t = text == null ? null : String(text).replace(/\s+/g, ' ').trim().slice(0, 5000)
  if (t == null || t === l.text) delete edits[key]
  else edits[key] = t
  writeFileAtomic(path.join(dirOf(id), 'edits.json'), JSON.stringify(edits, null, 1))
  resave(id, 2000)
  return { ok: true }
}

// A word or name fixed everywhere in a meeting: its transcript, your notes, the summary and the
// title. remember: kept in meeting memory, so it's fixed in every meeting, and heard right from
// now on; otherwise only this meeting's lines are edited.
const wordRe = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.trim().split(/[\s-]+/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+')}(?![\\p{L}\\p{N}])`, 'giu')
export function replaceWords(id, find, to, { remember = false } = {}) {
  const m = meta(id)
  const from = String(find || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const into = String(to || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (from.length < 2 || !into) throw new Error('What to change, and what to')
  if (from.toLowerCase() === into.toLowerCase()) throw new Error('That\'s the same')
  const re = wordRe(from)
  let changed = 0
  if (remember) memory.add({ term: into, heard: [from] }, { meeting: id })
  else {
    const edits = editsOf(id)
    for (const l of transcript(id)) {
      const t = l.text.replace(re, () => { changed++; return into })
      if (t !== l.text) edits[l.key] = t
    }
    writeFileAtomic(path.join(dirOf(id), 'edits.json'), JSON.stringify(edits, null, 1))
  }
  if (remember) changed += transcript(id).filter((l) => l.fixed && wordRe(from).test(l.heard)).length
  for (const name of ['notes.md', 'summary.md']) {
    const f = path.join(dirOf(id), name)
    const t = readText(f)
    const n = t.replace(re, () => { changed++; return into })
    if (n !== t) writeFileAtomic(f, n)
  }
  const title = m.title.replace(re, () => { changed++; return into })
  if (title !== m.title) patchMeta(id, { title })
  resave(id, 500)
  // Meetings saved before with the old spelling are saved again with the new.
  if (remember) for (const x of list()) if (x.id !== id && x.saved && wordRe(from).test(readText(path.join(DIR, x.id, 'transcript.jsonl')))) resave(x.id, 3000)
  return { changed, remembered: !!remember }
}
export function remove(id) { meta(id); unlisten(id); live.delete(id); texts.delete(id); fs.rmSync(dirOf(id), { recursive: true, force: true }); return { ok: true } }

// Try again: the stretches that failed (pending/), with the engine you have now.
export function retry(id) {
  const d = path.join(dirOf(id), 'pending')
  let files = []
  try { files = fs.readdirSync(d).filter((f) => f.endsWith('.wav')) } catch { /* none */ }
  if (!files.length) return { retried: 0 }
  const m = meta(id)
  if (m.status === 'done') saveMeta({ ...m, status: 'transcribing', error: null })
  for (const f of files) {
    const [t0, src, t1] = f.replace(/\.wav$/, '').split('-')
    const buf = fs.readFileSync(path.join(d, f)).subarray(44)
    enqueue({ id, src, t0: Number(t0), t1: Number(t1), pcm: new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)), retry: path.join(d, f) })
  }
  return { retried: files.length }
}

// ---------- What was on the screen ----------
// Pictures of the screen while it records (a screen being watched keeps one each time what's shown
// changes, and Capture takes one), and pictures pasted or dropped into your notes, each at its
// time in the meeting. The text on each is read on this Mac (doctext.js), for the notes, answers
// and search.
const PICTURE = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46], webp: [0x52, 0x49, 0x46, 0x46] }
const pictureType = (b) => Object.keys(PICTURE).find((k) => PICTURE[k].every((x, i) => b[i] === x) && (k !== 'webp' || b.subarray(8, 12).toString() === 'WEBP')) || null
const KINDS_OF_CAPTURE = ['screen', 'auto', 'paste']
// The words on a picture, for telling a new slide or page from the same one, or from a call's faces.
const wordsOf = (text) => new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
// Enough words the last picture didn't have: ten, and a third of what's on this one. A call's own view
// has the same names and buttons, and a notice like "This video is paused" is a few words of many.
const NEW_WORDS = 10
const brings = (text, before) => {
  const now = wordsOf(text), was = wordsOf(before)
  const fresh = [...now].filter((w) => !was.has(w)).length
  return fresh >= NEW_WORDS && fresh >= now.size / 3
}
// kind: 'screen' (Capture), 'auto' (the watched screen changed, screen.js) or 'paste'. An 'auto' one is
// read straight away on a Mac and kept only when its words aren't the last picture's; else
// { kept: false } and nothing is kept.
export async function addCapture(id, buf, { kind = 'screen', t, note, source } = {}) {
  const m = meta(id)
  const ext = Buffer.isBuffer(buf) && buf.length > 64 ? pictureType(buf) : null
  if (!ext) throw new Error('That isn\'t a picture (PNG, JPEG, WebP or GIF)')
  if ((m.captures || []).length >= 500) throw new Error('This meeting has 500 pictures already')
  const cid = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
  const file = `captures/${cid}.${ext}`
  fs.mkdirSync(path.join(dirOf(id), 'captures'), { recursive: true })
  fs.writeFileSync(path.join(dirOf(id), file), buf)
  const at = t != null && t !== '' && Number.isFinite(Number(t)) && Number(t) >= 0 ? Number(t) : nowIn(id, m) ?? 0
  const what = KINDS_OF_CAPTURE.includes(kind) ? kind : 'screen'
  let text = null
  if (what === 'auto' && doctext.ocrBin()) {
    try { text = (await doctext.textOf(path.join(dirOf(id), file), 4000)) || '' } catch { text = null }
    const last = [...(meta(id).captures || [])].reverse().find((x) => x.kind !== 'paste' && typeof x.text === 'string')
    if (text != null && last && !brings(text, last.text)) { fs.rmSync(path.join(dirOf(id), file), { force: true }); return { kept: false } }
  }
  const c = { id: cid, file, t: round(at), at: new Date().toISOString(), kind: what, note: String(note || '').slice(0, 300), source: String(source || '').slice(0, 80), text, read: text != null ? 'done' : doctext.ocrBin() ? 'reading' : 'no' }
  patchMeta(id, { captures: [...(meta(id).captures || []), c] })
  if (c.read === 'reading') readCapture(id, cid)
  resave(id, 5000)
  return c
}
function patchCapture(id, cid, p) {
  const m = meta(id)
  if (!(m.captures || []).some((c) => c.id === cid)) throw new Error('No such picture')
  return patchMeta(id, { captures: m.captures.map((c) => (c.id === cid ? { ...c, ...p } : c)) }).captures.find((c) => c.id === cid)
}
// One at a time: reading a picture takes a second or two.
let reading = Promise.resolve()
function readCapture(id, cid) {
  reading = reading.then(async () => {
    let c
    try { c = meta(id).captures.find((x) => x.id === cid) } catch { return }
    if (!c) return
    try { patchCapture(id, cid, { text: (await doctext.textOf(path.join(dirOf(id), c.file), 4000)) || '', read: 'done' }) } catch { try { patchCapture(id, cid, { read: 'failed' }) } catch { /* gone */ } }
  })
}
export function captureFile(id, cid) {
  const c = (meta(id).captures || []).find((x) => x.id === String(cid))
  if (!c) throw new Error('No such picture')
  return path.join(dirOf(id), c.file)
}
export const noteCapture = (id, cid, note) => { const c = patchCapture(id, String(cid), { note: String(note || '').slice(0, 300) }); resave(id, 3000); return c }
// A picture removed goes from your notes too.
export function removeCapture(id, cid) {
  const m = meta(id)
  const c = (m.captures || []).find((x) => x.id === String(cid))
  if (!c) throw new Error('No such picture')
  fs.rmSync(path.join(dirOf(id), c.file), { force: true })
  patchMeta(id, { captures: m.captures.filter((x) => x.id !== c.id) })
  const f = path.join(dirOf(id), 'notes.md')
  const notes = readText(f)
  const left = notes.replace(new RegExp(`\\n?!\\[[^\\]]*\\]\\(<?${c.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>?\\)`, 'g'), '')
  if (left !== notes) writeFileAtomic(f, left)
  resave(id, 3000)
  return { ok: true }
}

// ---------- Who's talking on the call ----------
// While a screen is watched and someone on the call talks, the page sends a look at it now and then:
// the text on it is read on this Mac and kept, and the picture isn't, so no faces from the call are
// kept. The names a call shows then (the big tile, "Talking: ...", captions with who said them)
// tell nameSpeakers who said what. One look at a time: one that comes while the last is read is
// let go. stop: why the page needn't send more.
const GLANCES = 600
const glancesFile = (id) => path.join(dirOf(id), 'glances.jsonl')
export const glances = (id) => readText(glancesFile(id)).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((g) => g?.text)
const lastGlance = new Map() // id -> { text, n }: the last look kept, and how many
let glancing = false
export async function glance(id, buf) {
  const m = meta(id)
  if (cfg.meetings?.nameSpeakers === false) return { kept: false, stop: 'off' }
  if (!doctext.ocrBin()) return { kept: false, stop: 'unreadable' }
  if (m.status !== 'recording') return { kept: false }
  const ext = Buffer.isBuffer(buf) && buf.length > 64 ? pictureType(buf) : null
  if (!ext) throw new Error('That isn\'t a picture (PNG, JPEG, WebP or GIF)')
  const was = lastGlance.get(id) || (() => { const g = glances(id); return { text: g.at(-1)?.text || '', n: g.length } })()
  lastGlance.set(id, was)
  if (was.n >= GLANCES) return { kept: false, stop: 'enough' }
  if (glancing) return { kept: false }
  glancing = true
  const at = nowIn(id, m) ?? 0
  const file = path.join(dirOf(id), `glance-${crypto.randomBytes(4).toString('hex')}.${ext}`)
  let text = ''
  try {
    fs.writeFileSync(file, buf)
    text = (await doctext.textOf(file, 2000)).replace(/\s+/g, ' ').trim()
  } catch { return { kept: false } } finally { glancing = false; fs.rmSync(file, { force: true }) }
  if (!text || text === was.text) return { kept: false }
  fs.appendFileSync(glancesFile(id), `${JSON.stringify({ t: round(at), text })}\n`)
  lastGlance.set(id, { text, n: was.n + 1 })
  return { kept: true }
}

// ---------- Files and links ----------
// What goes with a meeting: files on this computer (a deck, the SOW), links (a SharePoint deck from
// the invite) and emails (the follow-up with the files). Only where they are is kept, not a copy:
// each is read when the notes are written, so they use the file as it is then. A file dropped on a
// page in a browser, which can't say where the file is, is kept in the meeting's files folder.
const MAX_LINKS = 60
const linkId = () => crypto.randomBytes(5).toString('hex')
function inviteLinks(event) {
  return (Array.isArray(event?.links) ? event.links : []).filter((l) => /^https?:\/\//.test(String(l?.url || ''))).slice(0, 8)
    .map((l) => ({ id: linkId(), kind: 'url', url: String(l.url).slice(0, 2000), name: String(l.name || l.url).slice(0, 120), from: 'invite', addedAt: new Date().toISOString() }))
}
export function addLink(id, { path: file, url, name, from = 'you', mail } = {}) {
  const m = meta(id)
  const links = m.links || []
  if (links.length >= MAX_LINKS) throw new Error(`A meeting can have ${MAX_LINKS} files and links`)
  const by = ['you', 'invite', 'mail'].includes(from) ? from : 'you'
  let l
  if (mail?.id != null && !file) {
    if (!Number.isInteger(Number(mail.id))) throw new Error('Not an email')
    if (links.some((x) => x.kind === 'mail' && x.mail.id === Number(mail.id))) throw new Error('That email is here already')
    l = { kind: 'mail', name: String(mail.subject || 'Email').slice(0, 160), mail: { id: Number(mail.id), mid: mail.mid ? String(mail.mid).slice(0, 300) : null, from: String(mail.from || '').slice(0, 80), received: mail.received || null, files: [].concat(mail.files || []).map((f) => String(f?.name ?? f).slice(0, 160)).filter(Boolean).slice(0, 20) } }
  } else if (url) {
    let u
    try { u = new URL(String(url).trim()) } catch { throw new Error('That isn\'t a link') }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Links start with https://')
    if (links.some((x) => x.url === u.href)) throw new Error('That link is here already')
    l = { kind: 'url', url: u.href.slice(0, 2000), name: String(name || '').trim().slice(0, 120) || u.hostname.replace(/^www\./, '') }
  } else {
    const given = expand(String(file || '').trim().replace(/^file:\/\//, ''))
    if (!file || !path.isAbsolute(given)) throw new Error('Which file? Its full path, like ~/Documents/Deck.pptx')
    const p = path.resolve(given)
    let st
    try { st = fs.statSync(p) } catch { throw new Error('There\'s no file there') }
    if (!st.isFile()) throw new Error('That\'s a folder. Pick the files in it')
    if (links.some((x) => x.path === p)) throw new Error('That file is here already')
    l = { kind: 'file', path: p, name: String(name || '').trim().slice(0, 160) || path.basename(p), size: st.size, ...(mail ? { mail: { subject: String(mail.subject || '').slice(0, 160), from: String(mail.from || '').slice(0, 80) } } : {}) }
  }
  const out = { id: linkId(), ...l, from: by, addedAt: new Date().toISOString() }
  patchMeta(id, { links: [...links, out] })
  resave(id, 3000)
  if (out.kind === 'file') readTerms(id)
  return out
}
// A file sent from a browser page: kept in the meeting, then linked like any other.
export function keepFile(id, name, buf) {
  meta(id)
  const safe = fileSafe(path.basename(String(name || 'File'))).replace(/^\.+/, '_')
  if (!buf?.length) throw new Error('The file was empty')
  const dir = path.join(dirOf(id), 'files')
  fs.mkdirSync(dir, { recursive: true })
  let f = path.join(dir, safe)
  for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, safe.replace(/(\.[^.]*)?$/, ` ${i}$1`))
  fs.writeFileSync(f, buf)
  return addLink(id, { path: f })
}
export function removeLink(id, lid) {
  const m = meta(id)
  const l = (m.links || []).find((x) => x.id === String(lid))
  if (!l) throw new Error('No such file or link')
  // A copy kept here goes; a file somewhere else stays where it is.
  if (l.kind === 'file' && l.path.startsWith(path.join(dirOf(id), 'files') + path.sep)) fs.rmSync(l.path, { force: true })
  patchMeta(id, { links: m.links.filter((x) => x.id !== l.id) })
  resave(id, 3000)
  if (l.kind === 'file') readTerms(id)
  return { ok: true }
}
// One of Mail's attachments (~/Library/Mail), which a phone may link too.
export const mailFile = (p) => { const f = path.resolve(expand(String(p || ''))); return f.startsWith(path.join(os.homedir(), 'Library', 'Mail') + path.sep) && fs.existsSync(f) }
export function linkOf(id, lid) {
  const l = (meta(id).links || []).find((x) => x.id === String(lid))
  if (!l) throw new Error('No such file or link')
  return l
}
// Opens a file (or shows it in Finder), a link, or an email in Mail, on this computer. A file of a
// kind that could run something (a .command, .terminal or app) is shown in Finder instead.
export function openLink(id, lid, { reveal = false } = {}) {
  const l = linkOf(id, lid)
  if (l.kind === 'file' && !canOpen(l.path)) reveal = true
  const target = l.kind === 'file' ? l.path : l.kind === 'url' ? l.url : l.mail.mid ? `message://${encodeURIComponent(`<${l.mail.mid.replace(/^<|>$/g, '')}>`)}` : null
  if (!target) throw new Error('Mail didn\'t say how to find this email')
  if (l.kind === 'file' && !fs.existsSync(target)) throw new Error('The file isn\'t where it was')
  const [bin, args] = IS_MAC ? ['open', reveal && l.kind === 'file' ? ['-R', target] : [target]] : IS_WIN ? ['explorer.exe', [reveal && l.kind === 'file' ? `/select,${target}` : target]] : ['xdg-open', [reveal && l.kind === 'file' ? path.dirname(target) : target]]
  if (process.env.BRIDGE_FIX_DRYRUN) return { ok: true, dry: [bin, ...args] } // tests: nothing opens
  return new Promise((resolve) => { execFile(bin, args, { timeout: 10000 }, () => resolve({ ok: true })) })
}
// What may go with it, to add with a click: emails about it with files (Mail, on a Mac), and files
// you got lately (recent). ask: look in Downloads and on the Desktop even if macOS hasn't asked about
// them yet (you pressed Look for files): see recentFiles.
export async function suggest(id, { ask = false } = {}) {
  const m = meta(id)
  const have = m.links || []
  const [mail, recent] = await Promise.all([
    helpers.mailRelated ? helpers.mailRelated({ title: m.event?.title || m.title, start: m.startedAt }).catch(() => null) : null,
    recentFiles(m, { ask }).catch(() => ({ files: [] })),
  ])
  return {
    mail: (mail?.messages || []).map((x) => ({ ...x, linked: have.some((l) => l.kind === 'mail' && l.mail.id === x.id), files: x.files.map((f) => ({ ...f, linked: !!f.path && have.some((l) => l.path === f.path) })) })),
    mailReason: mail && !mail.available ? mail.reason : null,
    recent: recent.files.filter((f) => !have.some((l) => l.path === f.path)),
    recentBlocked: recent.blocked || null,
    recentAsk: recent.ask || null,
  }
}

// Files you got lately that look like they go with a meeting: in Downloads or on the Desktop, from
// two days before it to just after it, named after someone in it or a word of its name ("Priya
// Shah - Resume.pdf"), a resume or CV before an interview, or anything that came while it recorded.
// Only those folders' own files are looked at, each with fs.promises, so a big folder can't hold
// the server up. blocked: the folder macOS hasn't let Bridge AI read (Privacy & Security › Files and
// Folders). On a Mac the first look into either brings up macOS's question, so it waits for you to
// ask (Look for files, with ask) rather than come up by itself in the middle of a call: until then
// ask lists the folders not looked in. Once asked, they're looked in by themselves.
const PLAIN_WORDS = new Set('meeting meetings call sync with and the for re fw fwd weekly daily monthly quarterly review update chat intro interview round team catch catchup check discussion invite zoom teams meet google microsoft online new from via about our your notes'.split(' '))
const nameWords = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !/^\d+$/.test(w))
export async function recentFiles(m, { ask = false } = {}) {
  const t0 = Date.parse(m.startedAt), t1 = m.endedAt ? Date.parse(m.endedAt) : Date.now()
  const people = new Set([...(m.event?.attendees || []), ...(m.people || [])].flatMap(nameWords).filter((w) => !PLAIN_WORDS.has(w)))
  const title = new Set(nameWords(`${m.title} ${m.event?.title || ''}`).filter((w) => !PLAIN_WORDS.has(w) && w.length >= 4))
  const files = []
  let blocked = null
  const unasked = []
  for (const folder of ['Downloads', 'Desktop']) {
    const dir = path.join(os.homedir(), folder)
    if (!ask && !mayLook(dir)) { unasked.push(folder); continue }
    let names
    try { names = (await fs.promises.readdir(dir)).filter((n) => !n.startsWith('.') && !/\.(crdownload|part|download|tmp)$/i.test(n)).slice(0, 600) } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') blocked ||= folder; continue } finally { if (ask) noteAsked(dir) }
    for (const n of names) {
      const f = path.join(dir, n)
      let st
      try { st = await fs.promises.stat(f) } catch { continue }
      const at = st.mtimeMs // when it was downloaded or saved there
      if (!st.isFile() || at < t0 - 2 * 86400e3 || at > t1 + 30 * 60e3) continue
      const ws = new Set(nameWords(path.parse(n).name))
      const who = [...people].filter((w) => ws.has(w))
      const about = [...title].filter((w) => ws.has(w))
      const why = who.length ? 'name' : about.length ? 'title' : m.kind === 'interview' && [...ws].some((w) => /^(resume|cv|candidate|profile)$/.test(w)) ? 'resume' : at >= t0 - 5 * 60e3 ? 'during' : null
      if (!why) continue
      files.push({ path: f, name: n, folder, size: st.size, at: new Date(at).toISOString(), why, words: [...who, ...about].slice(0, 3), score: (why === 'name' ? 3 : why === 'resume' ? 2.5 : why === 'title' ? 2 : 1) + who.length + about.length * 0.5 - Math.abs(at - t0) / 86400e3 })
    }
  }
  return { files: files.sort((a, b) => b.score - a.score).slice(0, 6).map(({ score, ...f }) => f), blocked, ask: unasked.length ? unasked : null }
}

// The names and terms in the files that go with a meeting (a resume, a deck), for the speech engine
// to spell: words with a capital in them that aren't just the start of a sentence (Northwind,
// Contoso, OKRs), the ones that come up most first. Worked out again when a file is added or taken
// away.
const COMMON = new Set('the a an and or but for with from into over under to of in on at by as is are was were be been it its this that these those we our us i my me you your he she they them their his her if then than so not no yes all any each every some more most other such only own same very can will just also about after before during while when where which who what why how here there summary experience education skills projects project certifications profile contact objective achievements responsibilities agenda overview introduction conclusion appendix thanks questions page'.split(' '))
export function namesIn(text, n = 30) {
  const s = String(text || '')
  const lower = new Set((s.match(/(?<![\p{L}\p{N}])\p{Ll}\p{L}*/gu) || []))
  const count = new Map()
  for (const [w] of s.matchAll(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu)) {
    if (w.length < 2 || !/\p{Lu}/u.test(w) || COMMON.has(w.toLowerCase())) continue
    // Capitalized only at the start of a sentence, or a heading in capitals.
    if (/^\p{Lu}\p{Ll}+$/u.test(w) && lower.has(w.toLowerCase())) continue
    if (/^\p{Lu}+$/u.test(w) && w.length > 6) continue
    count.set(w, (count.get(w) || 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w)
}
const termsLater = new Map() // id -> timer
function readTerms(id) {
  clearTimeout(termsLater.get(id))
  termsLater.set(id, setTimeout(async () => {
    termsLater.delete(id)
    try {
      const files = (meta(id).links || []).filter((l) => l.kind === 'file' && doctext.readable(l.path)).slice(0, 6)
      const text = (await Promise.all(files.map((l) => doctext.textOf(l.path, 40_000).catch(() => '')))).join('\n')
      patchMeta(id, { fileTerms: namesIn(text, 30).join(', ').slice(0, 240) || null })
    } catch { /* gone */ }
  }, 300))
}

// The words on the screen and in the files and emails, for the model: by time for the screen;
// each file read now from where it is, up to room characters in all.
async function extras(id, m, room) {
  const out = []
  const shots = (m.captures || []).filter((c) => c.text || c.note).map((c) => `[${clock(c.t)}]${c.note ? ` (${c.note})` : ''} ${String(c.text || '').replace(/\s*\n\s*/g, ' / ').slice(0, 1500)}`)
  if (shots.length) out.push(`What was on the screen during the meeting (the words on pictures taken of it, by time in the meeting):\n${shots.join('\n')}`)
  const parts = []
  const each = Math.max(2000, Math.floor(room / Math.max(1, (m.links || []).length)))
  for (const l of m.links || []) {
    const src = l.from === 'invite' ? ', from the invite' : l.from === 'mail' || l.mail ? `, from an email${l.mail?.from ? ` from ${l.mail.from}` : ''}` : ''
    if (l.kind === 'url') { parts.push(`- ${l.name} (a link${src}: ${l.url}; not opened)`); continue }
    if (l.kind === 'mail') {
      try { const e = await helpers.mailMessage(l.mail.id); parts.push(`### Email: ${e.subject || l.name}${e.from ? `, from ${e.from}` : ''}\n${String(e.latest || '').slice(0, each)}${(e.attachments?.length ? e.attachments : l.mail.files || []).length ? `\n(Attached: ${(e.attachments?.length ? e.attachments : l.mail.files).join(', ')})` : ''}`) } catch (e) { parts.push(`- Email "${l.name}" couldn't be read (${e.message})`) }
      continue
    }
    try { parts.push(`### ${l.name}${src}\n${await doctext.textOf(l.path, each)}`) } catch (e) { parts.push(`- ${l.name}${src}: couldn't be read (${e.code === 'ENOENT' ? 'it isn\'t where it was' : e.message})`) }
  }
  if (parts.length) out.push(`Files, links and emails that go with this meeting:\n${parts.join('\n\n')}`)
  const text = out.join('\n\n')
  return text.length > room ? `${text.slice(0, room)}\n(cut short)` : text
}

// ---------- Summary, questions, saving ----------
// index.js hands over the model call (chatmodels.reply), the pick of model and the models there
// are, best first (setHelpers).
let helpers = { reply: null, pickModel: null, models: null, mailRelated: null, mailMessage: null }
export const setHelpers = (h) => { helpers = { ...helpers, ...h } }

// A model call that a dropped connection doesn't end: the same model again (twice, a few seconds
// apart, when it looks like the network or a busy service), then up to three of the other models
// you have. The answer says which model wrote it. Only when none can is it an error.
const RETRY_MS = Number(process.env.BRIDGE_MODEL_RETRY_MS || 3000)
const passing = (e) => /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|connection|overloaded|rate.?limit|too many requests|timed? ?out|\b(429|500|502|503|504|529)\b/i.test(String(e?.message || e))
async function replyAny(use, msgs, o) {
  const once = async (id) => {
    for (let i = 0; ; i++) {
      try { return { ...(await helpers.reply(id, msgs, o)), model: id } } catch (e) {
        if (i >= 2 || !passing(e)) throw e
        await new Promise((r) => setTimeout(r, RETRY_MS * (i + 1)))
      }
    }
  }
  try { return await once(use) } catch (first) {
    const others = ((await helpers.models?.().catch(() => [])) || []).filter((id) => id !== use).slice(0, 3)
    for (const id of others) { try { return { ...(await once(id)), fellBack: use, why: first.message } } catch { /* next */ } }
    first.tried = [use, ...others]
    throw first
  }
}
const noModel = () => Object.assign(new Error('No model to write with. Sign in to an agent, or add an API key or a local model in Settings › Model Providers.'), { code: 'no_model' })

// What to make of a meeting. General fits most; the others change what to look for.
export const KINDS = {
  general: { label: 'Any meeting', ask: 'Summarize this meeting.' },
  one_on_one: { label: '1:1', ask: 'This is a 1:1. Pull out how the other person is doing, feedback given either way, blockers, and what each of us agreed to do.' },
  standup: { label: 'Standup', ask: 'This is a standup. Per person: done, next, blocked. Keep it short.' },
  customer: { label: 'Customer call', ask: 'This is a call with a customer or prospect. Pull out their goals, pains, objections, buying signals, who decides, and the agreed next steps.' },
  interview: { label: 'Interview', ask: 'This is an interview. Summarize the candidate\'s answers by topic, strengths, concerns, and anything to follow up on. Stick to what was said.' },
  brainstorm: { label: 'Brainstorm', ask: 'This is a brainstorm. Group the ideas by theme, note which ones got support, and what was parked.' },
}

const SUMMARY_RULES = [
  'Write meeting notes in Markdown with these sections, leaving out any that would be empty:',
  '## Summary: 3 to 6 bullets, the outcome first.',
  '## Decisions: what was decided, one bullet each.',
  '## Action items: a checklist, "- [ ] Who: what (when, if said)". Use "You" for the person who recorded the meeting and "Them" or the name used in the meeting for others.',
  '## Notes: the key points by topic, as short bullets. When the user wrote their own notes, keep their words and headings, and add detail under them from the transcript.',
  '## Open questions: anything left unanswered.',
  'Only use what is in the transcript and notes. Do not invent names, numbers or dates. Plain words, no filler, no em-dashes.',
  'In the transcript, "You" is the person who recorded it (their microphone) and "Them" is everyone on the call.',
  'Speech to text mishears names. Write names the way the meeting memory, the title, the people invited or the user\'s notes spell them.',
  'When there are words from the screen or files and emails that go with the meeting, use them for names, numbers and what was being shown, and say when a point is from a slide or a document. The meeting comes first: don\'t summarize the files on their own.',
  'After the notes, add one fenced block for Bridge AI (it is removed from the notes), like this:\n```terms\n{"names": ["Acme", "Northwind Traders"], "misheard": {"Ack me": "Acme"}, "about": {"Priya Shah": "head of data at Northwind, the main contact there"}}\n```\n"names": the proper nouns in this meeting (people, companies, products, places, acronyms), spelled as they should be. "misheard": only clear speech-to-text mistakes of a name, as transcribed: as it should be. "about": who or what a name is, in a few words, only when this meeting makes it clear (a person\'s role and company and how they relate to the person who recorded it; what a product or project is), for the meetings after. Empty when there are none.',
].join('\n')
export const SUMMARY_LANGS = { auto: null, en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', hi: 'Hindi', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic' }

// About 4 characters a token. A model on this computer gets smaller pieces: many have a short
// context, and each piece is summarized first, then the pieces together.
const budget = (model) => (/^(ollama|lmstudio):/.test(model) ? 24_000 : 300_000)
function pieces(text, size) {
  const out = []
  let cur = ''
  for (const l of text.split('\n')) {
    if (cur.length + l.length > size && cur) { out.push(cur); cur = '' }
    cur += `${l}\n`
  }
  if (cur) out.push(cur)
  return out
}

// A summary that couldn't be written (no model reachable) is tried again by itself: every ten
// minutes, six times. Your notes and the transcript are kept and saved meanwhile.
const LATER_MS = Number(process.env.BRIDGE_SUMMARY_RETRY_MS || 600_000)
const later = new Map() // id -> timer
function tryLater(id, e) {
  let m
  try { m = meta(id) } catch { return }
  const tries = (m.summaryTries || 0) + 1
  if (e.code === 'no_model' || tries > 6 || /Nothing was transcribed/.test(e.message)) return patchMeta(id, { summaryRetryAt: null })
  const at = Date.now() + LATER_MS
  patchMeta(id, { summaryTries: tries, summaryRetryAt: new Date(at).toISOString() })
  clearTimeout(later.get(id))
  later.set(id, setTimeout(() => { later.delete(id); summarize(id, { again: true }).catch(() => {}) }, LATER_MS))
}

const summarizing = new Map() // id -> promise
// model, kind, language: this time (and remembered for the meeting). again: a retry by itself.
export function summarize(id, { model, kind, language, again = false } = {}) {
  if (summarizing.has(id)) return summarizing.get(id)
  if (!again) { clearTimeout(later.get(id)); later.delete(id) }
  const p = (async () => {
    const m = meta(id)
    const use = model || m.summaryModelPick || cfg.meetings?.model || await helpers.pickModel()
    if (!use) throw noModel()
    const k = KINDS[kind || m.kind || 'general'] || KINDS.general
    const lang = SUMMARY_LANGS[language ?? m.summaryLanguage ?? 'auto'] || null
    patchMeta(id, { summarizing: true, summaryError: null, summaryRetryAt: null, kind: kind || m.kind || 'general', ...(model ? { summaryModelPick: model } : {}), ...(language ? { summaryLanguage: language } : {}), ...(again ? {} : { summaryTries: 0 }) })
    // Who said what on the call, worked out once before the first summary (Settings › Meetings can
    // turn it off): from who was invited, names said ("Hi, Priya"), the meeting's name and the screen.
    // The summary can then say who's doing what. With one other person invited, it's them.
    if (cfg.meetings?.nameSpeakers !== false && !m.namedAt && !onlyGuest(m) && transcript(id).some((l) => l.src === 'them' && l.text)) {
      await nameSpeakers(id, { model: use }).catch(() => patchMeta(id, { namedAt: new Date().toISOString() }))
    }
    const text = transcriptText(id)
    const notes = filled(readText(path.join(dirOf(id), 'notes.md')), m.sections)
    if (!text && !notes && !(m.captures || []).some((c) => c.text)) throw new Error('Nothing was transcribed yet')
    const parts0 = (m.sections || []).length > 1 ? m.sections : null
    const named = transcript(id).some((l) => l.name)
    const about = [`Meeting: ${m.title}`, m.event?.attendees?.length ? `Invited: ${m.event.attendees.join(', ')}` : '', `Date: ${new Date(m.startedAt).toDateString()}`].filter(Boolean).join('\n')
    const mem = memory.about(`${m.title}\n${notes}\n${text}`)
    let body = text
    let used = use
    const size = budget(use)
    if (text.length > size) {
      // Long meeting: the main points of each part, in order, then the notes from those.
      const parts = pieces(text, size)
      const got = []
      for (const [i, part] of parts.entries()) {
        const r = await replyAny(used, [{ role: 'user', text: `${about}\n\nThis is part ${i + 1} of ${parts.length} of a meeting transcript. List its key points, decisions, action items (who and what) and open questions as short bullets. Only what is said.${parts0 ? ' Keep its section headings (## ...), with the points from each under it.' : ''}${mem ? `\n\n${mem}` : ''}\n\n${part}` }], { system: 'You take accurate meeting notes.' })
        used = r.model
        got.push(`### Part ${i + 1}\n${r.text}`)
      }
      body = `(The transcript was long, so here are the key points of each part, in order.)\n\n${got.join('\n\n')}`
    }
    const more = await extras(id, m, Math.min(80_000, Math.floor(size / 4)))
    const split = parts0 ? `\nThe person recording split the meeting into sections, each starting with a "## <name> (from m:ss)" heading in the transcript: ${parts0.map((x) => `"${x.title}"`).join(', ')}. Under ## Notes, give each section its own "### <name>" heading, in that order, with its points under it. Summary, Decisions and Action items are for the whole meeting; say which section one came from when that helps.` : ''
    const whoSaid = named ? '\nSome Them lines carry a name instead of "Them": who said it, named by the user or worked out from the meeting. Use those names for who said or agreed to what.' : ''
    const prompt = [about, mem ? `\n${mem}` : '', '', k.ask, '', SUMMARY_RULES, split, whoSaid, lang ? `\nWrite the notes in ${lang}.` : '', cfg.meetings?.instructions ? `\nAlso: ${cfg.meetings.instructions}` : '', notes ? `\nThe user's own notes:\n${notes}` : '', more ? `\n${more}` : '', `\nTranscript:\n${body}`].join('\n')
    const r = await replyAny(used, [{ role: 'user', text: prompt }], { system: 'You take accurate, useful meeting notes.' })
    let out = String(r.text || '').trim()
    // The names it found go to meeting memory; the block isn't part of the notes.
    const block = /```terms\s*\n([\s\S]*?)```/.exec(out)
    if (block) {
      out = out.replace(block[0], '').trim()
      try { memory.learn(JSON.parse(block[1]), { meeting: id, known: `${m.title}\n${(m.event?.attendees || []).join('\n')}\n${notes}`, heard: transcript(id, { raw: true }).map((l) => l.text).join('\n') }) } catch { /* not JSON: nothing learned */ }
    }
    if (!out) throw new Error('The model sent back nothing')
    writeFileAtomic(path.join(dirOf(id), 'summary.md'), `${out}\n`)
    patchMeta(id, { summarizing: false, summarizedAt: new Date().toISOString(), summaryModel: r.model, summaryNote: r.fellBack ? `${r.fellBack} couldn't be reached (${String(r.why).slice(0, 120)}), so ${r.model} wrote it.` : null, summaryTries: 0, summaryRetryAt: null })
    resave(id)
    return { summary: out, model: r.model }
  })().catch((e) => { try { patchMeta(id, { summarizing: false, summaryError: e.message, summaryTried: e.tried || null }); tryLater(id, e) } catch { /* gone */ } throw e }).finally(() => summarizing.delete(id))
  summarizing.set(id, p)
  return p
}

// A question about one meeting, answered from its transcript and notes.
export async function ask(id, question, { model } = {}) {
  const q = String(question || '').trim()
  if (!q) throw new Error('Ask something')
  const m = meta(id)
  const use = model || m.summaryModelPick || cfg.meetings?.model || await helpers.pickModel()
  if (!use) throw noModel()
  const text = transcriptText(id)
  const notes = readText(path.join(dirOf(id), 'notes.md')).trim()
  const summary = readText(path.join(dirOf(id), 'summary.md')).trim()
  const size = budget(use)
  const context = text.length > size ? `${summary}\n\n(Transcript, the end of it:)\n${text.slice(-size)}` : text
  const mem = memory.about(`${m.title}\n${notes}\n${context}`)
  const more = await extras(id, m, Math.min(60_000, Math.floor(size / 4)))
  const r = await replyAny(use, [{ role: 'user', text: `Meeting: ${m.title}, ${new Date(m.startedAt).toDateString()}\n${mem ? `\n${mem}\n` : ''}${notes ? `\nMy notes:\n${notes}\n` : ''}${more ? `\n${more}\n` : ''}\nTranscript ("You" is me, "Them" the others):\n${context}\n\nQuestion: ${q}\n\nAnswer from the meeting only, briefly. When asked to write something (a follow-up email, an update), write it ready to send, from what was said. Say so if it wasn't covered.` }], { system: 'You answer questions about a meeting from its transcript. Be accurate and brief.' })
  return { answer: String(r.text || '').trim(), model: r.model, note: r.fellBack ? `${r.fellBack} couldn't be reached, so ${r.model} answered.` : null }
}

// ---------- AI Assist ----------
// While a meeting records with AI Assist on, a model reads along and now and then suggests what to
// ask, raise or check next: from what's been said, the invite, the files that go with it (the
// candidate's resume, the deck) and your notes. Each says what it's based on, so you can tell a
// good one at a glance. Meeting memory is only background, used when today's meeting touches it.
// It's asked after a new line comes in, at most every ASSIST_MS and only once enough more has been
// said; Suggest now asks straight away. Kept in assist.json: { items: [{ id, t, kind, text, why,
// state: new | kept | dismissed }], at, upTo, error }.
const ASSIST_MS = Number(process.env.BRIDGE_ASSIST_MS || 60_000)
const ASSIST_WORDS = 40 // said since it last looked
const ASSIST_KINDS = {
  interview: 'You\'re helping the interviewer. Compare what the candidate says with their resume and the role (from the invite and the files). Suggest probing follow-ups: the specifics behind a claim (numbers, their own part versus the team\'s, how they measured it, trade-offs, what went wrong), a gap or a mismatch with the resume, an important part of the resume or the role not covered yet, and, when time is short, what\'s left (their questions, next steps).',
  customer: 'You\'re helping on a call with a customer or prospect. Suggest discovery questions not asked yet (goals, pains, budget, timing, who decides), an objection worth answering, and a next step to pin down.',
  one_on_one: 'You\'re helping in a 1:1. Suggest follow-ups on how they\'re doing, blockers, feedback either way, and what each of you agreed to do.',
  standup: 'You\'re helping in a standup. Point out a blocker nobody owns, something to take offline, and a missing update.',
  brainstorm: 'You\'re helping in a brainstorm. Suggest an angle not explored yet, an idea worth building on, and a question that sharpens the problem.',
  general: 'Suggest a question that would clear something up, a decision that has no owner or date yet, a risk or a point worth raising, or a useful idea.',
}
const KIND_WORD = { question: 'Ask', point: 'Raise', check: 'Check', idea: 'Idea' }
const assistFile = (id) => path.join(dirOf(id), 'assist.json')
export const assistOf = (id) => readJSON(assistFile(id), null) || { items: [], at: null, upTo: 0, error: null }
const assisting = new Map() // id -> promise
const assistLater = new Map() // id -> timer
// Called as each line comes in: ask once it's time, if it's on.
function assistSoon(id) {
  let m
  try { m = meta(id) } catch { return }
  if (!m.assist || m.status !== 'recording' || assisting.has(id) || assistLater.has(id)) return
  const a = assistOf(id)
  const wait = Math.max(0, ASSIST_MS - (Date.now() - Date.parse(a.at || 0)))
  assistLater.set(id, setTimeout(() => { assistLater.delete(id); assist(id).catch(() => {}) }, wait))
}
export function setAssist(id, on) {
  const m = patchMeta(id, { assist: !!on })
  if (on) assistSoon(id)
  return { on: !!m.assist, ...assistOf(id) }
}
// now: Suggest now (whatever was said since). Resolves with assist.json as it is then.
export function assist(id, { now = false, model } = {}) {
  if (assisting.has(id)) return assisting.get(id)
  const p = (async () => {
    const m = meta(id)
    const a = assistOf(id)
    const said = transcript(id).filter((l) => l.text)
    const fresh = said.filter((l) => l.t1 > (a.upTo || 0))
    if (!now && fresh.reduce((n, l) => n + tokens(l.text).length, 0) < ASSIST_WORDS) return a
    if (!said.length && !now) return a
    const use = model || cfg.meetings?.assistModel || m.summaryModelPick || cfg.meetings?.model || await helpers.pickModel()
    if (!use) throw noModel()
    const me = String(cfg.name || '').trim()
    const people = guests(m)
    const secs = nowIn(id, m) ?? m.seconds ?? 0
    const end = m.event?.end ? Math.round((Date.parse(m.event.end) - Date.now()) / 60000) : null
    const text = said.map((l) => `[${clock(l.t0)}] ${speaker(l)}: ${l.text}`).join('\n')
    const recent = text.length > 14_000 ? `(earlier lines left out)\n${text.slice(-14_000)}` : text
    const notes = filled(readText(path.join(dirOf(id), 'notes.md')), m.sections)
    const more = await extras(id, { ...m, captures: (m.captures || []).slice(-6) }, 24_000)
    const mem = memory.about(`${m.title}\n${people.join('\n')}\n${recent.slice(-4000)}`, 12)
    const before = a.items.slice(-12).map((x) => `- ${x.text}${x.state === 'dismissed' ? ' (not useful)' : ''}`).join('\n')
    const ask = [
      `Meeting: ${m.title}`, people.length ? `Invited, besides You: ${people.join(', ')}` : '', me ? `"You" is ${me}, who you're helping.` : '"You" is the person you\'re helping.',
      `It's ${clock(secs)} in${end != null ? (end >= 0 ? `, with ${end} minutes left` : `, ${-end} minutes past its end`) : ''}.`,
      more ? `\n${more}` : '', notes ? `\nYour notes so far:\n${notes}` : '',
      mem ? `\nBackground from earlier meetings (it may be out of date; use it only when today's meeting clearly touches it, and say so in "why"):\n${mem}` : '',
      before ? `\nSuggested already (don't repeat these or anything already covered):\n${before}` : '',
      '', `This meeting is going on now. ${ASSIST_KINDS[m.kind] || ASSIST_KINDS.general}`,
      'At most three suggestions, each a sentence or two to read at a glance mid-conversation. Fewer is better, and none is right when nothing stands out.',
      'Base each one on something specific: what was just said, the invite, a file or the notes, and say which in "why", briefly ("Resume: moved the fleet to electric vans at Northwind", "At 12:04 they said the launch slipped a month"). Never make up facts.',
      'kind: "question" (to ask), "point" (to raise or say), "check" (a claim or number that doesn\'t add up, or worth checking), "idea".',
      'Answer with one JSON object and nothing else: {"items": [{"kind": "question", "text": "...", "why": "..."}]}, or {"items": []}.',
    ].filter((x) => x !== '').join('\n')
    try {
      const r = await replyAny(use, [{ role: 'user', text: `${ask}\n\nTranscript so far:\n${recent || '(nothing yet)'}` }], { system: 'You quietly help someone during a live meeting with a few sharp, specific suggestions. You are brief and never make things up.' })
      const j = /\{[\s\S]*\}/.exec(String(r.text || ''))
      let items = []
      try { items = [].concat(JSON.parse(j ? j[0] : '{}').items || []) } catch { /* not JSON: nothing this time */ }
      const was = new Set(a.items.map((x) => x.text.toLowerCase()))
      const add = items.filter((x) => x && typeof x.text === 'string' && x.text.trim() && !was.has(x.text.trim().toLowerCase())).slice(0, 3)
        .map((x) => ({ id: crypto.randomBytes(4).toString('hex'), t: Math.round(secs), kind: KIND_WORD[x.kind] ? x.kind : 'idea', text: clean(x.text, 300), why: clean(x.why, 200), state: 'new', model: r.model }))
      const out = { items: [...a.items, ...add].slice(-60), at: new Date().toISOString(), upTo: said.length ? said[said.length - 1].t1 : 0, error: null }
      writeFileAtomic(assistFile(id), JSON.stringify(out, null, 1))
      return out
    } catch (e) {
      const out = { ...a, at: new Date().toISOString(), error: e.message }
      writeFileAtomic(assistFile(id), JSON.stringify(out, null, 1))
      throw e
    }
  })().finally(() => assisting.delete(id))
  assisting.set(id, p)
  return p
}
// A suggestion kept (it goes in your notes, "- [12:04] Ask: ...") or waved away.
export function markAssist(id, aid, state) {
  const a = assistOf(id)
  const x = a.items.find((i) => i.id === String(aid))
  if (!x) throw new Error('No such suggestion')
  if (!['kept', 'dismissed', 'new'].includes(state)) throw new Error('Keep it or dismiss it')
  if (state === 'kept' && x.state !== 'kept') quickNote(id, `${KIND_WORD[x.kind] || 'Idea'}: ${x.text}`)
  x.state = state
  writeFileAtomic(assistFile(id), JSON.stringify(a, null, 1))
  return a
}
export const assisted = (id) => assisting.has(id)

// ---------- Across meetings ----------
// Each meeting's words for search and for questions about several, kept until its files change.
const texts = new Map() // id -> { key, summary, notes, lines }
function textOf(m) {
  const d = dirOf(m.id)
  const at = (f) => { try { return fs.statSync(path.join(d, f)).mtimeMs } catch { return 0 } }
  const key = `${at('summary.md')}|${at('notes.md')}|${at('transcript.jsonl')}|${at('edits.json')}|${at('cleaned.json')}|${memory.changed()}`
  const had = texts.get(m.id)
  if (had?.key === key) return had
  const t = { key, summary: readText(path.join(d, 'summary.md')).trim(), notes: readText(path.join(d, 'notes.md')).trim(), lines: transcript(m.id).filter((l) => l.text) }
  texts.set(m.id, t)
  return t
}
const termsOf = (q) => [...new Set(String(q || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])].slice(0, 8)
// The words around the first term found in text, about 140 characters, starting a few words
// before it (so it shows on a phone's narrow row too).
function around(text, ws) {
  const low = text.toLowerCase()
  const found = ws.map((w) => low.indexOf(w)).filter((i) => i >= 0)
  const at = found.length ? Math.min(...found) : 0
  let from = Math.max(0, at - 24)
  if (from) { const sp = text.indexOf(' ', from); if (sp >= 0 && sp < at) from = sp + 1 }
  return `${from ? '…' : ''}${text.slice(from, from + 140).trim()}${from + 140 < text.length ? '…' : ''}`
}

// Every word of q in a meeting's title, the people invited, the summary, your notes or the
// transcript (as typed: "budg" finds budget), newest first, with where it was found and the words
// around it. Archived meetings are left out; archived: only those.
export function search(q, { archived = false } = {}) {
  const ws = termsOf(q)
  if (!ws.length) return { results: [] }
  const results = []
  for (const m of list().filter((x) => !!x.archived === !!archived)) {
    const t = textOf(m)
    const people = (m.event?.attendees || []).join(', ')
    const screens = (m.captures || []).map((c) => [c.note, c.text].filter(Boolean).join(' ')).filter(Boolean)
    const files = (m.links || []).map((l) => l.name)
    const all = [m.title, people, t.summary, t.notes, ...t.lines.map((l) => l.text), ...screens, ...files].join('\n').toLowerCase()
    if (!ws.every((w) => all.includes(w))) continue
    const has = (s) => ws.some((w) => s.toLowerCase().includes(w))
    const best = (rows) => rows.map((s) => ({ s, n: ws.filter((w) => s.toLowerCase().includes(w)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n)[0]?.s
    const prose = (s) => s.split('\n').map((x) => x.replace(/^\s*(#+|[-*]\s*(\[[ x]\]\s*)?)/, '').trim()).filter(Boolean)
    let hit
    if (has(m.title)) hit = { where: 'title' }
    else if (has(people)) hit = { where: 'people', snippet: people }
    else if (has(t.summary)) hit = { where: 'summary', snippet: around(best(prose(t.summary)) || t.summary, ws) }
    else if (has(t.notes)) hit = { where: 'notes', snippet: around(best(prose(t.notes)) || t.notes, ws) }
    else if (!t.lines.some((l) => has(l.text)) && screens.some(has)) hit = { where: 'screen', snippet: around(best(screens.map((x) => x.replace(/\s+/g, ' '))) || screens[0], ws) }
    else if (!t.lines.some((l) => has(l.text)) && files.some(has)) hit = { where: 'files', snippet: files.filter(has).join(', ') }
    else {
      const l = t.lines.find((x) => x.text === best(t.lines.map((y) => y.text))) || t.lines.find((x) => has(x.text))
      hit = l ? { where: 'transcript', who: speaker(l), t: clock(l.t0), snippet: around(l.text, ws) } : { where: 'title' }
    }
    results.push({ id: m.id, ...hit })
    if (results.length >= 200) break
  }
  return { results, terms: ws }
}

// "This week", "yesterday" and the like in a question: the meetings in that stretch.
function stretch(q) {
  const s = q.toLowerCase()
  const day = new Date(); day.setHours(0, 0, 0, 0)
  const monday = new Date(day); monday.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  const ago = (d, n) => { const x = new Date(d); x.setDate(x.getDate() - n); return x }
  if (/\btoday\b/.test(s)) return [day, null]
  if (/\byesterday\b/.test(s)) return [ago(day, 1), day]
  if (/\blast week\b/.test(s)) return [ago(monday, 7), monday]
  if (/\b(this|the) week\b|\bweekly\b/.test(s)) return [monday, null]
  if (/\blast month\b/.test(s)) return [new Date(day.getFullYear(), day.getMonth() - 1, 1), new Date(day.getFullYear(), day.getMonth(), 1)]
  if (/\bthis month\b/.test(s)) return [new Date(day.getFullYear(), day.getMonth(), 1), null]
  return null
}
const SMALL = new Set('a an and are about any did do does for from had has have how i in is it me my of on or our that the their them they this to was we were what when where which who why will with you your all last week weeks today yesterday month meeting meetings said say'.split(' '))

// A question about several meetings: the ones picked (ids), or else the ones it's most likely
// about (archived ones left out): those in the stretch it names ("this week"), with the most of its
// words, then the newest.
// Each goes in as its summary and your notes, or its transcript when it has no summary. The
// answer cites them as [1], [2], and sources says which meeting each number is.
export async function askAll(question, { ids, model } = {}) {
  const q = String(question || '').trim()
  if (!q) throw new Error('Ask something')
  const use = model || cfg.meetings?.model || await helpers.pickModel()
  if (!use) throw noModel()
  let pool = list()
  if (ids?.length) { const want = new Set(ids.map(String)); pool = pool.filter((m) => want.has(m.id)) } else {
    pool = pool.filter((m) => !m.archived)
    const span = stretch(q)
    if (span) pool = pool.filter((m) => { const t = Date.parse(m.startedAt); return t >= span[0].getTime() && (!span[1] || t < span[1].getTime()) })
    const ws = termsOf(q).filter((w) => !SMALL.has(w) && w.length > 2)
    const score = (m) => { const t = textOf(m); const all = [m.title, (m.event?.attendees || []).join(' '), t.summary, t.notes, t.lines.map((l) => l.text).join(' ')].join('\n').toLowerCase(); return ws.filter((w) => all.includes(w)).length + (ws.some((w) => m.title.toLowerCase().includes(w)) ? 1 : 0) }
    pool = pool.map((m, i) => ({ m, s: score(m), i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.m)
  }
  if (!pool.length) throw new Error(ids?.length ? 'Those meetings are gone' : 'No meetings from then')
  const room = budget(use)
  const parts = []
  const sources = []
  let used = 0
  for (const m of pool.slice(0, 20)) {
    const t = textOf(m)
    if (!t.summary && !t.notes && !t.lines.length) continue
    const head = `[${sources.length + 1}] "${m.title}", ${new Date(m.startedAt).toDateString()}${m.seconds ? `, ${clock(m.seconds)}` : ''}${m.event?.attendees?.length ? `, with ${m.event.attendees.slice(0, 8).join(', ')}` : ''}`
    const left = room - used - head.length
    if (left < 400 && parts.length) break
    const body = t.summary
      ? `${t.summary}${t.notes ? `\n\nMy notes:\n${t.notes}` : ''}`
      : [t.notes && `My notes:\n${t.notes}`, t.lines.length && `Transcript ("You" is me, "Them" the others):\n${transcriptText(m.id)}`].filter(Boolean).join('\n\n')
    const piece = `${head}\n${body.slice(0, Math.max(400, Math.min(left, 40_000)))}`
    parts.push(piece)
    used += piece.length
    sources.push({ n: sources.length + 1, id: m.id, title: m.title, startedAt: m.startedAt })
  }
  if (!parts.length) throw new Error('Nothing was transcribed in those meetings yet')
  const mem = memory.about(parts.join('\n'))
  const r = await replyAny(use, [{ role: 'user', text: `These are my meetings, each with a number.${mem ? `\n\n${mem}` : ''}\n\n${parts.join('\n\n---\n\n')}\n\nQuestion: ${q}\n\nAnswer from these meetings only, briefly, in plain words. After each point, cite the meeting it came from as [1], [2]. When asked to write something (an update, an email), write it ready to send, with the citations after it instead of in it. Say so if they don't cover it. Today is ${new Date().toDateString()}.` }], { system: 'You answer questions about the user\'s meetings from their notes and transcripts. Be accurate and brief, and cite the meetings.' })
  return { answer: String(r.text || '').trim(), model: r.model, sources, note: r.fellBack ? `${r.fellBack} couldn't be reached, so ${r.model} answered.` : null }
}

// The action items from the summary: "- [ ] Who: what".
export function actions(id) {
  const s = readText(path.join(dirOf(id), 'summary.md'))
  const at = s.search(/^##\s*Action items/im)
  if (at < 0) return []
  const section = s.slice(at).split(/\n(?=##\s)/)[0]
  return [...section.matchAll(/^\s*[-*]\s*\[ \]\s*(.+)$/gm)].map((x) => x[1].trim())
}

// As notes in your notes folder, laid out the way Granola's sync and its Obsidian plugin do it (and
// so a vault with Granola or Meetily notes gets these beside them). Settings › Meetings › Save
// notes picks, for the summary note and the transcript note each: the folder, a subfolder pattern
// ({year}/{month}/{day} to start with) and a file name pattern ({title}-summary); what to save
// (both, linked for Obsidian; one note with everything; or only one of them); front matter; the
// speakers' labels; and whether a saved meeting stays up to date.
// Once saved, a meeting stays in step: a new summary, title or notes save it again, and the notes
// it wrote before under another name or folder go, unless you've changed them since. All of it
// async: the folder is often in Documents, where macOS may first ask to allow access.
const DEFAULT_FOLDER = '~/Documents/Meeting notes'
export const folder = () => expand(cfg.meetings?.folder || DEFAULT_FOLDER)
export const LAYOUTS = { byDate: ['day', 'month', 'year', 'none'], layout: ['two', 'one'], what: ['both', 'one', 'summary', 'transcript'] }
const pad = (n) => String(n).padStart(2, '0')
const fileSafe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled'
const yamlList = (a) => `[${(a || []).map((x) => JSON.stringify(String(x))).join(', ')}]`
async function exists(p) { try { await fs.promises.access(p); return true } catch { return false } }
const hash = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 16)
// The vault the folder is in (the nearest folder with .obsidian), for links from its root.
async function vaultOf(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (await exists(path.join(d, '.obsidian'))) return d
    if (path.dirname(d) === d) return null
  }
}
// Settings › Meetings › Save notes, with what earlier versions had (folders by date, one note or
// two) as the starting point.
export function saving() {
  const c = cfg.meetings || {}
  const by = LAYOUTS.byDate.includes(c.byDate) ? c.byDate : 'day'
  const sub = { day: '{year}/{month}/{day}', month: '{year}/{month}', year: '{year}', none: '' }[by]
  const pre = by === 'none' ? '{date} ' : ''
  const what = LAYOUTS.what.includes(c.saveWhat) ? c.saveWhat : c.layout === 'one' ? 'one' : 'both'
  return {
    folder: folder(), noteSub: c.noteSub ?? sub, noteName: c.noteName || `${pre}{title}${what === 'one' ? '' : '-summary'}`,
    transcriptFolder: expand(c.transcriptFolder || c.folder || DEFAULT_FOLDER), transcriptSub: c.transcriptSub ?? sub, transcriptName: c.transcriptName || `${pre}{title}-transcript`,
    what, frontmatter: c.frontmatter !== false, you: String(c.youLabel || String(cfg.name || '').trim() || 'You').slice(0, 40), them: String(c.themLabel || 'Them').slice(0, 40), keep: c.keepSaved !== false,
  }
}
// A pattern filled in for a meeting: {year} {month} {day} {quarter} {date} {time} {title} {kind}.
// Folders stay inside the folder picked (no "..", no absolute paths).
function fill(pattern, m, { dir = false } = {}) {
  const at = new Date(m.startedAt)
  const v = { year: at.getFullYear(), month: pad(at.getMonth() + 1), day: pad(at.getDate()), quarter: `Q${Math.floor(at.getMonth() / 3) + 1}`, date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}-${pad(at.getMinutes())}`, title: m.title, kind: KINDS[m.kind]?.label || KINDS.general.label }
  const out = String(pattern || '').replace(/\{(\w+)\}/g, (x, k) => (k in v ? String(v[k]) : x))
  return dir ? out.split(/[\\/]+/).map((p) => fileSafe(p).replace(/^\.+$/, '_')).filter((p) => p && p !== 'Untitled').join(path.sep) : fileSafe(out)
}
// Where a meeting's notes go with Settings as they are.
export function target(m, o = saving()) {
  const note = o.what === 'transcript' ? null : path.join(o.folder, fill(o.noteSub, m, { dir: true }), `${fill(o.noteName, m)}.md`)
  const tr = o.what === 'both' || o.what === 'transcript' ? path.join(o.transcriptFolder, fill(o.transcriptSub, m, { dir: true }), `${fill(o.transcriptName, m)}.md`) : null
  return { note, transcript: tr === note ? null : tr }
}
// auto: a save by itself (Keep saved notes up to date), which leaves alone a note you've changed
// in your notes app since it was saved. Save, asked for, writes it as Bridge AI has it.
export async function save(id, { auto = false } = {}) {
  const m = meta(id)
  const o = saving()
  const { note, transcript: tfile } = target(m, o)
  const at = new Date(m.startedAt)
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const vault = await vaultOf(path.dirname(note || tfile))
  const link = (file) => `[[${(vault ? path.relative(vault, file) : path.basename(file)).split(path.sep).join('/').replace(/\.md$/, '')}]]`
  const label = (src) => (src === 'them' ? o.them : o.you)
  const notes = filled(readText(path.join(dirOf(id), 'notes.md')), m.sections)
  const summary = readText(path.join(dirOf(id), 'summary.md')).trim()
  const fm = (type, extra) => (o.frontmatter ? ['---', `meeting_id: ${m.id}`, `title: ${JSON.stringify(type === 'transcript' ? `${m.title} - Transcript` : m.title)}`, `type: ${type}`,
    `created: ${new Date(m.startedAt).toISOString()}`, `updated: ${new Date().toISOString()}`, `date: ${day}`, `duration: ${clock(m.seconds || 0)}`,
    `kind: ${JSON.stringify(KINDS[m.kind]?.label || KINDS.general.label)}`, `attendees: ${yamlList(m.event?.attendees)}`, 'source: bridge-ai', ...extra, '---'].join('\n') : '')
  const said = transcript(id).filter((l) => l.text)
  const files = []
  // Pictures go in an attachments folder beside the note; files and links stay links.
  const shots = (m.captures || []).filter((c) => c.kind !== 'paste')
  const pics = note ? (m.captures || []) : []
  if (pics.length) {
    const att = path.join(path.dirname(note), 'attachments')
    await fs.promises.mkdir(att, { recursive: true })
    for (const c of pics) await fs.promises.copyFile(path.join(dirOf(id), c.file), path.join(att, path.basename(c.file))).catch(() => {})
  }
  const mine = notes.replace(/\]\(<?captures\//g, '](attachments/')
  const screen = shots.length ? `## From the screen\n\n${shots.map((c) => `![${clock(c.t)}${c.note ? ` ${c.note.replace(/[[\]]/g, '')}` : ''}](attachments/${path.basename(c.file)})${c.note ? `\n${c.note}` : ''}`).join('\n\n')}` : ''
  const linkLine = (l) => (l.kind === 'url' ? `- [${l.name.replace(/[[\]]/g, '')}](${l.url})` : l.kind === 'mail' ? `- Email: ${l.name}${l.mail.from ? `, from ${l.mail.from}` : ''}${l.mail.mid ? ` ([open in Mail](message://${encodeURIComponent(`<${l.mail.mid.replace(/^<|>$/g, '')}>`)}))` : ''}` : `- [${l.name.replace(/[[\]]/g, '')}](<file://${l.path}>)`)
  const linked = (m.links || []).length ? `## Files and links\n\n${m.links.map(linkLine).join('\n')}` : ''
  if (note) {
    files.push([note, [fm('note', tfile ? [`transcript: ${JSON.stringify(link(tfile))}`] : []), `# ${m.title}`, summary, mine ? `## My notes\n\n${mine}` : '', screen, linked,
      tfile ? `Transcript: ${link(tfile)}` : o.what === 'one' && said.length ? `## Transcript\n\n${bySection(said, m.sections).map((l) => (l.head ? `### ${l.head.title}` : `[${clock(l.t0)}] ${speaker(l, label)}: ${l.text}`)).join('\n\n')}` : ''].filter(Boolean).join('\n\n')])
  }
  // The transcript as Granola writes it: a heading per stretch, with who and the time of day (and
  // one above each section).
  if (tfile) files.push([tfile, [fm('transcript', note ? [`note: ${JSON.stringify(link(note))}`] : []), `# Transcript for: ${m.title}`, bySection(said, m.sections).map((l) => (l.head ? `## ${l.head.title}` : `### ${speaker(l, label)} (${new Date(at.getTime() + l.t0 * 1000).toLocaleTimeString('en-GB')})\n\n${l.text}`)).join('\n\n') || '_Nothing was transcribed._'].filter(Boolean).join('\n\n')])
  const hashes = {}
  for (const [file, body] of files) {
    if (auto && m.savedHashes?.[file]) {
      const was = await fs.promises.readFile(file, 'utf8').catch(() => null)
      if (was != null && hash(was) !== m.savedHashes[file]) { hashes[file] = m.savedHashes[file]; continue }
    }
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, `${body}\n`)
    hashes[file] = hash(`${body}\n`)
  }
  // The ones it wrote before under another name or folder, if they're still as it left them (saved
  // before it kept track of that: if they still say they're this meeting's).
  const now = files.map(([f]) => f)
  for (const old of (m.savedFiles || []).filter((f) => !now.includes(f))) {
    const text = await fs.promises.readFile(old, 'utf8').catch(() => null)
    if (text != null && (m.savedHashes?.[old] ? m.savedHashes[old] === hash(text) : text.startsWith('---') && text.includes(`\nmeeting_id: ${m.id}\n`))) await fs.promises.rm(old, { force: true }).catch(() => {})
  }
  patchMeta(id, { saved: note || tfile, savedFiles: now, savedHashes: hashes })
  return { file: note || tfile, files: now }
}
// Meetings saved before, somewhere Settings wouldn't put them now (a folder or pattern changed).
export function misplaced() {
  const o = saving()
  return list().filter((m) => m.saved && (() => { const t = target(m, o); return [t.note, t.transcript].filter(Boolean).sort().join('|') !== [...(m.savedFiles || [])].sort().join('|') })())
}
// Save them again where Settings says now; their old notes go (when unchanged since).
export async function moveSaved() {
  const out = { moved: 0, failed: [] }
  for (const m of misplaced()) { try { await save(m.id); out.moved++ } catch (e) { out.failed.push({ id: m.id, error: e.message }) } }
  return out
}
const resaving = new Map()
function resave(id, ms = 0) {
  let m
  try { m = meta(id) } catch { return }
  if (!m.saved && !(cfg.meetings?.autoSave && m.summarizedAt)) return
  // "Keep saved notes up to date" off: a meeting saved once isn't written again by itself.
  if (m.saved && cfg.meetings?.keepSaved === false) return
  clearTimeout(resaving.get(id))
  resaving.set(id, setTimeout(() => { resaving.delete(id); save(id, { auto: true }).catch(() => {}) }, ms))
}
