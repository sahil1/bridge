// Speech to text for meeting notes, with the engine you pick: on this computer (whisper.cpp, its
// model kept loaded by whisper-server while you record, on the Mac's graphics chip), on the Mac
// itself (Apple's own transcriber, macOS 26 and later: native/bridgespeech, nothing to install),
// or a service you have a key for. Picked nothing: whisper.cpp when it's ready, else the Mac's own.
// meetings.js sends one spoken stretch at a time: a 16 kHz mono WAV of up to
// about 25 seconds, which every engine here takes as it is.
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
import { spawn, execFile } from 'node:child_process'
import { DATA, ROOT, IS_MAC, brewInstall } from './paths.js'
import { tool } from './fixes.js'
import { providerEnv } from './providers.js'

const env = () => ({ ...process.env, ...providerEnv() })
const fatal = (msg) => Object.assign(new Error(msg), { fatal: true })

// The words in what an engine wrote, without its notes about sound that isn't words: whisper's
// [BLANK_AUDIO], [END], [ Silence ], (keyboard clicking), (upbeat music). Nobody says anything in
// square brackets, so those go wherever they are; a line of nothing but notes goes whole. '' when
// no words are left.
export function spoken(text) {
  const t = String(text || '').replace(/\[[^\]]{0,60}\]/g, ' ').replace(/\((music|silence|inaudible)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim()
  return !t || /^(\([^)]{0,60}\)[\s.,!?-]*)+$/.test(t) ? '' : t
}

// ---------- Models for this computer (whisper.cpp) ----------
// BRIDGE_MODELS_URL (tests): where models are downloaded from instead, so a test never downloads one.
const HF = process.env.BRIDGE_MODELS_URL || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
export const MODELS = [
  { id: 'large-v3-turbo-q5_0', file: 'ggml-large-v3-turbo-q5_0.bin', mb: 574, label: 'Large turbo', note: 'Accurate and still quick. About 100 languages.', best: true },
  { id: 'small.en-q5_1', file: 'ggml-small.en-q5_1.bin', mb: 190, label: 'Small, English', note: 'Light and quick, English only. Voice notes use it too.' },
  { id: 'small-q5_1', file: 'ggml-small-q5_1.bin', mb: 190, label: 'Small', note: 'Light and quick, many languages.' },
  { id: 'base.en-q5_1', file: 'ggml-base.en-q5_1.bin', mb: 60, label: 'Base, English', note: 'The lightest that does the job, English only.' },
  { id: 'large-v3-q5_0', file: 'ggml-large-v3-q5_0.bin', mb: 1081, label: 'Large', note: 'The most accurate, and the slowest. Many languages.' },
]
// Silero, so whisper.cpp skips what isn't speech inside a stretch (less made-up text in pauses).
const VAD = { file: 'ggml-silero-v6.2.0.bin', url: `${process.env.BRIDGE_MODELS_URL || 'https://huggingface.co/ggml-org/whisper-vad/resolve/main'}/ggml-silero-v6.2.0.bin` }
const DIR = () => path.join(DATA, 'models')
const fileOf = (m) => path.join(DIR(), m.file)
const has = (f) => { try { return fs.statSync(f).size > 0 } catch { return false } }
// The one picked, else one you already have, else the best.
export function localModel(cfg) {
  const picked = MODELS.find((m) => m.id === cfg?.meetings?.localModel)
  if (picked) return picked
  return MODELS.find((m) => has(fileOf(m))) || MODELS[0]
}

const downloads = new Map() // file -> { got, total, error }
// Why a model didn't download, in words (voice.js too): no connection says so, like Node.js's.
export const downloadError = (e, url) => {
  const host = (() => { try { return new URL(url).host } catch { return 'the download' } })()
  return e?.name === 'TimeoutError' ? 'The download took too long. Try again.'
    : /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/.test(`${e?.message} ${e?.cause?.code || ''}`) ? `Can't reach ${host}. Check your internet connection and try again.`
      : e?.message || 'Download failed'
}
export function fetchModel(id) {
  const m = id === 'vad' ? { file: VAD.file, url: VAD.url } : MODELS.find((x) => x.id === id)
  if (!m) throw new Error('No such model')
  const dest = fileOf(m)
  if (has(dest) || (downloads.has(m.file) && !downloads.get(m.file).error)) return
  const d = { got: 0, total: 0, error: null }
  downloads.set(m.file, d)
  const tmp = `${dest}.part`
  ;(async () => {
    try {
      fs.mkdirSync(DIR(), { recursive: true })
      const res = await fetch(m.url || `${HF}/${m.file}`, { signal: AbortSignal.timeout(60 * 60 * 1000) })
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      d.total = Number(res.headers.get('content-length')) || 0
      const out = fs.createWriteStream(tmp)
      for await (const chunk of res.body) {
        d.got += chunk.length
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
      if (d.total && d.got !== d.total) throw new Error('The download was cut short; try again')
      fs.renameSync(tmp, dest)
      downloads.delete(m.file)
    } catch (e) {
      fs.rmSync(tmp, { force: true })
      d.error = downloadError(e, m.url || `${HF}/${m.file}`)
    }
  })()
}
export function removeModel(id) {
  const m = MODELS.find((x) => x.id === id)
  if (!m) throw new Error('No such model')
  if (server?.model === fileOf(m)) stopServer()
  fs.rmSync(fileOf(m), { force: true })
}
const progress = (file) => { const d = downloads.get(file); return d ? { percent: d.total ? Math.floor((d.got / d.total) * 100) : 0, error: d.error } : null }

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

async function local(wav, { cfg, language, prompt }) {
  const m = localModel(cfg)
  const file = fileOf(m)
  if (!has(file)) { fetchModel(m.id); throw fatal(`The speech model (${m.label}, ${m.mb} MB) is still downloading. The missed parts can be transcribed again once it's here.`) }
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
    return { text: j.text || '', engine: `whisper.cpp ${m.label}` }
  }
  // An older whisper.cpp without the server: the command line, loading the model each time.
  const cli = await tool('whisper-cli')
  if (!cli) throw fatal('Transcribing on this computer needs whisper.cpp. Install it in Settings › Meetings.')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-speech-'))
  try {
    fs.writeFileSync(path.join(tmp, 'in.wav'), wav)
    const out = await run(cli, ['-m', file, '-f', path.join(tmp, 'in.wav'), '-nt', '-np', '-l', lang, '-t', String(threads()), ...(prompt ? ['--prompt', prompt.slice(0, 600)] : [])])
    return { text: out, engine: `whisper.cpp ${m.label}` }
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
// key: the setting it uses (saved in Settings › Model providers). price: per hour of audio, list
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
  if (r.status === 401 || r.status === 403) throw fatal(`${label} turned the key down (${r.status}). Check it in Settings › Model providers.`)
  if (!r.ok) throw new Error(`${label}: ${j.error?.message || j.error || j.message || j.detail?.message || j.err_msg || `HTTP ${r.status}`}`.slice(0, 300))
  return j
}

async function service(id, wav, { cfg, language, prompt }) {
  const s = SERVICES[id]
  const e = env()
  const key = e[s.key] || (id === 'gemini' && (e.GOOGLE_API_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY))
  if (!key && !s.custom) throw fatal(`No ${s.label} key saved. Add one in Settings › Model providers, or pick another engine in Settings › Meetings.`)
  const model = cfg?.meetings?.serviceModel?.[id] || (s.custom ? e.SPEECH_MODEL : s.models[0])
  const lang = language && language !== 'auto' ? language : null
  const timeout = AbortSignal.timeout(120_000)
  if (s.style === 'openai') {
    const base = s.base(e)
    if (!base) throw fatal('Give the service\'s address in Settings › Model providers › Another speech service.')
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

// ---------- What meetings.js calls ----------
// The engine you picked; or with none picked, whisper.cpp when it's ready, else the Mac's own when
// it has one, else whisper.cpp (which then says what it needs). auto: that last pick, kept.
let auto = { at: 0, id: 'local' }
const picked = (cfg) => { const e = cfg?.meetings?.engine; return e && (e === 'local' || e === 'apple' || SERVICES[e]) ? e : null }
export const engineOf = (cfg) => picked(cfg) || auto.id
// whisper.cpp and its model, both on this computer.
const whisperReady = async (cfg) => has(fileOf(localModel(cfg))) && (await Promise.all([tool('whisper-server'), tool('whisper-cli')])).some(Boolean)
async function pickAuto(cfg) {
  if (Date.now() - auto.at < 60_000) return auto.id
  auto = { at: Date.now(), id: (await whisperReady(cfg)) ? 'local' : (await appleStatus(cfg?.meetings?.language)).available ? 'apple' : 'local' }
  return auto.id
}
// How many stretches at once: one on this computer (they'd share the chip), a few for a service.
export const parallel = (cfg) => (['local', 'apple'].includes(engineOf(cfg)) ? 1 : 3)
export async function transcribe(wav, o = {}) {
  let id = picked(o.cfg) || await pickAuto(o.cfg)
  // whisper.cpp picked but not on this computer yet: the Mac's own speech stands in when it has your
  // language, so a recording still turns into text instead of waiting on an install.
  if (id === 'local' && !(await whisperReady(o.cfg)) && (await appleStatus(o.cfg?.meetings?.language)).available) id = 'apple'
  return id === 'local' ? local(wav, o) : id === 'apple' ? apple(wav, o) : service(id, wav, o)
}
// Ready before you record: the model there, or downloading it now.
export async function prepare(cfg) {
  if (!picked(cfg)) await pickAuto(cfg).catch(() => {})
  if (engineOf(cfg) !== 'local') return
  const m = localModel(cfg)
  if (!has(fileOf(m))) fetchModel(m.id)
  if (!has(path.join(DIR(), VAD.file))) fetchModel('vad')
  else if (has(fileOf(m))) whisperServer(fileOf(m)).catch(() => {})
}

// Everything Settings › Meetings shows: the engines, which are ready, the models and downloads.
export async function status(cfg) {
  const e = env()
  const [srv, cli, brew, mac] = await Promise.all([tool('whisper-server'), tool('whisper-cli'), tool('brew'), appleStatus(cfg?.meetings?.language)])
  const m = localModel(cfg)
  const localReady = has(fileOf(m)) && !!(srv || cli)
  if (!picked(cfg)) auto = { at: Date.now(), id: localReady ? 'local' : mac.available ? 'apple' : 'local' }
  const engine = engineOf(cfg)
  const services = Object.entries(SERVICES).map(([id, s]) => ({ id, label: s.label, key: s.key, ready: s.custom ? !!e.SPEECH_BASE_URL : !!(e[s.key] || (id === 'gemini' && (e.GOOGLE_API_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY))), models: s.models, model: cfg?.meetings?.serviceModel?.[id] || s.models[0] || e.SPEECH_MODEL || '', price: s.price || {}, custom: !!s.custom }))
  // whisper.cpp picked but not here yet: the Mac's own speech stands in (transcribe() above).
  const standIn = engine === 'local' && !localReady && mac.available ? 'apple' : null
  // Ready to transcribe, and if not, what it needs (Meetings shows it before you record).
  const ready = standIn ? true : engine === 'local' ? localReady : engine === 'apple' ? !!mac.available : !!services.find((x) => x.id === engine)?.ready
  const needs = ready ? null
    : engine === 'local' ? (!(srv || cli) ? (brew ? 'whisper' : 'brew') : 'model')
      : engine === 'apple' ? 'apple' : 'key'
  return {
    engine,
    auto: !picked(cfg),
    ready,
    needs,
    standIn,
    apple: { available: !!mac.available, installed: !!mac.installed, locale: mac.locale || null, why: mac.available ? null : mac.why || null },
    local: {
      ready: localReady,
      program: srv ? 'whisper-server' : cli ? 'whisper-cli' : null,
      installCommand: !srv && !cli && brew ? brewInstall(brew, 'whisper-cpp') : null,
      model: m.id,
      models: MODELS.map((x) => ({ ...x, have: has(fileOf(x)), downloading: progress(x.file) })),
      vad: has(path.join(DIR(), VAD.file)),
    },
    services,
    language: cfg?.meetings?.language || 'auto',
    mac: IS_MAC,
  }
}

