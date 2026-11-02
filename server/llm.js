// The local model built into Bridge AI: Google's Gemma 4 E2B (Apache-2.0), run by llama.cpp's
// llama-server (MIT), which comes with the desktop app for each platform and chip (scripts/llama.js
// fetches the pinned build at build time; desktop/stage.js puts it in, and the Mac app signs it).
// Nothing about it happens until you ask for it:
//   The model (2.8 GB) is downloaded only when you pick it in Settings › Model Providers, never at
//   setup or start: from Hugging Face at a pinned revision, resumable, checked against its SHA-256
//   before it gets its name, with room for it checked first, as speech models are (speech.js).
//   llama-server starts the first time something asks the model: a process of its own, so loading
//   the model and writing an answer never run on the server's thread, on 127.0.0.1 with a key made
//   up for that run and handed over in its environment, not on its command line (by default it
//   answers any web page that asks). It stays loaded a few minutes after its last answer, then
//   stops and gives its memory back (about 3 GB). One that stops mid-answer is started again, once.
// Offered only where it can run (fit()): 8 GB of memory or more, and a build for this platform and
// chip that loads here (macOS 13.3 or later; glibc 2.34 on Linux x64, 2.38 on Linux Arm). The Docker
// image and a server run from a checkout have no build, so they don't offer it (scripts/llama.js
// fetches one for a checkout). What it's used for is decided elsewhere: index.js prefers Claude and
// the other models you have, and picks this one by itself only for edit by voice, or when there's
// nothing else; once it's downloaded, every model list offers it as "on this computer".
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

export const MODELS = [
  {
    id: 'gemma-4-e2b', label: 'Gemma 4 E2B', by: 'Google', license: 'Apache-2.0', mb: 2841, billions: 5.1, context: 131072, memGB: 8,
    // The llama.cpp team's own conversion of google/gemma-4-E2B-it, in 4 bits.
    repo: 'ggml-org/gemma-4-E2B-it-GGUF', rev: '6938c58e698502037401a5f19f6905f2fb2f7dee',
    files: [{ name: 'gemma-4-E2B-it-Q4_0.gguf', bytes: 2841481184, sha256: '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52' }],
  },
]
export const DEFAULT = 'gemma-4-e2b'
// How the model is named among the others (chatmodels.js): "bridge:<id>".
export const ID = `bridge:${DEFAULT}`
const model = (id = DEFAULT) => MODELS.find((m) => m.id === id) || null

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
export function fitModel(mod, m, o = {}) {
  if (mod.memGB && m.memGB && m.memGB < mod.memGB) return { ok: false, why: `${mod.label} needs ${mod.memGB} GB of memory; this computer has ${m.memGB} GB` }
  return fitRuntime(m, o)
}

// Whether a build loads, and the processors and GPUs it can use, asked of it once (its device list;
// no model is loaded): { ok, error, devices }.
const probes = new Map() // bin -> Promise
function probe(bin) {
  if (!probes.has(bin)) {
    probes.set(bin, new Promise((resolve) => {
      const [cmd, args, more] = command(bin, ['--list-devices'])
      execFile(cmd, args, { cwd: path.dirname(bin), env: { ...envFor(bin), ...more }, timeout: 20_000, windowsHide: true }, (err, out = '', errOut = '') => {
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

let fitted = null // { at, ok, why, runtime: { ok, why }, bin, gpu, machine }
// What's offered here: the first build that came with the app and loads, on a computer with the
// memory for the model, worked out again at most every 10 seconds. The build is tried (its device
// list) only when this is asked: when Settings › Model Providers looks, or once the model is here.
// Never at start. runtime: whether llama.cpp itself runs here, memory aside (the smoke test asks).
export async function fit() {
  if (fitted && Date.now() - fitted.at < 10_000) return fitted
  const m = await machine()
  const mod = model()
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
  const r = rt.ok ? fitModel(mod, m, { build: use }) : rt
  const gpu = use ? use.devices.find((d) => !/^(BLAS|CPU)/i.test(d.id))?.name || null : null
  fitted = { at: Date.now(), ok: r.ok, why: r.why, runtime: { ok: rt.ok, why: rt.why }, bin: use?.bin || null, gpu, machine: m }
  return fitted
}
// Downloaded, and it can run here: offered in the model lists.
export async function ready() { return have() && (await fit()).ok }

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
// Only ever from you (Settings › Model Providers' Download): nothing else in Bridge AI calls this.
export async function fetchModel(id = DEFAULT) {
  const m = model(id)
  if (!m) throw new Error('No such model')
  if (have(id) || (downloads.has(id) && !downloads.get(id).error)) return
  const f = await fit()
  if (!f.ok) throw new Error(f.why || 'The local model can\'t run on this computer')
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
export const downloading = (id = DEFAULT) => { const d = downloads.get(id); return d ? { percent: d.total ? Math.min(100, Math.floor((d.got / d.total) * 100)) : 0, error: d.error } : null }
export const downloaded = (id = DEFAULT) => downloads.get(id)?.done || Promise.resolve()
// Stops it first if it's running, and its download if one is going (Windows won't delete a file in use).
export async function removeModel(id = DEFAULT) {
  const m = model(id)
  if (!m) throw new Error('No such model')
  const d = downloads.get(id)
  if (d) { d.stop.abort(); await d.done }
  downloads.delete(id)
  await stop()
  fs.rmSync(dirOf(m), { recursive: true, force: true })
  changed()
}
// The model lists (chatmodels.js) are told when it comes or goes.
let stamp = 0
export const listStamp = () => stamp
const changed = () => { stamp++ }

// ---------- llama-server, while it's used ----------
// BRIDGE_LLM_IDLE_MS (tests): how long it stays loaded after its last answer.
const IDLE = Number(process.env.BRIDGE_LLM_IDLE_MS) || 5 * 60_000
let server = null // { proc, port, key, ctx, ready, busy, idle, err }
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

async function start() {
  const f = await fit()
  if (!f.ok || !f.bin) throw new Error(f.why || 'The local model can\'t run on this computer')
  const m = model()
  if (!have()) throw Object.assign(new Error(`${m.label} isn't downloaded. Download it in Settings › Model Providers.`), { code: 'not_downloaded' })
  const port = await freePort()
  const key = crypto.randomBytes(24).toString('hex')
  const ctx = contextFor(f.machine.memGB)
  const args = ['-m', path.join(dirOf(m), filesOf(m)[0].name), '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx), '-np', '1', '--alias', 'bridge', '--no-webui']
  // Metal on an Intel Mac's GPU gives wrong answers (llama.cpp #30702): the processor there.
  if (f.machine.platform === 'darwin' && f.machine.arch === 'x64') args.push('-ngl', '0')
  const [cmd, argv, more] = command(f.bin, args)
  const proc = spawn(cmd, argv, { cwd: path.dirname(f.bin), env: { ...envFor(f.bin), ...more, LLAMA_API_KEY: key }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  const me = { proc, port, key, ctx, busy: 0, err: '', started: Date.now() }
  proc.stderr.on('data', (b) => { me.err = (me.err + b).slice(-3000) })
  proc.on('error', (e) => { me.err += `\n${e.message}` })
  proc.on('exit', () => { clearTimeout(me.idle); if (server === me) server = null })
  me.ready = (async () => {
    const end = Date.now() + 3 * 60_000 // a big model from a slow disk
    while (Date.now() < end) {
      if (proc.exitCode !== null || proc.signalCode) throw new Error(`The local model stopped as it loaded: ${me.err.trim().split('\n').filter(Boolean).pop() || proc.exitCode || proc.signalCode}`)
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('The local model took too long to load')
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
let starting = null
async function running() {
  if (live(server)) { await server.ready; return server }
  starting ||= start().finally(() => { starting = null })
  return starting
}
// Runs fn({ url, key, ctx }) against a running llama-server, starting it first if need be. One that
// stops in the middle (a crash, or the computer short of memory) is started again and asked again,
// once; a second stop is said as it is.
const dropped = (e) => /fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|other side closed|terminated|UND_ERR_SOCKET/i.test(`${e?.message} ${e?.cause?.code || ''} ${e?.cause?.message || ''}`)
export async function use(fn) {
  for (let tries = 0; ; tries++) {
    const s = await running()
    s.busy++
    clearTimeout(s.idle)
    try {
      return await fn({ url: `http://127.0.0.1:${s.port}`, key: s.key, ctx: s.ctx })
    } catch (e) {
      if (tries === 0 && dropped(e)) {
        await new Promise((r) => setTimeout(r, 100))
        if (!live(s)) continue
      }
      if (dropped(e) && !live(s)) throw new Error(`The local model stopped while it worked${s.err.trim() ? `: ${s.err.trim().split('\n').filter(Boolean).pop().slice(0, 200)}` : ''}`)
      throw e
    } finally {
      s.busy--
      if (!s.busy && live(s)) idleLater(s)
    }
  }
}
// How much it reads at a time on this computer, whether it's running or not.
export async function context() { return contextFor((await machine()).memGB) }
export const loaded = () => !!live(server)

// ---------- What Settings › Model Providers shows ----------
// Hidden (offered: false) where it can't run; why says why, for diagnostics.
export async function status() {
  const f = await fit()
  const m = model()
  return {
    offered: f.ok, why: f.why, runtime: f.runtime, id: ID,
    model: { id: m.id, label: m.label, by: m.by, license: m.license, mb: m.mb, context: m.context },
    have: have(), downloading: downloading(), loaded: loaded(), gpu: f.gpu, idleMinutes: Math.round(IDLE / 60_000),
    machine: { platform: f.machine.platform, arch: f.machine.arch, memGB: f.machine.memGB, glibc: f.machine.glibc, emulated: f.machine.emulated, docker: f.machine.docker },
  }
}
