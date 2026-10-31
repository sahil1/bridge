// Speech to text for meeting notes, voice notes and dictation, with the engine you pick: on this
// computer (a speech model: Parakeet through sherpa-onnx, in a process of its own (asr.js), or
// Whisper through whisper.cpp, its model kept loaded by whisper-server while you record), on the
// Mac itself (Apple's own transcriber, macOS 26 and later: native/bridgespeech, nothing to
// install), or, for meetings, a service you have a key for. Picked nothing: a speech model when
// it's here, else the Mac's own. Only what can run on this computer is offered (fit() below).
// meetings.js sends one spoken stretch at a time: a 16 kHz mono WAV of up to about 25 seconds,
// which every engine here takes as it is; voice.js sends a voice note the same way.
//
// Services, by how they're called:
//   OpenAI-style (/audio/transcriptions, one form post): OpenAI, Groq, Mistral, Together, and any
//     other service that speaks it (Custom: its address, key and model).
//   Their own: Deepgram (one post), ElevenLabs (one form post), AssemblyAI (upload, then ask until
//     it's done), Gemini (the audio in a prompt, with the Gemini key you have).
// Not here: Ollama and LM Studio (neither has speech to text), and Wispr Flow (its API is only for
// approved companies, with no way to use your own Wispr Flow sign-in).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { DATA, ROOT, IS_MAC, brewInstall } from './paths.js'
import { tool } from './fixes.js'
import { providerEnv } from './providers.js'
import { machine, freeBytes, atLeast } from './machine.js'
import * as asr from './asr.js'
import * as memory from './meetmemory.js'

const env = () => ({ ...process.env, ...providerEnv() })
const fatal = (msg, more) => Object.assign(new Error(msg), { fatal: true }, more)

// The words in what an engine wrote, without its notes about sound that isn't words: whisper's
// [BLANK_AUDIO], [END], [ Silence ], (keyboard clicking), (upbeat music). Nobody says anything in
// square brackets, so those go wherever they are; a line of nothing but notes goes whole. '' when
// no words are left.
export function spoken(text) {
  const t = String(text || '').replace(/\[[^\]]{0,60}\]/g, ' ').replace(/\((music|silence|inaudible)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim()
  return !t || /^(\([^)]{0,60}\)[\s.,!?-]*)+$/.test(t) ? '' : t
}

// ---------- Speech models for this computer ----------
// Each is downloaded once from Hugging Face, at a pinned revision, file by file into the data
// folder's models/ (Parakeet's into a folder of its own), checked against its SHA-256. runtime:
// what runs it, sherpa-onnx (asr.js) or whisper.cpp. mb: the download. memGB: the least memory a
// computer needs to run it. languages: what it hears ('auto': about 100, and it tells which).
// BRIDGE_MODELS_URL (tests): where models are downloaded from instead, so a test never downloads
// one; BRIDGE_SPEECH_MODELS (tests): a JSON file of { id: { files } } standing in for the real
// files' names, sizes and checksums, so a test's small fake model passes the check.
const HF = () => process.env.BRIDGE_MODELS_URL || 'https://huggingface.co'
const EU25 = ['bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'es', 'sv', 'ru', 'uk']
const WHISPER = { repo: 'ggerganov/whisper.cpp', rev: '5359861c739e955e79d9a303bcbc70fb988958b1' }
const whisper = (id, file, bytes, sha256, short, o) => ({ id, runtime: 'whisper', file, short, label: `Whisper ${short.replace(/^\w/, (c) => c.toLowerCase())}`, mb: Math.round(bytes / 1e6), ...WHISPER, files: [{ name: file, bytes, sha256 }], license: 'MIT', by: 'OpenAI', ...o })
export const MODELS = [
  {
    id: 'parakeet-v3', runtime: 'sherpa', label: 'Parakeet', mb: 670, memGB: 3, languages: EU25, best: true, hotwords: true,
    note: 'Accurate and quick on any computer. English and 24 more European languages, which it tells apart itself.',
    license: 'CC-BY-4.0', by: 'NVIDIA', repo: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8', rev: '2bda32ec70b097a55adaa07d9a7173915b43cc78',
    files: [
      { name: 'tokens.txt', bytes: 93939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
      { name: 'decoder.int8.onnx', bytes: 11845275, sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e' },
      { name: 'joiner.int8.onnx', bytes: 6355277, sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3' },
      { name: 'encoder.int8.onnx', bytes: 652184281, sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247' },
    ],
  },
  {
    id: 'parakeet-en', runtime: 'sherpa', label: 'Parakeet, English', mb: 663, memGB: 3, languages: ['en'], hotwords: true,
    note: 'The best at tool names and jargon (worktree, Claude Code).',
    license: 'NVIDIA Open Model License', by: 'NVIDIA', repo: 'csukuangfj2/sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming', rev: '8c3a10fb13408c7a7054f6898958bf1c64a8d6c7',
    files: [
      { name: 'tokens.txt', bytes: 8952, sha256: 'dc0b4584ab2e4ddbf888425c076c61b736e7356a015250db7d307e6f1a8188ff' },
      { name: 'decoder.int8.onnx', bytes: 7257753, sha256: 'a5e223392c90e75f8144cdb5eb95af7625db389e39edef2bd1a9c872b3298fe6' },
      { name: 'joiner.int8.onnx', bytes: 1735860, sha256: '869f43f7d24595c55581ad3bf249a935fb8a71389fbdaa7504b9f46f93140f8a' },
      { name: 'encoder.int8.onnx', bytes: 654040552, sha256: '6716910b7a0833997fec7a410494c995d70124001a0e9b66d6370d6aced577e0' },
    ],
  },
  whisper('large-v3-turbo-q5_0', 'ggml-large-v3-turbo-q5_0.bin', 574041195, '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', 'Large turbo', { memGB: 2, languages: 'auto', note: 'For the languages Parakeet doesn\'t hear. Accurate and still quick.' }),
  whisper('small.en-q5_1', 'ggml-small.en-q5_1.bin', 190098681, 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30', 'Small, English', { memGB: 1, languages: ['en'], note: 'Light and quick.' }),
  whisper('small-q5_1', 'ggml-small-q5_1.bin', 190085487, 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', 'Small', { memGB: 1, languages: 'auto', note: 'Light and quick.' }),
  whisper('base.en-q5_1', 'ggml-base.en-q5_1.bin', 59721011, '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f', 'Base, English', { memGB: 1, languages: ['en'], note: 'The lightest that does the job.' }),
  whisper('large-v3-q5_0', 'ggml-large-v3-q5_0.bin', 1081140203, 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1', 'Large', { memGB: 3, languages: 'auto', note: 'The most accurate Whisper, and the slowest.' }),
]
// The portable default: it runs on every computer Bridge AI does (fit() says where it can't).
export const DEFAULT = 'parakeet-v3'
// Telling voices apart in a room (voices.js): 3D-Speaker's ERes2Net speaker model, trained on
// VoxCeleb, in the ONNX form the sherpa-onnx project made. Not speech to text, so not in the list
// above; downloaded the first time you ask Who spoke on a meeting recorded in a room. Of the
// models of that size we tried on the same voices, it kept different people furthest apart (CAM++
// from the same project barely told them apart in this form).
export const VOICE = {
  id: 'voices', runtime: 'sherpa', label: 'ERes2Net', mb: 26, memGB: 2, license: 'Apache-2.0', by: '3D-Speaker (Alibaba)',
  repo: 'csukuangfj/speaker-embedding-models', rev: '0743f301363dec56491a490f6d6cbc9d67f9a3bf',
  files: [{ name: '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx', bytes: 26485263, sha256: 'c59158379255ad66e161679cca6af8d52d51e389e3224ab7d7a7baae295c2db5' }],
}
// Silero, so whisper.cpp skips what isn't speech inside a stretch (less made-up text in pauses).
const VAD = { id: 'vad', runtime: 'whisper', label: 'Silero', file: 'ggml-silero-v6.2.0.bin', repo: 'ggml-org/whisper-vad', rev: '9ffd54a1e1ee413ddf265af9913beaf518d1639b', files: [{ name: 'ggml-silero-v6.2.0.bin', bytes: 885098, sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987' }] }
const standIns = (() => { try { return JSON.parse(fs.readFileSync(process.env.BRIDGE_SPEECH_MODELS, 'utf8')) } catch { return {} } })()
export const filesOf = (m) => standIns[m.id]?.files || m.files
const DIR = () => path.join(DATA, 'models')
// Where a model lives: whisper.cpp's one file in models/ (where earlier versions put it), a sherpa
// model's files in models/<id>/.
export const dirOf = (m) => (m.runtime === 'sherpa' ? path.join(DIR(), m.id) : DIR())
const fileOf = (m) => path.join(DIR(), m.file)
const urlOf = (m, f) => (process.env.BRIDGE_MODELS_URL ? `${HF()}/${m.id}/${f.name}` : `${HF()}/${m.repo}/resolve/${m.rev}/${f.name}`)
const size = (f) => { try { return fs.statSync(f).size } catch { return -1 } }
const has = (f) => size(f) > 0
// Downloaded: every file there at its full size (each was checked against its SHA-256 before it
// got its name).
export const have = (m) => filesOf(m).every((f) => { const n = size(path.join(dirOf(m), f.name)); return f.bytes ? n === f.bytes : n > 0 })

// ---------- What this computer can run ----------
// sherpa-onnx's Node addon comes built for these (npm packages sherpa-onnx-<os>-<arch>). On Linux
// it needs glibc: 2.32 or later for x64 (built on a current Ubuntu), 2.17 for arm64 (manylinux).
// Windows on Arm runs the x64 app, and with it the x64 addon, under emulation. On a Mac the addon
// says macOS 14 (Apple Silicon, as Bridge AI) and 15 (Intel): whether it loads on an Intel Mac with
// macOS 14 is what trying it (asr.probe) finds out.
const SHERPA = { 'darwin-arm64': {}, 'darwin-x64': {}, 'win32-x64': {}, 'win32-ia32': {}, 'win32-arm64': {}, 'linux-x64': { glibc: '2.32' }, 'linux-arm64': { glibc: '2.17' } }
// What runs where, for this computer (m: machine()), as { ok, why }. Pure, so tests can ask it
// about any computer. probe: whether the addon loaded here ({ ok, error }), once it's been tried;
// whisperHere: whether whisper.cpp's programs are on this computer.
export function fitRuntime(runtime, m, { probe = null, whisperHere = false } = {}) {
  if (runtime === 'sherpa') {
    const want = SHERPA[`${m.platform}-${m.arch}`]
    if (!want) return { ok: false, why: `sherpa-onnx has no build for ${m.platform} on ${m.arch}` }
    if (want.glibc && !m.glibc) return { ok: false, why: 'sherpa-onnx needs a Linux with glibc (this one uses another C library)' }
    if (want.glibc && !atLeast(m.glibc, want.glibc)) return { ok: false, why: `sherpa-onnx needs glibc ${want.glibc} or later (Ubuntu 22.04, Debian 12 or newer); this Linux has ${m.glibc}` }
    if (probe && !probe.ok) return { ok: false, why: `sherpa-onnx doesn't load on this computer: ${probe.error}` }
    return { ok: true, why: null }
  }
  if (runtime === 'whisper') {
    // The Docker image has no whisper.cpp; one installed in the container counts.
    if (m.docker && !whisperHere) return { ok: false, why: 'whisper.cpp isn\'t in the Docker image' }
    return { ok: true, why: null }
  }
  return { ok: false, why: 'Unknown speech engine' }
}
export function fitModel(model, m, o = {}) {
  const r = fitRuntime(model.runtime, m, o)
  if (!r.ok) return r
  if (model.memGB && m.memGB && m.memGB < model.memGB) return { ok: false, why: `${model.label} needs ${model.memGB} GB of memory; this computer has ${m.memGB} GB` }
  return r
}

let fitted = null // { at, m, probe, whisperHere, models: Map(id -> { ok, why }) }
// What's offered here, worked out again at most every 10 seconds (whisper.cpp may have just been
// installed). The addon is tried once, in a process of its own, unless the rules already say no.
export async function fit() {
  if (fitted && Date.now() - fitted.at < 10_000) return fitted
  const m = await machine()
  const whisperHere = (await Promise.all([tool('whisper-server'), tool('whisper-cli')])).some(Boolean)
  const probe = fitRuntime('sherpa', m).ok ? await asr.probe() : null
  const models = new Map(MODELS.map((x) => [x.id, fitModel(x, m, { probe, whisperHere })]))
  fitted = { at: Date.now(), m, probe, whisperHere, models }
  return fitted
}
const shown = (id) => !fitted || !!fitted.models.get(id)?.ok
export const offered = () => MODELS.filter((x) => shown(x.id))
const portable = () => offered().find((x) => x.id === DEFAULT) || offered().find((x) => x.runtime === 'whisper') || MODELS[0]
// Ready to turn speech into text: downloaded, and what runs it is here.
const runnable = (m) => have(m) && (m.runtime === 'sherpa' ? shown(m.id) : !!fitted?.whisperHere)

// The model picked (Settings › Voice, or an older pick in Settings › Meetings), when it can run
// here; else one already here that can run, Parakeet first; else the portable default.
const pickedId = (cfg) => cfg?.meetings?.localModel || cfg?.speech?.model || null
export function localModel(cfg) {
  const picked = MODELS.find((m) => m.id === pickedId(cfg))
  if (picked && shown(picked.id)) return picked
  if (picked) return portable()
  return offered().find(runnable) || portable()
}
// A pick that can't run on this computer (a config copied from another one): what's used instead
// and why, so Settings says so. { from, to, why } or null.
export function fellBack(cfg) {
  const picked = MODELS.find((m) => m.id === pickedId(cfg))
  if (!picked || shown(picked.id)) return null
  const to = portable()
  return { from: picked.id, fromLabel: picked.label, to: to.id, toLabel: to.label, why: fitted.models.get(picked.id)?.why || null }
}

// ---------- Downloads ----------
// Resumable: a file's .part is kept when a download stops, and the next one asks for the rest. Each
// file is checked against its SHA-256 before it gets its name; one that doesn't match is thrown away.
const downloads = new Map() // model id -> { got, total, error, stop }
// Why a model didn't download, in words (voice.js too): no connection says so, like Node.js's.
export const downloadError = (e, url) => {
  const host = (() => { try { return new URL(url).host } catch { return 'the download' } })()
  return e?.name === 'TimeoutError' ? 'The download took too long. Try again.'
    // The connection dropped part way ("terminated", a socket closed): what came is kept for next time.
    : /^terminated$|other side closed|UND_ERR_SOCKET|ECONNRESET.*body/.test(`${e?.message} ${e?.cause?.code || ''}`) ? 'The download was cut short; try again'
    : /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/.test(`${e?.message} ${e?.cause?.code || ''}`) ? `Can't reach ${host}. Check your internet connection and try again.`
      : e?.message || 'Download failed'
}
const hashOf = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256')
  fs.createReadStream(file).on('data', (b) => h.update(b)).on('end', () => resolve(h)).on('error', reject)
})
async function fetchFile(m, f, d) {
  const dest = path.join(dirOf(m), f.name)
  if (f.bytes ? size(dest) === f.bytes : has(dest)) { d.got += f.bytes || 0; return }
  const tmp = `${dest}.part`
  let at = Math.max(0, size(tmp))
  if (f.bytes && at > f.bytes) { fs.rmSync(tmp, { force: true }); at = 0 }
  // What's there already counts, and goes into the checksum first.
  let h = at ? await hashOf(tmp) : crypto.createHash('sha256')
  d.got += at
  if (!f.bytes || at < f.bytes) {
    const res = await fetch(urlOf(m, f), { headers: at ? { Range: `bytes=${at}-` } : {}, signal: AbortSignal.any([d.stop.signal, AbortSignal.timeout(60 * 60 * 1000)]) })
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    // Asked for the rest but sent the whole file: that file starts again.
    if (at && res.status !== 206) { d.got -= at; at = 0; h = crypto.createHash('sha256') }
    const out = fs.createWriteStream(tmp, { flags: at ? 'a' : 'w' })
    try {
      for await (const chunk of res.body) {
        d.got += chunk.length
        h.update(chunk)
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      }
    } finally { await new Promise((resolve) => out.end(resolve)) }
    if (f.bytes && size(tmp) !== f.bytes) throw new Error('The download was cut short; try again')
  }
  if (f.sha256 && h.digest('hex') !== f.sha256) {
    fs.rmSync(tmp, { force: true })
    throw new Error(`The download of ${f.name} didn't match its checksum, so it was thrown away. Try again.`)
  }
  fs.renameSync(tmp, dest)
}
export function fetchModel(id) {
  const m = id === 'vad' ? VAD : id === VOICE.id ? VOICE : MODELS.find((x) => x.id === id)
  if (!m) throw new Error('No such model')
  if (have(m) || (downloads.has(m.id) && !downloads.get(m.id).error)) return
  if (fitted && m.id !== 'vad' && m.id !== VOICE.id && !shown(m.id)) throw new Error(fitted.models.get(m.id)?.why || 'That model can\'t run on this computer')
  const files = filesOf(m)
  const d = { got: 0, total: files.reduce((n, f) => n + (f.bytes || 0), 0), error: null, stop: new AbortController() }
  downloads.set(m.id, d)
  d.done = (async () => {
    let url = urlOf(m, files[0])
    try {
      fs.mkdirSync(dirOf(m), { recursive: true })
      // Room for it first: what's still to come, and a little over.
      const left = files.reduce((n, f) => (size(path.join(dirOf(m), f.name)) === f.bytes ? n : n + Math.max(0, (f.bytes || 0) - Math.max(0, size(path.join(dirOf(m), `${f.name}.part`))))), 0)
      const free = await freeBytes(DIR())
      if (free != null && free < left + 100e6) throw new Error(`Not enough free space: ${m.label} needs ${Math.ceil((left + 100e6) / 1e6)} MB, and there's ${Math.floor(free / 1e6)} MB free.`)
      for (const f of files) { url = urlOf(m, f); await fetchFile(m, f, d) }
      downloads.delete(m.id)
      if (fitted) fitted.at = 0
    } catch (e) {
      if (d.stop.signal.aborted) { if (downloads.get(m.id) === d) downloads.delete(m.id) } else d.error = downloadError(e, url)
    }
  })()
}
// Stops its download first, if one is going (Windows won't delete a file still being written).
export async function removeModel(id) {
  const m = id === VOICE.id ? VOICE : MODELS.find((x) => x.id === id)
  if (!m) throw new Error('No such model')
  const d = downloads.get(m.id)
  if (d) { d.stop.abort(); await d.done }
  downloads.delete(m.id)
  if (m.runtime === 'sherpa') { asr.stop(m.id); fs.rmSync(dirOf(m), { recursive: true, force: true }); return }
  if (server?.model === fileOf(m)) stopServer()
  fs.rmSync(fileOf(m), { force: true })
  fs.rmSync(`${fileOf(m)}.part`, { force: true })
}
// A download going (or stopped by a problem): { percent, error }, or null.
export const downloading = (id) => { const d = downloads.get(id); return d ? { percent: d.total ? Math.min(100, Math.floor((d.got / d.total) * 100)) : 0, error: d.error } : null }
const progress = downloading
// Once a download going now has ended, either way.
export const downloaded = (id) => downloads.get(id)?.done || Promise.resolve()

// ---------- whisper-server, kept while it's used ----------
let server = null // { proc, port, model, ready, last }
const threads = () => Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2)))
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})
function stopServer() { if (server) { try { server.proc.kill() } catch { /* gone */ } server = null } }
// Let go of the model (half a gigabyte or more) ten minutes after the last stretch.
setInterval(() => { if (server && Date.now() - server.last > 10 * 60 * 1000) stopServer() }, 60 * 1000).unref?.()
process.on('exit', stopServer)

async function whisperServer(model) {
  if (server && server.model === model && server.proc.exitCode === null) { server.last = Date.now(); await server.ready; return server }
  stopServer()
  const bin = await tool('whisper-server')
  if (!bin) return null
  const port = await freePort()
  const vad = path.join(DIR(), VAD.file)
  const args = ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-t', String(threads()), ...(has(vad) ? ['--vad', '-vm', vad] : [])]
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let errText = ''
  proc.stderr.on('data', (b) => { errText = (errText + b).slice(-2000) })
  proc.on('error', () => {})
  const me = { proc, port, model, last: Date.now() }
  me.ready = (async () => {
    const end = Date.now() + 90_000
    while (Date.now() < end) {
      if (proc.exitCode !== null) throw new Error(`whisper-server stopped: ${errText.trim().split('\n').pop() || proc.exitCode}`)
      try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); if (r.status < 500) return } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300))
    }
    throw new Error('whisper-server took too long to start')
  })()
  server = me
  try { await me.ready } catch (e) { if (server === me) stopServer(); throw e }
  return me
}

const run = (bin, args, timeout = 120000) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).slice(-300))) : resolve(stdout)))
})

// The PCM in a 16 kHz mono 16-bit WAV (what meetings.js and voice.js send), copied so it can go to
// another process on its own.
export function pcmOf(wav) {
  const b = Buffer.from(wav)
  let at = 12
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4)
    const n = b.readUInt32LE(at + 4)
    if (id === 'data') { const end = Math.min(b.length, at + 8 + n); const out = new Int16Array(Math.floor((end - at - 8) / 2)); for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(at + 8 + i * 2); return out }
    at += 8 + n + (n % 2)
  }
  throw new Error('Not a WAV recording')
}

// Names to listen for, for an engine that takes them as words rather than a prompt (Parakeet): the
// ones given (a meeting's people, your vocabulary), and meeting memory's. Not an email address, a
// path or a sentence.
const wordsOf = (words) => [...new Set([...(words || []), ...memory.hint(400).split(',')].map((w) => String(w).trim().replace(/[.,;:!?]+$/, '')).filter((w) => w.length >= 2 && w.length <= 40 && !/[@/\\]/.test(w) && w.split(' ').length <= 4))].slice(0, 80)

async function local(wav, o) {
  const { cfg, language, prompt, words, model } = o // words: names to listen for (Parakeet); prompt: whisper's
  await fit()
  const m = model || localModel(cfg)
  if (m.runtime === 'sherpa') {
    if (!have(m)) { if (o.fetch !== false) fetchModel(m.id); throw fatal(`The speech model (${m.label}, ${m.mb} MB) is still downloading. The missed parts can be transcribed again once it's here.`, { needs: 'model', model: m.id }) }
    if (!shown(m.id)) throw fatal(fitted.models.get(m.id)?.why || `${m.label} can't run on this computer`)
    const files = Object.fromEntries(filesOf(m).map((f) => [f.name.split('.')[0], f.name]))
    const r = await asr.recognize({ key: m.id, dir: dirOf(m), files, hotwords: !!m.hotwords }, pcmOf(wav), { hotwords: m.hotwords ? wordsOf(words) : [] })
    return { text: r.text, engine: m.label, ms: r.ms }
  }
  const file = fileOf(m)
  if (!has(file)) { if (o.fetch !== false) fetchModel(m.id); throw fatal(`The speech model (${m.label}, ${m.mb} MB) is still downloading. The missed parts can be transcribed again once it's here.`, { needs: 'model', model: m.id }) }
  if (!has(path.join(DIR(), VAD.file))) fetchModel('vad')
  const lang = m.file.includes('.en') ? 'en' : language || 'auto'
  const srv = await whisperServer(file).catch((e) => { throw fatal(e.message) })
  if (srv) {
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
    form.append('response_format', 'json')
    form.append('temperature', '0')
    form.append('language', lang)
    if (prompt) form.append('prompt', prompt.slice(0, 600))
    const r = await fetch(`http://127.0.0.1:${srv.port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
    srv.last = Date.now()
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw new Error(j.error || `whisper-server: HTTP ${r.status}`)
    return { text: j.text || '', engine: `whisper.cpp ${m.short}` }
  }
  // An older whisper.cpp without the server: the command line, loading the model each time.
  const cli = await tool('whisper-cli')
  if (!cli) throw fatal(`${m.label} needs whisper.cpp, which isn't on this computer. Install it in Settings › Meetings, or pick Parakeet in Settings › Voice.`, { needs: 'whisper' })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-speech-'))
  try {
    fs.writeFileSync(path.join(tmp, 'in.wav'), wav)
    const out = await run(cli, ['-m', file, '-f', path.join(tmp, 'in.wav'), '-nt', '-np', '-l', lang, '-t', String(threads()), ...(prompt ? ['--prompt', prompt.slice(0, 600)] : [])])
    return { text: out, engine: `whisper.cpp ${m.short}` }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

// ---------- On the Mac itself (native/bridgespeech) ----------
export const appleBin = () => { const f = process.env.BRIDGE_SPEECH || path.join(ROOT, 'native', 'bin', 'bridgespeech'); return (IS_MAC || process.env.BRIDGE_SPEECH) && fs.existsSync(f) ? f : null }
const appleKept = new Map() // language -> { at, st }
// { available, installed, locale, why }: kept a minute.
async function appleStatus(language) {
  const lang = language && language !== 'auto' ? language : 'auto'
  const hit = appleKept.get(lang)
  if (hit && Date.now() - hit.at < 60_000) return hit.st
  const bin = appleBin()
  let st = { available: false, why: IS_MAC ? 'Needs macOS 26 or later' : 'Only on a Mac' }
  if (bin) try { st = JSON.parse(await run(bin, ['status', lang], 20000)) } catch (e) { st = { available: false, why: e.message } }
  appleKept.set(lang, { at: Date.now(), st })
  return st
}
async function apple(wav, { language }) {
  const bin = appleBin()
  if (!bin) throw fatal('Transcribing on the Mac itself needs macOS 26 or later. Pick another engine in Settings › Meetings.')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-speech-'))
  try {
    fs.writeFileSync(path.join(tmp, 'in.wav'), wav)
    const text = await run(bin, ['file', path.join(tmp, 'in.wav'), language && language !== 'auto' ? language : 'auto'], 300000).catch((e) => { throw /language|macOS 26/.test(e.message) ? fatal(e.message) : e })
    return { text: String(text).trim(), engine: 'the Mac\'s own speech' }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

// ---------- Services ----------
// key: the setting it uses (saved in Settings › Model Providers). price: per hour of audio, list
// price in October 2026, to help pick; the service's own page is what counts.
export const SERVICES = {
  openai: { label: 'OpenAI', key: 'OPENAI_API_KEY', base: (e) => (e.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''), models: ['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'], price: { 'gpt-transcribe': '$0.27', 'gpt-4o-mini-transcribe': '$0.18', 'whisper-1': '$0.36' }, style: 'openai' },
  groq: { label: 'Groq', key: 'GROQ_API_KEY', base: () => 'https://api.groq.com/openai/v1', models: ['whisper-large-v3-turbo', 'whisper-large-v3'], price: { 'whisper-large-v3-turbo': '$0.04', 'whisper-large-v3': '$0.11' }, style: 'openai' },
  mistral: { label: 'Mistral (Voxtral)', key: 'MISTRAL_API_KEY', base: () => 'https://api.mistral.ai/v1', models: ['voxtral-mini-latest'], price: { 'voxtral-mini-latest': '$0.18' }, style: 'openai' },
  together: { label: 'Together AI', key: 'TOGETHER_API_KEY', base: () => 'https://api.together.ai/v1', models: ['openai/whisper-large-v3', 'nvidia/parakeet-tdt-0.6b-v3'], price: { 'openai/whisper-large-v3': '$0.09', 'nvidia/parakeet-tdt-0.6b-v3': '$0.09' }, style: 'openai' },
  deepgram: { label: 'Deepgram', key: 'DEEPGRAM_API_KEY', models: ['nova-3'], price: { 'nova-3': '$0.26' }, style: 'deepgram' },
  elevenlabs: { label: 'ElevenLabs Scribe', key: 'ELEVENLABS_API_KEY', models: ['scribe_v2'], price: { scribe_v2: '$0.22' }, style: 'elevenlabs' },
  assemblyai: { label: 'AssemblyAI', key: 'ASSEMBLYAI_API_KEY', models: ['default'], price: { default: '$0.21' }, style: 'assemblyai' },
  gemini: { label: 'Google Gemini', key: 'GEMINI_API_KEY', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'], price: { 'gemini-2.5-flash': 'about $0.12' }, style: 'gemini' },
  custom: { label: 'Another OpenAI-style service', key: 'SPEECH_API_KEY', base: (e) => String(e.SPEECH_BASE_URL || '').replace(/\/$/, ''), models: [], style: 'openai', custom: true },
}

async function answer(r, label) {
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 || r.status === 403) throw fatal(`${label} turned the key down (${r.status}). Check it in Settings › Model Providers.`)
  if (!r.ok) throw new Error(`${label}: ${j.error?.message || j.error || j.message || j.detail?.message || j.err_msg || `HTTP ${r.status}`}`.slice(0, 300))
  return j
}

async function service(id, wav, { cfg, language, prompt }) {
  const s = SERVICES[id]
  const e = env()
  const key = e[s.key] || (id === 'gemini' && (e.GOOGLE_API_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY))
  if (!key && !s.custom) throw fatal(`No ${s.label} key saved. Add one in Settings › Model Providers, or pick another engine in Settings › Meetings.`)
  const model = cfg?.meetings?.serviceModel?.[id] || (s.custom ? e.SPEECH_MODEL : s.models[0])
  const lang = language && language !== 'auto' ? language : null
  const timeout = AbortSignal.timeout(120_000)
  if (s.style === 'openai') {
    const base = s.base(e)
    if (!base) throw fatal('Give the service\'s address in Settings › Model Providers › Another speech service.')
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
    form.append('model', model || 'whisper-1')
    form.append('response_format', 'json')
    if (lang) form.append('language', lang)
    if (prompt) form.append('prompt', prompt.slice(0, 600))
    const j = await answer(await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form, signal: timeout }), s.label)
    return { text: j.text || '', engine: `${s.label} ${model}` }
  }
  if (s.style === 'deepgram') {
    const q = new URLSearchParams({ model, smart_format: 'true', punctuate: 'true', language: lang || 'multi' })
    const j = await answer(await fetch(`https://api.deepgram.com/v1/listen?${q}`, { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' }, body: wav, signal: timeout }), s.label)
    return { text: j.results?.channels?.[0]?.alternatives?.[0]?.transcript || '', engine: `${s.label} ${model}` }
  }
  if (s.style === 'elevenlabs') {
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
    form.append('model_id', model)
    form.append('tag_audio_events', 'false')
    if (lang) form.append('language_code', lang)
    const j = await answer(await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: timeout }), s.label)
    return { text: j.text || '', engine: `${s.label}` }
  }
  if (s.style === 'assemblyai') {
    const h = { authorization: key }
    const up = await answer(await fetch('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: wav, signal: timeout }), s.label)
    const t = await answer(await fetch('https://api.assemblyai.com/v2/transcript', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ audio_url: up.upload_url, ...(lang ? { language_code: lang } : { language_detection: true }) }), signal: timeout }), s.label)
    const end = Date.now() + 120_000
    while (Date.now() < end) {
      const j = await answer(await fetch(`https://api.assemblyai.com/v2/transcript/${t.id}`, { headers: h, signal: AbortSignal.timeout(20_000) }), s.label)
      if (j.status === 'completed') return { text: j.text || '', engine: s.label }
      if (j.status === 'error') throw new Error(`${s.label}: ${j.error || 'failed'}`)
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error(`${s.label} took too long`)
  }
  if (s.style === 'gemini') {
    const body = { contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: 'audio/wav', data: Buffer.from(wav).toString('base64') } },
      { text: `Transcribe this audio exactly as spoken${lang ? ` (language: ${lang})` : ''}. Write only the words said, with normal punctuation. If nothing is said, write nothing.${prompt ? ` Names and terms that may come up: ${prompt.slice(0, 300)}` : ''}` },
    ] }], generationConfig: { temperature: 0 } }
    const j = await answer(await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: timeout }), s.label)
    return { text: (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim(), engine: `${s.label} ${model}` }
  }
  throw fatal('Unknown speech engine')
}

// ---------- What meetings.js and voice.js call ----------
// The engine you picked; or with none picked, a speech model on this computer when it's ready,
// else the Mac's own when it has one, else a speech model (which then says what it needs). auto:
// that last pick, kept. The Mac's own picked on a computer without it (a config from a Mac): a
// speech model instead, and Settings says so.
let auto = { at: 0, id: 'local' }
// The Mac's own speech is here, but not for the language asked for (its other answers mean it isn't here at all).
const langOnly = (mac) => !!mac.installed || /language|locale/i.test(mac.why || '')
const picked = (cfg) => { const e = cfg?.meetings?.engine; return e && (e === 'local' || e === 'apple' || SERVICES[e]) ? e : null }
export const engineOf = (cfg) => picked(cfg) || auto.id
// The model picked for this computer, downloaded, and what runs it here.
const localReady = async (cfg) => { await fit(); return runnable(localModel(cfg)) }
async function pickAuto(cfg) {
  if (Date.now() - auto.at < 60_000) return auto.id
  auto = { at: Date.now(), id: (await localReady(cfg)) ? 'local' : (await appleStatus(cfg?.meetings?.language)).available ? 'apple' : 'local' }
  return auto.id
}
// How many stretches at once: one on this computer (they'd share the chip), a few for a service.
export const parallel = (cfg) => (['local', 'apple'].includes(engineOf(cfg)) ? 1 : 3)
export async function transcribe(wav, o = {}) {
  let id = picked(o.cfg) || await pickAuto(o.cfg)
  const mac = id === 'local' || id === 'apple' ? await appleStatus(o.cfg?.meetings?.language) : null
  if (id === 'apple' && !mac.available && !langOnly(mac)) id = 'local'
  // A speech model picked but not on this computer yet: the Mac's own speech stands in when it has
  // your language, so a recording still turns into text instead of waiting on a download.
  if (id === 'local' && !(await localReady(o.cfg)) && mac.available) id = 'apple'
  return id === 'local' ? local(wav, o) : id === 'apple' ? apple(wav, o) : service(id, wav, o)
}
// A voice note or a dictation: on this computer only (a service is for meetings you pick it for).
// The model picked in Settings › Voice (or the Mac's own, picked there); not downloaded yet, the
// Mac's own speech stands in when it can; else the model says what it needs (needs: 'model').
// Names in meeting memory come out spelled its way.
export async function voice(wav, o = {}) {
  const lang = o.cfg?.voice?.language || o.cfg?.meetings?.language
  const mac = await appleStatus(lang)
  const useMac = (o.cfg?.speech?.model === 'apple' && mac.available) || (!(await localReady(o.cfg)) && mac.available)
  const r = useMac ? await apple(wav, { ...o, language: lang }) : await local(wav, { ...o, language: lang, fetch: false })
  return { ...r, text: memory.fix(spoken(r.text)) }
}
// Ready before you record: the model there, or downloading it now.
export async function prepare(cfg) {
  if (!picked(cfg)) await pickAuto(cfg).catch(() => {})
  if (engineOf(cfg) !== 'local') return
  await fit()
  const m = localModel(cfg)
  if (!have(m)) { try { fetchModel(m.id) } catch { /* can't run here: the transcript says why */ } }
  if (m.runtime !== 'whisper') return
  if (!has(path.join(DIR(), VAD.file))) fetchModel('vad')
  else if (has(fileOf(m))) whisperServer(fileOf(m)).catch(() => {})
}

// One model as Settings shows it: what it is, whether it's here, ready to run, or downloading.
const modelInfo = (x, whisperHere) => ({
  id: x.id, runtime: x.runtime, label: x.label, short: x.short || x.label, note: x.note, mb: x.mb, best: !!x.best, languages: x.languages, license: x.license, by: x.by,
  have: have(x), downloading: progress(x.id), usable: x.runtime === 'sherpa' ? shown(x.id) : !!whisperHere,
})
// What a speech model on this computer needs before it can transcribe: null (ready), 'model' (its
// download), 'whisper' (whisper.cpp, for a Whisper model) or 'brew' (Homebrew first, on a Mac).
const localNeeds = (m, whisperHere, brew) => (m.runtime === 'whisper' && !whisperHere ? (brew || fitted?.m.platform !== 'darwin' ? 'whisper' : 'brew') : !have(m) ? 'model' : null)

// Everything Settings › Meetings and › Voice show: the engines, which are ready, the models offered
// on this computer and their downloads, and what isn't offered here and why (for diagnostics).
export async function status(cfg) {
  const e = env()
  const f = await fit()
  const [srv, cli, brew, mac] = await Promise.all([tool('whisper-server'), tool('whisper-cli'), tool('brew'), appleStatus(cfg?.meetings?.language)])
  const m = localModel(cfg)
  const localIsReady = runnable(m)
  if (!picked(cfg)) auto = { at: Date.now(), id: localIsReady ? 'local' : mac.available ? 'apple' : 'local' }
  let engine = engineOf(cfg)
  // The Mac's own speech picked, on a computer without it: a speech model instead, said once.
  const engineFellBack = engine === 'apple' && !mac.available && !langOnly(mac) ? { from: 'apple', fromLabel: 'The Mac\'s own speech', to: m.id, toLabel: m.label, why: mac.why || null } : null
  if (engineFellBack) engine = 'local'
  const services = Object.entries(SERVICES).map(([id, s]) => ({ id, label: s.label, key: s.key, ready: s.custom ? !!e.SPEECH_BASE_URL : !!(e[s.key] || (id === 'gemini' && (e.GOOGLE_API_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY))), models: s.models, model: cfg?.meetings?.serviceModel?.[id] || s.models[0] || e.SPEECH_MODEL || '', price: s.price || {}, custom: !!s.custom }))
  // A speech model picked but not here yet: the Mac's own speech stands in (transcribe() above).
  const standIn = engine === 'local' && !localIsReady && mac.available ? 'apple' : null
  // Ready to transcribe, and if not, what it needs (Meetings shows it before you record).
  const ready = standIn ? true : engine === 'local' ? localIsReady : engine === 'apple' ? !!mac.available : !!services.find((x) => x.id === engine)?.ready
  const needs = ready ? null : engine === 'local' ? localNeeds(m, f.whisperHere, brew) || 'model' : engine === 'apple' ? 'apple' : 'key'
  return {
    engine,
    auto: !picked(cfg),
    ready,
    needs,
    standIn,
    apple: { available: !!mac.available, installed: !!mac.installed, locale: mac.locale || null, why: mac.available ? null : mac.why || null },
    local: {
      ready: localIsReady,
      runtime: m.runtime,
      program: srv ? 'whisper-server' : cli ? 'whisper-cli' : null,
      installCommand: !srv && !cli && brew ? brewInstall(brew, 'whisper-cpp') : null,
      model: m.id,
      default: DEFAULT,
      models: offered().map((x) => modelInfo(x, f.whisperHere)),
      vad: has(path.join(DIR(), VAD.file)),
    },
    // A pick that can't work here, and what's used instead (Settings says so once).
    fellBack: fellBack(cfg) || engineFellBack,
    // Not offered on this computer, and why: for diagnostics, not for the lists.
    hidden: MODELS.filter((x) => !shown(x.id)).map((x) => ({ id: x.id, label: x.label, why: f.models.get(x.id)?.why || null })),
    machine: { platform: f.m.platform, arch: f.m.arch, os: f.m.os, glibc: f.m.glibc, rosetta: f.m.rosetta, emulated: f.m.emulated, docker: f.m.docker, memGB: f.m.memGB, sherpa: f.probe },
    services,
    language: cfg?.meetings?.language || 'auto',
    mac: IS_MAC,
  }
}

// What voice notes and dictation use, and whether they're ready (the message box's mic, the
// dictation key, Settings › Voice): engine 'local' (a speech model) or 'apple'; standIn: the Mac's
// own speech answering until the model is here; needs: what's missing ('model', 'whisper', 'brew').
export async function voiceStatus(cfg) {
  const f = await fit()
  const [brew, mac] = await Promise.all([IS_MAC ? tool('brew') : null, appleStatus(cfg?.voice?.language || cfg?.meetings?.language)])
  const m = localModel(cfg)
  const wantMac = cfg?.speech?.model === 'apple'
  const needs = localNeeds(m, f.whisperHere, brew)
  const engine = wantMac && mac.available ? 'apple' : 'local'
  const standIn = engine === 'local' && needs && mac.available ? 'apple' : null
  return {
    ready: engine === 'apple' || !needs || !!standIn,
    engine,
    standIn,
    needs: engine === 'apple' || standIn ? null : needs,
    // Waiting on the model while the Mac's own stands in: it's offered, not needed.
    could: standIn && needs === 'model' ? 'model' : null,
    model: modelInfo(m, f.whisperHere),
    apple: { available: !!mac.available, why: mac.available ? null : mac.why || null },
    fellBack: fellBack(cfg) || (wantMac && !mac.available ? { from: 'apple', fromLabel: 'The Mac\'s own speech', to: m.id, toLabel: m.label, why: mac.why || null } : null),
  }
}
