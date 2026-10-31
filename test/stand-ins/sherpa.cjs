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

module.exports = { OfflineRecognizer }
