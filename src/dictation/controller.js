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
import { api, apiUrl, settingsChanged, viaRelay } from '../api.js'
import { startPcm, microphone, wav, RATE, micRefused, micBlocked } from '../audio/pcm.js'
import { clean, makeNames } from '../../shared/dictation/clean.js'
import { defaultKey, keyLabel } from '../../shared/dictation/keys.js'
import { t } from '../i18n/index.js'

export const HOLD_MS = 300

// phase: idle | opening (asking for the mic) | listening | working (turning it into text).
// mode: hold | free (hands-free). level: how loud now (0 to 1); levels: the last few, oldest first,
// for the pill's moving bars (Pill.jsx). live: what's been heard so far, while it listens and until
// the text is in (live words, below). note: a line to show. setup: what /voice says is missing, or
// { mic: true }. result: { text } the last text (for the floating window). offer: the desktop app's
// key status, while asking whether the key should work from any app too.
export const LEVELS = 18
const QUIET = Array(LEVELS).fill(0)
let st = { phase: 'idle', mode: null, target: null, level: 0, levels: QUIET, live: '', since: 0, note: null, setup: null, result: null, retry: false, offer: null }
const subs = new Set()
// Done with listening (the text is in, or it isn't coming): its live words go with it.
const set = (p) => { st = { ...st, ...p, ...(p.phase === 'idle' ? { live: '' } : {}) }; for (const f of subs) f() }
export const getState = () => st
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
// select: what a component needs of it, so one that isn't recording isn't drawn again ten times a
// second for the level (it must give back the same value while nothing it needs has changed).
export const useDictation = (select = (x) => x) => useSyncExternalStore(subscribe, () => select(st))
export const active = () => st.phase !== 'idle'

// The platform the keys are pressed on: the desktop app's, else this browser's.
export const keysPlatform = () => window.bridgeApp?.platform || (/Mac|iPhone|iPad/.test(navigator.platform) ? 'darwin' : /Win/.test(navigator.platform) ? 'win32' : 'linux')
// Fn never reaches a page: only the desktop app on a Mac hears it (with the key from other apps on),
// and tells the page. Anywhere else the usual key works instead.
const fnHeard = (c) => !!window.bridgeApp?.desktop && keysPlatform() === 'darwin' && c.background === true
export const dictationKey = (c) => (c?.key && (c.key !== 'Fn' || fnHeard(c)) ? c.key : defaultKey(keysPlatform()))
// What a bar says while it listens, held or hands-free.
export const listeningHint = (mode, label) => (mode === 'free' ? t("Listening… press {key} or Enter when you're done", { key: label }) : t('Talking… let go to add it · Esc cancels'))

// Settings › Voice › Dictation, from /api/config: { on, key, cleanup, atFiles, to, background,
// history, keepFor, keepAudio, liveWords }.
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
// Asking the Chief of Staff out loud (voice/AskOutLoud.jsx): its own way to take the words.
const asks = new Map()
export function registerAsk(id, fn) { asks.set(id, fn); return () => { if (asks.get(id) === fn) asks.delete(id) } }
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
  if (target.kind === 'ask') { const f = asks.get(target.id); if (f) f(text); return !!f }
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
  set({ phase: 'opening', mode: 'hold', target, level: 0, levels: QUIET, live: '', since: Date.now(), note: null, setup: null, result: null, retry: false, offer: null })
  words()
  // Something to install first (whisper.cpp, for a Whisper model)? Then the mic isn't opened: nothing
  // could turn it into text. The speech model only to download is different: you talk now, and
  // what you said is kept and turned into text once it's here (transcribe, below). Asked once in a
  // while, not on every press.
  if (Date.now() - voiceOk > 10 * 60_000) {
    const v = await api('/voice').catch(() => null)
    if (seq !== id) return
    if (v && !v.ready && v.needs !== 'model') { set({ phase: 'idle', setup: v }); return }
    if (v?.ready) voiceOk = Date.now()
  }
  if (!navigator.mediaDevices?.getUserMedia) { set({ phase: 'idle', note: t('Microphone needs HTTPS (open the Tailscale address)') }); return }
  const liveP = liveOk()
  try {
    const stream = await microphone()
    if (seq !== id) { stream.getTracks().forEach((x) => x.stop()); return }
    const live = (await liveP) ? liveSender(id) : null
    const pcm = await startPcm(stream, { onLevel: (level) => { if (seq === id) set({ level, levels: [...st.levels.slice(1 - LEVELS), level] }) }, onPcm: live?.push, every: live ? LIVE_MS : 0 })
    if (seq !== id) { pcm.cancel(); live?.end(); return }
    rec = { pcm, id, live }
    set({ phase: 'listening', since: Date.now() })
    navigator.vibrate?.(15)
  } catch (e) {
    if (seq !== id) return
    // In the desktop app on a Mac: what macOS says, with the way to allow it (or reset it) there.
    const fix = await micRefused(e)
    if (seq !== id) return
    if (fix) { set({ phase: 'idle', setup: fix }); return }
    set({ phase: 'idle', note: e.name === 'NotAllowedError' ? micBlocked() : e.message })
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
  rec?.live?.end()
  rec = null
  set({ phase: 'idle', mode: null, level: 0, note: null, setup: null })
}
export const dismiss = () => set({ note: null, setup: null, retry: false, result: null })

// Stop listening, turn it into text, put it where it goes.
export async function finish() {
  if (st.phase === 'opening') { cancel(); return }
  if (st.phase !== 'listening' || !rec) return
  const { pcm, id, live } = rec
  rec = null
  const target = st.target
  set({ phase: 'working', level: 0 })
  navigator.vibrate?.(10)
  // No more live words: what was heard so far stays up while the whole of it is turned into text.
  live?.end()
  const samples = await pcm.stop()
  if (seq !== id) return
  if (samples.length < RATE * 0.3) { set({ phase: 'idle', note: t('Recording too short') }); return }
  lastAudio = { blob: wav(samples), target }
  await transcribe(id)
}
// The last recording again: after the computer couldn't turn it into text, or once the speech model
// it needed is here (the setup panel's onReady).
export async function retry() {
  if (!lastAudio || st.phase !== 'idle') return
  const id = ++seq
  set({ phase: 'working', target: lastAudio.target, note: null, retry: false, setup: null })
  await transcribe(id)
}
async function transcribe(id) {
  const { blob, target } = lastAudio
  try {
    const res = await fetch(apiUrl('/transcribe'), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob })
    const data = await res.json().catch(() => ({}))
    if (seq !== id) return
    // Not set up yet (the speech model to download, or whisper.cpp to install): the setup panel, in
    // the server's words, and what you said kept for when it's ready.
    if (res.status === 409 && /^needs-/.test(data.code || '')) {
      const v = await api('/voice').catch(() => ({}))
      if (seq !== id) return
      set({ phase: 'idle', mode: null, setup: { ...v, ask: data.error, audio: true } })
      return
    }
    if (!res.ok) throw Object.assign(new Error(data.error || t('Transcription failed')), { said: data.error })
    const w = await words()
    const text = clean(data.text, { cleanup: cfg.cleanup !== false, atFiles: cfg.atFiles !== false, sentence: target?.sentence !== false, names: w?.names, heard: w?.heard })
    if (seq !== id) return
    if (!text) { set({ phase: 'idle', note: t('No speech detected') }); return }
    lastAudio = null
    const at = Date.now()
    set({ phase: 'idle', mode: null, result: { text, at } })
    const put = deliver(target, text)
    keep(at, target, put, { text, raw: data.text, ms: Math.round(((blob.size - 44) / 2 / RATE) * 1000) }, blob)
    if (!put) set({ note: t('Nowhere to put it, so here it is: {text}', { text }) })
    else if (target?.kind !== 'hud') offerAnyApp()
  } catch (e) {
    if (seq !== id) return
    voiceOk = 0
    const v = await api('/voice').catch(() => null)
    if (seq !== id) return
    // What the computer said, as it said it (a speech model to download first, say).
    set({ phase: 'idle', mode: null, setup: v && !v.ready ? v : null, retry: true, note: e.said || t("Couldn't transcribe: {error}", { error: e.message }) })
  }
}

// ---------- Live words while you talk (server/livewords.js) ----------
// Where they can work (a sherpa-onnx model downloaded, this computer quick enough, not turned off in
// Settings), the sound goes to the computer as it comes, half a second at a time, and what it's
// heard so far comes back, shown while it listens (the pill, the message box's recording bar). One
// piece at a time, the next with whatever came meanwhile. The finished text is still the whole
// recording, heard once you let go (transcribe, above).
// Through the relay (a phone), a second at a time: half as many messages against its allowance.
const LIVE_MS = viaRelay ? 1000 : 500
let liveAt = 0
let liveCan = false
export async function liveOk() {
  if (cfg.liveWords === false) return false
  if (Date.now() - liveAt > 60_000) {
    liveAt = Date.now()
    liveCan = await api('/dictation/live').then((r) => !!r.can, () => false)
  }
  return liveCan
}
let known = null // the names to spell right, once words() has them
function liveSender(id) {
  const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  let queue = []
  let sending = false
  let stopped = false
  words()?.then((w) => { known = w })
  const send = async () => {
    if (sending || stopped || !queue.length) return
    sending = true
    const n = queue.reduce((a, c) => a + c.length, 0)
    const body = new Int16Array(n)
    let o = 0
    for (const c of queue) { body.set(c, o); o += c.length }
    queue = []
    try {
      const r = await fetch(apiUrl(`/dictation/live/${sid}`), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: body.buffer })
      const j = await r.json().catch(() => ({}))
      if (stopped || seq !== id) return
      // Can't keep up here (or can't any more): the words come when you let go, as before.
      if (!r.ok || j.live === false) { stopped = true; if (j.why === 'slow') { liveCan = false; liveAt = Date.now() } set({ live: '' }); return }
      if (j.text && (st.phase === 'listening' || st.phase === 'opening')) set({ live: clean(j.text, { cleanup: cfg.cleanup !== false, atFiles: false, sentence: false, names: known?.names, heard: known?.heard }) })
    } catch { stopped = true } finally { sending = false }
    if (queue.length) send()
  }
  return {
    push: (c) => { if (!stopped && seq === id) { queue.push(c); send() } },
    end: () => { if (stopped && !sending) return; stopped = true; fetch(apiUrl(`/dictation/live/${sid}`), { method: 'DELETE' }).catch(() => {}) },
  }
}

// ---------- Kept (Settings › Voice › Dictation History; server/dictations.js) ----------
// Each dictation, with where it went: typed into a message box (its agent), a terminal or another
// box in Bridge AI. The dictation window's are kept as soon as they're heard, with the app they
// were said in, and amended once pasted, sent or copied (amend). With history off, nothing's sent
// to be kept; the recording only with "Keep the recordings too".
const kept = new Map() // the words' time (result.at) -> its id, once kept (a promise)
function keep(at, target, put, said, blob) {
  if (cfg.history === false) return
  const body = { ...said, how: null }
  if (target?.kind === 'ask') { if (put) { body.how = 'sent'; body.agent = { id: target.id, chief: true } } } else if (target?.kind === 'hud') { if (target.app) body.app = target.app } else {
    // Put nowhere (what it was for had gone): kept all the same, as said in Bridge AI.
    if (put) body.how = 'typed'
    if (put && target.kind === 'composer') body.agent = { id: target.id }
    else body.place = target?.kind === 'terminal' ? 'terminal' : 'field'
  }
  const p = api('/dictations', { method: 'POST', body }).then(async (r) => {
    if (!r?.kept) return null
    if (cfg.keepAudio === true && blob) await fetch(apiUrl(`/dictations/${encodeURIComponent(r.id)}/audio`), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob }).catch(() => {})
    return r.id
  }, () => null)
  kept.set(at, p)
  for (const k of kept.keys()) if (kept.size > 8) kept.delete(k)
}
// What became of the words (result: s.result): { how, agent }.
export async function amend(result, patch) {
  const id = await kept.get(result?.at)
  if (id) await api(`/dictations/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }).catch(() => {})
}
// Not kept after all: what was said into a password field.
export async function forget(result) {
  const id = await kept.get(result?.at)
  kept.delete(result?.at)
  if (id) await api(`/dictations/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
}

// ---------- The key from any app ----------
// Off until you say yes (shared/dictation/platform.js). In the desktop app, where this computer lets
// it be heard from other apps, the first words that land in Bridge AI ask once; either answer is
// kept, and Settings › Voice changes it.
let offered = false
async function offerAnyApp() {
  const app = window.bridgeApp
  if (offered || cfg.background != null || !app?.dictateStatus) return
  offered = true
  const s = await app.dictateStatus().catch(() => null)
  if (!s?.mode || st.phase !== 'idle' || st.note || st.setup) return
  set({ offer: s })
}
export async function answerOffer(yes) {
  const was = st.offer
  set({ offer: null })
  cfg = { ...cfg, background: yes }
  await api('/settings', { method: 'PATCH', body: { dictation: { background: yes } } }).then(settingsChanged, () => {})
  if (!yes || !was) return
  const s = await window.bridgeApp?.dictateConfigure?.(cfg).catch(() => null)
  if (s?.taken) set({ note: t('{key} is taken by another app. Pick another key in Settings › Voice.', { key: keyLabel(s.key, keysPlatform()) }) })
}
