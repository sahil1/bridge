// Answers read aloud (the Chief of Staff's, asked out loud: AskOutLoud.jsx), by a voice on the
// device you're using: the system's own voices that run on it (macOS's, Windows', the phone's), never
// one the browser fetches from the internet (Chrome's "Google" voices say localService: false and
// are left out). Where this device has none of its own (Linux, mostly), the computer reads it with
// eSpeak NG when that's installed there (server/voicespeak.js), and the sound plays here. Where there's
// neither, nothing is offered: the answer is in the chat as always.
import { api, apiUrl } from '../api.js'
import { currentLang } from '../i18n/index.js'

const STORE = 'cc-voice' // { voice: name of the one picked on this device, rate }
const read = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {} } catch { return {} } }
export const prefs = read
export function setPrefs(p) { try { localStorage.setItem(STORE, JSON.stringify({ ...read(), ...p })) } catch { /* not kept */ } }

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null
// The voices this device has of its own, in the app's language first (then English), default first.
export function voices() {
  const all = synth()?.getVoices?.() || []
  const lang = (currentLang() || 'en').toLowerCase().split('-')[0]
  const mine = all.filter((v) => v.localService)
  const rank = (v) => (v.lang.toLowerCase().startsWith(lang) ? 0 : v.lang.toLowerCase().startsWith('en') ? 1 : 2) * 2 + (v.default ? 0 : 1)
  return mine.filter((v) => rank(v) < 4).sort((a, b) => rank(a) - rank(b))
}
// They come in a moment after the page loads (Chrome, Safari): asked again when they change.
export function onVoices(fn) {
  const s = synth()
  if (!s?.addEventListener) return () => {}
  s.addEventListener('voiceschanged', fn)
  return () => s.removeEventListener('voiceschanged', fn)
}

// What this device can read with: { system: [voices] } or { espeak: true } or {} (nothing).
let server = null
export async function how() {
  const v = voices()
  if (v.length) return { system: v }
  server ||= api('/voice/speak').catch(() => ({}))
  const s = await server
  return s.espeak ? { espeak: true } : {}
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

// Phones (iOS above all) only let a page start speaking from a tap: a silent word, said as you press
// Ask out loud, lets the answer be read when it comes, long after.
export function unlock() {
  const s = synth()
  if (!s || !voices().length) return
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u) } catch { /* not needed here */ }
}

// Reads it aloud: { done: Promise, stop() }. With a system voice, the one picked in Settings ›
// Voice on this device (else the first of voices()); else the computer's eSpeak NG.
export function say(text, { voice = null } = {}) {
  const v = voices()
  const p = read()
  if (v.length) {
    const s = synth()
    const u = new SpeechSynthesisUtterance(text)
    u.voice = v.find((x) => x.name === (voice || p.voice)) || v[0]
    u.lang = u.voice.lang
    u.rate = Number(p.rate) || 1
    const done = new Promise((resolve) => { u.onend = () => resolve(true); u.onerror = () => resolve(false) })
    s.cancel()
    s.speak(u)
    return { done, stop: () => s.cancel(), voice: u.voice.name }
  }
  let audio = null
  let stopped = false
  const done = (async () => {
    const r = await fetch(apiUrl('/voice/speak'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: currentLang() || 'en' }) })
    if (!r.ok || stopped) return false
    const url = URL.createObjectURL(await r.blob())
    audio = new Audio(url)
    try {
      await audio.play()
      await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; audio.onpause = resolve })
    } finally { URL.revokeObjectURL(url) }
    return !stopped
  })().catch(() => false)
  return { done, stop: () => { stopped = true; audio?.pause() }, voice: 'eSpeak NG' }
}
