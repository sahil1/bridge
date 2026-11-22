// The local model built into Bridge AI: one of Google's Gemma 4 models (Apache-2.0), the one that
// fits this computer, run by llama.cpp's llama-server (MIT), which comes with the desktop app for
// each platform and chip (scripts/llama.js fetches the pinned build at build time; desktop/stage.js
// puts it in, and the Mac app signs it). Nothing about it happens until you ask for it:
//   A model is downloaded only when you pick it in Settings › Model Providers (or Download where
//   Tidy what I say needs it), never at setup or start: from Hugging Face at a pinned revision,
//   resumable, checked against its SHA-256 before it gets its name, with room for it checked first,
//   as speech models are (speech.js).
//   llama-server starts the first time something asks the model: a process of its own, so loading
//   the model and writing an answer never run on the server's thread, on 127.0.0.1 with a key made
//   up for that run and handed over in its environment, not on its command line (by default it
//   answers any web page that asks). It stays loaded a few minutes after its last answer, then
//   stops and gives its memory back (3 to 16 GB). One that stops mid-answer is started again, once.
//   One model at a time: asked for another, the one loaded finishes and makes way.
// Offered only where it can run (fit()): a build for this platform and chip that loads here (macOS
// 13.3 or later; glibc 2.34 on Linux x64, 2.38 on Linux Arm), and for each model the memory it needs
// and, for the larger ones, a GPU llama.cpp can use. The one recommended is the largest of those
// (recommend()); you can pick another. The Docker image and a server run from a checkout have no
// build, so they don't offer it (scripts/llama.js fetches one for a checkout). What it's used for is
// decided elsewhere (index.js, modeljobs.js): edit by voice and Tidy what I say, and with Auto, short
// jobs when it's downloaded; once it's downloaded, every model list offers it as "on this computer".
// BRIDGE_LLAMA_SERVER (tests, or a checkout's own build): the llama-server to run.
// BRIDGE_LLM_MODELS (tests): a JSON file of { id: { files } } standing in for the real file's name,
// size and checksum. BRIDGE_MODELS_URL (tests): where it's downloaded from instead of Hugging Face.
// BRIDGE_LLM_IDLE_MS (tests): how long it stays loaded after its last answer.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { DATA, ROOT, NODE } from './paths.js'
import { machine, freeBytes, atLeast } from './machine.js'
import { downloadError } from './speech.js'
import { placeEn } from '../shared/places.js'

// Smallest first. The llama.cpp team's own 4-bit conversions of Google's models, each pinned to the
// revision of 19 October 2026 and its file's SHA-256 (from Hugging Face's own listing). active: the
// billions of parameters at work for each word, which sets how fast it is; memGB: the memory a
// computer needs for it beside Bridge AI and a meeting's speech model; gpu: only where llama.cpp
// has a GPU to run it on (on a processor alone it would take many minutes over a meeting).
// local-models.md in the research: E2B wrote the most faithful notes of the small models and runs on
// any computer with 8 GB; E4B is the step up for 16 GB; 26B-A4B, for 32 GB, is among the most
// faithful summarisers on Vectara's hallucination test and, with 3.8 billion at work, quick for its size.
export const MODELS = [
  {
    id: 'gemma-4-e2b', label: 'Gemma 4 E2B', by: 'Google', license: 'Apache-2.0', mb: 2841, billions: 5.1, active: 2.3, context: 131072, memGB: 8, gpu: false,
    repo: 'ggml-org/gemma-4-E2B-it-GGUF', rev: '6938c58e698502037401a5f19f6905f2fb2f7dee',
    files: [{ name: 'gemma-4-E2B-it-Q4_0.gguf', bytes: 2841481184, sha256: '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52' }],
  },
  {
    id: 'gemma-4-e4b', label: 'Gemma 4 E4B', by: 'Google', license: 'Apache-2.0', mb: 4591, billions: 8, active: 4.5, context: 131072, memGB: 16, gpu: true,
    repo: 'ggml-org/gemma-4-E4B-it-GGUF', rev: 'a69f018d7678a2b9f5e705f8903d6fb29b9b25dc',
    files: [{ name: 'gemma-4-E4B-it-Q4_0.gguf', bytes: 4590807392, sha256: 'a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2' }],
  },
  {
    id: 'gemma-4-26b-a4b', label: 'Gemma 4 26B-A4B', by: 'Google', license: 'Apache-2.0', mb: 14618, billions: 25.2, active: 3.8, context: 262144, memGB: 32, gpu: true,
    repo: 'ggml-org/gemma-4-26B-A4B-it-GGUF', rev: '9cf8c8db0f83fb4582f15381f8fb1a7c1b0b9ca2',
    files: [{ name: 'gemma-4-26B-A4B-it-Q4_0.gguf', bytes: 14618145824, sha256: 'd208665ab1cd3a69f7a9a4bc59430e8448c8093d9b06334f566ac59d6d504a03' }],
  },
]
// The one that runs anywhere it's offered: what's offered at all depends on it.
export const DEFAULT = 'gemma-4-e2b'
// How a model is named among the others (chatmodels.js): "bridge:<id>".
export const idOf = (mid) => `bridge:${mid}`
export const isOurs = (id) => /^bridge:/.test(String(id || ''))
const model = (id = DEFAULT) => MODELS.find((m) => m.id === String(id || '').replace(/^bridge:/, '')) || null
// Its name, for a model id ("bridge:gemma-4-e4b" -> "Gemma 4 E4B").
export const labelOf = (id) => model(id)?.label || null

// Your settings (index.js): the model you picked in Settings › Model Providers (llmModel), if any.
let conf = {}
export const configure = (c) => { conf = c || {} }
const picked = () => (MODELS.some((m) => m.id === conf.llmModel) ? conf.llmModel : null)

const HF = () => process.env.BRIDGE_MODELS_URL || 'https://huggingface.co'
const standIns = (() => { try { return JSON.parse(fs.readFileSync(process.env.BRIDGE_LLM_MODELS, 'utf8')) } catch { return {} } })()
const filesOf = (m) => standIns[m.id]?.files || m.files
const DIR = () => path.join(DATA, 'models', 'llm')
const dirOf = (m) => path.join(DIR(), m.id)
const urlOf = (m, f) => (process.env.BRIDGE_MODELS_URL ? `${HF()}/${m.id}/${f.name}` : `${HF()}/${m.repo}/resolve/${m.rev}/${f.name}`)
const size = (f) => { try { return fs.statSync(f).size } catch { return -1 } }
// Downloaded: every file there at its full size (each was checked against its SHA-256 before it got its name).
export const have = (id = DEFAULT) => { const m = model(id); return !!m && filesOf(m).every((f) => size(path.join(dirOf(m), f.name)) === f.bytes) }

// ---------- What this computer can run ----------
// The builds scripts/llama.js fetches, by platform and chip, and what each needs (its build.json says
// so too, and wins): the Mac's from macOS 13.3; Linux's from glibc 2.34 (x64) or 2.38 (Arm); the
// x64 app on Windows on Arm tries the Arm build first, then its own (emulated).
export const NEEDS = { 'darwin-arm64': { macos: '13.3' }, 'darwin-x64': { macos: '13.3' }, 'win32-x64': {}, 'win32-arm64': {}, 'linux-x64': { glibc: '2.34' }, 'linux-arm64': { glibc: '2.38' } }
const keysFor = (m) => (m.platform === 'win32' && m.emulated ? ['win32-arm64', 'win32-x64'] : [`${m.platform}-${m.arch}`])
const exe = (key) => (key.startsWith('win32') ? 'llama-server.exe' : 'llama-server')
// The builds that came with this copy of Bridge AI, for this computer: [{ key, bin, needs }].
function builds(m) {
  // One given in its place is held to what this computer's own build would need.
  if (process.env.BRIDGE_LLAMA_SERVER) return [{ key: 'given', bin: process.env.BRIDGE_LLAMA_SERVER, needs: NEEDS[keysFor(m)[0]] || {} }]
  return keysFor(m).map((key) => {
    const dir = path.join(ROOT, 'native', 'llama', key)
    let meta = {}
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')) } catch { /* none */ }
    return { key, bin: path.join(dir, exe(key)), needs: { ...NEEDS[key], ...(meta.macos ? { macos: meta.macos } : {}), ...(meta.glibc ? { glibc: meta.glibc } : {}) }, gpu: meta.gpu || null }
  }).filter((b) => fs.existsSync(b.bin))
}
// Whether a build can run on this computer (m: machine()), as { ok, why }. Pure, so tests can ask it
// about any computer. build: what came with the app ({ key, needs }), or null; probe: whether it
// loaded here ({ ok, error }), once it's been tried.
export function fitRuntime(m, { build = null, probe = null } = {}) {
  if (!NEEDS[`${m.platform}-${m.arch}`] && !(m.platform === 'win32' && m.emulated)) return { ok: false, why: `There's no llama.cpp build for ${m.platform} on ${m.arch}` }
  if (!build) return { ok: false, why: m.docker ? 'llama.cpp isn\'t in the Docker image' : 'llama.cpp didn\'t come with this copy of Bridge AI (the desktop app has it)' }
  const need = build.needs || {}
  if (need.macos && m.platform === 'darwin' && m.os && !atLeast(m.os, need.macos)) return { ok: false, why: `llama.cpp needs macOS ${need.macos} or later; this Mac has ${m.os}` }
  if (need.glibc && m.platform === 'linux' && !m.glibc) return { ok: false, why: 'llama.cpp needs a Linux with glibc (this one uses another C library)' }
  if (need.glibc && m.platform === 'linux' && !atLeast(m.glibc, need.glibc)) return { ok: false, why: `llama.cpp needs glibc ${need.glibc} or later; this Linux has ${m.glibc}` }
  if (probe && !probe.ok) return { ok: false, why: `llama.cpp doesn't load on this computer: ${probe.error}` }
  return { ok: true, why: null }
}
// A GPU llama.cpp can use here: Apple Silicon's (Metal), or one its device list names (Vulkan on
// Windows and Linux). Not an Intel Mac's: Metal there gives wrong answers, so it runs on the
// processor (start()). gpu: the GPU's name from the device list, once it's been asked.
export const gpuPath = (m, gpu) => !(m.platform === 'darwin' && m.arch === 'x64') && !!gpu
// What a model needs of the computer itself, build aside: { ok, why }. o.gpu: the GPU found, or none.
export function fitNeeds(mod, m, o = {}) {
  if (mod.memGB && m.memGB && m.memGB < mod.memGB) return { ok: false, why: `${mod.label} needs ${mod.memGB} GB of memory; this computer has ${m.memGB} GB` }
  if (mod.gpu && !gpuPath(m, o.gpu)) return { ok: false, why: `${mod.label} needs a GPU llama.cpp can use, and this computer would run it on its processor alone, where a meeting's notes would take many minutes` }
  return { ok: true, why: null }
}
export function fitModel(mod, m, o = {}) {
  const need = fitNeeds(mod, m, o)
  return need.ok ? fitRuntime(m, o) : need
}
// Memory as people know it: 17.2 GB as the OS counts it is a "16 GB" computer, and so is one that
// gives a little of it to its graphics; 14 is 14.
const SIZES = [2, 4, 6, 8, 12, 16, 18, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512]
export const sizeGB = (memGB) => { const g = (memGB || 0) / 1.073741824; return SIZES.find((x) => Math.abs(g - x) / x <= 0.07) || Math.max(1, Math.round(g)) }
// The model for this computer (m: machine(); gpu: the GPU found), and why: the largest whose memory
// and GPU it has. { id, label, memGB, gpu, why: "16 GB of memory: Gemma 4 E4B" }, or null where none
// runs. Pure, so tests can ask it about any computer.
export function recommend(m, { gpu = null } = {}) {
  const fits = MODELS.filter((x) => fitNeeds(x, m, { gpu }).ok)
  const best = fits.at(-1)
  if (!best) return null
  const onGpu = gpuPath(m, gpu)
  // Held back to a smaller one by the GPU, not the memory: said so.
  const held = !onGpu && MODELS.some((x) => x.gpu && (!x.memGB || !m.memGB || m.memGB >= x.memGB))
  const gb = sizeGB(m.memGB)
  return { id: best.id, label: best.label, memGB: gb, gpu: onGpu, held, why: `${gb} GB of memory${held ? ', processor only' : ''}: ${best.label}` }
}

// Whether a build loads, and the processors and GPUs it can use, asked of it once (its device list;
// no model is loaded): { ok, error, devices }. A Mac build's first device list also compiles
// llama.cpp's GPU shaders, which macOS keeps after: 5 seconds on an M4, longer on a slower or
// virtual Mac. So it has two minutes, and one that took longer is asked again the next time.
const PROBE_MS = Number(process.env.BRIDGE_LLAMA_PROBE_MS) || 2 * 60_000
const probes = new Map() // bin -> Promise
function probe(bin) {
  if (!probes.has(bin)) {
    probes.set(bin, new Promise((resolve) => {
      const [cmd, args, more] = command(bin, ['--list-devices'])
      execFile(cmd, args, { cwd: path.dirname(bin), env: { ...envFor(bin), ...more }, timeout: PROBE_MS, windowsHide: true }, (err, out = '', errOut = '') => {
        if (err?.killed) { probes.delete(bin); return resolve({ ok: false, error: `it took more than ${Math.round(PROBE_MS / 1000)} seconds to start`, devices: [] }) }
        const text = `${out}\n${errOut}`
        const devices = [...text.matchAll(/^\s+([A-Za-z]+\d+): (.+?) \((\d+) MiB/gm)].map((x) => ({ id: x[1], name: x[2], mb: Number(x[3]) }))
        if (err) resolve({ ok: false, error: (text.trim().split('\n').filter(Boolean).pop() || err.message).slice(0, 200), devices: [] })
        else resolve({ ok: true, error: null, devices })
      })
    }))
  }
  return probes.get(bin)
}
// Linux finds the libraries beside it this way too, whatever its build says.
const envFor = (bin) => ({ ...process.env, ...(process.platform === 'linux' ? { LD_LIBRARY_PATH: [path.dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}) })
// What runs it: the program itself, or for a stand-in written in JavaScript (tests), this Node.
const command = (bin, args) => (/\.[cm]?js$/.test(bin) ? [NODE.bin, [bin, ...args], NODE.env] : [bin, args, {}])

let fitted = null // { at, ok, why, runtime: { ok, why }, bin, gpu, machine, models, recommended }
// What's offered here: the first build that came with the app and loads, on a computer with the
// memory for the smallest model, worked out again at most every 10 seconds; for each model, whether
// it runs here and why not (models), and the one recommended. The build is tried (its device list)
// only when this is asked: when Settings › Model Providers looks, or once a model is here. Never at
// start. runtime: whether llama.cpp itself runs here, memory aside (the smoke test asks).
export async function fit() {
  if (fitted && Date.now() - fitted.at < 10_000) return fitted
  const m = await machine()
  const found = builds(m)
  let rt = fitRuntime(m, { build: found[0] || null })
  let use = null
  for (const b of found) {
    const base = fitRuntime(m, { build: b })
    if (!base.ok) { rt = base; continue }
    const p = await probe(b.bin)
    rt = fitRuntime(m, { build: b, probe: p })
    if (rt.ok) { use = { ...b, devices: p.devices }; break }
  }
  const gpu = use ? use.devices.find((d) => !/^(BLAS|CPU)/i.test(d.id))?.name || null : null
  const each = Object.fromEntries(MODELS.map((x) => [x.id, rt.ok ? fitModel(x, m, { build: use, gpu }) : rt]))
  const r = each[DEFAULT]
  fitted = { at: Date.now(), ok: r.ok, why: r.why, runtime: { ok: rt.ok, why: rt.why }, bin: use?.bin || null, gpu, machine: m, models: each, recommended: rt.ok ? recommend(m, { gpu }) : null }
  return fitted
}
// Whether the local model fits this computer, from what's known without starting anything: a build
// for it came with this copy of Bridge AI, and the computer has the memory the smallest model needs
// (fit() goes on to try the build, once something asks it). Tidy What I Say is on to start with where
// it does (index.js FEATURES).
export async function fits() {
  if (fitted) return fitted.ok
  const m = await machine()
  return fitModel(model(DEFAULT), m, { build: builds(m)[0] || null }).ok
}
// Whether that model runs here: { ok, why }.
const runsHere = (f, mid) => f.models?.[mid] || { ok: false, why: 'No such model' }
// The model Settings › Model Providers acts on: the one you picked when it runs here, else the one
// recommended for this computer.
async function chosen() {
  const f = await fit()
  const p = picked()
  return model(p && runsHere(f, p).ok ? p : f.recommended?.id || DEFAULT)
}
// The one Bridge AI's jobs run on, or null: the chosen one once it's downloaded, else the largest
// that's downloaded and runs here (a smaller one downloaded before keeps working until the one for
// this computer is). Nothing is downloaded for this.
async function inUse() {
  const f = await fit()
  const c = await chosen()
  if (c && have(c.id) && runsHere(f, c.id).ok) return c
  return [...MODELS].reverse().find((x) => have(x.id) && runsHere(f, x.id).ok) || null
}
// "bridge:<id>" of the model in use, or null when none is downloaded that runs here.
export async function current() { const m = await inUse(); return m ? idOf(m.id) : null }
// Every model downloaded that runs here, the one in use first: what the model lists offer.
export async function usable() {
  const f = await fit()
  const u = await inUse()
  return MODELS.filter((x) => have(x.id) && runsHere(f, x.id).ok).sort((a, b) => (b.id === u?.id) - (a.id === u?.id))
}
// Downloaded, and it can run here: offered in the model lists.
export async function ready() { return !!(await inUse()) }

// ---------- The download ----------
const downloads = new Map() // id -> { got, total, error, stop, done }
const hashOf = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256')
  fs.createReadStream(file).on('data', (b) => h.update(b)).on('end', () => resolve(h)).on('error', reject)
})
// One file: picked up where an earlier try stopped (its .part, asked for the rest), checked against
// its SHA-256 as a whole, and thrown away when it doesn't match.
async function fetchFile(m, f, d) {
  const dest = path.join(dirOf(m), f.name)
  if (size(dest) === f.bytes) { d.got += f.bytes; return }
  const tmp = `${dest}.part`
  let at = Math.max(0, size(tmp))
  if (at > f.bytes) { fs.rmSync(tmp, { force: true }); at = 0 }
  let h = at ? await hashOf(tmp) : crypto.createHash('sha256')
  d.got += at
  if (at < f.bytes) {
    const res = await fetch(urlOf(m, f), { headers: at ? { Range: `bytes=${at}-` } : {}, signal: AbortSignal.any([d.stop.signal, AbortSignal.timeout(4 * 60 * 60 * 1000)]) })
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    if (at && res.status !== 206) { d.got -= at; at = 0; h = crypto.createHash('sha256') }
    const out = fs.createWriteStream(tmp, { flags: at ? 'a' : 'w' })
    try {
      for await (const chunk of res.body) {
        d.got += chunk.length
        h.update(chunk)
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      }
    } finally { await new Promise((resolve) => out.end(resolve)) }
    if (size(tmp) !== f.bytes) throw new Error('The download was cut short; try again')
  }
  if (h.digest('hex') !== f.sha256) {
    fs.rmSync(tmp, { force: true })
    throw new Error(`The download of ${f.name} didn't match its checksum, so it was thrown away. Try again.`)
  }
  fs.renameSync(tmp, dest)
}
// Only ever from you (a Download button: Settings › Model Providers', or where Tidy what I say needs
// it, src/dictation/Tidy.jsx): nothing else in Bridge AI calls this. No id: the chosen one.
export async function fetchModel(mid) {
  const m = mid ? model(mid) : await chosen()
  if (!m) throw new Error('No such model')
  const id = m.id
  if (have(id) || (downloads.has(id) && !downloads.get(id).error)) return
  const f = await fit()
  const here = runsHere(f, id)
  if (!here.ok) throw new Error(here.why || 'The local model can\'t run on this computer')
  const files = filesOf(m)
  const d = { got: 0, total: files.reduce((n, x) => n + x.bytes, 0), error: null, stop: new AbortController() }
  downloads.set(id, d)
  d.done = (async () => {
    let url = urlOf(m, files[0])
    try {
      fs.mkdirSync(dirOf(m), { recursive: true })
      // Room for it first: what's still to come, and a little over.
      const left = files.reduce((n, x) => (size(path.join(dirOf(m), x.name)) === x.bytes ? n : n + Math.max(0, x.bytes - Math.max(0, size(path.join(dirOf(m), `${x.name}.part`))))), 0)
      const free = await freeBytes(DIR())
      if (free != null && free < left + 200e6) throw new Error(`Not enough free space: ${m.label} needs ${Math.ceil((left + 200e6) / 1e6)} MB, and there's ${Math.floor(free / 1e6)} MB free.`)
      for (const x of files) { url = urlOf(m, x); await fetchFile(m, x, d) }
      downloads.delete(id)
      changed()
    } catch (e) {
      if (d.stop.signal.aborted) { if (downloads.get(id) === d) downloads.delete(id) } else d.error = downloadError(e, url)
    }
  })()
}
// A download going (or stopped by a problem): { percent, error }, or null.
export const downloading = (id = DEFAULT) => { const d = downloads.get(model(id)?.id); return d ? { percent: d.total ? Math.min(100, Math.floor((d.got / d.total) * 100)) : 0, error: d.error } : null }
export const downloaded = (id = DEFAULT) => downloads.get(model(id)?.id)?.done || Promise.resolve()
// Stops it first if it's running, and its download if one is going (Windows won't delete a file in
// use). No id: the chosen one.
export async function removeModel(mid) {
  const m = mid ? model(mid) : await chosen()
  if (!m) throw new Error('No such model')
  const d = downloads.get(m.id)
  if (d) { d.stop.abort(); await d.done }
  downloads.delete(m.id)
  if (server?.model === m.id) await stop()
  fs.rmSync(dirOf(m), { recursive: true, force: true })
  changed()
  return m.id
}
// The model lists (chatmodels.js) are told when it comes or goes.
let stamp = 0
export const listStamp = () => stamp
const changed = () => { stamp++ }

// ---------- llama-server, while it's used ----------
// BRIDGE_LLM_IDLE_MS (tests): how long it stays loaded after its last answer.
const IDLE = Number(process.env.BRIDGE_LLM_IDLE_MS) || 5 * 60_000
let server = null // { proc, model, port, key, ctx, ready, busy, idle, err }
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})
// How much it reads at a time: 16K tokens, or 32K with 16 GB of memory or more (Gemma 4 takes 128K,
// but a long context takes memory of its own, and Bridge AI's jobs go in pieces that fit).
export const contextFor = (memGB) => (memGB >= 16 ? 32768 : 16384)
export async function stop() {
  const s = server
  server = null
  if (!s) return
  clearTimeout(s.idle)
  s.stopped = true
  try { s.proc.kill() } catch { /* gone */ }
  await new Promise((r) => (s.proc.exitCode !== null || s.proc.signalCode ? r() : s.proc.once('exit', r)))
}
process.on('exit', () => { try { server?.proc.kill() } catch { /* gone */ } })

async function start(m) {
  const f = await fit()
  if (!f.ok || !f.bin) throw Object.assign(new Error(f.why || 'The local model can\'t run on this computer'), { code: 'not_here' })
  const here = runsHere(f, m.id)
  if (!here.ok) throw Object.assign(new Error(here.why), { code: 'not_here' })
  if (!have(m.id)) throw Object.assign(new Error(`${m.label} isn't downloaded. Download it in ${placeEn('providers')}.`), { code: 'not_downloaded' })
  const port = await freePort()
  const key = crypto.randomBytes(24).toString('hex')
  const ctx = contextFor(f.machine.memGB)
  const args = ['-m', path.join(dirOf(m), filesOf(m)[0].name), '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx), '-np', '1', '--alias', 'bridge', '--no-webui']
  // Metal on an Intel Mac's GPU gives wrong answers (llama.cpp #30702): the processor there.
  if (f.machine.platform === 'darwin' && f.machine.arch === 'x64') args.push('-ngl', '0')
  const [cmd, argv, more] = command(f.bin, args)
  const proc = spawn(cmd, argv, { cwd: path.dirname(f.bin), env: { ...envFor(f.bin), ...more, LLAMA_API_KEY: key }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  const me = { proc, model: m.id, port, key, ctx, busy: 0, err: '', started: Date.now() }
  proc.stderr.on('data', (b) => { me.err = (me.err + b).slice(-3000) })
  proc.on('error', (e) => { me.err += `\n${e.message}` })
  proc.on('exit', () => { clearTimeout(me.idle); if (server === me) server = null })
  me.ready = (async () => {
    const end = Date.now() + 3 * 60_000 // a big model from a slow disk
    while (Date.now() < end) {
      if (proc.exitCode !== null || proc.signalCode) throw Object.assign(new Error(`${m.label} stopped as it loaded: ${me.err.trim().split('\n').filter(Boolean).pop() || proc.exitCode || proc.signalCode}`), { code: 'stopped' })
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw Object.assign(new Error(`${m.label} took too long to load`), { code: 'stopped' })
  })()
  server = me
  try { await me.ready } catch (e) { if (server === me) await stop(); throw e }
  return me
}
const live = (s) => s && !s.stopped && s.proc.exitCode === null && !s.proc.signalCode
// Unused for a while from now: the model's memory goes back.
function idleLater(s) {
  clearTimeout(s.idle)
  s.idle = setTimeout(() => { if (server === s && !s.busy) stop() }, IDLE)
  s.idle.unref?.()
}
let starting = null // { model, p }
// llama-server with model m, started if need be. Another model loaded finishes what it's doing and
// makes way first: two at once could take more memory than the computer has.
async function running(m) {
  for (;;) {
    if (starting) {
      if (starting.model === m.id) return starting.p
      await starting.p.catch(() => {})
      continue
    }
    if (live(server) && server.model === m.id) { await server.ready; return server }
    if (live(server)) {
      while (live(server) && server.busy) await new Promise((r) => setTimeout(r, 200))
      await stop()
      continue
    }
    const me = { model: m.id }
    me.p = start(m).finally(() => { if (starting === me) starting = null })
    starting = me
    return me.p
  }
}
// The model asked for by its id ("bridge:gemma-4-e4b" or "gemma-4-e4b"), else the one in use.
async function wanted(id) {
  const m = id ? model(id) : await inUse()
  if (m) return m
  if (id) throw Object.assign(new Error(`There's no local model called ${String(id).replace(/^bridge:/, '')}`), { code: 'not_here' })
  const c = await chosen()
  throw Object.assign(new Error(`${c?.label || 'The local model'} isn't downloaded. Download it in ${placeEn('providers')}.`), { code: 'not_downloaded' })
}
// Runs fn({ url, key, ctx, model }) against llama-server running that model (id; none: the one in
// use), starting it first if need be. One that stops in the middle (a crash, or the computer short
// of memory) is started again and asked again, once; a second stop is said as it is.
const dropped = (e) => /fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|other side closed|terminated|UND_ERR_SOCKET/i.test(`${e?.message} ${e?.cause?.code || ''} ${e?.cause?.message || ''}`)
export async function use(fn, id) {
  const m = await wanted(id)
  for (let tries = 0; ; tries++) {
    const s = await running(m)
    s.busy++
    clearTimeout(s.idle)
    try {
      return await fn({ url: `http://127.0.0.1:${s.port}`, key: s.key, ctx: s.ctx, model: s.model })
    } catch (e) {
      if (tries === 0 && dropped(e)) {
        await new Promise((r) => setTimeout(r, 100))
        if (!live(s)) continue
      }
      if (dropped(e) && !live(s)) throw Object.assign(new Error(`${m.label} stopped while it worked${s.err.trim() ? `: ${s.err.trim().split('\n').filter(Boolean).pop().slice(0, 200)}` : ''}`), { code: 'stopped' })
      throw e
    } finally {
      s.busy--
      if (!s.busy && live(s)) idleLater(s)
    }
  }
}
// Started ahead of a job that's on its way (dictation to tidy, while you're still talking), so the
// job doesn't wait for the model to load; let go when idle, as after any answer. Only once it's
// downloaded and can run here, and nothing if it's running or starting already.
export async function warm(id) {
  const m = id ? model(id) : await inUse()
  if (!m || (live(server) && server.model === m.id) || starting || !have(m.id) || !runsHere(await fit(), m.id).ok) return false
  running(m).then((s) => { if (!s.busy) idleLater(s) }, () => {})
  return true
}
// Loading now (started, not answering yet).
export const loading = () => !!starting
// How much it reads at a time on this computer, whether it's running or not.
export async function context() { return contextFor((await machine()).memGB) }
export const loaded = () => !!live(server)

// ---------- What Settings › Model Providers shows ----------
const shape = (m) => ({ id: m.id, label: m.label, by: m.by, license: m.license, mb: m.mb, context: m.context, memGB: m.memGB, gpu: !!m.gpu, active: m.active })
// Hidden (offered: false) where none can run; why says why, for diagnostics. model: the one
// Settings acts on (the chosen one), have and downloading its; using: the one jobs run on now;
// models: each one that runs here; hidden: the others, and why not.
export async function status() {
  const f = await fit()
  const c = await chosen()
  const u = await inUse()
  return {
    offered: f.ok, why: f.why, runtime: f.runtime, id: idOf((u || c).id),
    model: shape(c), have: have(c.id), downloading: downloading(c.id),
    using: u ? shape(u) : null, picked: picked(), recommended: f.recommended,
    models: MODELS.filter((x) => runsHere(f, x.id).ok).map((x) => ({ ...shape(x), have: have(x.id), downloading: downloading(x.id), recommended: f.recommended?.id === x.id, using: u?.id === x.id, chosen: c.id === x.id })),
    hidden: MODELS.filter((x) => !runsHere(f, x.id).ok).map((x) => ({ id: x.id, label: x.label, why: runsHere(f, x.id).why })),
    loaded: loaded(), loadedModel: live(server) ? server.model : null, gpu: f.gpu, onGpu: gpuPath(f.machine, f.gpu), idleMinutes: Math.round(IDLE / 60_000),
    machine: { platform: f.machine.platform, arch: f.machine.arch, memGB: f.machine.memGB, glibc: f.machine.glibc, emulated: f.machine.emulated, docker: f.machine.docker },
  }
}
// Whether the local model can't run a job now, and why, as said where a job set to stay on this
// computer can't: null when one's in use.
export async function whyNot() {
  const f = await fit()
  if (!f.ok) return { code: 'not_here', why: f.why || 'The local model can\'t run on this computer' }
  if (await inUse()) return null
  const c = await chosen()
  const d = downloading(c.id)
  return d && !d.error ? { code: 'downloading', why: `${c.label} is still downloading (${d.percent}%)` } : { code: 'not_downloaded', why: `${c.label} isn't downloaded yet`, model: c.label }
}
