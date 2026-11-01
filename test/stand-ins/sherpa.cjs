// A stand-in for sherpa-onnx's Node addon (sherpa-onnx-node), for server/asr-worker.js in the tests
// (BRIDGE_SHERPA names this file), so no test loads a real model. Same API, as far as Bridge AI
// uses it: OfflineRecognizer.createAsync(config), createStream(hotwords), acceptWaveform,
// decodeAsync. Loading checks the model's files are there, as the real one does.
// It hears BRIDGE_SHERPA_SAYS, or "Open the work tree in Claud Code." (two things Parakeet gets
// wrong without help), or with "@words" a word for each half second of sound, and writes a line of
// JSON for each load and each request to BRIDGE_SHERPA_LOG: { load: model folder, pid, decoding }
// and { pid, seconds, hotwords }. A file called crash-once in the model's folder makes the next
// request crash the process (then it's removed); crash-always, every request; slow, each one take
// 90% of the sound's length.
const fs = require('node:fs')
const path = require('node:path')

const log = (o) => { if (process.env.BRIDGE_SHERPA_LOG) fs.appendFileSync(process.env.BRIDGE_SHERPA_LOG, `${JSON.stringify({ pid: process.pid, ...o })}\n`) }

const WORDS = 'ship the fix for the payments page then run every test again and tell me what failed and why it did before lunch today please'.split(' ').concat(Array.from({ length: 400 }, (_, i) => `w${i}`))

class OfflineStream {
  constructor(hotwords) { this.hotwords = hotwords; this.samples = 0 }
  acceptWaveform({ samples, sampleRate }) {
    if (sampleRate !== 16000) throw new Error(`stand-in: wants 16 kHz, got ${sampleRate}`)
    this.samples += samples.length
    this.peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), this.peak || 0)
  }
}

class OfflineRecognizer {
  constructor(config) {
    const t = config.modelConfig.transducer
    for (const f of [t.encoder, t.decoder, t.joiner, config.modelConfig.tokens]) if (!fs.existsSync(f)) throw new Error(`stand-in: no such file ${f}`)
    this.dir = path.dirname(t.encoder)
    this.config = config
    log({ load: path.basename(this.dir), decoding: config.decodingMethod, threads: config.modelConfig.numThreads, bpeVocab: !!config.modelConfig.bpeVocab })
  }
  static async createAsync(config) { return new OfflineRecognizer(config) }
  createStream(hotwords) { return new OfflineStream(hotwords) }
  async decodeAsync(stream) {
    const once = path.join(this.dir, 'crash-once')
    if (fs.existsSync(once)) { fs.rmSync(once); process.kill(process.pid, 'SIGKILL') }
    if (fs.existsSync(path.join(this.dir, 'crash-always'))) process.kill(process.pid, 'SIGKILL')
    const seconds = Math.round((stream.samples / 16000) * 100) / 100
    log({ seconds, peak: Math.round(stream.peak * 1000) / 1000, hotwords: stream.hotwords ? stream.hotwords.split('/') : [] })
    // A file called slow in the model's folder: as long to decode as 90% of the sound's length, as on
    // a computer too slow for live words.
    if (fs.existsSync(path.join(this.dir, 'slow'))) await new Promise((r) => setTimeout(r, seconds * 900))
    // "@words": a word for each half second of sound, so what's heard grows as the sound does.
    if (process.env.BRIDGE_SHERPA_SAYS === '@words') return { text: WORDS.slice(0, Math.max(1, Math.round(seconds * 2))).join(' '), tokens: [], timestamps: [] }
    return { text: process.env.BRIDGE_SHERPA_SAYS || 'Open the work tree in Claud Code.', tokens: [], timestamps: [] }
  }
}

// The speaker model (voices.js): a voice is how high it is. A tone's pitch, from how often the
// sound crosses zero, as eight numbers peaking at its hundred hertz (220 Hz and 440 Hz come out
// far apart, two tones at 220 Hz the same). Loading checks the model's file is there; each request
// is logged as { embed: seconds, hz }.
class VoiceStream {
  constructor() { this.parts = [] }
  acceptWaveform({ samples, sampleRate }) {
    if (sampleRate !== 16000) throw new Error(`stand-in: wants 16 kHz, got ${sampleRate}`)
    this.parts.push(Float32Array.from(samples))
  }
  inputFinished() { this.finished = true }
}
class SpeakerEmbeddingExtractor {
  constructor(config) {
    if (!fs.existsSync(config.model)) throw new Error(`stand-in: no such file ${config.model}`)
    this.dim = 8
    log({ loadVoices: path.basename(config.model), threads: config.numThreads })
  }
  createStream() { return new VoiceStream() }
  isReady(stream) { return stream.parts.reduce((n, p) => n + p.length, 0) >= 4000 }
  compute(stream) {
    const all = Float32Array.from(stream.parts.flatMap((p) => [...p]))
    let crossings = 0
    for (let i = 1; i < all.length; i++) if ((all[i - 1] < 0) !== (all[i] < 0) && Math.abs(all[i]) + Math.abs(all[i - 1]) > 0.01) crossings++
    const hz = (crossings / 2) / (all.length / 16000)
    log({ embed: Math.round((all.length / 16000) * 100) / 100, hz: Math.round(hz) })
    return Float32Array.from({ length: 8 }, (_, i) => Math.exp(-(((hz - 100 * (i + 1)) / 60) ** 2)) + 0.01)
  }
}

module.exports = { OfflineRecognizer, SpeakerEmbeddingExtractor }
