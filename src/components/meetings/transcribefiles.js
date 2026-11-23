// Transcribe a file or a folder, from this page (server/meetfiles.js): files picked here, or
// dropped (a folder's files with it), sent to the computer in pieces with their SHA-256 (as a
// phone's photo is: Transfers.jsx), one file after another. A kind of file the computer can't read
// itself (its line says read-here) is read in this page instead, by the browser's own decoder (Web
// Audio), and its sound sent as a 16 kHz WAV. The files stay in this page until they're in, so a
// page that's closed or reloaded can't carry on (the line says to add the file again).
//
// offer(files): the dialog that asks how to transcribe them (TranscribeFiles.jsx), wherever the
// files came from: Meetings' button, ⌘K, a drop on the window.
import { apiUrl, refetch } from '../../api.js'

// Audio and video, by what the browser says it is or by its name (a folder's files often come with
// no type).
const EXT = /\.(mp3|m4a|m4b|m4r|aac|wav|wave|aif|aiff|aifc|caf|flac|ogg|oga|opus|wma|amr|mp4|m4v|mov|qt|mkv|webm|avi|wmv|3gp|3g2|mpg|mpeg|mts|m2ts|ts|ac3)$/i
export const isMedia = (f) => /^(audio|video)\//.test(f?.type || '') || EXT.test(f?.name || '')
export const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.aiff,.caf,.flac,.ogg,.opus,.wma,.amr,.mp4,.m4v,.mov,.mkv,.webm,.avi,.wmv,.3gp,.mpg,.mpeg,.ts'
// A folder can be picked here (not in a phone's browser, which picks files only).
export const canPickFolder = () => { try { return 'webkitdirectory' in document.createElement('input') && !matchMedia('(pointer: coarse)').matches } catch { return false } }

// ---------- Where files come from ----------
export const offer = (files, more = {}) => window.dispatchEvent(new CustomEvent('bridge-transcribe', { detail: { files: [...files], ...more } }))
// The system's own picker: files of audio or video, or a folder (each file in it, and in the
// folders in it). Called straight from a click or a key, so the browser lets it open.
export function pick({ folder = false } = {}) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  if (folder) input.webkitdirectory = true
  else input.accept = ACCEPT
  input.style.display = 'none'
  document.body.append(input)
  const gone = () => setTimeout(() => input.remove(), 0)
  input.addEventListener('change', () => { const files = [...(input.files || [])]; gone(); if (files.length) offer(files, { folder, picked: files.length }) }, { once: true })
  input.addEventListener('cancel', gone, { once: true })
  input.click()
}
// What a drop brings, with every file in a folder dropped (up to max), read while the drop is
// still going (entries can only be taken then). Resolves with { files, folder }.
export function dropped(dt, max = 500) {
  // A file as itself; a folder as its entry, to read what's in it.
  const items = [...(dt?.items || [])].filter((i) => i.kind === 'file')
  const plan = items.map((i) => { const e = i.webkitGetAsEntry?.(); return e?.isDirectory ? { dir: e } : { file: i.getAsFile() } })
  if (!items.length) plan.push(...[...(dt?.files || [])].map((f) => ({ file: f })))
  const out = []
  let folder = false
  const file = (e) => new Promise((ok) => e.file(ok, () => ok(null)))
  const all = (dir) => new Promise((ok) => {
    const r = dir.createReader()
    const got = []
    const more = () => r.readEntries((b) => { if (!b.length) ok(got); else { got.push(...b); more() } }, () => ok(got))
    more()
  })
  const walk = async (e, depth) => {
    if (!e || out.length >= max) return
    if (e.isFile) { const f = await file(e); if (f) out.push(f); return }
    if (e.isDirectory && depth < 6) { folder = true; for (const k of await all(e)) await walk(k, depth + 1) }
  }
  return (async () => {
    for (const x of plan) { if (x.dir) await walk(x.dir, 0); else if (x.file && out.length < max) out.push(x.file) }
    return { files: out.slice(0, max), folder }
  })()
}
// Whether what's being dragged may be audio or video (its kind is only known once it's dropped:
// a folder, or a file the browser has no type for, may be).
export const mayBeMedia = (dt) => [...(dt?.items || [])].some((i) => i.kind === 'file' && (/^(audio|video)\//.test(i.type) || !i.type)) || (!dt?.items && [...(dt?.types || [])].includes('Files'))
export const hasFiles = (dt) => [...(dt?.types || [])].includes('Files')

// ---------- Sending ----------
const kept = new Map() // line id -> what this page sends for it (the File, or its sound as a WAV)
let queue = Promise.resolve()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
async function digest(buf) { try { return crypto?.subtle ? hex(await crypto.subtle.digest('SHA-256', buf)) : null } catch { return null } }
async function call(method, p, body, sha) {
  const raw = body instanceof ArrayBuffer
  const r = await fetch(apiUrl(p), { method, headers: raw ? { 'Content-Type': 'application/octet-stream', ...(sha ? { 'X-Sha256': sha } : {}) } : { 'Content-Type': 'application/json' }, body: raw ? body : body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, code: j.code })
  return j
}
// One file, from where the computer has got to: a dropped connection waits and carries on.
async function send(id, blob, piece) {
  const e = encodeURIComponent(id)
  for (let tries = 0, at = 0; ;) {
    try {
      while (at < blob.size) {
        const buf = await blob.slice(at, Math.min(blob.size, at + piece)).arrayBuffer()
        at = (await call('PUT', `/meetings/files/${e}?at=${at}`, buf, await digest(buf))).have
        tries = 0
      }
      await call('POST', `/meetings/files/${e}/done`)
      return
    } catch (err) {
      // Turned down there (stopped, no room, gone): its line says why. Anything else, the connection.
      if (err.code === 'short') at = 0
      const passing = !err.status || (err.status >= 500 && err.status !== 507) || err.code === 'damaged' || err.code === 'short'
      if (!passing || ++tries > 8) { kept.delete(id); return }
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** tries)))
    } finally { refetch('/meetings/files') }
  }
}
// The files, how to transcribe them ({ engine, localModel, language, speakers }): their lines,
// then each one sent in turn. Resolves with the lines once they're there (not when they're sent).
export async function transcribe(files, how) {
  const list = [...files]
  const r = await call('POST', '/meetings/files', { files: list.map((f) => ({ name: f.name, size: f.size, type: f.type, modified: f.lastModified })), with: how })
  r.items.forEach((x, i) => { if (x.state !== 'failed' && list[i]) kept.set(x.id, list[i]) })
  for (const x of r.items) if (kept.has(x.id)) queue = queue.then(() => send(x.id, kept.get(x.id), r.piece || 2 * 1024 * 1024))
  refetch('/meetings/files')
  return r
}
export const stop = (id) => { kept.delete(id); return call('DELETE', `/meetings/files/${encodeURIComponent(id)}`).finally(() => refetch('/meetings/files')) }
export const holds = (id) => kept.has(id)

// ---------- Read here ----------
// A file the computer can't read: decoded by this browser (it reads MP3, AAC, MP4 and more, as it
// plays them), its sound to 16 kHz mono, and sent as a WAV. Too big to hold in memory here, or not
// a kind the browser reads either: the line says so.
const reading = new Set()
const HERE_MAX = 600 * 1024 * 1024
export async function readHere(x, piece) {
  const f = kept.get(x.id)
  if (!f || reading.has(x.id)) return
  reading.add(x.id)
  const e = encodeURIComponent(x.id)
  try {
    let wav
    try {
      if (f.size > HERE_MAX) throw Object.assign(new Error('big'), { why: 'big' })
      wav = await toWav(f)
    } catch (err) {
      kept.delete(x.id)
      await call('POST', `/meetings/files/${e}/again`, { failed: err.why || 'decode' }).catch(() => {})
      return
    }
    kept.set(x.id, wav)
    await call('POST', `/meetings/files/${e}/again`, { size: wav.size })
    await send(x.id, wav, piece || 2 * 1024 * 1024)
  } finally { reading.delete(x.id); refetch('/meetings/files') }
}
async function toWav(file) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!Ctx) throw Object.assign(new Error('no decoder'), { why: 'decode' })
  const ctx = new Ctx(1, 16000, 16000)
  const buf = await file.arrayBuffer()
  const audio = await new Promise((ok, no) => { const p = ctx.decodeAudioData(buf, ok, no); if (p?.then) p.then(ok, no) })
  const n = audio.length
  if (!n) throw Object.assign(new Error('silent'), { why: 'decode' })
  const chans = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
  // decodeAudioData gives it at the context's rate (16 kHz); the channels made one.
  const ratio = audio.sampleRate / 16000
  const out = new Int16Array(Math.floor(n / ratio))
  for (let i = 0; i < out.length; i++) {
    const j = Math.floor(i * ratio)
    let s = 0
    for (const c of chans) s += c[j]
    out[i] = Math.max(-32768, Math.min(32767, Math.round((s / chans.length) * 32767)))
  }
  const h = new DataView(new ArrayBuffer(44))
  const str = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); h.setUint32(4, 36 + out.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, 16000, true)
  h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); str(36, 'data'); h.setUint32(40, out.length * 2, true)
  return new Blob([h.buffer, out.buffer], { type: 'audio/wav' })
}
