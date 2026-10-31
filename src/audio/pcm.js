// Sound from the mic as 16 kHz mono 16-bit PCM, made in the page by a small audio worklet: what the
// speech engines on the computer take as it is, so nothing needs converting there (no ffmpeg).
// Meetings (meetings/recorder.js) send it to the server a second at a time; dictation and voice
// notes (dictation/controller.js) keep it until you stop and send it once, as a WAV file (and, for
// live words, send it as it comes too).
//
// The audio context runs at 16 kHz where the browser can (it resamples); where it can't (Firefox
// won't join a mic to a context at another rate), it runs at the mic's own rate and the worklet
// brings it down to 16 kHz itself.

import { t } from '../i18n/index.js'

export const RATE = 16000

// Posts { pcm } about once a second (an ArrayBuffer of Int16 samples), { level } (the loudest since
// the last, 0 to 1) about ten times a second, and { flushed } after a 'flush' has sent what it had.
export const WORKLET = `
class Pcm extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Int16Array(16000)
    this.n = 0
    this.peak = 0
    this.ticks = 0
    // Brought down to 16 kHz by averaging when the context runs faster.
    this.step = sampleRate / 16000
    this.acc = 0
    this.cnt = 0
    this.pos = 0
    this.port.onmessage = (e) => { if (e.data === 'flush') { this.send(); this.port.postMessage({ flushed: true }) } }
  }
  send() {
    if (!this.n) return
    const out = this.buf.slice(0, this.n)
    this.port.postMessage({ pcm: out.buffer }, [out.buffer])
    this.n = 0
  }
  put(v) {
    this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
    if (this.n === this.buf.length) this.send()
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    const len = ch ? ch.length : 128
    for (let i = 0; i < len; i++) {
      const v = ch ? Math.max(-1, Math.min(1, ch[i])) : 0
      const a = v < 0 ? -v : v
      if (a > this.peak) this.peak = a
      if (this.step === 1) { this.put(v); continue }
      this.acc += v
      this.cnt++
      if (++this.pos >= this.step) { this.pos -= this.step; this.put(this.acc / this.cnt); this.acc = 0; this.cnt = 0 }
    }
    // The level, about ten times a second, for the meter.
    if (++this.ticks % Math.round(12 * this.step) === 0) { this.port.postMessage({ level: this.peak }); this.peak = 0 }
    return true
  }
}
registerProcessor('bridge-pcm', Pcm)
`

export async function addWorklet(ctx) {
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
  try { await ctx.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
}

// In the desktop app on a Mac, macOS is asked first (desktop/main.js): its own question the first
// time, rather than the mic turned down with no question. Elsewhere, nothing to ask.
export const askMic = () => window.bridgeApp?.askMedia?.('microphone').catch(() => null) ?? Promise.resolve(null)

// Why the mic was turned down, when the desktop app can help: { mic: true, stale } for MicFix
// (Composer.jsx), stale when macOS says Bridge AI is allowed and blocks it all the same (an answer
// from a version signed differently). null in a browser or off a Mac: the browser's own setting.
export async function micRefused(e) {
  if (e?.name !== 'NotAllowedError' || !window.bridgeApp?.mediaAccess) return null
  const s = await window.bridgeApp.mediaAccess('microphone').catch(() => null)
  return s == null ? null : { mic: true, stale: s === 'granted' }
}
// What to say when the mic was turned down and there's nothing to fix here.
export const micBlocked = () => (window.bridgeApp ? t('The microphone is blocked. Allow it for Bridge AI, then try again.') : t('The microphone is blocked. Allow it for this page in your browser\'s site settings.'))

// The mic for dictation: one voice, close to it, with the browser's echo and noise handling.
export const microphone = async () => {
  await askMic()
  return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
}

// Records a stream until stop() (the samples, an Int16Array) or cancel(). onLevel(0..1) for a meter.
// onPcm(samples): each piece as it comes, every `every` ms (live words: dictation/controller.js).
export async function startPcm(stream, { onLevel, onPcm, every = 0 } = {}) {
  let ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RATE })
  let input
  try {
    input = ctx.createMediaStreamSource(stream)
  } catch {
    ctx.close().catch(() => {})
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    input = ctx.createMediaStreamSource(stream)
  }
  await addWorklet(ctx)
  const node = new AudioWorkletNode(ctx, 'bridge-pcm', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' })
  const chunks = []
  let flushed = null
  node.port.onmessage = (e) => {
    if (e.data.level != null) onLevel?.(e.data.level)
    else if (e.data.pcm) { const c = new Int16Array(e.data.pcm); chunks.push(c); onPcm?.(c) }
    else if (e.data.flushed) flushed?.()
  }
  input.connect(node)
  if (ctx.state !== 'running') ctx.resume().catch(() => {})
  const started = performance.now()
  const tick = every ? setInterval(() => node.port.postMessage('flush'), every) : null
  let done = false
  const end = () => {
    if (done) return
    done = true
    clearInterval(tick)
    try { input.disconnect() } catch { /* gone */ }
    stream.getTracks().forEach((t) => t.stop())
    ctx.close().catch(() => {})
  }
  return {
    get seconds() { return (performance.now() - started) / 1000 },
    async stop() {
      if (done) return new Int16Array(0)
      // What the worklet still holds, then everything in order.
      await new Promise((resolve) => { flushed = resolve; node.port.postMessage('flush'); setTimeout(resolve, 600) })
      end()
      const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0))
      let o = 0
      for (const c of chunks) { out.set(c, o); o += c.length }
      return out
    },
    cancel: end,
  }
}

// The samples as a WAV file: 16-bit PCM, mono, at `rate`.
export function wav(samples, rate = RATE) {
  const b = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(b)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  new Int16Array(b, 44).set(samples)
  return new Blob([b], { type: 'audio/wav' })
}
