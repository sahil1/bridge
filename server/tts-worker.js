// The natural voice's own process, started by server/voicespeak.js on the app's own Node:
// sherpa-onnx's Node addon with Supertonic 3 loaded, making the sound of a sentence or two at a
// time. Apart from the server, as speech to text is (asr-worker.js), so loading it or a crash in
// native code never holds up or takes down the rest of Bridge AI. One request at a time.
//   { id, model: { key, dir, files }, text, lang, sid, speed, threads }
//     -> { id, pcm: Int16Array, rate, ms, loadMs } or { id, error }
// BRIDGE_SHERPA (tests): a module to load instead of sherpa-onnx-node, with the same API.
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let sherpa = null
let loadError = null
try { sherpa = process.env.BRIDGE_SHERPA ? require(process.env.BRIDGE_SHERPA) : require('sherpa-onnx-node') } catch (e) { loadError = e }
const why = (e) => String(e?.message || e).split('\n').find((l) => l.trim())?.trim().slice(0, 300) || 'it didn\'t load'

let loaded = null // { key, tts }

async function voice(model, threads) {
  if (loaded?.key === model.key) return { tts: loaded.tts, loadMs: 0 }
  loaded = null
  const t0 = Date.now()
  const f = (n) => path.join(model.dir, n)
  const tts = await sherpa.OfflineTts.createAsync({
    model: {
      supertonic: { durationPredictor: f('duration_predictor.int8.onnx'), textEncoder: f('text_encoder.int8.onnx'), vectorEstimator: f('vector_estimator.int8.onnx'), vocoder: f('vocoder.int8.onnx'), ttsJson: f('tts.json'), unicodeIndexer: f('unicode_indexer.bin'), voiceStyle: f('voice.bin') },
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
    },
    maxNumSentences: 1,
  })
  loaded = { key: model.key, tts }
  return { tts, loadMs: Date.now() - t0 }
}

async function speak({ model, text, lang, sid, speed, threads }) {
  if (!sherpa) throw new Error(`sherpa-onnx doesn't load here: ${why(loadError)}`)
  const { tts, loadMs } = await voice(model, threads || 2)
  const t0 = Date.now()
  const a = await tts.generateAsync({ text, enableExternalBuffer: false, generationConfig: new sherpa.GenerationConfig({ sid: Math.max(0, Math.min(tts.numSpeakers - 1, sid | 0)), speed, extra: { lang } }) })
  if (!a?.samples?.length) throw new Error('The natural voice made no sound')
  // Its 44.1 kHz as half that (each sample with half of each one beside it, so nothing above the
  // new limit folds back): a voice needs no more, and it's half as much to send to a phone.
  const x = a.samples
  const half = a.sampleRate >= 32000
  const pcm = new Int16Array(half ? Math.floor(x.length / 2) : x.length)
  for (let i = 0; i < pcm.length; i++) {
    const v = half ? (x[Math.max(0, 2 * i - 1)] + 2 * x[2 * i] + x[2 * i + 1]) / 4 : x[i]
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
  }
  return { pcm, rate: half ? a.sampleRate / 2 : a.sampleRate, ms: Date.now() - t0, loadMs }
}

let chain = Promise.resolve()
process.on('message', (msg) => {
  chain = chain.then(() => speak(msg).then(
    (r) => process.send({ id: msg.id, ...r }),
    (e) => process.send({ id: msg.id, error: why(e) }),
  ))
})
// The server gone (it quit or crashed): so is this.
process.on('disconnect', () => process.exit(0))
