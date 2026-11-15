// Record the screen too: the window or screen a meeting watches (screen.js keeps its stills), as a
// video with the meeting's sound, made by the browser (MediaRecorder) and sent to Bridge AI in
// pieces every two seconds or so (server/meetvideo.js), so closing Bridge AI or a crash loses only
// the last few seconds. MP4 (H.264) where the browser makes it (the desktop app, Chrome, Edge,
// Safari), which plays anywhere; else WebM (Firefox).
//
// Its sound: your mic, and the call: the shared screen's own sound when it has some (a browser
// tab's, or Windows' in the desktop app), else on a Mac the call's sound as Bridge AI records it
// (server/meetings.js hear), played into the video as it comes, a quarter of a second behind.
import { BASE } from '../../api.js'

const TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
// The kind of video this browser makes, or null.
export function videoType() {
  try { return typeof MediaRecorder === 'function' ? TYPES.find((x) => MediaRecorder.isTypeSupported(x)) || null : null } catch { return null }
}
// The screen can be recorded here: a browser that shares a screen and makes a video, with a
// computer behind it (not the demo). Not a phone or a tablet, whose browsers share no screen (and
// whose apps are bridgeNative and bridgeAndroid).
const touchOnly = () => !!window.bridgeNative || !!window.bridgeAndroid || !!window.matchMedia?.('(pointer: coarse) and (hover: none)').matches
export const canRecordScreen = () => import.meta.env.MODE !== 'demo' && !touchOnly() && !!navigator.mediaDevices?.getDisplayMedia && !!videoType()

const RATE = 16000 // the call's sound, as the server has it
const PIECE_MS = 2000
// A second's tick from a worker, which a page in the background still hears on time (screen.js).
const TICK = 'let t = setInterval(() => postMessage(0), 1000); onmessage = () => clearInterval(t)'

// A screen that doesn't change sends no new pictures, and a video given none keeps nothing (not
// even the sound) until one comes: a slide up for ten minutes would be ten minutes a crash could
// lose. So where the browser can (Chromium: the desktop app, Chrome, Edge), the video is given the
// screen's last picture again each second it hasn't changed (again()). Elsewhere, the screen as it is.
function steady(screen) {
  const as = { track: screen, again() {}, stop() {} }
  if (typeof MediaStreamTrackProcessor !== 'function' || typeof MediaStreamTrackGenerator !== 'function' || typeof VideoFrame !== 'function') return as
  try {
    const reader = new MediaStreamTrackProcessor({ track: screen }).readable.getReader()
    const out = new MediaStreamTrackGenerator({ kind: 'video' })
    const writer = out.writable.getWriter()
    let last = null
    let at = 0 // when it came
    let ts = 0 // its time, as the screen's pictures count it (µs)
    let over = false
    ;(async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ done: true }))
        if (done || over) { value?.close(); break }
        last?.close()
        last = value.clone()
        at = performance.now()
        ts = value.timestamp
        writer.write(value).catch(() => {})
      }
    })()
    return {
      track: out,
      again() {
        if (!last || over || performance.now() - at < 900) return
        const now = performance.now()
        ts += Math.round((now - at) * 1000)
        at = now
        try { writer.write(new VideoFrame(last, { timestamp: ts })).catch(() => {}) } catch { /* closed */ }
      },
      stop() { over = true; reader.cancel().catch(() => {}); writer.close().catch(() => {}); last?.close(); last = null; out.stop() },
    }
  } catch { return as }
}
// Pieces kept while Bridge AI can't be reached (about five minutes' worth); past that it stops.
const WAITING = 150
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const at = (id, more = '') => `${BASE}/api/meetings/${encodeURIComponent(id)}/videos${more}`
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { code: d.code })
  return d
}

// stream: from getDisplayMedia (its picture, and its own sound if it has some). mic: your mic's
// stream; call: the server records the call's sound (a Mac). onSize({ bytes, free, seconds }) as
// pieces are kept; onEnd(why) once it's over (why: null when it ended as asked).
// { pause, resume, mic(stream), stop() }; stop sends what's left and says it's done.
export async function recordVideo(id, stream, { mic, call = false, label, onSize, onEnd } = {}) {
  const type = videoType()
  if (!type) throw new Error("This browser can't make a video of the screen")
  const picture = stream.getVideoTracks()[0]
  if (!picture) throw new Error('Nothing to record: no picture from that screen')
  // The sound, mixed into one track.
  const ctx = new AudioContext()
  ctx.resume?.().catch(() => {})
  const out = ctx.createMediaStreamDestination()
  let micIn = null
  const useMic = (s) => {
    try { micIn?.disconnect() } catch { /* gone */ }
    micIn = s?.getAudioTracks().some((x) => x.readyState === 'live') ? ctx.createMediaStreamSource(s) : null
    micIn?.connect(out)
  }
  useMic(mic)
  const own = stream.getAudioTracks()[0]
  if (own) ctx.createMediaStreamSource(new MediaStream([own])).connect(out)
  const sound = own ? 'screen' : call ? 'call' : 'mic'
  const still = steady(picture)
  const quit = () => { still.stop(); ctx.close().catch(() => {}) }
  let rec
  try {
    rec = new MediaRecorder(new MediaStream([still.track, ...out.stream.getAudioTracks()]), { mimeType: type, videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 96_000, videoKeyFrameIntervalDuration: PIECE_MS })
  } catch (e) { quit(); throw new Error(e.message || "This browser can't make a video of the screen") }
  let v
  try { v = await post(at(id), { type, label, sound }) } catch (e) { quit(); throw e }
  const unhear = sound === 'call' ? hearCall(id, ctx, out) : null
  // Each second: the last picture again if the screen hasn't changed; every other one, what's been
  // recorded so far handed over (an MP4 is otherwise handed over only at its next keyframe).
  const ticker = new Worker(URL.createObjectURL(new Blob([TICK], { type: 'text/javascript' })))
  let ticks = 0
  ticker.onmessage = () => {
    still.again()
    if (++ticks % (PIECE_MS / 1000) === 0 && rec.state === 'recording') { try { rec.requestData() } catch { /* stopped */ } }
  }

  // How long it is: the time it's been recording, not paused.
  let ran = 0
  let from = Date.now()
  let paused = false
  const seconds = () => (ran + (paused ? 0 : Date.now() - from)) / 1000

  const box = [] // { seq, blob }, in order
  let seq = 0
  let sending = false
  let failing = 0
  let over = null // why it can't go on
  let ending = null
  const send = async () => {
    if (sending) return
    sending = true
    try {
      while (box.length && !over) {
        const p = box[0]
        let r = null
        let d = {}
        try {
          r = await fetch(at(id, `/${encodeURIComponent(v.id)}?seq=${p.seq}&s=${seconds().toFixed(1)}`), { method: 'POST', headers: { 'Content-Type': type.split(';')[0] }, body: p.blob })
          d = await r.json().catch(() => ({}))
        } catch { r = null }
        // Bridge AI's own refusal (the disk nearly full, the file couldn't be written, the meeting
        // gone: meetvideo.js gives each a code) ends it; anything else (no connection, the app
        // restarting, a relay in between) is tried again.
        if (r && !r.ok && d.code) { finish(d.error || d.code, true); return }
        if (!r || !r.ok) { failing++; await sleep(Math.min(10_000, 1000 * failing)); continue }
        failing = 0
        box.shift()
        if (!d.dup) onSize?.({ bytes: d.bytes, free: d.free ?? null, seconds: seconds() })
      }
    } finally { sending = false }
  }
  rec.ondataavailable = (e) => {
    if (!e.data?.size || over) return
    box.push({ seq: seq++, blob: e.data })
    if (box.length > WAITING) { finish("Bridge AI couldn't be reached for several minutes, so the video stops here. What was sent until then is kept."); return }
    send()
  }
  rec.onerror = (e) => finish(`The browser stopped recording it (${e.error?.message || e.error?.name || 'an error'}). What was sent until then is kept.`)

  // Over: as asked (stop), or why it can't go on (told: Bridge AI said so itself, and knows).
  const stop = () => (ending ||= (async () => {
    ticker.postMessage('stop')
    ticker.terminate()
    if (rec.state !== 'inactive') await new Promise((r) => { rec.addEventListener('stop', r, { once: true }); try { rec.stop() } catch { r() } })
    const until = Date.now() + 15_000
    while (box.length && !over && Date.now() < until) { send(); await sleep(250) }
    unhear?.()
    quit()
    if (!over?.told) await post(at(id, `/${encodeURIComponent(v.id)}/end`), { seconds: seconds(), ...(over ? { why: over.why } : {}) }).catch(() => {})
    onEnd?.(over?.why || null)
  })())
  function finish(why, told = false) {
    if (over) return
    over = { why, told }
    stop()
  }
  rec.start(PIECE_MS)
  return {
    id: v.id,
    sound,
    pause() { if (paused) return; paused = true; ran += Date.now() - from; if (rec.state === 'recording') rec.pause() },
    resume() { if (!paused) return; paused = false; from = Date.now(); if (rec.state === 'paused') rec.resume() },
    // The mic opened again (a call started or ended): its sound from now on.
    mic: useMic,
    stop,
  }
}

// The call's sound as Bridge AI records it (16 kHz, 16-bit, as it comes), into out. Played a
// quarter of a second behind, so it's smooth; when it falls behind or runs ahead, it starts again
// from now. Asked again if the connection drops. Returns what stops it.
function hearCall(id, ctx, out) {
  const quit = new AbortController()
  let next = 0
  let held = []
  let n = 0
  const play = () => {
    const b = ctx.createBuffer(1, n, RATE)
    const ch = b.getChannelData(0)
    let o = 0
    for (const f of held) { ch.set(f, o); o += f.length }
    held = []
    n = 0
    const src = ctx.createBufferSource()
    src.buffer = b
    src.connect(out)
    const now = ctx.currentTime
    if (next < now + 0.05 || next > now + 2) next = now + 0.25
    src.start(next)
    next += b.duration
  }
  ;(async () => {
    for (let tries = 0; tries < 20 && !quit.signal.aborted; tries++) {
      try {
        const r = await fetch(`${BASE}/api/meetings/${encodeURIComponent(id)}/sound`, { signal: quit.signal })
        if (!r.ok || !r.body) throw new Error('no sound')
        const reader = r.body.getReader()
        let rest = null
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          let bytes = value
          if (rest) { bytes = new Uint8Array(rest.length + value.length); bytes.set(rest); bytes.set(value, rest.length); rest = null }
          const even = bytes.length - (bytes.length % 2)
          if (even < bytes.length) rest = bytes.slice(even)
          const view = new DataView(bytes.buffer, bytes.byteOffset, even)
          const f = new Float32Array(even / 2)
          for (let i = 0; i < f.length; i++) f[i] = view.getInt16(i * 2, true) / 32768
          held.push(f)
          n += f.length
          if (ctx.state === 'suspended') ctx.resume().catch(() => {})
          if (n >= RATE / 10) play()
        }
      } catch { /* dropped: asked again */ }
      if (!quit.signal.aborted) await sleep(1000)
    }
  })()
  return () => quit.abort()
}

export const videoUrl = (id, v) => `${BASE}/api/meetings/${encodeURIComponent(id)}/videos/${encodeURIComponent(v.id)}?b=${v.bytes}`
