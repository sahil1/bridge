// sherpa-onnx, the engine that runs Parakeet on this computer: in a process of its own
// (asr-worker.js, on the app's own Node), so loading a model and turning speech into text never
// runs on the server's thread, and a crash there leaves the server standing. The model stays loaded
// for a few minutes after the last use (about 2 GB of memory for Parakeet), then the process ends
// and gives it back. A process that stops is started again with the next request, and the one it
// was working on is tried once more. Takes 16 kHz mono PCM, 16-bit.
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
import { ROOT, NODE } from './paths.js'

const WORKER = path.join(ROOT, 'server', 'asr-worker.js')
// BRIDGE_ASR_IDLE_MS (tests): how long it stays loaded after the last use.
const IDLE = Number(process.env.BRIDGE_ASR_IDLE_MS) || 5 * 60_000
// Two to four cores: more were slower on an M4 (its efficiency cores), and it leaves the rest free.
export const threads = () => Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2)))

let child = null // { proc, pending: Map(id -> { resolve, reject, msg, tries, timer }), model, last }
let ids = 0
let probed = null

function start() {
  const proc = fork(WORKER, [], { execPath: NODE.bin, env: { ...process.env, ...NODE.env }, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
  const me = { proc, pending: new Map(), model: null, last: Date.now(), err: '' }
  proc.stderr.on('data', (b) => { me.err = (me.err + b).slice(-1000) })
  proc.on('message', (m) => {
    const p = m?.id != null && me.pending.get(m.id)
    if (!p) return
    me.pending.delete(m.id)
    clearTimeout(p.timer)
    me.last = Date.now()
    // Unused for a while from now: the model's memory goes back.
    if (!me.pending.size) { clearTimeout(me.idle); me.idle = setTimeout(() => { if (child === me && !me.pending.size) stop() }, IDLE); me.idle.unref?.() }
    if (m.error) p.reject(new Error(m.error))
    else p.resolve(m)
  })
  proc.on('error', () => {})
  proc.on('exit', (code, signal) => {
    clearTimeout(me.idle)
    if (child === me) child = null
    // Stopped mid-request (a crash in native code, or out of memory): each request it had goes to
    // a new one, once; a second stop means it's the request, and it says so.
    const why = signal || code
    for (const p of me.pending.values()) {
      clearTimeout(p.timer)
      if (p.tries < 2 && !me.killed) send(p.msg, p.tries + 1).then(p.resolve, p.reject)
      else p.reject(Object.assign(new Error(me.killed === 'timeout' ? 'The speech engine took too long, so it was stopped' : `The speech engine stopped (${why})${me.err.trim() ? `: ${me.err.trim().split('\n').pop().slice(0, 200)}` : ''}`), { stopped: true }))
    }
    me.pending.clear()
  })
  return me
}

function send(msg, tries = 1) {
  if (!child || child.proc.exitCode !== null) child = start()
  const me = child
  return new Promise((resolve, reject) => {
    const id = ++ids
    const full = { ...msg, id }
    // Long enough for a long recording on a slow computer: a minute, plus the audio's own length.
    const secs = (msg.pcm?.length || 0) / 16000
    const timer = setTimeout(() => { me.killed = 'timeout'; try { me.proc.kill() } catch { /* gone */ } }, 60_000 + secs * 1000)
    me.pending.set(id, { resolve, reject, msg, tries, timer })
    me.model = msg.model?.key || me.model
    me.last = Date.now()
    clearTimeout(me.idle)
    me.proc.send(full)
  })
}

// Speech to text: { text, ms, decodeMs } for 16 kHz mono 16-bit PCM (ms with loading the model,
// decodeMs without). model: { key, dir, files: { encoder, decoder, joiner, tokens }, hotwords }. A
// long recording is cut into pieces of a minute or less, each at its quietest moment near the end,
// so memory stays small and nothing is cut mid-word.
export async function recognize(model, pcm, { hotwords = [] } = {}) {
  const parts = split(pcm)
  const texts = []
  let ms = 0
  let decodeMs = 0
  for (const p of parts) {
    const r = await send({ model, pcm: p, hotwords, threads: threads() })
    if (r.text) texts.push(r.text)
    ms += r.ms + (r.loadMs || 0)
    decodeMs += r.ms
  }
  return { text: texts.join(' ').replace(/\s+/g, ' ').trim(), ms, decodeMs }
}

const MAX = 60 * 16000
export function split(pcm) {
  const out = []
  let at = 0
  while (pcm.length - at > MAX) {
    // The quietest tenth of a second in the last ten seconds before the limit.
    let best = at + MAX
    let low = Infinity
    for (let s = at + MAX - 10 * 16000; s + 1600 <= at + MAX; s += 800) {
      let e = 0
      for (let i = s; i < s + 1600; i++) e += Math.abs(pcm[i])
      if (e < low) { low = e; best = s + 800 }
    }
    out.push(pcm.slice(at, best))
    at = best
  }
  out.push(at ? pcm.slice(at) : pcm)
  return out
}

// Whether sherpa-onnx's addon loads on this computer: { ok, error }, asked of a process of its own
// once (it's built for newer systems than some Bridge AI runs on, and a library that won't load
// should hide the engine, not break it). Kept for as long as the server runs.
export function probe() {
  return (probed ||= new Promise((resolve) => {
    const proc = fork(WORKER, [], { execPath: NODE.bin, env: { ...process.env, ...NODE.env }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
    let err = ''
    proc.stderr.on('data', (b) => { err = (err + b).slice(-600) })
    const done = (r) => { clearTimeout(limit); try { proc.kill() } catch { /* gone */ } resolve(r) }
    const limit = setTimeout(() => done({ ok: false, error: 'It took too long to load' }), 30_000)
    proc.on('message', (m) => { if (m?.type === 'probe') done({ ok: !!m.ok, error: m.error || null }) })
    proc.on('error', (e) => done({ ok: false, error: e.message }))
    proc.on('exit', (code, signal) => done({ ok: false, error: `It stopped as it loaded (${signal || code})${err.trim() ? `: ${err.trim().split('\n').pop().slice(0, 200)}` : ''}` }))
    proc.send({ type: 'probe' })
  }))
}

// The model let go of (removed, or another picked): the process ends, and the next request starts one.
export function stop(key) {
  if (!child || (key && child.model !== key)) return
  child.killed = 'stopped'
  try { child.proc.kill() } catch { /* gone */ }
  child = null
}
export const loaded = () => (child && child.proc.exitCode === null ? child.model : null)

process.on('exit', () => stop())
