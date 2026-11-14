// Reading an answer aloud on this computer, for the page to play on the device you're using
// (src/voice/speak.js): the natural voice (Supertonic 3, through sherpa-onnx, in a process of its
// own: tts-worker.js), once it's downloaded, a sentence or two at a time so the first is heard
// while the rest are made; or eSpeak NG where it's installed (most Linux desktops have it, for
// their screen reader), for a device with no voice of its own. Each answer is a WAV, so it plays
// the same on this computer or a phone through the relay. Nothing leaves the computer: the natural
// voice is one download from Hugging Face, when you pick it in Settings › Voice & Meetings, never by itself.
import path from 'node:path'
import { execFile, fork } from 'node:child_process'
import { tool } from './fixes.js'
import { NODE, ROOT } from './paths.js'
import { machine } from './machine.js'
import * as speech from './speech.js'
import * as asr from './asr.js'
import { wavOf } from './voice.js'

// BRIDGE_ESPEAK (tests): a script standing in for eSpeak NG, run on the app's own Node.
let found = null // { at, bin }
async function espeak() {
  if (process.env.BRIDGE_ESPEAK) return process.env.BRIDGE_ESPEAK
  if (found && Date.now() - found.at < 5 * 60_000) return found.bin
  found = { at: Date.now(), bin: (await tool('espeak-ng')) || (await tool('espeak')) || null }
  return found.bin
}

// ---------- The natural voice: where it can run ----------
// Where sherpa-onnx runs (speech.fitRuntime) with the memory it takes: { ok, why }. Pure, so tests
// can ask about any computer.
export function fitNatural(m, { probe = null } = {}) {
  const r = speech.fitRuntime('sherpa', m, { probe })
  if (!r.ok) return r
  if (m.memGB && m.memGB < speech.NATURAL.memGB) return { ok: false, why: `The natural voice needs ${speech.NATURAL.memGB} GB of memory; this computer has ${m.memGB} GB` }
  return r
}
let fitted = null // { at, ok, why }
async function fit() {
  if (fitted && Date.now() - fitted.at < 10_000) return fitted
  const m = await machine()
  const probe = speech.fitRuntime('sherpa', m).ok ? await asr.probe() : null
  fitted = { at: Date.now(), ...fitNatural(m, { probe }) }
  return fitted
}

// What this computer can read with: { espeak, natural } (natural: null where it can't run, with
// naturalWhy; else what Settings shows of it, and whether it's here or downloading).
export async function status() {
  const f = await fit()
  const n = speech.NATURAL
  const dl = speech.downloading(n.id)
  return {
    espeak: !!(await espeak()),
    natural: f.ok ? { id: n.id, label: n.label, by: n.by, license: n.license, mb: n.mb, languages: n.languages, voices: VOICES, have: speech.have(n), downloading: dl } : null,
    naturalWhy: f.ok ? null : f.why,
  }
}

// Its download, asked for in Settings (with the size said first); removing it stops the voice first.
export async function download() {
  const f = await fit()
  if (!f.ok) throw Object.assign(new Error(f.why || 'The natural voice can\'t run on this computer'), { status: 409 })
  speech.fetchModel(speech.NATURAL.id)
  return status()
}
export async function remove() {
  stop()
  await speech.removeModel(speech.NATURAL.id)
  return status()
}

// ---------- Its process, kept while it's used ----------
const WORKER = path.join(ROOT, 'server', 'tts-worker.js')
// BRIDGE_TTS_IDLE_MS (tests): how long it stays loaded after the last sentence (it takes about
// 400 MB), long enough for the next question's answer.
const IDLE = Number(process.env.BRIDGE_TTS_IDLE_MS) || 3 * 60_000
const VOICES = 10
// Supertonic at speed 1 is about a fifth slower than the Mac's and Windows' own voices at 1×: this
// makes 1× the same pace, and the speed picked in Settings goes on top.
const PACE = 1.2
let child = null // { proc, pending: Map(id -> { resolve, reject, timer }), err, idle, killed }
let ids = 0

function start() {
  const proc = fork(WORKER, [], { execPath: NODE.bin, env: { ...process.env, ...NODE.env }, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
  const me = { proc, pending: new Map(), err: '', idle: null, killed: null }
  proc.stderr.on('data', (b) => { me.err = (me.err + b).slice(-1000) })
  proc.on('message', (m) => {
    const p = m?.id != null && me.pending.get(m.id)
    if (!p) return
    me.pending.delete(m.id)
    clearTimeout(p.timer)
    if (!me.pending.size) { clearTimeout(me.idle); me.idle = setTimeout(() => { if (child === me && !me.pending.size) stop() }, IDLE); me.idle.unref?.() }
    if (m.error) p.reject(Object.assign(new Error(m.error), { status: 502 }))
    else p.resolve(m)
  })
  proc.on('error', () => {})
  proc.on('exit', (code, signal) => {
    clearTimeout(me.idle)
    if (child === me) child = null
    const last = me.err.trim().split('\n').pop()?.slice(0, 200)
    for (const p of me.pending.values()) {
      clearTimeout(p.timer)
      p.reject(Object.assign(new Error(me.killed === 'timeout' ? 'The natural voice took too long, so it was stopped' : `The natural voice stopped (${signal || code})${last ? `: ${last}` : ''}`), { status: 502 }))
    }
    me.pending.clear()
  })
  return me
}
function send(msg) {
  if (!child || child.proc.exitCode !== null) child = start()
  const me = child
  return new Promise((resolve, reject) => {
    const id = ++ids
    const timer = setTimeout(() => { me.killed = 'timeout'; try { me.proc.kill() } catch { /* gone */ } }, 60_000)
    me.pending.set(id, { resolve, reject, timer })
    clearTimeout(me.idle)
    me.proc.send({ ...msg, id })
  })
}
export function stop() {
  if (!child) return
  const c = child
  child = null
  c.killed = 'stopped'
  try { c.proc.kill() } catch { /* gone */ }
}
export const loaded = () => !!child
process.on('exit', () => stop())

// ---------- Reading it ----------
const fail = (msg, status) => Object.assign(new Error(msg), { status })
const wordsOf = (text, most) => {
  const w = String(text || '').replace(/\s+/g, ' ').trim().slice(0, most)
  if (!w) throw fail('Nothing to read', 400)
  return w
}

// The text as a WAV. engine: 'natural' or 'espeak'. lang: the app's language ('de', 'pt-BR').
// voice: the natural voice's number (0 to 9: five women's, then five men's); rate: the speed
// picked (1 is the usual pace).
export async function speak(text, { lang = 'en', engine = 'espeak', voice = 0, rate = 1 } = {}) {
  if (engine === 'natural') return natural(text, { lang, voice, rate })
  const bin = await espeak()
  if (!bin) throw fail('Nothing on this computer can read it aloud (eSpeak NG isn\'t installed)', 409)
  const words = wordsOf(text, 4000)
  const v = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) ? lang.toLowerCase() : 'en'
  // The words as an argument after --, so none is ever taken for an option; no shell.
  const args = ['-v', v, '--stdout', '--', words]
  const script = /\.c?js$/.test(bin)
  return new Promise((resolve, reject) => {
    execFile(script ? NODE.bin : bin, script ? [bin, ...args] : args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000, windowsHide: true, env: { ...process.env, ...(script ? NODE.env : {}) } }, (err, out) => {
      if (err || !out?.length) reject(fail('eSpeak NG couldn\'t read it', 502))
      else resolve(out)
    })
  })
}

async function natural(text, { lang, voice, rate }) {
  const n = speech.NATURAL
  const f = await fit()
  if (!f.ok) throw fail(`The natural voice can't run on this computer: ${f.why}`, 409)
  if (!speech.have(n)) throw fail(speech.downloading(n.id) && !speech.downloading(n.id).error ? 'The natural voice is still downloading' : 'The natural voice isn\'t downloaded. Download it in Settings › Voice & Meetings.', 409)
  const code = String(lang || 'en').toLowerCase().split('-')[0]
  if (!n.languages.includes(code)) throw fail('The natural voice doesn\'t speak this language', 400)
  // A sentence or two at a time comes from the page; a long one is still read whole.
  const words = wordsOf(text, 1500)
  const speed = Math.max(0.6, Math.min(2, PACE * (Number(rate) || 1)))
  const r = await send({ model: { key: n.id, dir: speech.dirOf(n) }, text: words, lang: code, sid: Math.max(0, Math.min(VOICES - 1, Number(voice) | 0)), speed, threads: 2 })
  return wavOf(r.pcm, r.rate)
}
