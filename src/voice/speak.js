// Answers read aloud (the Chief of Staff's, asked out loud: AskOutLoud.jsx), by a voice on the
// device you're using: the system's own voices that run on it (macOS's, Windows', the phone's), never
// one the browser fetches from the internet (Chrome's "Google" voices say localService: false and
// are left out), the most natural first. Or by the natural voice your computer makes, once it's
// downloaded there (picked in Settings › Voice; server/voicespeak.js), a sentence or two at a time,
// and played here. Where the device has no voice of its own (Linux, mostly), that, or eSpeak NG when
// it's installed on the computer. Where there's none, nothing is offered: the answer is in the chat
// as always.
import { api, apiUrl } from '../api.js'
import { currentLang, tx } from '../i18n/index.js'

// { voice: the one picked on this device (its voiceURI, which in Chrome is its name; or 'natural'),
// natural: which of the natural voice's ten (0 to 9), rate }
const STORE = 'cc-voice'
const read = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {} } catch { return {} } }
export const prefs = read
export function setPrefs(p) { try { localStorage.setItem(STORE, JSON.stringify({ ...read(), ...p })) } catch { /* not kept */ } }

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null
const appLang = () => (currentLang() || 'en').toLowerCase().split('-')[0]
export const keyOf = (v) => v.voiceURI || v.name

// How natural a voice sounds, best first: 0 Premium, 1 Enhanced (and Windows' and Android's natural
// ones), 2 the usual ones, 3 the robotic ones (macOS's Eloquence voices: Eddy, Flo, Reed...; eSpeak
// behind Linux's speech-dispatcher), 4 the novelty ones (Albert, Bad News, Zarvox), which are left
// out. Safari and phones say which in the voice's id (com.apple.voice.premium.en-US.Ava); Chrome and
// the desktop app give only names, and name two of the same voice by their language, which on a Mac
// means a Premium or Enhanced one is there beside the compact ("Ava (English (United States))").
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Deranged|Fred|Good News|Jester|Hysterical|Junior|Kathy|Organ|Pipe Organ|Superstar|Princess|Ralph|Trinoids|Whisper|Zarvox)( \(|$)/
const ELOQUENCE = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)( \(|$)/
export function quality(v) {
  const id = String(v.voiceURI || '')
  const name = String(v.name || '')
  if (/\.premium\./i.test(id) || /\(Premium\)/i.test(name)) return 0
  if (/\.enhanced\./i.test(id) || /siri/i.test(id) || /\(Enhanced\)/i.test(name) || /\b(Natural|Neural)\b/i.test(name)) return 1
  if (/^com\.apple\.speech\.synthesis\.voice\./.test(id) || NOVELTY.test(name)) return 4
  if (/^com\.apple\.eloquence\./.test(id) || ELOQUENCE.test(name) || /espeak|mbrola/i.test(`${id} ${name}`)) return 3
  if (!/^com\.apple\./.test(id) && /^[^()]+ \([^()]+ \([^()]+\)\)$/.test(name)) return 1
  return 2
}
// What Settings says of a voice's quality, where the device says it.
export const tier = (v) => (/\.premium\.|\(Premium\)/i.test(`${v.voiceURI} ${v.name}`) ? tx('Premium') : /\.enhanced\.|\(Enhanced\)/i.test(`${v.voiceURI} ${v.name}`) ? tx('Enhanced') : null)

// The voices this device has of its own, in the app's language first (then English), the most
// natural first, then the one in this device's region, then its default. Each once (Chrome names a
// Premium and an Enhanced voice alike).
export function voices() {
  const all = synth()?.getVoices?.() || []
  const lang = appLang()
  const region = (typeof navigator !== 'undefined' ? navigator.language || '' : '').toLowerCase()
  const l = (v) => String(v.lang || '').toLowerCase().replace('_', '-')
  const near = (v) => (l(v).startsWith(lang) ? 0 : l(v).startsWith('en') ? 1 : 2)
  const seen = new Set()
  return all.filter((v) => v.localService && near(v) < 2 && quality(v) < 4 && !seen.has(keyOf(v)) && seen.add(keyOf(v)))
    .sort((a, b) => near(a) - near(b) || quality(a) - quality(b) || (l(b) === region) - (l(a) === region) || (b.default ? 1 : 0) - (a.default ? 1 : 0) || a.name.localeCompare(b.name))
}
// They come in a moment after the page loads (Chrome, Safari): asked again when they change.
export function onVoices(fn) {
  const s = synth()
  if (!s?.addEventListener) return () => {}
  s.addEventListener('voiceschanged', fn)
  return () => s.removeEventListener('voiceschanged', fn)
}

// Where to get a more natural voice for this device, when the best it has in the app's language is
// an ordinary one: 'mac' or 'ios' (each has Premium and Enhanced voices to download), else null
// (elsewhere the natural voice on the computer is the way).
export function betterVoices(list = voices()) {
  const best = list.find((v) => String(v.lang || '').toLowerCase().startsWith(appLang())) || list[0]
  if (best && quality(best) <= 1) return null
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return /Macintosh|Mac OS X/.test(ua) ? 'mac' : null
}

// What this device can read with: { system: [voices], natural, espeak }. natural: the computer's
// natural voice where it can run, in the app's language ({ have, downloading, mb, voices... }), else
// null. Asked of the computer at most every 10 seconds (fresh: now).
let server = null // { at, p }
let known = {}
export async function how({ fresh = false } = {}) {
  if (fresh || !server || Date.now() - server.at > 10_000) server = { at: Date.now(), p: api('/voice/speak').catch(() => ({})) }
  const s = await server.p
  known = { natural: s.natural?.languages?.includes(appLang()) ? s.natural : null, espeak: !!s.espeak }
  return { system: voices(), ...known }
}

// The voice it reads with: the one picked on this device while it's still there; else the most
// natural of the device's own; else the computer's natural voice, once it's downloaded; else eSpeak
// NG. { kind: 'system', voice } or { kind: 'natural' } or { kind: 'espeak' } or null.
export function choice(h = { system: voices(), ...known }, p = read()) {
  const sys = h.system || []
  if (p.voice === 'natural' && h.natural?.have) return { kind: 'natural' }
  const v = sys.find((x) => keyOf(x) === p.voice) || sys.find((x) => x.name === p.voice) || sys[0]
  if (v) return { kind: 'system', voice: v }
  if (h.natural?.have) return { kind: 'natural' }
  return h.espeak ? { kind: 'espeak' } : null
}

// An answer as it's heard rather than read: no Markdown, code, links' addresses, pane ids or
// tables; a list's items as sentences; cut to a few sentences, with where the rest is.
export function forEar(text, more = 'There\'s more in the chat.') {
  let s = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
    // Pane ids, as the Chief of Staff names agents: (w1:2), (%12), (pane 3).
    .replace(/\s*\((?:w\d+:\d+|%\d+|pane \d+)\)/g, '')
  // Each line its own sentence.
  s = s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (/[.!?:;,]$/.test(l) ? l : `${l}.`)).join(' ').replace(/\s+/g, ' ').trim()
  if (s.length <= 600) return s
  const cut = s.slice(0, 600)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return `${end > 200 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`} ${more}`
}

// An answer in the pieces the natural voice makes: the first sentence on its own, so it's heard
// soonest, then a sentence or two at a time (up to about 300 characters), each cut where a sentence
// ends ("3.5" and "PR 42." stay whole).
export function pieces(text) {
  const s = String(text || '').trim()
  const all = []
  let at = 0
  for (const m of s.matchAll(/[.!?…]+["')\]]*(?:\s+|$)/g)) { const end = m.index + m[0].length; all.push(s.slice(at, end).trim()); at = end }
  if (at < s.length) all.push(s.slice(at).trim())
  const out = []
  for (const x of all.filter(Boolean)) {
    if (out.length > 1 && out.at(-1).length + x.length < 300) out[out.length - 1] += ` ${x}`
    else out.push(x)
  }
  return out
}

// The sound the computer makes plays here, on one player, so a phone that let it play once (as you
// pressed Ask out loud) lets it play the answer long after.
let player = null
const audio = () => (player ||= typeof Audio !== 'undefined' ? new Audio() : null)
// A hundredth of a second of quiet, as a WAV.
const SILENT = (() => {
  const b = new DataView(new ArrayBuffer(44 + 160))
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); b.setUint32(4, 36 + 160, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true)
  b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, 160, true)
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...new Uint8Array(b.buffer)))}`
})()
function play(blob) {
  const a = audio()
  if (!a) return Promise.resolve()
  const url = URL.createObjectURL(blob)
  a.src = url
  return new Promise((resolve) => {
    const end = () => { a.onended = null; a.onerror = null; a.onpause = null; URL.revokeObjectURL(url); resolve() }
    a.onended = end
    a.onerror = end
    a.onpause = end
    a.play().catch(end)
  })
}

// Phones (iOS above all) only let a page start speaking from a tap: a silent word said as you press
// Ask out loud (or a moment of silence on the player, for the computer's voice) lets the answer be
// read when it comes, long after.
export function unlock() {
  const c = choice()
  const s = synth()
  if (s && voices().length) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u) } catch { /* not needed here */ } }
  if (c && c.kind !== 'system' && audio()) { const a = audio(); a.src = SILENT; a.play().catch(() => {}) }
}

// Reads it aloud: { done: Promise (true once it's all been heard), stop(), voice, error, note }.
// With the voice picked in Settings › Voice on this device (choice() above). The natural voice
// failing before a word is heard (its download gone, the computer out of reach) hands it to this
// device's own voice, and says why in note; error says why nothing was heard.
export function say(text, { voice = null } = {}) {
  const p = { ...read(), ...(voice ? { voice } : {}) }
  const c = choice(undefined, p)
  const rate = Number(p.rate) || 1
  if (!c) return { done: Promise.resolve(false), stop() {}, voice: null, error: 'No voice here can read it' }
  if (c.kind === 'system') return system(text, c.voice, rate)
  const sys = voices()
  return fromComputer(text, { engine: c.kind, voice: Number(p.natural) || 0, rate, fallback: c.kind === 'natural' && sys.length ? () => system(text, sys[0], rate) : null })
}

function system(text, v, rate) {
  const s = synth()
  const u = new SpeechSynthesisUtterance(text)
  u.voice = v
  u.lang = v.lang
  u.rate = rate
  const out = { stopped: false, error: null, voice: v.name }
  out.done = new Promise((resolve) => {
    u.onend = () => resolve(true)
    u.onerror = (e) => { if (!out.stopped) out.error = e?.error || null; resolve(false) }
  })
  s.cancel()
  s.speak(u)
  out.stop = () => { out.stopped = true; s.cancel() }
  return out
}

// Made on the computer and played here: the natural voice a piece at a time, the next made while
// one plays; eSpeak NG all at once (it's quick).
function fromComputer(text, { engine, voice, rate, fallback }) {
  const parts = engine === 'natural' ? pieces(text) : [String(text || '')]
  const stop = new AbortController()
  const lang = currentLang() || 'en'
  const out = { stopped: false, error: null, note: null, voice: engine === 'natural' ? 'natural' : 'eSpeak NG', sub: null }
  const make = (words) => {
    const r = fetch(apiUrl('/voice/speak'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: words, lang, engine, voice, rate }), signal: stop.signal })
      .then(async (res) => { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`); return res.blob() })
    r.catch(() => {})
    return r
  }
  let heard = false
  out.done = (async () => {
    let next = make(parts[0])
    for (let i = 0; i < parts.length; i++) {
      const blob = await next
      if (out.stopped) return false
      if (i + 1 < parts.length) next = make(parts[i + 1])
      heard = true
      await play(blob)
      if (out.stopped) return false
    }
    return true
  })().catch((e) => {
    if (out.stopped) return false
    if (!heard && fallback) { out.note = e.message; out.sub = fallback(); return out.sub.done }
    out.error = e.message
    return false
  })
  out.stop = () => { out.stopped = true; stop.abort(); player?.pause(); out.sub?.stop() }
  return out
}
