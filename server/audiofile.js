// An audio or video file as what the speech engines take: a 16 kHz mono 16-bit WAV, written where
// it's asked (a transcribed file's meeting keeps it as its recording, audio-you.wav). A WAV of any
// rate and channels (8, 16, 24 or 32-bit, or float) is read here, as it comes, so a long one never
// fills memory. Everything else goes to a program that reads it: ffmpeg when it's on this computer
// (every kind), else on a Mac its own afconvert, in every macOS (MP3, AAC and M4A, MP4 and MOV,
// AIFF, CAF, FLAC, Ogg). What nothing here reads (WebM on a Mac, an MP3 on Windows without ffmpeg)
// is said with code 'read-here': the page reads it itself, with the browser's own decoder, and
// sends the sound as a WAV (src/components/meetings/transcribefiles.js). The file read is always
// one in Bridge AI's data folder (sent in by the page), never one of your folders.
//   BRIDGE_FFMPEG, BRIDGE_AFCONVERT (tests): another program in their place, or 'none'.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { IS_MAC } from './paths.js'
import { tool } from './fixes.js'

const RATE = 16000
const fail = (message, code) => Object.assign(new Error(message), { code })

// What a file is, from its first bytes: a kind of audio or video (wav, mp3, mp4, ogg, flac, webm,
// aiff, caf, avi, asf, amr, ac3), 'other' (a document, a picture, an archive), or null (not known:
// a program may still read it).
export function sniff(b) {
  const s = (a, z) => b.toString('latin1', a, z)
  if (b.length < 12) return b.length ? null : 'empty'
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return 'wav'
  if ((s(0, 4) === 'RF64' || s(0, 4) === 'BW64') && s(8, 12) === 'WAVE') return 'wav'
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'AVI ') return 'avi'
  if (s(4, 8) === 'ftyp' || s(4, 8) === 'moov' || s(4, 8) === 'mdat' || s(4, 8) === 'wide' || s(4, 8) === 'free') return 'mp4'
  if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return 'mp3'
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac'
  if (s(0, 4) === 'OggS') return 'ogg'
  if (s(0, 4) === 'fLaC') return 'flac'
  if (b.readUInt32BE(0) === 0x1a45dfa3) return 'webm'
  if (s(0, 4) === 'FORM' && (s(8, 12) === 'AIFF' || s(8, 12) === 'AIFC')) return 'aiff'
  if (s(0, 4) === 'caff') return 'caf'
  if (b.readUInt32BE(0) === 0x3026b275) return 'asf'
  if (s(0, 5) === '#!AMR') return 'amr'
  if (b[0] === 0x0b && b[1] === 0x77) return 'ac3'
  // What's surely not sound: a PDF, a zip (Word, Excel, PowerPoint), a picture, text.
  if (s(0, 5) === '%PDF-' || s(0, 4) === 'PK\x03\x04' || s(0, 8) === '\x89PNG\r\n\x1a\n' || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || s(0, 4) === 'GIF8') return 'other'
  if (/^[\x09\x0a\x0d\x20-\x7e]{12}/.test(s(0, 12)) && !/^(RIFF|FORM)/.test(s(0, 4))) return 'other'
  return null
}
// What afconvert reads, of those.
const AFCONVERT = new Set(['wav', 'mp4', 'mp3', 'aac', 'aiff', 'caf', 'flac', 'ogg', 'amr', 'ac3'])
const NAMES = { mp3: 'MP3', aac: 'AAC', mp4: 'MP4', ogg: 'Ogg', flac: 'FLAC', webm: 'WebM or MKV', aiff: 'AIFF', caf: 'CAF', avi: 'AVI', asf: 'Windows Media', amr: 'AMR', ac3: 'AC-3', wav: 'WAV' }
export const kindName = (k) => NAMES[k] || null

const ffmpegBin = async () => { const e = process.env.BRIDGE_FFMPEG; return e === 'none' ? null : e || tool('ffmpeg') }
const afconvertBin = () => { const e = process.env.BRIDGE_AFCONVERT; return e === 'none' ? null : e || (IS_MAC && fs.existsSync('/usr/bin/afconvert') ? '/usr/bin/afconvert' : null) }
// How this computer reads files that aren't WAV: { ffmpeg, afconvert }, each true when it's here.
export async function readers() { return { ffmpeg: !!(await ffmpegBin()), afconvert: !!afconvertBin() } }

// ---------- A WAV, read here ----------
// Its format and where its sound is: { format, channels, rate, bits, at, bytes } or null.
async function wavInfo(file) {
  const h = await fs.promises.open(file, 'r')
  try {
    const head = Buffer.alloc(1 << 16)
    const { bytesRead } = await h.read(head, 0, head.length, 0)
    const b = head.subarray(0, bytesRead)
    const total = (await h.stat()).size
    let fmt = null
    let at = 12
    while (at + 8 <= b.length) {
      const id = b.toString('latin1', at, at + 4)
      const n = b.readUInt32LE(at + 4)
      if (id === 'fmt ') {
        let format = b.readUInt16LE(at + 8)
        if (format === 0xfffe && n >= 40) format = b.readUInt16LE(at + 8 + 24) // extensible: its sub-format
        fmt = { format, channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) }
      } else if (id === 'data' && fmt) {
        // A size it couldn't write (RF64, or a recording cut off): to the end of the file.
        const bytes = n === 0xffffffff || n === 0 || at + 8 + n > total ? total - at - 8 : n
        return { ...fmt, at: at + 8, bytes }
      }
      at += 8 + n + (n % 2)
    }
    return null
  } finally { await h.close() }
}
const SAMPLE = {
  '1:8': [1, (b, o) => (b[o] - 128) / 128],
  '1:16': [2, (b, o) => b.readInt16LE(o) / 32768],
  '1:24': [3, (b, o) => b.readIntLE(o, 3) / 8388608],
  '1:32': [4, (b, o) => b.readInt32LE(o) / 2147483648],
  '3:32': [4, (b, o) => b.readFloatLE(o)],
  '3:64': [8, (b, o) => b.readDoubleLE(o)],
}
// The WAV's sound to 16 kHz mono: each sample the average of the stretch it stands for (which keeps
// out what's too high to keep), or for a lower rate the sample it falls in.
async function wavToWav(src, dest, info, signal) {
  const [size, read] = SAMPLE[`${info.format}:${info.bits}`]
  const step = size * info.channels
  const ratio = info.rate / RATE
  const out = fs.createWriteStream(dest)
  const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject) })
  out.write(header(0))
  let i = 0 // frames read
  let o = 0 // samples written
  let sum = 0
  let cnt = 0
  let rest = null
  let written = 0
  const input = fs.createReadStream(src, { start: info.at, end: info.at + info.bytes - 1, highWaterMark: 1 << 20 })
  for await (let b of input) {
    if (signal?.aborted) { input.destroy(); break }
    if (rest) { b = Buffer.concat([rest, b]); rest = null }
    const frames = Math.floor(b.length / step)
    if (b.length > frames * step) rest = b.subarray(frames * step)
    const pcm = new Int16Array(Math.ceil(frames / Math.min(1, ratio)) + 2)
    let n = 0
    for (let f = 0; f < frames; f++, i++) {
      let v = 0
      for (let c = 0; c < info.channels; c++) v += read(b, f * step + c * size)
      v /= info.channels
      if (ratio >= 1) {
        const k = Math.floor(i / ratio)
        if (k !== o && cnt) { pcm[n++] = clip(sum / cnt); o = k; sum = 0; cnt = 0 }
        sum += v
        cnt++
      } else {
        while (Math.floor(o * ratio) === i) { pcm[n++] = clip(v); o++ }
      }
    }
    if (n) { const buf = Buffer.from(pcm.buffer, 0, n * 2); written += buf.length; if (!out.write(buf)) await new Promise((r) => out.once('drain', r)) }
  }
  if (ratio >= 1 && cnt) { const buf = Buffer.alloc(2); buf.writeInt16LE(clip(sum / cnt)); written += 2; out.write(buf) }
  out.end()
  await done
  if (signal?.aborted) throw fail('Stopped', 'stopped')
  await fixHeader(dest, written)
}
const clip = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
function header(bytes) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + bytes, 4); h.write('WAVE', 8, 'latin1'); h.write('fmt ', 12, 'latin1')
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24)
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36, 'latin1'); h.writeUInt32LE(bytes, 40)
  return h
}
async function fixHeader(file, bytes) {
  const h = await fs.promises.open(file, 'r+')
  try { await h.write(header(bytes), 0, 44, 0) } finally { await h.close() }
}

// ---------- Another program ----------
// One run of a program that writes dest, stopped by signal: what it said on its error output, when
// it failed.
function program(bin, args, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let err = ''
    p.stderr.on('data', (b) => { err = (err + b).slice(-2000) })
    const stop = () => { try { p.kill() } catch { /* gone */ } }
    signal?.addEventListener('abort', stop, { once: true })
    p.on('error', (e) => { signal?.removeEventListener('abort', stop); reject(e) })
    p.on('close', (code) => {
      signal?.removeEventListener('abort', stop)
      if (signal?.aborted) reject(fail('Stopped', 'stopped'))
      else if (code === 0) resolve()
      else reject(Object.assign(new Error(err.trim().split('\n').pop() || `It stopped (${code})`), { said: err }))
    })
  })
}
// A WAV another program wrote, as 16 kHz mono 16-bit, with its size set right (ffmpeg's are; one
// cut off isn't): its length in seconds.
async function written(dest) {
  const info = await wavInfo(dest).catch(() => null)
  if (!info || info.format !== 1 || info.bits !== 16 || info.channels !== 1 || info.rate !== RATE) throw fail('It wasn\'t read as sound', 'unreadable')
  if (info.at !== 44) {
    // Anything before the sound besides the format (ffmpeg's LIST): moved up behind a plain header.
    const tmp = `${dest}.tmp`
    const out = fs.createWriteStream(tmp)
    out.write(header(info.bytes))
    await new Promise((resolve, reject) => { fs.createReadStream(dest, { start: info.at, end: info.at + info.bytes - 1 }).on('error', reject).pipe(out).on('finish', resolve).on('error', reject) })
    await fs.promises.rename(tmp, dest)
  } else await fixHeader(dest, info.bytes)
  return info.bytes / 2 / RATE
}

// ---------- Any file ----------
const noRoom = (e) => e?.code === 'ENOSPC' || /No space left/i.test(String(e?.said || e?.message || ''))
// The file at src as a 16 kHz mono WAV at dest: { seconds, kind, via } ('wav', 'ffmpeg',
// 'afconvert'). Throws with words for the page and a code: 'not-media' (a document, a picture),
// 'read-here' (nothing on this computer reads this kind: the page may), 'unreadable' (damaged, or
// no sound in it), 'no-room' (the disk is full), 'no-sound' (silent, or too short), 'stopped'.
export async function toWav(src, dest, { signal } = {}) {
  const head = Buffer.alloc(64)
  const h = await fs.promises.open(src, 'r')
  let got
  try { ({ bytesRead: got } = await h.read(head, 0, 64, 0)) } finally { await h.close() }
  const kind = sniff(head.subarray(0, got))
  const name = kindName(kind)
  if (kind === 'empty') throw fail('This file is empty.', 'unreadable')
  if (kind === 'other') throw fail('This isn\'t an audio or video file.', 'not-media')
  let seconds
  let via
  try {
    const info = kind === 'wav' ? await wavInfo(src).catch(() => null) : null
    const ff = await ffmpegBin()
    const af = afconvertBin()
    if (info && SAMPLE[`${info.format}:${info.bits}`] && info.channels && info.rate) {
      await wavToWav(src, dest, info, signal)
      seconds = info.bytes / (SAMPLE[`${info.format}:${info.bits}`][0] * info.channels) / info.rate
      via = 'wav'
    } else if (ff) {
      await program(ff, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', src, '-vn', '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', '-f', 'wav', dest], signal).catch((e) => {
        if (e.code === 'stopped' || noRoom(e)) throw e
        throw fail(/does not contain any stream|matches no streams/i.test(e.said || '') ? 'There\'s no sound in this file: a video without a sound track has nothing to transcribe.' : `Bridge AI couldn't read the sound in this file${name ? ` (${name})` : ''}. It may be damaged.`, 'unreadable')
      })
      seconds = await written(dest)
      via = 'ffmpeg'
    } else if (af && (!kind || AFCONVERT.has(kind))) {
      await program(af, ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', src, dest], signal).catch((e) => {
        if (e.code === 'stopped' || noRoom(e)) throw e
        // afconvert says the same for a kind it doesn't know, a damaged file and a video without sound.
        throw fail(kind ? `Bridge AI couldn't read the sound in this file (${name}). It may have no sound track, or be damaged.` : 'Bridge AI can\'t read this kind of file on this computer.', kind ? 'unreadable' : 'read-here')
      })
      seconds = await written(dest)
      via = 'afconvert'
    } else {
      throw fail(name ? `Bridge AI can't read ${name} files on this computer by itself.` : 'Bridge AI can\'t read this kind of file on this computer.', 'read-here')
    }
  } catch (e) {
    await fs.promises.rm(dest, { force: true }).catch(() => {})
    await fs.promises.rm(`${dest}.tmp`, { force: true }).catch(() => {})
    if (noRoom(e)) throw fail('There isn\'t enough free space on this computer\'s disk to read it.', 'no-room')
    if (e.code) throw e
    throw fail(`Bridge AI couldn't read the sound in this file${name ? ` (${name})` : ''}.`, 'unreadable')
  }
  if (!(seconds >= 0.3)) { await fs.promises.rm(dest, { force: true }).catch(() => {}); throw fail('There\'s no sound in this file to transcribe.', 'no-sound') }
  return { seconds, kind, via }
}
