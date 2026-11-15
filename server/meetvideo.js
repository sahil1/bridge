// The screen as a video while a meeting records (Record the screen too; the page's side is
// src/components/meetings/videorec.js). The page records the window or screen it watches, with the
// meeting's sound, and sends it here in pieces every two seconds or so. Each piece goes on the end
// of the file as it comes, so Bridge AI closing or the computer crashing loses only the last few
// seconds, and what was kept plays as it is: MP4 (fragmented, as the browser writes it) where the
// browser makes it, else WebM. A meeting keeps its videos in its own folder (video-1.mp4, and
// video-2.mp4 when it's recorded again or a screen is watched again), with videos.json saying where
// each starts in the meeting, how long and how big it is, and how it ended. Nothing here sends one
// anywhere: it stays on this computer.
//
// Before each piece, the disk: with less than meetings.videoKeepFreeGB free (2 GB unless set), the
// video stops there and says why. The meeting itself records on.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DATA, IS_MAC, IS_WIN, writeFileAtomic } from './paths.js'
import { freeBytes } from './machine.js'
import { elapsed } from './meetings.js'

const DIR = path.join(DATA, 'meetings')
let cfg = {}
export const configure = (c) => { cfg = c || {} }

const dirOf = (id) => {
  if (!/^[\w-]+$/.test(String(id || ''))) throw new Error('No such meeting')
  return path.join(DIR, id)
}
const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const meetingOf = (id) => readJSON(path.join(dirOf(id), 'meeting.json'))
const listFile = (id) => path.join(dirOf(id), 'videos.json')
const all = (id) => { const v = readJSON(listFile(id), []); return Array.isArray(v) ? v : [] }
const save = (id, list) => writeFileAtomic(listFile(id), JSON.stringify(list, null, 2))
function patch(id, vid, p) {
  const list = all(id)
  const v = list.find((x) => x.id === String(vid))
  if (!v) throw new Error('No such video')
  Object.assign(v, p)
  save(id, list)
  return v
}

const EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm' }
const extOf = (type) => EXT[String(type || '').split(';')[0].trim().toLowerCase()] || null
// What's in its sound: your mic, and the call's as Bridge AI records it (a Mac), or the shared
// screen's own (a browser tab's, Windows').
const SOUNDS = ['mic', 'call', 'screen']
const keepFree = () => { const g = cfg.meetings?.videoKeepFreeGB; return (typeof g === 'number' && g >= 0 ? g : 2) * 1e9 }
const gb = (b) => { const g = Math.max(0, b / 1e9); return `${g < 10 ? g.toFixed(1) : Math.round(g)} GB` }
const low = (free, starting) => (starting
  ? `Only ${gb(free)} is free on this computer's disk, and recording the screen keeps ${gb(keepFree())} free. Make some room, then try again.`
  : `Stopped with ${gb(free)} free on this computer's disk, to keep ${gb(keepFree())} free. What was recorded until then is kept.`)

// One piece at a time for each video, in the order they came.
const lanes = new Map()
function inLane(key, fn) {
  const p = (lanes.get(key) || Promise.resolve()).then(fn, fn)
  const tail = p.catch(() => {})
  lanes.set(key, tail)
  tail.then(() => { if (lanes.get(key) === tail) lanes.delete(key) })
  return p
}

// A new video for a meeting that's recording, starting now in the meeting (where its transcript is
// up to). type: what the page records (video/mp4 or video/webm); label: the window or screen's
// name; sound: what its sound has in it (SOUNDS). Refused with the disk nearly full.
export async function start(id, { type, label, sound } = {}) {
  const m = meetingOf(id)
  if (!m) throw new Error('No such meeting')
  if (m.parts) throw new Error('A combined meeting has no recording of its own')
  if (m.status !== 'recording' && m.status !== 'paused') throw new Error('Start recording the meeting first')
  const ext = extOf(type)
  if (!ext) throw new Error('A video is kept as MP4 or WebM')
  const free = await freeBytes(dirOf(id))
  if (free != null && free < keepFree()) throw Object.assign(new Error(low(free, true)), { code: 'disk' })
  const list = all(id)
  let n = list.length + 1
  while (list.some((x) => x.id === String(n)) || fs.existsSync(path.join(dirOf(id), `video-${n}.${ext}`))) n++
  const now = new Date().toISOString()
  const v = { id: String(n), file: `video-${n}.${ext}`, type: String(type).slice(0, 100), t: Math.round((elapsed(id) || 0) * 100) / 100, at: now, lastAt: now, bytes: 0, seconds: 0, seq: -1, state: 'recording', why: null, label: String(label || '').slice(0, 80), sound: SOUNDS.includes(sound) ? sound : 'mic' }
  await fs.promises.writeFile(path.join(dirOf(id), v.file), '')
  save(id, [...all(id), v])
  return { ...view(v), free }
}

// A piece of a video, put on the end of its file. seq: its number, so one sent again (a dropped
// connection) isn't written twice; seconds: how long the video is now, as the page counts it.
// A video that can't go on (the disk nearly full, its file can't be written) stops and says why,
// with a code the page stops on: 'disk', 'failed', or the state it ended in.
export function piece(id, vid, buf, { seq, seconds } = {}) {
  return inLane(`${id}/${vid}`, async () => {
    const v = all(id).find((x) => x.id === String(vid))
    if (!v) throw Object.assign(new Error('No such video'), { code: 'gone' })
    if (v.state !== 'recording') throw Object.assign(new Error(v.why || 'This video has ended'), { code: v.state === 'done' ? 'ended' : v.state })
    if (seq != null && seq !== '' && Number(seq) <= v.seq) return { dup: true, bytes: v.bytes }
    if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('Nothing in that piece')
    const free = await freeBytes(dirOf(id))
    if (free != null && free - buf.length < keepFree()) {
      const why = low(free, false)
      patch(id, vid, { state: 'stopped', why, endedAt: new Date().toISOString() })
      throw Object.assign(new Error(why), { code: 'disk' })
    }
    try { await fs.promises.appendFile(path.join(dirOf(id), v.file), buf) } catch (e) {
      const why = `It couldn't be written to this computer's disk (${e.code || e.message}). What was recorded until then is kept.`
      patch(id, vid, { state: 'failed', why, endedAt: new Date().toISOString() })
      throw Object.assign(new Error(why), { code: 'failed' })
    }
    const s = Number(seconds)
    const now = patch(id, vid, { seq: seq != null && seq !== '' ? Number(seq) : v.seq + 1, bytes: v.bytes + buf.length, seconds: Number.isFinite(s) && s > v.seconds ? Math.round(s * 10) / 10 : v.seconds, lastAt: new Date().toISOString() })
    return { bytes: now.bytes, seconds: now.seconds, free }
  })
}

// The page stopped it: the meeting stopped, the screen stopped being shared, or why it couldn't go
// on (the browser's recorder failed). One with nothing in it is let go.
export function end(id, vid, { seconds, why } = {}) {
  return inLane(`${id}/${vid}`, async () => {
    const v = all(id).find((x) => x.id === String(vid))
    if (!v) throw new Error('No such video')
    if (v.state !== 'recording') return view(v)
    if (!v.bytes && !why) { await fs.promises.rm(path.join(dirOf(id), v.file), { force: true }); save(id, all(id).filter((x) => x.id !== v.id)); return { gone: true } }
    const s = Number(seconds)
    return view(patch(id, vid, { state: why ? 'failed' : 'done', why: why ? String(why).slice(0, 300) : null, endedAt: new Date().toISOString(), ...(Number.isFinite(s) && s > v.seconds ? { seconds: Math.round(s * 10) / 10 } : {}) }))
  })
}

// A meeting's videos, for its page. One still recording when its meeting isn't, with nothing sent
// for a while, was cut off: Bridge AI or its window closed while it recorded.
export function list(id) {
  let m
  try { m = meetingOf(id) } catch { return [] }
  if (!m) return []
  const live = m.status === 'recording' || m.status === 'paused'
  return all(id).map((v) => {
    const cut = v.state === 'recording' && !live && Date.now() - Date.parse(v.lastAt || v.at) > 30_000
    return view(cut ? { ...v, state: 'cut', why: 'Bridge AI or its window closed while the screen was recorded. What was sent until then is kept.' } : v)
  })
}
const view = (v) => ({ id: v.id, type: v.type, ext: path.extname(v.file).slice(1), t: v.t, at: v.at, endedAt: v.endedAt || null, bytes: v.bytes, seconds: v.seconds, state: v.state, why: v.why || null, label: v.label || '', sound: v.sound })

export function file(id, vid) {
  const v = all(id).find((x) => x.id === String(vid))
  if (!v) throw new Error('No such video')
  return path.join(dirOf(id), v.file)
}

// Deleted (to make room): its file and its entry. Not while it records.
export async function remove(id, vid) {
  const v = list(id).find((x) => x.id === String(vid))
  if (!v) throw new Error('No such video')
  if (v.state === 'recording') throw new Error('It\'s still recording. Stop watching the screen first.')
  await fs.promises.rm(file(id, vid), { force: true })
  save(id, all(id).filter((x) => x.id !== v.id))
  return { ok: true }
}

// Shown in Finder (or the Explorer, or the folder it's in).
export function reveal(id, vid) {
  const f = file(id, vid)
  const [bin, args] = IS_MAC ? ['open', ['-R', f]] : IS_WIN ? ['explorer.exe', [`/select,${f}`]] : ['xdg-open', [path.dirname(f)]]
  if (process.env.BRIDGE_FIX_DRYRUN) return { ok: true, dry: [bin, ...args] }
  const p = spawn(bin, args, { stdio: 'ignore', detached: true })
  p.on('error', () => {})
  p.unref()
  return { ok: true }
}
