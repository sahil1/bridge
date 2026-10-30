// Dictation in the page: one recording at a time, whoever starts it (the dictation key, the message
// box's mic button, the desktop app's key from another app). Hold to talk and let go to get the text;
// a tap (let go within 300 ms, or before the mic was even on) keeps listening hands-free until the
// key again, Enter or ✓. Esc or Cancel throws it away.
//
// The sound is 16 kHz PCM from the page (src/audio/pcm.js), sent once as a WAV to /api/transcribe,
// which turns it into text on the computer (server/voice.js); from a phone it goes there over the
// relay's end-to-end encrypted link like every other request. The text is tidied
// (shared/dictation/clean.js, with the names the computer knows) and put where you were: the message
// box (at its cursor), a terminal tab (typed, without Enter), any other field; with nothing focused,
// the message box of the agent on screen. The desktop app's floating window (Hud.jsx) shows it
// instead, to send or copy.
import { useSyncExternalStore } from 'react'
import { api, apiUrl } from '../api.js'
import { startPcm, microphone, wav, RATE } from '../audio/pcm.js'
import { clean, makeNames } from '../../shared/dictation/clean.js'
import { defaultKey } from '../../shared/dictation/keys.js'
import { t } from '../i18n/index.js'

export const HOLD_MS = 300

// phase: idle | opening (asking for the mic) | listening | working (turning it into text).
// mode: hold | free (hands-free). note: a line to show. setup: what /voice says is missing, or
// { mic: true }. result: { text } the last text (for the floating window).
let st = { phase: 'idle', mode: null, target: null, level: 0, since: 0, note: null, setup: null, result: null, retry: false }
const subs = new Set()
const set = (p) => { st = { ...st, ...p }; for (const f of subs) f() }
export const getState = () => st
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
// select: what a component needs of it, so one that isn't recording isn't drawn again ten times a
// second for the level (it must give back the same value while nothing it needs has changed).
export const useDictation = (select = (x) => x) => useSyncExternalStore(subscribe, () => select(st))
export const active = () => st.phase !== 'idle'

// The platform the keys are pressed on: the desktop app's, else this browser's.
export const keysPlatform = () => window.bridgeApp?.platform || (/Mac|iPhone|iPad/.test(navigator.platform) ? 'darwin' : /Win/.test(navigator.platform) ? 'win32' : 'linux')
export const dictationKey = (c) => c?.key || defaultKey(keysPlatform())
// What a bar says while it listens, held or hands-free.
export const listeningHint = (mode, label) => (mode === 'free' ? t("Listening… press {key} or Enter when you're done", { key: label }) : t('Talking… let go to add it · Esc cancels'))

// Settings › Voice › Dictation, from /api/config: { on, key, cleanup, atFiles, to, background }.
let cfg = {}
export const configure = (c) => { cfg = c || {} }
export const settings = () => cfg
// Picking a new key (Settings): the key does nothing meanwhile.
let paused = false
export const pause = (on) => { paused = !!on }
export const isPaused = () => paused

// ---------- Where the text goes ----------
// Message boxes say they're there (Composer.jsx): { insert(text, caret), visible() }.
const boxes = new Map()
let lastBox = null
let onScreen = () => null // the agent on screen (App.jsx)
export function registerBox(id, box) { boxes.set(id, box); return () => { if (boxes.get(id) === box) boxes.delete(id) } }
export const noteBoxFocus = (id) => { lastBox = id }
export const setOnScreen = (fn) => { onScreen = fn || (() => null) }
export const box = (id) => boxes.get(id) || null
function fallbackBox() {
  const a = onScreen()
  if (a && boxes.get(a)?.visible()) return a
  if (lastBox && boxes.get(lastBox)?.visible()) return lastBox
  for (const [id, b] of boxes) if (b.visible()) return id
  return null
}
const TEXTY = /^(text|search|url|email|tel|)$/
const editable = (el) => !!el && !el.disabled && !el.readOnly && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXTY.test(el.type || '')) || el.isContentEditable)
// Where the focus is now, as a target: { kind: composer | terminal | field | password, ... }.
export function targetFromFocus() {
  const el = document.activeElement
  if (el?.classList?.contains('xterm-helper-textarea')) {
    const host = el.closest('.terminal-host')
    if (host) return { kind: 'terminal', el: host, sentence: false }
  }
  const id = el?.getAttribute?.('data-composer')
  if (id && boxes.has(id)) return { kind: 'composer', id, caret: [el.selectionStart, el.selectionEnd] }
  if (el?.tagName === 'INPUT' && el.type === 'password') return { kind: 'password' }
  if (editable(el)) return { kind: 'field', el, sel: typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null, sentence: el.tagName === 'TEXTAREA' || el.isContentEditable }
  const b = fallbackBox()
  return b ? { kind: 'composer', id: b } : null
}

// Typed into a field at its cursor, as if you had: React and undo both see it.
function typeInto(el, text, sel) {
  el.focus()
  if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]) } catch { /* not a text input */ } }
  const before = el.isContentEditable ? '' : String(el.value || '').slice(0, el.selectionStart ?? 0)
  const ins = `${before && !/\s$/.test(before) ? ' ' : ''}${text}`
  if (document.execCommand?.('insertText', false, ins)) return
  const v = String(el.value || '')
  const a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  if (setter) setter.call(el, v.slice(0, a) + ins + v.slice(b)); else el.value = v.slice(0, a) + ins + v.slice(b)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function deliver(target, text) {
  if (!target || target.kind === 'hud') return true
  if (target.kind === 'composer' && boxes.get(target.id)) { boxes.get(target.id).insert(text, target.caret); return true }
  // Typed into the terminal, without Enter (Terminal.jsx and LiveShell.jsx listen for this).
  if (target.kind === 'terminal' && target.el?.isConnected) { target.el.dispatchEvent(new CustomEvent('bridge-type', { detail: text })); return true }
  if (target.kind === 'field' && target.el?.isConnected) { typeInto(target.el, text, target.sel); return true }
  // What you were in has gone: the message box on screen.
  const b = fallbackBox()
  if (b) { boxes.get(b).insert(text); return true }
  return false
}

// ---------- Names to spell right (server/dictation.js), kept a minute ----------
let wordsAt = 0
let wordsP = null
function words() {
  if (!wordsP || Date.now() - wordsAt > 60_000) {
    wordsAt = Date.now()
    wordsP = api('/dictation/words').then((w) => ({ names: makeNames(w.terms), heard: w.heard || [] }), () => { wordsAt = 0; return null })
  }
  return wordsP
}

// ---------- Recording ----------
let seq = 0
let rec = null // { pcm, id }
let pressAt = 0
let voiceOk = 0 // when /voice last said voice notes are ready
let lastAudio = null // { blob, target }, to try again

// The key (or the mic button) going down: starts listening, or ends hands-free listening.
export async function press(target, at = Date.now()) {
  if (paused) return
  if (st.phase === 'listening' || st.phase === 'opening') { if (st.mode === 'free') finish(); return }
  if (st.phase === 'working') return
  if (!target) { set({ note: t('Click where the words should go, or open an agent, then try again.'), target: null }); return }
  if (target.kind === 'password') { set({ note: t("Can't dictate into a password field."), target: null }); return }
  const id = ++seq
  pressAt = at
  set({ phase: 'opening', mode: 'hold', target, level: 0, since: Date.now(), note: null, setup: null, result: null, retry: false })
  words()
  // Set up on the computer? Asked once in a while, not on every press.
  if (Date.now() - voiceOk > 10 * 60_000) {
    const v = await api('/voice').catch(() => null)
    if (seq !== id) return
    if (v && !v.ready) { set({ phase: 'idle', setup: v }); return }
    if (v?.ready) voiceOk = Date.now()
  }
  if (!navigator.mediaDevices?.getUserMedia) { set({ phase: 'idle', note: t('Microphone needs HTTPS (open the Tailscale address)') }); return }
  try {
    const stream = await microphone()
    if (seq !== id) { stream.getTracks().forEach((x) => x.stop()); return }
    const pcm = await startPcm(stream, { onLevel: (level) => { if (seq === id) set({ level }) } })
    if (seq !== id) { pcm.cancel(); return }
    rec = { pcm, id }
    set({ phase: 'listening', since: Date.now() })
    navigator.vibrate?.(15)
  } catch (e) {
    if (seq !== id) return
    // In the desktop app, macOS's own answer: when it says no, offer to allow it there.
    if (e.name === 'NotAllowedError' && window.bridgeApp?.mediaAccess) {
      const s = await window.bridgeApp.mediaAccess('microphone').catch(() => null)
      if (s === 'denied' || s === 'restricted') { set({ phase: 'idle', setup: { mic: true } }); return }
    }
    set({ phase: 'idle', note: e.name === 'NotAllowedError' ? t('The microphone is blocked. Allow it for this page in your browser\'s site settings.') : e.message })
  }
}

// The key let go: held long enough, that's the end; a tap (or let go before the mic was on) keeps
// listening.
export function release(at = Date.now()) {
  if (st.mode !== 'hold' || (st.phase !== 'opening' && st.phase !== 'listening')) return
  if (st.phase === 'opening' || at - pressAt < HOLD_MS) set({ mode: 'free' })
  else finish()
}

export function cancel() {
  seq++
  rec?.pcm.cancel()
  rec = null
  set({ phase: 'idle', mode: null, level: 0, note: null, setup: null })
}
export const dismiss = () => set({ note: null, setup: null, retry: false, result: null })
// Setting up voice notes, from the desktop app's dictation window: in the message box on screen.
export async function showSetup() {
  const v = await api('/voice').catch(() => null)
  if (!v || v.ready) return
  const b = fallbackBox()
  set({ phase: 'idle', target: b ? { kind: 'composer', id: b } : null, setup: v })
}

// Stop listening, turn it into text, put it where it goes.
export async function finish() {
  if (st.phase === 'opening') { cancel(); return }
  if (st.phase !== 'listening' || !rec) return
  const { pcm, id } = rec
  rec = null
  const target = st.target
  set({ phase: 'working', level: 0 })
  navigator.vibrate?.(10)
  const samples = await pcm.stop()
  if (seq !== id) return
  if (samples.length < RATE * 0.3) { set({ phase: 'idle', note: t('Recording too short') }); return }
  lastAudio = { blob: wav(samples), target }
  await transcribe(id)
}
// The last recording again (after the computer couldn't turn it into text).
export async function retry() {
  if (!lastAudio || st.phase !== 'idle') return
  const id = ++seq
  set({ phase: 'working', target: lastAudio.target, note: null, retry: false })
  await transcribe(id)
}
async function transcribe(id) {
  const { blob, target } = lastAudio
  try {
    const res = await fetch(apiUrl('/transcribe'), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob })
    const data = await res.json().catch(() => ({}))
    if (seq !== id) return
    if (!res.ok) throw Object.assign(new Error(data.error || t('Transcription failed')), { said: data.error })
    const w = await words()
    const text = clean(data.text, { cleanup: cfg.cleanup !== false, atFiles: cfg.atFiles !== false, sentence: target?.sentence !== false, names: w?.names, heard: w?.heard })
    if (seq !== id) return
    if (!text) { set({ phase: 'idle', note: t('No speech detected') }); return }
    lastAudio = null
    set({ phase: 'idle', mode: null, result: { text, at: Date.now() } })
    if (!deliver(target, text)) set({ note: t('Nowhere to put it, so here it is: {text}', { text }) })
  } catch (e) {
    if (seq !== id) return
    voiceOk = 0
    const v = await api('/voice').catch(() => null)
    if (seq !== id) return
    // What the computer said, as it said it (a speech model to download first, say).
    set({ phase: 'idle', mode: null, setup: v && !v.ready ? v : null, retry: true, note: e.said || t("Couldn't transcribe: {error}", { error: e.message }) })
  }
}
