// The speech engine's own process, started by server/asr.js on the app's own Node: sherpa-onnx's
// Node addon with one model loaded, turning 16 kHz mono PCM into text. Apart from the server, so
// loading a model (a second or so, and up to 2 GB of memory) or a crash in native code never holds
// up or takes down the rest of Bridge AI. One request at a time, in the order they come.
//   { type: 'probe' } -> { type: 'probe', ok, error }: whether the addon loads on this computer.
//   { id, model: { key, dir, files, hotwords }, pcm: Int16Array, hotwords: [], threads }
//     -> { id, text, ms, loadMs } or { id, error }
//   { id, type: 'embed', voice: { key, file }, pcm: Int16Array, threads }
//     -> { id, v: Float32Array or null (too short), ms }: how the voice sounds, for voices.js
// BRIDGE_SHERPA (tests): a module to load instead of sherpa-onnx-node, with the same API.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let sherpa = null
let loadError = null
try { sherpa = process.env.BRIDGE_SHERPA ? require(process.env.BRIDGE_SHERPA) : require('sherpa-onnx-node') } catch (e) { loadError = e }
// The first line of why it didn't load ("Could not find sherpa-onnx-node", a missing symbol...).
const why = (e) => String(e?.message || e).split('\n').find((l) => l.trim())?.trim().slice(0, 300) || 'it didn\'t load'

let loaded = null // { key, recognizer }

// Hotwords given as words need the model's pieces as a BPE vocabulary; a NeMo model ships only
// tokens.txt, so one is made from it beside the model, once (as sherpa-onnx's own example does).
function bpeVocab(dir, tokens) {
  const f = path.join(dir, 'bpe.vocab')
  if (!fs.existsSync(f)) {
    const lines = fs.readFileSync(tokens, 'utf8').split('\n').filter((l) => l.trim()).map((l) => `${l.split(' ')[0]}\t-1.0`)
    fs.writeFileSync(`${f}.tmp`, `${lines.join('\n')}\n`)
    fs.renameSync(`${f}.tmp`, f)
  }
  return f
}

async function recognizer(model, threads) {
  if (loaded?.key === model.key) return { r: loaded.recognizer, loadMs: 0 }
  loaded = null
  const t0 = Date.now()
  const f = (n) => path.join(model.dir, model.files[n])
  const config = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: f('encoder'), decoder: f('decoder'), joiner: f('joiner') },
      tokens: f('tokens'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
      // Names to listen for (hotwords) need beam search, and the words as the model's pieces.
      ...(model.hotwords ? { modelingUnit: 'bpe', bpeVocab: bpeVocab(model.dir, f('tokens')) } : {}),
    },
    decodingMethod: model.hotwords ? 'modified_beam_search' : 'greedy_search',
    maxActivePaths: 4,
    hotwordsScore: 1.5,
  }
  const r = sherpa.OfflineRecognizer.createAsync ? await sherpa.OfflineRecognizer.createAsync(config) : new sherpa.OfflineRecognizer(config)
  loaded = { key: model.key, recognizer: r }
  return { r, loadMs: Date.now() - t0 }
}

async function decode({ model, pcm, hotwords, threads }) {
  if (!sherpa) throw new Error(`sherpa-onnx doesn't load here: ${why(loadError)}`)
  const { r, loadMs } = await recognizer(model, threads || 2)
  const t0 = Date.now()
  const samples = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768
  // Several names a phrase each, separated by "/", as sherpa-onnx takes them.
  const words = model.hotwords && hotwords?.length ? hotwords.map((w) => String(w).replace(/[/\n:]/g, ' ').trim()).filter(Boolean).join('/') : ''
  const stream = words ? r.createStream(words) : r.createStream()
  stream.acceptWaveform({ sampleRate: 16000, samples })
  let out
  if (r.decodeAsync) out = await r.decodeAsync(stream)
  else { r.decode(stream); out = r.getResult(stream) }
  return { text: String(out?.text || '').trim(), ms: Date.now() - t0, loadMs }
}

// The speaker model (voices.js), loaded the first time and kept beside the recognizer.
let voices = null // { file, ex }
async function embed({ voice, pcm, threads }) {
  if (!sherpa) throw new Error(`sherpa-onnx doesn't load here: ${why(loadError)}`)
  if (voices?.file !== voice.file) {
    if (!fs.existsSync(voice.file)) throw new Error('The voice model isn\'t downloaded')
    voices = { file: voice.file, ex: new sherpa.SpeakerEmbeddingExtractor({ model: voice.file, numThreads: threads || 1, provider: 'cpu', debug: 0 }) }
  }
  const t0 = Date.now()
  const samples = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768
  const stream = voices.ex.createStream()
  stream.acceptWaveform({ sampleRate: 16000, samples })
  stream.inputFinished()
  if (!voices.ex.isReady(stream)) return { v: null, ms: Date.now() - t0 }
  return { v: Float32Array.from(voices.ex.compute(stream, false)), ms: Date.now() - t0 }
}

let chain = Promise.resolve()
process.on('message', (msg) => {
  if (msg?.type === 'probe') { process.send({ type: 'probe', ok: !!sherpa, error: sherpa ? null : why(loadError) }); return }
  if (msg?.type === 'unload') { loaded = null; return }
  chain = chain.then(() => (msg?.type === 'embed' ? embed(msg) : decode(msg)).then(
    (r) => process.send({ id: msg.id, ...r }),
    (e) => process.send({ id: msg.id, error: why(e) }),
  ))
})
// The server gone (it quit or crashed): so is this.
process.on('disconnect', () => process.exit(0))
