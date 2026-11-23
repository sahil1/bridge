// Transcribe a file or a folder: audio or video dropped on Bridge AI (its window, or its Dock icon
// on a Mac), picked in Meetings or ⌘K, or sent from the phone, each turned into a transcript with
// who spoke and when, by the same engines as meetings (speech.js) and the same speaker model
// (voices.js). Each file becomes a meeting of its own (meetings.js fromFile), so it's read, asked
// about, exported and shared as a meeting is.
//
// A file comes in from the page (or the desktop app, for one dropped on its Dock icon) in pieces of
// a couple of megabytes, each checked against its SHA-256, so a phone sends one through the relay as
// it does a photo (transfers.js), and the server never reads one of your folders: what's read is
// the copy in the meeting's folder, which goes once its sound is out of it. Then one file at a time:
//   reading       its sound, as a 16 kHz WAV (audiofile.js), kept as the meeting's recording
//   model         the speech model's one download, the first time (progress)
//   transcribing  its spoken stretches, as a meeting's after it ends (progress: how far it's heard)
//   speakers      the voices told apart (the speaker model's download first, the first time)
// What can't be done says why on the file's line: not a sound or video file, no sound in it,
// nothing on this computer reads its kind (the page then reads it itself and sends the sound:
// state 'read-here'), no room left on the disk, a download that didn't come. Several (a folder)
// go one after another, each with its own line; one that fails leaves the rest going.
//
// Kept in <data>/meetings/files.json (the lines, for a day after they're done), so a phone sees
// what the computer is doing, and a restart carries on: a file that was all here is transcribed
// from its start again; one that was still coming in says so, to be added again.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA, IS_MAC, writeFileAtomic } from './paths.js'
import { freeBytes } from './machine.js'
import * as meetings from './meetings.js'
import * as speech from './speech.js'
import * as voices from './voices.js'
import { toWav } from './audiofile.js'

let cfg = {}
export const configure = (c) => { cfg = c || {} }
const FILE = () => path.join(DATA, 'meetings', 'files.json')
export const PIECE = 2 * 1024 * 1024 // what the page sends at a time (a request may carry a little over)
const MAX_FILES = 500 // added at once (a folder)
const KEEP_DONE = 24 * 3600e3
const STALE = Number(process.env.BRIDGE_FILES_STALE_MS) || 15 * 60e3 // a file that stopped coming in
const MARGIN = 200e6 // kept free on the disk
const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/
const HOLD_MS = Number(process.env.BRIDGE_FILES_HOLD_MS) || 3000 // how often a file waiting on a recording looks again

// ---------- The lines ----------
let items = null // [{ id, name, size, type, batch, state, got, percent, error, code, at, by, with, ... }]
const load = () => {
  if (items) return items
  try { items = JSON.parse(fs.readFileSync(FILE(), 'utf8')).items || [] } catch { items = [] }
  return items
}
let saving = null
function save() {
  clearTimeout(saving)
  saving = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(FILE()), { recursive: true }); writeFileAtomic(FILE(), JSON.stringify({ items: load() }, null, 1)) } catch { /* kept in memory */ }
  }, 200)
  saving.unref?.()
}
const find = (id) => load().find((x) => x.id === id)
const set = (x, p) => { Object.assign(x, p, { changed: Date.now() }); save(); return x }
// What the page shows: the lines of the files still going, and those done in the last day.
export function list() {
  const now = Date.now()
  for (const x of load()) {
    // Stopped coming in (the page closed, the phone locked for long): said, to add again.
    if (['waiting', 'sending'].includes(x.state) && now - (x.changed || x.at) > STALE) fail(x, 'The file stopped coming in before all of it was here. Add it again.', 'stale')
    // Waiting for the page that sent it to read it (it does at once): one that's gone never will.
    if (x.state === 'read-here' && now - (x.changed || x.at) > Math.min(STALE, 2 * 60e3)) fail(x, `${x.error || 'Bridge AI can\'t read this kind of file on this computer.'} The window it came from closed before it could read it instead. Add it again there.`, 'read-here')
  }
  items = load().filter((x) => !['done', 'failed'].includes(x.state) || now - (x.changed || x.at) < KEEP_DONE)
  return { items: items.map(view), going: items.some((x) => !['done', 'failed'].includes(x.state)), piece: PIECE }
}
const view = (x) => ({
  id: x.id, name: x.name, size: x.size, state: x.state, got: x.got || 0, percent: percentOf(x), error: x.error || null, code: x.code || null,
  note: x.note || null, batch: x.batch || null, at: x.at, seconds: x.seconds || null, meeting: x.meeting ? x.id : null, by: x.by || 'page', lang: x.lang || null,
})
const percentOf = (x) => {
  if (x.state === 'sending') return x.size ? Math.min(99, Math.floor(((x.got || 0) / x.size) * 100)) : 0
  if (x.state === 'model') return speech.downloading(x.model)?.percent ?? x.percent ?? 0
  if (x.state === 'transcribing') return meetings.fileProgress(x.id) ?? x.percent ?? 0
  if (x.state === 'speakers') return voices.working(x.id)?.percent ?? x.percent ?? 0
  return x.state === 'done' ? 100 : null
}
function fail(x, error, code) {
  set(x, { state: 'failed', error, code: code || null })
  // Nothing of it worth keeping: its meeting goes (one with a transcript stays, and says so).
  if (!x.keep) { try { meetings.remove(x.id) } catch { /* gone already */ } x.meeting = false }
}

// ---------- In ----------
// What the page has: the files' names, sizes and kinds (type), and how to transcribe them (with:
// { engine, localModel, language, speakers }). Each gets its line and its meeting, then the page
// sends each one (piece), and says when it's all there (done). by: 'page' or 'app' (the desktop
// app, for files dropped on its Dock icon).
export async function add({ files = [], with: how = {}, by = 'page' } = {}) {
  const list = [].concat(files).slice(0, MAX_FILES)
  if (!list.length) throw new Error('No files to transcribe')
  const w = withOf(how)
  const batch = list.length > 1 ? crypto.randomBytes(4).toString('hex') : null
  const free = await freeBytes(path.join(DATA, 'meetings'))
  let need = 0
  const out = []
  for (const f of list) {
    const size = Math.max(0, Math.floor(Number(f?.size) || 0))
    const name = String(f?.name || 'Recording').replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255) || 'Recording'
    if (!size) { out.push({ name, size, state: 'failed', error: 'This file is empty.', code: 'empty', at: Date.now(), id: `x-${crypto.randomBytes(4).toString('hex')}`, batch }); continue }
    need += size
    // Room for it, and for what's read out of it (a WAV about twice an MP3's size), and a little over.
    if (free != null && free < need + MARGIN) {
      out.push({ name, size, state: 'failed', error: `Not enough free space: ${name} needs ${Math.ceil((size + MARGIN) / 1e6)} MB, and there's ${Math.max(0, Math.floor((free - need + size) / 1e6))} MB free.`, code: 'no-room', at: Date.now(), id: `x-${crypto.randomBytes(4).toString('hex')}`, batch })
      need -= size
      continue
    }
    const m = meetings.fromFile({ name, size, type: f?.type, modified: f?.modified, language: w.language })
    out.push({ id: m.id, name, size, type: String(f?.type || '').slice(0, 100), state: 'waiting', got: 0, at: Date.now(), changed: Date.now(), by: by === 'app' ? 'app' : 'page', with: w, batch, meeting: true })
  }
  load().push(...out)
  save()
  return { items: out.map(view), piece: PIECE }
}
const withOf = (h = {}) => ({
  engine: ['local', 'apple'].includes(h.engine) || (typeof h.engine === 'string' && Object.hasOwn(speech.SERVICES, h.engine)) ? h.engine : null,
  localModel: h.localModel && speech.modelById(h.localModel) ? speech.now(h.localModel) : null,
  language: typeof h.language === 'string' && LANG.test(h.language) ? h.language : null,
  speakers: h.speakers !== false,
})
const sourceOf = (x) => path.join(meetings.fileDir(x.id), 'source.part')
const hex = (b) => crypto.createHash('sha256').update(b).digest('hex')
// One piece of the file, at its place (at: the bytes before it): what's here now ({ have }). A
// piece sent twice (a retry after a dropped connection) is taken once; one out of place is told
// where to carry on from.
export async function piece(id, at, buf, sha) {
  const x = find(id)
  if (!x || !['waiting', 'sending'].includes(x.state)) throw Object.assign(new Error(x?.state === 'failed' ? x.error : 'That file isn\'t coming in any more'), { status: 409, code: 'gone' })
  if (sha && hex(buf) !== String(sha).toLowerCase()) throw Object.assign(new Error('A piece of the file was damaged on the way'), { status: 422, code: 'damaged' })
  const file = sourceOf(x)
  const have = await fs.promises.stat(file).then((s) => s.size, () => 0)
  if (Number(at) !== have) return { have }
  if (have + buf.length > x.size) throw Object.assign(new Error('More came than the file is'), { status: 400 })
  try { await fs.promises.appendFile(file, buf) } catch (e) {
    if (e.code === 'ENOSPC') { fail(x, 'There\'s no space left on this computer\'s disk for it.', 'no-room'); throw Object.assign(new Error(x.error), { status: 507, code: 'no-room' }) }
    throw e
  }
  set(x, { state: 'sending', got: have + buf.length })
  return { have: have + buf.length }
}
// All of it is here: it waits its turn.
export async function done(id) {
  const x = find(id)
  if (!x) throw Object.assign(new Error('No such file'), { status: 404 })
  if (!['waiting', 'sending'].includes(x.state)) return view(x)
  const have = await fs.promises.stat(sourceOf(x)).then((s) => s.size, () => 0)
  if (x.size && have !== x.size) throw Object.assign(new Error('Not all of the file is here yet'), { status: 409, code: 'short', have })
  if (!have) { fail(x, 'This file is empty.', 'empty'); return view(x) }
  set(x, { state: 'queued' })
  pump()
  return view(x)
}
// The page read a kind of file nothing here reads (read-here), and sends its sound instead: a
// 16 kHz WAV of size bytes, in pieces as before. failed: it couldn't read it either ('decode'), or
// it's too big to read there ('big').
export async function again(id, { size, failed } = {}) {
  const x = find(id)
  if (!x || x.state !== 'read-here') throw Object.assign(new Error('That file isn\'t waiting to be read'), { status: 409 })
  if (failed) {
    const why = x.error || 'Bridge AI can\'t read this kind of file on this computer.'
    const ff = IS_MAC ? '' : ' With ffmpeg on this computer, Bridge AI reads every kind.'
    fail(x, failed === 'big'
      ? `${why} It's too big to read in this window instead.${ff}`
      : `${why} This window couldn't read it either: it may be damaged, or have no sound track.${ff}`, 'unreadable')
    return view(x)
  }
  const bytes = Math.max(0, Math.floor(Number(size) || 0))
  if (!bytes) throw Object.assign(new Error('No sound came'), { status: 400 })
  const free = await freeBytes(path.join(DATA, 'meetings'))
  if (free != null && free < bytes + MARGIN) { fail(x, `Not enough free space: its sound needs ${Math.ceil((bytes + MARGIN) / 1e6)} MB, and there's ${Math.floor(free / 1e6)} MB free.`, 'no-room'); return view(x) }
  await fs.promises.rm(sourceOf(x), { force: true })
  set(x, { state: 'waiting', size: bytes, got: 0, error: null, code: null, read: 'page', type: 'audio/wav' })
  return view(x)
}
// Stop it (one still going: its meeting goes too), or take a finished line off the list.
export function drop(id) {
  const x = find(id)
  if (!x) return { ok: true }
  if (!['done', 'failed'].includes(x.state)) {
    x.stop = true
    x.abort?.abort()
    meetings.stopFile(id)
    try { meetings.remove(id) } catch { /* gone */ }
  }
  items = load().filter((y) => y !== x)
  save()
  return { ok: true }
}
// The finished lines (done, failed) off the list.
export function clear() {
  items = load().filter((x) => !['done', 'failed'].includes(x.state))
  save()
  return list()
}

// ---------- One at a time ----------
let busy = null
function pump() {
  if (busy) return
  const x = load().find((y) => y.state === 'queued')
  if (!x) return
  busy = x
  run(x).catch((e) => { if (!x.stop) fail(x, e.message || 'It couldn\'t be transcribed', e.code) }).finally(() => { busy = null; delete x.abort; save(); pump() })
}
async function run(x) {
  const dir = meetings.fileDir(x.id)
  const src = path.join(dir, 'source.part')
  const wav = path.join(dir, 'audio-you.wav')
  // Its sound, read out of it; the copy that came in goes.
  if (fs.existsSync(src)) {
    set(x, { state: 'reading', error: null, code: null })
    x.abort = new AbortController()
    let r
    try { r = await toWav(src, wav, { signal: x.abort.signal }) } catch (e) {
      if (x.stop) return
      // Nothing here reads it: the page can, from the file it still has (Dock drops can't).
      if (e.code === 'read-here' && x.by === 'page' && x.read !== 'page') { await fs.promises.rm(src, { force: true }); set(x, { state: 'read-here', error: e.message, code: 'read-here' }); return }
      await fs.promises.rm(src, { force: true }).catch(() => {})
      throw Object.assign(new Error(e.code === 'read-here' && x.by === 'app' ? `${e.message} Drop it into Bridge AI's window instead: it reads more kinds there.` : e.message), { code: e.code })
    }
    await fs.promises.rm(src, { force: true })
    if (x.stop) return
    set(x, { seconds: Math.round(r.seconds) })
  } else if (!fs.existsSync(wav)) throw Object.assign(new Error('The file isn\'t here any more. Add it again.'), { code: 'gone' })
  const seconds = x.seconds || 0
  // The engine for it: the one picked for it, else the meetings'. A speech model not here yet is
  // downloaded first, with its progress on the line (the Mac's own speech doesn't stand in for a
  // file: what was picked is what transcribes it).
  const c = { ...cfg, meetings: { ...(cfg.meetings || {}), ...(x.with?.engine ? { engine: x.with.engine } : {}), ...(x.with?.localModel ? { localModel: x.with.localModel } : {}) } }
  const st = await speech.status(c)
  const engine = st.standIn ? 'local' : st.engine
  if (engine === 'local') {
    const m = speech.localModel(c)
    const why = speech.whyNot(m.id)
    if (why) throw Object.assign(new Error(`${m.label} can't run on this computer: ${why.replace(/^\w/, (s) => s.toLowerCase())}.`), { code: 'model' })
    if (!speech.have(m)) {
      set(x, { state: 'model', model: m.id, percent: 0 })
      speech.fetchModel(m.id)
      await speech.downloaded(m.id)
      if (x.stop) return
      if (!speech.have(m)) throw Object.assign(new Error(`The speech model (${m.label}) didn't download: ${speech.downloading(m.id)?.error || 'try again.'}`), { code: 'model' })
    }
    c.meetings.localModel = m.id
  } else if (engine === 'apple') {
    if (!st.apple.available) throw Object.assign(new Error(`The Mac's own speech isn't available here (${st.apple.why || 'it needs macOS 26 or later'}).`), { code: 'engine' })
  } else if (!st.services.find((s) => s.id === engine)?.ready) throw Object.assign(new Error('That speech service needs its key first, in Settings › Model Providers.'), { code: 'engine' })
  c.meetings.engine = engine
  // A meeting being recorded goes first: the file waits for it to end (it'd share the engine).
  while (meetings.soundComing() && !x.stop) { if (x.state !== 'held') set(x, { state: 'held' }); await new Promise((r) => setTimeout(r, HOLD_MS)) }
  if (x.stop) return
  set(x, { state: 'transcribing', percent: 0, engine })
  x.keep = true
  await meetings.transcribeFile(x.id, { engine, localModel: c.meetings.localModel, language: x.with?.language, seconds })
  if (x.stop) return
  const said = meetings.transcript(x.id, { raw: true }).filter((l) => l.text)
  const m = meetings.get(x.id)
  const missed = m.pending ? `${m.pending === 1 ? 'A part wasn\'t' : `${m.pending} parts weren't`} transcribed: ${m.error || 'the speech engine failed'}. Open it to try them again.` : null
  if (!said.length) { set(x, { state: 'done', note: missed || 'No one is heard speaking in it.' }); return }
  // Who spoke: told apart where it can run here, unless turned off for these files.
  const vs = await voices.status()
  if (x.with?.speakers !== false && vs.offered && said.length > 1) {
    set(x, { state: 'speakers', percent: 0 })
    try { await voices.tell(x.id, said, { file: true }); await voices.wait(x.id) } catch (e) { if (!x.stop) set(x, { note: `Who spoke wasn't told apart: ${e.message}` }) }
    if (x.stop) return
  }
  set(x, { state: 'done', ...(missed ? { note: missed } : {}), lang: meetings.get(x.id).transcript.find((l) => l.lang)?.lang || null })
}

// After a restart: a file that was all here goes again from its start (reading it, or from its
// sound when that was out already); one still coming in can't be finished, and says so.
export function recover() {
  for (const x of load()) {
    if (['waiting', 'sending', 'read-here'].includes(x.state)) fail(x, 'Bridge AI closed before all of the file was here. Add it again.', 'stale')
    else if (['queued', 'reading', 'model', 'held', 'transcribing', 'speakers'].includes(x.state)) {
      let ok = false
      try { const d = meetings.fileDir(x.id); ok = fs.existsSync(path.join(d, 'source.part')) || fs.existsSync(path.join(d, 'audio-you.wav')) } catch { /* gone */ }
      if (ok) set(x, { state: 'queued', percent: 0 })
      else fail(x, 'Bridge AI closed before it was done, and the file isn\'t here any more. Add it again.', 'stale')
    }
  }
  save()
  pump()
}
